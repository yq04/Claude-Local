// [INPUT]: Fictional independent window evidence and a fixed clock.
// [OUTPUT]: Trusted reset recovery, partial-observation, legacy-source and exhaustion display regressions.
// [POS]: Pure quota-model tests; no native IPC, accounts or ledger writes.
// [PROTOCOL]: Keep src/CLAUDE.md aligned with quota presentation changes.
import {expect, test} from 'bun:test';
import {evaluateQuota, evaluateWeeklyPace, formatElapsedSinceReset} from './identity-quota';

test('expired or missing windows stay unknown instead of manufacturing available quota', () => {
  const now = 2_000_000_000;
  const expired = evaluateQuota({quota_5h_used:100, quota_5h_reset_at:now-1, quota_7d_used:40, quota_7d_reset_at:now+86400}, now)!;
  expect(expired.known5h).toBe(false);
  expect(expired.recommendable).toBe(false);
  expect(expired.r5).toBeNull();
  const partial = evaluateQuota({quota_7d_used:40, quota_7d_reset_at:now+86400}, now)!;
  expect(partial.known5h).toBe(false);
  expect(partial.recommendable).toBe(false);
  const unverified = evaluateQuota({quota_source:'unknown',quota_5h_used:10,quota_7d_used:20}, now)!;
  expect(unverified.known5h).toBe(false);
  expect(unverified.recommendable).toBe(false);
});

test('observed exhaustion remains exhausted and the two quota windows stay distinct', () => {
  const now = 2_000_000_000;
  const exhausted = evaluateQuota({quota_5h_used:100, quota_5h_reset_at:now+1000, quota_7d_used:40, quota_7d_reset_at:now+86400}, now)!;
  expect(exhausted.rem5h).toBe(0);
  expect(exhausted.effectiveRem).toBe(0);
  const weekly = evaluateQuota({quota_5h_used:60, quota_5h_reset_at:now+1000, quota_7d_used:100, quota_7d_reset_at:now+86400}, now)!;
  expect(weekly.rem5h).toBe(40);
  expect(weekly.rem7d).toBe(0);
  expect(weekly.effectiveRem).toBe(0);
});

test('one unknown window does not hide an independently observed weekly quota', () => {
  const now = 2_000_000_000;
  const quota = evaluateQuota({quota_source:'unknown', quota_5h_source:'unknown', quota_7d_source:'server_anchor', quota_5h_used:null, quota_5h_reset_at:now-1, quota_7d_used:38, quota_7d_reset_at:now+86400}, now)!;
  expect(quota.known5h).toBe(false);
  expect(quota.known7d).toBe(true);
  expect(quota.rem7d).toBe(62);
  expect(quota.recommendable).toBe(false);
});

test('explicit unknown per-window evidence overrides a valid aggregate source', () => {
  const now = 2_000_000_000;
  const quota = evaluateQuota({quota_source:'server_anchor', quota_5h_source:'server_anchor', quota_7d_source:'unknown', quota_5h_used:100, quota_5h_reset_at:now+1000, quota_7d_used:0, quota_7d_reset_at:now+86400}, now)!;
  expect(quota.known5h).toBe(true);
  expect(quota.rem5h).toBe(0);
  expect(quota.known7d).toBe(false);
  expect(quota.recommendable).toBe(false);
});

test('missing percentages retain observed reset metadata without inventing availability', () => {
  const now = 2_000_000_000;
  const quota = evaluateQuota({quota_source:'unknown', quota_5h_reset_at:now-1, quota_7d_reset_at:now+86400}, now)!;
  expect(quota).not.toBeNull();
  expect(quota.expired5h).toBe(true);
  expect(quota.r7).toBe(now+86400);
  expect(quota.known5h).toBe(false);
  expect(quota.known7d).toBe(false);
  expect(quota.recommendable).toBe(false);
});

