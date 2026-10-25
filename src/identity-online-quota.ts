/**
 * [INPUT]: 在线额度状态/原因白名单、持久批次结果契约、前台轮询设置与订阅重置元数据。
 * [OUTPUT]: 可恢复批次聚合/终态格式化、严格目标指纹校验、额度结果分级、前台串行调度与独立时钟/过期状态的订阅重置脱敏模型。
 * [POS]: 身份管理前端纯模型；不访问网络或凭据，原生 Tauri 任务负责请求、取消和账本提交。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { IdentitySubscriptionMetadata } from './identity-model';

export type OnlineQuotaStatus =
  | 'updated'
  | 'cached'
  | 'cooldown'
  | 'auth_required'
  | 'unavailable'
  | 'rate_limited'
  | 'network_error'
  | 'invalid_response'
  | 'account_mismatch'
  | 'route_unavailable'
  | 'cancelled'
  | 'not_run'
  | 'deadline_exceeded';

export type OnlineQuotaReason = 'unsupported_proxy' | 'route_changed' | 'auth_required' | 'rate_limited';
export type OnlineQuotaStage = 'route' | 'commit';
export type OnlineQuotaRouteMode = 'account_proxy' | 'host_system';
export type OnlineQuotaRetryScope = 'oauth' | 'all';

export interface OnlineQuotaResult {
  status: OnlineQuotaStatus;
  observed_at_ms?: number;
  last_observed_at_ms?: number;
  retry_at_ms?: number;
  updated_windows?: string[];
  source?: 'oauth' | 'browser';
  reason?: OnlineQuotaReason;
  stage?: OnlineQuotaStage;
  route_mode?: OnlineQuotaRouteMode;
  retry_scope?: OnlineQuotaRetryScope;
  verified_at_ms?: number;
  runtime_stage?: 'probe' | 'execute';
  runtime_reason?: 'missing_resource' | 'no_compatible_runtime' | 'missing_dependency' | 'probe_failed' | 'timeout' | 'invalid_response';
}

export function formatOnlineQuotaStatus(
  result: OnlineQuotaResult | null | undefined,
  nowMs: number,
  t: (key: string, slots?: Record<string, string | number>) => string
): { message: string; isError: boolean } {
  if (!result) return { message: '', isError: false };

  if (result.runtime_reason) {
    const runtimeReasonKeys: Record<NonNullable<OnlineQuotaResult['runtime_reason']>, string> = {
      missing_resource: 'missingResource',
      no_compatible_runtime: 'noCompatibleRuntime',
      missing_dependency: 'missingDependency',
      probe_failed: 'probeFailed',
      timeout: 'timeout',
      invalid_response: 'invalidResponse',
    };
    const stage = result.runtime_stage === 'execute' ? 'execute' : 'probe';
    return {message: t(`quotaOnline.runtime.${stage}.${runtimeReasonKeys[result.runtime_reason]}`), isError: true};
  }
  if (result.reason && result.status !== 'cooldown' && result.status !== 'rate_limited') {
    const reasonKeys: Record<OnlineQuotaReason, string> = {
      unsupported_proxy: 'unsupportedProxy',
      route_changed: 'routeChanged',
      auth_required: 'authRequired',
      rate_limited: 'rateLimited',
    };
    return {message: t(`quotaOnline.reason.${reasonKeys[result.reason]}`), isError: result.reason !== 'rate_limited' || result.retry_scope !== 'oauth'};
  }
  if (result.status === 'updated' && (!Array.isArray(result.updated_windows) || result.updated_windows.length === 0)) {
    return {message: t('quotaOnline.status.invalidResponse'), isError: true};
  }

  const cooldownSec = result.retry_at_ms && result.retry_at_ms > nowMs
    ? Math.max(1, Math.ceil((result.retry_at_ms - nowMs) / 1000))
    : 0;

  switch (result.status) {
    case 'updated':
      return { message: t('quotaOnline.status.updated'), isError: false };
    case 'cached':
      return { message: t('quotaOnline.status.cached'), isError: false };
    case 'cooldown':
      return {
        message: cooldownSec > 0
          ? t('quotaOnline.status.cooldownWithTime', { v0: cooldownSec })
          : t('quotaOnline.status.cooldown'),
        isError: false,
      };
    case 'rate_limited':
      return {
        message: cooldownSec > 0
          ? t('quotaOnline.status.rateLimitedWithTime', { v0: cooldownSec })
          : t('quotaOnline.status.rateLimited'),
        isError: true,
      };
    case 'auth_required':
      return { message: t('quotaOnline.status.authRequired'), isError: true };
    case 'account_mismatch':
      return { message: t('quotaOnline.status.accountMismatch'), isError: true };
    case 'route_unavailable':
      return { message: t('quotaOnline.status.routeUnavailable'), isError: true };
    case 'cancelled':
      return { message: t('quotaOnline.status.cancelled'), isError: false };
    case 'not_run':
      return { message: t('quotaOnline.status.notRun'), isError: false };
    case 'deadline_exceeded':
      return { message: t('quotaOnline.status.deadlineExceeded'), isError: true };
    case 'network_error':
      return { message: t('quotaOnline.status.networkError'), isError: true };
    case 'invalid_response':
      return { message: t('quotaOnline.status.invalidResponse'), isError: true };
    case 'unavailable':
    default:
      return { message: t('quotaOnline.status.unavailable'), isError: true };
  }
}

export interface SubscriptionResetDisplay {
  hasAnyData: boolean;
  emptyNotice?: string;
  billing?: {
    kind: 'next_renewal' | 'access_until';
    label: string;
    formattedDate: string;
    rawDate: number;
    observedAtMs?: number | null;
    stale: boolean;
  };
  manualResets?: {
    remaining: number;
    label: string;
    observedAtMs?: number | null;
    validUntil?: number | null;
    stale: boolean;
    usable: boolean;
  };
}

export function formatSubscriptionAndResets(
  meta: IdentitySubscriptionMetadata | null | undefined,
  locale: string,
  t: (key: string) => string,
  nowMs = Date.now()
): SubscriptionResetDisplay {
  if (!meta) {
    return {
      hasAnyData: false,
      emptyNotice: t('identityCard.noSubscriptionOrResetData'),
    };
  }

  const isKnownKind = meta.billing_date_kind === 'next_renewal' || meta.billing_date_kind === 'access_until';
  const hasBilling = isKnownKind && typeof meta.billing_date === 'number' && Number.isFinite(meta.billing_date) && meta.billing_date > 0;
  const hasResets = typeof meta.manual_resets_remaining === 'number' && Number.isInteger(meta.manual_resets_remaining) && meta.manual_resets_remaining >= 0;

  if (!hasBilling && !hasResets) {
    return {
      hasAnyData: false,
      emptyNotice: t('identityCard.noSubscriptionOrResetData'),
    };
  }

  let billing: SubscriptionResetDisplay['billing'] | undefined;
  if (hasBilling) {
    const kind = meta.billing_date_kind === 'access_until' ? 'access_until' : 'next_renewal';
    const observedAtMs = meta.billing_observed_at_ms ?? meta.metadata_observed_at_ms ?? null;
    const dateObj = new Date(meta.billing_date! * 1000);
    const formattedDate = Number.isFinite(dateObj.getTime())
      ? dateObj.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';
    billing = {
      kind,
      label: kind === 'access_until' ? t('identityCard.accessUntil') : t('identityCard.nextRenewal'),
      formattedDate,
      rawDate: meta.billing_date!,
      observedAtMs,
      stale: !observedAtMs || nowMs - observedAtMs > 30 * 24 * 60 * 60 * 1000,
    };
  }

  let manualResets: SubscriptionResetDisplay['manualResets'] | undefined;
  if (hasResets) {
    const observedAtMs = meta.manual_resets_observed_at_ms ?? meta.metadata_observed_at_ms ?? null;
    const validUntil = meta.manual_resets_valid_until ?? null;
    const stale = !observedAtMs || nowMs - observedAtMs > 24 * 60 * 60 * 1000 ||
      !validUntil || validUntil * 1000 <= nowMs;
    manualResets = {
      remaining: meta.manual_resets_remaining!,
      label: t('identityCard.manualResetsRemaining'),
      observedAtMs,
      validUntil,
      stale,
      usable: !stale && (meta.manual_resets_remaining === 0 || validUntil !== null),
    };
  }

  return {
    hasAnyData: true,
    billing,
    manualResets,
  };
}

export interface SchedulerOptions {
  intervalMs?: number;
  isForeground: () => boolean;
  poll: (generation: number) => Promise<OnlineQuotaResult | null | undefined>;
  onResult?: (result: OnlineQuotaResult | null | undefined, generation: number) => void;
  now?: () => number;
}

export class ForegroundQuotaScheduler {
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentGeneration = 0;
  private destroyed = false;
  private running = false;
  private nextRunAtMs = 0;

  private readonly intervalMs: number;
  private readonly isForeground: () => boolean;
  private readonly poll: (generation: number) => Promise<OnlineQuotaResult | null | undefined>;
  private readonly onResult?: (result: OnlineQuotaResult | null | undefined, generation: number) => void;
  private readonly now: () => number;

  constructor(options: SchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 180_000;
    this.isForeground = options.isForeground;
    this.poll = options.poll;
    this.onResult = options.onResult;
    this.now = options.now ?? (() => Date.now());
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getGeneration(): number {
    return this.currentGeneration;
  }

  public setEnabled(enable: boolean, immediatePoll = true): void {
    if (this.destroyed) return;
    if (this.enabled === enable) return;
    this.enabled = enable;

    if (!enable) {
      this.clearPendingTimer();
    } else {
      if (immediatePoll && this.isForeground()) {
        void this.triggerPoll();
      } else {
        this.scheduleNext(this.intervalMs);
      }
    }
  }

  public onForegroundChange(): void {
    if (this.destroyed || !this.enabled) return;
    if (this.isForeground()) {
      // If we are now foreground and have no pending timer or overdue
      if (!this.running && (!this.timer || this.nextRunAtMs <= this.now())) {
        void this.triggerPoll();
      }
    } else {
      // Background: pause timer
      this.clearPendingTimer();
    }
  }

  public invalidate(): void {
    this.currentGeneration++;
    this.clearPendingTimer();
    if (this.enabled && this.isForeground()) {
      this.scheduleNext(this.intervalMs);
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.clearPendingTimer();
    this.currentGeneration++;
  }

  private clearPendingTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearPendingTimer();
    if (this.destroyed || !this.enabled) return;
    const boundedDelay = Math.max(50, delayMs);
    this.nextRunAtMs = this.now() + boundedDelay;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.destroyed && this.enabled) {
        if (this.isForeground()) {
          void this.triggerPoll();
        } else {
          // Stay paused until foreground
        }
      }
    }, boundedDelay);
  }

  private async triggerPoll(): Promise<void> {
    if (this.destroyed || !this.enabled || this.running) return;
    if (!this.isForeground()) return;

    this.running = true;
    const generation = this.currentGeneration;
    let nextDelay = this.intervalMs;

    try {
      const result = await this.poll(generation);
      if (this.destroyed || generation !== this.currentGeneration) {
        return;
      }
      this.onResult?.(result, generation);

      if (result?.retry_at_ms && result.retry_at_ms > this.now()) {
        const cooldownMs = result.retry_at_ms - this.now();
        // Wait at least cooldown or interval
        nextDelay = Math.max(nextDelay, cooldownMs);
      }
    } catch {
      // On failure, keep existing data and schedule next standard interval
    } finally {
      this.running = false;
      if (!this.destroyed && this.enabled) {
        this.scheduleNext(nextDelay);
      }
    }
  }
}

export function isExpectedCurrentTarget(
  currentState: { active?: string | null; current?: { quota_identity?: string | null } | null } | null | undefined,
  frozen: { active?: string | null; expectedIdentity: string }
): boolean {
  if (!frozen.expectedIdentity || !currentState) return false;
  return (
    currentState.active === frozen.active &&
    currentState.current?.quota_identity === frozen.expectedIdentity
  );
}

export function isExpectedSavedTarget(
  currentState: { summaries?: Record<string, { quota_identity?: string | null }> } | null | undefined,
  frozen: { targetId: string; expectedIdentity: string }
): boolean {
  if (!frozen.expectedIdentity || !currentState?.summaries) return false;
  return currentState.summaries[frozen.targetId]?.quota_identity === frozen.expectedIdentity;
}

export interface QuotaBatchTarget {
  account_id: 'current' | string;
  expected_identity: string;
}

export interface QuotaBatchProgress {
  request_id: string;
  account_id: string;
  expected_identity: string;
  result: OnlineQuotaResult;
  completed: number;
  total: number;
  state?: QuotaBatchState;
}

export interface BatchQuotaResult {
  request_id: string;
  results: Array<{
    account_id: string;
    expected_identity: string;
    result: OnlineQuotaResult;
  }>;
  completed: number;
  total: number;
  state: QuotaBatchState;
  targets: QuotaBatchTarget[];
  started_at_ms: number;
  deadline_at_ms: number;
}

export type QuotaBatchState = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'deadline_exceeded';

export function isTerminalBatchState(state: QuotaBatchState | null | undefined): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'deadline_exceeded';
}

export function isMatchingBatchTarget(
  target: QuotaBatchTarget | null | undefined,
  currentFingerprint: string | null | undefined
): boolean {
  return !!target && /^[0-9a-f]{64}$/i.test(target.expected_identity) &&
    typeof currentFingerprint === 'string' &&
    target.expected_identity.toLowerCase() === currentFingerprint.toLowerCase();
}

export interface BatchProgressSummary {
  inProgress: boolean;
  requestId: string | null;
  state?: QuotaBatchState;
  total: number;
  completed: number;
  successCount: number;
  cachedCount?: number;
  cooldownCount?: number;
  authRequiredCount: number;
  errorCount: number;
  notRunCount?: number;
  deadlineAtMs?: number;
}

export function summarizeBatchResult(batch: BatchQuotaResult): BatchProgressSummary {
  const results = batch.results.map(item => item.result);
  const counts = {
    successCount: results.filter(result => result.status === 'updated' && isSuccessfulOnlineResult(result)).length,
    cachedCount: results.filter(result => result.status === 'cached').length,
    cooldownCount: results.filter(result => result.status === 'cooldown' || result.status === 'rate_limited').length,
    authRequiredCount: results.filter(result => result.status === 'auth_required').length,
    errorCount: results.filter(result => (result.status === 'updated' && !isSuccessfulOnlineResult(result)) ||
      !['updated', 'cached', 'cooldown', 'rate_limited', 'auth_required', 'cancelled', 'not_run'].includes(result.status)).length,
  };
  const notRunCount = batch.results.filter(item => item.result.status === 'not_run').length || Math.max(0, batch.total - batch.completed);
  return {
    inProgress: !isTerminalBatchState(batch.state),
    requestId: batch.request_id,
    state: batch.state,
    total: batch.total,
    completed: batch.completed,
    ...counts,
    notRunCount,
    deadlineAtMs: batch.deadline_at_ms,
  };
}

export function generateBatchRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function isSuccessfulOnlineResult(result: OnlineQuotaResult | null | undefined): boolean {
  if (!result) return false;
  const isStatusSuccess = result.status === 'cached' ||
    (result.status === 'updated' && Array.isArray(result.updated_windows) && result.updated_windows.length > 0);
  if (!isStatusSuccess) return false;
  if (result.source !== undefined && result.source !== 'oauth' && result.source !== 'browser') {
    return false;
  }
  return true;
}

export function buildBatchTargets(state: {
  active?: string | null;
  current?: { present?: boolean; quota_identity?: string | null } | null;
  records?: Array<{ id: string }>;
  summaries?: Record<string, { quota_identity?: string | null }>;
} | null | undefined): {
  targets: QuotaBatchTarget[];
  unverifiedCount: number;
  fingerprintSetKey: string;
} {
  if (!state) return { targets: [], unverifiedCount: 0, fingerprintSetKey: '' };

  const targets: QuotaBatchTarget[] = [];
  let unverifiedCount = 0;
  const is64Hex = (str: string | null | undefined): str is string =>
    typeof str === 'string' && /^[0-9a-fA-F]{64}$/.test(str.trim());

  // Current identity
  if (state.current?.present) {
    const rawFp = state.current.quota_identity?.trim();
    if (is64Hex(rawFp)) {
      targets.push({ account_id: 'current', expected_identity: rawFp.toLowerCase() });
    } else {
      unverifiedCount++;
    }
  }

  // Records: skip if current.present and record.id === state.active
  const records = state.records ?? [];
  for (const record of records) {
    if (state.current?.present && state.active && record.id === state.active) {
      continue;
    }
    const rawFp = state.summaries?.[record.id]?.quota_identity?.trim();
    if (is64Hex(rawFp)) {
      targets.push({ account_id: record.id, expected_identity: rawFp.toLowerCase() });
    } else {
      unverifiedCount++;
    }
  }

  // Stable fingerprint set key: unique sorted fingerprints ONLY (no account_id or 'current')
  const uniqueFpList = Array.from(new Set(targets.map(t => t.expected_identity.toLowerCase()))).sort();
  const fingerprintSetKey = uniqueFpList.join(',');

  return { targets, unverifiedCount, fingerprintSetKey };
}

export function aggregateBatchProgress(
  prevSummary: BatchProgressSummary,
  resultsMap: Record<string, OnlineQuotaResult>,
  newPayload: QuotaBatchProgress
): {
  nextSummary: BatchProgressSummary;
  updatedResultsMap: Record<string, OnlineQuotaResult>;
  isNewResult: boolean;
} {
  const targetKey = newPayload.account_id;
  const updatedResultsMap = { ...resultsMap, [targetKey]: newPayload.result };

  let successCount = 0;
  let authRequiredCount = 0;
  let errorCount = 0;

  for (const res of Object.values(updatedResultsMap)) {
    if (res.status === 'updated' && isSuccessfulOnlineResult(res)) {
      successCount++;
    } else if (res.status === 'auth_required') {
      authRequiredCount++;
    } else if (!['cached', 'cooldown', 'rate_limited', 'cancelled', 'not_run', 'deadline_exceeded'].includes(res.status)) {
      errorCount++;
    }
  }

  const uniqueCompleted = Object.keys(updatedResultsMap).length;
  const maxCompleted = Math.max(prevSummary.completed, newPayload.completed, uniqueCompleted);

  const nextSummary: BatchProgressSummary = {
    inProgress: maxCompleted < prevSummary.total,
    requestId: newPayload.request_id,
    total: Math.max(prevSummary.total, newPayload.total),
    completed: maxCompleted,
    successCount,
    authRequiredCount,
    errorCount,
  };

  return {
    nextSummary,
    updatedResultsMap,
    isNewResult: !resultsMap[targetKey],
  };
}

export function formatBatchProgress(
  summary: BatchProgressSummary,
  t: (key: string, slots?: Record<string, string | number>) => string
): string {
  if (!summary.inProgress && summary.completed === 0) return '';
  if (summary.state === 'cancelled') {
    return t('quotaOnline.batchCancelled', {completed: summary.completed, total: summary.total, remaining: summary.notRunCount ?? Math.max(0, summary.total - summary.completed)});
  }
  if (summary.state === 'deadline_exceeded') {
    return t('quotaOnline.batchDeadlineExceeded', {completed: summary.completed, total: summary.total, remaining: summary.notRunCount ?? Math.max(0, summary.total - summary.completed)});
  }
  const shared = {
    completed: summary.completed,
    total: summary.total,
    success: summary.successCount,
    cached: summary.cachedCount ?? 0,
    cooldown: summary.cooldownCount ?? 0,
    auth: summary.authRequiredCount,
    failed: summary.errorCount,
    remaining: summary.notRunCount ?? Math.max(0, summary.total - summary.completed),
  };
  if (summary.inProgress) {
    return t('quotaOnline.batchProgress', shared);
  }
  return t('quotaOnline.batchComplete', shared);
}

// ============================================================================
// 5h/7d 窗口到期自动唤醒（自动续杯）与四维防风控调度模型
// ============================================================================

export const AUTO_WAKEUP_CONFIG_KEY = 'claude-local:auto-wakeup-config-v1';
export const AUTO_WAKEUP_STATE_KEY = 'claude-local:auto-wakeup-state-v1';

export interface AutoWakeupConfig {
  /** 总开关：未启用时完全保持现状（false），启用后跨重启自动生效 */
  enabled: boolean;
  /** 是否仅在自定义时间段内触发（默认 true） */
  useTimeWindow: boolean;
  /** 开始时间（距离 00:00 的分钟数，默认 480 = 08:00） */
  startMinute: number;
  /** 结束时间（距离 00:00 的分钟数，默认 1380 = 23:00，支持跨零点如 22:00-02:00） */
  endMinute: number;
  /** 当前主力账号 5h 剩余百分比低于该值时，联动唤醒处于休眠待命的备用号（默认 40%） */
  prewarmThresholdPct: number;
  /** 单独排除自动续杯的账号 quota_identity 列表 */
  excludedIdentities: string[];
}

