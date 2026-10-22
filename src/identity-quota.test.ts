// [INPUT]: Fictional independent window evidence and a fixed clock.
// [OUTPUT]: Expiry, partial-observation, legacy-source and exhaustion display regressions.
// [POS]: Pure quota-model tests; no native IPC, accounts or ledger writes.
// [PROTOCOL]: Keep src/CLAUDE.md aligned with quota presentation changes.
import {expect, test} from 'bun:test';
import {evaluateQuota} from './identity-quota';

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
