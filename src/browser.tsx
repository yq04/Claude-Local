/**
 * [INPUT]: 原生浏览器/CLI归属快照、网络防漏断路器状态与事件、轻量窗口采样、真实观测事件、共享活动日志、env-pages.css、Pika 图标与双语文案。
 * [OUTPUT]: 顶部浏览器操作卡（四列去重发丝遥测条 + 状态胶囊）、分组标头、两列边线核验矩阵、双列水平数据清理区、高级设置与安全确认弹窗。
 * [POS]: 浏览器交互边界；只展示配置、操作与真实观测，页面加载只读，系统对齐和登录删除必须由用户选择；全清理使用默认取消且需勾选确认的 AlertDialog，不新增备份，不影响其他身份资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Button, Input, Select, Checkbox, Disclosure } from 'cromma-ui';
import { Refresh, WindowBrowser, EraserDefault } from 'cromma-ui/pika';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AppDialog } from './dialog';
import { CleanupActivity, useCleanupActivity } from './cleaner-activity';
import { type BrowserConfig, type BrowserState, type KillSwitchState } from './browser-model';
import { formatBytes } from './cleaner-model';
import { usePageRefresh } from './app-events';
import {maskDisplayName, usePreferences} from './settings-model';
import {useBrowserRuntime} from './use-browser-runtime';
import {areCliAndBrowserProxiesAligned, toBrowserSocks5ProxyFromCli} from './risk-model';
import './env-pages.css';

export function BrowserPanel({ onBusy }: {
    onBusy?: (busy: boolean) => void;
}) {
    const { t, locale } = useI18n();
    const prefs = usePreferences();
    const [state, setState] = useState<BrowserState | null>(null), [draft, setDraft] = useState<BrowserConfig | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [confirm, setConfirm] = useState<'reset' | 'align' | null>(null);
    const [killSwitch, setKillSwitch] = useState<KillSwitchState | null>(null), [killSwitchBusy, setKillSwitchBusy] = useState(false);
    const gate = useRef(false), live = useRef(true), snapshotSequence = useRef(0);
    const [accepted, setAccepted] = useState(false), [advancedOpen, setAdvancedOpen] = useState(false);
    const [returnCliBrowser, setReturnCliBrowser] = useState<{expectedIdentity: string; name: string} | null>(null);
    const browserRuntime = useBrowserRuntime(state?.active_browser_slot, !!state && !busy);
    const activity = useCleanupActivity();
    const [clock, setClock] = useState(Date.now);
    useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
    useEffect(() => { onBusy?.(!!busy); return () => onBusy?.(false); }, [busy, onBusy]);
    async function refreshKillSwitch() {
        const ks = await invoke<KillSwitchState>('browser_kill_switch_state').catch(() => null);
        if (live.current && ks) setKillSwitch(ks);
    }
    async function dismissKillSwitch() {
        setKillSwitchBusy(true);
        try {
            const ks = await invoke<KillSwitchState>('browser_kill_switch_dismiss').catch(() => null);
            if (live.current) {
                if (ks) setKillSwitch(ks);
                else setKillSwitch(prev => prev ? { ...prev, triggered: false } : prev);
            }
        } finally {
            if (live.current) setKillSwitchBusy(false);
        }
    }
    async function toggleKillSwitch(enabled: boolean) {
        setKillSwitchBusy(true);
        try {
            const ks = await invoke<KillSwitchState>('browser_kill_switch_set_enabled', { enabled });
            if (live.current && ks) setKillSwitch(ks);
        } catch (e) {
            if (live.current) setError(String(e));
        } finally {
            if (live.current) setKillSwitchBusy(false);
        }
    }
    async function read(initial = false) {
        const sequence = ++snapshotSequence.current;
        const next = await invoke<BrowserState>('browser_read');
        if (live.current && sequence === snapshotSequence.current) {
            setState(next);
            if (initial)
                setDraft(next.config);
        }
        void refreshKillSwitch();
        return next;
    }
    usePageRefresh(() => {
        if (!gate.current && live.current)
            void read().catch(e => setError(String(e)));
    });
    useEffect(() => {
        live.current = true;
        void read(true).catch(e => setError(String(e)));
        const event = listen('browser-report', () => {
            if (!gate.current)
                void read().catch(e => setError(String(e)));
        });
        const ksStateEvent = listen<KillSwitchState>('kill-switch-state', e => {
            if (live.current && e.payload) setKillSwitch(e.payload);
        });
        const ksTriggeredEvent = listen<KillSwitchState>('kill-switch-triggered', e => {
            if (live.current && e.payload) setKillSwitch(e.payload);
        });
        return () => {
            live.current = false;
            snapshotSequence.current++;
            void event.then(f => f());
            void ksStateEvent.then(f => f());
            void ksTriggeredEvent.then(f => f());
        };
    }, []);
    async function act(command: string, args: Record<string, unknown> = {}) {
        if (gate.current)
            return;
        gate.current = true;
        snapshotSequence.current++;
        browserRuntime.invalidate();
        setBusy(command === 'browser_clear' && args.resetProfile ? 'browser_reset' : command);
        setError('');
        const onProgress = activity.start('browser');
        try {
            const next = await invoke<BrowserState>(command, { ...args, ...(['browser_launch', 'browser_clear', 'browser_align', 'browser_return_to_cli'].includes(command) ? { onProgress } : {}) });
            if (!live.current) return;
            setState(next);
            if (command === 'browser_save' || command === 'browser_align' || command === 'browser_return_to_cli')
                setDraft(next.config);
            if (command === 'browser_launch')
                void refreshKillSwitch();
            activity.finish(true, command === 'browser_clear' ? (args.resetProfile ? "当前身份的浏览器资料已全清理，未保留副本。" : "清理完成，未保留副本。") : command === 'browser_check' ? "机器出口已检测；浏览器结果由实测页上报。" : command === 'browser_return_to_cli' ? 'browser.returnToCliDone' : "操作完成。");
        }
        catch (e) {
            setError(String(e));
            activity.finish(false, String(e));
            try {
                await read();
            }
            catch {
                setState(null);
            }
        }
        finally {
            gate.current = false;
            setBusy('');
        }
    }
    const disabled = !!busy || !state || !draft;
    const changed = state && draft && JSON.stringify(state.config) !== JSON.stringify(draft);
    const cache = state?.cache.filter(x => !x.login) || [];
    const checks = state?.checks || [];
    const allChecksOk = checks.length > 0 && checks.every(x => x.status === 'ok');
    const hasMismatch = checks.some(x => x.status === 'mismatch');
    const isStale = !!state?.report_received_at && (clock - state.report_received_at > 10 * 60 * 1000);
    const hasObservation = Boolean(state?.report_received_at || state?.report);
    const checksPassed = allChecksOk && !isStale;
    const showWarnSummary = isStale || hasMismatch || (hasObservation && !allChecksOk);
    const browserIdentityName = state?.identity ? maskDisplayName(state.identity.name, state.identity.email, prefs.privacyMask) : t('browser.identityUnknown');
    const cliIdentityName = state?.cli_identity ? maskDisplayName(state.cli_identity.name, state.cli_identity.email, prefs.privacyMask) : t('browser.identityUnknown');
    const cliTelemetryMeta = !state
        ? t('读取中…')
        : state.cli_expected_identity
            ? t(state.identity?.status === 'linked' ? 'quick.browserLinked' : 'quick.browserIndependent')
            : t('browser.identityUnknown');
    const profileBaseMeta = !state
        ? t('读取中…')
        : state.identity?.status === 'warming'
            ? `${t('warming.verificationOwner')} · ${t('warming.cliUnaffectedShort')}`
            : t('browserSafety.isolatedProfile');
    const profileTelemetryMeta = state?.engine_version ? `${profileBaseMeta} · ${state.engine_version}` : profileBaseMeta;
    const routeLabel = draft?.proxy ? draft.proxy : t('browserSafety.proxyManaged');
    const showTimestampPill = Boolean(state?.report_received_at || browserRuntime.status === 'running');
    const showHeroAlerts = Boolean(
        (!!state && !state.cli_expected_identity) ||
        (state?.identity?.status && !['linked', 'draft', 'warming'].includes(state.identity.status)) ||
        (state?.identity?.cli_proxy && !areCliAndBrowserProxiesAligned(draft?.proxy, state.identity.cli_proxy)),
    );
    function edit<K extends keyof BrowserConfig>(key: K, value: BrowserConfig[K]) { setDraft(old => old ? { ...old, [key]: value } : old); }
    return <section className="system-page browser-page">
        <header className="cleanup-title browser-header">
            <div><h1>{t("浏览环境")}</h1></div>
            <Button size="small" variant="secondary" disabled={!!busy} leftIcon={<Refresh size={15} aria-hidden="true" />} onClick={() => void act('browser_read')}>{t("刷新状态")}</Button>
        </header>
        {error && <p role="alert" className="system-feedback error">{t(error)}</p>}
        {killSwitch?.triggered && (
            <div className="identity-recovery browser-kill-switch-banner" role="alert" data-kill-switch-banner>
                <div>
                    <strong>{t('browser.killSwitch.bannerTitle')}</strong>
                    <p>
                        {killSwitch.reason_code === 'tun_dropped'
                            ? t('browser.killSwitch.reasonTunDropped')
                            : killSwitch.reason_code === 'country_drift'
                                ? t('browser.killSwitch.reasonCountryDrift', {
                                      expected: killSwitch.expected_country || '-',
                                      observed: killSwitch.observed_country || '-',
                                  })
                                : t('browser.killSwitch.reasonGeneric')}
                    </p>
                </div>
                <Button size="small" variant="secondary" data-kill-switch-dismiss disabled={killSwitchBusy} onClick={() => void dismissKillSwitch()}>
                    {t('browser.killSwitch.dismiss')}
                </Button>
            </div>
        )}
        {!!changed && <p className="system-hint">{t("先保存指纹设置，再启动浏览器或对齐机器。")}</p>}

        <div className="browser-sections">
            <section className="settings-card browser-hero-card">
                <div className="browser-hero-bar">
                    <div className="browser-hero-title-row">
                        <span className="settings-icon-badge" aria-hidden="true"><WindowBrowser size={16} /></span>
                        <h2>{t('browser.environmentTitle')}</h2>
                        <span data-browser-runtime={browserRuntime.status} className={`identity-policy-mode ${browserRuntime.status === 'running' ? 'ok' : ''}`}>
                            {t(`browser.runtime${browserRuntime.status === 'running' ? 'Running' : browserRuntime.status === 'closed' ? 'Closed' : 'Unknown'}`)}
                        </span>
                    </div>
                    <div className="browser-hero-actions">
                        <Button variant="secondary" size="small" disabled={disabled || !state?.engine_ready || !!changed} loading={busy === 'browser_launch'} onClick={() => void act('browser_launch')}>
                            {browserRuntime.status === 'running' ? t("重新打开实测页") : t("打开浏览器并实测")}
                        </Button>
                        {state?.running && (
                            <Button variant="secondary" size="small" disabled={disabled} loading={busy === 'browser_quit'} onClick={() => void act('browser_quit')}>
                                {t("正常退出浏览器")}
                            </Button>
                        )}
                        <Button variant="secondary" size="small" data-return-cli-browser disabled={disabled || !state?.engine_ready || !state?.cli_expected_identity || !!changed} onClick={() => {
                            if (state?.cli_expected_identity) setReturnCliBrowser({expectedIdentity: state.cli_expected_identity, name: cliIdentityName});
                        }}>{t('browser.returnToCli')}</Button>
                    </div>
                </div>
                <div className="env-telemetry-strip browser-telemetry-strip">
                    <div className="env-telemetry-cell" data-current-cli-identity>
                        <div className="env-telemetry-head">
                            <span className={`env-status-dot ${state?.cli_expected_identity ? 'is-ready' : state ? 'is-pending' : ''}`} aria-hidden="true" />
                            <span className="env-telemetry-label">{t('browser.telemetryCliLabel')}</span>
                        </div>
                        <strong title={t('browser.currentCliIdentity', {name: cliIdentityName})}>{cliIdentityName}</strong>
                        <small title={cliTelemetryMeta}>{cliTelemetryMeta}</small>
                    </div>
                    <div className="env-telemetry-cell" data-current-browser-identity>
                        <div className="env-telemetry-head">
                            <span className={`env-status-dot ${state?.identity?.status === 'warming' ? 'is-warming' : state?.identity?.status === 'linked' ? 'is-ready' : state?.identity?.status === 'mismatch' ? 'is-failed' : state ? 'is-pending' : ''}`} aria-hidden="true" />
                            <span className="env-telemetry-label">{t('browser.telemetryProfileLabel')}</span>
                        </div>
                        <strong title={t(state?.identity?.status === 'warming' ? 'browser.currentWarmingIdentity' : 'browser.currentBrowserIdentity', {name: browserIdentityName})}>{browserIdentityName}</strong>
                        <small title={profileTelemetryMeta}>{profileTelemetryMeta}</small>
                    </div>
                    <div className="env-telemetry-cell">
                        <div className="env-telemetry-head">
                            <span className={`env-status-dot ${killSwitch?.triggered ? 'is-failed' : (killSwitch?.enabled ?? true) ? 'is-ready' : 'is-pending'}`} aria-hidden="true" />
                            <span className="env-telemetry-label">{t('browser.telemetryRouteLabel')}</span>
                        </div>
                        <strong title={routeLabel}>{routeLabel}</strong>
                        <small>{t((killSwitch?.enabled ?? true) ? 'browser.killSwitchActive' : 'browser.killSwitchPaused')}</small>
                    </div>
                    <div className="env-telemetry-cell" data-browser-verification-scope>
                        <div className="env-telemetry-head">
                            <span className={`env-status-dot ${hasMismatch ? 'is-failed' : checksPassed ? 'is-ready' : isStale ? 'is-pending' : ''}`} aria-hidden="true" />
                            <span className="env-telemetry-label">{t('browser.telemetryScopeLabel')}</span>
                        </div>
                        <p className="env-telemetry-scope browser-scope-note" title={t('browser.verificationScope')}>{t('browser.verificationScope')}</p>
                    </div>
                </div>
                {showHeroAlerts && (
                    <div className="browser-hero-alerts">
                        {!!state && !state.cli_expected_identity && <p className="identity-policy-hint">{t('browser.cliIdentityUnavailable')}</p>}
                        {state?.identity?.status && !['linked', 'draft', 'warming'].includes(state.identity.status) && (
                            <p className="identity-policy-hint">
                                {t(`browserSafety.status_${state.identity.status}`)}
                            </p>
                        )}
                        {state?.identity?.cli_proxy && !areCliAndBrowserProxiesAligned(draft?.proxy, state.identity.cli_proxy) && (
                            <p className="identity-policy-hint">
                                {t("browserSafety.cliProxyMismatch", { cliProxy: state.identity.cli_proxy, browserProxy: (draft?.proxy || '').trim() || t("browserSafety.proxyManaged") })}{' '}
                                <Button variant="secondary" size="small" disabled={disabled} onClick={() => { edit('proxy', toBrowserSocks5ProxyFromCli(state?.identity?.cli_proxy)); setAdvancedOpen(true); }}>{t("browserSafety.syncCliProxy")}</Button>
                            </p>
                        )}
                    </div>
                )}
            </section>

            <div className="settings-group-heading">
                <span className="settings-group-bar" aria-hidden="true" />
                <h2>{t('browser.checksGroupTitle')}</h2>
            </div>

            <section className="settings-card browser-checks">
                <div className="browser-checks-head">
                    <div className="browser-checks-title-row">
                        <h2>{t('browser.observationTitle', {name: t(state?.region?.label || "自定义环境")})}</h2>
                        {checksPassed && (
                            <span className="identity-policy-mode ok">{t("检测通过")}</span>
                        )}
                        {showTimestampPill && (
                            <span className={`identity-policy-mode ${isStale ? 'attention' : checksPassed ? 'ok' : ''}`}>
                                {state?.report_received_at
                                    ? isStale
                                        ? t("browserSafety.reportStale", { v0: new Date(state.report_received_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') }) || `检测已过时（>10分钟）· 上次回报 ${new Date(state.report_received_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US')}`
                                        : (state.running && browserRuntime.status !== 'closed')
                                            ? t("已连接 · 回报 {v0}", { v0: new Date(state.report_received_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') })
                                            : t("browserSafety.reportRetained", { v0: new Date(state.report_received_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') })
                                    : t("等待浏览器回报")}
                            </span>
                        )}
                    </div>
                    <div className="browser-checks-actions">
                        <Button variant="secondary" size="small" disabled={disabled} loading={busy === 'browser_check'} onClick={() => void act('browser_check')}>{t("检测机器出口")}</Button>
                        <Button variant="secondary" size="small" disabled={disabled || state?.running || !!changed} onClick={() => setConfirm('align')}>{t("对齐美国系统环境")}</Button>
                    </div>
                </div>
                {showWarnSummary && (
                    <div className="browser-check-summary warn">
                        <span>
                            {isStale
                                ? t("browserSafety.staleSummary")
                                : t(hasMismatch ? "检测未通过" : "检测未完成")}
                        </span>
                    </div>
                )}
                {checks.length > 0 && (
                    <div className="browser-check-grid">
                        {checks.map(x => (
                            <div className={`browser-check check-${x.status}`} key={x.id}>
                                <span aria-label={t(x.status === 'ok' ? "已核验" : x.status === 'mismatch' ? "存在冲突" : "尚未核验")}>
                                    {x.status === 'ok' ? '✓' : x.status === 'mismatch' ? '!' : '—'}
                                </span>
                                <div className="browser-check-copy">
                                    <strong>{t(x.title)}</strong>
                                    <p title={t(x.detail)}>{t(x.detail)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {state?.report?.error && <p className="system-feedback error browser-report-error">{t("浏览器出口检测：")}{t(state.report.error)}</p>}
            </section>

            <div className="settings-group-heading">
                <span className="settings-group-bar" aria-hidden="true" />
                <h2>{t('browser.dataGroupTitle')}</h2>
            </div>

            <section className="settings-card browser-data-card">
                {state?.running && (
                    <div className="browser-data-notice">
                        <span>{t("browserSafety.closeBeforeClean")}</span>
                    </div>
                )}
                <div className="browser-data-scenarios">
                    <div className="browser-scenario-card">
                        <span className="settings-icon-badge" aria-hidden="true"><EraserDefault size={16} /></span>
                        <div className="browser-scenario-copy">
                            <div className="browser-scenario-head">
                                <strong>{t("日常释放缓存")}</strong>
                                <span className="identity-policy-mode ok">{formatBytes(cache.reduce((sum, x) => sum + x.bytes, 0))}</span>
                            </div>
                            <p className="browser-scenario-desc">{t("安全清理网页图片与脚本缓存，保留 Claude 登录状态、书签与密码（需先关闭浏览器）。")}</p>
                        </div>
                        <Button variant="secondary" size="small" disabled={disabled || state?.running || !cache.length || !!state?.cache_error} loading={busy === 'browser_clear'} onClick={() => void act('browser_clear', { includeSiteData: false })}>{t("一键清理缓存")}</Button>
                    </div>
                    <div className="browser-scenario-card">
                        <span className="settings-icon-badge" aria-hidden="true"><Refresh size={16} /></span>
                        <div className="browser-scenario-copy">
                            <div className="browser-scenario-head">
                                <strong>{t("深度重置当前浏览器")}</strong>
                            </div>
                            <p className="browser-scenario-desc">{t("仅在当前身份网页出现异常风控时使用；将清空当前身份的 Cookie、登录状态与扩展，不影响其他身份。")}</p>
                        </div>
                        <Button variant="secondary" size="small" disabled={disabled || state?.running} loading={busy === 'browser_reset'} onClick={() => { setAccepted(false); setConfirm('reset'); }}>{t("全清理")}</Button>
                    </div>
                </div>
                {state?.cache_error && <p role="alert" className="browser-cache-error">{t(state.cache_error)}</p>}
                <Disclosure className="browser-cache-details" triggerClassName="browser-cache-trigger" summary={`${t("查看底层缓存目录明细")} (${cache.length})`}>
                    <div className="browser-cache">{state?.cache.length ? state.cache.map(x => <div key={x.path}><span>{x.path}</span><small>{x.login ? t("站点数据") : formatBytes(x.bytes)}</small></div>) : <p className="browser-cache-empty">{t("未发现缓存项目。")}</p>}</div>
                </Disclosure>
            </section>

            <Disclosure className="identity-policy browser-advanced-panel" triggerClassName="identity-policy-trigger" open={advancedOpen || !!changed} onOpenChange={setAdvancedOpen}
                summary={<strong>{t("browserSafety.settingsTitle")}</strong>}
                aside={<span className="identity-policy-mode ok">{draft?.proxy ? draft.proxy : t("browserSafety.proxyManaged")}</span>}>
                <div className="browser-advanced-body">
                    <div className="browser-advanced-grid">
                        <div>
                            <label htmlFor="fingerprint-seed">{t("稳定指纹种子")}</label>
                            <Input id="fingerprint-seed" type="number" min={1} max={4294967295} value={draft?.seed ?? ''} disabled={disabled || state?.running} onChange={e => edit('seed', Number(e.currentTarget.value))} />
                            <p className="system-hint">{t("browserSafety.seedHint")}</p>
                        </div>
                        <div>
                            <label htmlFor="browser-proxy">{t("浏览器代理")}</label>
                            <Input id="browser-proxy" placeholder="http://127.0.0.1:7897" value={draft?.proxy || ''} disabled={disabled || state?.running} onChange={e => edit('proxy', e.currentTarget.value)} />
                            <p className="system-hint">{t("留空使用 TUN；指定代理须含端口。")}</p>
                        </div>
                    </div>
                    {!draft?.follow_machine && (
                        <div className="browser-advanced-grid">
                            <div>
                                <label>{t("网页语言")}</label>
                                <Select aria-label={t("浏览器语言")} value={draft?.language} disabled={disabled || state?.running} onValueChange={v => { if (v) edit('language', v); }} items={['en-US', 'en-CA', 'en-GB', 'en-SG', 'en-AU', 'en', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'es', 'it', 'ja', 'ko'].map(v => ({ value: v, label: v }))} />
                            </div>
                            <div>
                                <label>{t("网页时区")}</label>
                                <Select aria-label={t("浏览器时区")} value={draft?.timezone} disabled={disabled || state?.running} onValueChange={v => { if (v) edit('timezone', v); }} items={(state?.machine.timezones || []).map(v => ({ value: v, label: v }))} />
                            </div>
                        </div>
                    )}
                    <div className="browser-advanced-footer">
                        <div className="browser-advanced-toggles">
                            <label className="browser-toggle"><Checkbox checked={draft?.follow_machine || false} disabled={disabled || state?.running} onCheckedChange={v => edit('follow_machine', v === true)} />{t("语言与时区跟随机器")}</label>
                            <label className="browser-toggle"><Checkbox checked={draft?.native_graphics || false} disabled={disabled || state?.running} onCheckedChange={v => edit('native_graphics', v === true)} />{t("使用真实设备指纹")}</label>
                            <label className="browser-toggle" data-kill-switch-toggle><Checkbox checked={killSwitch?.enabled ?? true} disabled={disabled || killSwitchBusy} onCheckedChange={v => void toggleKillSwitch(v === true)} />{t('browser.killSwitch.toggleLabel')}</label>
                        </div>
                        <div className="system-card-actions">
                            <Button variant="secondary" size="small" disabled={disabled || state?.running || !changed} loading={busy === 'browser_save'} onClick={() => draft && void act('browser_save', { config: draft })}>{t("保存设置")}</Button>
                        </div>
                    </div>
                </div>
            </Disclosure>
        </div>

        <CleanupActivity activity={activity.state} />
        <AppDialog alert open={!!returnCliBrowser} onOpenChange={open => {if (!open && !busy) setReturnCliBrowser(null);}}
            title={t('browser.returnToCliConfirmTitle')} description={t('browser.returnToCliConfirm')}
            footer={<><Button variant="secondary" data-dialog-cancel disabled={!!busy} onClick={() => setReturnCliBrowser(null)}>{t('取消')}</Button><Button variant="secondary" data-return-cli-claude disabled={!!busy || !returnCliBrowser} onClick={() => {
                if (!returnCliBrowser) return;
                const target = returnCliBrowser;
                setReturnCliBrowser(null);
                void act('browser_return_to_cli', {expectedIdentity: target.expectedIdentity, openMode: 'claude_ai'});
            }}>{t('browser.enterClaudeAi')}</Button><Button variant="secondary" data-return-cli-confirm disabled={!!busy || !returnCliBrowser} onClick={() => {
                if (!returnCliBrowser) return;
                const target = returnCliBrowser;
                setReturnCliBrowser(null);
                void act('browser_return_to_cli', {expectedIdentity: target.expectedIdentity});
            }}>{t('browser.returnToCli')}</Button></>}>
            <div className="identity-confirm" data-return-cli-dialog><strong>{returnCliBrowser?.name}</strong><p>{t('browser.verificationScope')}</p></div>
        </AppDialog>
        <AppDialog alert={confirm === 'reset'} className={confirm === 'reset' ? 'identity-delete-alert' : undefined} open={confirm !== null} onOpenChange={v => { if (!v) { setConfirm(null); setAccepted(false); } }} title={confirm === 'reset' ? t("全清理浏览器") : t("对齐美国系统环境")} description={confirm === 'reset' ? t("永久删除当前身份的全部本地浏览器资料，不创建备份。") : t("先核验代理实际在美国，再将机器时区设为出口时区、首选语言设为 en-US、区域设为 en_US，并关闭系统定位。时区可能需要管理员授权。")} footer={<><Button variant="secondary" data-dialog-cancel onClick={() => { setConfirm(null); setAccepted(false); }}>{t("取消")}</Button><Button className={confirm === 'reset' ? 'identity-delete-button' : undefined} variant="secondary" disabled={!!busy || (confirm === 'reset' && !accepted)} onClick={() => { const action = confirm; if (action === 'reset' && !accepted) return; setConfirm(null); setAccepted(false); void act(action === 'reset' ? 'browser_clear' : 'browser_align', action === 'reset' ? { includeSiteData: true, resetProfile: true } : {}); }}>{confirm === 'reset' ? t("确认全清理") : t("检测并应用")}</Button></>}>
            {confirm === 'reset' ? <div className="identity-confirm"><div className="identity-delete-warning"><span aria-hidden="true">!</span><strong>{t("警告：此操作不可撤销，不会创建新备份。")}</strong></div><p>{t("登录状态、密码与密钥、书签、历史、扩展、设置和缓存将全部移除。")}</p><p>{t("其他身份的浏览器资料和身份保险库不受影响。")}</p><Checkbox checked={accepted} onCheckedChange={value => setAccepted(value === true)} label={t("我知道此操作无法撤销")} /></div> : <p>{t("不会修改代理节点。若机器与浏览器出口不同，需在代理工具中统一系统路由。更改系统语言后，部分应用需重新启动或注销。")}</p>}
        </AppDialog>
    </section>;
}