export const DEFAULT_AUTO_WAKEUP_CONFIG: AutoWakeupConfig = {
  enabled: false,
  useTimeWindow: true,
  startMinute: 8 * 60,
  endMinute: 23 * 60,
  prewarmThresholdPct: 40,
  excludedIdentities: [],
};

export interface AutoWakeupAccountRuntime {
  /** 连续自动唤醒后未实际使用（used5h <= 1%）的轮数：0=刚用过，1=空转1轮，>=2=进入按需待命 */
  unusedStreak: number;
  /** 最近一次已完成自动唤醒所针对的过期 reset_at（秒） */
  lastWokenForResetSec: number | null;
  /** 最近一次自动唤醒成功的时间戳（毫秒） */
  lastWokenAtMs: number | null;
  /** 最近一次自动唤醒后开启的新 5h 窗口 reset_at（秒），用于追踪该窗口内是否产生真实使用 */
  wokenWindowResetSec: number | null;
  /** 在最近一次自动唤醒开启的窗口期内，用户是否真实使用过该账号（used5h > 1%） */
  usedDuringWokenWindow: boolean;
  /** 当前正在排队的过期 reset_at（秒）及其计划触发时间戳（毫秒） */
  scheduledForResetSec: number | null;
  scheduledAtMs: number | null;
  /** 最近一次状态（'updated' | 'auth_required' | 'rate_limited' | 'error' | null） */
  lastStatus: string | null;
  /** 错误退避截止时间（毫秒） */
  backoffUntilMs: number | null;
}

