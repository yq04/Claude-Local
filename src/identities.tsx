/**
 * [INPUT]: 原生身份命令、可恢复的原生额度批次状态/取消、保留策略、逐窗观测、隐私偏好、本地刷新事件与诊断状态。
 * [OUTPUT]: 180×286 身份工牌、失败后重试的本地额度同步、按需打开的在线查询弹窗与严格指纹绑定的批次进度/取消/恢复。
 * [POS]: 身份管理 GUI；额度工作由原生任务所有，页面挂载只恢复运行中的在线批次，导航不取消工作，身份破坏性操作在批次期间锁定。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Button, Checkbox, Disclosure, Input, Switch, useReducedMotionConfig, useSpring} from 'cromma-ui';
import {DropdownMenu} from 'radix-ui';
import {listen} from '@tauri-apps/api/event';
import {formatOnlineQuotaStatus, formatSubscriptionAndResets, ForegroundQuotaScheduler, isExpectedCurrentTarget, isExpectedSavedTarget, buildBatchTargets, generateBatchRequestId, formatBatchProgress, isSuccessfulOnlineResult, aggregateBatchProgress, summarizeBatchResult, isTerminalBatchState, isMatchingBatchTarget, type OnlineQuotaResult, type OnlineQuotaStatus, type BatchQuotaResult, type QuotaBatchProgress, type BatchProgressSummary, type QuotaBatchTarget} from './identity-online-quota';
import type {IdentitySubscriptionMetadata} from './identity-model';
import {ShieldCheck, Refresh} from 'cromma-ui/pika';
import {invoke} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {IdentityOperationProgress, useCleanupActivity} from './cleaner-activity';
import {formatBytes} from './cleaner-model';
import {ClaudeCliPanel} from './claude-cli-panel';
import {ClaudeResiduePanel} from './claude-residue-panel';
import {defaultPolicy, policyRows, type Identity, type IdentityState} from './identity-model';
import {maskDisplayName, maskEmailAddress, usePreferences} from './settings-model';
import {evaluateQuota, formatCompactEta, formatResetClock} from './identity-quota';
import {usePageRefresh, type IdentityReviewRequest} from './app-events';
import {formatObservationAge, quotaObservationAge} from './identity-list';
import {serializeIdentityDiagnostic} from './identity-diagnostics';
import {connectionHistory, IdentityConnections, isValidQuotaTargetSubset} from './identity-connections';
import './identity-productivity.css';

type Target = Identity | 'empty' | 'recovery';
type QuotaSetupStatus={state:'not_configured'|'custom_statusline'|'invalid_settings_path'|'invalid_settings_json'|'invalid_statusline';collector_bundled:boolean;has_statusline:boolean};

function authBadgeLabel(status: string | null | undefined, t: (key: string) => string) {
  if (status === 'valid') return t('凭据有效');
  if (status === 'refresh_needed') return t('待自动续期');
  if (status === 'expired') return t('需重登');
  if (status === 'api_key') return t('API 密钥');
  return null;
}

function QuotaWindow({label, used, remaining, resetAt, inferredResetAt = null, resetComplete = false, inferred = false, known, level, display, nowSec, t}: {label: string; used: number; remaining: number; resetAt: number | null; inferredResetAt?: number | null; resetComplete?: boolean; inferred?: boolean; known: boolean; level: string; display: 'remaining' | 'used'; nowSec: number; t: (key: string) => string}) {
  const value = display === 'used' ? used : remaining;
  const reset = resetAt ? formatResetClock(resetAt, label === '7d') : '';
  const countdown = formatCompactEta(resetAt, nowSec);
  const inferredClock = inferred && inferredResetAt ? formatResetClock(inferredResetAt, label === '7d' || nowSec - inferredResetAt >= 86400) : '';
  const resetLabel = inferred ? t('identityCard.resetInferred') : reset ? `${t('identityCard.reset')} ${reset}` : resetComplete ? t('identityCard.windowExpired') : t('identityCard.resetUnavailable');
  const resetDate = resetAt == null ? null : new Date(resetAt * 1000);
  const resetDateTime = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;
  return (
    <div className={`identity-quota-window ${known ? `quota-${level}` : 'quota-unknown'}`} data-quota-window={label} data-quota-inferred={inferred || undefined} title={inferred ? t('quota.resetInferredHint') : undefined} aria-label={`${label} ${known ? `${t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')} ${Math.round(value)}%` : t('identityCard.quotaUnknown')}${inferred ? ` · ${resetLabel}` : ''}`}>
      <div className="identity-quota-copy">
        <strong>{label}</strong>
        <span className="identity-quota-value">{known ? <><span>{t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')}</span>{' '}<strong>{Math.round(value)}%</strong></> : t('identityCard.unknown')}</span>
      </div>
      <span className={`identity-quota-track ${inferred ? "quota-track-inferred" : ""}`} role="img" aria-label={known ? `${Math.round(value)}%` : t('identityCard.quotaUnknown')}>
        {known && <i style={{width: `${Math.max(0, Math.min(100, value))}%`}} />}
      </span>
      <span className="identity-quota-reset" title={countdown ? `${resetLabel} · ${countdown}` : inferredClock ? `${resetLabel} · ${inferredClock}` : resetLabel}>
        <span className="identity-quota-reset-label">{reset ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><path d="M8 4.5V8l2.2 1.4" /></svg><time className="identity-reset-time" dateTime={resetDateTime} aria-label={resetLabel}>{reset}</time></> : resetLabel}</span>
        {(countdown || inferredClock) && <span className="identity-quota-countdown">{countdown || inferredClock}</span>}
      </span>
    </div>
  );
}

function IdentityQuota({quota, display, nowSec, t, onOpenDetails}: {quota: ReturnType<typeof evaluateQuota>; display: 'remaining' | 'used'; nowSec: number; t: (key: string) => string; onOpenDetails?: () => void}) {
  return (
    <div className="identity-quota-stack identity-quota-open" data-identity-quota tabIndex={0} role="button" aria-label={t('quota.details')} onClick={onOpenDetails} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails?.(); }}}>
      <QuotaWindow label="5h" used={quota?.used5h ?? 0} remaining={quota?.rem5h ?? 0} resetAt={quota?.r5 ?? null} inferredResetAt={quota?.inferredReset5h ?? null} resetComplete={quota?.expired5h} inferred={quota?.inferred5h} known={quota?.known5h ?? false} level={quota?.level5h ?? 'ok'} display={display} nowSec={nowSec} t={t} />
      <QuotaWindow label="7d" used={quota?.used7d ?? 0} remaining={quota?.rem7d ?? 0} resetAt={quota?.r7 ?? null} inferredResetAt={quota?.inferredReset7d ?? null} resetComplete={quota?.expired7d} inferred={quota?.inferred7d} known={quota?.known7d ?? false} level={quota?.level7d ?? 'ok'} display={display} nowSec={nowSec} t={t} />
    </div>
  );
}

function SubscriptionAndResets({meta, locale, t}: {meta: IdentitySubscriptionMetadata | null | undefined; locale: string; t: (key: string, slots?: Record<string, string | number>) => string}) {
  const display = formatSubscriptionAndResets(meta, locale, t);
  if (!display.hasAnyData) return null;
  return (
    <div className="identity-sub-resets-block">
      {display.billing && (
        <div className="identity-sub-resets-row">
          <strong>{display.billing.label}</strong>
          <span>{display.billing.formattedDate}</span>
        </div>
      )}
      {display.manualResets && (
        <div className="identity-sub-resets-row">
          <strong>{display.manualResets.label}</strong>
          <span>{t('identityCard.manualResetsCount', {count: display.manualResets.remaining, v0: display.manualResets.remaining})}</span>
        </div>
      )}
    </div>
  );
}

function IdentityName({name, email, accountName, plan, privacyMask, saved = false, t}: {name: string; email?:string|null; accountName?: string | null; plan?: string | null; privacyMask: boolean; saved?: boolean; t: (key: string) => string}) {
  const shownName = maskDisplayName(name, email, privacyMask);
  const description = !privacyMask && accountName && accountName !== name ? `${t('identityCard.accountName')}: ${accountName}` : undefined;
  const hasPlan = plan && plan.trim().length > 0;
  return (
    <h3 className="identity-name-with-label" data-identity-name data-identity-username={!saved || undefined} data-identity-saved-name={saved || undefined} aria-label={shownName} aria-description={description}>
      <strong title={description ? `${shownName}\n${description}` : shownName}>{shownName}</strong>
      {hasPlan && <span className={`identity-plan-pill plan-${plan.toLowerCase()}`}>{plan}</span>}
    </h3>
  );
}

export function IdentityPanel({onBusy, initialEmpty = false, identityReviewRequest = null, onIdentityReviewConsumed}: {onBusy?: (busy: boolean) => void; initialEmpty?: boolean; identityReviewRequest?: IdentityReviewRequest | null; onIdentityReviewConsumed?: (requestId: number) => void}) {
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
  const [quotaDetails, setQuotaDetails] = useState<{id:string;name:string}|null>(null);
  const [quotaFeedback, setQuotaFeedback] = useState('');
  const [quotaSetup, setQuotaSetup] = useState<QuotaSetupStatus|null>(null);
  const [quotaSetupError, setQuotaSetupError] = useState(false);
  const [copyDiagnosticStatus, setCopyDiagnosticStatus] = useState<'copied'|'failed'|null>(null);
  const [readReady, setReadReady] = useState(false);
  const [diagnosticVersion, setDiagnosticVersion] = useState<string|null>(null);
  const [foregroundAutoRefresh, setForegroundAutoRefresh] = useState(false);
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);
  batchBusyRef.current = batchBusy;
  const [batchSummary, setBatchSummary] = useState<BatchProgressSummary>({
    inProgress: false,
    requestId: null,
    total: 0,
    completed: 0,
    successCount: 0,
    authRequiredCount: 0,
    errorCount: 0,
  });
  const [cardStatusMap, setCardStatusMap] = useState<Record<string, {
    status: OnlineQuotaStatus;
    message: string;
    isError: boolean;
    observedAtMs?: number;
    result: OnlineQuotaResult;
    expectedIdentity: string;
  }>>({});
  const currentBatchRequestIdRef = useRef<string | null>(null);
  const frozenBatchTargetsRef = useRef<QuotaBatchTarget[]>([]);
  const batchCancelingRef = useRef(false);
  const prevTargetSetKeyRef = useRef<string | null>(null);
  const batchResultsMapRef = useRef<Record<string, OnlineQuotaResult>>({});
  const batchSummaryRef = useRef(batchSummary);
  batchSummaryRef.current = batchSummary;
  const readSeqRef = useRef(0);
  const schedulerRef = useRef<ForegroundQuotaScheduler | null>(null);
  const lockedRef = useRef(false);
  const busyRef = useRef(false);
  const activity = useCleanupActivity();
  const rail = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotionConfig() ?? false;
  const scrollSpring = useSpring(0, {stiffness: 170, damping: 25, mass: 0.8});
  const scrollTarget = useRef(0);
  const locked = busy || cliBusy || residueBusy || !!review || snapshot || !!rename || !!deletion || browserReview !== null || quotaDetails !== null;
  const actionLocked = busy || cliBusy || residueBusy || !!review || snapshot || !!rename || !!deletion || browserReview !== null;
  lockedRef.current = locked;
  busyRef.current = busy;
  const actionLockedRef = useRef(false);
  actionLockedRef.current = actionLocked;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const tRef = useRef(t);
  tRef.current = t;
  const stateRef = useRef(state);
  stateRef.current = state;
  const quotaTargets = buildBatchTargets(state).targets;
  const currentTargetSetKey = quotaTargets.map(target => `${target.account_id}:${target.expected_identity.toLowerCase()}`).sort().join(',');
  const unverifiedQuotaTargets = buildBatchTargets(state).unverifiedCount;
  useEffect(() => {
    if (prevTargetSetKeyRef.current !== null && prevTargetSetKeyRef.current !== currentTargetSetKey) {
      setForegroundAutoRefresh(false);
      schedulerRef.current?.setEnabled(false, false);
      schedulerRef.current?.invalidate();
      const frozenStillValid = frozenBatchTargetsRef.current.length === 0 ||
        isValidQuotaTargetSubset(frozenBatchTargetsRef.current, quotaTargets);
      if (batchBusyRef.current && currentBatchRequestIdRef.current && !frozenStillValid) {
        void cancelBatchForTargetChange(currentBatchRequestIdRef.current);
        currentBatchRequestIdRef.current = null;
        frozenBatchTargetsRef.current = [];
        batchBusyRef.current = false;
        setBatchBusy(false);
        batchSummaryRef.current = {...batchSummaryRef.current, inProgress: false, state: 'cancelled', notRunCount: Math.max(0, batchSummaryRef.current.total - batchSummaryRef.current.completed)};
        setBatchSummary(batchSummaryRef.current);
        setQuotaFeedback(tRef.current('quotaOnline.targetSetChanged'));
      }
      setCardStatusMap({});
    }
    prevTargetSetKeyRef.current = currentTargetSetKey;
  }, [currentTargetSetKey]);
  const active = state?.records.find(row => row.id === state.active);
  const current = state?.current;
  const saved = state?.records.filter(row => !current?.present || row.id !== state.active) ?? [];
  const currentName = active?.name || current?.display_name || current?.email?.split('@')[0] || t('当前身份');
  const connectionQueueItems = connectionHistory.matching(quotaTargets).map(item => {
    const row = state?.records.find(record => record.id === item.target.account_id);
    const email = item.target.account_id === 'current' ? current?.email : state?.summaries?.[item.target.account_id]?.email;
    const label = item.target.account_id === 'current' ? currentName : row?.name ?? t('quotaOnline.unknownAccount');
    return {...item, label: maskDisplayName(label, email, prefs.privacyMask)};
  });
  const blocked = locked || batchBusy || loading || !state || !!state?.recovery;
  const kept = policyRows.filter(([key]) => policy[key]).map(([, label]) => t(label));
  const removed = policyRows.filter(([key]) => !policy[key]).map(([, label]) => t(label));
  const isDefaultPolicy = policyRows.every(([key]) => policy[key] === defaultPolicy[key]);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const currentQuota = evaluateQuota(current, nowSec);
  const detailsAreCurrent = quotaDetails?.id === 'current' || (!!quotaDetails && quotaDetails.id === state?.active);
  const detailsSummary = detailsAreCurrent ? current : quotaDetails ? state?.summaries[quotaDetails.id] : undefined;
  const detailsQuota = evaluateQuota(detailsSummary, nowSec);
  const detailsSavedRecord = quotaDetails && quotaDetails.id !== 'current' ? state?.records.find(row => row.id === quotaDetails.id) : undefined;
  const recoveryRecord = state?.records.find(row => row.id === state.recovery);
  const targetSummary = typeof review === 'object' && review ? state?.summaries?.[review.id] : undefined;
  const targetQuota = evaluateQuota(targetSummary, nowSec);
  const proxyChanged =
    (typeof review === 'object' && review && (current?.proxy || null) !== (targetSummary?.proxy || null)) ||
    (review === 'empty' && Boolean(current?.proxy));
  const bestSaved = saved.reduce<{row: Identity; effectiveRem: number; inferred: boolean} | null>((best, row) => {
    const sum = state?.summaries?.[row.id];
    if (sum?.auth_status === 'expired') return best;
    const q = evaluateQuota(sum, nowSec);
    if (!q || !q.known5h || !q.known7d || q.inferred7d || q.effectiveRem <= 0) return best;
    const inferred = !q.recommendable;
    if (!best || q.effectiveRem > best.effectiveRem || (q.effectiveRem === best.effectiveRem && best.inferred && !inferred)) {
      return {row, effectiveRem: q.effectiveRem, inferred};
    }
    return best;
  }, null);
  const recommendSaved = bestSaved && (!current?.present || (currentQuota && bestSaved.effectiveRem > currentQuota.effectiveRem)) ? bestSaved : null;
  const totalIdentities = (current?.present ? 1 : 0) + saved.length;

  useEffect(() => {
    void read();
  }, []);
  usePageRefresh(() => { if (!locked && !loading) void read(false); });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void listen('quota-metadata-updated', () => {
      if (active && mountedRef.current) void read(false);
    })
      .then(fn => {
        if (!active || !mountedRef.current) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void listen<QuotaBatchProgress>('quota-batch-progress', event => {
      if (!active || !mountedRef.current) return;
      const payload = event.payload;
      if (!payload || payload.request_id !== currentBatchRequestIdRef.current) return;
      const frozenTarget = frozenBatchTargetsRef.current.find(target => target.account_id === payload.account_id);
      const expectedFp = payload.account_id === 'current'
        ? stateRef.current?.current?.quota_identity
        : stateRef.current?.summaries?.[payload.account_id]?.quota_identity;
      if (!frozenTarget || frozenTarget.expected_identity !== payload.expected_identity ||
          !isMatchingBatchTarget(frozenTarget, expectedFp)) return;
      connectionHistory.merge(frozenBatchTargetsRef.current, [{target: frozenTarget, result: payload.result}],
        buildBatchTargets(stateRef.current).targets);

      const { nextSummary, updatedResultsMap } = aggregateBatchProgress(
        batchSummaryRef.current,
        batchResultsMapRef.current,
        payload
      );
      batchResultsMapRef.current = updatedResultsMap;
      batchSummaryRef.current = nextSummary;
      setBatchSummary(nextSummary);

      const statusInfo = formatOnlineQuotaStatus(payload.result, Date.now(), tRef.current);
      setCardStatusMap(prev => ({
        ...prev,
        [payload.account_id]: {
          status: payload.result.status,
          message: statusInfo.message,
          isError: statusInfo.isError,
          observedAtMs: payload.result.observed_at_ms ?? payload.result.last_observed_at_ms,
          result: payload.result,
          expectedIdentity: payload.expected_identity,
        },
      }));

      void read(false);
    })
      .then(fn => {
        if (!active || !mountedRef.current) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!readReady) return;
    let live = true;
    void invoke<BatchQuotaResult | null>('identities_quota_batch_state', {requestId: null})
      .then(batch => {
        if (!live || !batch) return;
        if (!isTerminalBatchState(batch.state)) {
          adoptBatchSnapshot(batch, true);
        } else if (onlinePanelOpen) {
          adoptBatchSnapshot(batch, true);
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [readReady, onlinePanelOpen]);

  useEffect(() => {
    const requestId = currentBatchRequestIdRef.current;
    if (!batchBusy || !requestId) return;
    let live = true;
    const poll = async () => {
      try {
        const snapshot = await invoke<BatchQuotaResult | null>('identities_quota_batch_state', {requestId});
        if (live && snapshot) adoptBatchSnapshot(snapshot, false);
      } catch {
        // The native task remains authoritative; a transient state-read error cannot unlock destructive actions.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => { live = false; window.clearInterval(timer); };
  }, [batchBusy, batchSummary.requestId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: string | undefined;
    const check = async () => {
      try {
        if (!document.hidden && !busyRef.current && !batchBusyRef.current && !actionLockedRef.current) {
          const next = await invoke<string>('identities_quota_revision');
          if (!cancelled && (revision === undefined || next !== revision)) {
            // A failed or superseded read must leave the change pending for the next check.
            if (await read(false)) revision = next;
          }
        }
      } catch {
        // A failed local metadata check does not clear any quota observation.
      } finally {
        if (!cancelled) timer = setTimeout(() => void check(), 2000);
      }
    };
    void check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const scheduler = new ForegroundQuotaScheduler({
      intervalMs: 180_000,
      isForeground: () => !document.hidden && document.hasFocus(),
      poll: async (gen) => {
        if (actionLockedRef.current || busyRef.current || batchBusyRef.current || !mountedRef.current) return null;
        await refreshAllQuotas(false);
        return null;
      },
    });
    schedulerRef.current = scheduler;

    const onForegroundChange = () => {
      scheduler.onForegroundChange();
    };
    document.addEventListener('visibilitychange', onForegroundChange);
    window.addEventListener('focus', onForegroundChange);
    window.addEventListener('blur', onForegroundChange);

    return () => {
      document.removeEventListener('visibilitychange', onForegroundChange);
      window.removeEventListener('focus', onForegroundChange);
      window.removeEventListener('blur', onForegroundChange);
      scheduler.destroy();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    schedulerRef.current?.setEnabled(foregroundAutoRefresh, true);
  }, [foregroundAutoRefresh]);

  useEffect(() => {
    const request = identityReviewRequest;
    if (!request || !readReady || loading || locked || !state) return;
    const row = state.records.find(item => item.id === request.identityId);
    if (!row || (current?.present && request.identityId === state.active)) {
      setError(row ? '' : t('identityReview.missing'));
      onIdentityReviewConsumed?.(request.requestId);
      return;
    }
    choose(row);
    onIdentityReviewConsumed?.(request.requestId);
  }, [identityReviewRequest, readReady, loading, locked, state, current?.present, onIdentityReviewConsumed]);
  useEffect(() => {
    let live=true;
    void getVersion().then(value => {if(live)setDiagnosticVersion(value);}).catch(()=>{if(live)setDiagnosticVersion(null);});
    return () => {live=false;};
  }, []);
  useEffect(() => {
    const tick = () => {if (!document.hidden) setNowSec(Math.floor(Date.now() / 1000));};
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {window.clearInterval(timer);document.removeEventListener('visibilitychange', tick);};
  }, []);
  useEffect(() => {
    if (!quotaDetails) return;
    let live=true;
    setQuotaSetup(null);setQuotaSetupError(false);
    void invoke<QuotaSetupStatus>('quota_setup_status').then(value=>{
      if(live && value && typeof value.state==='string') setQuotaSetup(value);
      else if(live) setQuotaSetupError(true);
    },()=>{if(live)setQuotaSetupError(true);});
    return ()=>{live=false;};
  }, [quotaDetails]);
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

  function currentFingerprint(accountId: string): string | null | undefined {
    return accountId === 'current'
      ? stateRef.current?.current?.quota_identity
      : stateRef.current?.summaries?.[accountId]?.quota_identity;
  }

  function hasRecentOnlineVerification(accountId: string, fingerprint: string | null | undefined): boolean {
    const record = cardStatusMap[accountId];
    const verifiedAt = record?.result.verified_at_ms;
    return !!fingerprint && record?.expectedIdentity.toLowerCase() === fingerprint.toLowerCase() &&
      typeof verifiedAt === 'number' && Number.isFinite(verifiedAt) && verifiedAt > 0 && verifiedAt <= Date.now();
  }

  function adoptBatchSnapshot(batch: BatchQuotaResult, restore: boolean): void {
    if (!batch || !/^[0-9a-f]{32}$/i.test(batch.request_id) || !Array.isArray(batch.targets) || !Array.isArray(batch.results)) return;
    if (!restore && currentBatchRequestIdRef.current !== batch.request_id) return;
    const currentTargets = buildBatchTargets(stateRef.current).targets;
    const targetSetMatches = isValidQuotaTargetSubset(batch.targets, currentTargets);
    if (!targetSetMatches) {
      if (!restore && batch.state !== 'cancelled' && batch.state !== 'deadline_exceeded' && batch.state !== 'completed') {
        void cancelBatchForTargetChange(batch.request_id);
      }
      return;
    }
    if (restore || currentBatchRequestIdRef.current === null) {
      currentBatchRequestIdRef.current = batch.request_id;
      frozenBatchTargetsRef.current = batch.targets.map(target => ({...target}));
    }
    if (currentBatchRequestIdRef.current !== batch.request_id) return;

    const validResults = batch.results.filter(item => {
      const frozen = frozenBatchTargetsRef.current.find(target => target.account_id === item.account_id);
      return !!frozen && frozen.expected_identity.toLowerCase() === item.expected_identity.toLowerCase() &&
        isMatchingBatchTarget(frozen, currentFingerprint(item.account_id));
    });
    connectionHistory.merge(batch.targets, validResults.map(item => ({
      target: {account_id: item.account_id, expected_identity: item.expected_identity},
      result: item.result,
    })), currentTargets);
    const resultsById = Object.fromEntries(validResults.map(item => [item.account_id, item.result]));
    batchResultsMapRef.current = resultsById;
    setCardStatusMap(previous => {
      const next = {...previous};
      for (const item of validResults) {
        const statusInfo = formatOnlineQuotaStatus(item.result, Date.now(), tRef.current);
        next[item.account_id] = {
          status: item.result.status,
          message: statusInfo.message,
          isError: statusInfo.isError,
          observedAtMs: item.result.verified_at_ms ?? item.result.observed_at_ms ?? item.result.last_observed_at_ms,
          result: item.result,
          expectedIdentity: item.expected_identity,
        };
      }
      return next;
    });
    const nextSummary = summarizeBatchResult({...batch, results: validResults});
    batchSummaryRef.current = nextSummary;
    setBatchSummary(nextSummary);
    const activeTask = !isTerminalBatchState(batch.state);
    batchBusyRef.current = activeTask;
    setBatchBusy(activeTask);
    if (!activeTask) batchCancelingRef.current = false;
  }

  async function cancelBatchForTargetChange(requestId: string): Promise<void> {
    try {
      await invoke<BatchQuotaResult>('identities_cancel_quota_batch', {requestId});
    } catch {
      // The native task may already have reached a terminal state; the new target set is still isolated in the UI.
    }
  }

  async function cancelBatch(): Promise<void> {
    const requestId = currentBatchRequestIdRef.current;
    if (!requestId || batchCancelingRef.current) return;
    batchCancelingRef.current = true;
    setQuotaFeedback(tRef.current('quotaOnline.cancelling'));
    try {
      const result = await invoke<BatchQuotaResult>('identities_cancel_quota_batch', {requestId});
      adoptBatchSnapshot(result, false);
    } catch (e) {
      setQuotaFeedback(tRef.current(String(e)));
      batchCancelingRef.current = false;
    }
  }

  async function refreshAllQuotas(allowBrowserFallback = true, requestedTargets?: QuotaBatchTarget[]): Promise<void> {
    if (actionLockedRef.current || busyRef.current) return;
    if (batchBusyRef.current) return; // Manual and automatic triggers share the active native batch.
    const inventory = buildBatchTargets(stateRef.current).targets;
    const targets = requestedTargets ?? inventory;
    if (requestedTargets && !isValidQuotaTargetSubset(requestedTargets, inventory)) {
      setQuotaFeedback(tRef.current('quotaOnline.accountMismatch'));
      return;
    }
    if (targets.length === 0) {
      setQuotaFeedback(tRef.current('quotaOnline.noValidTargets'));
      return;
    }

    const reqId = generateBatchRequestId();
    currentBatchRequestIdRef.current = reqId;
    frozenBatchTargetsRef.current = targets.map(target => ({...target}));
    batchResultsMapRef.current = {};
    batchBusyRef.current = true;
    setBatchBusy(true);

    const initialSummary: BatchProgressSummary = {
      inProgress: true,
      requestId: reqId,
      state: 'queued',
      total: targets.length,
      completed: 0,
      successCount: 0,
      authRequiredCount: 0,
      errorCount: 0,
    };
    batchSummaryRef.current = initialSummary;
    setBatchSummary(initialSummary);
    setQuotaFeedback('');

    try {
      const res = await invoke<BatchQuotaResult>('identities_refresh_all_quotas', {
        targets,
        requestId: reqId,
        allowBrowserFallback,
      });

      if (currentBatchRequestIdRef.current !== reqId) return;
      adoptBatchSnapshot(res, false);
      if (mountedRef.current) await read(false);
      setQuotaFeedback('');
    } catch (e) {
      setQuotaFeedback(tRef.current(String(e)));
    } finally {
      // Native task state owns the lock. A dropped frontend promise must not unlock an active worker.
      if (currentBatchRequestIdRef.current === reqId) {
        try {
          const latest = await invoke<BatchQuotaResult | null>('identities_quota_batch_state', {requestId: reqId});
          if (latest) adoptBatchSnapshot(latest, false);
          else if (batchBusyRef.current) {
            batchBusyRef.current = false;
            setBatchBusy(false);
            batchSummaryRef.current = {...batchSummaryRef.current, inProgress: false, state: 'cancelled'};
            setBatchSummary(batchSummaryRef.current);
          }
        } catch { /* periodic state recovery remains active while the panel is mounted */ }
      }
    }
  }

  async function openAccountBrowser(target: QuotaBatchTarget): Promise<void> {
    if (actionLockedRef.current || batchBusyRef.current || busyRef.current) return;
    if (!isValidQuotaTargetSubset([target], buildBatchTargets(stateRef.current).targets)) {
      setQuotaFeedback(tRef.current('quotaOnline.accountMismatch'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setQuotaFeedback(tRef.current('quotaOnline.openingAccountBrowser'));
    try {
      await invoke('browser_open_identity_profile', {
        accountId: target.account_id,
        expectedIdentity: target.expected_identity,
      });
      setQuotaFeedback(tRef.current('quotaOnline.accountBrowserOpened'));
    } catch (error) {
      setQuotaFeedback(tRef.current(String(error)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function syncSubscription() {
    const currentQuotaIdentity = current?.quota_identity;
    if (!currentQuotaIdentity || !currentQuotaIdentity.trim()) {
      setQuotaFeedback(tRef.current('quotaOnline.accountMismatch'));
      return;
    }
    if (actionLockedRef.current || busyRef.current || batchBusyRef.current) return;
    const frozenExpectedIdentity = currentQuotaIdentity.trim();
    const frozenActive = stateRef.current?.active;

    busyRef.current = true;
    setBusy(true);
    setQuotaFeedback(tRef.current('identityCard.syncInitiated'));
    try {
      await invoke('identities_sync_subscription', { expectedIdentity: frozenExpectedIdentity });
      if (!mountedRef.current) return;
      if (!isExpectedCurrentTarget(stateRef.current, { active: frozenActive, expectedIdentity: frozenExpectedIdentity })) {
        setQuotaFeedback(tRef.current('quotaOnline.accountMismatch'));
        return;
      }
      if (mountedRef.current) {
        await read(false);
        setQuotaFeedback(tRef.current('identityCard.syncCompleted'));
      }
    } catch (e) {
      setQuotaFeedback(tRef.current(String(e)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function read(invalidateResidue = true) {
    const seq = ++readSeqRef.current;
    setLoading(true);
    try {
      const next = await invoke<IdentityState>('identities_read');
      if (!mountedRef.current || seq < readSeqRef.current) {
        return false;
      }
      setState(next);
      setReadReady(true);
      if (invalidateResidue) setResidueRevision(value => value + 1);
      setError('');
      if (review === 'empty') {
        const resolved = next.current.display_name || next.records.find(row => row.id === next.active)?.name || next.current.email?.split('@')[0] || t('当前身份');
        setName(old => (old === t('当前身份') ? resolved.slice(0, 64) : old));
      }
      return true;
    } catch (e) {
      if (mountedRef.current && seq >= readSeqRef.current) {
        setError(String(e));
      }
      return false;
    } finally {
      if (mountedRef.current && seq >= readSeqRef.current) {
        setLoading(false);
      }
    }
  }
  async function copyQuotaDiagnostic() {
    if (!quotaDetails) return;
    setCopyDiagnosticStatus(null);
    const value = serializeIdentityDiagnostic({
      version: diagnosticVersion,
      generatedAtMs: Date.now(),
      windows: Object.fromEntries((['5h','7d'] as const).map(window => {
        const source = detailsSummary?.[`quota_${window}_source`] ?? detailsSummary?.quota_source;
        const observedAtMs = detailsSummary?.[`quota_${window}_source`] != null
          ? detailsSummary?.[`quota_${window}_observed_at_ms`]
          : detailsSummary?.quota_observed_at_ms;
        return [window, {source, observedAtMs}];
      })) as {'5h': {source: string|null|undefined;observedAtMs?:number|null};'7d': {source: string|null|undefined;observedAtMs?:number|null}},
      setup: quotaSetup ? {state:quotaSetup.state,collectorBundled:quotaSetup.collector_bundled,hasStatusline:quotaSetup.has_statusline} : null,
    });
    try {
      await invoke('copy_result', {text:value});
      setCopyDiagnosticStatus('copied');
    } catch {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        setCopyDiagnosticStatus('copied');
      } catch {
        setCopyDiagnosticStatus('failed');
      }
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
  async function openUsagePage() {
    if (busy || !detailsAreCurrent) return;
    setBusy(true);
    setQuotaFeedback('');
    try {
      await invoke('browser_open_usage', {onProgress: activity.start('browser')});
      activity.finish(true, 'quota.opened');
      setQuotaFeedback('quota.opened');
    } catch (reason) {
      const message = String(reason);
      setQuotaFeedback(message);
      activity.finish(false, message);
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
        <span>{t('identitySafety.policyDetails')}</span>
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
      <p className="identity-quota-note">{t('identitySafety.policyScopes')}</p>
    </div>
  );

  return (
    <section className="identity-page">
      <header className="cleanup-title">
        <h1>{t('身份管理')}</h1>
        <div className="identity-header-actions">
          <Button
            variant="secondary"
            size="small"
            disabled={actionLocked || loading}
            loading={loading}
            leftIcon={<Refresh aria-hidden size={16} className={loading ? 'spin' : ''} />}
            title={t('identityCard.localQuotaSync')}
            onClick={() => void read(false)}
          >
            {t('identityCard.localQuotaSync')}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="identity-menu-trigger" aria-label={t('identityCard.quotaMoreActions')} title={t('identityCard.quotaMoreActions')}>
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                <DropdownMenu.Item className="identity-menu-item" onSelect={() => setOnlinePanelOpen(true)}>
                  {t('identityCard.onlineQuery')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {batchBusy && <div className="identity-batch-task identity-batch-task-compact" role="status" aria-live="polite">
        <span>{t('quotaOnline.taskRunning', {completed: batchSummary.completed, total: batchSummary.total})}</span>
        {batchSummary.deadlineAtMs && <span>{t('quotaOnline.taskDeadline', {v0: Math.max(0, Math.ceil((batchSummary.deadlineAtMs - Date.now()) / 1000))})}</span>}
        {batchSummary.notRunCount ? <span>{t('quotaOnline.taskRemaining', {count: batchSummary.notRunCount})}</span> : null}
        <Button variant="secondary" size="small" onClick={() => setOnlinePanelOpen(true)}>
          {t('identityCard.onlineQuery')}
        </Button>
        <Button variant="secondary" size="small" disabled={batchCancelingRef.current} loading={batchCancelingRef.current} onClick={() => void cancelBatch()}>
          {t(batchCancelingRef.current ? 'quotaOnline.cancelling' : 'quotaOnline.cancelBatch')}
        </Button>
      </div>}

      <AppDialog
        open={onlinePanelOpen}
        onOpenChange={open => {setOnlinePanelOpen(open);if (!open) setForegroundAutoRefresh(false);}}
        title={t('identityCard.onlineQuery')}
        width={680}
        className="identity-online-query-dialog"
      >
        <div className="identity-online-query-controls">
          <Button
            variant="secondary"
            size="small"
            disabled={actionLocked || batchBusy || loading}
            loading={batchBusy}
            leftIcon={<Refresh aria-hidden size={16} className={batchBusy ? 'spin' : ''} />}
            title={t('quotaOnline.browserFallbackHint')}
            onClick={() => void refreshAllQuotas(true)}
          >
            {batchBusy && batchSummary.total > 0
              ? t('quotaOnline.queryingCount', {completed: batchSummary.completed, total: batchSummary.total})
              : t('identityCard.queryOnlineNow')}
          </Button>
          <label className="identity-auto-refresh-toggle" title={t('identityCard.foregroundAutoRefreshHint')}>
            <Switch
              checked={foregroundAutoRefresh}
              onCheckedChange={checked => setForegroundAutoRefresh(checked)}
              aria-label={t('identityCard.foregroundAutoRefresh')}
            />
            <span>{t('identityCard.foregroundAutoRefresh')}</span>
          </label>
        </div>
      <IdentityConnections
        items={connectionQueueItems}
        busy={batchBusy || busy || loading || !!state?.recovery}
        t={t}
        onOpen={target => void openAccountBrowser(target)}
        onRetry={targets => void refreshAllQuotas(true, targets)}
      />
      {!quotaDetails && (quotaFeedback || batchSummary.completed > 0) && <p className="identity-online-feedback" role="status">{quotaFeedback || formatBatchProgress(batchSummary, t)}{unverifiedQuotaTargets > 0 && <> · {t('quotaOnline.unverifiedTargets', {count:unverifiedQuotaTargets})}</>}</p>}
      </AppDialog>

      {error && (
        <p role="alert" className="cleanup-feedback error">
          {t(error)}
        </p>
      )}
      {state?.recovery && (
        <div className="identity-recovery" role="alert">
          <strong>{t('有一次身份切换尚未完成')}</strong>
          <Button size="small" variant="secondary" disabled={locked || loading} onClick={() => choose('recovery')}>
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
            <Button variant="secondary" size="small" disabled={blocked || current?.present === false} onClick={() => choose('empty')}>
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
            <span className="identity-onboarding-chip">{t('identitySafety.cliStep')}</span>
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
              <p className="identity-empty-note">{t('identitySafety.emptyGuide')}</p>
              <div className="identity-card-footer">
                <Button variant="secondary" size="small" disabled={blocked} onClick={() => void retryBrowser()}>
                  {t('打开内置浏览器')}
                </Button>
              </div>
            </IdentityCard>
          )}
          {(loading || current?.present) && (
            <IdentityCard className={`identity-card current ${state?.running ? 'running' : 'stopped'}`} running={state?.running} label={t('当前身份')}>
              <div className="identity-card-head">
                <div className="identity-avatar" aria-hidden="true">
                  {active?.name || current?.display_name || current?.email ? Array.from(currentName)[0]?.toUpperCase() : <ShieldCheck size={20} />}
                </div>
                <span className={`identity-live-badge ${state?.running ? 'running' : 'stopped'}`}>{loading ? t('检查中') : state?.running ? t('运行中') : t('进程已停止')}</span>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" className="identity-menu-trigger" aria-label={t('identityCard.moreActions')}>
                      ⋯
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                      <DropdownMenu.Item className="identity-menu-item" disabled={blocked} onSelect={() => void syncSubscription()}>
                        {t('identityCard.syncSubscription')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="identity-menu-item" disabled={blocked} onSelect={openSnapshot}>
                        {t(active ? '更新备份' : '保存备份')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="identity-menu-separator" />
                      <DropdownMenu.Item className="identity-menu-item danger" disabled={blocked} onSelect={() => confirmDelete('current')}>
                        {t('直接删除')}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <IdentityName name={currentName} email={current?.email} accountName={current?.display_name} plan={current?.plan} privacyMask={prefs.privacyMask} t={t} />
              <div className="identity-account identity-email-line">
                {current?.email ? (
                  <span className="identity-email" title={maskEmailAddress(current.email, prefs.privacyMask)}>{maskEmailAddress(current.email, prefs.privacyMask)}</span>
                ) : (
                  <span className="identity-account-unknown">{t(current?.unavailable ? '账号信息暂不可读' : '账号信息未识别')}</span>
                )}
              </div>
              {current?.auth_status === 'expired' && !hasRecentOnlineVerification('current', current.quota_identity) && (
                <div className="identity-meta-line" title={prefs.privacyMask ? undefined : current?.proxy || undefined}>
                  <span className="identity-meta-badge auth-expired">{t('identityCard.reauthRequired')}</span>
                </div>
              )}
              <IdentityQuota quota={currentQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {setQuotaDetails({id:active?.id || 'current', name:currentName});setQuotaFeedback('');}} />
              <SubscriptionAndResets meta={current} locale={locale} t={t} />
              <div className="identity-card-footer">
                <Button variant="secondary" size="small" disabled={blocked} onClick={openSnapshot}>
                  {t(active ? '更新备份' : '保存备份')}
                </Button>
              </div>
            </IdentityCard>
          )}
          {saved.map(row => {
            const summary = state?.summaries?.[row.id];
            const savedQuota = evaluateQuota(summary, nowSec);
            return (
              <IdentityCard className="identity-card" key={row.id} title={`${new Date(row.saved_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})} · ${formatBytes(row.bytes)}`}>
                <div className="identity-card-head">
                  <div className="identity-avatar" aria-hidden="true">
                    {Array.from(row.name)[0]?.toUpperCase()}
                  </div>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button type="button" className="identity-menu-trigger" aria-label={t('identityCard.moreActions')}>
                        ⋯
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          disabled={blocked}
                          onSelect={() => {
                            setRename(row);
                            setRenameValue(row.name);
                            setError('');
                          }}
                        >
                          {t('重命名')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="identity-menu-separator" />
                        <DropdownMenu.Item className="identity-menu-item danger" disabled={blocked} onSelect={() => confirmDelete(row)}>
                          {t('删除')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
                <IdentityName name={row.name} email={summary?.email} accountName={summary?.display_name} plan={summary?.plan} privacyMask={prefs.privacyMask} saved t={t} />
                <div className="identity-account identity-email-line saved">
                  {summary?.email ? <span className="identity-email" title={maskEmailAddress(summary.email, prefs.privacyMask)}>{maskEmailAddress(summary.email, prefs.privacyMask)}</span> : <span className="identity-account-unknown">{t('identityCard.emailUnavailable')}</span>}
                </div>
                {summary?.auth_status === 'expired' && !hasRecentOnlineVerification(row.id, summary.quota_identity) && (
                  <div className="identity-meta-line" title={prefs.privacyMask ? undefined : summary?.proxy || undefined}>
                    <span className="identity-meta-badge auth-expired">{t('identityCard.reauthRequired')}</span>
                  </div>
                )}
                <IdentityQuota quota={savedQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {setQuotaDetails({id:row.id, name:row.name});setQuotaFeedback('');}} />
                <SubscriptionAndResets meta={summary} locale={locale} t={t} />
                <div className="identity-card-footer">
                  <Button variant="secondary" size="small" disabled={blocked} onClick={() => choose(row)}>
                    {t('切换')}
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
            <span className="identity-policy-hint">{t('identitySafety.policyHint')}</span>
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
        open={quotaDetails !== null}
        onOpenChange={open => {if (!open && !busy) setQuotaDetails(null);}}
        title={t('quota.details')}
        description={t('quota.localOnly')}
        footer={<>
          <Button variant="secondary" disabled={busy || loading} onClick={() => void read(false)}>{t('quota.refreshLocal')}</Button>
          {detailsAreCurrent && (
            <Button variant="secondary" disabled={busy || loading || !state?.browser.enabled} onClick={() => void syncSubscription()}>{t('quota.syncSubscription')}</Button>
          )}
          <Button variant="secondary" loading={busy} disabled={busy || !detailsAreCurrent || !!state?.recovery} onClick={() => void openUsagePage()}>{t('quota.openOfficial')}</Button>
        </>}
      >
        <div className="identity-quota-details">
          <h3>{maskDisplayName(quotaDetails?.name, detailsSummary?.email, prefs.privacyMask)}</h3>
          {detailsSummary?.email && <p>{maskEmailAddress(detailsSummary.email, prefs.privacyMask)}</p>}
          <IdentityQuota quota={detailsQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} />
          {(['5h', '7d'] as const).map(window => {
            const source = detailsQuota?.[window === '5h' ? 'source5h' : 'source7d'];
            const observed = detailsSummary?.[`quota_${window}_source`] != null
              ? detailsSummary[`quota_${window}_observed_at_ms`]
              : detailsSummary?.quota_observed_at_ms;
            const age = formatObservationAge(quotaObservationAge(observed, nowSec * 1000));
            return <div key={window}>
              <div className="identity-confirm-target"><span>{window} · {t('quota.source')}</span><strong>{t(source === 'server_anchor' ? 'quota.serverSnapshot' : source === 'local_estimate' ? 'quota.estimated' : source === 'reset_inferred' ? 'quota.resetInferredSource' : 'quota.unverified')}</strong></div>
              <div className="identity-confirm-target"><span>{window} · {t('quota.observedAt')}</span><strong>{observed ? <>{new Date(observed).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}{age && <small className="identity-observation-age"> · {t('identitySearch.age.' + age.unit, {v0:age.value})}</small>}</> : t('identityCard.notProvided')}</strong></div>
            </div>;
          })}
          <p className="identity-quota-note">{t('quota.independentWindows')}</p>
          {(detailsQuota?.inferred5h || detailsQuota?.inferred7d) && <p className="identity-quota-note">{t('quota.resetInferredHint')}</p>}
          <div className="identity-confirm-target">
            <span>{t('quota.resetSchedule')}</span>
            <strong>
              {detailsSummary?.billing_date && (detailsSummary.billing_date_kind === 'next_renewal' || detailsSummary.billing_date_kind === 'access_until') ? (
                `${formatSubscriptionAndResets(detailsSummary, locale, t).billing?.label || t('identityCard.nextRenewal')}: ${new Date(detailsSummary.billing_date * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'})}`
              ) : (
                t('identityCard.notProvided')
              )}
            </strong>
          </div>
          {detailsSummary?.billing_date && (detailsSummary.billing_date_kind === 'next_renewal' || detailsSummary.billing_date_kind === 'access_until') && (
            <div className="identity-confirm-target">
              <span>{t('quota.billingObservedAt')}</span>
              <strong>
                {detailsSummary.billing_observed_at_ms || detailsSummary.metadata_observed_at_ms ? (
                  new Date(detailsSummary.billing_observed_at_ms ?? detailsSummary.metadata_observed_at_ms!).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
                ) : (
                  t('identityCard.notProvided')
                )}
              </strong>
            </div>
          )}
          <div className="identity-confirm-target">
            <span>{t('quota.resetCount')}</span>
            <strong>
              {typeof detailsSummary?.manual_resets_remaining === 'number' && Number.isInteger(detailsSummary.manual_resets_remaining) && detailsSummary.manual_resets_remaining >= 0 ? (
                t('identityCard.manualResetsCount', {count: detailsSummary.manual_resets_remaining, v0: detailsSummary.manual_resets_remaining})
              ) : (
                t('identityCard.notProvided')
              )}
            </strong>
          </div>
          {typeof detailsSummary?.manual_resets_remaining === 'number' && Number.isInteger(detailsSummary.manual_resets_remaining) && detailsSummary.manual_resets_remaining >= 0 && (
            <div className="identity-confirm-target">
              <span>{t('quota.manualResetsObservedAt')}</span>
              <strong>
                {detailsSummary.manual_resets_observed_at_ms || detailsSummary.metadata_observed_at_ms ? (
                  new Date(detailsSummary.manual_resets_observed_at_ms ?? detailsSummary.metadata_observed_at_ms!).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
                ) : (
                  t('identityCard.notProvided')
                )}
              </strong>
            </div>
          )}
          {detailsSavedRecord && (
            <>
              <div className="identity-confirm-target">
                <span>{t('quota.backupArchive')}</span>
                <strong>{formatBytes(detailsSavedRecord.bytes)}</strong>
              </div>
              <div className="identity-confirm-target">
                <span>{t('quota.savedAt')}</span>
                <strong>{new Date(detailsSavedRecord.saved_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</strong>
              </div>
            </>
          )}
          <p className="identity-quota-note">{t('quota.resetHint')}</p>
          <div className="identity-confirm-target"><span>{t('quotaSetup.status')}</span><strong>{t(quotaSetupError ? 'quotaSetup.unavailable' : !quotaSetup ? 'quotaSetup.checking' : 'quotaSetup.' + quotaSetup.state)}</strong></div>
          <p className="identity-quota-note">{t(quotaSetup?.collector_bundled ? 'quotaSetup.runtimeUnverified' : 'quotaSetup.notBundled')}</p>
          <Disclosure summary={t('quotaSetup.guideTitle')}><p className="identity-quota-note">{t('quotaSetup.guide')}</p></Disclosure>
          <Button variant="secondary" onClick={() => void copyQuotaDiagnostic()}>{t('identityDiagnostic.copy')}</Button>
          {copyDiagnosticStatus && <p role={copyDiagnosticStatus === 'failed' ? 'alert' : 'status'}>{t(copyDiagnosticStatus === 'copied' ? 'identityDiagnostic.copied' : 'identityDiagnostic.failed')}</p>}
          {!detailsAreCurrent && <p className="identity-quota-note">{t('quota.currentOnly')}</p>}
          {quotaFeedback && <p role="status">{t(quotaFeedback)}</p>}
        </div>
      </AppDialog>
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
            <Button variant="secondary" disabled={busy || loading || !state || !name.trim() || !!state.recovery || !state.current.present} onClick={() => void saveSnapshot()}>
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
                {maskEmailAddress(current.email, prefs.privacyMask)}
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
        description={t(review === 'recovery' ? 'identitySafety.recoveryHint' : '先压缩暂存当前 Claude Code 与 Desktop 状态，再切换。将结束已识别的 Claude 进程，未保存任务会中断。')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)}>
              {t('取消')}
            </Button>
            <Button variant="secondary" disabled={busy || loading || !state || !name.trim() || (review !== 'recovery' && !!state.recovery)} onClick={() => void change()}>
              {review === 'recovery' ? t('确认恢复') : t('确认暂存并切换')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <label htmlFor="identity-current-name">{t('当前身份保存为')}</label>
          <Input id="identity-current-name" maxLength={64} value={name} onChange={e => setName(e.target.value)} />
          {review === 'recovery' && <div className="identity-confirm-target"><span>{t('identitySafety.restoreIdentity')}</span><strong>{maskDisplayName(recoveryRecord?.name, undefined, prefs.privacyMask) || t('identitySafety.originalUnavailable')}</strong></div>}
          {typeof review === 'object' && review && (
            <div className="identity-confirm-target">
              <span>{t('目标身份')}</span>
              <strong>
                {maskDisplayName(review.name, targetSummary?.email, prefs.privacyMask)}
                {targetSummary?.email ? ` · ${maskEmailAddress(targetSummary.email, prefs.privacyMask)}` : ''}
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
                <li>{t('identitySafety.browserSignIn')}</li>
                <li>{t('identitySafety.cliStep')}</li>
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
            <Button className="identity-delete-button" variant="secondary" disabled={busy || !accepted} onClick={() => void remove()}>
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
              {(state?.sessions?.length ?? 0) > 0 && <div className="identity-confirm-sessions">
                <span>{t('identitySafety.deleteSessions')}</span>
                <ul>{state!.sessions.map(session => <li key={session.pid}><code>PID {session.pid}</code><span>{session.entrypoint}</span>{session.workspace && <strong>{session.workspace}</strong>}</li>)}</ul>
              </div>}
              <div className="identity-confirm-keep">
                <span>{t('留在工作区')}</span>
                <strong>{kept.join(' · ') || t('无')}</strong>
              </div>
            </>
          ) : (
            <strong>{maskDisplayName(deletion?.name, undefined, prefs.privacyMask)}</strong>
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
            <Button variant="secondary" disabled={busy} loading={busy} onClick={() => void configureBrowser()}>
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
            <Button variant="secondary" disabled={busy || !renameValue.trim()} onClick={() => void saveName()}>
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
function IdentityCard({className, children, label, title, running}: {className: string; children: ReactNode; label?: string; title?: string; running?: boolean}) {
  return (
    <article
      className={className}
      aria-label={label}
      title={title}
      data-running={running !== undefined ? (running ? "true" : "false") : undefined}
    >
      {children}
    </article>
  );
}
