import {expect, test} from 'bun:test';
import {
  clearAccountCooldown,
  computeDynamicSwitchMarginPct,
  computeWindowPaceDelta,
  defaultSmartRelayConfig,
  evaluateSmartRelay,
  formatTruthfulPercent,
  getSmartRelayConfig,
  isAccountInCooldown,
  meetsDynamicSwitchMargin,
  noteRelayAccountRateLimited,
  noteRelayAccountSwitch,
  resetSmartRelayConfig,
  setAccountCooldown,
  summarizeRelayPool,
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

test('inferred7d rested accounts classify as Tier 0 (ready) with gentle tie-breaker and inferred5h has inferred === false', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    {
      id: 'rested-7d',
      name: 'Rested 7d Account',
      email: 'rested7d@example.invalid',
      plan: 'pro',
      auth_status: 'valid',
      isCurrent: false,
      listIndex: 1,
      summary: {
        quota_source: 'server_anchor',
        quota_observed_at_ms: (NOW - 3 * DAY) * 1000,
        quota_5h_used: 80,
        quota_5h_reset_at: NOW - 2 * DAY,
        quota_7d_used: 95,
        quota_7d_reset_at: NOW - HOUR, // 7d window already reset -> inferred7d = true, 100% remaining
      },
    },
    {
      id: 'rested-5h-active-7d',
      name: 'Rested 5h Account',
      email: 'rested5h@example.invalid',
      plan: 'pro',
      auth_status: 'valid',
      isCurrent: false,
      listIndex: 2,
      summary: {
        quota_source: 'server_anchor',
        quota_observed_at_ms: (NOW - 6 * HOUR) * 1000,
        quota_5h_used: 85,
        quota_5h_reset_at: NOW - HOUR, // 5h rested -> 100% rem5h, inferred5h = true
        quota_7d_used: 0,
        quota_7d_reset_at: NOW + 4 * DAY, // active 7d anchor -> 100% rem7d, inferred7d = false
      },
    },
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );

  const c7d = evaluation.candidates.find(c => c.id === 'rested-7d')!;
  const c5h = evaluation.candidates.find(c => c.id === 'rested-5h-active-7d')!;

  expect(c7d.tier).toBe(0);
  expect(c7d.rem7d).toBe(100);
  expect(c7d.rem5h).toBe(100);
  expect(c7d.inferred).toBe(true);

  expect(c5h.tier).toBe(0);
  expect(c5h.rem5h).toBe(100);
  expect(c5h.inferred).toBe(false);

  // Tie-breaker prefers live-anchored 7d (inferred === false) over inferred7d (inferred === true) when effectiveRem is equal
  expect(evaluation.recommended?.id).toBe('rested-5h-active-7d');
});

test('affinityMode session suppresses preferred_recovered while current is healthy (< 95%) and manual always sets shouldRelayNow === false', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current-active', 0, 40, 35, 3, 4, true), // 40% used (< 95%)
    makeAccount('preferred-star', 1, 10, 20, 4, 5, false), // Recovered to 20% used (< 90%)
  ];

  const evalSession = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      affinityMode: 'session',
      preferredAccountId: 'preferred-star',
      returnToPreferred: true,
      preferredReturnThresholdPct: 90,
    },
    NOW,
  );
  expect(evalSession.relayTriggerKind).not.toBe('preferred_recovered');
  expect(evalSession.shouldRelayNow).toBe(false);

  // In manual mode, preferred_recovered and recommended are still computed for inspection, but shouldRelayNow is false
  const evalManual = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      affinityMode: 'manual',
      preferredAccountId: 'preferred-star',
      returnToPreferred: true,
      preferredReturnThresholdPct: 90,
    },
    NOW,
  );
  expect(evalManual.recommended?.id).toBe('preferred-star');
  expect(evalManual.relayTriggerKind).toBe('preferred_recovered');
  expect(evalManual.shouldRelayNow).toBe(false);
});

