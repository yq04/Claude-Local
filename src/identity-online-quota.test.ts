/**
 * [INPUT]: Pure online result models, persistent synthetic batch snapshots and mock translations.
 * [OUTPUT]: State, account-fingerprint, cooldown, deadline and display regression checks.
 * [POS]: No network, real identity, native IPC or user-data access.
 * [PROTOCOL]: Keep this suite aligned with src/CLAUDE.md.
 */
import { expect, test } from 'bun:test';
import {
  formatOnlineQuotaStatus,
  formatSubscriptionAndResets,
  ForegroundQuotaScheduler,
  isExpectedCurrentTarget,
  isExpectedSavedTarget,
  buildBatchTargets,
  generateBatchRequestId,
  formatBatchProgress,
  isSuccessfulOnlineResult,
  aggregateBatchProgress,
  summarizeBatchResult,
  isTerminalBatchState,
  isMatchingBatchTarget,
  type OnlineQuotaResult,
} from './identity-online-quota';

test('formatOnlineQuotaStatus correctly resolves status and cooldown remaining', () => {
  const dummyT = (k: string, slots?: Record<string, string | number>) => {
    if (slots && 'v0' in slots) return `${k}:${slots.v0}`;
    return k;
  };

  const nowMs = 1_000_000;

  expect(formatOnlineQuotaStatus({ status: 'updated', updated_windows: ['5h'] }, nowMs, dummyT)).toEqual({
    message: 'quotaOnline.status.updated',
    isError: false,
  });

  expect(
    formatOnlineQuotaStatus(
      { status: 'cooldown', retry_at_ms: nowMs + 45_000 },
      nowMs,
      dummyT
    )
  ).toEqual({
    message: 'quotaOnline.status.cooldownWithTime:45',
    isError: false,
  });

  expect(
    formatOnlineQuotaStatus(
      { status: 'rate_limited', retry_at_ms: nowMs + 120_000 },
      nowMs,
      dummyT
    )
  ).toEqual({
    message: 'quotaOnline.status.rateLimitedWithTime:120',
    isError: true,
  });

  expect(
    formatOnlineQuotaStatus({ status: 'auth_required' }, nowMs, dummyT)
  ).toEqual({
    message: 'quotaOnline.status.authRequired',
    isError: true,
  });
});

test('formatSubscriptionAndResets handles absent data without faking 0 or dates', () => {
  const dummyT = (k: string) => k;

  // Empty metadata
  const empty = formatSubscriptionAndResets(null, 'zh', dummyT);
  expect(empty.hasAnyData).toBe(false);
  expect(empty.emptyNotice).toBe('identityCard.noSubscriptionOrResetData');
  expect(empty.billing).toBeUndefined();
  expect(empty.manualResets).toBeUndefined();

  // Partial: only manual resets present
  const resetsOnly = formatSubscriptionAndResets(
    {
      billing_date: null,
      manual_resets_remaining: 3,
      manual_resets_observed_at_ms: 1700000000000,
    },
    'zh',
    dummyT
  );
  expect(resetsOnly.hasAnyData).toBe(true);
  expect(resetsOnly.billing).toBeUndefined();
  expect(resetsOnly.manualResets?.remaining).toBe(3);
  expect(resetsOnly.manualResets?.observedAtMs).toBe(1700000000000);

  // Partial: only billing date present
  const billingOnly = formatSubscriptionAndResets(
    {
      billing_date_kind: 'next_renewal',
      billing_date: 1735689600, // 2025-01-01
      manual_resets_remaining: null,
      billing_observed_at_ms: 1700000000000,
    },
    'zh',
    dummyT
  );
  expect(billingOnly.hasAnyData).toBe(true);
  expect(billingOnly.manualResets).toBeUndefined(); // MUST NOT BE 0
  expect(billingOnly.billing?.kind).toBe('next_renewal');
  expect(billingOnly.billing?.label).toBe('identityCard.nextRenewal');
  expect(billingOnly.billing?.rawDate).toBe(1735689600);

  // Unknown kind with positive date should NOT display billing
  const unknownKind = formatSubscriptionAndResets(
    {
      billing_date_kind: 'unknown',
      billing_date: 1735689600,
      manual_resets_remaining: null,
    },
    'zh',
    dummyT
  );
  expect(unknownKind.hasAnyData).toBe(false);
  expect(unknownKind.billing).toBeUndefined();

  // 0 manual resets is a valid non-negative integer and MUST be retained
  const zeroResets = formatSubscriptionAndResets(
    {
      billing_date: null,
      manual_resets_remaining: 0,
    },
    'zh',
    dummyT
  );
  expect(zeroResets.hasAnyData).toBe(true);
  expect(zeroResets.manualResets?.remaining).toBe(0);
});

