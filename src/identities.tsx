/**
 * [INPUT]: 原生身份命令、轻量实时会话存活命令（identities_live_sessions，含 cli-slots 子代理槽位、后台守护标记 background、前台交互子 Shell child_shells 与待接管任务 active_adopt_jobs）、可选编排状态/清冷却/安装与最新交接检查点命令（identities_orchestrator_* / identities_sync_browser_proxy / identities_latest_handoff / identities_install_cli_wrappers）、手动/自动订阅到期、充值日与套餐层级校准命令（manualPlan）、可恢复的原生额度批次状态/取消、5h到期自动续杯配置/状态、Ultra无上限/Fable专项池/离线刷新凭据到期元数据、智能接力池摘要与悬浮窗穿透态、保留策略、逐窗观测、隐私偏好、顶部横条卡片拖拽排序、跨页卡片定位及本地额度修订轮询。
 * [OUTPUT]: 同风格计数的166×286 CLI身份/养号工牌（语义套餐色标 Free/Pro/Max/Ultra/Team、72h临期提醒、清晰区分当前使用/CLI运行中/桌面端运行与脉冲子代理槽位状态、快速筛选与可选多行平铺、切换前三态运行中CLI引导、顶部横条拖拽排序与共享弹簧滚轮）及协调 `./identities/` 子模块（IdentityCardPrimitives、WakeupModal、SmartRelayModal、QuotaDetailsModal、IdentityActionDialogs）、跨机防关联环境交接卡复制与悬浮窗穿透态恢复。
 * [POS]: 身份管理 GUI 壳层；额度工作由原生任务所有，页面挂载只恢复运行中的在线批次，导航不取消工作，身份破坏性操作在批次期间锁定；后台 revision 触发的读取在原生快照内容未变时保留现有状态对象，避免整页重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Button, Checkbox, Disclosure, useReducedMotionConfig} from 'cromma-ui';
import {DropdownMenu} from 'radix-ui';
import {listen} from '@tauri-apps/api/event';
import {
  addOneCalendarMonthYmd,
  aggregateBatchProgress,
  buildBatchTargets,
  buildStaleOrUnknownBatchTargets,
  configureNativeWakeup,
  epochSecToCalendarYmd,
  formatBatchProgress,
  formatMinuteOfDay,
  formatOnlineQuotaStatus,
  formatSubscriptionExpiryBadge,
  ForegroundQuotaScheduler,
  generateBatchRequestId,
  isConfirmedNewWakeup5h,
  isExpectedCurrentTarget,
  isExpectedSavedTarget,
  isMatchingBatchTarget,
  isTerminalBatchState,
  isValidCalendarYmd,
  readNativeWakeupSnapshot,
  resumeNativeWakeup,
  subscribeNativeWakeup,
  summarizeBatchResult,
  type AutoWakeupConfig,
  type BatchProgressSummary,
  type BatchQuotaResult,
  type OnlineQuotaResult,
  type OnlineQuotaStatus,
  type QuotaBatchProgress,
  type QuotaBatchTarget,
} from './identity-online-quota';
import type {IdentitySubscriptionMetadata} from './identity-model';
import {WarmingLibrary} from './warming-cards';
import {
  CURRENT_IDENTITY_ORDER_TOKEN,
  IDENTITY_CARD_ORDER_STORAGE_KEY,
  useCardRailReorder,
  useHorizontalRailWheelScroll,
} from './card-order';
import type {WarmingCard, WarmingFields, WarmingOpenMode} from './warming-model';
import type {BrowserState} from './browser-model';
import {useBrowserRuntime} from './use-browser-runtime';
import {verifyWakeupAnchorAdvancement, type WakeupAnchorVerificationResult} from './wakeup-presentation';
import {CheckTickCircle, Refresh, ShieldCheck} from 'cromma-ui/pika';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {IdentityOperationProgress, useCleanupActivity} from './cleaner-activity';
import {formatBytes} from './cleaner-model';
import {ClaudeCliPanel} from './claude-cli-panel';
import {ClaudeResiduePanel} from './claude-residue-panel';
import {
  collectInteractiveChildShells,
  defaultPolicy,
  isBackgroundOnlyState,
  normalizeAdoptJobIds,
  policyRows,
  type Identity,
  type IdentityState,
  type LiveSessionsSnapshot,
} from './identity-model';
import {maskDisplayName, maskEmailAddress, usePreferences} from './settings-model';
import {evaluateQuota} from './identity-quota';
import {usePageRefresh, type IdentityReviewRequest} from './app-events';
import {connectionHistory, isValidQuotaTargetSubset} from './identity-connections';
import {toBrowserSocks5ProxyFromCli, toCliHttpProxy} from './risk-model';
import {
  MONITOR_BUS_CHANNEL,
  postMonitorBusMessage,
  writeMonitorRelayStandbyHint,
  type MonitorBusMessage,
  type MonitorWindowState,
} from './floating-monitor-model';
import {
  clearAccountCooldown,
  evaluateSmartRelay,
  extractResetCardInfo,
  findSameExitClusterWarning,
  flushNativeSmartRelaySync,
  formatRelayCliModelEffortArgs,
  getRelayLaunchDirs,
  isAccountInCooldown,
  noteRelayAccountRateLimited,
  noteRelayAccountSwitch,
  recordRelayLaunchDir,
  removeRelayLaunchDir,
  summarizeRelayPool,
  syncNativeSmartRelayConfigIfLive,
  updateSmartRelayConfig,
  useCliDefaultProxy,
  useRelayLaunchDirs,
  useSmartRelayConfig,
  type RelayAccountInput,
} from './smart-relay-model';
import {
  canQueryLiveSessions,
  computeExpiryUrgency,
  copyTextWithClipboardFallback,
  IdentityCard,
  IdentityName,
  IdentityQuota,
  normalizeNativeErrorKey,
  sameActiveSessions,
  sameSlotSessions,
  sameStringArrays,
  SubscriptionAndResets,
  type CardFilterKind,
  type ExpiryEditorState,
  type QuotaFeedbackEntry,
  type Target,
} from './identities/IdentityCardPrimitives';
import {WakeupModal} from './identities/WakeupModal';
import {SmartRelayModal} from './identities/SmartRelayModal';
import {QuotaDetailsModal, type QuotaDetailsTarget} from './identities/QuotaDetailsModal';
import {IdentityActionDialogs} from './identities/IdentityActionDialogs';
import './identity-productivity.css';
import './floating-monitor.css';

let persistedWakeupAnchorMap: Record<string, WakeupAnchorVerificationResult> = {};

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
  const [quotaDetails, setQuotaDetails] = useState<QuotaDetailsTarget | null>(null);
  const [quotaFeedback, setQuotaFeedback] = useState<QuotaFeedbackEntry>('');
  const [suppressQuotaRestoreFocus, setSuppressQuotaRestoreFocus] = useState(false);
  const quotaOpenerRef = useRef<HTMLElement | null>(null);
  const [readReady, setReadReady] = useState(false);
  const [foregroundAutoRefresh, setForegroundAutoRefresh] = useState(false);
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);
  const [relayPanelOpen, setRelayPanelOpen] = useState(false);
  const relayPanelOpenRef = useRef(relayPanelOpen);
  relayPanelOpenRef.current = relayPanelOpen;
  const [launchRelayBusy, setLaunchRelayBusy] = useState(false);
  const [launchCwdDraft, setLaunchCwdDraft] = useState('');
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

      const {nextSummary, updatedResultsMap} = aggregateBatchProgress(
        batchSummaryRef.current,
        batchResultsMapRef.current,
        payload,
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
      poll: async () => {
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

  async function syncSubscription(
    targetAccountId?: string,
    targetExpectedIdentity?: string,
    verifyReset = false,
    onRelayFeedback?: (fb: {text: string; isError?: boolean}) => void,
  ) {
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
          ? {expectedIdentity: frozenExpectedIdentity}
          : {expectedIdentity: frozenExpectedIdentity, accountId: targetAccountId},
      );
      if (!mountedRef.current) return;
      const stillMatches = isCurrentTarget
        ? isExpectedCurrentTarget(stateRef.current, {active: frozenActive, expectedIdentity: frozenExpectedIdentity})
        : isExpectedSavedTarget(stateRef.current, {targetId: targetAccountId, expectedIdentity: frozenExpectedIdentity});
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
          if (relayPanelOpenRef.current) onRelayFeedback?.({text: tRef.current(fbEntry.key, fbEntry.values)});
        } else if (verifyReset) {
          const usedVal = Math.round(nextUsed7d ?? prevUsed7d ?? 0);
          setQuotaFeedback({key: 'relay.verifyResetPending', values: {used: usedVal}});
          if (relayPanelOpenRef.current) {
            onRelayFeedback?.({
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
      if (verifyReset && relayPanelOpenRef.current) onRelayFeedback?.({text: tRef.current(rawErr), isError: true});
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
  async function openCurrentRelayUsage(expectedIdentity: string): Promise<void> {
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
    const copied = await copyTextWithClipboardFallback(text);
    setQuotaFeedback(copied ? 'identities.handoffSpecCopied' : 'identities.handoffSpecCopyFailed');
  }

  async function copyBgResumeCommand(cmd: string): Promise<void> {
    if (bgResumeCopyTimerRef.current !== null) window.clearTimeout(bgResumeCopyTimerRef.current);
    const ok = await copyTextWithClipboardFallback(cmd);
    if (!mountedRef.current) return;
    setCopiedBgResume(ok);
    bgResumeCopyTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setCopiedBgResume(false);
    }, 2000);
  }

  async function launchRelayTerminal(
    explicitCwd?: string,
    onRelayFeedback?: (fb: {text: string; isError?: boolean} | null) => void,
  ): Promise<void> {
    if (launchRelayBusy) return;
    setLaunchRelayBusy(true);
    if (relayPanelOpenRef.current) onRelayFeedback?.(null);
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
        if (relayPanelOpenRef.current && onRelayFeedback) {
          onRelayFeedback({text: tRef.current('relay.launchedTerminalOk')});
        } else {
          setQuotaFeedback('relay.launchedTerminalOk');
        }
      }
    } catch (err) {
      const errKey = normalizeNativeErrorKey(err);
      if (mountedRef.current) {
        if (relayPanelOpenRef.current && onRelayFeedback) {
          onRelayFeedback({text: tRef.current(errKey), isError: true});
        } else {
          setQuotaFeedback(errKey);
        }
      }
    } finally {
      if (mountedRef.current) setLaunchRelayBusy(false);
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

      <WakeupModal
        open={onlinePanelOpen}
        onOpenChange={open => {
          setOnlinePanelOpen(open);
          if (!open) setForegroundAutoRefresh(false);
        }}
        state={state}
        current={current}
        currentName={currentName}
        quotaTargets={quotaTargets}
        staleQuotaTargets={staleQuotaTargets}
        batchBusy={batchBusy}
        batchSummary={batchSummary}
        actionLocked={actionLocked}
        busy={busy}
        loading={loading}
        unverifiedQuotaTargets={unverifiedQuotaTargets}
        connectionQueueItems={connectionQueueItems}
        suppressFeedback={Boolean(quotaDetails)}
        quotaFeedbackText={quotaFeedbackText}
        foregroundAutoRefresh={foregroundAutoRefresh}
        onForegroundAutoRefreshChange={setForegroundAutoRefresh}
        autoWakeConfig={autoWakeConfig}
        autoWakeState={autoWakeState}
        autoWakeSaving={autoWakeSaving}
        nativeWakeup={nativeWakeup}
        wakeupAnchorMap={wakeupAnchorMap}
        wakingAccountId={wakingAccountId}
        syncingAccountIds={syncingAccountIds}
        nowSec={nowSec}
        privacyMask={prefs.privacyMask}
        quotaOpenerRef={quotaOpenerRef}
        onRefreshAll={refreshAllQuotas}
        onUpdateAutoWakeConfig={updateAutoWakeConfig}
        onResumeWakeup={resumeWakeup}
        onWakeSingle={wakeupSingleAccount}
        onWakeAllIdle={wakeupAllIdleAccounts}
        onSyncSubscription={(accountId, expectedIdentity) => syncSubscription(accountId, expectedIdentity)}
        onOpenAccountBrowser={target => openAccountBrowser(target)}
        t={t}
      />

      <SmartRelayModal
        open={relayPanelOpen}
        onOpenChange={setRelayPanelOpen}
        state={state}
        current={current}
        active={active}
        smartRelay={smartRelay}
        cliDefaultProxy={cliDefaultProxy}
        relayEval={relayEval}
        relayPoolSummary={relayPoolSummary}
        sameExitCluster={sameExitCluster}
        relayRecommendedSaved={relayRecommendedSaved}
        recentLaunchDirs={recentLaunchDirs}
        launchRelayBusy={launchRelayBusy}
        launchCwdDraft={launchCwdDraft}
        onLaunchCwdDraftChange={setLaunchCwdDraft}
        onLaunchRelayTerminal={launchRelayTerminal}
        blocked={blocked}
        busy={busy}
        batchBusy={batchBusy}
        loading={loading}
        syncingAccountIds={syncingAccountIds}
        nowSec={nowSec}
        privacyMask={prefs.privacyMask}
        quotaDisplay={prefs.quotaDisplay}
        onCommitRelayBrowserState={nextState => setState(nextState)}
        onQuotaFeedback={setQuotaFeedback}
        onOpenCurrentUsage={openCurrentRelayUsage}
        onOpenAccountBrowser={openAccountBrowser}
        onVerifyReset={(accountId, expectedIdentity, onRelayFeedback) =>
          syncSubscription(accountId, expectedIdentity, true, onRelayFeedback)
        }
        onSwitchCandidate={choose}
        onOpenSnapshot={openSnapshot}
        t={t}
      />

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
                  <IdentityQuota quota={currentQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {quotaOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSuppressQuotaRestoreFocus(false); setQuotaDetails({id: active?.id || 'current', name: currentName, expectedIdentity: current?.quota_identity || null}); setQuotaFeedback('');}} />
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
                <IdentityQuota quota={savedQuota} display={prefs.quotaDisplay} nowSec={nowSec} t={t} onOpenDetails={() => {quotaOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSuppressQuotaRestoreFocus(false); setQuotaDetails({id: row.id, name: row.name, expectedIdentity: summary?.quota_identity || null}); setQuotaFeedback('');}} />
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

      <QuotaDetailsModal
        quotaDetails={quotaDetails}
        state={state}
        current={current}
        suppressQuotaRestoreFocus={suppressQuotaRestoreFocus}
        busy={busy}
        loading={loading}
        syncingAccountIds={syncingAccountIds}
        quotaFeedbackText={quotaFeedbackText}
        smartRelaySpentThresholdPct={smartRelay.spentThresholdPct}
        nowSec={nowSec}
        quotaDisplay={prefs.quotaDisplay}
        privacyMask={prefs.privacyMask}
        locale={locale}
        activity={activity}
        setShowCleanroomBar={setShowCleanroomBar}
        onQuotaFeedback={setQuotaFeedback}
        onClose={() => {
          setSuppressQuotaRestoreFocus(false);
          setQuotaDetails(null);
          setQuotaFeedback('');
        }}
        onOpenAccountBrowser={(target, openMode) => void openAccountBrowser(target, openMode)}
        onSyncSubscription={(accountId, expectedIdentity, verifyReset) =>
          void syncSubscription(accountId, expectedIdentity, verifyReset)
        }
        onOpenExpiryEditor={openExpiryEditor}
        t={t}
      />

      <IdentityActionDialogs
        state={state}
        active={active}
        current={current}
        currentQuota={currentQuota}
        targetSummary={targetSummary}
        targetQuota={targetQuota}
        targetSlotBusy={targetSlotBusy}
        recoveryRecord={recoveryRecord}
        policy={policy}
        kept={kept}
        removed={removed}
        proxyChanged={proxyChanged}
        hasBackgroundDaemonOnly={hasBackgroundDaemonOnly}
        hasInteractiveChildShells={hasInteractiveChildShells}
        interactiveChildShells={interactiveChildShells}
        hasLiveClaudeProcess={hasLiveClaudeProcess}
        activeAdoptJobs={activeAdoptJobs}
        resumeShellCmd={resumeShellCmd}
        copiedBgResume={copiedBgResume}
        recentLaunchDirs={recentLaunchDirs}
        launchRelayBusy={launchRelayBusy}
        syncCliBrowserOnSwitch={syncCliBrowserOnSwitch}
        onSyncCliBrowserOnSwitchChange={setSyncCliBrowserOnSwitch}
        quotaOpenerRef={quotaOpenerRef}
        busy={busy}
        loading={loading}
        error={error}
        privacyMask={prefs.privacyMask}
        returnCliBrowser={returnCliBrowser}
        onReturnCliBrowserClose={() => setReturnCliBrowser(null)}
        onReturnToCliBrowser={returnToCliBrowser}
        snapshot={snapshot}
        onSnapshotClose={() => setSnapshot(false)}
        onSaveSnapshot={saveSnapshot}
        name={name}
        onNameChange={setName}
        review={review}
        warmingPromotion={warmingPromotion}
        onReviewClose={() => {
          setReview(null);
          setWarmingPromotion(null);
        }}
        onChangeIdentity={change}
        deletion={deletion}
        accepted={accepted}
        onAcceptedChange={setAccepted}
        deleteBrowser={deleteBrowser}
        onDeleteBrowserChange={setDeleteBrowser}
        onDeletionClose={() => setDeletion(null)}
        onRemoveIdentity={remove}
        browserReview={browserReview}
        useExisting={useExisting}
        onUseExistingChange={setUseExisting}
        onBrowserReviewClose={() => setBrowserReview(null)}
        onConfigureBrowser={configureBrowser}
        rename={rename}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameClose={() => {
          setRename(null);
          setError('');
        }}
        onSaveName={saveName}
        expiryEditor={expiryEditor}
        setExpiryEditor={setExpiryEditor}
        onSaveSubscriptionExpiry={saveSubscriptionExpiry}
        onCopyBgResumeCommand={copyBgResumeCommand}
        onLaunchRelayTerminal={explicitCwd => launchRelayTerminal(explicitCwd)}
        t={t}
      />
    </section>
  );
}