test('summarizeRelayPool accurately aggregates ready, low, spent, unavailable, and excluded accounts', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('ready-1', 0, 20, 30, 3, 4, true), // Tier 0: rem5h=80, rem7d=70
    makeAccount('ready-2', 1, 40, 50, 4, 5, false), // Tier 0: rem5h=60, rem7d=50
    makeAccount('low-1', 2, 92, 40, 2, 3, false), // Tier 1: rem5h=8, rem7d=60, r5 = NOW + 2h
    makeAccount('spent-1', 3, 99, 60, 1, 2, false), // Tier 2: rem5h=1, rem7d=40, r5 = NOW + 1h (soonest!)
    {
      ...makeAccount('expired-1', 4, 10, 10, 3, 4, false),
      auth_status: 'expired', // Tier 3: unavailable
    },
    makeAccount('excluded-1', 5, 0, 0, 4, 6, false), // Excluded from pool
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      excludedAccountIds: ['excluded-1'],
    },
    NOW,
  );

  const summary = summarizeRelayPool(evaluation.candidates, NOW);
  expect(summary.includedCount).toBe(5);
  expect(summary.readyCount).toBe(2);
  expect(summary.lowCount).toBe(1);
  expect(summary.spentCount).toBe(1);
  expect(summary.unavailableCount).toBe(1);
  expect(summary.cooldownCount).toBe(0);
  expect(summary.avg5hRemainingPct).toBe(Math.round((80 + 60 + 8 + 1) / 4));
  expect(summary.avgRem7dPct).toBe(Math.round((70 + 50 + 60 + 40) / 4));
  expect(summary.soonestResetSec).toBe(NOW + 1 * HOUR);
});

test('formatTruthfulPercent never rounds 99.0%..99.99% up to 100% or 0.01%..0.99% down to 0%', () => {
  expect(formatTruthfulPercent(null)).toBe('--%');
  expect(formatTruthfulPercent(undefined)).toBe('--%');
  expect(formatTruthfulPercent(Number.NaN)).toBe('--%');
  expect(formatTruthfulPercent(0)).toBe('0%');
  expect(formatTruthfulPercent(-5)).toBe('0%');
  expect(formatTruthfulPercent(0.04)).toBe('0.1%');
  expect(formatTruthfulPercent(0.4)).toBe('0.4%');
  expect(formatTruthfulPercent(0.94)).toBe('0.9%');
  expect(formatTruthfulPercent(50.4)).toBe('50%');
  expect(formatTruthfulPercent(98.6)).toBe('99%');
  expect(formatTruthfulPercent(99.0)).toBe('99.0%');
  expect(formatTruthfulPercent(99.4)).toBe('99.4%');
  expect(formatTruthfulPercent(99.91)).toBe('99.9%');
  expect(formatTruthfulPercent(99.99)).toBe('99.9%');
  expect(formatTruthfulPercent(100)).toBe('100%');
  expect(formatTruthfulPercent(105)).toBe('100%');
});

test('computeWindowPaceDelta computes burn-pace status and deltaPct across 5h and 7d windows', () => {
  expect(computeWindowPaceDelta(null, NOW + HOUR, NOW, 5).status).toBe('unknown');
  expect(computeWindowPaceDelta(50, null, NOW, 5).status).toBe('unknown');
  expect(computeWindowPaceDelta(50, NOW - 10, NOW, 5).status).toBe('unknown');

  // 5h window: 2h remaining -> 3h elapsed (60% elapsed). Used 80% -> delta +20% ('ahead')
  const fast5h = computeWindowPaceDelta(80, NOW + 2 * HOUR, NOW, 5);
  expect(fast5h.status).toBe('ahead');
  expect(fast5h.elapsedPct).toBeCloseTo(60, 1);
  expect(fast5h.deltaPct).toBe(20);

  // 5h window: 2h remaining (60% elapsed). Used 55% -> delta -5% ('on_track')
  const steady5h = computeWindowPaceDelta(55, NOW + 2 * HOUR, NOW, 5);
  expect(steady5h.status).toBe('on_track');
  expect(steady5h.deltaPct).toBe(-5);

  // 7d (168h) window: 84h remaining (50% elapsed). Used 20% -> delta -30% ('behind')
  const reserve7d = computeWindowPaceDelta(20, NOW + 84 * HOUR, NOW, 168);
  expect(reserve7d.status).toBe('behind');
  expect(reserve7d.deltaPct).toBe(-30);
});

