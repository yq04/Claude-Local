/**
 * [INPUT]: 原生身份命令、轻量实时会话存活命令（identities_live_sessions，含 cli-slots 子代理槽位、后台守护标记 background、前台交互子 Shell child_shells 与待接管任务 active_adopt_jobs）、可选编排状态/清冷却/安装与最新交接检查点命令（identities_orchestrator_* / identities_sync_browser_proxy / identities_latest_handoff / identities_install_cli_wrappers）、手动/自动订阅到期、充值日与套餐层级校准命令（manualPlan）、可恢复的原生额度批次状态/取消、5h到期自动续杯配置/状态、Ultra无上限/Fable专项池/离线刷新凭据到期元数据、智能接力池摘要与悬浮窗穿透态、保留策略、逐窗观测、隐私偏好、顶部横条卡片拖拽排序、跨页卡片定位及本地额度修订轮询。
 * [OUTPUT]: 同风格计数的166×286 CLI身份/养号工牌（语义套餐色标 Free/Pro/Max/Ultra/Team、72h临期提醒、清晰区分当前使用/CLI运行中/桌面端运行与脉冲子代理槽位状态、快速筛选与可选多行平铺、切换前三态运行中CLI引导［后台守护无损保活挂起 / 前台子Shell防断管告警 / 标准无感接力直达］、顶部横条拖拽排序与共享弹簧滚轮）、单滚动容器无嵌套双滚的智能接力与自动续杯弹窗（2分区账号行、语义5h/7d微缩条、CLI 与绑定浏览器槽位代理对齐警告及一键同步至浏览器 `[data-relay-sync-browser-proxy]`、≥3号同出口聚集温和提示 `[data-relay-exit-cluster-hint]`、CLI 无感接力分组卡可选 handoffReason 胶囊、同轴全宽路由分组卡、80%~100%换号阈值、OpusPlan模型说明、重置卡一键同步验证与差值回执、未入库当前号提示、错峰打开多号用量页）、额度详情5h/7d燃尽ETA/套餐校准与只读KYC核验状态（含观测相对时间与 expired/failed 区分）、跨机防关联环境交接卡复制及悬浮窗穿透态恢复。
 * [POS]: 身份管理 GUI；额度工作由原生任务所有，页面挂载只恢复运行中的在线批次，导航不取消工作，身份破坏性操作在批次期间锁定；后台 revision 触发的读取在原生快照内容未变时保留现有状态对象，避免整页重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {Button, Checkbox, Disclosure, Input, Switch, useReducedMotionConfig} from 'cromma-ui';
import {DropdownMenu} from 'radix-ui';
import {listen} from '@tauri-apps/api/event';
import {addOneCalendarMonthYmd, epochSecToCalendarYmd, formatOnlineQuotaStatus, formatSubscriptionAndResets, formatSubscriptionExpiryBadge, formatYmdAsShortMd, ForegroundQuotaScheduler, isExpectedCurrentTarget, isExpectedSavedTarget, isValidCalendarYmd, buildBatchTargets, buildStaleOrUnknownBatchTargets, generateBatchRequestId, formatBatchProgress, isSuccessfulOnlineResult, aggregateBatchProgress, summarizeBatchResult, isTerminalBatchState, isMatchingBatchTarget, readNativeWakeupSnapshot, subscribeNativeWakeup, configureNativeWakeup, resumeNativeWakeup, formatMinuteOfDay, parseMinuteOfDay, isConfirmedNewWakeup5h, type OnlineQuotaResult, type OnlineQuotaStatus, type BatchQuotaResult, type QuotaBatchProgress, type BatchProgressSummary, type QuotaBatchTarget, type AutoWakeupConfig, type SubscriptionExpiryBadge} from './identity-online-quota';
import type {IdentitySubscriptionMetadata} from './identity-model';
import {WarmingLibrary} from './warming-cards';
import {CURRENT_IDENTITY_ORDER_TOKEN, IDENTITY_CARD_ORDER_STORAGE_KEY, useCardRailReorder, useHorizontalRailWheelScroll} from './card-order';
import type {WarmingCard, WarmingFields, WarmingOpenMode} from './warming-model';
import type {BrowserState} from './browser-model';
import {useBrowserRuntime} from './use-browser-runtime';
import {formatWakeupWait, presentWakeupAccount, verifyWakeupAnchorAdvancement, type WakeupAnchorVerificationResult} from './wakeup-presentation';
import {CheckTickCircle, ShieldCheck, Refresh} from 'cromma-ui/pika';
import {invoke} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {IdentityOperationProgress, recordAuditHistoryItem, useCleanupActivity} from './cleaner-activity';
import {formatBytes} from './cleaner-model';
import {ClaudeCliPanel} from './claude-cli-panel';
import {ClaudeResiduePanel} from './claude-residue-panel';
import {collectInteractiveChildShells, defaultPolicy, isBackgroundOnlyState, normalizeAdoptJobIds, policyRows, type ActiveSession, type Identity, type IdentityState, type LiveSessionsSnapshot} from './identity-model';
import {maskDisplayName, maskEmailAddress, usePreferences} from './settings-model';
import {evaluateQuota, formatCompactEta, formatElapsedSinceReset, formatResetClock, type WeeklyPace} from './identity-quota';
import {usePageRefresh, type IdentityReviewRequest} from './app-events';
import {formatObservationAge, quotaObservationAge} from './identity-list';
import {serializeIdentityDiagnostic} from './identity-diagnostics';
import {connectionHistory, IdentityConnections, isValidQuotaTargetSubset} from './identity-connections';
import {toBrowserSocks5ProxyFromCli, toCliHttpProxy} from './risk-model';
import {MONITOR_BUS_CHANNEL, postMonitorBusMessage, writeMonitorRelayStandbyHint, type MonitorBusMessage, type MonitorWindowState} from './floating-monitor-model';
import {
  useSmartRelayConfig,
  useCliDefaultProxy,
  canSyncNativeSmartRelay,
  updateSmartRelayConfig,
  resetSmartRelayConfig,
  syncNativeSmartRelayConfigIfLive,
  flushNativeSmartRelaySync,
  evaluateSmartRelay,
  extractResetCardInfo,
  isAccountInCooldown,
  isSlotBrowserProxyAligned,
  summarizeRelayPool,
  computeResetCardExpiryUrgency,
  computeWindowBurnEta,
  normalizePlanSlug,
  noteRelayAccountRateLimited,
  noteRelayAccountSwitch,
  clearAccountCooldown,
  formatTruthfulPercent,
  validateSlotHttpProxy,
  findSameExitClusterWarning,
  buildSubagentMarkdownTemplate,
  getRelayLaunchDirs,
  useRelayLaunchDirs,
  recordRelayLaunchDir,
  removeRelayLaunchDir,
  formatLaunchDirChip,
  formatRelayCliModelEffortArgs,
  relayCliModelDisplayLabel,
  CANONICAL_MANUAL_PLANS,
  RELAY_CLI_EFFORTS,
  RELAY_CLI_MODELS,
  RELAY_STRATEGIES,
  RELAY_RATE_LIMIT_MODES,
  RELAY_AFFINITY_MODES,
  RELAY_SPENT_THRESHOLDS,
  RELAY_HANDOFF_MODES,
  type HandoffSummary,
  type RelayAccountInput,
  type RelayCandidate,
} from './smart-relay-model';
import './identity-productivity.css';
import './floating-monitor.css';

type Target = Identity | 'empty' | 'recovery';
type QuotaSetupStatus={state:'not_configured'|'custom_statusline'|'invalid_settings_path'|'invalid_settings_json'|'invalid_statusline';collector_bundled:boolean;has_statusline:boolean};

let persistedWakeupAnchorMap: Record<string, WakeupAnchorVerificationResult> = {};

function QuotaWindow({label, used, remaining, resetAt, inferredResetAt = null, resetComplete = false, inferred = false, noLimit = false, known, level, display, nowSec, pace = null, inDialog = false, t}: {label: string; used: number; remaining: number; resetAt: number | null; inferredResetAt?: number | null; resetComplete?: boolean; inferred?: boolean; noLimit?: boolean; known: boolean; level: string; display: 'remaining' | 'used'; nowSec: number; pace?: WeeklyPace | null; inDialog?: boolean; t: (key: string, slots?: Record<string, string | number>) => string}) {
  const value = display === 'used' ? used : remaining;
  const reset = resetAt ? formatResetClock(resetAt, true) : '';
  const countdown = formatCompactEta(resetAt, nowSec);
  const inferredClock = inferred && inferredResetAt ? formatResetClock(inferredResetAt, true) : '';
  const inferredElapsed = inferred && inferredResetAt ? formatElapsedSinceReset(inferredResetAt, nowSec) : '';
  const inferredStatusLabel = inferred
    ? t(display === 'used' ? 'identityCard.resetInferredUsed' : 'identityCard.resetInferredRemaining')
    : '';
  const inferredTimeSummary = inferred && inferredClock
    ? (inferredElapsed ? t('identityCard.resetInferredElapsed', {clock: inferredClock, elapsed: inferredElapsed}) : inferredClock)
    : '';
  const resetPrefix = t('identityCard.reset').trim();
  const resetLabel = noLimit
    ? t('quota.unlimitedHint')
    : inferred
      ? label
      : reset ? (resetPrefix ? `${resetPrefix} ${reset}` : reset) : resetComplete ? t('identityCard.windowExpired') : t('identityCard.resetUnavailable');
  const rightMeta = noLimit ? '' : countdown || (inferred ? (inDialog && inferredTimeSummary ? `${label} · ${inferredTimeSummary}` : label) : '');
  const resetTooltip = noLimit
    ? t('quota.unlimitedHint')
    : countdown
      ? `${resetLabel} · ${countdown}`
      : inferred && inferredTimeSummary
        ? `${inferredStatusLabel} · ${inferredTimeSummary}`
        : inferredClock
          ? `${resetLabel} · ${inferredClock}`
          : resetLabel;
  const resetDate = resetAt == null ? null : new Date(resetAt * 1000);
  const resetDateTime = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;
  const paceExpected = pace ? (display === 'used' ? pace.expectedUsedPct : pace.expectedRemPct) : null;
  const clockIcon = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><path d="M8 4.5V8l2.2 1.4" /></svg>;
  const pctText = formatTruthfulPercent(value);
  const ariaLabel = noLimit
    ? `${label} ${t('identityCard.unlimited')}`
    : `${label} ${known ? `${t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')} ${pctText}` : t('identityCard.quotaUnknown')}${inferred ? ` · ${resetLabel}` : ''}`;
  return (
    <div className={`identity-quota-window ${known ? `quota-${level}` : 'quota-unknown'}`} data-quota-window={label} data-quota-inferred={inferred || undefined} data-quota-unlimited={noLimit || undefined} title={inferred ? t('quota.resetInferredHint') : undefined} aria-label={ariaLabel}>
      <div className="identity-quota-copy">
        <strong>{label}</strong>
        <span className="identity-quota-value">{noLimit ? <strong>{t('identityCard.unlimited')}</strong> : known ? <><span>{t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')}</span>{' '}<strong>{pctText}</strong></> : t('identityCard.unknown')}</span>
      </div>
      <span className={`identity-quota-track ${inferred ? "quota-track-inferred" : ""}`} role="img" aria-label={noLimit ? t('identityCard.unlimited') : known ? pctText : t('identityCard.quotaUnknown')}>
        {known && <i style={{width: `${noLimit ? 100 : Math.max(0, Math.min(100, value))}%`}} />}
        {known && !noLimit && !inferred && pace && !pace.suppressed && paceExpected !== null && (
          <b
            className={`identity-quota-pace-tick${pace.ahead ? ' ahead' : ''}`}
            style={{left: `${Math.max(2, Math.min(98, paceExpected))}%`}}
            title={t('quota.paceTickLabel', {expected: paceExpected})}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="identity-quota-reset" title={resetTooltip}>
        <span className="identity-quota-reset-label">{noLimit ? resetLabel : reset ? <>{clockIcon}<time className="identity-reset-time" dateTime={resetDateTime} aria-label={resetLabel}>{reset}</time></> : inferred ? <>{clockIcon}<span>—</span></> : resetLabel}</span>
        {rightMeta && <span className="identity-quota-countdown">{rightMeta}</span>}
      </span>
    </div>
  );
}

function IdentityQuota({quota, display, nowSec, inDialog = false, t, onOpenDetails}: {quota: ReturnType<typeof evaluateQuota>; display: 'remaining' | 'used'; nowSec: number; inDialog?: boolean; t: (key: string, slots?: Record<string, string | number>) => string; onOpenDetails?: () => void}) {
  return (
    <div className="identity-quota-stack identity-quota-open" data-identity-quota tabIndex={0} role="button" aria-label={t('quota.details')} onClick={onOpenDetails} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails?.(); }}}>
      <QuotaWindow label="5h" used={quota?.used5h ?? 0} remaining={quota?.rem5h ?? 0} resetAt={quota?.r5 ?? null} inferredResetAt={quota?.inferredReset5h ?? null} resetComplete={quota?.expired5h} inferred={quota?.inferred5h} noLimit={Boolean(quota?.no5hLimit)} known={quota?.known5h ?? false} level={quota?.level5h ?? 'ok'} display={display} nowSec={nowSec} inDialog={inDialog} t={t} />
      <QuotaWindow label="7d" used={quota?.used7d ?? 0} remaining={quota?.rem7d ?? 0} resetAt={quota?.r7 ?? null} inferredResetAt={quota?.inferredReset7d ?? null} resetComplete={quota?.expired7d} inferred={quota?.inferred7d} known={quota?.known7d ?? false} level={quota?.level7d ?? 'ok'} display={display} nowSec={nowSec} pace={quota?.pace7d ?? null} inDialog={inDialog} t={t} />
    </div>
  );
}

function SubscriptionAndResets({meta, locale, showBilling = false, nowSec, t}: {meta: IdentitySubscriptionMetadata | null | undefined; locale: string; showBilling?: boolean; nowSec?: number; t: (key: string, slots?: Record<string, string | number>) => string}) {
  const nowMs = typeof nowSec === 'number' ? nowSec * 1000 : Date.now();
  const display = formatSubscriptionAndResets(meta, locale, t, nowMs);
  const billing = showBilling ? display.billing : null;
  // Resets known to have ended are hidden; otherwise the last synced count is shown as-is.
  const manualResets = display.manualResets && !display.manualResets.ended ? display.manualResets : undefined;
  if (!billing && !manualResets) return null;
  const resetUrgency = manualResets && manualResets.usable && manualResets.urgency !== 'normal' ? manualResets.urgency : undefined;
  const resetUrgencyTitle = resetUrgency && manualResets?.realExpiresAt
    ? t('quota.manualResetsExpiringSoon', {countdown: formatCompactEta(manualResets.realExpiresAt, Math.floor(nowMs / 1000))})
    : undefined;
  return (
    <div className="identity-sub-resets-block">
      {billing && (
        <div className="identity-sub-resets-row">
          <strong>{billing.label}</strong>
          <span>{billing.formattedDate}</span>
        </div>
      )}
      {manualResets && (
        <div className="identity-sub-resets-row" data-reset-urgency={resetUrgency} title={resetUrgencyTitle}>
          <strong>{manualResets.label}</strong>
          <span>{t('identityCard.manualResetsCount', {count: manualResets.remaining, v0: manualResets.remaining})}</span>
        </div>
      )}
    </div>
  );
}

function computeExpiryUrgency(expiry: SubscriptionExpiryBadge | null | undefined, nowSec?: number): 'soon' | 'expired' | undefined {
  if (!expiry || typeof nowSec !== 'number') return undefined;
  const parts = expiry.fullYmd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return undefined;
  const [yy, mm, dd] = parts;
  const endOfDaySec = Math.floor(new Date(yy, mm - 1, dd, 23, 59, 59).getTime() / 1000);
  const delta = endOfDaySec - nowSec;
  if (delta <= 0 && expiry.source !== 'browser') return 'expired';
  if (delta > 0 && delta <= 72 * 3600) return 'soon';
  return undefined;
}

function IdentityName({name, email, accountName, plan, expiry = null, nowSec, onEditExpiry, privacyMask, saved = false, t}: {name: string; email?:string|null; accountName?: string | null; plan?: string | null; expiry?: SubscriptionExpiryBadge | null; nowSec?: number; onEditExpiry?: () => void; privacyMask: boolean; saved?: boolean; t: (key: string, slots?: Record<string, string | number>) => string}) {
  const shownName = maskDisplayName(name, email, privacyMask);
  const description = !privacyMask && accountName && accountName !== name ? `${t('identityCard.accountName')}: ${accountName}` : undefined;
  const hasPlan = Boolean(plan && plan.trim().length > 0);
  const expiryUrgency = computeExpiryUrgency(expiry, nowSec);
  const expiryTooltip = expiry
    ? expiryUrgency === 'expired'
      ? t('identityCard.expiryExpiredTooltip', {expiry: expiry.fullYmd})
      : expiryUrgency === 'soon'
        ? t('identityCard.expirySoonTooltip', {expiry: expiry.fullYmd})
        : expiry.rechargeYmd
          ? t('identityCard.expiryTooltipWithRecharge', {expiry: expiry.fullYmd, recharge: expiry.rechargeYmd})
          : expiry.source === 'browser'
            ? t('identityCard.renewalTooltip', {expiry: expiry.fullYmd})
            : t('identityCard.expiryTooltip', {expiry: expiry.fullYmd})
    : undefined;
  return (
    <h3 className="identity-name-with-label" data-identity-name data-identity-username={!saved || undefined} data-identity-saved-name={saved || undefined} aria-label={shownName} aria-description={description}>
      <strong title={description ? `${shownName}\n${description}` : shownName}>{shownName}</strong>
      {hasPlan && (
        <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(plan)}>
          {plan}
        </span>
      )}
      {expiry && (
        <span
          className={`identity-expiry-tag${onEditExpiry ? ' is-clickable' : ''}`}
          data-identity-expiry
          data-urgency={expiryUrgency}
          role={onEditExpiry ? 'button' : undefined}
          tabIndex={onEditExpiry ? 0 : undefined}
          title={expiryTooltip}
          onClick={onEditExpiry ? e => { e.stopPropagation(); onEditExpiry(); } : undefined}
          onKeyDown={onEditExpiry ? e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onEditExpiry();
            }
          } : undefined}
        >
          {expiry.shortMd}
        </span>
      )}
    </h3>
  );
}

interface ExpiryEditorState {
  accountId: string;
  expectedIdentity: string | null;
  label: string;
  email: string | null;
  plan: string | null;
  manualPlan: string;
  initialManualPlan: string;
  rechargeYmd: string;
  expiryYmd: string;
  initialRechargeYmd: string;
  initialExpiryYmd: string;
  browserSyncedShortMd: string | null;
  browserSyncedFullYmd: string | null;
  hasManual: boolean;
  error: string;
}

function sameStringArrays(a?: readonly string[] | null, b?: readonly string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function sameActiveSessions(a: readonly ActiveSession[], b: readonly ActiveSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].pid !== b[i].pid ||
      a[i].entrypoint !== b[i].entrypoint ||
      a[i].workspace !== b[i].workspace ||
      Boolean(a[i].background) !== Boolean(b[i].background) ||
      !sameStringArrays(a[i].child_shells, b[i].child_shells)
    ) {
      return false;
    }
  }
  return true;
}

function sameSlotSessions(
  a?: Record<string, ActiveSession[]>,
  b?: Record<string, ActiveSession[]>,
): boolean {
  const aKeys = Object.keys(a ?? {}).filter(k => (a![k]?.length ?? 0) > 0).sort();
  const bKeys = Object.keys(b ?? {}).filter(k => (b![k]?.length ?? 0) > 0).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i] || !sameActiveSessions(a![key], b![key])) {
      return false;
    }
  }
  return true;
}

function canQueryLiveSessions(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & {
    __TAURI_INTERNALS__?: {metadata?: unknown};
    identityFixture?: {supportsLiveSessions?: boolean};
  };
  return Boolean(win.__TAURI_INTERNALS__?.metadata) || Boolean(win.identityFixture?.supportsLiveSessions);
}

type CardFilterKind = 'all' | 'ready' | 'reset_cards' | 'expiring' | 'live';

export function IdentityPanel({
  onBusy,
  initialEmpty = false,
  identityReviewRequest = null,
  onIdentityReviewConsumed,
  focusAccountRequest = null,
  onFocusAccountConsumed,
  openRelayRequest = 0,
}: {
  onBusy?: (busy: boolean) => void;
  initialEmpty?: boolean;
  identityReviewRequest?: IdentityReviewRequest | null;
  onIdentityReviewConsumed?: (requestId: number) => void;
  focusAccountRequest?: {accountId: string; requestId: number} | null;
  onFocusAccountConsumed?: (requestId: number) => void;
  openRelayRequest?: number;
}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const [state, setState] = useState<IdentityState | null>(null);
  const [cardFilter, setCardFilter] = useState<CardFilterKind>('all');
  const [gridWrap, setGridWrap] = useState(false);
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const lastOpenRelayReqRef = useRef(openRelayRequest);
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
  const [warmingPromotion, setWarmingPromotion] = useState<WarmingCard | null>(null);
  const [warmingModalOpen, setWarmingModalOpen] = useState(false);
  const [returnCliBrowser, setReturnCliBrowser] = useState<{expectedIdentity: string; name: string} | null>(null);
  const [snapshot, setSnapshot] = useState(false);
  const [name, setName] = useState(t('当前身份'));
  const [rename, setRename] = useState<Identity | null>(null),
    [renameValue, setRenameValue] = useState('');
  const [expiryEditor, setExpiryEditor] = useState<ExpiryEditorState | null>(null);
  const [deleteBrowser, setDeleteBrowser] = useState(false);
  const [deletion, setDeletion] = useState<Identity | 'current' | null>(null),
    [accepted, setAccepted] = useState(false);
  type QuotaFeedbackEntry =
    | ''
    | string
    | {key: string; values?: Record<string, string | number>}
    | {render: (tr: typeof t) => string};
  const [quotaDetails, setQuotaDetails] = useState<{id:string;name:string;expectedIdentity:string|null}|null>(null);
  const [quotaFeedback, setQuotaFeedback] = useState<QuotaFeedbackEntry>('');
  const [suppressQuotaRestoreFocus, setSuppressQuotaRestoreFocus] = useState(false);
  const quotaOpenerRef = useRef<HTMLElement | null>(null);
  const [quotaSetup, setQuotaSetup] = useState<QuotaSetupStatus|null>(null);
  const [quotaSetupError, setQuotaSetupError] = useState(false);
  const [copyDiagnosticStatus, setCopyDiagnosticStatus] = useState<'copied'|'failed'|null>(null);
  const [readReady, setReadReady] = useState(false);
  const [diagnosticVersion, setDiagnosticVersion] = useState<string|null>(null);
  const [foregroundAutoRefresh, setForegroundAutoRefresh] = useState(false);
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);
  const [relayPanelOpen, setRelayPanelOpen] = useState(false);
  const [cliWrappersBusy, setCliWrappersBusy] = useState(false);
  const [launchRelayBusy, setLaunchRelayBusy] = useState(false);
  const [launchCwdDraft, setLaunchCwdDraft] = useState('');
  const [cliWrappersFeedback, setCliWrappersFeedback] = useState<{text: string; isError?: boolean} | null>(null);
  const [slotProxyDrafts, setSlotProxyDrafts] = useState<Record<string, string>>({});
  const [slotProxyErrors, setSlotProxyErrors] = useState<Record<string, string>>({});
  const [expandedProxyIds, setExpandedProxyIds] = useState<Record<string, boolean>>({});
  const [syncingBrowserProxyIds, setSyncingBrowserProxyIds] = useState<Record<string, boolean>>({});
  const [browserProxySyncFeedback, setBrowserProxySyncFeedback] = useState<Record<string, {text: string; isError?: boolean}>>({});
  const [latestHandoff, setLatestHandoff] = useState<HandoffSummary | null>(null);
  const focusedSlotProxyIdRef = useRef<string | null>(null);
  const [syncCliBrowserOnSwitch, setSyncCliBrowserOnSwitch] = useState(true);
  const smartRelay = useSmartRelayConfig();
  const cliDefaultProxy = useCliDefaultProxy();
  const recentLaunchDirs = useRelayLaunchDirs();
  const nativeWakeup = useSyncExternalStore(subscribeNativeWakeup, readNativeWakeupSnapshot);
  const autoWakeConfig = nativeWakeup.config;
  const autoWakeState = nativeWakeup;
  const [autoWakeSaving, setAutoWakeSaving] = useState(false);
  const autoWakeSavingRef = useRef(false);
  const pendingAutoWakePatchRef = useRef<Partial<AutoWakeupConfig> | null>(null);
  const adoptedTerminalBatchIdRef = useRef<string | null>(null);
  const [wakingAccountId, setWakingAccountId] = useState<string | null>(null);
  const [wakeupAnchorMap, setWakeupAnchorMap] = useState<Record<string, WakeupAnchorVerificationResult>>(() => persistedWakeupAnchorMap);
  const wakingRef = useRef(false);
  const [syncedFeedback, setSyncedFeedback] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncingAccountIds, setSyncingAccountIds] = useState<Record<string, boolean>>({});
  const syncingIdsRef = useRef<Record<string, boolean>>({});
  const hasActiveSync = Object.keys(syncingAccountIds).length > 0;
  const syncedTimerRef = useRef<number | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);
  batchBusyRef.current = batchBusy;
  const [batchCanceling, setBatchCanceling] = useState(false);
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
  const lastAdoptedBatchSigRef = useRef<string | null>(null);
  const lastSerializedRelayHintRef = useRef<string | undefined>(undefined);
  const lastHudTelemetrySigRef = useRef<string | undefined>(undefined);
  const prevTargetSetKeyRef = useRef<string | null>(null);
  const batchResultsMapRef = useRef<Record<string, OnlineQuotaResult>>({});
  const batchSummaryRef = useRef(batchSummary);
  batchSummaryRef.current = batchSummary;
  const readSeqRef = useRef(0);
  const schedulerRef = useRef<ForegroundQuotaScheduler | null>(null);
  const lockedRef = useRef(false);
  const busyRef = useRef(false);
  const activity = useCleanupActivity();
  const [showCleanroomBar, setShowCleanroomBar] = useState(false);
  const warmingActivity = useCleanupActivity();
  const rail = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotionConfig() ?? false;
  const warmingBlocked = busy || hasActiveSync || cliBusy || residueBusy || !!review || snapshot || !!rename || !!expiryEditor || !!deletion || browserReview !== null || quotaDetails !== null || batchBusy || loading || !state || !!returnCliBrowser;
  const locked = busy || cliBusy || residueBusy || !!review || snapshot || !!rename || !!expiryEditor || !!deletion || browserReview !== null || quotaDetails !== null || warmingModalOpen || !!returnCliBrowser;
  const actionLocked = busy || cliBusy || residueBusy || !!review || snapshot || !!rename || !!expiryEditor || !!deletion || browserReview !== null || warmingModalOpen || !!returnCliBrowser;
  const browserRuntime = useBrowserRuntime(state?.active_browser_slot || state?.warming_cards?.find(card => card.browser_active)?.slot, !!state && !busy);
  lockedRef.current = locked;
  busyRef.current = busy;
  const actionLockedRef = useRef(false);
  actionLockedRef.current = actionLocked;
  const mountedRef = useRef(true);
  const [copiedBgResume, setCopiedBgResume] = useState(false);
  const bgResumeCopyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (syncedTimerRef.current !== null) window.clearTimeout(syncedTimerRef.current);
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
      if (bgResumeCopyTimerRef.current !== null) window.clearTimeout(bgResumeCopyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (openRelayRequest > 0 && openRelayRequest !== lastOpenRelayReqRef.current) {
      lastOpenRelayReqRef.current = openRelayRequest;
      setRelayPanelOpen(true);
    }
  }, [openRelayRequest]);
  const tRef = useRef(t);
  tRef.current = t;
  const stateRef = useRef(state);
  stateRef.current = state;
  function resolveRelayAccountId(accountId: string, expectedIdentity?: string | null): string {
    if (accountId !== 'current') return accountId;
    const snap = stateRef.current;
    if (snap?.active && /^[0-9a-f]{32}$/i.test(snap.active)) {
      return snap.active;
    }
    const fp = (expectedIdentity ?? snap?.current?.quota_identity ?? '').trim().toLowerCase();
    if (fp && snap?.records && snap.summaries) {
      const matched = snap.records.find(
        rec => (snap.summaries[rec.id]?.quota_identity ?? '').trim().toLowerCase() === fp,
      );
      if (matched?.id) return matched.id;
    }
    if (snap?.active && snap.active !== 'current') {
      return snap.active;
    }
    return 'current';
  }
  function commitAuthoritativeState(next: IdentityState) {
    ++readSeqRef.current;
    stateRef.current = next;
    setState(next);
  }
  const quotaFeedbackText = quotaFeedback
    ? typeof quotaFeedback === 'string'
      ? t(quotaFeedback)
      : 'render' in quotaFeedback
        ? quotaFeedback.render(t)
        : t(quotaFeedback.key, quotaFeedback.values)
    : '';
  const liveSessionsInFlightRef = useRef<Promise<void> | null>(null);
  const lastLiveSessionsAtRef = useRef(0);
  async function refreshLiveSessions(force = false): Promise<void> {
    if (!canQueryLiveSessions() || !mountedRef.current || busyRef.current) return;
    const isFixtureEnv = typeof window !== 'undefined' && 'identityFixture' in window;
    const throttleMs = isFixtureEnv ? 0 : 400;
    const now = Date.now();
    if (!force && now - lastLiveSessionsAtRef.current < throttleMs) return;
    if (liveSessionsInFlightRef.current) return liveSessionsInFlightRef.current;
    const task = (async () => {
      try {
        const snap = await invoke<LiveSessionsSnapshot>('identities_live_sessions');
        lastLiveSessionsAtRef.current = Date.now();
        if (!mountedRef.current || busyRef.current || !snap || typeof snap.running !== 'boolean') return;
        const sessions = Array.isArray(snap.sessions) ? snap.sessions : [];
        const slotSessions =
          snap.slot_sessions && typeof snap.slot_sessions === 'object' ? snap.slot_sessions : undefined;
        const cliRunning = typeof snap.cli_running === 'boolean'
          ? snap.cli_running
          : snap.running && sessions.some(s => s.entrypoint !== 'Claude Desktop');
        const backgroundOnly = typeof snap.background_only === 'boolean'
          ? snap.background_only
          : isBackgroundOnlyState({sessions});
        const hasAdoptJobsField = Array.isArray(snap.active_adopt_jobs);
        const normalizedAdoptJobs = hasAdoptJobsField
          ? normalizeAdoptJobIds(snap.active_adopt_jobs)
          : undefined;
        setState(previous => {
          if (!previous) return previous;
          const prevCli = previous.cli_running ?? (previous.running && (previous.sessions?.some(s => s.entrypoint !== 'Claude Desktop') ?? false));
          const nextAdoptJobs = hasAdoptJobsField ? normalizedAdoptJobs : previous.active_adopt_jobs;
          if (
            previous.running === snap.running &&
            prevCli === cliRunning &&
            Boolean(previous.background_only) === backgroundOnly &&
            sameStringArrays(previous.active_adopt_jobs, nextAdoptJobs) &&
            sameActiveSessions(previous.sessions ?? [], sessions) &&
            sameSlotSessions(previous.slot_sessions, slotSessions)
          ) {
            return previous;
          }
          return {
            ...previous,
            running: snap.running,
            cli_running: cliRunning,
            background_only: backgroundOnly,
            active_adopt_jobs: nextAdoptJobs,
            sessions,
            slot_sessions: slotSessions,
          };
        });
      } catch {
        /* Preserve existing state when live session probe fails transiently. */
      } finally {
        liveSessionsInFlightRef.current = null;
      }
    })();
    liveSessionsInFlightRef.current = task;
    return task;
  }
  const batchTargetInfo = useMemo(() => buildBatchTargets(state), [state]);
  const quotaTargets = batchTargetInfo.targets;
  const currentTargetSetKey = useMemo(
    () => quotaTargets.map(target => `${target.account_id}:${target.expected_identity.toLowerCase()}`).sort().join(','),
    [quotaTargets],
  );
  const unverifiedQuotaTargets = batchTargetInfo.unverifiedCount;
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
        lastAdoptedBatchSigRef.current = null;
        batchCancelingRef.current = false;
        setBatchCanceling(false);
        batchBusyRef.current = false;
        setBatchBusy(false);
        batchSummaryRef.current = {...batchSummaryRef.current, inProgress: false, state: 'cancelled', notRunCount: Math.max(0, batchSummaryRef.current.total - batchSummaryRef.current.completed)};
        setBatchSummary(batchSummaryRef.current);
        setQuotaFeedback('quotaOnline.targetSetChanged');
      }
      setCardStatusMap({});
    }
    prevTargetSetKeyRef.current = currentTargetSetKey;
  }, [currentTargetSetKey]);
  const active = state?.records.find(row => row.id === state.active);
  const current = state?.current;
  const rawSaved = state?.records.filter(row => !current?.present || row.id !== state.active) ?? [];
  const currentName = active?.name || current?.display_name || current?.email?.split('@')[0] || t('当前身份');
  const blocked = locked || hasActiveSync || batchBusy || loading || !state || !!state?.recovery;
  type IdentityRailItem =
    | {kind: 'current'; id: string}
    | {kind: 'saved'; id: string; row: Identity};
  const rawRailItems: IdentityRailItem[] = [
    ...(loading || current?.present ? [{kind: 'current' as const, id: CURRENT_IDENTITY_ORDER_TOKEN}] : []),
    ...rawSaved.map(row => ({kind: 'saved' as const, id: row.id, row})),
  ];
  const identityReorder = useCardRailReorder({
    storageKey: IDENTITY_CARD_ORDER_STORAGE_KEY,
    items: rawRailItems,
    getId: item => item.id,
    pinFirstToken: CURRENT_IDENTITY_ORDER_TOKEN,
    disabled: blocked,
  });
  const saved = identityReorder.orderedItems
    .filter((item): item is {kind: 'saved'; id: string; row: Identity} => item.kind === 'saved')
    .map(item => item.row);
  const connectionQueueItems = connectionHistory.matching(quotaTargets).map(item => {
    const row = state?.records.find(record => record.id === item.target.account_id);
    const email = item.target.account_id === 'current' ? current?.email : state?.summaries?.[item.target.account_id]?.email;
    const label = item.target.account_id === 'current' ? currentName : row?.name ?? t('quotaOnline.unknownAccount');
    return {...item, label: maskDisplayName(label, email, prefs.privacyMask)};
  });
  const kept = policyRows.filter(([key]) => policy[key]).map(([, label]) => t(label));
  const removed = policyRows.filter(([key]) => !policy[key]).map(([, label]) => t(label));
  const isDefaultPolicy = policyRows.every(([key]) => policy[key] === defaultPolicy[key]);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monitorClickThrough, setMonitorClickThrough] = useState(false);
  const staleQuotaTargets = useMemo(() => buildStaleOrUnknownBatchTargets(state, nowSec), [state, nowSec]);
  const currentQuota = useMemo(() => evaluateQuota(current, nowSec), [current, nowSec]);
  const detailsAreCurrent = quotaDetails?.id === 'current' || (!!quotaDetails && quotaDetails.id === state?.active);
  const detailsSummary = detailsAreCurrent ? current : quotaDetails ? state?.summaries[quotaDetails.id] : undefined;
  const detailsQuota = evaluateQuota(detailsSummary, nowSec);
  const detailsSavedRecord = quotaDetails && quotaDetails.id !== 'current' ? state?.records.find(row => row.id === quotaDetails.id) : undefined;
  const recoveryRecord = state?.records.find(row => row.id === state.recovery);
  const targetSummary = typeof review === 'object' && review ? state?.summaries?.[review.id] : undefined;
  const targetQuota = evaluateQuota(targetSummary, nowSec);
  const targetSlotBusy =
    typeof review === 'object' && review !== null && (state?.slot_sessions?.[review.id]?.length ?? 0) > 0;
  const hasLiveClaudeProcess = Boolean(
    state?.cli_running || state?.running || (state?.sessions?.length ?? 0) > 0,
  );
  const activeAdoptJobs = useMemo(
    () => normalizeAdoptJobIds(state?.active_adopt_jobs),
    [state?.active_adopt_jobs],
  );
  const primaryAdoptJobId = activeAdoptJobs[0] ?? null;
  const defaultCliFlagSuffix = useMemo(() => {
    const args = formatRelayCliModelEffortArgs(smartRelay);
    return args.length > 0 ? ` ${args.join(' ')}` : '';
  }, [smartRelay.defaultCliModel, smartRelay.defaultCliEffort]);
  const resumeShellCmd = primaryAdoptJobId
    ? `claude attach ${primaryAdoptJobId}`
    : `claude --resume${defaultCliFlagSuffix}`;
  const hasBackgroundDaemonOnly = useMemo(() => isBackgroundOnlyState(state), [state]);
  const interactiveChildShells = useMemo(() => collectInteractiveChildShells(state), [state]);
  const hasInteractiveChildShells = !hasBackgroundDaemonOnly && interactiveChildShells.length > 0;
  const proxyChanged =
    (typeof review === 'object' && review && (current?.proxy || null) !== (targetSummary?.proxy || null)) ||
    (review === 'empty' && Boolean(current?.proxy));
  const bestSaved = useMemo(
    () =>
      saved.reduce<{row: Identity; effectiveRem: number; inferred: boolean; awaitingReset: boolean} | null>((best, row) => {
        const sum = state?.summaries?.[row.id];
        if ((sum?.auth_status === 'expired' || sum?.auth_status === 'missing') && sum?.auth_has_refresh !== true) {
          return best;
        }
        const subExpiresAt = sum?.subscription_expires_at;
        const subExpired =
          typeof subExpiresAt === 'number' &&
          Number.isFinite(subExpiresAt) &&
          subExpiresAt > 0 &&
          sum?.billing_date_kind !== 'next_renewal' &&
          (sum?.subscription_date_source === 'manual' ? nowSec >= subExpiresAt + 86_400 : nowSec >= subExpiresAt);
        if (subExpired || isAccountInCooldown(smartRelay, row.id, nowSec)) return best;
        const q = evaluateQuota(sum, nowSec);
        if (!q || !q.known5h || !q.known7d || q.inferred7d || q.effectiveRem <= 0) return best;
        const {manualResetsRemaining} = extractResetCardInfo(sum, nowSec);
        const awaitingReset = Boolean(
          manualResetsRemaining > 0 && q.used7d >= Math.min(smartRelay.spentThresholdPct, 98),
        );
        const inferred = !q.recommendable;
        if (
          !best ||
          (best.awaitingReset && !awaitingReset) ||
          (best.awaitingReset === awaitingReset &&
            (q.effectiveRem > best.effectiveRem || (q.effectiveRem === best.effectiveRem && best.inferred && !inferred)))
        ) {
          return {row, effectiveRem: q.effectiveRem, inferred, awaitingReset};
        }
        return best;
      }, null),
    [saved, state?.summaries, smartRelay, nowSec],
  );
  const relayAccounts = useMemo<RelayAccountInput[]>(
    () => [
      ...(current?.present
        ? [
            {
              id: state?.active || 'current',
              name: currentName,
              email: current?.email,
              plan: current?.plan,
              auth_status: current?.auth_status,
              subscription_expires_at: current?.subscription_expires_at,
              isCurrent: true,
              listIndex: 0,
              summary: current,
            },
          ]
        : []),
      ...saved.map((row, idx) => {
        const sum = state?.summaries?.[row.id];
        return {
          id: row.id,
          name: row.name,
          email: sum?.email,
          plan: sum?.plan,
          auth_status: sum?.auth_status,
          subscription_expires_at: sum?.subscription_expires_at,
          isCurrent: false,
          listIndex: idx + 1,
          summary: sum,
        };
      }),
    ],
    [current, currentName, saved, state?.active, state?.summaries],
  );
  const relayEval = useMemo(() => evaluateSmartRelay(relayAccounts, smartRelay, nowSec), [relayAccounts, smartRelay, nowSec]);
  const relayPoolSummary = useMemo(() => summarizeRelayPool(relayEval.candidates, nowSec), [relayEval.candidates, nowSec]);
  const sameExitCluster = useMemo(
    () => findSameExitClusterWarning(relayEval.candidates, smartRelay.slotProxies, cliDefaultProxy),
    [relayEval.candidates, smartRelay.slotProxies, cliDefaultProxy],
  );
  const relayTargetCand = relayEval.recommended ?? relayEval.standbyCandidate ?? null;
  const relayRecommendedSaved =
    smartRelay.enabled && relayTargetCand && !relayTargetCand.isCurrent
      ? (() => {
          const row = saved.find(r => r.id === relayTargetCand.id);
          return row
            ? {
                row,
                effectiveRem: relayTargetCand.effectiveRem,
                inferred: relayTargetCand.inferred,
                isPreferred: relayTargetCand.isPreferred,
              }
            : null;
        })()
      : null;
  const recommendSaved = smartRelay.enabled
    ? relayRecommendedSaved
    : bestSaved && (!current?.present || (currentQuota && bestSaved.effectiveRem > currentQuota.effectiveRem))
      ? bestSaved
      : null;
  const totalIdentities = (current?.present ? 1 : 0) + saved.length;

  const cardFilterCounts = useMemo(() => {
    let ready = 0;
    let resetCards = 0;
    let expiring = 0;
    let live = 0;
    for (const item of identityReorder.orderedItems) {
      const meta = item.kind === 'current' ? current : state?.summaries?.[item.row.id];
      const cand =
        item.kind === 'current'
          ? relayEval.candidates.find(c => c.isCurrent)
          : relayEval.candidates.find(c => !c.isCurrent && c.id === item.row.id);
      const isLive =
        item.kind === 'current'
          ? Boolean(state?.running || state?.cli_running || (state?.sessions?.length ?? 0) > 0)
          : (state?.slot_sessions?.[item.row.id]?.length ?? 0) > 0;
      const hasResets = (meta?.manual_resets_remaining ?? 0) > 0;
      const expUrg = computeExpiryUrgency(formatSubscriptionExpiryBadge(meta), nowSec);
      const isReady = Boolean(
        cand && (smartRelay.enabled ? cand.isIncluded : true) && cand.tier === 0,
      );
      if (isReady) ready++;
      if (hasResets) resetCards++;
      if (expUrg === 'soon' || expUrg === 'expired') expiring++;
      if (isLive) live++;
    }
    return {ready, resetCards, expiring, live};
  }, [identityReorder.orderedItems, current, relayEval.candidates, smartRelay.enabled, state?.summaries, state?.running, state?.cli_running, state?.sessions, state?.slot_sessions, nowSec]);

  const filteredRailItems = useMemo(() => {
    if (cardFilter === 'all') return identityReorder.orderedItems;
    return identityReorder.orderedItems.filter(item => {
      const meta = item.kind === 'current' ? current : state?.summaries?.[item.row.id];
      if (cardFilter === 'ready') {
        const cand =
          item.kind === 'current'
            ? relayEval.candidates.find(c => c.isCurrent)
            : relayEval.candidates.find(c => !c.isCurrent && c.id === item.row.id);
        return Boolean(
          cand && (smartRelay.enabled ? cand.isIncluded : true) && cand.tier === 0,
        );
      }
      if (cardFilter === 'reset_cards') {
        return (meta?.manual_resets_remaining ?? 0) > 0;
      }
      if (cardFilter === 'expiring') {
        const expUrg = computeExpiryUrgency(formatSubscriptionExpiryBadge(meta), nowSec);
        return expUrg === 'soon' || expUrg === 'expired';
      }
      if (cardFilter === 'live') {
        return item.kind === 'current'
          ? Boolean(state?.running || state?.cli_running || (state?.sessions?.length ?? 0) > 0)
          : (state?.slot_sessions?.[item.row.id]?.length ?? 0) > 0;
      }
      return true;
    });
  }, [cardFilter, identityReorder.orderedItems, current, relayEval.candidates, smartRelay.enabled, state?.summaries, state?.running, state?.cli_running, state?.sessions, state?.slot_sessions, nowSec]);

  useEffect(() => {
    if (!focusAccountRequest || !state) return;
    if (cardFilter !== 'all') {
      setCardFilter('all');
      return;
    }
    const {accountId, requestId} = focusAccountRequest;
    const targetDomId =
      current?.present && (accountId === 'current' || accountId === state.active)
        ? CURRENT_IDENTITY_ORDER_TOKEN
        : accountId;
    setFocusedCardId(targetDomId);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setFocusedCardId(null);
    }, 2200);
    window.requestAnimationFrame(() => {
      const node = rail.current?.querySelector<HTMLElement>(`[data-reorder-card-id="${targetDomId}"]`);
      node?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    });
    onFocusAccountConsumed?.(requestId);
  }, [focusAccountRequest, state, cardFilter, current?.present, reduceMotion, onFocusAccountConsumed]);

  const standbyCandId = relayRecommendedSaved?.row.id ?? null;
  const standbyCandName = relayRecommendedSaved?.row.name ?? null;
  const standbyCandEmail = standbyCandId ? (state?.summaries?.[standbyCandId]?.email ?? null) : null;
  const standbyCandRem = relayRecommendedSaved?.effectiveRem ?? null;
  const standbyUrgent = Boolean(relayEval.shouldRelayNow);
  useEffect(() => {
    const hint =
      smartRelay.enabled && standbyCandName
        ? {
            enabled: true,
            candidateName: standbyCandName,
            candidateEmail: standbyCandEmail,
            effectiveRemPct: standbyCandRem,
            shouldRelayNow: standbyUrgent,
          }
        : null;
    const serialized = JSON.stringify(hint);
    if (lastSerializedRelayHintRef.current === serialized) return;
    lastSerializedRelayHintRef.current = serialized;
    writeMonitorRelayStandbyHint(hint);
    postMonitorBusMessage({type: 'relay-standby-updated', hint});
  }, [smartRelay.enabled, standbyCandEmail, standbyCandName, standbyCandRem, standbyUrgent]);

  useEffect(() => {
    void syncNativeSmartRelayConfigIfLive();
  }, []);

  useEffect(() => {
    if (!relayPanelOpen) {
      focusedSlotProxyIdRef.current = null;
      return;
    }
    focusedSlotProxyIdRef.current = null;
    setCliWrappersFeedback(null);
    setBrowserProxySyncFeedback({});
    setLatestHandoff(null);
    setSlotProxyErrors({});
    setSlotProxyDrafts({...smartRelay.slotProxies});
    setExpandedProxyIds({});
    void syncNativeSmartRelayConfigIfLive();
    if (canSyncNativeSmartRelay()) {
      void invoke<HandoffSummary | null>('identities_latest_handoff')
        .then(res => {
          if (mountedRef.current && res && typeof res === 'object') {
            setLatestHandoff(res);
          }
        })
        .catch(() => {});
    }
  }, [relayPanelOpen]);

  useEffect(() => {
    if (!relayPanelOpen) return;
    setSlotProxyDrafts(prev => {
      const focusedId = focusedSlotProxyIdRef.current;
      const next: Record<string, string> = {...smartRelay.slotProxies};
      if (focusedId && Object.prototype.hasOwnProperty.call(prev, focusedId)) {
        next[focusedId] = prev[focusedId];
      }
      return next;
    });
  }, [relayPanelOpen, smartRelay.slotProxies]);

  useEffect(() => {
    void read();
    let unlistenMonitor: (() => void) | undefined;
    if (
      typeof window !== 'undefined' &&
      Boolean(
        (window as Window & {__TAURI_INTERNALS__?: {metadata?: unknown}}).__TAURI_INTERNALS__?.metadata,
      )
    ) {
      void invoke<MonitorWindowState>('monitor_window_state')
        .then(s => {
          if (mountedRef.current && s && typeof s.open === 'boolean') {
            setMonitorOpen(s.open);
            setMonitorClickThrough(Boolean(s.clickThrough));
          }
        })
        .catch(() => {});
      void listen<MonitorWindowState>('monitor-window-state', event => {
        if (mountedRef.current && event.payload && typeof event.payload.open === 'boolean') {
          setMonitorOpen(event.payload.open);
          setMonitorClickThrough(Boolean(event.payload.clickThrough));
        }
      })
        .then(fn => {
          if (!mountedRef.current) fn();
          else unlistenMonitor = fn;
        })
        .catch(() => {});
    }
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(MONITOR_BUS_CHANNEL);
        channel.onmessage = (event: MessageEvent<MonitorBusMessage>) => {
          const msg = event.data;
          if (msg && typeof msg === 'object' && msg.type === 'window-state' && msg.state) {
            setMonitorOpen(Boolean(msg.state.open));
            setMonitorClickThrough(Boolean(msg.state.clickThrough));
          }
        };
      } catch {
        channel = null;
      }
    }
    return () => {
      if (unlistenMonitor) unlistenMonitor();
      if (channel) channel.close();
    };
  }, []);
  usePageRefresh(() => { if (!locked && !loading) void read(false); });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void listen('quota-metadata-updated', () => {
      if (active && mountedRef.current && !busyRef.current) void read(false);
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
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    let active = true;
    let lastProgressReadAt = 0;
    let progressReadTimer: number | null = null;
    const scheduleBatchRead = (immediate = false) => {
      const flush = () => {
        if (progressReadTimer !== null) {
          window.clearTimeout(progressReadTimer);
          progressReadTimer = null;
        }
        lastProgressReadAt = Date.now();
        if (active && mountedRef.current && !busyRef.current) void read(false);
      };
      if (immediate) {
        flush();
        return;
      }
      const elapsed = Date.now() - lastProgressReadAt;
      if (elapsed >= 800) {
        flush();
      } else if (progressReadTimer === null) {
        progressReadTimer = window.setTimeout(flush, 800 - elapsed);
      }
    };
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
      if (payload.result.status === 'rate_limited' || payload.result.reason === 'rate_limited') {
        const relayAccId = resolveRelayAccountId(payload.account_id, payload.expected_identity);
        noteRelayAccountRateLimited(relayAccId, payload.result.retry_at_ms);
      }
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

      scheduleBatchRead(false);
    })
      .then(fn => {
        if (!active || !mountedRef.current) {
          fn();
        } else {
          unlistenProgress = fn;
        }
      })
      .catch(() => {});
    void listen<{request_id?: string}>('quota-batch-finished', event => {
      if (!active || !mountedRef.current) return;
      if (event.payload?.request_id && event.payload.request_id !== currentBatchRequestIdRef.current) return;
      scheduleBatchRead(true);
    })
      .then(fn => {
        if (!active || !mountedRef.current) {
          fn();
        } else {
          unlistenFinished = fn;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (progressReadTimer !== null) window.clearTimeout(progressReadTimer);
      if (unlistenProgress) unlistenProgress();
      if (unlistenFinished) unlistenFinished();
    };
  }, []);

  useEffect(() => {
    if (!readReady) return;
    if (onlinePanelOpen && adoptedTerminalBatchIdRef.current !== null && !batchBusyRef.current) return;
    let live = true;
    void invoke<BatchQuotaResult | null>('identities_quota_batch_state', {requestId: null})
      .then(batch => {
        if (!live || !batch) return;
        if (!isTerminalBatchState(batch.state)) {
          adoptedTerminalBatchIdRef.current = null;
          adoptBatchSnapshot(batch, true);
        } else if (onlinePanelOpen && adoptedTerminalBatchIdRef.current !== batch.request_id) {
          adoptedTerminalBatchIdRef.current = batch.request_id;
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
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { live = false; window.clearInterval(timer); };
  }, [batchBusy, batchSummary.requestId]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: string | undefined;
    const isFixture = typeof window !== 'undefined' && 'identityFixture' in window;
    // Fixture mode keeps the fast deterministic 2s cadence; desktop slows to 15s when the window is visible but unfocused.
    const intervalFor = () => (isFixture ? 2000 : document.hasFocus() ? 5000 : 15000);
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      // A hidden window pauses polling completely; `visibilitychange` resumes it with one catch-up refresh.
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => void check(), intervalFor());
    };
    const check = async () => {
      if (running) return;
      running = true;
      timer = undefined;
      try {
        if (!document.hidden && !busyRef.current && !batchBusyRef.current && !actionLockedRef.current) {
          const next = await invoke<string>('identities_quota_revision');
          if (!cancelled) {
            const focused = isFixture || document.hasFocus();
            if (revision === undefined && !isFixture && readSeqRef.current > 0) {
              revision = next;
              if (focused) await refreshLiveSessions(false);
            } else if (revision === undefined || next !== revision) {
              // A failed or superseded read must leave the change pending for the next check.
              if (await read(false)) {
                revision = next;
                lastLiveSessionsAtRef.current = Date.now();
              }
            } else if (focused) {
              await refreshLiveSessions(false);
            }
          }
        }
      } catch {
        // A failed local metadata check does not clear any quota observation.
      } finally {
        running = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (cancelled) return;
      clearTimer();
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void check();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const sessionConfirmOpen = review !== null || snapshot || deletion === 'current';
  useEffect(() => {
    if (!sessionConfirmOpen || !canQueryLiveSessions()) return;
    const isFixture = typeof window !== 'undefined' && 'identityFixture' in window;
    const intervalMs = isFixture ? 600 : 2000;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) void refreshLiveSessions(true);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [sessionConfirmOpen]);

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
      if (!document.hidden) {
        void refreshLiveSessions(false);
        void syncNativeSmartRelayConfigIfLive();
      }
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

  async function updateAutoWakeConfig(patch: Partial<AutoWakeupConfig>) {
    if (autoWakeSavingRef.current) {
      pendingAutoWakePatchRef.current = {...pendingAutoWakePatchRef.current, ...patch};
      return;
    }
    autoWakeSavingRef.current = true;
    setAutoWakeSaving(true);
    let nextPatch: Partial<AutoWakeupConfig> | null = patch;
    try {
      while (nextPatch) {
        const currentPatch = nextPatch;
        nextPatch = null;
        await configureNativeWakeup({...readNativeWakeupSnapshot().config, ...currentPatch});
        if (pendingAutoWakePatchRef.current) {
          nextPatch = pendingAutoWakePatchRef.current;
          pendingAutoWakePatchRef.current = null;
        }
      }
    } catch (error) {
      pendingAutoWakePatchRef.current = null;
      setQuotaFeedback(String(error) === 'wakeup.runtimeUnavailable' ? 'wakeup.runtimeUnavailable' : 'wakeup.configSaveFailed');
    } finally {
      autoWakeSavingRef.current = false;
      if (mountedRef.current) setAutoWakeSaving(false);
    }
  }

  async function resumeWakeup(identity: string) {
    try { await resumeNativeWakeup(identity); setQuotaFeedback('wakeup.recoveryGranted'); }
    catch (error) { setQuotaFeedback(String(error) === 'wakeup.outcomeUnknown' ? 'wakeup.outcomeUnknown' : 'wakeup.stateSaveFailed'); }
  }

  async function wakeupSingleAccount(accountId: string, expectedIdentity: string, isAuto = false): Promise<boolean> {
    if (actionLockedRef.current || busyRef.current || batchBusyRef.current || wakingRef.current) return false;
    const inventory = buildBatchTargets(stateRef.current).targets;
    if (!isValidQuotaTargetSubset([{account_id: accountId, expected_identity: expectedIdentity}], inventory)) {
      if (!isAuto) setQuotaFeedback('quotaOnline.accountMismatch');
      return false;
    }
    wakingRef.current = true;
    setWakingAccountId(accountId);
    const beforeSummary = accountId === 'current' ? stateRef.current?.current : stateRef.current?.summaries?.[accountId];
    const beforeQuota = evaluateQuota(beforeSummary, Math.floor(Date.now() / 1000));
    const expiredResetSec = beforeQuota?.inferredReset5h ?? beforeSummary?.quota_5h_reset_at ?? null;
    if (!isAuto) setQuotaFeedback('wakeup.waking');
    try {
      const res = await invoke<OnlineQuotaResult>('identities_wakeup_quota_window', {
        accountId,
        expectedIdentity,
        trigger: isAuto ? 'auto' : 'manual',
        expiredResetAt: expiredResetSec,
      });
      const nowMs = Date.now();
      if (res.status === 'rate_limited' || res.reason === 'rate_limited') {
        const relayAccId = resolveRelayAccountId(accountId, expectedIdentity);
        noteRelayAccountRateLimited(relayAccId, res.retry_at_ms, Math.floor(nowMs / 1000));
      }
      const anchorKey = expectedIdentity.trim().toLowerCase();
      const anchorCheck = verifyWakeupAnchorAdvancement(expiredResetSec, res.wakeup_5h_reset_at, Math.floor(nowMs / 1000));
      persistedWakeupAnchorMap = {...persistedWakeupAnchorMap, [anchorKey]: anchorCheck};
      if (mountedRef.current) {
        setWakeupAnchorMap(persistedWakeupAnchorMap);
      }
      if (isConfirmedNewWakeup5h(res) && res.wakeup_5h_reset_at > Math.floor(nowMs / 1000) && expiredResetSec !== null && res.wakeup_5h_reset_at > expiredResetSec) {
        const baseKey = res.wakeup_audit_status === 'unavailable' ? 'wakeup.auditUnavailable' : 'wakeup.wokenSuccess';
        const fullMsg = `${tRef.current(baseKey)} · ${tRef.current(anchorCheck.labelKey)}`;
        recordAuditHistoryItem({
          kind: 'identity',
          title: tRef.current('wakeup.auditTitle'),
          status: anchorCheck.status === 'advanced_new_cycle' ? 'ok' : 'warning',
          message: fullMsg,
          elapsed_ms: Math.max(100, nowMs - (res.observed_at_ms ?? nowMs)),
        });
        if (mountedRef.current) {
          await read(false);
          setQuotaFeedback({render: tr => `${tr(baseKey)} · ${tr(anchorCheck.labelKey)}`});
        }
        return true;
      }
      if (mountedRef.current) {
        setQuotaFeedback({
          render: tr =>
            res.stage === 'scheduler'
              ? formatOnlineQuotaStatus(res, nowMs, tr).message
              : res.wakeup_effect === 'outcome_unknown'
                ? tr('wakeup.outcomeUnknown')
                : res.status === 'auth_required'
                  ? tr('wakeup.authBlocked')
                  : res.wakeup_effect
                    ? `${tr('wakeup.notConfirmed')} · ${tr(anchorCheck.labelKey)}`
                    : formatOnlineQuotaStatus(res, nowMs, tr).message,
        });
      }
      return false;
    } catch (error) {
      if (mountedRef.current) setQuotaFeedback(String(error) === 'wakeup.notReady' ? 'wakeup.notReady' : String(error) === 'wakeup.stateSaveFailed' ? 'wakeup.stateSaveFailed' : 'wakeup.requestFailed');
      return false;
    } finally {
      wakingRef.current = false;
      if (mountedRef.current) setWakingAccountId(null);
    }
  }

  async function wakeupAllIdleAccounts(): Promise<void> {
    if (actionLockedRef.current || busyRef.current || batchBusyRef.current || wakingRef.current) return;
    const targets = buildBatchTargets(stateRef.current).targets.filter(target => {
      const sum = target.account_id === 'current' ? stateRef.current?.current : stateRef.current?.summaries?.[target.account_id];
      const q = evaluateQuota(sum, Math.floor(Date.now() / 1000));
      return Boolean(q?.inferred5h || q?.expired5h);
    });
    if (targets.length === 0) return;
    let wokenCount = 0;
    for (const target of targets) {
      if (!mountedRef.current || actionLockedRef.current || batchBusyRef.current) break;
      const ok = await wakeupSingleAccount(target.account_id, target.expected_identity, false);
      if (ok) wokenCount++;
    }
    if (wokenCount > 1 && mountedRef.current) {
      setQuotaFeedback({key: 'wakeup.wokenBatchSuccess', values: {count: wokenCount}});
    }
  }

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
    const isFixture = typeof window !== 'undefined' && 'identityFixture' in window;
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const scheduleNext = () => {
      clearTimer();
      if (document.visibilityState === 'hidden') return;
      const delay = isFixture ? 1000 : Math.max(250, 30_000 - (Date.now() % 30_000));
      timer = window.setTimeout(() => {
        if (document.visibilityState !== 'hidden') {
          setNowSec(Math.floor(Date.now() / 1000));
          scheduleNext();
        }
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
      } else {
        setNowSec(Math.floor(Date.now() / 1000));
        scheduleNext();
      }
    };
    scheduleNext();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
  useHorizontalRailWheelScroll(rail, reduceMotion);
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
    const activeTask = !isTerminalBatchState(batch.state);
    const snapSig = `${batch.request_id}:${batch.state}:${batch.completed}:${validResults.length}`;
    if (!restore && lastAdoptedBatchSigRef.current === snapSig) {
      batchBusyRef.current = activeTask;
      setBatchBusy(activeTask);
      if (!activeTask) {
        batchCancelingRef.current = false;
        setBatchCanceling(false);
      }
      return;
    }
    lastAdoptedBatchSigRef.current = snapSig;
    connectionHistory.merge(batch.targets, validResults.map(item => ({
      target: {account_id: item.account_id, expected_identity: item.expected_identity},
      result: item.result,
    })), currentTargets);
    const resultsById = Object.fromEntries(validResults.map(item => [item.account_id, item.result]));
    batchResultsMapRef.current = resultsById;
    for (const item of validResults) {
      if (item.result.status === 'rate_limited' || item.result.reason === 'rate_limited') {
        const relayAccId = resolveRelayAccountId(item.account_id, item.expected_identity);
        noteRelayAccountRateLimited(relayAccId, item.result.retry_at_ms);
      }
    }
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
    batchBusyRef.current = activeTask;
    setBatchBusy(activeTask);
    if (!activeTask) {
      batchCancelingRef.current = false;
      setBatchCanceling(false);
    }
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
    setBatchCanceling(true);
    setQuotaFeedback('quotaOnline.cancelling');
    try {
      const result = await invoke<BatchQuotaResult>('identities_cancel_quota_batch', {requestId});
      adoptBatchSnapshot(result, false);
    } catch (e) {
      setQuotaFeedback(String(e));
      batchCancelingRef.current = false;
      if (mountedRef.current) setBatchCanceling(false);
    }
  }

  async function refreshAllQuotas(allowBrowserFallback = true, requestedTargets?: QuotaBatchTarget[]): Promise<void> {
    if (actionLockedRef.current || busyRef.current) return;
    if (batchBusyRef.current) return; // Manual and automatic triggers share the active native batch.
    const inventory = buildBatchTargets(stateRef.current).targets;
    const targets = requestedTargets ?? inventory;
    if (requestedTargets && !isValidQuotaTargetSubset(requestedTargets, inventory)) {
      setQuotaFeedback('quotaOnline.accountMismatch');
      return;
    }
    if (targets.length === 0) {
      setQuotaFeedback('quotaOnline.noValidTargets');
      return;
    }

    const reqId = generateBatchRequestId();
    currentBatchRequestIdRef.current = reqId;
    lastAdoptedBatchSigRef.current = null;
    frozenBatchTargetsRef.current = targets.map(target => ({...target}));
    batchResultsMapRef.current = {};
    batchCancelingRef.current = false;
    setBatchCanceling(false);
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
      const batchSummarySnapshot = summarizeBatchResult(res);
      setQuotaFeedback({render: tr => formatBatchProgress(batchSummarySnapshot, tr)});
    } catch (e) {
      setQuotaFeedback(String(e));
    } finally {
      // Native task state owns the lock. A dropped frontend promise must not unlock an active worker.
      if (currentBatchRequestIdRef.current === reqId) {
        try {
          const latest = await invoke<BatchQuotaResult | null>('identities_quota_batch_state', {requestId: reqId});
          if (latest) adoptBatchSnapshot(latest, false);
          else if (batchBusyRef.current) {
            batchCancelingRef.current = false;
            setBatchCanceling(false);
            batchBusyRef.current = false;
            setBatchBusy(false);
            batchSummaryRef.current = {...batchSummaryRef.current, inProgress: false, state: 'cancelled'};
            setBatchSummary(batchSummaryRef.current);
          }
        } catch { /* periodic state recovery remains active while the panel is mounted */ }
      }
    }
  }

  async function openAccountBrowser(target: QuotaBatchTarget, openMode?: 'usage' | 'claude_ai'): Promise<void> {
    if (actionLockedRef.current || batchBusyRef.current || busyRef.current) return;
    if (!isValidQuotaTargetSubset([target], buildBatchTargets(stateRef.current).targets)) {
      setQuotaFeedback('quotaOnline.accountMismatch');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setQuotaFeedback('quotaOnline.openingAccountBrowser');
    try {
      await invoke('browser_open_identity_profile', {
        accountId: target.account_id,
        expectedIdentity: target.expected_identity,
        ...(openMode ? {openMode} : {}),
      });
      setQuotaFeedback('quotaOnline.accountBrowserOpened');
    } catch (error) {
      setQuotaFeedback(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function openAllAccountUsagePages(): Promise<void> {
    if (actionLockedRef.current || batchBusyRef.current || busyRef.current) return;
    const targets = buildBatchTargets(stateRef.current).targets.slice(0, 8);
    if (targets.length === 0) {
      setQuotaFeedback('quotaOnline.noValidTargets');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setQuotaFeedback('quotaOnline.openingAccountBrowser');
    const isSyntheticFixture =
      typeof window !== 'undefined' && ('identityFixture' in window || 'usageFixture' in window);
    let opened = 0;
    let firstErr = '';
    try {
      for (let idx = 0; idx < targets.length; idx++) {
        const target = targets[idx];
        if (!mountedRef.current) break;
        if (!isValidQuotaTargetSubset([target], buildBatchTargets(stateRef.current).targets)) continue;
        if (targets.length > 1) {
          setQuotaFeedback({
            key: 'browser.openingUsageProgress',
            values: {current: idx + 1, total: targets.length},
          });
        }
        try {
          await invoke('browser_open_identity_profile', {
            accountId: target.account_id,
            expectedIdentity: target.expected_identity,
            openMode: 'usage',
          });
          opened++;
          if (idx < targets.length - 1 && !isSyntheticFixture) {
            const staggerMs = 1800 + Math.floor(Math.random() * 1401);
            await new Promise<void>(resolve => window.setTimeout(resolve, staggerMs));
          }
        } catch (err) {
          if (!firstErr) firstErr = String(err);
        }
      }
      if (opened > 0) {
        setQuotaFeedback({key: 'browser.openedAllAccountUsage', values: {count: opened}});
      } else if (firstErr) {
        setQuotaFeedback(firstErr);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function notifyHudIfTelemetryChanged(next: IdentityState, switched = false) {
    const hudSig = `${next.active}:${next.running}:${next.current?.present ?? false}:${next.current?.quota_identity ?? ''}:${next.current?.plan ?? ''}:${next.current?.quota_no_5h_limit ?? false}:${next.current?.quota_5h_used ?? ''}:${next.current?.quota_5h_reset_at ?? ''}:${next.current?.quota_7d_used ?? ''}:${next.current?.quota_7d_reset_at ?? ''}:${next.current?.quota_observed_at_ms ?? ''}`;
    if (switched) {
      lastHudTelemetrySigRef.current = hudSig;
      postMonitorBusMessage({type: 'identity-switched'});
    } else if (lastHudTelemetrySigRef.current !== hudSig) {
      lastHudTelemetrySigRef.current = hudSig;
      postMonitorBusMessage({type: 'quota-ledger-updated'});
    }
  }

  async function syncSubscription(targetAccountId?: string, targetExpectedIdentity?: string, verifyReset = false) {
    const isCurrentTarget = !targetAccountId || targetAccountId === 'current';
    const preMeta = isCurrentTarget ? stateRef.current?.current : stateRef.current?.summaries?.[targetAccountId!];
    const prevUsed7d = typeof preMeta?.quota_7d_used === 'number' ? preMeta.quota_7d_used : null;
    const prevResets = typeof preMeta?.manual_resets_remaining === 'number' ? preMeta.manual_resets_remaining : null;
    const rawIdentity = isCurrentTarget
      ? (targetExpectedIdentity ?? stateRef.current?.current?.quota_identity)
      : (targetExpectedIdentity ?? stateRef.current?.summaries?.[targetAccountId]?.quota_identity);
    if (!rawIdentity || !rawIdentity.trim()) {
      setQuotaFeedback('quotaOnline.accountMismatch');
      return;
    }
    const syncKey = isCurrentTarget ? 'current' : targetAccountId!;
    if (actionLockedRef.current || busyRef.current || batchBusyRef.current || syncingIdsRef.current[syncKey]) return;
    const frozenExpectedIdentity = rawIdentity.trim();
    const frozenActive = stateRef.current?.active;

    syncingIdsRef.current = {...syncingIdsRef.current, [syncKey]: true};
    setSyncingAccountIds({...syncingIdsRef.current});
    setQuotaFeedback('identityCard.syncInitiated');
    try {
      await invoke(
        'identities_sync_subscription',
        isCurrentTarget
          ? { expectedIdentity: frozenExpectedIdentity }
          : { expectedIdentity: frozenExpectedIdentity, accountId: targetAccountId }
      );
      if (!mountedRef.current) return;
      const stillMatches = isCurrentTarget
        ? isExpectedCurrentTarget(stateRef.current, { active: frozenActive, expectedIdentity: frozenExpectedIdentity })
        : isExpectedSavedTarget(stateRef.current, { targetId: targetAccountId, expectedIdentity: frozenExpectedIdentity });
      if (!stillMatches) {
        setQuotaFeedback('quotaOnline.accountMismatch');
        return;
      }
      if (mountedRef.current) {
        await read(false);
        const postMeta = isCurrentTarget ? stateRef.current?.current : stateRef.current?.summaries?.[targetAccountId!];
        const nextUsed7d = typeof postMeta?.quota_7d_used === 'number' ? postMeta.quota_7d_used : null;
        const nextResets = typeof postMeta?.manual_resets_remaining === 'number' ? postMeta.manual_resets_remaining : null;
        const resetDropped = prevUsed7d !== null && nextUsed7d !== null && prevUsed7d >= 80 && nextUsed7d <= prevUsed7d - 20;
        const cardConsumed = prevResets !== null && nextResets !== null && nextResets < prevResets;
        if (resetDropped || (verifyReset && cardConsumed)) {
          const cooldownKey = resolveRelayAccountId(isCurrentTarget ? 'current' : targetAccountId!, frozenExpectedIdentity);
          clearAccountCooldown(cooldownKey, true);
          if (isCurrentTarget && cooldownKey !== 'current' && smartRelay.cooldownUntilSec?.current) {
            clearAccountCooldown('current', true);
          }
          const fbEntry: QuotaFeedbackEntry =
            prevResets !== null && nextResets !== null && prevResets !== nextResets
              ? {
                  key: 'relay.verifyResetConfirmed',
                  values: {
                    prevUsed: Math.round(prevUsed7d ?? 0),
                    nextUsed: Math.round(nextUsed7d ?? 0),
                    prevResets,
                    nextResets,
                  },
                }
              : {
                  key: 'relay.verifyResetConfirmedDropOnly',
                  values: {
                    prevUsed: Math.round(prevUsed7d ?? 0),
                    nextUsed: Math.round(nextUsed7d ?? 0),
                  },
                };
          setQuotaFeedback(fbEntry);
          if (relayPanelOpen) setCliWrappersFeedback({text: tRef.current(fbEntry.key, fbEntry.values)});
        } else if (verifyReset) {
          const usedVal = Math.round(nextUsed7d ?? prevUsed7d ?? 0);
          setQuotaFeedback({key: 'relay.verifyResetPending', values: {used: usedVal}});
          if (relayPanelOpen) {
            setCliWrappersFeedback({
              text: tRef.current('relay.verifyResetPending', {used: usedVal}),
              isError: true,
            });
          }
        } else {
          setQuotaFeedback('identityCard.syncCompleted');
        }
      }
    } catch (e) {
      const rawErr = String(e);
      setQuotaFeedback(rawErr);
      if (verifyReset && relayPanelOpen) setCliWrappersFeedback({text: tRef.current(rawErr), isError: true});
    } finally {
      const next = {...syncingIdsRef.current};
      delete next[syncKey];
      syncingIdsRef.current = next;
      if (mountedRef.current) setSyncingAccountIds(next);
    }
  }

  async function read(invalidateResidue = true) {
    const seq = ++readSeqRef.current;
    if (!stateRef.current) {
      setLoading(true);
    }
    try {
      const next = await invoke<IdentityState>('identities_read');
      if (!mountedRef.current || seq < readSeqRef.current) {
        return false;
      }
      // An unchanged native snapshot keeps the current object so the whole card rail
      // does not re-render after a background revision check.
      const previous = stateRef.current;
      const unchanged = previous !== null && JSON.stringify(previous) === JSON.stringify(next);
      if (!unchanged) {
        stateRef.current = next;
        setState(next);
      }
      setReadReady(true);
      void syncNativeSmartRelayConfigIfLive();
      notifyHudIfTelemetryChanged(next, false);
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
  async function manualSyncLocalQuota() {
    setManualSyncing(true);
    try {
      const shouldSpin = !reduceMotion && !(typeof window !== 'undefined' && 'identityFixture' in window);
      const [ok] = await Promise.all([
        read(false),
        shouldSpin ? new Promise<void>(resolve => window.setTimeout(resolve, 550)) : Promise.resolve(),
      ]);
      if (ok && mountedRef.current) {
        setSyncedFeedback(true);
        if (syncedTimerRef.current !== null) window.clearTimeout(syncedTimerRef.current);
        syncedTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) setSyncedFeedback(false);
        }, 1500);
      }
    } finally {
      if (mountedRef.current) setManualSyncing(false);
    }
  }
  async function toggleMonitorWindow() {
    if (monitorOpen && monitorClickThrough) {
      setMonitorClickThrough(false);
      try {
        const state = await invoke<MonitorWindowState>('monitor_window_set_click_through', {clickThrough: false});
        if (mountedRef.current && state) {
          setMonitorOpen(Boolean(state.open));
          setMonitorClickThrough(Boolean(state.clickThrough));
          postMonitorBusMessage({type: 'window-state', state});
        }
      } catch (e) {
        if (mountedRef.current) {
          setMonitorClickThrough(true);
          setError(t(String(e)));
        }
      }
      return;
    }
    const next = !monitorOpen;
    setMonitorOpen(next);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_open', {open: next});
      if (mountedRef.current && state && typeof state.open === 'boolean') {
        setMonitorOpen(state.open);
        setMonitorClickThrough(Boolean(state.clickThrough));
        postMonitorBusMessage({type: 'window-state', state});
      }
    } catch (e) {
      if (mountedRef.current) {
        setMonitorOpen(!next);
        setError(t(String(e)));
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
      commitAuthoritativeState(await invoke<IdentityState>('identities_read'));
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
      commitAuthoritativeState(await invoke<IdentityState>('identities_browser', {enabled, useExisting}));
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
      setShowCleanroomBar(false);
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
  async function openUsagePage(openMode?: 'usage' | 'claude_ai') {
    if (busy) return;
    const expectedIdentity = quotaDetails?.expectedIdentity;
    if (!expectedIdentity) { setQuotaFeedback('browser.cliIdentityUnavailable'); return; }
    if (!detailsAreCurrent && quotaDetails) {
      await openAccountBrowser({account_id: quotaDetails.id, expected_identity: expectedIdentity}, openMode);
      return;
    }
    setBusy(true);
    setQuotaFeedback('');
    try {
      setShowCleanroomBar(false);
      if (openMode === 'claude_ai') {
        const next = await invoke<BrowserState>('browser_return_to_cli', {expectedIdentity, openMode: 'claude_ai', onProgress: activity.start('browser')});
        if (mountedRef.current) {
          ++readSeqRef.current;
          setState(previous => {
            if (!previous) return previous;
            const updated: IdentityState = {
              ...previous,
              active_browser_slot: next.active_browser_slot,
              warming_cards: previous.warming_cards?.map(card => ({...card, browser_active: card.slot === next.active_browser_slot})),
            };
            stateRef.current = updated;
            return updated;
          });
        }
        activity.finish(true, 'browser.returnToCliDone');
        setQuotaFeedback('browser.returnToCliDone');
      } else {
        await invoke('browser_open_usage', {expectedIdentity, onProgress: activity.start('browser')});
        activity.finish(true, 'quota.opened');
        setQuotaFeedback('quota.opened');
      }
    } catch (reason) {
      const message = String(reason);
      setQuotaFeedback(message);
      activity.finish(false, message);
    } finally {
      setBusy(false);
    }
  }
  async function returnToCliBrowser(openMode?: 'verify' | 'claude_ai') {
    if (!returnCliBrowser || busyRef.current) return;
    const target = returnCliBrowser;
    setReturnCliBrowser(null);
    busyRef.current = true;
    setBusy(true);
    browserRuntime.invalidate();
    setError('');
    try {
      setShowCleanroomBar(false);
      const next = await invoke<BrowserState>('browser_return_to_cli', {expectedIdentity: target.expectedIdentity, ...(openMode ? {openMode} : {}), onProgress: activity.start('browser')});
      if (!mountedRef.current) return;
      // Apply the returned slot locally; this action never switches, saves or stops the CLI.
      ++readSeqRef.current;
      setState(previous => {
        if (!previous) return previous;
        const updated: IdentityState = {
          ...previous,
          active_browser_slot: next.active_browser_slot,
          warming_cards: previous.warming_cards?.map(card => ({...card, browser_active: card.slot === next.active_browser_slot})),
        };
        stateRef.current = updated;
        return updated;
      });
      setQuotaFeedback('');
      activity.finish(true, 'browser.returnToCliDone');
    } catch (reason) {
      if (mountedRef.current) setError(String(reason));
      activity.finish(false, String(reason));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }
  function choose(target: Target) {
    setWarmingPromotion(null);
    setSyncCliBrowserOnSwitch(browserRuntime.status !== 'running');
    setName(target === 'recovery' ? t('恢复前状态') : (active?.name || currentName).slice(0, 64));
    if (target === 'recovery') {
      const previous = state?.records.find(row => row.id === state.recovery);
      if (previous) setPolicy({...previous.policy});
    }
    setReview(target);
    setError('');
    void refreshLiveSessions(true);
  }
  function openSnapshot() {
    setName((active?.name || currentName).slice(0, 64));
    setSnapshot(true);
    setError('');
    void refreshLiveSessions(true);
  }
  async function recoverNow() {
    if (!stateRef.current?.recovery || busy) return;
    const previous = stateRef.current.records.find(row => row.id === stateRef.current?.recovery);
    const recoveryPolicy = previous ? {...previous.policy} : policy;
    setReview(null);
    setWarmingPromotion(null);
    setBusy(true);
    setError('');
    setShowCleanroomBar(true);
    const onProgress = activity.start('identity', '恢复原身份');
    try {
      await stop();
      const next = await invoke<IdentityState>('identities_switch', {
        targetId: 'empty',
        currentName: '',
        policy: recoveryPolicy,
        recover: true,
        onProgress,
      });
      commitAuthoritativeState(next);
      notifyHudIfTelemetryChanged(next, true);
      setResidueRevision(value => value + 1);
      activity.finish(true, next.browser_warning || '原身份已恢复。');
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await refreshAfterError();
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    await invoke('identities_stop', {onProgress: activity.channel()});
  }
  async function saveSnapshot() {
    if (!snapshot || busy) return;
    setSnapshot(false);
    setBusy(true);
    setError('');
    setShowCleanroomBar(false);
    const onProgress = activity.start('identity', '备份当前身份');
    try {
      await stop();
      const next = await invoke<IdentityState>('identities_save', {currentName: name.trim(), policy, onProgress});
      commitAuthoritativeState(next);
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
    // Recheck the latest native snapshot before any CLI process is stopped.
    if (warmingPromotion && stateRef.current?.warming_cards?.find(card => card.id === warmingPromotion.id)?.stage !== 'pro_ready') {
      setError(t('warming.promoteStageRequired'));
      setReview(null);
      setWarmingPromotion(null);
      return;
    }
    const target = review;
    if (typeof target === 'object' && target !== null) {
      await refreshLiveSessions(true);
      if ((stateRef.current?.slot_sessions?.[target.id]?.length ?? 0) > 0) {
        setError(t('relay.error.targetSlotBusy'));
        setReview(null);
        setWarmingPromotion(null);
        return;
      }
    }
    setReview(null);
    setBusy(true);
    setError('');
    setShowCleanroomBar(true);
    const onProgress = activity.start('identity', target === 'recovery' ? '恢复原身份' : target === 'empty' ? '切换到空身份' : '切换身份');
    try {
      await stop();
      const resolvedPrevId = resolveRelayAccountId('current');
      const previousActiveId = resolvedPrevId === 'current' ? null : resolvedPrevId;
      const previousReset5hSec = stateRef.current?.current?.quota_5h_reset_at ?? null;
      let next = warmingPromotion ? await invoke<IdentityState>('identities_warming_promote', {
        id: warmingPromotion.id, currentName: name.trim(), policy, onProgress,
      }) : await invoke<IdentityState>('identities_switch', {
        targetId: typeof target === 'object' ? target.id : 'empty',
        currentName: name.trim(),
        policy,
        recover: target === 'recovery',
        onProgress,
      });
      if (typeof target === 'object') {
        noteRelayAccountSwitch(previousActiveId, target.id, previousReset5hSec);
      }
      if (
        !warmingPromotion &&
        typeof target === 'object' &&
        syncCliBrowserOnSwitch &&
        next.browser.enabled &&
        next.warming_cards?.some(card => card.browser_active) &&
        next.current?.quota_identity
      ) {
        try {
          const bState = await invoke<BrowserState>('browser_return_to_cli', {
            expectedIdentity: next.current.quota_identity,
            onProgress,
          });
          next = {
            ...next,
            active_browser_slot: bState.active_browser_slot,
            warming_cards: next.warming_cards?.map(card => ({
              ...card,
              browser_active: card.slot === bState.active_browser_slot,
            })),
          };
        } catch {
          /* Keep completed CLI identity switch even if browser return fails */
        }
      }
      commitAuthoritativeState(next);
      notifyHudIfTelemetryChanged(next, true);
      setWarmingPromotion(null);
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
  async function warmingAction(command: string, args: Record<string, unknown>, progress = true): Promise<boolean> {
    if (busyRef.current || batchBusyRef.current) return false;
    busyRef.current = true;
    browserRuntime.invalidate();
    setBusy(true);
    setError('');
    const onProgress = warmingActivity.start('browser');
    try {
      const next = await invoke<IdentityState>(command, {...args, ...(progress ? {onProgress} : {})});
      commitAuthoritativeState(next);
      warmingActivity.finish(true, 'warming.operationDone');
      return true;
    } catch (e) {
      setError(String(e));
      warmingActivity.finish(false, String(e));
      await refreshAfterError();
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function saveWarming(fields: WarmingFields, id: string | undefined, openMode: WarmingOpenMode) {
    return warmingAction(id ? 'identities_warming_update' : 'identities_warming_create', {...fields, ...(id ? {id} : {openMode})}, !id);
  }
  function confirmDelete(target: Identity | 'current') {
    setDeletion(target);
    setAccepted(false);
    setDeleteBrowser(false);
    setError('');
    if (target === 'current') void refreshLiveSessions(true);
  }
  async function remove() {
    if (!deletion || !accepted || busy) return;
    const target = deletion;
    setDeletion(null);
    setBusy(true);
    setError('');
    setShowCleanroomBar(false);
    const onProgress = activity.start('identity', target === 'current' ? '直接删除当前身份' : '删除暂存身份');
    try {
      if (target === 'current') await stop();
      const next = await invoke<IdentityState>('identities_delete', {
        id: target === 'current' ? 'current' : target.id,
        policy,
        deleteBrowser: target !== 'current' && deleteBrowser,
        onProgress,
      });
      commitAuthoritativeState(next);
      if (target === 'current') notifyHudIfTelemetryChanged(next, true);
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
      commitAuthoritativeState(await invoke<IdentityState>('identities_rename', {id: rename.id, value: renameValue}));
      setRename(null);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function openExpiryEditor(
    accountId: string,
    label: string,
    meta: (IdentitySubscriptionMetadata & {quota_identity?: string | null; email?: string | null; plan?: string | null; subscription_expires_at?: number | null}) | null | undefined,
  ) {
    const badge = formatSubscriptionExpiryBadge(meta);
    const isManualDate = meta?.subscription_date_source === 'manual';
    const initialManualPlan = meta?.manual_plan?.trim() || '';
    const initialRechargeYmd = isManualDate ? (meta?.subscription_recharge_ymd?.trim() || badge?.rechargeYmd || '') : '';
    const initialExpiryYmd = isManualDate ? (meta?.subscription_expiry_ymd?.trim() || badge?.fullYmd || '') : '';
    if (quotaDetails !== null) {
      setSuppressQuotaRestoreFocus(true);
    }
    setQuotaDetails(null);
    setExpiryEditor({
      accountId,
      expectedIdentity: meta?.quota_identity ?? null,
      label,
      email: meta?.email ?? null,
      plan: meta?.plan ?? null,
      manualPlan: initialManualPlan,
      initialManualPlan,
      rechargeYmd: initialRechargeYmd,
      expiryYmd: initialExpiryYmd,
      initialRechargeYmd,
      initialExpiryYmd,
      browserSyncedShortMd: !isManualDate && badge ? badge.shortMd : null,
      browserSyncedFullYmd: !isManualDate && badge ? badge.fullYmd : null,
      hasManual: isManualDate || Boolean(initialManualPlan),
      error: '',
    });
    setError('');
  }
  async function saveSubscriptionExpiry(clear = false) {
    if (!expiryEditor || busy) return;
    const rechargeTrimmed = clear ? '' : expiryEditor.rechargeYmd.trim();
    const expiryTrimmed = clear ? '' : expiryEditor.expiryYmd.trim();
    const planChanged = expiryEditor.manualPlan !== expiryEditor.initialManualPlan;
    const dateChanged =
      expiryTrimmed !== expiryEditor.initialExpiryYmd ||
      rechargeTrimmed !== expiryEditor.initialRechargeYmd;
    const hasDateInput = Boolean(rechargeTrimmed || expiryTrimmed);
    let effectiveExpiry = expiryTrimmed;
    if (!clear) {
      if (rechargeTrimmed && !isValidCalendarYmd(rechargeTrimmed)) {
        setExpiryEditor(prev => (prev ? {...prev, error: 'identityCard.invalidSubscriptionDate'} : prev));
        return;
      }
      if (hasDateInput) {
        effectiveExpiry = expiryTrimmed || (rechargeTrimmed ? addOneCalendarMonthYmd(rechargeTrimmed) ?? '' : '');
        if (!effectiveExpiry || !isValidCalendarYmd(effectiveExpiry)) {
          setExpiryEditor(prev => (prev ? {...prev, error: 'identityCard.invalidSubscriptionDate'} : prev));
          return;
        }
      } else if (!planChanged && !dateChanged) {
        setExpiryEditor(prev => (prev ? {...prev, error: 'identityCard.invalidSubscriptionDate'} : prev));
        return;
      }
    }
    setBusy(true);
    try {
      const manualPlanArg = clear
        ? expiryEditor.initialManualPlan
          ? 'auto'
          : undefined
        : planChanged || expiryEditor.manualPlan
          ? expiryEditor.manualPlan || 'auto'
          : undefined;
      const next = await invoke<IdentityState>('identities_set_subscription_expiry', {
        accountId: expiryEditor.accountId,
        expectedIdentity: expiryEditor.expectedIdentity,
        expiryYmd: clear ? null : (hasDateInput ? effectiveExpiry || null : null),
        rechargeYmd: clear ? null : rechargeTrimmed || null,
        ...(manualPlanArg !== undefined ? {manualPlan: manualPlanArg} : {}),
      });
      if (mountedRef.current) {
        commitAuthoritativeState(next);
        setExpiryEditor(null);
        setError('');
      }
    } catch (e) {
      if (mountedRef.current) {
        setExpiryEditor(prev => (prev ? {...prev, error: String(e)} : prev));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }
  async function copyIdentityHandoffSpec(
    accountId: string,
    label: string,
    meta: (IdentitySubscriptionMetadata & {quota_identity?: string | null; email?: string | null; plan?: string | null; auth_status?: string | null; proxy?: string | null; subscription_expires_at?: number | null}) | null | undefined,
  ) {
    const shownLabel = maskDisplayName(label, meta?.email, prefs.privacyMask);
    const shownEmail = meta?.email ? maskEmailAddress(meta.email, prefs.privacyMask) : t('identityCard.notProvided');
    const planLabel = meta?.plan ? meta.plan.toUpperCase() : 'CLI';
    const authLabel = meta?.auth_status === 'valid' ? t('identities.handoffSpec.authOk') : t('identities.handoffSpec.authPending');
    const fpPrefix = meta?.quota_identity ? `\`${meta.quota_identity.slice(0, 12)}\`` : t('identities.handoffSpec.fingerprintUnverified');
    const profileKey = meta?.quota_identity ? `\`baga:${meta.quota_identity.slice(0, 12)}\`` : `\`slot:${accountId}\``;
    const cliProxyText = !prefs.privacyMask && meta?.proxy
      ? `\`${toCliHttpProxy(meta.proxy)}\` (Browser \`${toBrowserSocks5ProxyFromCli(meta.proxy) || 'socks5://127.0.0.1:7899'}\`)`
      : t('identities.handoffSpec.cliProxyFollow');
    const lines = [
      t('identities.handoffSpec.title'),
      t('identities.handoffSpec.identity', {name: shownLabel, email: shownEmail}),
      t('identities.handoffSpec.plan', {plan: planLabel, auth: authLabel}),
      t('identities.handoffSpec.fingerprint', {fp: fpPrefix}),
      t('identities.handoffSpec.browserBinding', {binding: profileKey}),
      t('identities.handoffSpec.browserRegion'),
      t('identities.handoffSpec.cliProxy', {proxy: cliProxyText}),
      t('identities.handoffSpec.browserProxy'),
      '',
      t('identities.handoffSpec.rulesHeader'),
      t('identities.handoffSpec.rule1'),
      t('identities.handoffSpec.rule2'),
      t('identities.handoffSpec.rule3'),
    ];
    const text = lines.join('\n');
    const copied = await copyToClipboard(text);
    setQuotaFeedback(copied ? 'identities.handoffSpecCopied' : 'identities.handoffSpecCopyFailed');
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await invoke('copy_result', {text});
      return true;
    } catch {
      try {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  async function copyBgResumeCommand(cmd: string): Promise<void> {
    if (bgResumeCopyTimerRef.current !== null) window.clearTimeout(bgResumeCopyTimerRef.current);
    const ok = await copyToClipboard(cmd);
    if (!mountedRef.current) return;
    setCopiedBgResume(ok);
    bgResumeCopyTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setCopiedBgResume(false);
    }, 2000);
  }

  async function openRelayAccountUsage(cand: RelayCandidate): Promise<void> {
    const summary = cand.isCurrent ? current : state?.summaries?.[cand.id];
    const expectedIdentity = summary?.quota_identity;
    if (!expectedIdentity) {
      setQuotaFeedback('browser.cliIdentityUnavailable');
      return;
    }
    if (cand.isCurrent) {
      if (actionLockedRef.current || batchBusyRef.current || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setQuotaFeedback('');
      try {
        setShowCleanroomBar(false);
        await invoke('browser_open_usage', {expectedIdentity, onProgress: activity.start('browser')});
        activity.finish(true, 'quota.opened');
        setQuotaFeedback('quota.opened');
      } catch (reason) {
        const message = String(reason);
        setQuotaFeedback(message);
        activity.finish(false, message);
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
      return;
    }
    await openAccountBrowser({account_id: cand.id, expected_identity: expectedIdentity}, 'usage');
  }

  function commitSlotProxy(accountId: string, rawValue: string): void {
    const res = validateSlotHttpProxy(rawValue);
    if (!res.ok) {
      setSlotProxyErrors(prev => ({...prev, [accountId]: res.errorKey || 'relay.proxy.invalidHttp'}));
      return;
    }
    setSlotProxyErrors(prev => {
      if (!(accountId in prev)) return prev;
      const next = {...prev};
      delete next[accountId];
      return next;
    });
    setSlotProxyDrafts(prev => ({...prev, [accountId]: res.normalized}));
    const existing = smartRelay.slotProxies[accountId] ?? '';
    if (existing === res.normalized) return;
    const nextSlotProxies = {...smartRelay.slotProxies};
    if (res.normalized) {
      nextSlotProxies[accountId] = res.normalized;
    } else {
      delete nextSlotProxies[accountId];
    }
    updateSmartRelayConfig({slotProxies: nextSlotProxies});
  }

  function flushPendingSlotProxies(): void {
    let changed = false;
    const nextSlotProxies = {...smartRelay.slotProxies};
    for (const [accountId, draft] of Object.entries(slotProxyDrafts)) {
      const res = validateSlotHttpProxy(draft);
      if (!res.ok) continue;
      const existing = nextSlotProxies[accountId] ?? '';
      if (existing === res.normalized) continue;
      changed = true;
      if (res.normalized) {
        nextSlotProxies[accountId] = res.normalized;
      } else {
        delete nextSlotProxies[accountId];
      }
    }
    if (changed) {
      updateSmartRelayConfig({slotProxies: nextSlotProxies});
    }
  }

  function normalizeNativeErrorKey(err: unknown): string {
    return String(err).replace(/^Error:\s*/i, '').trim();
  }

  async function syncSlotBrowserProxy(accountId: string): Promise<void> {
    if (!accountId || accountId === 'current' || syncingBrowserProxyIds[accountId]) return;
    setSyncingBrowserProxyIds(prev => ({...prev, [accountId]: true}));
    setBrowserProxySyncFeedback(prev => {
      if (!(accountId in prev)) return prev;
      const next = {...prev};
      delete next[accountId];
      return next;
    });
    try {
      await flushNativeSmartRelaySync();
      const nextState = await invoke<IdentityState>('identities_sync_browser_proxy', {id: accountId});
      if (mountedRef.current && nextState && typeof nextState === 'object') {
        setState(nextState);
        setBrowserProxySyncFeedback(prev => ({
          ...prev,
          [accountId]: {text: tRef.current('relay.browserSlotSynced')},
        }));
      }
    } catch (err) {
      if (mountedRef.current) {
        const msgKey = normalizeNativeErrorKey(err);
        setBrowserProxySyncFeedback(prev => ({
          ...prev,
          [accountId]: {text: tRef.current(msgKey), isError: true},
        }));
      }
    } finally {
      if (mountedRef.current) {
        setSyncingBrowserProxyIds(prev => {
          const next = {...prev};
          delete next[accountId];
          return next;
        });
      }
    }
  }

  async function installCliWrappers(): Promise<void> {
    if (cliWrappersBusy) return;
    setCliWrappersBusy(true);
    setCliWrappersFeedback(null);
    try {
      const res = await invoke<{agent_path?: string | null} | null>('identities_install_cli_wrappers');
      if (mountedRef.current) {
        const msgKey = res && typeof res === 'object' && res.agent_path ? 'relay.deployCliAndAgentOk' : 'relay.deployCliAndAgentOk';
        setCliWrappersFeedback({text: tRef.current(msgKey)});
      }
    } catch (err) {
      if (mountedRef.current) {
        setCliWrappersFeedback({text: tRef.current(normalizeNativeErrorKey(err)), isError: true});
      }
    } finally {
      if (mountedRef.current) setCliWrappersBusy(false);
    }
  }

  async function launchRelayTerminal(explicitCwd?: string): Promise<void> {
    if (launchRelayBusy) return;
    setLaunchRelayBusy(true);
    if (relayPanelOpen) setCliWrappersFeedback(null);
    const chosenCwd = (explicitCwd !== undefined ? explicitCwd : launchCwdDraft).trim();
    const chosenNorm = chosenCwd.replace(/\//g, '\\').toLowerCase();
    const isMruStaleCandidate = Boolean(
      chosenCwd &&
      getRelayLaunchDirs().some(dir => dir.replace(/\//g, '\\').toLowerCase() === chosenNorm),
    );
    let retriedWithFallback = false;
    try {
      await flushNativeSmartRelaySync();
      let res: {ok?: boolean; terminal?: string; cwd?: string | null};
      try {
        res = await invoke<{ok?: boolean; terminal?: string; cwd?: string | null}>('identities_launch_relay_cli', {
          cwd: chosenCwd || null,
          autoContinue: smartRelay.autoContinueOnRelay,
        });
      } catch (firstErr) {
        if (isMruStaleCandidate && normalizeNativeErrorKey(firstErr) === 'relay.error.invalidLaunchCwd') {
          removeRelayLaunchDir(chosenCwd);
          if (launchCwdDraft.trim().replace(/\//g, '\\').toLowerCase() === chosenNorm) {
            setLaunchCwdDraft('');
          }
          retriedWithFallback = true;
          res = await invoke<{ok?: boolean; terminal?: string; cwd?: string | null}>('identities_launch_relay_cli', {
            cwd: '',
            autoContinue: smartRelay.autoContinueOnRelay,
          });
        } else {
          throw firstErr;
        }
      }
      const savedDir = (res?.cwd && typeof res.cwd === 'string' ? res.cwd.trim() : '') || (retriedWithFallback ? '' : chosenCwd);
      if (savedDir && !retriedWithFallback) {
        recordRelayLaunchDir(savedDir);
      }
      if (mountedRef.current) {
        if (relayPanelOpen) {
          setCliWrappersFeedback({text: tRef.current('relay.launchedTerminalOk')});
        } else {
          setQuotaFeedback('relay.launchedTerminalOk');
        }
      }
    } catch (err) {
      const errKey = normalizeNativeErrorKey(err);
      if (mountedRef.current) {
        if (relayPanelOpen) {
          setCliWrappersFeedback({text: tRef.current(errKey), isError: true});
        } else {
          setQuotaFeedback(errKey);
        }
      }
    } finally {
      if (mountedRef.current) setLaunchRelayBusy(false);
    }
  }

  async function copyRelayCommand(): Promise<void> {
    const cmd = smartRelay.autoContinueOnRelay ? 'claude-relay -AutoContinue' : 'claude-relay';
    const ok = await copyToClipboard(cmd);
    if (mountedRef.current) {
      setCliWrappersFeedback(
        ok
          ? {text: tRef.current('relay.copiedRelayCmd', {cmd})}
          : {text: tRef.current('relay.copyFailed'), isError: true},
      );
    }
  }

  async function copySubagentTemplate(): Promise<void> {
    const ok = await copyToClipboard(buildSubagentMarkdownTemplate());
    if (mountedRef.current) {
      setCliWrappersFeedback(
        ok
          ? {text: tRef.current('relay.copiedSubagentTpl')}
          : {text: tRef.current('relay.copyFailed'), isError: true},
      );
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
    </div>
  );

  const nowMs = nowSec * 1000;
  const wakeupAccountRows = useMemo(() => {
    if (!onlinePanelOpen) return [];
    return quotaTargets.map(target => {
      const row = state?.records.find(record => record.id === target.account_id);
      const summary = target.account_id === 'current' ? current : state?.summaries?.[target.account_id];
      const label = target.account_id === 'current' ? currentName : row?.name ?? t('quotaOnline.unknownAccount');
      const q = evaluateQuota(summary, nowSec);
      const runtime = autoWakeState.accounts[target.expected_identity];
      const view = presentWakeupAccount({
        runtime,
        authStatus: summary?.auth_status,
        expired: Boolean(q?.inferred5h || q?.expired5h),
        activeWindow: Boolean(q?.r5 && q.r5 > nowSec),
        runningCli: target.account_id === 'current' && Boolean(state?.running),
        excluded: autoWakeConfig.excludedIdentities.includes(target.expected_identity),
        weeklyBlocked: Boolean(q?.known7d && q.rem7d <= 5),
        snapshotReady: nativeWakeup.migrated && nativeWakeup.status !== 'loading',
        storageError: nativeWakeup.status === 'storage_error',
        nextGlobalAtMs: nativeWakeup.nextGlobalAtMs,
        nowMs,
      });
      return {
        target,
        label: maskDisplayName(label, summary?.email, prefs.privacyMask),
        runtime,
        view,
        canWakeManual: Boolean(q?.inferred5h || q?.expired5h),
      };
    });
  }, [
    onlinePanelOpen,
    quotaTargets,
    state?.records,
    state?.summaries,
    state?.running,
    current,
    currentName,
    t,
    nowSec,
    nowMs,
    autoWakeState.accounts,
    autoWakeConfig.excludedIdentities,
    nativeWakeup.migrated,
    nativeWakeup.status,
    nativeWakeup.nextGlobalAtMs,
    prefs.privacyMask,
  ]);
  const wakeableCount = useMemo(() => wakeupAccountRows.filter(item => item.view.canWake).length, [wakeupAccountRows]);

  return (
    <section className="identity-page">
      <header className="cleanup-title">
        <h1>{t('身份管理')}</h1>
        <div className="identity-header-actions">
          <div className="identity-header-group identity-header-primary">
            <div className={`wakeup-header-pill${autoWakeConfig.enabled ? ' is-enabled' : ''}`}>
              <Button
                variant="secondary"
                size="small"
                className={`monitor-toggle-btn wakeup-toggle-btn${autoWakeConfig.enabled ? ' is-enabled' : ''}`}
                title={t('wakeup.toggleHint')}
                disabled={autoWakeSaving || nativeWakeup.status === 'loading' || nativeWakeup.status === 'storage_error'}
                onClick={() => void updateAutoWakeConfig({enabled: !autoWakeConfig.enabled})}
              >
                <span className={`monitor-toggle-dot${autoWakeConfig.enabled ? ' is-open' : ''}`} aria-hidden="true" />
                {t(autoWakeConfig.enabled ? 'wakeup.toggleOn' : 'wakeup.toggleOff')}
              </Button>
              <button
                type="button"
                className="wakeup-config-trigger"
                title={t('wakeup.configureWindow')}
                aria-label={t('wakeup.configureWindow')}
                onClick={() => setOnlinePanelOpen(true)}
              >
                {autoWakeConfig.useTimeWindow
                  ? `${formatMinuteOfDay(autoWakeConfig.startMinute)}-${formatMinuteOfDay(autoWakeConfig.endMinute)}`
                  : t('wakeup.presetAllDay')}
              </button>
            </div>
            <div className={`relay-header-pill${smartRelay.enabled ? ' is-enabled' : ''}`} data-smart-relay-pill>
              <Button
                variant="secondary"
                size="small"
                className={`monitor-toggle-btn relay-toggle-btn${smartRelay.enabled ? ' is-enabled' : ''}`}
                title={t('relay.toggleHint')}
                disabled={blocked}
                onClick={() => updateSmartRelayConfig({enabled: !smartRelay.enabled})}
              >
                <span className={`monitor-toggle-dot${smartRelay.enabled ? ' is-open' : ''}`} aria-hidden="true" />
                {t(smartRelay.enabled ? 'relay.toggleOn' : 'relay.toggleOff')}
              </Button>
              <button
                type="button"
                className="relay-config-trigger"
                data-smart-relay-trigger
                title={t('relay.configureButton')}
                aria-label={t('relay.configureButton')}
                onClick={() => setRelayPanelOpen(true)}
              >
                {t(`relay.strategy.${smartRelay.strategy}`)}
              </button>
            </div>
          </div>
          <div className="identity-header-group identity-header-secondary">
            <Button
              variant="secondary"
              size="small"
              className={`monitor-toggle-btn${monitorOpen && monitorClickThrough ? ' is-click-through' : ''}`}
              title={monitorOpen && monitorClickThrough ? t('monitor.toggleGhostHint') : t('monitor.toggleHint')}
              onClick={() => void toggleMonitorWindow()}
            >
              <span
                className={`monitor-toggle-dot${monitorOpen ? (monitorClickThrough ? ' is-click-through' : ' is-open') : ''}`}
                aria-hidden="true"
              />
              {monitorOpen && monitorClickThrough
                ? t('monitor.toggleButtonGhost')
                : t(monitorOpen ? 'monitor.toggleButtonOpen' : 'monitor.toggleButton')}
            </Button>
            <Button
              variant="secondary"
              size="small"
              data-quota-sync
              aria-label={t('identityCard.localQuotaSync')}
              disabled={actionLocked || loading || manualSyncing}
              loading={loading || manualSyncing}
              leftIcon={
                syncedFeedback && !loading && !manualSyncing ? (
                  <CheckTickCircle aria-hidden="true" size={15} />
                ) : (
                  <Refresh aria-hidden size={16} className={loading || manualSyncing ? 'spin' : ''} />
                )
              }
              title={t('identityCard.localQuotaSync')}
              onClick={() => void manualSyncLocalQuota()}
            >
              {syncedFeedback && !loading && !manualSyncing ? t('identityCard.localQuotaSynced') : t('identityCard.localQuotaSync')}
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="identity-menu-trigger identity-header-menu-trigger"
                  aria-label={t('identityCard.quotaMoreActions')}
                  title={t('identityCard.quotaMoreActions')}
                >
                  ⋯
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                  <DropdownMenu.Item className="identity-menu-item" onSelect={() => setRelayPanelOpen(true)}>
                    {t('relay.dialogTitle')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="identity-menu-item" onSelect={() => setOnlinePanelOpen(true)}>
                    {t('identityCard.onlineQuery')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="identity-menu-item"
                    disabled={actionLocked || batchBusy || loading || !state?.browser.enabled || quotaTargets.length === 0}
                    onSelect={() => void openAllAccountUsagePages()}
                  >
                    {t('browser.openAllAccountUsage')}
                  </DropdownMenu.Item>
                  {identityReorder.hasCustomOrder && (
                    <>
                      <DropdownMenu.Separator className="identity-menu-separator" />
                      <DropdownMenu.Item className="identity-menu-item" onSelect={() => identityReorder.resetCardOrder()}>
                        {t('identityCard.resetCardOrder')}
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>

      {batchBusy && <div className="identity-batch-task identity-batch-task-compact" role="status" aria-live="polite">
        <span>{t('quotaOnline.taskRunning', {completed: batchSummary.completed, total: batchSummary.total})}</span>
        {batchSummary.deadlineAtMs && <span>{t('quotaOnline.taskDeadline', {v0: Math.max(0, Math.ceil((batchSummary.deadlineAtMs - Date.now()) / 1000))})}</span>}
        {batchSummary.notRunCount ? <span>{t('quotaOnline.taskRemaining', {count: batchSummary.notRunCount})}</span> : null}
        <Button variant="secondary" size="small" onClick={() => setOnlinePanelOpen(true)}>
          {t('identityCard.onlineQuery')}
        </Button>
        <Button variant="secondary" size="small" disabled={batchCanceling} loading={batchCanceling} onClick={() => void cancelBatch()}>
          {t(batchCanceling ? 'quotaOnline.cancelling' : 'quotaOnline.cancelBatch')}
        </Button>
      </div>}

      <AppDialog
        open={onlinePanelOpen}
        onOpenChange={open => {setOnlinePanelOpen(open);if (!open) setForegroundAutoRefresh(false);}}
        title={t('identityCard.onlineQuery')}
        width={680}
        className="identity-online-query-dialog"
        fallbackFocusRef={quotaOpenerRef}
      >
        {onlinePanelOpen ? (
          <div className="identity-online-query-body">
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
          <Button
            variant="secondary"
            size="small"
            data-query-stale-unknown
            disabled={actionLocked || batchBusy || loading || staleQuotaTargets.length === 0}
            onClick={() => void refreshAllQuotas(true, staleQuotaTargets)}
          >
            {`${t('quotaOnline.queryStaleUnknown')} (${staleQuotaTargets.length})`}
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

        <section className="identity-wakeup-panel" aria-labelledby="identity-wakeup-title">
          <div className="identity-wakeup-head">
            <div className="identity-wakeup-title-block">
              <h3 id="identity-wakeup-title">{t('wakeup.panelTitle')}</h3>
              <p>{t('wakeup.panelDesc')}</p>
              <p>{t('wakeup.applicationOnly')}</p>
              {nativeWakeup.status === 'scope_changed' && <p role="status">{t('wakeup.scopeChanged')}</p>}
              {nativeWakeup.status === 'storage_error' && <p role="status">{t('wakeup.stateSaveFailed')}</p>}
              {nativeWakeup.status === 'runtime_unavailable' && <p role="status">{t('wakeup.runtimeUnavailable')}</p>}
            </div>
            <div className="identity-wakeup-head-actions">
              {wakeableCount > 0 && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={actionLocked || batchBusy || loading || wakingAccountId !== null || autoWakeSaving}
                  loading={wakingAccountId !== null}
                  onClick={() => void wakeupAllIdleAccounts()}
                >
                  {t('wakeup.wakeAllIdle', {count: wakeableCount})}
                </Button>
              )}
              <label className="identity-auto-refresh-toggle wakeup-master-switch">
                <Switch
                  checked={autoWakeConfig.enabled}
                  disabled={autoWakeSaving || nativeWakeup.status === 'loading' || nativeWakeup.status === 'storage_error'}
                  onCheckedChange={checked => updateAutoWakeConfig({enabled: checked})}
                  aria-label={t('wakeup.enableSwitch')}
                />
                <span>{t('wakeup.enableSwitch')}</span>
              </label>
            </div>
          </div>

          <div className="identity-wakeup-config-grid">
            <div className="identity-wakeup-time-row">
              <Checkbox
                label={t('wakeup.timeWindowSwitch')}
                checked={autoWakeConfig.useTimeWindow}
                onCheckedChange={checked => updateAutoWakeConfig({useTimeWindow: checked === true})}
              />
              <div className="identity-wakeup-time-inputs">
                <input
                  type="time"
                  className="wakeup-time-input"
                  disabled={!autoWakeConfig.useTimeWindow}
                  value={formatMinuteOfDay(autoWakeConfig.startMinute)}
                  onChange={e => updateAutoWakeConfig({startMinute: parseMinuteOfDay(e.target.value, autoWakeConfig.startMinute)})}
                  aria-label="wakeup-start-time"
                />
                <span className="wakeup-time-sep">{t('wakeup.timeTo')}</span>
                <input
                  type="time"
                  className="wakeup-time-input"
                  disabled={!autoWakeConfig.useTimeWindow}
                  value={formatMinuteOfDay(autoWakeConfig.endMinute)}
                  onChange={e => updateAutoWakeConfig({endMinute: parseMinuteOfDay(e.target.value, autoWakeConfig.endMinute)})}
                  aria-label="wakeup-end-time"
                />
              </div>
              <div className="identity-wakeup-presets">
                <button
                  type="button"
                  className={`wakeup-preset-chip${autoWakeConfig.useTimeWindow && autoWakeConfig.startMinute === 480 && autoWakeConfig.endMinute === 1380 ? ' active' : ''}`}
                  onClick={() => updateAutoWakeConfig({useTimeWindow: true, startMinute: 480, endMinute: 1380})}
                >
                  {t('wakeup.presetDay')}
                </button>
                <button
                  type="button"
                  className={`wakeup-preset-chip${autoWakeConfig.useTimeWindow && autoWakeConfig.startMinute === 540 && autoWakeConfig.endMinute === 1140 ? ' active' : ''}`}
                  onClick={() => updateAutoWakeConfig({useTimeWindow: true, startMinute: 540, endMinute: 1140})}
                >
                  {t('wakeup.presetWork')}
                </button>
                <button
                  type="button"
                  className={`wakeup-preset-chip${!autoWakeConfig.useTimeWindow ? ' active' : ''}`}
                  onClick={() => updateAutoWakeConfig({useTimeWindow: false})}
                >
                  {t('wakeup.presetAllDay')}
                </button>
              </div>
            </div>

            <div className="identity-wakeup-prewarm-row">
              <span>{t('wakeup.prewarmLabel')}</span>
              <div className="identity-wakeup-presets">
                {[30, 40, 50].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    className={`wakeup-preset-chip${autoWakeConfig.prewarmThresholdPct === pct ? ' active' : ''}`}
                    onClick={() => updateAutoWakeConfig({prewarmThresholdPct: pct})}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="identity-wakeup-antiban">{t('wakeup.antiBanNote')}</p>

          {wakeupAccountRows.length > 0 && (
            <div className="identity-wakeup-account-list">
              {wakeupAccountRows.map(({target, label, canWakeManual, runtime, view}) => {
                const anchorInfo = wakeupAnchorMap[target.expected_identity.toLowerCase()];
                return (
                <div className="identity-wakeup-account-row" key={target.account_id} data-wakeup-state={view.stateKey}>
                  <div className="identity-wakeup-account-head">
                    <span className="identity-wakeup-account-name">{label}</span>
                    <span className={`identity-wakeup-status-pill tone-${view.tone}`}>{t(view.stateKey)}</span>
                    {anchorInfo && (
                      <span
                        className={`identity-wakeup-status-pill tone-${anchorInfo.status === 'advanced_new_cycle' ? 'ok' : 'warn'}`}
                        data-wakeup-anchor={anchorInfo.status}
                      >
                        {t(anchorInfo.labelKey)}
                      </span>
                    )}
                    <span className="identity-wakeup-local-auth">{t(view.localAuthKey)}</span>
                  </div>
                  <div className="identity-wakeup-account-actions">
                    <Button variant="secondary" size="small" disabled={autoWakeSaving || actionLocked || batchBusy}
                      onClick={() => void updateAutoWakeConfig({excludedIdentities: autoWakeConfig.excludedIdentities.includes(target.expected_identity) ? autoWakeConfig.excludedIdentities.filter(id => id !== target.expected_identity) : [...autoWakeConfig.excludedIdentities, target.expected_identity]})}>
                      {t(autoWakeConfig.excludedIdentities.includes(target.expected_identity) ? 'wakeup.resume' : 'wakeup.pause')}
                    </Button>
                    {view.showRecovery && <Button variant="secondary" size="small" disabled={actionLocked || batchBusy || !view.canRecover}
                      onClick={() => void resumeWakeup(target.expected_identity)}>{t(view.recoveryGranted ? 'wakeup.recoveryReadyLabel' : 'wakeup.recoverOnce')}</Button>}
                    {canWakeManual && <Button variant="secondary" size="small"
                      disabled={actionLocked || batchBusy || loading || wakingAccountId !== null || autoWakeSaving || !view.canWake}
                      loading={wakingAccountId === target.account_id}
                      onClick={() => void wakeupSingleAccount(target.account_id, target.expected_identity, false)}>{t('wakeup.wakeNow')}</Button>}
                    <Button
                      variant="secondary"
                      size="small"
                      loading={Boolean(syncingAccountIds[target.account_id])}
                      disabled={actionLocked || batchBusy || busy || Boolean(syncingAccountIds[target.account_id]) || loading || !state?.browser.enabled}
                      onClick={() => void syncSubscription(target.account_id, target.expected_identity)}
                    >
                      {t('quota.syncSubscription')}
                    </Button>
                  </div>
                  <div className="identity-wakeup-account-details" data-wakeup-gate={view.block ?? undefined}>
                    <p>{t(view.detailKey)}{view.waitUntilMs && <> {formatWakeupWait((view.waitUntilMs - nowMs) / 1000, t)}</>}
                      {view.scheduledAtMs && !view.waitUntilMs && <> {t('wakeup.nextPlanAt', {time: formatResetClock(Math.floor(view.scheduledAtMs / 1000), false)})}</>}
                    </p>
                    <div className="identity-wakeup-account-meta">
                      <span>{t(`wakeup.capability.${runtime?.capability || 'unknown'}`)}</span>
                      {runtime?.lastAttemptAtMs && <span>{t('wakeup.lastAttemptAt', {time: formatResetClock(Math.floor(runtime.lastAttemptAtMs / 1000), false)})}</span>}
                      {(runtime?.unusedStreak ?? 0) > 0 && <span>{t('wakeup.streakBadge', {count: runtime!.unusedStreak})}</span>}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </section>

      <IdentityConnections
        items={connectionQueueItems}
        busy={batchBusy || busy || loading || !!state?.recovery}
        t={t}
        onOpen={target => void openAccountBrowser(target)}
        onRetry={targets => void refreshAllQuotas(true, targets)}
      />
      {!quotaDetails && (quotaFeedbackText || batchSummary.completed > 0) && <p className="identity-online-feedback" role="status">{quotaFeedbackText ? quotaFeedbackText : formatBatchProgress(batchSummary, t)}{unverifiedQuotaTargets > 0 && <> · {t('quotaOnline.unverifiedTargets', {count:unverifiedQuotaTargets})}</>}</p>}
          </div>
        ) : null}
      </AppDialog>

      <AppDialog
        open={relayPanelOpen}
        onOpenChange={open => {
          if (!open) flushPendingSlotProxies();
          setRelayPanelOpen(open);
        }}
        title={t('relay.dialogTitle')}
        description={t('relay.dialogDesc')}
        width={720}
        className="identity-relay-dialog"
        footer={
          <div className="identity-dialog-footer-spread">
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                resetSmartRelayConfig();
                setSlotProxyDrafts({});
                setSlotProxyErrors({});
              }}
            >
              {t('settings.relayResetBtn')}
            </Button>
            <div className="identity-relay-banner-actions">
              {relayRecommendedSaved && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={blocked}
                  onClick={() => {
                    flushPendingSlotProxies();
                    setRelayPanelOpen(false);
                    choose(relayRecommendedSaved.row);
                  }}
                >
                  {t('relay.relaySwitchNow', {
                    target: maskDisplayName(
                      relayRecommendedSaved.row.name,
                      state?.summaries?.[relayRecommendedSaved.row.id]?.email,
                      prefs.privacyMask,
                    ),
                  })}
                </Button>
              )}
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  flushPendingSlotProxies();
                  setRelayPanelOpen(false);
                }}
              >
                {t('关闭')}
              </Button>
            </div>
          </div>
        }
      >
        {relayPanelOpen ? (
        <div className="identity-relay-panel">
          <div className="identity-relay-master-row">
            <div>
              <strong>{t('settings.relayEnableLabel')}</strong>
              <p>{t('settings.relayEnableHint')}</p>
            </div>
            <label className="identity-auto-refresh-toggle">
              <Switch
                checked={smartRelay.enabled}
                onCheckedChange={checked => updateSmartRelayConfig({enabled: checked})}
                aria-label={t('settings.relayEnableLabel')}
              />
            </label>
          </div>

          <div className="identity-relay-pool-summary" data-relay-pool-summary>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.ready')}:</span>
              <strong>{relayPoolSummary.readyCount}/{relayPoolSummary.includedCount}</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.avg5hRem')}:</span>
              <strong>{relayPoolSummary.avg5hRemainingPct}%</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.avg7dRem')}:</span>
              <strong>{relayPoolSummary.avgRem7dPct}%</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.manualResets')}:</span>
              <strong>{relayPoolSummary.totalManualResetsRemaining}</strong>
            </span>
            {relayPoolSummary.soonestResetSec && (
              <span className="identity-relay-pool-stat">
                <span>{t('relay.pool.nextReset')}:</span>
                <strong>{formatCompactEta(relayPoolSummary.soonestResetSec, nowSec)}</strong>
              </span>
            )}
            {relayPoolSummary.totalManualResetsRemaining > 0 && smartRelay.strategy !== 'reset_harvest' && (
              <button
                type="button"
                className="identity-relay-harvest-recommend-btn"
                data-relay-recommend-harvest
                onClick={() => updateSmartRelayConfig({enabled: true, strategy: 'reset_harvest'})}
              >
                {t('relay.recommendHarvestChip', {count: relayPoolSummary.totalManualResetsRemaining})}
              </button>
            )}
          </div>

          {current?.present && !active && (
            <div className="identity-unsaved-pool-hint" role="note" data-relay-unsaved-hint>
              <span>{t('identities.unsavedPoolHint')}</span>
              <Button
                variant="secondary"
                size="small"
                disabled={blocked}
                onClick={() => {
                  flushPendingSlotProxies();
                  setRelayPanelOpen(false);
                  openSnapshot();
                }}
              >
                {t('identities.unsavedSaveNow')}
              </Button>
            </div>
          )}

          <section className="identity-relay-section" aria-label={t('relay.accountsLabel')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.accountsLabel')}</h3>
              <div className="identity-relay-preferred-controls">
                <label className="identity-relay-return-preferred">
                  <Checkbox
                    label={t('settings.relayPreferredReturnLabel')}
                    checked={smartRelay.returnToPreferred}
                    onCheckedChange={v => updateSmartRelayConfig({returnToPreferred: v === true})}
                  />
                </label>
                {smartRelay.returnToPreferred && (
                  <div
                    className="identity-wakeup-presets identity-relay-return-thresh"
                    role="group"
                    aria-label={t('relay.preferredReturnThresholdLabel')}
                  >
                    {([80, 85, 90] as const).map(pct => (
                      <button
                        key={pct}
                        type="button"
                        data-relay-return-threshold={pct}
                        className={`wakeup-preset-chip${smartRelay.preferredReturnThresholdPct === pct ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({preferredReturnThresholdPct: pct})}
                      >
                        ≤{pct}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {sameExitCluster && (
              <div className="identity-unsaved-pool-hint identity-relay-cluster-hint" role="note" data-relay-exit-cluster-hint>
                <span>
                  {sameExitCluster.clusterCount && sameExitCluster.clusterCount > 1 && sameExitCluster.clusters
                    ? t('relay.sameExitMultiClusterHint', {
                        clusterCount: sameExitCluster.clusterCount,
                        count: sameExitCluster.count,
                        endpoint: sameExitCluster.endpoint,
                        endpoints: sameExitCluster.clusters.map(c => `${c.endpoint} (${c.count})`).join(', '),
                      })
                    : t('relay.sameExitClusterHint', {count: sameExitCluster.count, endpoint: sameExitCluster.endpoint})}
                </span>
              </div>
            )}
            <div className="identity-relay-account-list">
              {[...relayEval.candidates]
                .sort((a, b) => a.listIndex - b.listIndex)
                .map(acc => {
                  const isExcluded = !acc.isIncluded;
                  const isPreferred = smartRelay.preferredAccountId === acc.id;
                  const isRecommendedNext = !acc.isCurrent && relayEval.recommended?.id === acc.id;
                  const used5h = acc.known5h && !acc.no5hLimit ? acc.used5h : 0;
                  const used7d = acc.known7d ? acc.used7d : 0;
                  const shown5hPct = prefs.quotaDisplay === 'used' ? acc.used5h : acc.rem5h;
                  const shown7dPct = prefs.quotaDisplay === 'used' ? acc.used7d : acc.rem7d;
                  const bar5hWidth = acc.no5hLimit ? 100 : acc.known5h ? Math.min(100, Math.max(4, shown5hPct)) : 0;
                  const bar7dWidth = acc.known7d ? Math.min(100, Math.max(4, shown7dPct)) : 0;
                  const fill5hClass = acc.no5hLimit
                    ? ' is-unlimited'
                    : used5h >= 95
                      ? ' is-empty'
                      : used5h >= 80
                        ? ' is-warn'
                        : '';
                  const fill7dClass = used7d >= 95 ? ' is-empty' : used7d >= 80 ? ' is-warn' : '';
                  const quotaPrefix = t(prefs.quotaDisplay === 'used' ? 'identityCard.used' : 'identityCard.remaining');
                  const syncKey = acc.isCurrent ? 'current' : acc.id;
                  const isSyncingAcc = Boolean(syncingAccountIds[syncKey]);
                  const displayLabel = maskDisplayName(acc.name, acc.email, prefs.privacyMask);
                  const accSlotSessions = state?.slot_sessions?.[acc.id] ?? [];
                  const accSummary = acc.isCurrent ? current : state?.summaries?.[acc.id];
                  const accIdentity = accSummary?.quota_identity;
                  const cliFallbackHttp = cliDefaultProxy ? toCliHttpProxy(cliDefaultProxy) : '';
                  const summaryHttpProxy = accSummary?.proxy ? toCliHttpProxy(accSummary.proxy) : '';
                  const inheritedCliHttp =
                    cliDefaultProxy !== undefined ? cliFallbackHttp : summaryHttpProxy;
                  const proxyPlaceholder = inheritedCliHttp || 'http://127.0.0.1:7899';
                  const savedSlotProxy = smartRelay.slotProxies[acc.id] ?? '';
                  const effectiveCliProxy = savedSlotProxy || inheritedCliHttp;
                  const slotBrowserProxy =
                    acc.id && acc.id !== 'current' ? state?.slot_browser_proxies?.[acc.id] : undefined;
                  const hasBrowserProxyMismatch = Boolean(
                    slotBrowserProxy && !isSlotBrowserProxyAligned(slotBrowserProxy.proxy, effectiveCliProxy),
                  );
                  const browserSyncFeedback = browserProxySyncFeedback[acc.id];
                  const slotProxyDraft = slotProxyDrafts[acc.id] ?? savedSlotProxy;
                  const slotProxyError = slotProxyErrors[acc.id];
                  const isProxyExpanded = Boolean(expandedProxyIds[acc.id] || slotProxyError);
                  const customEndpointShort = savedSlotProxy
                    ? savedSlotProxy.replace(/^http:\/\//i, '').replace(/^127\.0\.0\.1:/, ':').replace(/^localhost:/i, ':')
                    : '';
                  const inheritedPort = inheritedCliHttp.match(/:(\d+)$/)?.[1] ?? '7899';
                  const proxyPillLabel = savedSlotProxy
                    ? t('relay.proxyCustomPill', {endpoint: customEndpointShort})
                    : inheritedCliHttp
                      ? t('relay.proxyInheritedPill', {port: inheritedPort})
                      : t('relay.proxyDefaultPill');
                  const resetTier = computeResetCardExpiryUrgency(
                    acc.earliestResetGrantEndsAt,
                    acc.manualResetsRemaining,
                    nowSec,
                  );
                  const resetGrantEta =
                    acc.earliestResetGrantEndsAt && acc.earliestResetGrantEndsAt > nowSec
                      ? formatCompactEta(acc.earliestResetGrantEndsAt, nowSec)
                      : '';
                  return (
                    <div
                      className={`identity-relay-account-row${isExcluded ? ' is-excluded' : ''}${acc.isCurrent ? ' is-current' : ''}`}
                      key={acc.id}
                    >
                      <div className="identity-relay-account-top">
                        <div className="identity-relay-account-left">
                          <Checkbox
                            label={displayLabel}
                            checked={!isExcluded}
                            onCheckedChange={checked => {
                              const nextExcluded = checked
                                ? smartRelay.excludedAccountIds.filter(id => id !== acc.id)
                                : [...smartRelay.excludedAccountIds, acc.id];
                              updateSmartRelayConfig({excludedAccountIds: nextExcluded});
                            }}
                          />
                          {acc.plan && (
                            <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(acc.plan)}>
                              {acc.plan}
                            </span>
                          )}
                          {acc.isCurrent && <span className="identity-relay-current-badge">{t('relay.currentBadge')}</span>}
                          {isRecommendedNext && (
                            <span className="identity-relay-recommended-pill">{t('relay.recommendedBadge')}</span>
                          )}
                          {accSlotSessions.length > 0 && (
                            <span
                              className="identity-relay-slot-pill"
                              title={accSlotSessions
                                .map(s => `${s.entrypoint}${s.workspace ? ` · ${s.workspace}` : ''} (PID ${s.pid})`)
                                .join('\n')}
                            >
                              <i className="slot-live-dot" aria-hidden="true" />
                              {accSlotSessions.length > 1
                                ? t('relay.slotLiveCount', {count: accSlotSessions.length})
                                : t('relay.slotLiveBadge')}
                            </span>
                          )}
                        </div>
                        <div className="identity-relay-account-right">
                          {acc.awaitingManualReset && (
                            <>
                              <button
                                type="button"
                                className="identity-relay-quick-reset-btn"
                                disabled={busy || batchBusy || loading || !!state?.recovery || !accIdentity}
                                onClick={() => void openRelayAccountUsage(acc)}
                              >
                                {t('relay.goResetBtn')}
                              </button>
                              <button
                                type="button"
                                className="identity-relay-verify-reset-btn"
                                data-relay-verify-reset={acc.id}
                                disabled={busy || batchBusy || loading || !!state?.recovery || !state?.browser.enabled || !accIdentity || isSyncingAcc}
                                onClick={() => void syncSubscription(acc.isCurrent ? undefined : acc.id, accIdentity || undefined, true)}
                              >
                                {t('relay.verifyResetBtn')}
                              </button>
                            </>
                          )}
                          {acc.inCooldown && (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              onClick={() => clearAccountCooldown(acc.id)}
                            >
                              {t('relay.clearCooldown')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`identity-relay-proxy-pill${savedSlotProxy ? ' is-custom' : ''}${slotProxyError ? ' is-invalid' : ''}${hasBrowserProxyMismatch ? ' is-mismatch' : ''}`}
                            data-relay-proxy-toggle={acc.id}
                            data-relay-proxy-mismatch={hasBrowserProxyMismatch ? 'true' : undefined}
                            title={
                              hasBrowserProxyMismatch && slotBrowserProxy
                                ? `${t('relay.slotProxyLabel')}: ${effectiveCliProxy || t('relay.browserSlotDirect')} · ${t('relay.browserSlotMismatchHint', {browserProxy: slotBrowserProxy.proxy || t('relay.browserSlotDirect')})}`
                                : `${t('relay.slotProxyLabel')}: ${savedSlotProxy || proxyPlaceholder}`
                            }
                            onClick={() =>
                              setExpandedProxyIds(prev => ({
                                ...prev,
                                [acc.id]: !isProxyExpanded,
                              }))
                            }
                          >
                            {proxyPillLabel}
                            {hasBrowserProxyMismatch && (
                              <span
                                className="identity-relay-proxy-warn-dot"
                                aria-label={t('relay.browserSlotMismatchBadge')}
                              >
                                !
                              </span>
                            )}
                          </button>
                          {isPreferred ? (
                            <button
                              type="button"
                              className="identity-relay-preferred-pill is-clickable"
                              title={t('relay.unsetPreferredTooltip')}
                              aria-label={t('relay.unsetPreferredTooltip')}
                              data-relay-unset-preferred={acc.id}
                              onClick={() => updateSmartRelayConfig({preferredAccountId: null})}
                            >
                              {t('relay.preferredBadge')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              data-relay-set-preferred={acc.id}
                              onClick={() => updateSmartRelayConfig({preferredAccountId: acc.id})}
                            >
                              {t('relay.setPreferred')}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="identity-relay-account-bars">
                        <div className="identity-relay-bars-tracks">
                          <div className="identity-relay-mini-quota">
                            <span>{t('relay.window5hShort')}</span>
                            <div className="identity-relay-mini-track">
                              <div
                                className={`identity-relay-mini-fill${fill5hClass}`}
                                style={{width: `${bar5hWidth}%`}}
                              />
                            </div>
                            <strong>
                              {acc.no5hLimit
                                ? t('identityCard.unlimited')
                                : acc.known5h
                                  ? `${quotaPrefix} ${formatTruthfulPercent(shown5hPct)}`
                                  : '—'}
                            </strong>
                          </div>
                          <div className="identity-relay-account-bars-sep" />
                          <div className="identity-relay-mini-quota">
                            <span>{t('relay.window7dShort')}</span>
                            <div className="identity-relay-mini-track">
                              <div
                                className={`identity-relay-mini-fill${fill7dClass}`}
                                style={{width: `${bar7dWidth}%`}}
                              />
                            </div>
                            <strong>
                              {acc.known7d ? `${quotaPrefix} ${formatTruthfulPercent(shown7dPct)}` : '—'}
                            </strong>
                          </div>
                        </div>
                        {(acc.manualResetsRemaining > 0 ||
                          acc.awaitingManualReset ||
                          acc.inCooldown ||
                          (acc.known5h && !acc.no5hLimit && Math.abs(acc.pace5hDeltaPct) >= 10)) && (
                          <div className="identity-relay-bars-badges">
                            {acc.manualResetsRemaining > 0 && (
                              <span
                                className={`identity-relay-reset-pill${resetTier && resetTier !== 'normal' ? ` tier-${resetTier}` : ''}`}
                                data-reset-tier={resetTier || undefined}
                                title={resetGrantEta ? t('relay.resetCardExpiringTitle', {eta: resetGrantEta}) : undefined}
                              >
                                {t('relay.resetCardBadge', {count: acc.manualResetsRemaining})}
                                {resetTier && resetTier !== 'normal' && resetGrantEta ? ` · ${resetGrantEta}` : ''}
                              </span>
                            )}
                            {acc.awaitingManualReset && (
                              <span className="identity-relay-awaiting-pill">{t('relay.awaitingResetBadge')}</span>
                            )}
                            {acc.inCooldown && (
                              <span className="identity-relay-cooling-pill">{t('relay.coolingBadge')}</span>
                            )}
                            {acc.known5h && !acc.no5hLimit && Math.abs(acc.pace5hDeltaPct) >= 10 && (
                              <span className={`identity-relay-pace-pill${acc.pace5hDeltaPct >= 10 ? ' is-ahead' : ' is-safe'}`}>
                                {t(acc.pace5hDeltaPct >= 10 ? 'relay.paceAheadBadge' : 'relay.paceSafeBadge', {
                                  delta: Math.abs(Math.round(acc.pace5hDeltaPct)),
                                })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {isProxyExpanded && (
                        <div className="identity-relay-account-proxy">
                          <label htmlFor={`relay-slot-proxy-${acc.id}`}>{t('relay.slotProxyLabel')}</label>
                          <input
                            id={`relay-slot-proxy-${acc.id}`}
                            type="text"
                            className={`identity-relay-proxy-input${slotProxyError ? ' is-invalid' : ''}`}
                            placeholder={proxyPlaceholder}
                            value={slotProxyDraft}
                            aria-invalid={slotProxyError ? true : undefined}
                            onChange={e => {
                              const val = e.target.value;
                              setSlotProxyDrafts(prev => ({...prev, [acc.id]: val}));
                              const res = validateSlotHttpProxy(val);
                              if (res.ok) {
                                setSlotProxyErrors(prev => {
                                  if (!(acc.id in prev)) return prev;
                                  const next = {...prev};
                                  delete next[acc.id];
                                  return next;
                                });
                                if (!res.normalized && smartRelay.slotProxies[acc.id]) {
                                  const nextSlotProxies = {...smartRelay.slotProxies};
                                  delete nextSlotProxies[acc.id];
                                  updateSmartRelayConfig({slotProxies: nextSlotProxies});
                                }
                              } else if (/^socks/i.test(val.trim()) || /[\u0000-\u001f\u007f]/.test(val)) {
                                setSlotProxyErrors(prev => ({
                                  ...prev,
                                  [acc.id]: res.errorKey || 'relay.proxy.invalidHttp',
                                }));
                              }
                            }}
                            onFocus={() => {
                              focusedSlotProxyIdRef.current = acc.id;
                            }}
                            onBlur={e => {
                              if (focusedSlotProxyIdRef.current === acc.id) {
                                focusedSlotProxyIdRef.current = null;
                              }
                              commitSlotProxy(acc.id, e.currentTarget.value);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitSlotProxy(acc.id, e.currentTarget.value);
                              }
                            }}
                          />
                          {!slotProxyError && (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              onClick={() => {
                                commitSlotProxy(acc.id, slotProxyDraft);
                                setExpandedProxyIds(prev => ({...prev, [acc.id]: false}));
                              }}
                            >
                              {t('relay.proxyHideBtn')}
                            </button>
                          )}
                          {slotProxyError && (
                            <span className="identity-relay-proxy-error" role="alert">
                              {t(slotProxyError)}
                            </span>
                          )}
                          {slotBrowserProxy && (
                            <div className="identity-relay-browser-slot-row" data-relay-browser-slot={acc.id}>
                              <span className="identity-relay-browser-slot-label">
                                {t('relay.browserSlotLabel', {
                                  proxy: slotBrowserProxy.proxy || t('relay.browserSlotDirect'),
                                })}
                              </span>
                              {hasBrowserProxyMismatch && (
                                <button
                                  type="button"
                                  className="identity-relay-set-preferred identity-relay-browser-sync-btn"
                                  data-relay-sync-browser-proxy={acc.id}
                                  disabled={slotBrowserProxy.running || Boolean(syncingBrowserProxyIds[acc.id])}
                                  title={slotBrowserProxy.running ? t('relay.browserSlotRunningHint') : undefined}
                                  onClick={() => void syncSlotBrowserProxy(acc.id)}
                                >
                                  {syncingBrowserProxyIds[acc.id]
                                    ? t('relay.browserSlotSyncingBtn')
                                    : t('relay.browserSlotSyncBtn')}
                                </button>
                              )}
                              {slotBrowserProxy.running && hasBrowserProxyMismatch && (
                                <span className="identity-relay-browser-running-hint">
                                  {t('relay.browserSlotRunningHint')}
                                </span>
                              )}
                              {browserSyncFeedback && (
                                <span
                                  className={
                                    browserSyncFeedback.isError
                                      ? 'identity-relay-proxy-error'
                                      : 'identity-relay-browser-synced-hint'
                                  }
                                  role={browserSyncFeedback.isError ? 'alert' : 'status'}
                                >
                                  {browserSyncFeedback.text}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="identity-relay-section" aria-label={t('relay.routingSectionTitle')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.routingSectionTitle')}</h3>
            </div>
            <div className="identity-relay-form-rows identity-relay-cli-rows">
              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.routeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_STRATEGIES.map(strategy => (
                      <button
                        key={strategy}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.strategy === strategy ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({strategy})}
                      >
                        {t(`relay.strategy.${strategy}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.strategyDesc.${smartRelay.strategy}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.rateLimitLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_RATE_LIMIT_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.rateLimitMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({rateLimitMode: mode})}
                      >
                        {t(`relay.rateLimit.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.rateLimitDesc.${smartRelay.rateLimitMode}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.affinityLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_AFFINITY_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.affinityMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({affinityMode: mode})}
                      >
                        {t(`relay.affinity.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.affinityDesc.${smartRelay.affinityMode}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.thresholdLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets identity-relay-threshold-chips">
                    {RELAY_SPENT_THRESHOLDS.map(pct => (
                      <button
                        key={pct}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.spentThresholdPct === pct ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({spentThresholdPct: pct})}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t('relay.thresholdDesc', {pct: smartRelay.spentThresholdPct})}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="identity-relay-section identity-relay-cli-section" aria-label={t('relay.cliSectionTitle')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.cliSectionTitle')}</h3>
              {latestHandoff?.handoffReason && (
                <span
                  className="identity-relay-handoff-reason-pill"
                  data-relay-handoff-reason={latestHandoff.handoffReason}
                  title={t('relay.handoffReasonTooltip')}
                >
                  {(() => {
                    const reason = latestHandoff.handoffReason;
                    const reasonKeyMap: Record<string, string> = {
                      threshold_reached: 'relay.handoffReason.threshold_reached',
                      rate_limited: 'relay.handoffReason.rate_limited',
                      preferred_recovered: 'relay.handoffReason.preferred_recovered',
                      awaiting_manual_reset: 'relay.handoffReason.awaiting_manual_reset',
                      external_worker_timeout: 'relay.handoffReason.external_worker_timeout',
                      forced_stop: 'relay.handoffReason.forced_stop',
                    };
                    return reasonKeyMap[reason] ? t(reasonKeyMap[reason]) : reason;
                  })()}
                </span>
              )}
            </div>
            <div className="identity-relay-form-rows identity-relay-cli-rows">
              <div className="identity-relay-form-row" data-relay-cli-model-row>
                <span className="identity-relay-form-label">{t('relay.cliModelLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_CLI_MODELS.map(model => (
                      <button
                        key={model || 'follow'}
                        type="button"
                        data-relay-cli-model={model || 'follow'}
                        title={model === 'opusplan' ? t('relay.cliModelOpusPlanDesc') : undefined}
                        className={`wakeup-preset-chip${smartRelay.defaultCliModel === model ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({defaultCliModel: model})}
                      >
                        {relayCliModelDisplayLabel(model, t('relay.cliFollowSettings'))}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.defaultCliModel === 'opusplan' ? 'relay.cliModelOpusPlanDesc' : 'relay.cliModelDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row" data-relay-cli-effort-row>
                <span className="identity-relay-form-label">{t('relay.cliEffortLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_CLI_EFFORTS.map(effort => (
                      <button
                        key={effort || 'follow'}
                        type="button"
                        data-relay-cli-effort={effort || 'follow'}
                        className={`wakeup-preset-chip${smartRelay.defaultCliEffort === effort ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({defaultCliEffort: effort})}
                      >
                        {effort || t('relay.cliFollowSettings')}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.defaultCliEffort === 'max' ? 'relay.cliEffortMaxDesc' : 'relay.cliEffortDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.continuationModeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    <button
                      type="button"
                      className={`wakeup-preset-chip${!smartRelay.autoContinueOnRelay ? ' active' : ''}`}
                      onClick={() => updateSmartRelayConfig({autoContinueOnRelay: false})}
                    >
                      {t('relay.autoContinueOff')}
                    </button>
                    <button
                      type="button"
                      className={`wakeup-preset-chip${smartRelay.autoContinueOnRelay ? ' active' : ''}`}
                      onClick={() => updateSmartRelayConfig({autoContinueOnRelay: true})}
                    >
                      {t('relay.autoContinueOn')}
                    </button>
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.autoContinueOnRelay ? 'relay.autoContinueOnDesc' : 'relay.autoContinueOffDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row" data-relay-handoff-mode-row>
                <span className="identity-relay-form-label">{t('relay.handoffModeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets" role="group" aria-label={t('relay.handoffModeLabel')}>
                    {RELAY_HANDOFF_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        data-relay-handoff-mode={mode}
                        aria-pressed={smartRelay.relayHandoffMode === mode}
                        className={`wakeup-preset-chip${smartRelay.relayHandoffMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({relayHandoffMode: mode})}
                      >
                        {t(mode === 'clean_handoff' ? 'relay.handoffModeClean' : 'relay.handoffModeFork')}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.relayHandoffMode === 'fork_resume' ? 'relay.handoffModeForkDesc' : 'relay.handoffModeCleanDesc')}
                  </p>
                  {smartRelay.relayHandoffMode === 'fork_resume' && (
                    <div className="identity-unsaved-pool-hint identity-relay-handoff-warn" role="alert" data-relay-handoff-warning>
                      <span>
                        <strong>{t('relay.handoffForkWarnTitle')}</strong>
                        <span>{t('relay.handoffForkWarnDesc')}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.launchTerminalLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-relay-launch-row">
                    <input
                      type="text"
                      className="identity-relay-cwd-input"
                      data-relay-launch-cwd
                      placeholder={t('relay.launchCwdPlaceholder')}
                      aria-label={t('relay.launchCwdPlaceholder')}
                      value={launchCwdDraft}
                      onChange={e => setLaunchCwdDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void launchRelayTerminal();
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="small"
                      data-launch-relay-cli
                      loading={launchRelayBusy}
                      disabled={launchRelayBusy}
                      onClick={() => void launchRelayTerminal()}
                    >
                      {t('relay.launchTerminalBtn')}
                    </Button>
                  </div>
                  {recentLaunchDirs.length > 0 && (
                    <div className="identity-relay-mru-row" data-relay-recent-dirs>
                      <span className="identity-relay-mru-label">{t('relay.launchRecentLabel')}</span>
                      {recentLaunchDirs.map(dir => {
                        const chip = formatLaunchDirChip(dir);
                        return (
                          <span className="identity-relay-mru-chip" key={dir}>
                            <button
                              type="button"
                              className="identity-relay-mru-open"
                              title={dir}
                              disabled={launchRelayBusy}
                              onClick={() => {
                                setLaunchCwdDraft(dir);
                                void launchRelayTerminal(dir);
                              }}
                            >
                              <strong>{chip.leaf}</strong>
                              {chip.parent && <small>{chip.parent}</small>}
                            </button>
                            <button
                              type="button"
                              className="identity-relay-mru-remove"
                              aria-label={t('relay.removeRecentDir')}
                              title={t('relay.removeRecentDir')}
                              onClick={() => removeRelayLaunchDir(dir)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.toolchainLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-relay-cli-actions">
                    <Button
                      variant="secondary"
                      size="small"
                      loading={cliWrappersBusy}
                      disabled={cliWrappersBusy}
                      onClick={() => void installCliWrappers()}
                    >
                      {t('relay.deployCliAndAgentBtn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => void copyRelayCommand()}
                    >
                      {t('relay.copyRelayCmdBtn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => void copySubagentTemplate()}
                    >
                      {t('relay.copySubagentTplBtn')}
                    </Button>
                  </div>
                  {cliWrappersFeedback && (
                    <p
                      className={`identity-relay-cli-feedback${cliWrappersFeedback.isError ? ' is-error' : ''}`}
                      role={cliWrappersFeedback.isError ? 'alert' : 'status'}
                    >
                      {cliWrappersFeedback.text}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
        ) : null}
      </AppDialog>

      {!onlinePanelOpen && !quotaDetails && quotaFeedbackText && <p className="identity-online-feedback identity-page-feedback" role="status"><span>{quotaFeedbackText}</span><Button variant="ghost" size="small" type="button" data-quota-feedback-dismiss="" onClick={() => setQuotaFeedback('')}>{t('关闭记录')}</Button></p>}

      {error && (
        <p role="alert" className="cleanup-feedback error">
          {t(error)}
        </p>
      )}
      {state?.recovery && (
        <div className="identity-recovery" role="alert">
          <strong>{t('有一次身份切换尚未完成')}</strong>
          <Button size="small" variant="secondary" disabled={locked || loading} onClick={() => void recoverNow()}>
            {t('恢复原身份')}
          </Button>
        </div>
      )}

      <section className="identity-library">
        <div className="identity-section-head">
          <div className="identity-head-title">
            <h2>{t('身份')}</h2>
            <span className="identity-policy-mode identity-card-count" data-card-count="identity">
              {t('identity.count', {v0: totalIdentities})}
            </span>
          </div>
          <div className="identity-library-controls">
            <Button variant="secondary" size="small" disabled={blocked || current?.present === false} onClick={() => choose('empty')}>
              {current?.present === false ? t('当前为新身份') : t('新身份')}
            </Button>
            {recommendSaved && (
              <Button
                variant="secondary"
                size="small"
                disabled={blocked}
                title={
                  t('identities.switchBestTooltip', {
                    name: maskDisplayName(
                      recommendSaved.row.name,
                      state?.summaries?.[recommendSaved.row.id]?.email,
                      prefs.privacyMask,
                    ),
                    rem: Math.round(recommendSaved.effectiveRem),
                  }) + (hasLiveClaudeProcess ? t('identities.switchBestLiveCliSuffix') : '')
                }
                onClick={() => choose(recommendSaved.row)}
              >
                {t('切到最优号')}
              </Button>
            )}
            {state?.warming_cards?.some(card => card.browser_active) && current?.quota_identity && (
              <Button
                variant="secondary"
                size="small"
                data-return-cli-quick
                disabled={blocked}
                onClick={() => setReturnCliBrowser({expectedIdentity: current.quota_identity!, name: maskDisplayName(currentName, current.email, prefs.privacyMask)})}
              >
                {t('browser.returnToCliShort')}
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
            {(['点「新身份」归档旧号', '内置浏览器验证并登录充值号', 'identitySafety.cliStep'] as const).map((step, index) => (
              <span className="warming-step" key={step}>
                {index > 0 && <i aria-hidden="true">→</i>}
                <span className="identity-onboarding-chip">{t(step)}</span>
              </span>
            ))}
          </div>
        </div>
        {(totalIdentities >= 4 || cardFilter !== 'all' || gridWrap) && (
          <div className="identity-filter-bar" data-identity-filter-bar>
            <div className="identity-filter-chips" role="group" aria-label={t('身份')}>
              {(
                [
                  ['all', 'identities.filter.all', totalIdentities, true],
                  ['ready', 'identities.filter.ready', cardFilterCounts.ready, true],
                  ['reset_cards', 'identities.filter.resetCards', cardFilterCounts.resetCards, cardFilterCounts.resetCards > 0 || cardFilter === 'reset_cards'],
                  ['expiring', 'identities.filter.expiring', cardFilterCounts.expiring, cardFilterCounts.expiring > 0 || cardFilter === 'expiring'],
                  ['live', 'identities.filter.live', cardFilterCounts.live, cardFilterCounts.live > 0 || cardFilter === 'live'],
                ] as const
              )
                .filter(([, , , visible]) => visible)
                .map(([kind, labelKey, count]) => (
                  <button
                    key={kind}
                    type="button"
                    className={`identity-filter-chip${cardFilter === kind ? ' is-active' : ''}`}
                    data-identity-filter={kind}
                    aria-pressed={cardFilter === kind}
                    onClick={() => setCardFilter(kind)}
                  >
                    <span>{t(labelKey)}</span>
                    <span>{count}</span>
                  </button>
                ))}
            </div>
            <button
              type="button"
              className={`identity-filter-chip${gridWrap ? ' is-active' : ''}`}
              data-identity-grid-toggle
              aria-pressed={gridWrap}
              title={t('identities.gridWrapHint')}
              onClick={() => setGridWrap(v => !v)}
            >
              {t('identities.gridWrapToggle')}
            </button>
          </div>
        )}
        <div
          className={`identity-card-rail${gridWrap ? ' is-grid-wrap' : ''}`}
          ref={node => {
            rail.current = node;
            identityReorder.railRef.current = node;
          }}
          tabIndex={0}
          role="region"
          aria-label={t('身份')}
        >
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
              <div className="identity-quota-stack identity-empty-steps">
                <div className="identity-quota-window identity-empty-step-window">
                  <div className="identity-quota-copy">
                    <strong>{t('identityCard.emptyStep1Title')}</strong>
                    <span className="identity-quota-value">Step 1</span>
                  </div>
                  <span className="identity-empty-step-desc">{t('identityCard.emptyStep1Desc')}</span>
                </div>
                <div className="identity-quota-window identity-empty-step-window">
                  <div className="identity-quota-copy">
                    <strong>{t('identityCard.emptyStep2Title')}</strong>
                    <span className="identity-quota-value">Step 2</span>
                  </div>
                  <span className="identity-empty-step-desc">{t('identityCard.emptyStep2Desc')}</span>
                </div>
              </div>
              <div className="identity-card-footer">
                <Button variant="secondary" size="small" disabled={blocked} onClick={() => void retryBrowser()}>
                  {t('打开内置浏览器')}
                </Button>
              </div>
            </IdentityCard>
          )}
          {cardFilter !== 'all' && filteredRailItems.length === 0 && (
            <p className="identity-filter-empty" role="status">
              {t('identities.filterEmpty')}
            </p>
          )}
          {filteredRailItems.map(item => {
            const isDragging = identityReorder.draggingId === item.id;
            const isFocusHighlighted = focusedCardId === item.id;
            if (item.kind === 'current') {
              const cliSessions = state?.sessions?.filter(s => s.entrypoint !== 'Claude Desktop') ?? [];
              const cliSessionCount = state?.sessions ? cliSessions.length : (state?.cli_running ? 1 : 0);
              const isCliRunning = cliSessionCount > 0 || Boolean(state?.cli_running);
              const currentBadgeLabel = loading
                ? t('检查中')
                : cliSessionCount > 1
                  ? t('identityCard.statusCliRunningCount', {v0: cliSessionCount})
                  : isCliRunning
                    ? t('identityCard.statusCliRunning')
                    : state?.running
                      ? t('identityCard.statusDesktopRunning')
                      : t('identityCard.statusActive');
              const currentBadgeTitle = !loading && cliSessions.length > 0
                ? cliSessions.map(s => `${s.entrypoint}${s.workspace ? ` · ${s.workspace}` : ''} (PID ${s.pid})`).join('\n')
                : undefined;
              return (
                <IdentityCard
                  key={CURRENT_IDENTITY_ORDER_TOKEN}
                  className={`identity-card current ${state?.running ? 'running' : 'stopped'}${isDragging ? ' is-dragging' : ''}${isFocusHighlighted ? ' is-focus-highlight' : ''}`}
                  running={state?.running}
                  label={t('当前身份')}
                  reorderId={CURRENT_IDENTITY_ORDER_TOKEN}
                  isDragging={isDragging}
                  dragOffsetX={identityReorder.dragOffsetX}
                  dragTiltDeg={identityReorder.dragTiltDeg}
                  dragHandleLabel={t('identityCard.dragReorderHint')}
                  onDragStart={e => identityReorder.startCardDrag(CURRENT_IDENTITY_ORDER_TOKEN, e)}
                  onDragKeyDown={e => identityReorder.handleCardKeyDown(CURRENT_IDENTITY_ORDER_TOKEN, e)}
                >
                  <div className="identity-card-head">
                    <div className="identity-avatar" aria-hidden="true">
                      {active?.name || current?.display_name || current?.email ? Array.from(currentName)[0]?.toUpperCase() : <ShieldCheck size={20} />}
                    </div>
                    <span className={`identity-live-badge ${isCliRunning ? 'running' : 'stopped'}`} title={currentBadgeTitle}>{currentBadgeLabel}</span>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className={`identity-menu-trigger${syncingAccountIds['current'] ? ' is-syncing' : ''}`}
                          aria-label={t('identityCard.moreActions')}
                          aria-busy={syncingAccountIds['current'] || undefined}
                        >
                          ⋯
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                          <DropdownMenu.Item className="identity-menu-item" disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || !current?.quota_identity} onSelect={() => {
                            if (current?.quota_identity) void openAccountBrowser({account_id: 'current', expected_identity: current.quota_identity}, 'claude_ai');
                          }}>
                            {t('browser.enterClaudeAi')}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="identity-menu-item" disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || !current?.quota_identity} onSelect={() => {
                            if (current?.quota_identity) void openAccountBrowser({account_id: 'current', expected_identity: current.quota_identity}, 'usage');
                          }}>
                            {t('browser.openAccountUsage')}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="identity-menu-item" data-return-cli-browser disabled={blocked || !current?.quota_identity} onSelect={() => {
                            if (current?.quota_identity) setReturnCliBrowser({expectedIdentity: current.quota_identity, name: maskDisplayName(currentName, current.email, prefs.privacyMask)});
                          }}>
                            {t('browser.returnToCli')}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="identity-menu-item" disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || Boolean(syncingAccountIds['current'])} onSelect={() => void syncSubscription()}>
                            {t('identityCard.syncSubscription')}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="identity-menu-item" disabled={blocked} onSelect={() => openExpiryEditor('current', currentName, current)}>
                            {t('identityCard.setSubscriptionExpiry')}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="identity-menu-item" data-identity-handoff-copy="current" disabled={blocked} onSelect={() => void copyIdentityHandoffSpec('current', currentName, current)}>
                            {t('identities.copyHandoffSpec')}
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
                  <IdentityName
                    name={currentName}
                    email={current?.email}
                    accountName={current?.display_name}
                    plan={current?.plan}
                    expiry={formatSubscriptionExpiryBadge(current)}
                    nowSec={nowSec}
                    onEditExpiry={blocked ? undefined : () => openExpiryEditor('current', currentName, current)}
                    privacyMask={prefs.privacyMask}
                    t={t}
                  />
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
                  <IdentityQuota quota={currentQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {quotaOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSuppressQuotaRestoreFocus(false); setQuotaDetails({id:active?.id || 'current', name:currentName, expectedIdentity:current?.quota_identity || null}); setQuotaFeedback('');}} />
                  <SubscriptionAndResets meta={current} locale={locale} nowSec={nowSec} t={t} />
                  <div className="identity-card-footer">
                    <Button variant="secondary" size="small" disabled={blocked} onClick={openSnapshot}>
                      {t(active ? '更新备份' : '保存备份')}
                    </Button>
                  </div>
                </IdentityCard>
              );
            }
            const row = item.row;
            const summary = state?.summaries?.[row.id];
            const savedQuota = evaluateQuota(summary, nowSec);
            const slotSessions = state?.slot_sessions?.[row.id] ?? [];
            const slotBadgeTitle = slotSessions.length > 0
              ? slotSessions.map(s => `${s.entrypoint}${s.workspace ? ` · ${s.workspace}` : ''} (PID ${s.pid})`).join('\n')
              : undefined;
            return (
              <IdentityCard
                className={`identity-card${isDragging ? ' is-dragging' : ''}${isFocusHighlighted ? ' is-focus-highlight' : ''}`}
                key={row.id}
                title={`${new Date(row.saved_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})} · ${formatBytes(row.bytes)}`}
                reorderId={row.id}
                isDragging={isDragging}
                dragOffsetX={identityReorder.dragOffsetX}
                dragTiltDeg={identityReorder.dragTiltDeg}
                dragHandleLabel={t('identityCard.dragReorderHint')}
                onDragStart={e => identityReorder.startCardDrag(row.id, e)}
                onDragKeyDown={e => identityReorder.handleCardKeyDown(row.id, e)}
              >
                <div className="identity-card-head">
                  <div className="identity-avatar" aria-hidden="true">
                    {Array.from(row.name)[0]?.toUpperCase()}
                  </div>
                  {slotSessions.length > 0 && (
                    <span
                      className="identity-slot-live-pill"
                      data-slot-live={row.id}
                      title={slotBadgeTitle}
                    >
                      <i className="slot-live-dot" aria-hidden="true" />
                      {slotSessions.length > 1
                        ? t('relay.slotLiveCount', {count: slotSessions.length})
                        : t('relay.slotLiveBadge')}
                    </span>
                  )}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        className={`identity-menu-trigger${syncingAccountIds[row.id] ? ' is-syncing' : ''}`}
                        aria-label={t('identityCard.moreActions')}
                        aria-busy={syncingAccountIds[row.id] || undefined}
                      >
                        ⋯
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || !summary?.quota_identity}
                          onSelect={() => {
                            if (summary?.quota_identity) void openAccountBrowser({account_id: row.id, expected_identity: summary.quota_identity}, 'claude_ai');
                          }}
                        >
                          {t('browser.openAccountClaudeAi')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || !summary?.quota_identity}
                          onSelect={() => {
                            if (summary?.quota_identity) void openAccountBrowser({account_id: row.id, expected_identity: summary.quota_identity}, 'usage');
                          }}
                        >
                          {t('browser.openAccountUsage')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          disabled={busy || batchBusy || loading || !state?.browser.enabled || !!state?.recovery || !summary?.quota_identity || Boolean(syncingAccountIds[row.id])}
                          onSelect={() => {
                            if (summary?.quota_identity) void syncSubscription(row.id, summary.quota_identity);
                          }}
                        >
                          {t('identityCard.syncSubscription')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="identity-menu-separator" />
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          disabled={blocked}
                          onSelect={() => openExpiryEditor(row.id, row.name, summary)}
                        >
                          {t('identityCard.setSubscriptionExpiry')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className="identity-menu-item"
                          data-identity-handoff-copy={row.id}
                          disabled={blocked}
                          onSelect={() => void copyIdentityHandoffSpec(row.id, row.name, summary)}
                        >
                          {t('identities.copyHandoffSpec')}
                        </DropdownMenu.Item>
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
                <IdentityName
                  name={row.name}
                  email={summary?.email}
                  accountName={summary?.display_name}
                  plan={summary?.plan}
                  expiry={formatSubscriptionExpiryBadge(summary)}
                  nowSec={nowSec}
                  onEditExpiry={blocked ? undefined : () => openExpiryEditor(row.id, row.name, summary)}
                  privacyMask={prefs.privacyMask}
                  saved
                  t={t}
                />
                <div className="identity-account identity-email-line saved">
                  {summary?.email ? <span className="identity-email" title={maskEmailAddress(summary.email, prefs.privacyMask)}>{maskEmailAddress(summary.email, prefs.privacyMask)}</span> : <span className="identity-account-unknown">{t('identityCard.emailUnavailable')}</span>}
                </div>
                {summary?.auth_status === 'expired' && !hasRecentOnlineVerification(row.id, summary.quota_identity) && (
                  <div className="identity-meta-line" title={prefs.privacyMask ? undefined : summary?.proxy || undefined}>
                    <span className="identity-meta-badge auth-expired">{t('identityCard.reauthRequired')}</span>
                  </div>
                )}
                <IdentityQuota quota={savedQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {quotaOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSuppressQuotaRestoreFocus(false); setQuotaDetails({id:row.id, name:row.name, expectedIdentity:summary?.quota_identity || null}); setQuotaFeedback('');}} />
                <SubscriptionAndResets meta={summary} locale={locale} nowSec={nowSec} t={t} />
                <div className="identity-card-footer">
                  <Button variant="secondary" size="small" disabled={blocked} onClick={() => choose(row)}>
                    {t('切换')}
                  </Button>
                </div>
              </IdentityCard>
            );
          })}
        </div>
        <IdentityOperationProgress
          activity={activity.state}
          showCleanroomBar={Boolean(
            showCleanroomBar &&
              activity.state?.kind === 'identity' &&
              (activity.state.title === '切换身份' ||
                activity.state.title === '切换到空身份' ||
                activity.state.title === '恢复原身份'),
          )}
        />
      </section>
      <WarmingLibrary
        cards={state?.warming_cards ?? []} blocked={warmingBlocked} promotionBlocked={!!state?.recovery}
        runtime={browserRuntime.runtime}
        activity={warmingActivity.state}
        busy={busy} privacyMask={prefs.privacyMask} nowSec={nowSec} onModalChange={setWarmingModalOpen}
        onOpen={(card, openMode) => warmingAction('identities_warming_open', {id: card.id, openMode})}
        onProbeState={nextState => {
          if (mountedRef.current && nextState && typeof nextState === 'object') {
            commitAuthoritativeState(nextState as IdentityState);
          }
        }}
        onSave={saveWarming}
        onDelete={(card, deleteBrowser) => warmingAction('identities_warming_delete', {id: card.id, deleteBrowser}, false)}
        onPromote={card => {
          if (card.stage !== 'pro_ready' || stateRef.current?.warming_cards?.find(row => row.id === card.id)?.stage !== 'pro_ready' || stateRef.current?.recovery) {
            setError(t('warming.promoteStageRequired'));
            return;
          }
          choose('empty'); setWarmingPromotion(card);
        }}
        onExpiry={card => openExpiryEditor(card.id, card.name, {...card, plan: card.stage === 'pro_ready' ? 'PRO' : 'FREE'})}
        renderName={card => <IdentityName name={card.name} email={card.email} plan={card.stage === 'pro_ready' ? 'PRO' : 'FREE'} expiry={formatSubscriptionExpiryBadge(card)} nowSec={nowSec} onEditExpiry={warmingBlocked ? undefined : () => openExpiryEditor(card.id, card.name, {...card, plan: card.stage === 'pro_ready' ? 'PRO' : 'FREE'})} privacyMask={prefs.privacyMask} saved t={t} />}
      />
      <Disclosure
        className="identity-policy"
        triggerClassName="identity-policy-trigger"
        summary={<strong>{t('保留在工作区')}</strong>}
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
      <ClaudeCliPanel
        blocked={locked || loading || !!state?.recovery}
        onBusy={setCliBusy}
        sessions={state?.sessions}
        backgroundOnly={state?.background_only}
        cliRunning={state?.cli_running}
      />
      <AppDialog alert open={!!returnCliBrowser} onOpenChange={open => {if (!open && !busy) setReturnCliBrowser(null);}}
        title={t('browser.returnToCliConfirmTitle')} description={t('browser.returnToCliConfirm')}
        footer={<><Button variant="secondary" data-dialog-cancel disabled={busy} onClick={() => setReturnCliBrowser(null)}>{t('取消')}</Button><Button variant="secondary" data-return-cli-claude disabled={busy || !returnCliBrowser} onClick={() => void returnToCliBrowser('claude_ai')}>{t('browser.enterClaudeAi')}</Button><Button variant="secondary" data-return-cli-confirm disabled={busy || !returnCliBrowser} onClick={() => void returnToCliBrowser('verify')}>{t('browser.returnToCli')}</Button></>}>
        <div data-return-cli-dialog className="identity-confirm"><strong>{returnCliBrowser?.name}</strong><p>{t('browser.verificationScope')}</p></div>
      </AppDialog>
      <AppDialog
        open={quotaDetails !== null}
        onOpenChange={open => {if (!open && !busy) { setSuppressQuotaRestoreFocus(false); setQuotaDetails(null); setQuotaFeedback(''); }}}
        title={t('quota.details')}
        width={600}
        className="quota-details-dialog"
        restoreFocus={!suppressQuotaRestoreFocus}
        footer={<>
          <Button variant="ghost" size="small" disabled={busy || loading || manualSyncing} onClick={() => void manualSyncLocalQuota()}>{t('quota.refreshLocal')}</Button>
          {(detailsQuota?.inferred5h || detailsQuota?.expired5h) && detailsSummary?.quota_identity && (
            <Button
              variant="ghost"
              size="small"
              loading={wakingAccountId === (detailsAreCurrent ? 'current' : quotaDetails?.id)}
              disabled={busy || loading || batchBusy || wakingAccountId !== null}
              onClick={() => void wakeupSingleAccount(detailsAreCurrent ? 'current' : quotaDetails!.id, detailsSummary.quota_identity!, false)}
            >
              {t('wakeup.wakeNow')}
            </Button>
          )}
          {(detailsQuota?.inferred5h || detailsQuota?.inferred7d) && (
            <Button variant="ghost" size="small" disabled={busy || loading || batchBusy} onClick={() => { setSuppressQuotaRestoreFocus(true); setQuotaDetails(null); setQuotaFeedback(''); setOnlinePanelOpen(true); }}>{t('quota.calibrateOnline')}</Button>
          )}
          <span className="quota-details-footer-spacer" aria-hidden="true" />
          <Button
            variant="secondary"
            size="small"
            loading={busy}
            disabled={busy || !quotaDetails?.expectedIdentity || !state?.browser.enabled || !!state?.recovery}
            onClick={() => {
              if (!quotaDetails?.expectedIdentity) return;
              void openAccountBrowser(
                {account_id: detailsAreCurrent ? 'current' : quotaDetails.id, expected_identity: quotaDetails.expectedIdentity},
                'claude_ai',
              );
            }}
          >
            {t('browser.enterClaudeAi')}
          </Button>
          <Button
            variant="secondary"
            size="small"
            loading={busy}
            disabled={busy || !quotaDetails?.expectedIdentity || !!state?.recovery}
            onClick={() => {
              if (!quotaDetails?.expectedIdentity) return;
              if (detailsAreCurrent) {
                void openUsagePage();
              } else {
                void openAccountBrowser({account_id: quotaDetails.id, expected_identity: quotaDetails.expectedIdentity}, 'usage');
              }
            }}
          >
            {t('quota.openOfficial')}
          </Button>
          {(detailsAreCurrent || !!quotaDetails?.expectedIdentity) && (
            <Button
              variant="primary"
              size="small"
              loading={Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : (quotaDetails?.id ?? '')])}
              disabled={busy || loading || !state?.browser.enabled || Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : (quotaDetails?.id ?? '')]) || (!detailsAreCurrent && !quotaDetails?.expectedIdentity)}
              onClick={() => void syncSubscription(detailsAreCurrent ? undefined : quotaDetails?.id, quotaDetails?.expectedIdentity || undefined)}
            >
              {t('quota.syncSubscription')}
            </Button>
          )}
        </>}
      >
        {(() => {
          const shownName = maskDisplayName(quotaDetails?.name, detailsSummary?.email, prefs.privacyMask);
          const plan = detailsSummary?.plan?.trim();
          const initial = (shownName || '?').trim().charAt(0).toUpperCase() || '?';
          const sourceLabel = (window: '5h' | '7d') => {
            const source = detailsQuota?.[window === '5h' ? 'source5h' : 'source7d'];
            const observed = detailsSummary?.[`quota_${window}_source`] != null
              ? detailsSummary[`quota_${window}_observed_at_ms`]
              : detailsSummary?.quota_observed_at_ms;
            const age = formatObservationAge(quotaObservationAge(observed, nowSec * 1000));
            const kind = t(source === 'server_anchor' ? 'quota.sourceShort.server' : source === 'local_estimate' ? 'quota.sourceShort.estimate' : source === 'reset_inferred' ? 'quota.sourceShort.inferred' : 'quota.sourceShort.unverified');
            return {kind, age: age ? t('identitySearch.age.' + age.unit, {v0: age.value}) : '', verified: source === 'server_anchor'};
          };
          const windowCard = (window: '5h' | '7d') => {
            const is5h = window === '5h';
            const source = sourceLabel(window);
            const burnEta =
              (!is5h || !detailsQuota?.no5hLimit) &&
              !(is5h ? detailsQuota?.inferred5h : detailsQuota?.inferred7d) &&
              (is5h ? detailsQuota?.known5h : detailsQuota?.known7d)
                ? computeWindowBurnEta(
                    is5h ? detailsQuota?.used5h : detailsQuota?.used7d,
                    is5h ? detailsQuota?.r5 : detailsQuota?.r7,
                    nowSec,
                    is5h ? 5 : 168,
                    smartRelay.spentThresholdPct,
                  )
                : null;
            return (
              <article className="quota-details-window" key={window}>
                <QuotaWindow
                  label={window}
                  used={(is5h ? detailsQuota?.used5h : detailsQuota?.used7d) ?? 0}
                  remaining={(is5h ? detailsQuota?.rem5h : detailsQuota?.rem7d) ?? 0}
                  resetAt={(is5h ? detailsQuota?.r5 : detailsQuota?.r7) ?? null}
                  inferredResetAt={(is5h ? detailsQuota?.inferredReset5h : detailsQuota?.inferredReset7d) ?? null}
                  resetComplete={is5h ? detailsQuota?.expired5h : detailsQuota?.expired7d}
                  inferred={is5h ? detailsQuota?.inferred5h : detailsQuota?.inferred7d}
                  noLimit={is5h ? Boolean(detailsQuota?.no5hLimit) : false}
                  known={(is5h ? detailsQuota?.known5h : detailsQuota?.known7d) ?? false}
                  level={(is5h ? detailsQuota?.level5h : detailsQuota?.level7d) ?? 'ok'}
                  display={prefs.quotaDisplay}
                  nowSec={nowSec}
                  pace={is5h ? null : detailsQuota?.pace7d ?? null}
                  inDialog
                  t={t}
                />
                {burnEta && (
                  <p
                    className={`quota-details-burn-eta${burnEta.hitsBeforeReset ? ' is-warn' : ''}`}
                    data-quota-burn-eta={window}
                  >
                    {burnEta.hitsBeforeReset
                      ? t('quota.burnEtaHitsBeforeReset', {
                          rate: burnEta.ratePerHour,
                          eta: formatCompactEta(nowSec + Math.max(60, burnEta.etaToTargetSec ?? 0), nowSec) || '1m',
                        })
                      : t('quota.burnEtaSafeUntilReset', {
                          rate: burnEta.ratePerHour,
                          projected: Math.round(burnEta.projectedEndPct),
                        })}
                  </p>
                )}
                <p className="quota-details-source" data-source-verified={source.verified || undefined}>
                  <i aria-hidden="true" />
                  <span>{source.kind}</span>
                  {source.age && <small>{source.age}</small>}
                </p>
              </article>
            );
          };
          const pace = detailsQuota?.pace7d;
          const paceTone = !pace ? null : pace.suppressed ? 'neutral' : pace.ahead ? 'warn' : 'ok';
          const showRiskHint = (detailsQuota?.known5h && !detailsQuota.no5hLimit && detailsQuota.used5h >= 85) ||
            (pace && !pace.suppressed && pace.deltaUsedPct >= 15);
          const fableUsed = typeof detailsSummary?.quota_7d_fable_used === 'number' && Number.isFinite(detailsSummary.quota_7d_fable_used)
            ? Math.max(0, Math.min(100, detailsSummary.quota_7d_fable_used))
            : null;
          const billingKnown = Boolean(detailsSummary?.billing_date && (detailsSummary.billing_date_kind === 'next_renewal' || detailsSummary.billing_date_kind === 'access_until'));
          const subDisplay = formatSubscriptionAndResets(detailsSummary, locale, t, nowSec * 1000);
          const resets = subDisplay.manualResets;
          const resetUrgency = resets && resets.usable && resets.urgency !== 'normal' ? resets.urgency : undefined;
          const resetExpiresAt = resets?.usable && resets.remaining > 0 && resets.realExpiresAt ? resets.realExpiresAt : null;
          const resetExpiryClock = (() => {
            if (!resetExpiresAt) return '';
            const clock = formatResetClock(resetExpiresAt, true);
            if (!clock) return '';
            const expYear = new Date(resetExpiresAt * 1000).getFullYear();
            const curYear = new Date(nowSec * 1000).getFullYear();
            return expYear !== curYear ? `${expYear}-${clock}` : clock;
          })();
          const tokenExpiry = typeof detailsSummary?.refresh_token_expires_at === 'number' && Number.isFinite(detailsSummary.refresh_token_expires_at) &&
            detailsSummary.refresh_token_expires_at > 0 && detailsSummary.refresh_token_expires_at - nowSec <= 7 * 86400
            ? detailsSummary.refresh_token_expires_at
            : null;
          const isolated = state?.browser.enabled
            ? (detailsAreCurrent || (quotaDetails && state.browser.bound_ids.includes(quotaDetails.id)) ? 'active' : 'pending')
            : 'off';
          const kycInfo = (() => {
            const status = typeof detailsSummary?.kyc_status === 'string'
              ? detailsSummary.kyc_status.trim().toLowerCase()
              : '';
            if (!status) return null;
            const checkKind = typeof detailsSummary?.kyc_check_kind === 'string' &&
              /^[a-z0-9_-]{1,32}$/.test(detailsSummary.kyc_check_kind.trim().toLowerCase())
              ? detailsSummary.kyc_check_kind.trim().toLowerCase()
              : '';
            const kycAge = formatObservationAge(quotaObservationAge(detailsSummary?.kyc_observed_at_ms, nowSec * 1000));
            const observedAge = kycAge ? t('identitySearch.age.' + kycAge.unit, {v0: kycAge.value}) : '';
            if (status === 'not_required') {
              return {status, tone: 'neutral' as const, labelKey: 'quota.kycStatus.notRequired', checkKind, observedAge};
            }
            if (status === 'pending' || status === 'required' || status === 'in_progress') {
              return {status, tone: 'warn' as const, labelKey: 'quota.kycStatus.pending', checkKind, observedAge};
            }
            if (status === 'completed' || status === 'approved' || status === 'verified') {
              return {status, tone: 'ok' as const, labelKey: 'quota.kycStatus.verified', checkKind, observedAge};
            }
            if (status === 'expired') {
              return {status, tone: 'danger' as const, labelKey: 'quota.kycStatus.expired', checkKind, observedAge};
            }
            if (status === 'failed' || status === 'declined') {
              return {status, tone: 'danger' as const, labelKey: 'quota.kycStatus.issue', checkKind, observedAge};
            }
            return null;
          })();
          return (
            <div className="identity-quota-details quota-details">
              <header className="quota-details-profile">
                <span className="quota-details-avatar" aria-hidden="true">{initial}</span>
                <div className="quota-details-who">
                  <h3>{shownName}</h3>
                  {detailsSummary?.email && <p>{maskEmailAddress(detailsSummary.email, prefs.privacyMask)}</p>}
                </div>
                {plan && (
                  <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(plan)}>
                    {plan}
                  </span>
                )}
                {detailsAreCurrent && <span className="quota-details-current">{t('quota.currentAccount')}</span>}
              </header>

              <section className="quota-details-windows" aria-label={t('quota.windowsHeading')}>
                {windowCard('5h')}
                {windowCard('7d')}
                {fableUsed !== null && (() => {
                  const fableResetSec = detailsSummary?.quota_7d_fable_reset_at ?? null;
                  const fableEta = formatCompactEta(fableResetSec, nowSec);
                  const fableClock = formatResetClock(fableResetSec, true);
                  return (
                    <div className="quota-details-pool" data-quota-fable-7d>
                      <span>{t('quota.fable7dLabel')}</span>
                      <strong>{t('quota.fable7dValue', {
                        used: formatTruthfulPercent(fableUsed).replace(/%$/, ''),
                        remaining: formatTruthfulPercent(Math.max(0, 100 - fableUsed)).replace(/%$/, ''),
                      })}</strong>
                      {(fableEta || fableClock) && <small>{fableEta && fableClock ? `${fableClock} · ${fableEta}` : fableEta || fableClock}</small>}
                    </div>
                  );
                })()}
              </section>

              {pace && (
                <div className="quota-details-pace" data-tone={paceTone}>
                  <span className="quota-details-pace-label">{t('quota.weeklyPace')}</span>
                  <span className="quota-details-chip" data-tone={paceTone}>
                    {pace.suppressed
                      ? t('quota.paceChipSuppressed')
                      : pace.ahead
                        ? t('quota.paceChipAhead', {delta: Math.abs(pace.deltaUsedPct)})
                        : t('quota.paceChipBalanced')}
                  </span>
                  {!pace.suppressed && (
                    <small>{t('quota.paceBaseline', {expected: prefs.quotaDisplay === 'used' ? pace.expectedUsedPct : pace.expectedRemPct})}</small>
                  )}
                </div>
              )}
              {showRiskHint && <p className="quota-details-callout" data-quota-pace-hint>{t('quota.paceHintShort')}</p>}
              {(detailsQuota?.inferred5h || detailsQuota?.inferred7d) && <p className="quota-details-callout" data-tone="info">{t('quota.resetInferredHint')}</p>}

              <dl className="quota-details-facts">
                <div>
                  <dt>{t('identityCard.planCalibrationTitle')}</dt>
                  <dd>
                    <span>
                      {detailsSummary?.manual_plan
                        ? t('identityCard.planManualActive', {plan: detailsSummary.manual_plan})
                        : plan || t('identityCard.planAutoDetect')}
                    </span>
                    {quotaDetails && (
                      <button
                        type="button"
                        className="identity-expiry-inline-edit"
                        data-open-plan-calibration
                        disabled={busy || loading || !!state?.recovery}
                        onClick={() => openExpiryEditor(detailsAreCurrent ? 'current' : quotaDetails.id, quotaDetails.name, detailsSummary)}
                      >
                        {t('identityCard.editExpiryShort')}
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{subDisplay.billing?.label || t('identityCard.nextRenewal')}</dt>
                  <dd>
                    <span>{billingKnown
                      ? new Date(detailsSummary!.billing_date! * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'})
                      : t('identityCard.notProvided')}</span>
                    {billingKnown && detailsSummary?.subscription_recharge_ymd && (
                      <small>{t('identityCard.rechargedNote', {date: formatYmdAsShortMd(detailsSummary.subscription_recharge_ymd) || detailsSummary.subscription_recharge_ymd})}</small>
                    )}
                    {quotaDetails && (
                      <button
                        type="button"
                        className="identity-expiry-inline-edit"
                        disabled={busy || loading || !!state?.recovery}
                        onClick={() => openExpiryEditor(detailsAreCurrent ? 'current' : quotaDetails.id, quotaDetails.name, detailsSummary)}
                      >
                        {t('identityCard.editExpiryShort')}
                      </button>
                    )}
                  </dd>
                </div>
                <div data-reset-urgency={resetUrgency}>
                  <dt>{t('quota.resetCount')}</dt>
                  <dd>
                    <span className="quota-details-strong">{resets && !resets.ended
                      ? t('identityCard.manualResetsCount', {count: resets.remaining, v0: resets.remaining})
                      : resets?.ended ? t('identityCard.manualResetsEnded') : t('identityCard.notProvided')}</span>
                    {resetUrgency && resetExpiresAt ? (
                      <small className="identity-reset-urgency-badge" data-urgency={resetUrgency}>
                        {t('quota.manualResetsExpiringSoon', {countdown: formatCompactEta(resetExpiresAt, nowSec)})}
                        {resetExpiryClock ? ` · ${resetExpiryClock}` : ''}
                      </small>
                    ) : resetExpiresAt && resetExpiryClock ? (
                      <small>{t('quota.manualResetsValidUntil')} {resetExpiryClock}</small>
                    ) : null}
                    {(resets?.remaining ?? 0) > 0 && (detailsQuota?.used7d ?? 0) >= 90 && quotaDetails?.expectedIdentity && (
                      <>
                        <button
                          type="button"
                          className="identity-relay-quick-reset-btn"
                          disabled={busy || loading || !state?.browser.enabled || !!state?.recovery}
                          onClick={() => {
                            if (detailsAreCurrent && quotaDetails.expectedIdentity) {
                              setShowCleanroomBar(false);
                              void invoke('browser_open_usage', {
                                expectedIdentity: quotaDetails.expectedIdentity,
                                onProgress: activity.start('browser'),
                              }).then(
                                () => {
                                  activity.finish(true, 'quota.opened');
                                  setQuotaFeedback('quota.opened');
                                },
                                err => {
                                  const message = String(err);
                                  activity.finish(false, message);
                                  setQuotaFeedback(message);
                                },
                              );
                            } else if (quotaDetails.expectedIdentity) {
                              void openAccountBrowser(
                                {account_id: quotaDetails.id, expected_identity: quotaDetails.expectedIdentity},
                                'usage',
                              );
                            }
                          }}
                        >
                          {t('relay.goResetBtn')}
                        </button>
                        <button
                          type="button"
                          className="identity-relay-verify-reset-btn"
                          data-details-verify-reset
                          disabled={
                            busy ||
                            loading ||
                            !state?.browser.enabled ||
                            !!state?.recovery ||
                            Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : quotaDetails.id])
                          }
                          onClick={() =>
                            void syncSubscription(
                              detailsAreCurrent ? undefined : quotaDetails.id,
                              quotaDetails.expectedIdentity || undefined,
                              true,
                            )
                          }
                        >
                          {t('relay.verifyResetBtn')}
                        </button>
                      </>
                    )}
                  </dd>
                </div>
                {kycInfo && (
                  <div data-kyc-status={kycInfo.status}>
                    <dt>{t('quota.kycStatusLabel')}</dt>
                    <dd>
                      {kycInfo.tone === 'neutral' ? (
                        <span className="quota-details-kyc-note">{t(kycInfo.labelKey)}</span>
                      ) : (
                        <span className="quota-details-chip" data-tone={kycInfo.tone}>{t(kycInfo.labelKey)}</span>
                      )}
                      {(kycInfo.checkKind || kycInfo.observedAge) && (
                        <small className="quota-details-kyc-kind">
                          {[kycInfo.checkKind, kycInfo.observedAge].filter(Boolean).join(' · ')}
                        </small>
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('quota.isolationStatus')}</dt>
                  <dd>
                    <span className="quota-details-status" data-state={isolated}>
                      {t(isolated === 'active' ? 'quota.isolatedBrowserActive' : isolated === 'pending' ? 'quota.isolatedBrowserPending' : 'quota.isolatedBrowserOff')}
                    </span>
                    {detailsSummary?.proxy && <small>{t('quota.dedicatedProxy')}</small>}
                  </dd>
                </div>
                {tokenExpiry !== null && (
                  <div className="identity-refresh-token-warn" data-refresh-token-warn={tokenExpiry <= nowSec ? 'expired' : 'soon'}>
                    <dt>{t('quota.refreshTokenWarnTitle')}</dt>
                    <dd><strong>{tokenExpiry <= nowSec
                      ? t('quota.refreshTokenExpired')
                      : t('quota.refreshTokenExpiringSoon', {days: Math.max(1, Math.ceil((tokenExpiry - nowSec) / 86400))})}</strong></dd>
                  </div>
                )}
              </dl>

              <Disclosure summary={t('quotaSetup.guideTitle')} className="quota-details-disclosure" triggerClassName="quota-details-disclosure-trigger">
                <div className="identity-confirm quota-details-guide">
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
                  <div className="identity-confirm-target">
                    <span>{t('quotaSetup.status')}</span>
                    <strong>{t(quotaSetupError ? 'quotaSetup.unavailable' : !quotaSetup ? 'quotaSetup.checking' : 'quotaSetup.' + quotaSetup.state)}</strong>
                  </div>
                  <p className="identity-quota-note">{t('quotaSetup.guide')}</p>
                  <Button variant="secondary" size="small" onClick={() => void copyQuotaDiagnostic()}>{t('identityDiagnostic.copy')}</Button>
                  {copyDiagnosticStatus && <p role={copyDiagnosticStatus === 'failed' ? 'alert' : 'status'}>{t(copyDiagnosticStatus === 'copied' ? 'identityDiagnostic.copied' : 'identityDiagnostic.failed')}</p>}
                </div>
              </Disclosure>
              {quotaFeedbackText && <p className="quota-details-feedback" role="status">{quotaFeedbackText}</p>}
              <p className="quota-details-footnote">{t('quota.localOnly')}</p>
            </div>
          );
        })()}
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
          {hasBackgroundDaemonOnly ? (
            <div className="identity-live-relay-callout" role="status" data-bg-daemon-continuity>
              <div className="identity-live-relay-copy">
                <strong>{t('identities.bgDaemonContinuityTitle')}</strong>
                <span>{t('identities.bgDaemonContinuityDesc', {cmd: resumeShellCmd})}</span>
              </div>
              <Button
                variant="secondary"
                size="small"
                data-snapshot-copy-resume-cmd
                disabled={busy}
                onClick={() => void copyBgResumeCommand(resumeShellCmd)}
              >
                {copiedBgResume
                  ? t('identities.copiedResumeCmd', {cmd: resumeShellCmd})
                  : t('identities.copyResumeCmdBtn', {cmd: resumeShellCmd})}
              </Button>
            </div>
          ) : (
            <>
              {hasInteractiveChildShells && (
                <div
                  className="identity-unsaved-pool-hint"
                  role="alert"
                  data-child-shells-warn={interactiveChildShells.join(',')}
                >
                  <div style={{display: 'grid', gap: '2px', flex: '1 1 240px', minWidth: 0}}>
                    <strong>{t('identities.childShellsWarnTitle', {shells: interactiveChildShells.join(', ')})}</strong>
                    <span>{t('identities.childShellsWarnDesc')}</span>
                  </div>
                </div>
              )}
              {hasLiveClaudeProcess && (
                <div className="identity-live-relay-callout" role="note" data-live-cli-safe-relay>
                  <div className="identity-live-relay-copy">
                    <strong>{t('identities.liveCliSafeRelayTitle')}</strong>
                    <span>{t('identities.liveCliSafeRelayDesc')}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    data-switch-launch-relay
                    loading={launchRelayBusy}
                    disabled={launchRelayBusy || busy}
                    onClick={() => {
                      setSnapshot(false);
                      void launchRelayTerminal(recentLaunchDirs[0] || '');
                    }}
                  >
                    {t('identities.liveCliSafeRelayBtn')}
                  </Button>
                </div>
              )}
            </>
          )}
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>{t(hasBackgroundDaemonOnly ? 'identities.bgDaemonSessionsLabel' : '活跃 Claude 会话（保存时将自动结束）')}</span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}{s.background ? ` · ${t('identities.sessionBackgroundTag')}` : ''}</span>
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
          if (!open && !busy) {setReview(null); setWarmingPromotion(null);}
        }}
        title={warmingPromotion ? t('warming.promote') : review === 'recovery' ? t('恢复原身份') : review === 'empty' ? t('切换到空身份') : t('切换身份')}
        description={t(
          review === 'recovery'
            ? 'identitySafety.recoveryHint'
            : !warmingPromotion && hasBackgroundDaemonOnly
              ? 'identities.switchBgDaemonDesc'
              : (state?.running || (state?.sessions?.length ?? 0) > 0)
                ? '先压缩暂存当前 Claude Code 与 Desktop 状态，再切换。将结束已识别的 Claude 进程，未保存任务会中断。'
                : 'identitySafety.switchIdleHint',
        )}
        footer={
          <>
            <Button variant="secondary" onClick={() => {setReview(null); setWarmingPromotion(null);}}>
              {t('取消')}
            </Button>
            <Button variant="secondary" disabled={busy || loading || !state || !name.trim() || targetSlotBusy || (review !== 'recovery' && !!state.recovery)} onClick={() => void change()}>
              {review === 'recovery'
                ? t('确认恢复')
                : !warmingPromotion && hasBackgroundDaemonOnly
                  ? t('identities.confirmParkDaemonAndSwitch')
                  : t('确认暂存并切换')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          {targetSlotBusy && (
            <p role="alert" className="cleanup-feedback error">
              {t('relay.error.targetSlotBusy')}
            </p>
          )}
          {warmingPromotion && <div className="identity-confirm-target warming-promote-target"><span>{t('warming.promoteHint')}</span><strong>{maskDisplayName(warmingPromotion.name, warmingPromotion.email, prefs.privacyMask)}</strong><p>{t('warming.promotionContinuity')}</p></div>}
          {current?.present !== false || review === 'recovery' ? (
            <>
              <label htmlFor="identity-current-name">{t('当前身份保存为')}</label>
              <Input id="identity-current-name" maxLength={64} value={name} onChange={e => setName(e.target.value)} />
            </>
          ) : (
            <div className="identity-confirm-target">
              <span>{t('当前工作区')}</span>
              <strong>{t('待登录')}</strong>
            </div>
          )}
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
          {currentQuota && review !== 'recovery' && (
            <div className="identity-confirm-target">
              <span>{t('当前剩余额度')}</span>
              <code>{currentQuota.detail}</code>
            </div>
          )}
          {targetQuota && (
            <div className="identity-confirm-target">
              <span>{t('目标剩余额度')}</span>
              <code>{targetQuota.detail}</code>
            </div>
          )}
          {typeof review === 'object' && review && (
            <div className="identity-confirm-target">
              <span>{t('quota.isolationStatus')}</span>
              <strong>
                {state?.browser.enabled
                  ? (state.browser.bound_ids.includes(review.id) ? t('quota.isolatedBrowserActive') : t('quota.isolatedBrowserPending'))
                  : t('quota.isolatedBrowserOff')}
              </strong>
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
          {!policy.history && review !== 'recovery' && (hasBackgroundDaemonOnly || activeAdoptJobs.length > 0) && (
            <p className="identity-proxy-notice" role="note">
              {t('identities.adoptHistoryDisabledHint')}
            </p>
          )}
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
          {review !== 'recovery' && !warmingPromotion && (
            hasBackgroundDaemonOnly ? (
              <div className="identity-live-relay-callout" role="status" data-bg-daemon-continuity>
                <div className="identity-live-relay-copy">
                  <strong>{t('identities.bgDaemonContinuityTitle')}</strong>
                  <span>{t('identities.bgDaemonContinuityDesc', {cmd: resumeShellCmd})}</span>
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  data-switch-copy-resume-cmd
                  disabled={busy}
                  onClick={() => void copyBgResumeCommand(resumeShellCmd)}
                >
                  {copiedBgResume
                    ? t('identities.copiedResumeCmd', {cmd: resumeShellCmd})
                    : t('identities.copyResumeCmdBtn', {cmd: resumeShellCmd})}
                </Button>
              </div>
            ) : (
              <>
                {hasInteractiveChildShells && (
                  <div
                    className="identity-unsaved-pool-hint"
                    role="alert"
                    data-child-shells-warn={interactiveChildShells.join(',')}
                  >
                    <div style={{display: 'grid', gap: '2px', flex: '1 1 240px', minWidth: 0}}>
                      <strong>{t('identities.childShellsWarnTitle', {shells: interactiveChildShells.join(', ')})}</strong>
                      <span>{t('identities.childShellsWarnDesc')}</span>
                    </div>
                  </div>
                )}
                {hasLiveClaudeProcess && (
                  <div className="identity-live-relay-callout" role="note" data-live-cli-safe-relay>
                    <div className="identity-live-relay-copy">
                      <strong>{t('identities.liveCliSafeRelayTitle')}</strong>
                      <span>{t('identities.liveCliSafeRelayDesc')}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      data-switch-launch-relay
                      loading={launchRelayBusy}
                      disabled={launchRelayBusy || busy}
                      onClick={() => {
                        setReview(null);
                        void launchRelayTerminal(recentLaunchDirs[0] || '');
                      }}
                    >
                      {t('identities.liveCliSafeRelayBtn')}
                    </Button>
                  </div>
                )}
              </>
            )
          )}
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>
                {t(
                  hasBackgroundDaemonOnly && review !== 'recovery' && !warmingPromotion
                    ? 'identities.bgDaemonSessionsLabel'
                    : '活跃 Claude 会话（切换时将自动结束）',
                )}
              </span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}{s.background ? ` · ${t('identities.sessionBackgroundTag')}` : ''}</span>
                    {s.workspace && <strong>{s.workspace}</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proxyChanged && <p className="identity-proxy-notice">{t('代理环境提醒：目标身份与当前身份的独立代理配置不同，请确认出口 IP 与目标账号一致。')}</p>}
          {state?.browser.enabled && state.warming_cards?.some(card => card.browser_active) && !warmingPromotion && review !== 'recovery' && !state.recovery && (
            <Checkbox
              label={t('warming.syncCliBrowserOnSwitch')}
              checked={syncCliBrowserOnSwitch}
              disabled={busy}
              onCheckedChange={value => setSyncCliBrowserOnSwitch(value === true)}
            />
          )}
          {state?.browser.enabled && <p>{t(state.warming_cards?.some(card => card.browser_active) && !warmingPromotion && review !== 'recovery' && !state.recovery && !syncCliBrowserOnSwitch ? 'warming.cliSwitchKeepsBrowser' : '将关闭并重开关联浏览器，请先保存网页任务。')}</p>}
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
      <AppDialog
        open={expiryEditor !== null}
        onOpenChange={open => {
          if (!open && !busy) setExpiryEditor(null);
        }}
        title={t('identityCard.expiryDialogTitle', {name: maskDisplayName(expiryEditor?.label, expiryEditor?.email, prefs.privacyMask)})}
        description={t('identityCard.expiryDialogDesc')}
        fallbackFocusRef={quotaOpenerRef}
        footer={
          <>
            {expiryEditor?.hasManual && (
              <Button variant="secondary" disabled={busy} onClick={() => void saveSubscriptionExpiry(true)}>
                {t('identityCard.clearManualExpiry')}
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setExpiryEditor(null)}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={
                busy ||
                (!expiryEditor?.expiryYmd.trim() &&
                  !expiryEditor?.rechargeYmd.trim() &&
                  expiryEditor?.manualPlan === expiryEditor?.initialManualPlan &&
                  (expiryEditor?.expiryYmd.trim() ?? '') === (expiryEditor?.initialExpiryYmd ?? '') &&
                  (expiryEditor?.rechargeYmd.trim() ?? '') === (expiryEditor?.initialRechargeYmd ?? ''))
              }
              onClick={() => void saveSubscriptionExpiry(false)}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {expiryEditor && (() => {
          const previewExpiryYmd = expiryEditor.expiryYmd.trim() || addOneCalendarMonthYmd(expiryEditor.rechargeYmd.trim());
          const previewShort = formatYmdAsShortMd(previewExpiryYmd) || expiryEditor.browserSyncedShortMd;
          const previewName = maskDisplayName(expiryEditor.label, expiryEditor.email, prefs.privacyMask);
          const effectivePreviewPlan = expiryEditor.manualPlan || (expiryEditor.plan && expiryEditor.plan.trim() ? expiryEditor.plan : 'Pro');
          return (
            <div className="identity-expiry-dialog">
              <div className="identity-expiry-field">
                <label>{t('identityCard.planCalibrationTitle')}</label>
                <div className="identity-plan-calibration-chips" role="group" aria-label={t('identityCard.planCalibrationTitle')}>
                  <button
                    type="button"
                    className={`wakeup-preset-chip${expiryEditor.manualPlan === '' ? ' active' : ''}`}
                    data-manual-plan="auto"
                    onClick={() => setExpiryEditor(prev => (prev ? {...prev, manualPlan: '', error: ''} : prev))}
                  >
                    {t('identityCard.planAutoDetect')}
                  </button>
                  {CANONICAL_MANUAL_PLANS.map(tier => (
                    <button
                      key={tier}
                      type="button"
                      className={`wakeup-preset-chip${expiryEditor.manualPlan === tier ? ' active' : ''}`}
                      data-manual-plan={tier}
                      onClick={() => setExpiryEditor(prev => (prev ? {...prev, manualPlan: tier, error: ''} : prev))}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
                <p className="identity-plan-calibration-hint">{t('identityCard.planCalibrationHint')}</p>
              </div>
              <div className="identity-expiry-field">
                <label htmlFor="identity-recharge-date">{t('identityCard.rechargeDateLabel')}</label>
                <div className="identity-expiry-date-row">
                  <input
                    id="identity-recharge-date"
                    type="date"
                    min="2020-01-01"
                    max="2100-12-31"
                    className="identity-expiry-date-input"
                    value={expiryEditor.rechargeYmd}
                    onChange={e => {
                      const nextRecharge = e.target.value;
                      const computedExpiry = addOneCalendarMonthYmd(nextRecharge);
                      setExpiryEditor(prev =>
                        prev
                          ? {
                              ...prev,
                              rechargeYmd: nextRecharge,
                              expiryYmd: computedExpiry ?? prev.expiryYmd,
                              error: '',
                            }
                          : prev,
                      );
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      const today = epochSecToCalendarYmd(Math.floor(Date.now() / 1000)) ?? '';
                      const computedExpiry = addOneCalendarMonthYmd(today) ?? '';
                      setExpiryEditor(prev =>
                        prev
                          ? {
                              ...prev,
                              rechargeYmd: today,
                              expiryYmd: computedExpiry,
                              error: '',
                            }
                          : prev,
                      );
                    }}
                  >
                    {t('identityCard.rechargedToday')}
                  </Button>
                </div>
              </div>
              <div className="identity-expiry-field">
                <label htmlFor="identity-expiry-date">{t('identityCard.expiryDateLabel')}</label>
                <div className="identity-expiry-date-row">
                  <input
                    id="identity-expiry-date"
                    type="date"
                    min="2020-01-01"
                    max="2100-12-31"
                    className="identity-expiry-date-input"
                    value={expiryEditor.expiryYmd}
                    onChange={e => {
                      const nextExpiry = e.target.value;
                      setExpiryEditor(prev => (prev ? {...prev, expiryYmd: nextExpiry, error: ''} : prev));
                    }}
                  />
                </div>
                {!expiryEditor.expiryYmd.trim() && !expiryEditor.rechargeYmd.trim() && expiryEditor.browserSyncedFullYmd && (
                  <p className="identity-plan-calibration-hint">
                    {t('identityCard.browserDatePreservedHint', {date: expiryEditor.browserSyncedFullYmd})}
                  </p>
                )}
              </div>
              <div className="identity-expiry-preview">
                <span>{t('identityCard.cardPreviewLabel')}</span>
                <span className="identity-expiry-preview-badge">
                  <span>{previewName}</span>
                  <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(effectivePreviewPlan)}>
                    {effectivePreviewPlan}
                  </span>
                  {previewShort && <span className="identity-expiry-tag">{previewShort}</span>}
                </span>
              </div>
              {expiryEditor.error && <p role="alert" className="cleanup-feedback error">{t(expiryEditor.error)}</p>}
            </div>
          );
        })()}
      </AppDialog>
    </section>
  );
}

// ----- 工牌保留清晰文字与 CSS 阴影悬停，不用 3D 变换栅格化文字 -----
function IdentityCard({
  className,
  children,
  label,
  title,
  running,
  reorderId,
  isDragging,
  dragOffsetX = 0,
  dragTiltDeg = 0,
  dragHandleLabel,
  onDragStart,
  onDragKeyDown,
}: {
  className: string;
  children: ReactNode;
  label?: string;
  title?: string;
  running?: boolean;
  reorderId?: string;
  isDragging?: boolean;
  dragOffsetX?: number;
  dragTiltDeg?: number;
  dragHandleLabel?: string;
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const dragStyle = isDragging
    ? {transform: `translate3d(${dragOffsetX}px, -4px, 0) scale(1.025) rotate(${dragTiltDeg}deg)`}
    : undefined;
  return (
    <article
      className={className}
      aria-label={label}
      title={title}
      data-running={running !== undefined ? (running ? "true" : "false") : undefined}
      data-reorder-card-id={reorderId}
      style={dragStyle}
    >
      {reorderId && (
        <div
          className="identity-card-drag-handle"
          data-card-drag-handle
          title={dragHandleLabel}
          aria-label={dragHandleLabel}
          tabIndex={0}
          onPointerDown={onDragStart}
          onKeyDown={onDragKeyDown}
        />
      )}
      {children}
    </article>
  );
}
