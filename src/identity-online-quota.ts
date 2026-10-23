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