test('computeDynamicSwitchMarginPct and meetsDynamicSwitchMargin enforce anti-ping-pong hysteresis', () => {
  expect(computeDynamicSwitchMarginPct(0)).toBe(0);
  expect(computeDynamicSwitchMarginPct(1)).toBe(2); // min(2, 4) = 2
  expect(computeDynamicSwitchMarginPct(2)).toBe(4); // min(4, 5) = 4
  expect(computeDynamicSwitchMarginPct(10)).toBe(13); // min(20, 13) = 13
  expect(computeDynamicSwitchMarginPct(98)).toBe(100);

  const active = {rem5h: 10, rem7d: 50};
  expect(meetsDynamicSwitchMargin({rem5h: 12, rem7d: 60}, active)).toBe(false);
  expect(meetsDynamicSwitchMargin({rem5h: 13, rem7d: 52}, active)).toBe(false);
  expect(meetsDynamicSwitchMargin({rem5h: 13, rem7d: 53}, active)).toBe(true);
});

test('account cooldown jail demotes candidate to Tier 3 with relay.reason.cooldown and updates cooldownCount', () => {
  resetSmartRelayConfig();
  const cfgWithCooldown = setAccountCooldown('acc-cool', NOW + 15 * 60);
  expect(isAccountInCooldown(cfgWithCooldown, 'acc-cool', NOW)).toBe(true);
  expect(isAccountInCooldown(cfgWithCooldown, 'acc-cool', NOW + 16 * 60)).toBe(false);

  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('acc-cool', 1, 5, 10, 4, 6, false), // Would be best, but in cooldown!
    makeAccount('acc-ready', 2, 30, 30, 3, 5, false),
  ];

  const evalDuringCooldown = evaluateSmartRelay(
    accounts,
    {...cfgWithCooldown, enabled: true, strategy: 'least_used'},
    NOW,
  );
  const coolCand = evalDuringCooldown.candidates.find(c => c.id === 'acc-cool')!;
  expect(coolCand.inCooldown).toBe(true);
  expect(coolCand.cooldownRemainingSec).toBe(15 * 60);
  expect(coolCand.tier).toBe(3);
  expect(coolCand.reasonKey).toBe('relay.reason.cooldown');
  expect(coolCand.reasonParams).toEqual({mins: 15});
  expect(evalDuringCooldown.recommended?.id).toBe('acc-ready');

  const poolSummary = summarizeRelayPool(evalDuringCooldown.candidates, NOW);
  expect(poolSummary.cooldownCount).toBe(1);
  expect(poolSummary.unavailableCount).toBe(1);

  const cfgCleared = clearAccountCooldown('acc-cool');
  expect(isAccountInCooldown(cfgCleared, 'acc-cool', NOW)).toBe(false);
  resetSmartRelayConfig();
});