export interface AutoWakeupStateStore {
  lastGlobalWakeupAtMs: number;
  accounts: Record<string, AutoWakeupAccountRuntime>;
}

export function defaultAccountWakeupRuntime(): AutoWakeupAccountRuntime {
  return {
    unusedStreak: 0,
    lastWokenForResetSec: null,
    lastWokenAtMs: null,
    wokenWindowResetSec: null,
    usedDuringWokenWindow: false,
    scheduledForResetSec: null,
    scheduledAtMs: null,
    lastStatus: null,
    backoffUntilMs: null,
  };
}

export function formatMinuteOfDay(minute: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.floor(Number.isFinite(minute) ? minute : 0)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function parseMinuteOfDay(value: string, fallback = 480): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return fallback;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return fallback;
  }
  return hh * 60 + mm;
}

export function isWithinWakeupTimeWindow(config: AutoWakeupConfig, nowDate: Date): boolean {
  if (!config.useTimeWindow) return true;
  const start = Math.max(0, Math.min(1439, Math.floor(config.startMinute)));
  const end = Math.max(0, Math.min(1439, Math.floor(config.endMinute)));
  if (start === end) return true;
  const current = nowDate.getHours() * 60 + nowDate.getMinutes();
  if (start < end) {
    return current >= start && current < end;
  }
  // 跨午夜时段（例如 21:00 - 02:00）
  return current >= start || current < end;
}

