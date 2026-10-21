/**
 * [INPUT]: 原生身份命令、保留策略、离线 5h/7d 额度与重置时间戳、订阅到期摘要、经 Cromma 入口的 Motion 弹簧与根级减弱动效（系统设置或「减少动画」偏好）、settings-model 视图偏好、共享确认窗/进度、文件残留与 CLI 维护。
 * [OUTPUT]: 180×286 身份工牌统一以本地保存名为单行主标题，原账号名仅在非隐私提示中保留；同字体双额度/重置时间/订阅信息、最优账号切换及原有确认与真实操作进度。
 * [POS]: 身份管理 GUI；只呈现脱敏元数据与离线额度，身份正文留在原生保险库；可选浏览器绑定/旧资料采用确认与重开重试，关联浏览器资料删除单独选择。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Button, Checkbox, Disclosure, Input, useReducedMotionConfig, useSpring} from 'cromma-ui';
import {ShieldCheck, Refresh} from 'cromma-ui/pika';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {IdentityOperationProgress, useCleanupActivity} from './cleaner-activity';
import {formatBytes} from './cleaner-model';
import {ClaudeCliPanel} from './claude-cli-panel';
import {ClaudeResiduePanel} from './claude-residue-panel';
import {defaultPolicy, policyRows, type Identity, type IdentityState} from './identity-model';
import {maskEmailAddress, usePreferences} from './settings-model';

type Target = Identity | 'empty' | 'recovery';
type QuotaInput = {quota_5h_used?: number | null; quota_5h_reset_at?: number | null; quota_7d_used?: number | null; quota_7d_reset_at?: number | null};

function authBadgeLabel(status: string | null | undefined, t: (key: string) => string) {
  if (status === 'valid') return t('凭据有效');
  if (status === 'refresh_needed') return t('待自动续期');
  if (status === 'expired') return t('需重登');
  if (status === 'api_key') return t('API 密钥');
  return null;
}
function formatCompactEta(resetSec: number | null | undefined, nowSec: number) {
  if (!resetSec || resetSec <= nowSec) return '';
  const mins = Math.max(1, Math.floor((resetSec - nowSec) / 60));
  const d = Math.floor(mins / 1440),
    h = Math.floor((mins % 1440) / 60),
    m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function formatResetClock(resetSec: number | null | undefined, includeDate: boolean) {
  if (!resetSec) return '';
  const dt = new Date(resetSec * 1000);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  if (!includeDate) return `${hh}:${mm}`;
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${mo}-${da} ${hh}:${mm}`;
}
function evaluateQuota(item: QuotaInput | null | undefined, nowSec: number) {
  if (!item || (item.quota_5h_used == null && item.quota_7d_used == null)) return null;
  let r7 = item.quota_7d_reset_at ?? null;
  let used7d = item.quota_7d_used ?? 0;
  if (r7 && nowSec >= r7) {
    while (nowSec >= r7) r7 += 7 * 86400;
    used7d = 0;
  }
  const rem7d = Math.max(0, 100 - used7d);
  const expired5h = item.quota_5h_reset_at != null && nowSec >= item.quota_5h_reset_at;
  const r5 = !expired5h && item.quota_5h_reset_at ? item.quota_5h_reset_at : null;
  const used5h = expired5h ? 0 : (item.quota_5h_used ?? 0);
  const rem5h = rem7d === 0 ? 0 : Math.max(0, 100 - used5h);
  const effectiveRem = Math.min(rem5h, rem7d);
  const level: 'ok' | 'warn' | 'empty' = effectiveRem === 0 ? 'empty' : effectiveRem <= 20 ? 'warn' : 'ok';
  const level5h: 'ok' | 'warn' | 'empty' = rem5h === 0 ? 'empty' : rem5h <= 20 ? 'warn' : 'ok';
  const level7d: 'ok' | 'warn' | 'empty' = rem7d === 0 ? 'empty' : rem7d <= 20 ? 'warn' : 'ok';
  const eta5h = formatCompactEta(r5, nowSec);
  const eta7d = formatCompactEta(r7, nowSec);
  const clock5h = formatResetClock(r5, false);
  const clock7d = formatResetClock(r7, true);
  const primaryEta = rem7d === 0 ? eta7d : eta5h && eta7d ? `${eta5h}/${eta7d}` : eta5h || eta7d;
  const badge = `5h ${rem5h}% · 7d ${rem7d}%${primaryEta ? ` (${primaryEta})` : ''}`;
  const detail = `5h: ${rem5h}%${eta5h ? ` (${eta5h} · ${clock5h})` : ''} | 7d: ${rem7d}%${eta7d ? ` (${eta7d} · ${clock7d})` : ''}`;
  return {rem5h, rem7d, effectiveRem, level, level5h, level7d, primaryEta, badge, detail, used5h, used7d, r5, r7, expired5h, known5h: item.quota_5h_used != null || expired5h, known7d: item.quota_7d_used != null || (!!item.quota_7d_reset_at && nowSec >= item.quota_7d_reset_at)};
}

function QuotaWindow({label, used, remaining, resetAt, resetComplete = false, known, level, display, nowSec, t}: {label: string; used: number; remaining: number; resetAt: number | null; resetComplete?: boolean; known: boolean; level: string; display: 'remaining' | 'used'; nowSec: number; t: (key: string) => string}) {
  const value = display === 'used' ? used : remaining;
  const reset = resetAt ? formatResetClock(resetAt, label === '7d') : '';
  const countdown = formatCompactEta(resetAt, nowSec);
  const resetLabel = reset ? `${t('identityCard.reset')} ${reset}` : resetComplete ? t('identityCard.resetComplete') : t('identityCard.resetUnavailable');
  const resetDate = resetAt == null ? null : new Date(resetAt * 1000);
  const resetDateTime = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;
  return (
    <div className={`identity-quota-window ${known ? `quota-${level}` : 'quota-unknown'}`} data-quota-window={label} aria-label={`${label} ${known ? `${t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')} ${Math.round(value)}%` : t('identityCard.quotaUnknown')}`}>
      <div className="identity-quota-copy">
        <strong>{label}</strong>
        <span className="identity-quota-value">{known ? <><span>{t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')}</span>{' '}<strong>{Math.round(value)}%</strong></> : t('identityCard.unknown')}</span>
      </div>
      <span className="identity-quota-track" role="img" aria-label={known ? `${Math.round(value)}%` : t('identityCard.quotaUnknown')}>
        {known && <i style={{width: `${Math.max(0, Math.min(100, value))}%`}} />}
      </span>
      <span className="identity-quota-reset" title={countdown ? `${resetLabel} · ${countdown}` : resetLabel}>
        <span className="identity-quota-reset-label">{reset ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><path d="M8 4.5V8l2.2 1.4" /></svg><time className="identity-reset-time" dateTime={resetDateTime} aria-label={resetLabel}>{reset}</time></> : resetLabel}</span>
        {countdown && <span className="identity-quota-countdown">{countdown}</span>}
      </span>
    </div>
  );
}

function IdentityQuota({quota, display, nowSec, t}: {quota: ReturnType<typeof evaluateQuota>; display: 'remaining' | 'used'; nowSec: number; t: (key: string) => string}) {
  return (
    <div className="identity-quota-stack" data-identity-quota>
      <QuotaWindow label="5h" used={quota?.used5h ?? 0} remaining={quota?.rem5h ?? 0} resetAt={quota?.r5 ?? null} resetComplete={quota?.expired5h} known={quota?.known5h ?? false} level={quota?.level5h ?? 'ok'} display={display} nowSec={nowSec} t={t} />
      <QuotaWindow label="7d" used={quota?.used7d ?? 0} remaining={quota?.rem7d ?? 0} resetAt={quota?.r7 ?? null} known={quota?.known7d ?? false} level={quota?.level7d ?? 'ok'} display={display} nowSec={nowSec} t={t} />
    </div>
  );
}

function SubscriptionExpiry({expiresAt, locale, t}: {expiresAt?: number | null; locale: string; t: (key: string) => string}) {
  const value = expiresAt == null ? t('identityCard.notProvided') : new Date(expiresAt * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'});
  return <div className="identity-subscription" data-subscription-expiry={expiresAt ?? 'unknown'} title={expiresAt == null ? t('identityCard.subscriptionSourceMissing') : undefined}><strong>{t('identityCard.subscriptionExpiry')}</strong><span>{value}</span></div>;
}

function IdentityName({name, accountName, privacyMask, saved = false, t}: {name: string; accountName?: string | null; privacyMask: boolean; saved?: boolean; t: (key: string) => string}) {
  const description = !privacyMask && accountName && accountName !== name ? `${t('identityCard.accountName')}: ${accountName}` : undefined;
  return <h3 className="identity-name-with-label" data-identity-name data-identity-username={!saved || undefined} data-identity-saved-name={saved || undefined} aria-description={description}><strong title={description ? `${name}\n${description}` : name}>{name}</strong></h3>;
}

export function IdentityPanel({onBusy, initialEmpty = false}: {onBusy?: (busy: boolean) => void; initialEmpty?: boolean}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const [state, setState] = useState<IdentityState | null>(null);
  const [policy, setPolicy] = useState({...defaultPolicy});
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [cliBusy, setCliBusy] = useState(false);
  const [residueBusy, setResidueBusy] = useState(false),
    [residueRevision, setResidueRevision] = useState(0);
  const [error, setError] = useState('');
  const [browserReview, setBrowserReview] = useState<boolean | null>(null),
    [useExisting, setUseExisting] = useState(false);
  const [review, setReview] = useState<Target | null>(initialEmpty ? 'empty' : null);
  const [snapshot, setSnapshot] = useState(false);
  const [name, setName] = useState(t('当前身份'));
  const [rename, setRename] = useState<Identity | null>(null),
    [renameValue, setRenameValue] = useState('');
  const [deleteBrowser, setDeleteBrowser] = useState(false);
  const [deletion, setDeletion] = useState<Identity | 'current' | null>(null),
    [accepted, setAccepted] = useState(false);
  const activity = useCleanupActivity();
  const rail = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotionConfig() ?? false;
  const scrollSpring = useSpring(0, {stiffness: 170, damping: 25, mass: 0.8});
  const scrollTarget = useRef(0);
  const locked = busy || cliBusy || residueBusy || !!review || snapshot || !!rename || !!deletion || browserReview !== null;
  const active = state?.records.find(row => row.id === state.active);
  const current = state?.current;
  const saved = state?.records.filter(row => !current?.present || row.id !== state.active) ?? [];
  const currentName = active?.name || current?.display_name || current?.email?.split('@')[0] || t('当前身份');
  const blocked = locked || loading || !state || !!state?.recovery;
  const kept = policyRows.filter(([key]) => policy[key]).map(([, label]) => t(label));
  const removed = policyRows.filter(([key]) => !policy[key]).map(([, label]) => t(label));
  const isDefaultPolicy = policyRows.every(([key]) => policy[key] === defaultPolicy[key]);
  const nowSec = Math.floor(Date.now() / 1000);
  const currentQuota = evaluateQuota(current, nowSec);
  const targetSummary = typeof review === 'object' && review ? state?.summaries?.[review.id] : undefined;
  const targetQuota = evaluateQuota(targetSummary, nowSec);
  const proxyChanged = typeof review === 'object' && review && (current?.proxy || null) !== (targetSummary?.proxy || null);
  const bestSaved = saved.reduce<{row: Identity; effectiveRem: number} | null>((best, row) => {
    const sum = state?.summaries?.[row.id];
    if (sum?.auth_status === 'expired') return best;
    const q = evaluateQuota(sum, nowSec);
    if (!q || q.effectiveRem <= 0) return best;
    if (!best || q.effectiveRem > best.effectiveRem) return {row, effectiveRem: q.effectiveRem};
    return best;
  }, null);
  const recommendSaved = bestSaved && (!current?.present || (currentQuota && bestSaved.effectiveRem > currentQuota.effectiveRem)) ? bestSaved : null;
  const totalIdentities = (current?.present ? 1 : 0) + saved.length;

  useEffect(() => {
    void read();
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined' && 'identityFixture' in window) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !locked && !loading) void read(false);
    }, 3600000);
    return () => window.clearInterval(timer);
  }, [locked, loading]);
  // ----- 用原生 scrollLeft 保留滚动条/键盘；Motion 仅提供滚轮弹簧 -----
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const maximum = () => Math.max(0, element.scrollWidth - element.clientWidth);
    if (reduceMotion) {
      scrollTarget.current = element.scrollLeft;
      scrollSpring.jump(element.scrollLeft);
    }
    const unsubscribe = scrollSpring.on('change', value => {
      element.scrollLeft = Math.max(0, Math.min(maximum(), value));
    });
    function interrupt() {
      scrollTarget.current = element!.scrollLeft;
      scrollSpring.jump(element!.scrollLeft);
    }
    function scroll() {
      if (Math.abs(element!.scrollLeft - Math.max(0, Math.min(maximum(), scrollSpring.get()))) > 2) interrupt();
    }
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return;
      const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = amount * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element!.clientWidth : 1);
      const next = Math.max(0, Math.min(maximum(), scrollTarget.current + delta));
      if (next === scrollTarget.current) return;
      event.preventDefault();
      scrollTarget.current = next;
      if (reduceMotion) scrollSpring.jump(next);
      else scrollSpring.set(next);
    }
    element.addEventListener('wheel', wheel, {passive: false});
    element.addEventListener('scroll', scroll, {passive: true});
    element.addEventListener('pointerdown', interrupt);
    return () => {
      unsubscribe();
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('pointerdown', interrupt);
    };
  }, [scrollSpring, reduceMotion]);
  useEffect(() => {
    onBusy?.(locked);
    return () => onBusy?.(false);
  }, [locked, onBusy]);
  async function read(invalidateResidue = true) {
    setLoading(true);
    try {
      const next = await invoke<IdentityState>('identities_read');
      setState(next);
      if (invalidateResidue) setResidueRevision(value => value + 1);
      setError('');
      if (review === 'empty') {
        const resolved = next.current.display_name || next.records.find(row => row.id === next.active)?.name || next.current.email?.split('@')[0] || t('当前身份');
        setName(old => (old === t('当前身份') ? resolved.slice(0, 64) : old));
      }
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }
  async function refreshAfterError() {
    setResidueRevision(value => value + 1);
    try {
      setState(await invoke<IdentityState>('identities_read'));
    } catch {
      /* 保留操作错误，不掩盖恢复失败。 */
    }
  }
  async function configureBrowser() {
    if (browserReview === null || busy) return;
    const enabled = browserReview;
    setBusy(true);
    setError('');
    try {
      setState(await invoke<IdentityState>('identities_browser', {enabled, useExisting}));
      setBrowserReview(null);
    } catch (e) {
      setError(String(e));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }
  async function retryBrowser() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await invoke('browser_launch', {onProgress: activity.start('browser')});
      activity.finish(true, '浏览器资料已与身份同步。');
      await read();
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(target: Target) {
    setName(target === 'recovery' ? t('恢复前状态') : (active?.name || currentName).slice(0, 64));
    if (target === 'recovery') {
      const previous = state?.records.find(row => row.id === state.recovery);
      if (previous) setPolicy({...previous.policy});
    }
    setReview(target);
    setError('');
  }
  function openSnapshot() {
    setName((active?.name || currentName).slice(0, 64));
    setSnapshot(true);
    setError('');
  }
  async function stop() {
    await invoke('identities_stop', {onProgress: activity.channel()});
  }
  async function saveSnapshot() {
    if (!snapshot || busy) return;
    setSnapshot(false);
    setBusy(true);
    setError('');
    const onProgress = activity.start('identity', '备份当前身份');
    try {
      await stop();
      const next = await invoke<IdentityState>('identities_save', {currentName: name.trim(), policy, onProgress});
      setState(next);
      setResidueRevision(value => value + 1);
      activity.finish(true, '当前身份已加密备份到保险库，无需退出当前工作区。');
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }
  async function change() {
    if (!review || busy) return;
    const target = review;
    setReview(null);
    setBusy(true);
    setError('');
    const onProgress = activity.start('identity', target === 'recovery' ? '恢复原身份' : target === 'empty' ? '切换到空身份' : '切换身份');
    try {
      await stop();
      const next = await invoke<IdentityState>('identities_switch', {
        targetId: typeof target === 'object' ? target.id : 'empty',
        currentName: name.trim(),
        policy,
        recover: target === 'recovery',
        onProgress,
      });
      setState(next);
      setResidueRevision(value => value + 1);
      activity.finish(true, next.browser_warning || (target === 'recovery' ? '原身份已恢复。' : '身份切换完成。'));
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }
  function confirmDelete(target: Identity | 'current') {
    setDeletion(target);
    setAccepted(false);
    setDeleteBrowser(false);
    setError('');
  }
  async function remove() {
    if (!deletion || !accepted || busy) return;
    const target = deletion;
    setDeletion(null);
    setBusy(true);
    setError('');
    const onProgress = activity.start('identity', target === 'current' ? '直接删除当前身份' : '删除暂存身份');
    try {
      if (target === 'current') await stop();
      const next = await invoke<IdentityState>('identities_delete', {
        id: target === 'current' ? 'current' : target.id,
        policy,
        deleteBrowser: target !== 'current' && deleteBrowser,
        onProgress,
      });
      setState(next);
      setResidueRevision(value => value + 1);
      activity.finish(true, next.browser_warning || '所选本地身份已直接删除。');
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }
  async function saveName() {
    if (!rename || busy) return;
    setBusy(true);
    try {
      setState(await invoke<IdentityState>('identities_rename', {id: rename.id, value: renameValue}));
      setRename(null);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const options = (
    <div className="identity-policy-body">
      <div className="identity-policy-banner">
        <span>{t('默认已开启智能无感接力：切换账号时自动保留对话历史（支持 claude --resume 续接）、项目、MCP 与 Skills，仅自动清理遥测缓存与日志。非特殊排障无需改动。')}</span>
        {!isDefaultPolicy && (
          <Button variant="secondary" size="small" disabled={locked} onClick={() => setPolicy({...defaultPolicy})}>
            {t('恢复推荐默认')}
          </Button>
        )}
      </div>
      <div className="identity-policy-grid">
        {policyRows.map(([key, label]) => (
          <div className="identity-policy-row" key={key}>
            <Checkbox label={t(label)} checked={policy[key]} disabled={locked} onCheckedChange={checked => setPolicy(old => ({...old, [key]: checked}))} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="identity-page">
      <header className="cleanup-title">
        <h1>{t('身份管理')}</h1>
        <Button variant="secondary" size="small" disabled={locked || loading} leftIcon={<Refresh aria-hidden size={16} className={loading ? 'spin' : ''} />} onClick={() => void read()}>
          {t('刷新')}
        </Button>
      </header>

      {error && (
        <p role="alert" className="cleanup-feedback error">
          {t(error)}
        </p>
      )}
      {state?.recovery && (
        <div className="identity-recovery" role="alert">
          <strong>{t('有一次身份切换尚未完成')}</strong>
          <Button size="small" variant="ink" disabled={locked || loading} onClick={() => choose('recovery')}>
            {t('恢复原身份')}
          </Button>
        </div>
      )}

      <section className="identity-library">
        <div className="identity-section-head">
          <div className="identity-head-title">
            <h2>{t('身份')}</h2>
            <span className="identity-policy-mode">
              {t('{v0} 个账号', {v0: totalIdentities})}
            </span>
          </div>
          <div className="identity-library-controls">
            <Button variant="ink" size="small" disabled={blocked || current?.present === false} onClick={() => choose('empty')}>
              {current?.present === false ? t('当前为新身份') : t('新身份')}
            </Button>
            {recommendSaved && (
              <Button variant="secondary" size="small" disabled={blocked} onClick={() => choose(recommendSaved.row)}>
                {t('切到最优号')}
              </Button>
            )}
            <Checkbox
              label={t('联动浏览器')}
              checked={state?.browser.enabled ?? false}
              disabled={blocked}
              onCheckedChange={value => {
                setUseExisting(false);
                setBrowserReview(value === true);
                setError('');
              }}
            />
          </div>
        </div>
        <div className="identity-onboarding-bar">
          <div className="identity-onboarding-steps">
            <span className="identity-onboarding-badge">{t('添加新号 3 步法')}</span>
            <span className="identity-onboarding-chip">{t('点「新身份」归档旧号')}</span>
            <i aria-hidden="true">→</i>
            <span className="identity-onboarding-chip">{t('内置浏览器验证并登录充值号')}</span>
            <i aria-hidden="true">→</i>
            <span className="identity-onboarding-chip">{t('Claude Code CLI 自动 Login')}</span>
          </div>
          <Button variant="secondary" size="small" disabled={blocked} onClick={() => void retryBrowser()}>
            {t('打开内置浏览器')}
          </Button>
        </div>
        <div className="identity-card-rail" ref={rail} tabIndex={0} role="region" aria-label={t('身份')}>
          {current?.present === false && (
            <IdentityCard className="identity-card empty selected" label={`${t('新身份')} · ${t('当前身份')}`}>
              <div className="identity-card-head">
                <div className="identity-avatar" aria-hidden="true">
                  +
                </div>
                <span className="identity-live-badge">{t('待登录')}</span>
              </div>
              <h3>{t('新身份')}</h3>
              <p className="identity-empty-note">{t('已准备全新隔离环境：请先在内置浏览器（全部验证通过）登录已充值的 Claude 网页版，再进 Claude Code CLI 自动 Login。')}</p>
              <div className="identity-card-footer">
                <Button variant="ink" size="small" disabled={blocked} onClick={() => void retryBrowser()}>
                  {t('打开内置浏览器')}
                </Button>
              </div>
            </IdentityCard>
          )}
          {(loading || current?.present) && (
            <IdentityCard className="identity-card current" label={t('当前身份')}>
              <div className="identity-card-head">
                <div className="identity-avatar" aria-hidden="true">
                  {active?.name || current?.display_name || current?.email ? Array.from(currentName)[0]?.toUpperCase() : <ShieldCheck size={20} />}
                </div>
                <span className="identity-live-badge">{loading ? t('检查中') : state?.running ? t('运行中') : t('进程已停止')}</span>
              </div>
              <IdentityName name={currentName} accountName={current?.display_name} privacyMask={prefs.privacyMask} t={t} />
              <div className="identity-account identity-email-line">
                {current?.email ? (
                  <span className="identity-email" title={maskEmailAddress(current.email, prefs.privacyMask)}>{maskEmailAddress(current.email, prefs.privacyMask)}</span>
                ) : (
                  <span className="identity-account-unknown">{t(current?.unavailable ? '账号信息暂不可读' : '账号信息未识别')}</span>
                )}
              </div>
              <div className="identity-meta-line" title={prefs.privacyMask ? undefined : current?.proxy || undefined}>
                <span className={`identity-meta-badge plan ${current?.plan ? '' : 'unknown'}`}>{current?.plan || t('identityCard.planUnknown')}</span>
                {current?.auth_status && <span className={`identity-meta-badge auth-${current.auth_status}`}>{authBadgeLabel(current.auth_status, t)}</span>}
              </div>
              <IdentityQuota quota={currentQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} />
              <SubscriptionExpiry expiresAt={current?.subscription_expires_at} locale={locale} t={t} />
              <div className="identity-card-footer">
                <Button variant="secondary" size="small" disabled={blocked} onClick={openSnapshot}>
                  {t(active ? '更新备份' : '保存备份')}
                </Button>
                <Button variant="ghost" size="small" disabled={blocked} onClick={() => confirmDelete('current')}>
                  {t('直接删除')}
                </Button>
              </div>
            </IdentityCard>
          )}
          {saved.map(row => {
            const summary = state?.summaries?.[row.id];
            const savedQuota = evaluateQuota(summary, nowSec);
            const isRecommended = recommendSaved?.row.id === row.id;
            return (
              <IdentityCard className="identity-card" key={row.id} title={new Date(row.saved_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}>
                <div className="identity-card-head">
                  <div className="identity-avatar" aria-hidden="true">
                    {Array.from(row.name)[0]?.toUpperCase()}
                  </div>
                  <span className="identity-size">{formatBytes(row.bytes)}</span>
                </div>
                <IdentityName name={row.name} accountName={summary?.display_name} privacyMask={prefs.privacyMask} saved t={t} />
                <div className="identity-account identity-email-line saved">
                  {summary?.email ? <span className="identity-email" title={maskEmailAddress(summary.email, prefs.privacyMask)}>{maskEmailAddress(summary.email, prefs.privacyMask)}</span> : <span className="identity-account-unknown">{t('identityCard.emailUnavailable')}</span>}
                </div>
                <div className="identity-meta-line" title={prefs.privacyMask ? undefined : summary?.proxy || undefined}>
                  <span className={`identity-meta-badge plan ${summary?.plan ? '' : 'unknown'}`}>{summary?.plan || t('identityCard.planUnknown')}</span>
                  {summary?.auth_status && <span className={`identity-meta-badge auth-${summary.auth_status}`}>{authBadgeLabel(summary.auth_status, t)}</span>}
                  {isRecommended && <span className="identity-meta-badge ok">{t('推荐切换')}</span>}
                </div>
                <IdentityQuota quota={savedQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} />
                <SubscriptionExpiry expiresAt={summary?.subscription_expires_at} locale={locale} t={t} />
                <div className="identity-card-footer">
                  <Button variant="secondary" size="small" disabled={blocked} onClick={() => choose(row)}>
                    {t('切换')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={blocked}
                    onClick={() => {
                      setRename(row);
                      setRenameValue(row.name);
                      setError('');
                    }}
                  >
                    {t('重命名')}
                  </Button>
                  <Button variant="ghost" size="small" disabled={blocked} onClick={() => confirmDelete(row)}>
                    {t('删除')}
                  </Button>
                </div>
              </IdentityCard>
            );
          })}
        </div>
        <IdentityOperationProgress activity={activity.state} />
      </section>
      <Disclosure
        className="identity-policy"
        triggerClassName="identity-policy-trigger"
        summary={
          <>
            <strong>{t('保留在工作区')}</strong>
            <span className="identity-policy-hint">{t('切号已自动保留对话历史与配置、自动清理遥测日志，日常无需改动')}</span>
          </>
        }
        aside={<span className={`identity-policy-mode ${isDefaultPolicy ? 'ok' : ''}`}>{isDefaultPolicy ? t('智能默认') : `${kept.length} / ${policyRows.length}`}</span>}
      >
        {options}
      </Disclosure>
      {state?.browser_warning && (
        <div className="identity-recovery" role="alert">
          <span>{t(state.browser_warning)}</span>
          <Button size="small" variant="secondary" disabled={blocked} onClick={() => void retryBrowser()}>
            {t('打开浏览器')}
          </Button>
        </div>
      )}
      <ClaudeResiduePanel
        activity={activity}
        blocked={locked || loading || !state || !!state?.recovery}
        revision={residueRevision}
        onBusy={setResidueBusy}
        onChanged={async () => {
          if (!(await read(false))) throw new Error('身份状态刷新失败，请重新检查。');
        }}
      />
      <ClaudeCliPanel blocked={locked || loading || !!state?.recovery} onBusy={setCliBusy} />
      <AppDialog
        open={snapshot}
        onOpenChange={open => {
          if (!open && !busy) setSnapshot(false);
        }}
        title={t(active ? '更新备份' : '保存备份')}
        description={t('将当前 Claude Code 与 Desktop 登录状态加密保存到身份保险库，不清空当前工作区，也不关闭关联浏览器。')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSnapshot(false)}>
              {t('取消')}
            </Button>
            <Button variant="ink" disabled={busy || loading || !state || !name.trim() || !!state.recovery || !state.current.present} onClick={() => void saveSnapshot()}>
              {t('确认保存备份')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <label htmlFor="identity-snapshot-name">{t('当前身份保存为')}</label>
          <Input id="identity-snapshot-name" maxLength={64} value={name} onChange={e => setName(e.target.value)} />
          {current?.email && (
            <div className="identity-confirm-target">
              <span>{t('当前身份')}</span>
              <strong>
                {current.email}
                {current.plan ? ` (${current.plan})` : ''}
              </strong>
            </div>
          )}
          {currentQuota && (
            <div className="identity-confirm-target">
              <span>{t('当前剩余额度')}</span>
              <code>{currentQuota.detail}</code>
            </div>
          )}
          {current?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('当前专属代理')}</span>
              <code>{current.proxy}</code>
            </div>
          )}
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>{t('活跃 Claude 会话（保存时将自动结束）')}</span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}</span>
                    {s.workspace && <strong>{s.workspace}</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </AppDialog>
      <AppDialog
        open={!!review}
        onOpenChange={open => {
          if (!open && !busy) setReview(null);
        }}
        title={review === 'recovery' ? t('恢复原身份') : review === 'empty' ? t('切换到空身份') : t('切换身份')}
        description={t('先压缩暂存当前 Claude Code 与 Desktop 状态，再切换。将结束已识别的 Claude 进程，未保存任务会中断。')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)}>
              {t('取消')}
            </Button>
            <Button variant="ink" disabled={busy || loading || !state || !name.trim() || (review !== 'recovery' && !!state.recovery)} onClick={() => void change()}>
              {review === 'recovery' ? t('确认恢复') : t('确认暂存并切换')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <label htmlFor="identity-current-name">{t('当前身份保存为')}</label>
          <Input id="identity-current-name" maxLength={64} value={name} onChange={e => setName(e.target.value)} />
          {typeof review === 'object' && review && (
            <div className="identity-confirm-target">
              <span>{t('目标身份')}</span>
              <strong>
                {review.name}
                {targetSummary?.email ? ` · ${targetSummary.email}` : ''}
                {targetSummary?.plan ? ` (${targetSummary.plan})` : ''}
              </strong>
            </div>
          )}
          {targetQuota && (
            <div className="identity-confirm-target">
              <span>{t('目标剩余额度')}</span>
              <code>{targetQuota.detail}</code>
            </div>
          )}
          {current?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('当前专属代理')}</span>
              <code>{current.proxy}</code>
            </div>
          )}
          {targetSummary?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('目标专属代理')}</span>
              <code>{targetSummary.proxy}</code>
            </div>
          )}
          <div className="identity-confirm-keep">
            <span>{t('留在工作区')}</span>
            <strong>{kept.join(' · ') || t('无')}</strong>
          </div>
          {review === 'empty' && (
            <div className="identity-confirm-guide">
              <strong>{t('切换后添加新号步骤：')}</strong>
              <ol>
                <li>{t('在内置浏览器（已通过全部验证）中登录已充值的 Claude 网页版账号；')}</li>
                <li>{t('进入 Claude Code CLI 自动 Login 完成授权；')}</li>
                <li>{t('返回本页面点击「刷新」与「保存备份」即可随时一键切号。')}</li>
              </ol>
            </div>
          )}
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>{t('活跃 Claude 会话（切换时将自动结束）')}</span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}</span>
                    {s.workspace && <strong>{s.workspace}</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proxyChanged && <p className="identity-proxy-notice">{t('代理环境提醒：目标身份与当前身份的独立代理配置不同，请确认出口 IP 与目标账号一致。')}</p>}
          {state?.browser.enabled && <p>{t('将关闭并重开关联浏览器，请先保存网页任务。')}</p>}
          <p>{t('只管理本地状态；失效的登录可能需要重新认证。')}</p>
        </div>
      </AppDialog>
      <AppDialog
        alert
        className="identity-delete-alert"
        open={!!deletion}
        onOpenChange={open => {
          if (!open && !busy) setDeletion(null);
        }}
        title={deletion === 'current' ? t('直接删除当前身份') : t('删除暂存身份')}
        description={deletion === 'current' ? t('将结束 Claude 进程并删除所选本地数据。不会新增备份，已有暂存身份不受影响。') : t('永久删除这份暂存文件。当前工作区不受影响。')}
        footer={
          <>
            <Button variant="secondary" data-dialog-cancel onClick={() => setDeletion(null)}>
              {t('取消')}
            </Button>
            <Button className="identity-delete-button" variant="ink" disabled={busy || !accepted} onClick={() => void remove()}>
              {t('确认直接删除')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <div className="identity-delete-warning">
            <span aria-hidden="true">!</span>
            <strong>{t('警告：此操作不可撤销，不会创建新备份。')}</strong>
          </div>
          {deletion === 'current' ? (
            <>
              <div className="identity-confirm-keep">
                <span>{t('删除范围')}</span>
                <strong>{[t('登录与身份数据'), ...removed].join(' · ')}</strong>
              </div>
              <div className="identity-confirm-keep">
                <span>{t('留在工作区')}</span>
                <strong>{kept.join(' · ') || t('无')}</strong>
              </div>
            </>
          ) : (
            <strong>{deletion?.name}</strong>
          )}
          {typeof deletion === 'object' && deletion && state?.browser.bound_ids.includes(deletion.id) && (
            <Checkbox label={t('同时永久删除关联浏览器资料')} checked={deleteBrowser} onCheckedChange={value => setDeleteBrowser(value === true)} />
          )}
          <Checkbox checked={accepted} onCheckedChange={setAccepted} label={t('我知道此操作无法撤销')} />
        </div>
      </AppDialog>
      <AppDialog
        open={browserReview !== null}
        onOpenChange={open => {
          if (!open && !busy) setBrowserReview(null);
        }}
        title={t(browserReview ? '联动浏览器' : '关闭浏览器联动')}
        description={t('将正常关闭并重开浏览器，请先保存网页任务。')}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setBrowserReview(null)}>
              {t('取消')}
            </Button>
            <Button variant="ink" disabled={busy} loading={busy} onClick={() => void configureBrowser()}>
              {t('确认')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <p>{t(browserReview ? '每个身份使用独立网页资料和稳定指纹，切换时自动恢复。首次仍需登录网站。' : '恢复使用原有通用浏览器资料。各身份的独立资料会保留。')}</p>
          {browserReview && <Checkbox label={t('将现有浏览器资料关联给当前身份')} checked={useExisting} disabled={busy} onCheckedChange={value => setUseExisting(value === true)} />}
          <p>{t('默认创建新资料，现有资料不会删除。资料隔离不会改变出口 IP。')}</p>
          {error && <p role="alert">{t(error)}</p>}
        </div>
      </AppDialog>
      <AppDialog
        open={!!rename}
        onOpenChange={open => {
          if (!open && !busy) {
            setRename(null);
            setError('');
          }
        }}
        title={t('重命名身份')}
        description={t('identityCard.renameHint')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRename(null);
                setError('');
              }}
            >
              {t('取消')}
            </Button>
            <Button variant="ink" disabled={busy || !renameValue.trim()} onClick={() => void saveName()}>
              {t('保存')}
            </Button>
          </>
        }
      >
        <Input aria-label={t('身份名称')} maxLength={64} value={renameValue} onChange={e => setRenameValue(e.target.value)} />
        {error && <p role="alert">{t(error)}</p>}
      </AppDialog>
    </section>
  );
}

// ----- 工牌保留清晰文字与 CSS 阴影悬停，不用 3D 变换栅格化文字 -----
function IdentityCard({className, children, label, title}: {className: string; children: ReactNode; label?: string; title?: string}) {
  return (
    <article
      className={className}
      aria-label={label}
      title={title}
    >
      {children}
    </article>
  );
}