test('noReturnAccountId one-way lock prevents bouncing back to switched-out account until its 5h window resets', () => {
  resetSmartRelayConfig();
  updateSmartRelayConfig({enabled: true, strategy: 'least_used'});
  const resetAt = NOW + 2 * HOUR;
  const lockedCfg = noteRelayAccountSwitch('acc-from', 'acc-to', resetAt);
  expect(lockedCfg.noReturnAccountId).toBe('acc-from');
  expect(lockedCfg.noReturnUntilSec).toBe(resetAt);

  const accounts: RelayAccountInput[] = [
    makeAccount('acc-to', 0, 99, 40, 4, 4, true), // Now spent
    makeAccount('acc-from', 1, 10, 10, 4, 5, false), // Higher rem, but locked until resetAt
    makeAccount('acc-third', 2, 40, 40, 4, 4, false), // Unlocked Tier 0 alternative
  ];

  // Before 5h reset: skips 'acc-from' in favor of 'acc-third'
  const evalBeforeReset = evaluateSmartRelay(accounts, lockedCfg, NOW + HOUR);
  expect(evalBeforeReset.recommended?.id).toBe('acc-third');

  // After 5h reset: lock expires, 'acc-from' is eligible again
  const evalAfterReset = evaluateSmartRelay(accounts, lockedCfg, resetAt + 1);
  expect(evalAfterReset.recommended?.id).toBe('acc-from');

  // Switching back to noReturnAccountId clears the lock
  const unlockedCfg = noteRelayAccountSwitch('acc-to', 'acc-from');
  expect(unlockedCfg.noReturnAccountId).toBeNull();
  expect(unlockedCfg.noReturnUntilSec).toBe(0);
  resetSmartRelayConfig();
});

test('evaluateSmartRelay suppresses better_candidate ping-pong when saved candidate fails meetsDynamicSwitchMargin', () => {
  // Active has rem5h=50, rem7d=50 -> requires candidate rem5h >= 53 and rem7d >= 53
  const accountsFailMargin: RelayAccountInput[] = [
    makeAccount('current', 0, 50, 50, 3, 4, true), // rem5h=50, rem7d=50
    makeAccount('marginal-saved', 1, 48, 49, 3, 4, false), // rem5h=52, rem7d=51 (fails +3% margin)
  ];

  const evalSuppressed = evaluateSmartRelay(
    accountsFailMargin,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  expect(evalSuppressed.shouldRelayNow).toBe(false);
  expect(evalSuppressed.relayTriggerKind).toBeNull();
  expect(evalSuppressed.recommended).toBeNull();
  expect(evalSuppressed.standbyCandidate?.id).toBe('marginal-saved');

  // Saved candidate with rem5h=60, rem7d=60 satisfies meetsDynamicSwitchMargin
  const accountsPassMargin: RelayAccountInput[] = [
    makeAccount('current', 0, 50, 50, 3, 4, true),
    makeAccount('clear-winner', 1, 40, 40, 3, 4, false), // rem5h=60, rem7d=60 (>= 53)
  ];
  const evalBetter = evaluateSmartRelay(
    accountsPassMargin,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  expect(evalBetter.shouldRelayNow).toBe(false);
  expect(evalBetter.relayTriggerKind).toBe('better_candidate');
  expect(evalBetter.recommended?.id).toBe('clear-winner');
  expect(evalBetter.standbyCandidate?.id).toBe('clear-winner');
});

test('Magpie WeekLow rule promotes 7d-low accounts with healthy 5h headroom to Tier 0 in smart/pace modes and suppresses 24h weekly lead-in pace noise', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('week-low-perishable', 1, 20, 92, 3, 1, false), // used5h=20 (<90), used7d=92 (90..97) -> WeekLow!
    makeAccount('fresh-later', 2, 10, 10, 4, 6, false),
  ];

  const evalSmart = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'},
    NOW,
  );
  expect(evalSmart.candidates.find(c => c.id === 'week-low-perishable')?.tier).toBe(0);
  expect(evalSmart.recommended?.id).toBe('week-low-perishable');

  // In least_used mode, week-low-perishable remains Tier 1 reserve
  const evalLeast = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  expect(evalLeast.candidates.find(c => c.id === 'week-low-perishable')?.tier).toBe(1);
  expect(evalLeast.recommended?.id).toBe('fresh-later');

  // 24h weekly lead-in silence: 12h elapsed out of 168h (156h remaining), 25% used -> suppressed to 'on_track'
  const leadIn7d = computeWindowPaceDelta(25, NOW + 156 * HOUR, NOW, 168);
  expect(leadIn7d.status).toBe('on_track');

  // Starving 5h (rem5h=5) with equal 7d (rem7d=80) passes meetsDynamicSwitchMargin when candidate has rem5h=80, rem7d=80
  expect(meetsDynamicSwitchMargin({rem5h: 80, rem7d: 80}, {rem5h: 5, rem7d: 80})).toBe(true);
});