export function loadAutoWakeupConfig(): AutoWakeupConfig {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_AUTO_WAKEUP_CONFIG };
    const raw = localStorage.getItem(AUTO_WAKEUP_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_AUTO_WAKEUP_CONFIG };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AUTO_WAKEUP_CONFIG };
    return {
      enabled: Boolean(parsed.enabled),
      useTimeWindow: parsed.useTimeWindow !== false,
      startMinute: typeof parsed.startMinute === 'number' && Number.isFinite(parsed.startMinute)
        ? Math.max(0, Math.min(1439, Math.floor(parsed.startMinute)))
        : DEFAULT_AUTO_WAKEUP_CONFIG.startMinute,
      endMinute: typeof parsed.endMinute === 'number' && Number.isFinite(parsed.endMinute)
        ? Math.max(0, Math.min(1439, Math.floor(parsed.endMinute)))
        : DEFAULT_AUTO_WAKEUP_CONFIG.endMinute,
      prewarmThresholdPct: typeof parsed.prewarmThresholdPct === 'number' && Number.isFinite(parsed.prewarmThresholdPct)
        ? Math.max(10, Math.min(80, Math.round(parsed.prewarmThresholdPct)))
        : DEFAULT_AUTO_WAKEUP_CONFIG.prewarmThresholdPct,
      excludedIdentities: Array.isArray(parsed.excludedIdentities)
        ? parsed.excludedIdentities.filter((x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/i.test(x))
        : [],
    };
  } catch {
    return { ...DEFAULT_AUTO_WAKEUP_CONFIG };
  }
}

