/**
 * [INPUT]: Cromma UI、原生浏览器命令、带回报时间的真实观测事件、共用地区契约与共享活动日志和 YAML 文案。
 * [OUTPUT]: 按部就班三步式浏览器环境控制台（01 启动与默认浏览器授权、02 目标地区环境核验与一键对齐、03 日常释放缓存与排障重置）及默认折叠的指纹与代理高级设置。
 * [POS]: 浏览器交互边界；只展示配置、操作与真实观测，页面加载只读，系统对齐和登录删除必须由用户选择；全清理使用默认取消且需勾选确认的 AlertDialog，不新增备份，不影响其他身份资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Button, Input, Select, Checkbox, Disclosure } from 'cromma-ui';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AppDialog } from './dialog';
import { CleanupActivity, useCleanupActivity } from './cleaner-activity';
import type { BrowserConfig, BrowserState, DefaultBrowser } from './browser-model';
import { formatBytes } from './cleaner-model';

export function BrowserPanel({ onBusy }: {
    onBusy?: (busy: boolean) => void;
}) {
    const { t, locale } = useI18n();
    const [state, setState] = useState<BrowserState | null>(null), [draft, setDraft] = useState<BrowserConfig | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [confirm, setConfirm] = useState<'reset' | 'align' | null>(null);
    const gate = useRef(false), live = useRef(true);
    const [accepted, setAccepted] = useState(false), [advancedOpen, setAdvancedOpen] = useState(false);
    const activity = useCleanupActivity();
    const [preferred, setPreferred] = useState<DefaultBrowser | null>(null), [asking, setAsking] = useState(false), [defaultNote, setDefaultNote] = useState('');
    useEffect(() => { onBusy?.(!!busy); return () => onBusy?.(false); }, [busy, onBusy]);
    async function readDefault() {
        try {
            const next = await invoke<DefaultBrowser>('browser_default_read');
            if (live.current)
                setPreferred(next);
            return next;
        }
        catch (e) {
            if (live.current)
                setDefaultNote(String(e));
            return null;
        }
    }
    async function makeDefault() {
        setAsking(true); setDefaultNote('');
        try {
            const next = await invoke<DefaultBrowser>('browser_set_default');
            setPreferred(next);
            setDefaultNote(next.is_default ? "Claude-Local Browser已是默认浏览器。" : "已向系统请求设为默认浏览器，请检查系统确认。");
            for (let i = 0; i < 20 && live.current; i++) {
                await new Promise(r => setTimeout(r, 1500));
                const fresh = await readDefault();
                if (fresh?.is_default) {
                    setDefaultNote("Claude-Local Browser已设为默认浏览器。");
                    break;
                }
            }
        }
        catch (e) {
            setDefaultNote(String(e));
        }
        finally {
            if (live.current)
                setAsking(false);
        }
    }
    async function read(initial = false) {
        const next = await invoke<BrowserState>('browser_read');
        if (live.current) {
            setState(next);
            if (initial)
                setDraft(next.config);
        }
        return next;
    }
    useEffect(() => {
        live.current = true;
        void read(true).catch(e => setError(String(e)));
        void readDefault();
        const event = listen('browser-report', () => {
            if (!gate.current)
                void read().catch(e => setError(String(e)));
        });
        const focus = () => {
            void readDefault();
            if (!gate.current)
                void read().catch(e => setError(String(e)));
        };
        window.addEventListener('focus', focus);
        return () => {
            live.current = false;
            window.removeEventListener('focus', focus);
            void event.then(f => f());
        };
    }, []);
    async function act(command: string, args: Record<string, unknown> = {}) {
        if (gate.current)
            return;
        gate.current = true;
        setBusy(command === 'browser_clear' && args.resetProfile ? 'browser_reset' : command);
        setError('');
        const onProgress = activity.start('browser');
        try {
            const next = await invoke<BrowserState>(command, { ...args, ...(['browser_launch', 'browser_clear', 'browser_align'].includes(command) ? { onProgress } : {}) });
            setState(next);
            if (command === 'browser_save' || command === 'browser_align')
                setDraft(next.config);
            activity.finish(true, command === 'browser_clear' ? (args.resetProfile ? "当前身份的浏览器资料已全清理，未保留副本。" : "清理完成，未保留副本。") : command === 'browser_check' ? "机器出口已检测；浏览器结果由实测页上报。" : "操作完成。");
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
    function edit<K extends keyof BrowserConfig>(key: K, value: BrowserConfig[K]) { setDraft(old => old ? { ...old, [key]: value } : old); }
    return <section className="system-page browser-page">
        <div className="cleanup-title">
            <div><h1>{t("浏览环境")}</h1></div>
            <Button size="small" variant="secondary" disabled={!!busy} onClick={() => void act('browser_read')}>{t("刷新状态")}</Button>
        </div>
        {defaultNote && <p className="system-feedback" role="status">{t(defaultNote)}</p>}
        {error && <p role="alert" className="system-feedback error">{t(error)}</p>}
        {!!changed && <p className="system-hint">{t("先保存指纹设置，再启动浏览器或对齐机器。")}</p>}

        <div className="browser-sections">
            <div className="network-action-card browser-hero-card">
                <div className="network-action-row">
                    <div className="network-action-main">
                        <div className="network-action-head">
                            <h2>{t("启动内置浏览器与 CLI 授权联动")}</h2>
                            <span className={`identity-policy-mode ${state?.running ? 'ok' : ''}`}>
                                {state?.running ? t("运行中") : t("未运行")}
                            </span>
                        </div>
                        <p className="network-action-desc">
                            {t("当前身份已自动绑定专属浏览器存档与防关联指纹。打开浏览器（通过全部环境验证后）登录已充值的 Claude 网页版账号，设为默认浏览器后进入 Claude Code CLI 即可自动 Login。")}
                        </p>
                    </div>
                    <div className="network-action-buttons">
                        <Button variant="ink" size="small" disabled={disabled || !state?.engine_ready || !!changed} loading={busy === 'browser_launch'} onClick={() => void act('browser_launch')}>
                            {state?.running ? t("重新打开实测页") : t("打开浏览器并实测")}
                        </Button>
                        {state?.running && (
                            <Button variant="secondary" size="small" disabled={disabled || !state?.running} loading={busy === 'browser_quit'} onClick={() => void act('browser_quit')}>
                                {t("正常退出浏览器")}
                            </Button>
                        )}
                        <Button variant="secondary" size="small" disabled={!!busy || asking || !preferred?.installed || preferred?.is_default} loading={asking} onClick={() => void makeDefault()}>
                            {preferred?.is_default ? t("已是默认浏览器") : t("设为默认浏览器")}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="browser-checks">
                <div className="browser-checks-head">
                    <div className="network-action-head">
                        <h2>{t("{v0} · 实际观测", { v0: t(state?.region?.label || "自定义环境") })}</h2>
                        <span className="identity-policy-mode">
                            {state?.report_received_at ? t("已连接 · 回报 {v0}", { v0: new Date(state.report_received_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') }) : state?.running ? t("等待浏览器回报") : t("浏览器未运行")}
                        </span>
                    </div>
                    <div className="network-action-buttons">
                        <Button variant="secondary" size="small" disabled={disabled} loading={busy === 'browser_check'} onClick={() => void act('browser_check')}>{t("检测机器出口")}</Button>
                        <Button variant="secondary" size="small" disabled={disabled || state?.running || !!changed} onClick={() => setConfirm('align')}>{t("对齐美国系统环境")}</Button>
                    </div>
                </div>
                <div className={`browser-check-summary ${allChecksOk ? 'ok' : hasMismatch ? 'warn' : ''}`}>
                    <span>
                        {allChecksOk
                            ? t("全部验证已通过：出口 IP、时区与语言均已对齐目标地区，可直接在内置浏览器登录已充值的 Claude 网页版账号。")
                            : hasMismatch
                                ? t("检测到环境项未对齐：建议点击右上角「对齐美国系统环境」一键同步本机时区与语言，或检查代理路由。")
                                : t("点击上方「打开浏览器并实测」，浏览器启动后将自动核验美国出口 IP、时区与语言是否全部达标。")}
                    </span>
                </div>
                <div className="browser-check-grid">
                    {checks.map(x => (
                        <div className={`browser-check check-${x.status}`} key={t(x.title)}>
                            <span aria-label={t(x.status === 'ok' ? "已核验" : x.status === 'mismatch' ? "存在冲突" : "尚未核验")}>
                                {x.status === 'ok' ? '✓' : x.status === 'mismatch' ? '!' : '—'}
                            </span>
                            <div>
                                <strong>{t(x.title)}</strong>
                                <p>{t(x.detail)}</p>
                            </div>
                        </div>
                    ))}
                </div>
                {state?.report?.error && <p className="system-feedback error">{t("浏览器出口检测：")}{t(state.report.error)}</p>}
            </div>

            <div className="network-action-card">
                <div className="network-action-head">
                    <h2>{t("浏览器数据")}</h2>
                    <span className="identity-policy-mode ok">{t("按身份自动隔离")}</span>
                </div>
                <div className="browser-data-scenarios">
                    <div className="browser-scenario-card">
                        <div className="browser-scenario-copy">
                            <div className="browser-scenario-head">
                                <strong>{t("日常释放缓存")}</strong>
                                <span className="identity-policy-mode ok">{formatBytes(cache.reduce((sum, x) => sum + x.bytes, 0))}</span>
                            </div>
                            <p>{t("安全清理网页图片与脚本缓存，保留 Claude 登录状态、书签与密码（需先关闭浏览器）。")}</p>
                        </div>
                        <Button variant="ink" size="small" disabled={disabled || state?.running || !cache.length || !!state?.cache_error} loading={busy === 'browser_clear'} onClick={() => void act('browser_clear', { includeSiteData: false })}>{t("一键清理缓存")}</Button>
                    </div>
                    <div className="browser-scenario-card">
                        <div className="browser-scenario-copy">
                            <div className="browser-scenario-head">
                                <strong>{t("深度重置当前浏览器")}</strong>
                                <span className="identity-policy-mode">{t("仅排障使用")}</span>
                            </div>
                            <p>{t("仅在当前身份网页出现异常风控时使用；将清空当前身份的 Cookie、登录状态与扩展，不影响其他身份。")}</p>
                        </div>
                        <Button variant="secondary" size="small" disabled={disabled || state?.running} loading={busy === 'browser_reset'} onClick={() => { setAccepted(false); setConfirm('reset'); }}>{t("全清理")}</Button>
                    </div>
                </div>
                {state?.cache_error && <p role="alert">{t(state.cache_error)}</p>}
                <Disclosure className="browser-cache-details" triggerClassName="browser-cache-trigger" summary={`${t("查看底层缓存目录明细")} (${cache.length})`}>
                    <div className="browser-cache">{state?.cache.length ? state.cache.map(x => <div key={x.path}><span>{x.path}</span><small>{x.login ? t("站点数据") : formatBytes(x.bytes)}</small></div>) : <p>{t("未发现缓存项目。")}</p>}</div>
                </Disclosure>
            </div>

            <Disclosure className="identity-policy browser-advanced-panel" triggerClassName="identity-policy-trigger" open={advancedOpen || !!changed} onOpenChange={setAdvancedOpen}
                summary={<><strong>{t("指纹与代理设置")}</strong><span className="identity-policy-hint">{t("已按身份自动生成稳定指纹并跟随 TUN 路由，日常无需手动改动")}</span></>}
                aside={<span className="identity-policy-mode ok">{draft?.proxy ? draft.proxy : t("自动托管")}</span>}>
                <div className="browser-advanced-body">
                    <div className="browser-advanced-grid">
                        <div>
                            <label htmlFor="fingerprint-seed">{t("稳定指纹种子")}</label>
                            <Input id="fingerprint-seed" type="number" min={1} max={4294967295} value={draft?.seed ?? ''} disabled={disabled || state?.running} onChange={e => edit('seed', Number(e.currentTarget.value))} />
                        </div>
                        <div>
                            <label htmlFor="browser-proxy">{t("浏览器代理")}</label>
                            <Input id="browser-proxy" placeholder="http://127.0.0.1:7897" value={draft?.proxy || ''} disabled={disabled || state?.running} onChange={e => edit('proxy', e.currentTarget.value)} />
                            <p className="system-hint">{t("留空使用 TUN；指定代理须含端口。")}</p>
                        </div>
                    </div>
                    <div className="browser-advanced-toggles">
                        <label className="browser-toggle"><Checkbox checked={draft?.follow_machine || false} disabled={disabled || state?.running} onCheckedChange={v => edit('follow_machine', v === true)} />{t("语言与时区跟随机器")}</label>
                        <label className="browser-toggle"><Checkbox checked={draft?.native_graphics || false} disabled={disabled || state?.running} onCheckedChange={v => edit('native_graphics', v === true)} />{t("使用真实设备指纹")}</label>
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
                    <div className="system-card-actions">
                        <Button variant="ink" size="small" disabled={disabled || state?.running || !changed} loading={busy === 'browser_save'} onClick={() => draft && void act('browser_save', { config: draft })}>{t("保存设置")}</Button>
                    </div>
                </div>
            </Disclosure>
        </div>

        <CleanupActivity activity={activity.state} />
        <AppDialog alert={confirm === 'reset'} className={confirm === 'reset' ? 'identity-delete-alert' : undefined} open={confirm !== null} onOpenChange={v => { if (!v) { setConfirm(null); setAccepted(false); } }} title={confirm === 'reset' ? t("全清理浏览器") : t("对齐美国系统环境")} description={confirm === 'reset' ? t("永久删除当前身份的全部本地浏览器资料，不创建备份。") : t("先核验代理实际在美国，再将机器时区设为出口时区、首选语言设为 en-US、区域设为 en_US，并关闭系统定位。时区可能需要管理员授权。")} footer={<><Button variant="secondary" data-dialog-cancel onClick={() => { setConfirm(null); setAccepted(false); }}>{t("取消")}</Button><Button className={confirm === 'reset' ? 'identity-delete-button' : undefined} variant="ink" disabled={!!busy || (confirm === 'reset' && !accepted)} onClick={() => { const action = confirm; if (action === 'reset' && !accepted) return; setConfirm(null); setAccepted(false); void act(action === 'reset' ? 'browser_clear' : 'browser_align', action === 'reset' ? { includeSiteData: true, resetProfile: true } : {}); }}>{confirm === 'reset' ? t("确认全清理") : t("检测并应用")}</Button></>}>
            {confirm === 'reset' ? <div className="identity-confirm"><div className="identity-delete-warning"><span aria-hidden="true">!</span><strong>{t("警告：此操作不可撤销，不会创建新备份。")}</strong></div><p>{t("登录状态、密码与密钥、书签、历史、扩展、设置和缓存将全部移除。")}</p><p>{t("其他身份的浏览器资料和身份保险库不受影响。")}</p><Checkbox checked={accepted} onCheckedChange={value => setAccepted(value === true)} label={t("我知道此操作无法撤销")} /></div> : <p>{t("不会修改代理节点。若机器与浏览器出口不同，需在代理工具中统一系统路由。更改系统语言后，部分应用需重新启动或注销。")}</p>}
        </AppDialog>
    </section>;
}