test('subscription metadata preserves independent clocks and marks expired manual reset evidence stale', () => {
  const nowMs = 2_000_000_000_000;
  const fresh = formatSubscriptionAndResets({
    billing_date_kind: 'next_renewal',
    billing_date: 2_100_000_000,
    billing_observed_at_ms: nowMs - 31 * 24 * 60 * 60 * 1000,
    manual_resets_remaining: 2,
    manual_resets_observed_at_ms: nowMs - 1000,
    manual_resets_valid_until: Math.floor(nowMs / 1000) + 3600,
  }, 'en', key => key, nowMs);
  expect(fresh.billing?.stale).toBe(true);
  expect(fresh.manualResets?.stale).toBe(false);
  expect(fresh.manualResets?.usable).toBe(true);
  expect(fresh.manualResets?.observedAtMs).toBe(nowMs - 1000);

  const expired = formatSubscriptionAndResets({
    manual_resets_remaining: 0,
    manual_resets_observed_at_ms: nowMs - 1000,
    manual_resets_valid_until: Math.floor(nowMs / 1000),
  }, 'en', key => key, nowMs);
  expect(expired.manualResets?.remaining).toBe(0);
  expect(expired.manualResets?.stale).toBe(true);
  expect(expired.manualResets?.usable).toBe(false);
});