export function saveAutoWakeupConfig(config: AutoWakeupConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUTO_WAKEUP_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function loadAutoWakeupState(): AutoWakeupStateStore {
  try {
    if (typeof localStorage === 'undefined') return { lastGlobalWakeupAtMs: 0, accounts: {} };
    const raw = localStorage.getItem(AUTO_WAKEUP_STATE_KEY);
    if (!raw) return { lastGlobalWakeupAtMs: 0, accounts: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { lastGlobalWakeupAtMs: 0, accounts: {} };
    return {
      lastGlobalWakeupAtMs: typeof parsed.lastGlobalWakeupAtMs === 'number' && Number.isFinite(parsed.lastGlobalWakeupAtMs)
        ? parsed.lastGlobalWakeupAtMs
        : 0,
      accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {},
    };
  } catch {
    return { lastGlobalWakeupAtMs: 0, accounts: {} };
  }
}

export function saveAutoWakeupState(store: AutoWakeupStateStore): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUTO_WAKEUP_STATE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage errors
  }
}

export interface WakeupCandidateInput {
  accountId: 'current' | string;
  expectedIdentity: string;
  hasDedicatedProxy: boolean;
  isCurrentRunningCli: boolean;
  inferred5h: boolean;
  inferredReset5h: number | null;
  r5: number | null;
  used5h: number;
  rem7d: number;
  known7d: boolean;
}