test('noteRelayAccountRateLimited places account into cooldown and demotes sunkOrder when sink_to_end is enabled', () => {
  resetSmartRelayConfig();
  updateSmartRelayConfig({enabled: true, strategy: 'ordered', rateLimitMode: 'sink_to_end'});

  const retryAtMs = (NOW + 600) * 1000;
  const cfgAfterRl = noteRelayAccountRateLimited('acc-rl', retryAtMs, NOW);
  expect(isAccountInCooldown(cfgAfterRl, 'acc-rl', NOW)).toBe(true);
  expect(cfgAfterRl.cooldownUntilSec['acc-rl']).toBe(NOW + 600);
  expect(cfgAfterRl.sunkOrder['acc-rl']).toBe(1);

  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('acc-rl', 1, 10, 10, 4, 5, false),
    makeAccount('acc-healthy', 2, 30, 30, 4, 5, false),
  ];
  const evalRl = evaluateSmartRelay(accounts, cfgAfterRl, NOW);
  const rlCandidate = evalRl.candidates.find(c => c.id === 'acc-rl')!;
  expect(rlCandidate.inCooldown).toBe(true);
  expect(rlCandidate.tier).toBe(3);
  expect(evalRl.recommended?.id).toBe('acc-healthy');

  // Default 15-minute cooldown when retryAtMs is omitted
  const cfgDefaultRl = noteRelayAccountRateLimited('acc-rl-default', undefined, NOW);
  expect(cfgDefaultRl.cooldownUntilSec['acc-rl-default']).toBe(NOW + 15 * 60);
  resetSmartRelayConfig();
});

test('SoonReset (<=24h) harvest bonus prioritizes accounts with >=15% 7d and >10% 5h resetting within 24h', () => {
  // Smart mode: account A resets in 12h with only 11% 7d (<15% crumb), account B resets in 18h with 40% 7d (>=15% harvestable!)
  const smartAccounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    {
      ...makeAccount('crumb-12h', 1, 20, 89, 3, 1, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 89, // rem7d = 11 (< 15, no SoonReset bonus)
        quota_7d_reset_at: NOW + 12 * HOUR,
      },
    },
    {
      ...makeAccount('harvest-18h', 2, 20, 60, 3, 1, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20, // rem5h = 80 (> 10)
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 60, // rem7d = 40 (>= 15)
        quota_7d_reset_at: NOW + 18 * HOUR, // <= 86400s -> soonReset24h = true!
      },
    },
  ];
  const evalSmartHarvest = evaluateSmartRelay(
    smartAccounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'},
    NOW,
  );
  expect(evalSmartHarvest.candidates.find(c => c.id === 'crumb-12h')?.soonReset24h).toBe(false);
  expect(evalSmartHarvest.candidates.find(c => c.id === 'harvest-18h')?.soonReset24h).toBe(true);
  expect(evalSmartHarvest.recommended?.id).toBe('harvest-18h');

  // Least-used tie-breaker: equal effectiveRem (70%) breaks tie in favor of <=24h reset over 5-day reset
  const tieAccounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('later-5d', 1, 30, 30, 3, 5, false), // effectiveRem = 70, resets in 5d
    makeAccount('soon-24h', 2, 30, 30, 3, 1, false), // effectiveRem = 70, resets in 24h (<= 86400s)
  ];
  const evalTie = evaluateSmartRelay(
    tieAccounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  expect(evalTie.recommended?.id).toBe('soon-24h');
});
