import {expect, test} from 'bun:test';
import {
  defaultSmartRelayConfig,
  evaluateSmartRelay,
  getSmartRelayConfig,
  noteRelayAccountSwitch,
  resetSmartRelayConfig,
  updateSmartRelayConfig,
  type RelayAccountInput,
} from './smart-relay-model';

const NOW = 1_780_000_000;
const HOUR = 3600;
const DAY = 86400;

function makeAccount(
  id: string,
  listIndex: number,
  used5h: number,
  used7d: number,
  r5OffsetHours = 3,
  r7OffsetDays = 5,
  isCurrent = false,
): RelayAccountInput {
  return {
    id,
    name: `Account ${id}`,
    email: `${id}@example.invalid`,
    plan: 'pro',
    auth_status: 'valid',
    isCurrent,
    listIndex,
    summary: {
      quota_source: 'server_anchor',
      quota_5h_used: used5h,
      quota_5h_reset_at: NOW + r5OffsetHours * HOUR,
      quota_7d_used: used7d,
      quota_7d_reset_at: NOW + r7OffsetDays * DAY,
    },
  };
}

test('smart relay config defaults to disabled (OFF) and sanitizes inputs safely', () => {
  resetSmartRelayConfig();
  expect(getSmartRelayConfig()).toEqual(defaultSmartRelayConfig);
  expect(getSmartRelayConfig().enabled).toBe(false);

  const updated = updateSmartRelayConfig({
    enabled: true,
    strategy: 'pace',
    rateLimitMode: 'sink_to_end',
    affinityMode: 'session',
    spentThresholdPct: 95,
    preferredAccountId: 'acc-1',
    excludedAccountIds: ['acc-2', 'acc-2'],
  });
  expect(updated.enabled).toBe(true);
  expect(updated.strategy).toBe('pace');
  expect(updated.rateLimitMode).toBe('sink_to_end');
  expect(updated.affinityMode).toBe('session');
  expect(updated.spentThresholdPct).toBe(95);
  expect(updated.preferredAccountId).toBe('acc-1');
  expect(updated.excludedAccountIds).toEqual(['acc-2']);

  resetSmartRelayConfig();
});

test('Magpie Smart strategy prioritizes soonest 7d renewal hour within Tier 0 and holds Tier 1 in reserve', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true), // Spent (99% >= 98%)
    makeAccount('fresh-later', 1, 10, 15, 4, 6, false), // 85% left, resets in 6 days
    makeAccount('expiring-sooner', 2, 20, 35, 3, 1, false), // 65% left, resets in 1 day (soonest 7d renewal!)
    makeAccount('low-reserve', 3, 92, 20, 1, 1, false), // Tier 1 (92% >= 90%), held in reserve
  ];

  const evalSmart = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'},
    NOW,
  );
  expect(evalSmart.shouldRelayNow).toBe(true);
  expect(evalSmart.relayTriggerKind).toBe('current_spent');
  expect(evalSmart.recommended?.id).toBe('expiring-sooner');
  expect(evalSmart.candidates.find(c => c.id === 'low-reserve')?.tier).toBe(1);
});

test('Magpie Pace (重置前用完) strategy ranks highest weekly burn pace first in 10% bands', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 98, 50, 2, 4, true),
    makeAccount('full-7days', 1, 0, 0, 4, 7, false), // 100% / 168h = 0.59%/h
    makeAccount('high-pace-soon', 2, 20, 30, 4, 1, false), // 70% / 24h = 2.91%/h (much higher pace!)
  ];

  const evalPace = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'pace'},
    NOW,
  );
  expect(evalPace.recommended?.id).toBe('high-pace-soon');
  expect(evalPace.recommended?.reasonKey).toBe('relay.reason.burnBeforeReset');

  // Compare with least_used (用量少的优先) which picks 100% remaining ('full-7days')
  const evalLeastUsed = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  expect(evalLeastUsed.recommended?.id).toBe('full-7days');
});

test('Preferred account (首选) hysteresis return triggers when preferred account recovers below threshold', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('backup-active', 0, 30, 30, 3, 4, true),
    makeAccount('primary-star', 1, 15, 25, 4, 5, false), // Recovered to 25% used (< 90% threshold)
    makeAccount('other-spare', 2, 0, 0, 4, 6, false),
  ];

  const evalReturn = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      strategy: 'least_used',
      preferredAccountId: 'primary-star',
      returnToPreferred: true,
      preferredReturnThresholdPct: 90,
    },
    NOW,
  );
  expect(evalReturn.shouldRelayNow).toBe(true);
  expect(evalReturn.relayTriggerKind).toBe('preferred_recovered');
  expect(evalReturn.recommended?.id).toBe('primary-star');
});

test('Sink-to-end (排到最后) and Rotate (轮流) demote switched-out accounts', () => {
  resetSmartRelayConfig();
  updateSmartRelayConfig({enabled: true, strategy: 'ordered', rateLimitMode: 'sink_to_end'});
  const afterSwitch = noteRelayAccountSwitch('acc-a', 'acc-b');

  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 50, 2, 4, true),
    makeAccount('acc-a', 1, 20, 20, 3, 4, false), // Was switched out -> sunk to end!
    makeAccount('acc-b', 2, 30, 30, 3, 4, false),
  ];
  const evalSink = evaluateSmartRelay(accounts, afterSwitch, NOW);
  expect(evalSink.recommended?.id).toBe('acc-b');
  resetSmartRelayConfig();
});