export type WakeupDecisionState =
  | 'disabled_by_user'
  | 'active_window_running'
  | 'cli_active'
  | 'low_7d_quota'
  | 'auth_blocked'
  | 'backoff_cooldown'
  | 'already_woken'
  | 'standby_idle'
  | 'scheduled'
  | 'ready_to_wake'
  | 'not_expired';

export interface WakeupAccountEvaluation {
  accountId: string;
  expectedIdentity: string;
  decision: WakeupDecisionState;
  unusedStreak: number;
  scheduledAtMs: number | null;
  waitRemainingSec: number;
  updatedRuntime: AutoWakeupAccountRuntime;
}

/**
 * 计算同账号阶梯退避延迟（毫秒）：
 * - streak = 0（上一轮刚真实使用过）：3 ~ 10 分钟随机延迟
 * - streak = 1（已空转 1 轮 5h 未使用）：自动拉长至 25 ~ 60 分钟随机延迟
 * - streak >= 2（主力号 < 阈值触发按需预热）：1.5 ~ 4 分钟短延迟
 */
export function computeSameAccountWakeupDelayMs(
  unusedStreak: number,
  randomFn: () => number = Math.random
): number {
  const r = Math.max(0, Math.min(1, randomFn()));
  if (unusedStreak <= 0) {
    // 180s ~ 600s (3 ~ 10 min)
    return Math.round((180 + r * 420) * 1000);
  }
  if (unusedStreak === 1) {
    // 1500s ~ 3600s (25 ~ 60 min)
    return Math.round((1500 + r * 2100) * 1000);
  }
  // 按需联动预热触发时：90s ~ 240s (1.5 ~ 4 min)
  return Math.round((90 + r * 150) * 1000);
}