test('ForegroundQuotaScheduler pauses when background and respects generation invalidation', async () => {
  let simulatedTime = 10_000;
  let isForeground = true;
  let pollCalls: number[] = [];

  const scheduler = new ForegroundQuotaScheduler({
    intervalMs: 180_000,
    isForeground: () => isForeground,
    now: () => simulatedTime,
    poll: async (gen) => {
      pollCalls.push(gen);
      return { status: 'updated' };
    },
  });

  expect(scheduler.isEnabled()).toBe(false);
  expect(pollCalls.length).toBe(0);

  // Enabling when foreground triggers immediate poll
  scheduler.setEnabled(true, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(pollCalls).toEqual([0]);

  // Entering background pauses polling
  isForeground = false;
  scheduler.onForegroundChange();

  // Invalidate generation cancels any pending tokens
  scheduler.invalidate();
  expect(scheduler.getGeneration()).toBe(1);

  // Still background: poll should NOT run
  scheduler.onForegroundChange();
  expect(pollCalls.length).toBe(1);

  // Back to foreground
  isForeground = true;
  scheduler.onForegroundChange();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(pollCalls).toEqual([0, 1]);

  scheduler.destroy();
  expect(scheduler.isEnabled()).toBe(false);
});

test('isExpectedCurrentTarget and isExpectedSavedTarget enforce strict identity matching', () => {
  const currentValid = {
    active: 'acc_123',
    current: { quota_identity: 'fp_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' },
  };

  // Matches exactly
  expect(
    isExpectedCurrentTarget(currentValid, {
      active: 'acc_123',
      expectedIdentity: 'fp_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })
  ).toBe(true);

  // Mismatch when account switched
  expect(
    isExpectedCurrentTarget(currentValid, {
      active: 'acc_456',
      expectedIdentity: 'fp_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })
  ).toBe(false);

  // Mismatch when fingerprint changed
  expect(
    isExpectedCurrentTarget(currentValid, {
      active: 'acc_123',
      expectedIdentity: 'fp_other_fingerprint',
    })
  ).toBe(false);

  // Saved target matching
  const savedState = {
    summaries: {
      saved_1: { quota_identity: 'fp_saved_1_hash' },
      saved_2: { quota_identity: 'fp_saved_2_hash' },
    },
  };
  expect(
    isExpectedSavedTarget(savedState, { targetId: 'saved_1', expectedIdentity: 'fp_saved_1_hash' })
  ).toBe(true);
  expect(
    isExpectedSavedTarget(savedState, { targetId: 'saved_1', expectedIdentity: 'fp_wrong_hash' })
  ).toBe(false);
});

test('batch target builder and request id generator enforce isolation and change detection', () => {
  const id1 = generateBatchRequestId();
  const id2 = generateBatchRequestId();
  expect(id1.length).toBe(32);
  expect(/^[0-9a-f]{32}$/.test(id1)).toBe(true);
  expect(id1).not.toBe(id2);

  const stateA = {
    current: {
      present: true,
      quota_identity: 'a'.repeat(64),
    },
    records: [
      { id: 'rec_1' },
      { id: 'rec_2' },
    ],
    summaries: {
      rec_1: { quota_identity: 'b'.repeat(64) },
      rec_2: { quota_identity: null }, // unverified
    },
  };

  const builtA = buildBatchTargets(stateA);
  expect(builtA.targets.length).toBe(2);
  expect(builtA.targets[0]).toEqual({ account_id: 'current', expected_identity: 'a'.repeat(64) });
  expect(builtA.targets[1]).toEqual({ account_id: 'rec_1', expected_identity: 'b'.repeat(64) });
  expect(builtA.unverifiedCount).toBe(1);

  // Modifying fingerprint changes the fingerprintSetKey
  const stateB = {
    ...stateA,
    summaries: {
      rec_1: { quota_identity: 'c'.repeat(64) },
      rec_2: { quota_identity: null },
    },
  };
  const builtB = buildBatchTargets(stateB);
  expect(builtB.fingerprintSetKey).not.toBe(builtA.fingerprintSetKey);
});

test('formatBatchProgress formats in-progress and complete progress counts', () => {
  const dummyT = (key: string, slots?: Record<string, string | number>) => {
    if (!slots) return key;
    return `${key}:${slots.completed || slots.total || 0}/${slots.success || 0}/${slots.auth || 0}`;
  };

  const inProgress = formatBatchProgress(
    {
      inProgress: true,
      requestId: 'req_1',
      total: 3,
      completed: 2,
      successCount: 1,
      authRequiredCount: 1,
      errorCount: 0,
    },
    dummyT
  );
  expect(inProgress).toBe('quotaOnline.batchProgress:2/1/1');
});

test('buildBatchTargets enforces 64hex validation, deduplicates active record, and preserves stable key on account switch', () => {
  const fpA = 'a'.repeat(64);
  const fpB = 'b'.repeat(64);
  const fpC = 'c'.repeat(64);

  // 3 accounts where current is active and matches rec_1
  const state1 = {
    active: 'rec_1',
    current: { present: true, quota_identity: fpA },
    records: [
      { id: 'rec_1' }, // should be skipped because current.present && id === active
      { id: 'rec_2' },
      { id: 'rec_3' },
    ],
    summaries: {
      rec_1: { quota_identity: fpA },
      rec_2: { quota_identity: fpB },
      rec_3: { quota_identity: fpC },
    },
  };

  const built1 = buildBatchTargets(state1);
  expect(built1.targets.length).toBe(3); // exactly 3 targets, NOT 4!
  expect(built1.targets.map(t => t.account_id)).toEqual(['current', 'rec_2', 'rec_3']);
  expect(built1.unverifiedCount).toBe(0);

  // Switching active to rec_2: targets list changes account_id mapping, but fingerprintSetKey is STABLE
  const state2 = {
    active: 'rec_2',
    current: { present: true, quota_identity: fpB },
    records: [
      { id: 'rec_1' },
      { id: 'rec_2' }, // skipped because active
      { id: 'rec_3' },
    ],
    summaries: {
      rec_1: { quota_identity: fpA },
      rec_2: { quota_identity: fpB },
      rec_3: { quota_identity: fpC },
    },
  };
  const built2 = buildBatchTargets(state2);
  expect(built2.fingerprintSetKey).toBe(built1.fingerprintSetKey); // STABLE across account switches!

  // Malformed non-64hex fingerprints rejected and counted as unverified
  const stateMalformed = {
    active: 'rec_1',
    current: { present: true, quota_identity: 'short_non_hex' }, // malformed
    records: [{ id: 'rec_2' }],
    summaries: { rec_2: { quota_identity: 'g'.repeat(64) } }, // 'g' is not hex!
  };
  const builtMalformed = buildBatchTargets(stateMalformed);
  expect(builtMalformed.targets.length).toBe(0);
  expect(builtMalformed.unverifiedCount).toBe(2);
});

test('aggregateBatchProgress deduplicates repeat events and handles out of order completions', () => {
  const initialSummary = {
    inProgress: true,
    requestId: 'req_1',
    total: 3,
    completed: 0,
    successCount: 0,
    authRequiredCount: 0,
    errorCount: 0,
  };

  let resultsMap: Record<string, OnlineQuotaResult> = {};
  const step1 = aggregateBatchProgress(initialSummary, resultsMap, {
    request_id: 'req_1',
    account_id: 'acc_1',
    expected_identity: 'a'.repeat(64),
    result: { status: 'updated', source: 'oauth', updated_windows: ['5h'] },
    completed: 1,
    total: 3,
  });
  expect(step1.nextSummary.completed).toBe(1);
  expect(step1.nextSummary.successCount).toBe(1);
  resultsMap = step1.updatedResultsMap;

  // Duplicate event for acc_1 must NOT double-increment successCount
  const step1Duplicate = aggregateBatchProgress(step1.nextSummary, resultsMap, {
    request_id: 'req_1',
    account_id: 'acc_1',
    expected_identity: 'a'.repeat(64),
    result: { status: 'updated', source: 'oauth', updated_windows: ['5h'] },
    completed: 1,
    total: 3,
  });
  expect(step1Duplicate.nextSummary.successCount).toBe(1);
  expect(step1Duplicate.isNewResult).toBe(false);

  // Corrupted source must not be treated as success
  expect(isSuccessfulOnlineResult({ status: 'updated', source: 'bad_source' as any })).toBe(false);
  expect(isSuccessfulOnlineResult({ status: 'updated', source: 'oauth', updated_windows: ['5h'] })).toBe(true);
  expect(isSuccessfulOnlineResult({ status: 'updated', source: 'oauth', updated_windows: [] })).toBe(false);
  expect(isSuccessfulOnlineResult({ status: 'cached', source: 'browser' })).toBe(true);
});

test('persistent batch snapshots keep cooldowns separate from fresh updates and expose terminal unrun targets', () => {
  const base = {
    request_id: 'a'.repeat(32),
    targets: [
      {account_id: 'current', expected_identity: '1'.repeat(64)},
      {account_id: 'saved', expected_identity: '2'.repeat(64)},
      {account_id: 'later', expected_identity: '3'.repeat(64)},
    ],
    started_at_ms: 100,
    deadline_at_ms: 120100,
    completed: 3,
    total: 3,
  };
  const summary = summarizeBatchResult({...base, state: 'deadline_exceeded', results: [
    {account_id: 'current', expected_identity: '1'.repeat(64), result: {status: 'updated', updated_windows: ['5h'], verified_at_ms: 110}},
    {account_id: 'saved', expected_identity: '2'.repeat(64), result: {status: 'cooldown', retry_scope: 'oauth', reason: 'auth_required', last_observed_at_ms: 90}},
    {account_id: 'later', expected_identity: '3'.repeat(64), result: {status: 'not_run'}},
  ]});
  expect(summary.successCount).toBe(1);
  expect(summary.cooldownCount).toBe(1);
  expect(summary.errorCount).toBe(0);
  expect(summary.notRunCount).toBe(1);
  expect(summary.inProgress).toBe(false);
  expect(isTerminalBatchState(summary.state)).toBe(true);

  const limited = summarizeBatchResult({...base, state: 'completed', results: [
    {account_id: 'current', expected_identity: '1'.repeat(64), result: {status: 'rate_limited', retry_scope: 'all', reason: 'rate_limited'}},
  ]});
  expect(limited.cooldownCount).toBe(1);
  expect(limited.successCount).toBe(0);
  expect(limited.errorCount).toBe(0);
});

test('batch result acceptance requires a matching frozen fingerprint and whitelisted runtime messages', () => {
  const target = {account_id: 'fixture', expected_identity: 'a'.repeat(64)};
  expect(isMatchingBatchTarget(target, 'A'.repeat(64))).toBe(true);
  expect(isMatchingBatchTarget(target, 'b'.repeat(64))).toBe(false);
  expect(isMatchingBatchTarget(target, null)).toBe(false);
  expect(formatOnlineQuotaStatus({status: 'unavailable', runtime_stage: 'probe', runtime_reason: 'no_compatible_runtime'}, 0, key => key).message)
    .toBe('quotaOnline.runtime.probe.noCompatibleRuntime');
  expect(formatOnlineQuotaStatus({status: 'route_unavailable', reason: 'unsupported_proxy'}, 0, key => key).message)
    .toBe('quotaOnline.reason.unsupportedProxy');
});