test('a trusted server deadline restores the display exactly at reset without inventing a next window', () => {
  const reset = 2_000_000_000;
  const input = {quota_5h_source:'server_anchor' as const, quota_5h_observed_at_ms:(reset-300)*1000, quota_5h_used:100, quota_5h_reset_at:reset, quota_7d_source:'server_anchor' as const, quota_7d_used:40, quota_7d_reset_at:reset+86400};
  expect(evaluateQuota(input, reset-1)!.rem5h).toBe(0);
  const recovered = evaluateQuota(input, reset)!;
  expect(recovered.known5h).toBe(true);
  expect(recovered.rem5h).toBe(100);
  expect(recovered.used5h).toBe(0);
  expect(recovered.source5h).toBe('reset_inferred');
  expect(recovered.r5).toBeNull();
  expect(recovered.rem7d).toBe(60);
  expect(recovered.recommendable).toBe(false);
  expect(evaluateQuota(input, reset+86400)!.r5).toBeNull();
});

test('native inferred recovery remains visible and a new real window replaces it', () => {
  const now = 2_000_000_000;
  const inferred = {quota_5h_source:'reset_inferred' as const, quota_5h_observed_at_ms:(now-300)*1000, quota_5h_used:0, quota_5h_reset_at:now-1};
  expect(evaluateQuota(inferred, now)!.rem5h).toBe(100);
  expect(evaluateQuota(inferred, now)!.known5h).toBe(true);
  const actual = evaluateQuota({...inferred, quota_5h_source:'server_anchor', quota_5h_observed_at_ms:now*1000, quota_5h_used:23, quota_5h_reset_at:now+18000}, now)!;
  expect(actual.source5h).toBe('server_anchor');
  expect(actual.rem5h).toBe(77);
  expect(actual.r5).toBe(now+18000);
});

test('expired local estimates and invalid server evidence cannot imply recovered quota', () => {
  const now = 2_000_000_000;
  const input = {quota_5h_used:100, quota_5h_reset_at:now-1, quota_5h_observed_at_ms:(now-100)*1000};
  expect(evaluateQuota({...input, quota_5h_source:'local_estimate'}, now)!.known5h).toBe(false);
  expect(evaluateQuota({...input, quota_5h_source:'server_anchor', quota_5h_observed_at_ms:null}, now)!.known5h).toBe(false);
  expect(evaluateQuota({...input, quota_5h_source:'server_anchor', quota_5h_observed_at_ms:now*1000}, now)!.known5h).toBe(false);
  expect(evaluateQuota({...input, quota_5h_source:'unknown'}, now)!.known5h).toBe(false);
  expect(evaluateQuota({...input, quota_5h_source:'reset_inferred', quota_5h_used:100}, now)!.known5h).toBe(false);
});

test('weekly pace calculation suppresses first-24h false alarms and flags ahead-of-pace burn', () => {
  const now = 2_000_000_000;
  // Day 1 (12h elapsed out of 7d -> 6.5d remaining): suppressed must be true even if 30% used
  const day1 = evaluateWeeklyPace(30, now + 6.5 * 86400, now)!;
  expect(day1.suppressed).toBe(true);
  expect(day1.ahead).toBe(false);

  // Halfway through 7d (3.5d remaining -> 50% elapsed): 70% used (+20%) flags ahead
  const ahead = evaluateWeeklyPace(70, now + 3.5 * 86400, now)!;
  expect(ahead.suppressed).toBe(false);
  expect(ahead.expectedUsedPct).toBe(50);
  expect(ahead.expectedRemPct).toBe(50);
  expect(ahead.deltaUsedPct).toBe(20);
  expect(ahead.ahead).toBe(true);

  // Halfway through 7d: 45% used (-5%) stays balanced
  const balanced = evaluateWeeklyPace(45, now + 3.5 * 86400, now)!;
  expect(balanced.ahead).toBe(false);

  expect(formatElapsedSinceReset(now - 8100, now)).toBe('2h 15m');
  expect(formatElapsedSinceReset(now + 60, now)).toBe('');
});