/**
 * 计算不同账号之间的最小安全间隔（毫秒）：
 * - 独立专属代理（hasDedicatedProxy=true）：2.5 ~ 5.5 分钟
 * - 共用系统代理（hasDedicatedProxy=false）：6 ~ 13 分钟（同出口 IP 间隔自动翻倍）
 */
export function computeCrossAccountSpacingMs(
  hasDedicatedProxy: boolean,
  randomFn: () => number = Math.random
): number {
  const r = Math.max(0, Math.min(1, randomFn()));
  if (hasDedicatedProxy) {
    return Math.round((150 + r * 180) * 1000);
  }
  return Math.round((360 + r * 420) * 1000);
}

export function evaluateWakeupAccount(
  input: WakeupCandidateInput,
  prevRuntime: AutoWakeupAccountRuntime | undefined,
  config: AutoWakeupConfig,
  activeAccountRem5h: number | null,
  lastGlobalWakeupAtMs: number,
  nowMs: number,
  randomFn: () => number = Math.random
): WakeupAccountEvaluation {
  const runtime: AutoWakeupAccountRuntime = {
    ...defaultAccountWakeupRuntime(),
    ...(prevRuntime ?? {}),
  };

  // 1. 若当前处于活跃 5h 窗口且已用额度 > 1%，说明用户真实使用了该账号，立即清零空转计数
  if (input.r5 && input.r5 * 1000 > nowMs) {
    if (input.used5h > 1) {
      runtime.unusedStreak = 0;
      runtime.usedDuringWokenWindow = true;
    }
    runtime.scheduledForResetSec = null;
    runtime.scheduledAtMs = null;
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'active_window_running',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 2. 用户单独排除了该账号
  if (config.excludedIdentities.some(id => id.toLowerCase() === input.expectedIdentity.toLowerCase())) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'disabled_by_user',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 3. 尚未进入 5h 已重置待激活状态（inferred5h）
  if (!input.inferred5h || !input.inferredReset5h) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'not_expired',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 4. 若刚过期的这个窗口正是上一次自动唤醒开启的窗口，结算空转轮次
  if (runtime.wokenWindowResetSec === input.inferredReset5h) {
    if (runtime.usedDuringWokenWindow || input.used5h > 1) {
      runtime.unusedStreak = 0;
    } else {
      runtime.unusedStreak = Math.min(10, (runtime.unusedStreak || 0) + 1);
    }
    runtime.wokenWindowResetSec = null;
    runtime.usedDuringWokenWindow = false;
  }

  // 5. 同一过期窗口周期严格幂等（绝不重复唤醒同一个 expired reset_at）
  if (runtime.lastWokenForResetSec === input.inferredReset5h) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'already_woken',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 6. 当前活跃账号且 claude.exe 正在运行：无需外部唤醒
  if (input.isCurrentRunningCli) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'cli_active',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 7. 7d 周额度不足 5% 门禁：保护最后周额度，不自动唤醒
  if (input.known7d && input.rem7d <= 5) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'low_7d_quota',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }

  // 8. 401 授权失效或退避冷却门禁
  if (runtime.lastStatus === 'auth_required' && runtime.scheduledForResetSec === input.inferredReset5h) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'auth_blocked',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: null,
      waitRemainingSec: 0,
      updatedRuntime: runtime,
    };
  }
  if (runtime.backoffUntilMs && runtime.backoffUntilMs > nowMs) {
    return {
      accountId: input.accountId,
      expectedIdentity: input.expectedIdentity,
      decision: 'backoff_cooldown',
      unusedStreak: runtime.unusedStreak,
      scheduledAtMs: runtime.backoffUntilMs,
      waitRemainingSec: Math.max(1, Math.ceil((runtime.backoffUntilMs - nowMs) / 1000)),
      updatedRuntime: runtime,
    };
  }

  // 9. 连续空转 >= 2 轮（10h+ 未使用）：进入「按需待命」，仅当主力号 5h 剩余 <= 阈值时才联动唤醒
  if (runtime.unusedStreak >= 2) {
    const needPrewarm =
      activeAccountRem5h !== null &&
      Number.isFinite(activeAccountRem5h) &&
      activeAccountRem5h <= config.prewarmThresholdPct;
    if (!needPrewarm) {
      runtime.scheduledForResetSec = null;
      runtime.scheduledAtMs = null;
      return {
        accountId: input.accountId,
        expectedIdentity: input.expectedIdentity,
        decision: 'standby_idle',
        unusedStreak: runtime.unusedStreak,
        scheduledAtMs: null,
        waitRemainingSec: 0,
        updatedRuntime: runtime,
      };
    }
  }

  // 10. 计算或复用该账号针对当前过期窗口的计划唤醒时间（含同账号阶梯延迟 + 跨账号最小间隔）
  const minCrossAccountNextMs =
    lastGlobalWakeupAtMs > 0
      ? lastGlobalWakeupAtMs + computeCrossAccountSpacingMs(input.hasDedicatedProxy, randomFn)
      : 0;

  if (runtime.scheduledForResetSec !== input.inferredReset5h || !runtime.scheduledAtMs) {
    const baseMs = Math.max(nowMs, input.inferredReset5h * 1000);
    const sameAccountDelayMs = computeSameAccountWakeupDelayMs(runtime.unusedStreak, randomFn);
    runtime.scheduledForResetSec = input.inferredReset5h;
    runtime.scheduledAtMs = Math.max(baseMs + sameAccountDelayMs, minCrossAccountNextMs);
  } else if (minCrossAccountNextMs > runtime.scheduledAtMs) {
    runtime.scheduledAtMs = minCrossAccountNextMs;
  }

  const ready = nowMs >= runtime.scheduledAtMs;
  return {
    accountId: input.accountId,
    expectedIdentity: input.expectedIdentity,
    decision: ready ? 'ready_to_wake' : 'scheduled',
    unusedStreak: runtime.unusedStreak,
    scheduledAtMs: runtime.scheduledAtMs,
    waitRemainingSec: ready ? 0 : Math.max(1, Math.ceil((runtime.scheduledAtMs - nowMs) / 1000)),
    updatedRuntime: runtime,
  };
}

