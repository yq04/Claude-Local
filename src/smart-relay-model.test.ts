import {expect, test} from 'bun:test';
import {summarizeCleanroomPipelineStages, type Progress} from './cleaner-activity';
import {evaluateQuota} from './identity-quota';
import {computeSubscriptionRoi} from './usage-model';
import {
  CANONICAL_MANUAL_PLANS,
  RELAY_CLI_EFFORTS,
  RELAY_CLI_MODELS,
  RELAY_HANDOFF_MODES,
  RELAY_SPENT_THRESHOLDS,
  RELAY_STRATEGIES,
  buildSubagentMarkdownTemplate,
  canSyncNativeSmartRelay,
  clearAccountCooldown,
  clearRelayLaunchDirs,
  computeDynamicSwitchMarginPct,
  computeResetCardExpiryUrgency,
  computeWindowBurnEta,
  computeWindowPaceDelta,
  defaultSmartRelayConfig,
  evaluateSmartRelay,
  extractResetCardInfo,
  findSameExitClusterWarning,
  flushNativeSmartRelaySync,
  formatLaunchDirChip,
  formatRelayCliModelEffortArgs,
  formatTruthfulPercent,
  getCliDefaultProxy,
  getLastNativeSmartRelaySyncError,
  getRelayLaunchDirs,
  getSmartRelayConfig,
  hydrateSmartRelayConfig,
  isAccountInCooldown,
  isSlotBrowserProxyAligned,
  meetsDynamicSwitchMargin,
  normalizePlanSlug,
  noteRelayAccountRateLimited,
  noteRelayAccountSwitch,
  recordRelayLaunchDir,
  removeRelayLaunchDir,
  resetSmartRelayConfig,
  sanitizeRelayCliEffort,
  sanitizeRelayCliModel,
  sanitizeSmartRelayConfig,
  setAccountCooldown,
  subscribeSmartRelayConfig,
  summarizeRelayPool,
  syncNativeSmartRelayConfigIfLive,
  updateSmartRelayConfig,
  validateSlotHttpProxy,
  type HandoffItem,
  type HandoffSummary,
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

test('RELAY_STRATEGIES includes reset_harvest and config extends autoContinueOnRelay, maxSameExitConcurrency, slotProxies', () => {
  expect(RELAY_STRATEGIES).toEqual(['smart', 'reset_harvest', 'pace', 'least_used', 'ordered', 'rotate']);
  expect(defaultSmartRelayConfig.autoContinueOnRelay).toBe(false);
  expect(defaultSmartRelayConfig.maxSameExitConcurrency).toBe(1);
  expect(defaultSmartRelayConfig.slotProxies).toEqual({});

  const sanitized = sanitizeSmartRelayConfig({
    strategy: 'reset_harvest',
    autoContinueOnRelay: true,
    maxSameExitConcurrency: 4,
    slotProxies: {
      'acc-ok': ' HTTP://LOCALHOST:7901/ ',
      'acc-socks': 'socks5://127.0.0.1:7899',
      'acc-bad': 'not-a-url',
      'acc-empty': '   ',
    },
  });
  expect(sanitized.strategy).toBe('reset_harvest');
  expect(sanitized.autoContinueOnRelay).toBe(true);
  expect(sanitized.maxSameExitConcurrency).toBe(4);
  expect(sanitized.slotProxies).toEqual({'acc-ok': 'http://localhost:7901'});

  const invalidConcurrency = sanitizeSmartRelayConfig({maxSameExitConcurrency: 99});
  expect(invalidConcurrency.maxSameExitConcurrency).toBe(1);
  expect(sanitizeSmartRelayConfig({maxSameExitConcurrency: 0}).maxSameExitConcurrency).toBe(1);
  expect(sanitizeSmartRelayConfig({maxSameExitConcurrency: 5}).maxSameExitConcurrency).toBe(5);

  resetSmartRelayConfig();
  const hydrated = hydrateSmartRelayConfig({
    enabled: true,
    strategy: 'reset_harvest',
    autoContinueOnRelay: true,
    maxSameExitConcurrency: 3,
    slotProxies: {'acc-1': 'http://127.0.0.1:7905'},
  });
  expect(getSmartRelayConfig()).toEqual(hydrated);
  resetSmartRelayConfig();
});

test('validateSlotHttpProxy enforces strict http://host:port and rejects socks5:// or control characters', () => {
  expect(validateSlotHttpProxy('')).toEqual({ok: true, normalized: ''});
  expect(validateSlotHttpProxy('   ')).toEqual({ok: true, normalized: ''});
  expect(validateSlotHttpProxy('http://127.0.0.1:7899')).toEqual({
    ok: true,
    normalized: 'http://127.0.0.1:7899',
  });
  expect(validateSlotHttpProxy('  HTTP://LOCALHOST:80/  ')).toEqual({
    ok: true,
    normalized: 'http://localhost:80',
  });
  expect(validateSlotHttpProxy('http://[::1]:7902')).toEqual({
    ok: true,
    normalized: 'http://[::1]:7902',
  });

  expect(validateSlotHttpProxy('socks5://127.0.0.1:7899')).toEqual({
    ok: false,
    normalized: '',
    errorKey: 'relay.proxy.socks5Forbidden',
  });
  expect(validateSlotHttpProxy('SOCKS5H://127.0.0.1:7899')).toEqual({
    ok: false,
    normalized: '',
    errorKey: 'relay.proxy.socks5Forbidden',
  });

  for (const invalid of [
    'https://127.0.0.1:7899',
    '127.0.0.1:7899',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:7899/path',
    'http://user:pass@127.0.0.1:7899',
    'http://127.0.0.1:7899\n',
  ]) {
    expect(validateSlotHttpProxy(invalid)).toEqual({
      ok: false,
      normalized: '',
      errorKey: 'relay.proxy.invalidHttp',
    });
  }
});

test('reset_harvest strategy prioritizes positive reset cards by earliest deadline, urgency, and smart fallback', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 50, 2, 4, true),
    makeAccount('no-card-soon', 1, 10, 20, 2, 1, false),
    {
      ...makeAccount('grant-72h-1card', 2, 15, 25, 4, 6, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 15,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 25,
        quota_7d_reset_at: NOW + 6 * DAY,
        manual_resets_remaining: 1,
        manual_resets_grants: [
          {resets_left: 1, ends_at: NOW + 72 * HOUR},
          {resets_left: 0, ends_at: NOW + 10 * HOUR}, // depleted grant ignored
        ],
      },
    },
    {
      ...makeAccount('grant-48h-1card', 3, 20, 40, 4, 6, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 40,
        quota_7d_reset_at: NOW + 6 * DAY,
        manual_resets_remaining: 1,
        manual_resets_grant_ends_at: NOW + 48 * HOUR, // fallback field
      },
    },
    {
      ...makeAccount('grant-48h-2cards', 4, 20, 40, 4, 6, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 40,
        quota_7d_reset_at: NOW + 6 * DAY,
        manual_resets_remaining: 2,
        manual_resets_grants: [{resets_left: 2, ends_at: NOW + 48 * HOUR}], // same deadline hour, higher resetHarvestUrgency!
      },
    },
  ];

  const evalHarvest = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest'},
    NOW,
  );
  const c2 = evalHarvest.candidates.find(c => c.id === 'grant-48h-2cards')!;
  const c1 = evalHarvest.candidates.find(c => c.id === 'grant-48h-1card')!;
  const cNo = evalHarvest.candidates.find(c => c.id === 'no-card-soon')!;

  expect(c2.manualResetsRemaining).toBe(2);
  expect(c2.effectiveWeeklyPoolRemPct).toBe(260);
  expect(c1.earliestResetGrantEndsAt).toBe(NOW + 48 * HOUR);
  expect(c2.resetHarvestUrgency).toBeGreaterThan(c1.resetHarvestUrgency);
  expect(cNo.manualResetsRemaining).toBe(0);
  expect(cNo.resetHarvestUrgency).toBe(0);

  // Ranking: grant-48h-2cards -> grant-48h-1card -> grant-72h-1card -> no-card-soon
  expect(evalHarvest.recommended?.id).toBe('grant-48h-2cards');
  expect(evalHarvest.recommended?.reasonKey).toBe('relay.reason.resetHarvest');
  const savedOrder = evalHarvest.candidates.filter(c => !c.isCurrent).map(c => c.id);
  expect(savedOrder).toEqual(['grant-48h-2cards', 'grant-48h-1card', 'grant-72h-1card', 'no-card-soon']);

  // Fallback to smart ordering when neither candidate holds reset cards
  const noCardAccounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('later-6d', 1, 10, 10, 3, 6, false),
    makeAccount('sooner-2d', 2, 20, 20, 3, 2, false),
  ];
  const evalFallback = evaluateSmartRelay(
    noCardAccounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest'},
    NOW,
  );
  expect(evalFallback.recommended?.id).toBe('sooner-2d');
});

test('awaitingManualReset demotes >=98% 7d accounts with Reset Cards out of auto-relay and summarizes pool counts', () => {
  const accounts: RelayAccountInput[] = [
    {
      ...makeAccount('current-awaiting-98', 0, 40, 98, 3, 5, true),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 40,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 98,
        quota_7d_reset_at: NOW + 5 * DAY,
        manual_resets_remaining: 2,
        manual_resets_grants: [{resets_left: 2, ends_at: NOW + 72 * HOUR}],
      },
    },
    {
      ...makeAccount('saved-awaiting-100', 1, 10, 100, 4, 4, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 10,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 100,
        quota_7d_reset_at: NOW + 4 * DAY,
        manual_resets_remaining: 1,
      },
    },
    makeAccount('ready-backup', 2, 15, 20, 3, 5, false),
  ];

  // Even with spentThresholdPct = 100 and session affinity, awaitingManualReset rotates OFF at >=98% 7d
  const evalAwaiting = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      strategy: 'reset_harvest',
      spentThresholdPct: 100,
      affinityMode: 'session',
    },
    NOW,
  );

  const cur = evalAwaiting.candidates.find(c => c.id === 'current-awaiting-98')!;
  const saved100 = evalAwaiting.candidates.find(c => c.id === 'saved-awaiting-100')!;

  expect(cur.awaitingManualReset).toBe(true);
  expect(cur.tier).toBe(2);
  expect(cur.reasonKey).toBe('relay.reason.awaitingManualReset');
  expect(cur.reasonParams).toEqual({count: 2});

  expect(saved100.awaitingManualReset).toBe(true);
  expect(saved100.tier).toBe(3);
  expect(saved100.reasonKey).toBe('relay.reason.awaitingManualReset');
  expect(saved100.reasonParams).toEqual({count: 1});

  expect(evalAwaiting.shouldRelayNow).toBe(true);
  expect(evalAwaiting.relayTriggerKind).toBe('current_spent');
  expect(evalAwaiting.recommended?.id).toBe('ready-backup');
  expect(evalAwaiting.awaitingResetCandidates.map(c => c.id)).toEqual([
    'current-awaiting-98',
    'saved-awaiting-100',
  ]);

  const pool = summarizeRelayPool(evalAwaiting.candidates, NOW);
  expect(pool.totalManualResetsRemaining).toBe(3);
  expect(pool.awaitingResetCount).toBe(2);
});

test('smart and pace break ties and 72h expiring grants in favor of manualResetsRemaining > 0', () => {
  // 1. Tie-break when r7/r5/effectiveRem are equal (distant/unbounded grant)
  const tieAccounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('plain-tie', 1, 20, 20, 3, 5, false),
    {
      ...makeAccount('reset-tie', 2, 20, 20, 3, 5, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 20,
        quota_7d_reset_at: NOW + 5 * DAY,
        manual_resets_remaining: 1,
        manual_resets_grants: [{resets_left: 1, ends_at: null}],
      },
    },
  ];
  expect(
    evaluateSmartRelay(tieAccounts, {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'}, NOW)
      .recommended?.id,
  ).toBe('reset-tie');
  expect(
    evaluateSmartRelay(tieAccounts, {...defaultSmartRelayConfig, enabled: true, strategy: 'pace'}, NOW)
      .recommended?.id,
  ).toBe('reset-tie');

  // 2. Grant expiring within 72h wins in both smart & pace over an earlier 7d reset / higher pace without grant
  const exp72Accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('plain-sooner-r7', 1, 15, 50, 3, 2, false), // r7 = 2d, pace = 25%/d
    {
      ...makeAccount('expiring-grant-60h', 2, 20, 10, 4, 6, false), // r7 = 6d, pace = 15%/d, grant <= 72h!
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 10,
        quota_7d_reset_at: NOW + 6 * DAY,
        manual_resets_remaining: 1,
        manual_resets_grants: [{resets_left: 1, ends_at: NOW + 60 * HOUR}],
      },
    },
  ];
  expect(
    evaluateSmartRelay(exp72Accounts, {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'}, NOW)
      .recommended?.id,
  ).toBe('expiring-grant-60h');
  expect(
    evaluateSmartRelay(exp72Accounts, {...defaultSmartRelayConfig, enabled: true, strategy: 'pace'}, NOW)
      .recommended?.id,
  ).toBe('expiring-grant-60h');
});

test('buildSubagentMarkdownTemplate returns a copy-ready pro-pool-worker definition calling claude-subagent.ps1', () => {
  const tpl = buildSubagentMarkdownTemplate();
  expect(tpl).toContain('name: pro-pool-worker');
  expect(tpl).toContain('~/.local/bin/claude-subagent.ps1');
  expect(tpl).toContain('-PromptFile');
  expect(tpl).toContain('-ReadOnly');
  expect(tpl).toContain('-Status');
  expect(tpl).toContain('(default 1)');
  expect(tpl).toContain('waves of 2');
});

test('awaitingManualReset honors Math.min(spentThresholdPct, 98) without triggering on 5h-only exhaustion', () => {
  const accounts: RelayAccountInput[] = [
    {
      ...makeAccount('card-at-92-7d', 0, 30, 92, 3, 5, true),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 30,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 92,
        quota_7d_reset_at: NOW + 5 * DAY,
        manual_resets_remaining: 2,
      },
    },
    {
      ...makeAccount('card-5h-100-only', 1, 100, 40, 1, 5, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 100,
        quota_5h_reset_at: NOW + 1 * HOUR,
        quota_7d_used: 40,
        quota_7d_reset_at: NOW + 5 * DAY,
        manual_resets_remaining: 2,
      },
    },
    makeAccount('healthy-backup', 2, 10, 20, 4, 5, false),
  ];

  // With spentThresholdPct = 90, 92% 7d >= min(90, 98) -> awaitingManualReset is true (no deadlock!)
  const eval90 = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest', spentThresholdPct: 90},
    NOW,
  );
  expect(eval90.candidates.find(c => c.id === 'card-at-92-7d')?.awaitingManualReset).toBe(true);
  // 5h-only limit (used5h=100, used7d=40) MUST NOT mark awaitingManualReset!
  expect(eval90.candidates.find(c => c.id === 'card-5h-100-only')?.awaitingManualReset).toBe(false);

  // With spentThresholdPct = 98, 92% 7d keeps harvesting (< 98%)
  const eval98 = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest', spentThresholdPct: 98},
    NOW,
  );
  expect(eval98.candidates.find(c => c.id === 'card-at-92-7d')?.awaitingManualReset).toBe(false);
  expect(eval98.candidates.find(c => c.id === 'card-at-92-7d')?.tier).toBe(0);
});

test('smart promotes multi-card accounts (manualResetsRemaining >= 2) while yielding to soonReset24h, and computes 3-tier reset urgency', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    makeAccount('plain-r7-3d', 1, 15, 25, 3, 3, false),
    {
      ...makeAccount('two-cards-r7-6d', 2, 20, 20, 3, 6, false),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 20,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 20,
        quota_7d_reset_at: NOW + 6 * DAY,
        manual_resets_remaining: 2,
        manual_resets_grants: [{resets_left: 2, ends_at: NOW + 5 * DAY}],
      },
    },
  ];

  const evalSmart = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'smart'},
    NOW,
  );
  expect(evalSmart.recommended?.id).toBe('two-cards-r7-6d');

  expect(computeResetCardExpiryUrgency(null, 0, NOW)).toBeNull();
  expect(computeResetCardExpiryUrgency(null, 2, NOW)).toBe('normal');
  expect(computeResetCardExpiryUrgency(NOW + 5 * DAY, 2, NOW)).toBe('normal');
  expect(computeResetCardExpiryUrgency(NOW + 48 * HOUR, 1, NOW)).toBe('warning');
  expect(computeResetCardExpiryUrgency(NOW + 12 * HOUR, 1, NOW)).toBe('critical');
});

test('5-item MRU recent launch directories store deduplicates case-insensitively and formats labels', () => {
  clearRelayLaunchDirs();
  expect(getRelayLaunchDirs()).toEqual([]);

  recordRelayLaunchDir('D:\\Repos\\Alpha\\');
  recordRelayLaunchDir('D:\\Repos\\Beta');
  recordRelayLaunchDir('d:/repos/alpha'); // moves Alpha to top without duplicating
  expect(getRelayLaunchDirs()).toEqual(['d:/repos/alpha', 'D:\\Repos\\Beta']);

  recordRelayLaunchDir('C:\\Work\\One');
  recordRelayLaunchDir('C:\\Work\\Two');
  recordRelayLaunchDir('C:\\Work\\Three');
  recordRelayLaunchDir('C:\\Work\\Four'); // 6th distinct entry evicts oldest ('Beta')
  expect(getRelayLaunchDirs()).toHaveLength(5);
  expect(getRelayLaunchDirs()[0]).toBe('C:\\Work\\Four');
  expect(getRelayLaunchDirs()).not.toContain('D:\\Repos\\Beta');

  removeRelayLaunchDir('c:\\work\\two\\');
  expect(getRelayLaunchDirs()).toHaveLength(4);
  expect(formatLaunchDirChip('D:\\Projects\\DemoWorkspace\\Claude-Local')).toEqual({
    leaf: 'Claude-Local',
    parent: 'D:\\Projects\\DemoWorkspace',
  });
  expect(formatLaunchDirChip('C:\\')).toEqual({leaf: 'C:\\', parent: ''});

  clearRelayLaunchDirs();
});

test('canSyncNativeSmartRelay and syncNativeSmartRelayConfigIfLive stay silent in non-Tauri and synthetic fixtures', async () => {
  expect(canSyncNativeSmartRelay()).toBe(false);
  expect(await syncNativeSmartRelayConfigIfLive()).toBeNull();
});

test('normalizePlanSlug, CANONICAL_MANUAL_PLANS, and computeSubscriptionRoi map Free/Pro/Max/Ultra/Team cleanly', () => {
  expect(CANONICAL_MANUAL_PLANS).toEqual(['Free', 'Pro', 'Max 5x', 'Max 20x', 'Ultra', 'Team']);
  expect(normalizePlanSlug(null)).toBe('unknown');
  expect(normalizePlanSlug('  ')).toBe('unknown');
  expect(normalizePlanSlug('Free')).toBe('free');
  expect(normalizePlanSlug('Pro')).toBe('pro');
  expect(normalizePlanSlug('Pro / Max')).toBe('pro');
  expect(normalizePlanSlug('Max')).toBe('max');
  expect(normalizePlanSlug('Max 5x')).toBe('max');
  expect(normalizePlanSlug('Max 20x')).toBe('max');
  expect(normalizePlanSlug('Ultra')).toBe('ultra');
  expect(normalizePlanSlug('Team')).toBe('team');
  expect(normalizePlanSlug('Enterprise')).toBe('team');

  expect(computeSubscriptionRoi('Free', 50)).toBeNull();
  expect(computeSubscriptionRoi(null, 50)).toBeNull();
  expect(computeSubscriptionRoi('Pro', 186)).toEqual({monthlyPriceUsd: 20, multiplier: 9.3});
  expect(computeSubscriptionRoi('Team', 90)).toEqual({monthlyPriceUsd: 30, multiplier: 3});
  expect(computeSubscriptionRoi('Enterprise', 60)).toEqual({monthlyPriceUsd: 30, multiplier: 2});
  expect(computeSubscriptionRoi('Max 5x', 250)).toEqual({monthlyPriceUsd: 100, multiplier: 2.5});
  expect(computeSubscriptionRoi('Max 20x', 500)).toEqual({monthlyPriceUsd: 200, multiplier: 2.5});
  expect(computeSubscriptionRoi('Ultra', 800)).toEqual({monthlyPriceUsd: 200, multiplier: 4});
  // Period-prorated ROI: $3 today on Pro ($20/30 = $0.6667/day) -> 4.5x; $14 over 7d -> 3x; $180 over 90d -> 3x
  expect(computeSubscriptionRoi('Pro', 3, 1)).toEqual({monthlyPriceUsd: 20, multiplier: 4.5});
  expect(computeSubscriptionRoi('Pro', 14, 7)).toEqual({monthlyPriceUsd: 20, multiplier: 3});
  expect(computeSubscriptionRoi('Pro', 180, 90)).toEqual({monthlyPriceUsd: 20, multiplier: 3});
});

test('evaluateQuota enforces non-Ultra no5hLimit downgrade guard and restedNoActive5h parity', () => {
  // Downgraded Pro/Free/Max with stale quota_no_5h_limit=true must NOT retain Unlimited 5h
  const downgradedPro = evaluateQuota(
    {
      plan: 'Pro',
      quota_no_5h_limit: true,
      quota_7d_source: 'server_anchor',
      quota_7d_used: 30,
      quota_7d_reset_at: NOW + 4 * DAY,
      quota_5h_source: 'server_anchor',
      quota_5h_used: 40,
      quota_5h_reset_at: NOW + 2 * HOUR,
    },
    NOW,
  )!;
  expect(downgradedPro.no5hLimit).toBe(false);
  expect(downgradedPro.rem5h).toBe(60);

  // Fresh/rested Pro with active 7d and unstarted 5h (null used + null reset_at, non-explicit-unknown source) is Tier 0 Ready
  const restedPro = evaluateQuota(
    {
      plan: 'Pro',
      quota_7d_source: 'server_anchor',
      quota_7d_used: 25,
      quota_7d_reset_at: NOW + 5 * DAY,
      quota_5h_used: null,
      quota_5h_reset_at: null,
    },
    NOW,
  )!;
  expect(restedPro.known5h).toBe(true);
  expect(restedPro.used5h).toBe(0);
  expect(restedPro.rem5h).toBe(100);
  expect(restedPro.effectiveRem).toBe(75);

  // Explicit quota_5h_source === 'unknown' without rested marker stays unknown (known5h === false)
  const explicitUnknown5h = evaluateQuota(
    {
      plan: 'Pro',
      quota_7d_source: 'server_anchor',
      quota_7d_used: 25,
      quota_7d_reset_at: NOW + 5 * DAY,
      quota_5h_source: 'unknown',
      quota_5h_used: null,
      quota_5h_reset_at: null,
    },
    NOW,
  )!;
  expect(explicitUnknown5h.known5h).toBe(false);

  // Real Tauri Summary/Current with quota_5h_source === 'unknown' + quota_5h_rested === true promotes cleanly
  const tauriRestedPro = evaluateQuota(
    {
      plan: 'Pro',
      quota_7d_source: 'server_anchor',
      quota_7d_used: 25,
      quota_7d_reset_at: NOW + 5 * DAY,
      quota_5h_source: 'unknown',
      quota_5h_rested: true,
      quota_5h_used: null,
      quota_5h_reset_at: null,
    },
    NOW,
  )!;
  expect(tauriRestedPro.known5h).toBe(true);
  expect(tauriRestedPro.rem5h).toBe(100);
  expect(tauriRestedPro.effectiveRem).toBe(75);
});

test('Strategy A1 extractResetCardInfo preserves positive remaining on elapsed clock while capping mixed expired slices', () => {
  // Legacy grant_ends_at <= nowSec keeps positive remaining (Strategy A1) and clears finite end
  expect(
    extractResetCardInfo(
      {manual_resets_remaining: 3, manual_resets_grant_ends_at: NOW - 60},
      NOW,
    ),
  ).toEqual({manualResetsRemaining: 3, earliestResetGrantEndsAt: null});

  // All-expired grants array keeps positive remaining (Strategy A1) and clears finite end
  expect(
    extractResetCardInfo(
      {
        manual_resets_remaining: 2,
        manual_resets_grants: [{resets_left: 2, ends_at: NOW - 300}],
      },
      NOW,
    ),
  ).toEqual({manualResetsRemaining: 2, earliestResetGrantEndsAt: null});

  // Mixed expired + future grants caps inflated rawRemaining at futureSum
  expect(
    extractResetCardInfo(
      {
        manual_resets_remaining: 3,
        manual_resets_grants: [
          {resets_left: 1, ends_at: NOW - 300},
          {resets_left: 2, ends_at: NOW + 3600},
        ],
      },
      NOW,
    ),
  ).toEqual({manualResetsRemaining: 2, earliestResetGrantEndsAt: NOW + 3600});

  // clearAccountCooldown(id, true) clears both cooldownUntilSec and matching noReturnAccountId
  resetSmartRelayConfig();
  setAccountCooldown('acc-reset', NOW + 900);
  noteRelayAccountSwitch('acc-reset', 'acc-other', NOW + 3600);
  expect(getSmartRelayConfig().noReturnAccountId).toBe('acc-reset');
  const cleared = clearAccountCooldown('acc-reset', true);
  expect(cleared.cooldownUntilSec['acc-reset']).toBeUndefined();
  expect(cleared.noReturnAccountId).toBeNull();
  expect(cleared.noReturnUntilSec).toBe(0);
});

test('evaluateSmartRelay demotes expired access_until/manual subscriptions to Tier 3 while keeping auto-renewing next_renewal Ready', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('current', 0, 99, 40, 2, 4, true),
    {
      ...makeAccount('expired-cancelled', 1, 10, 10, 4, 5, false),
      subscription_expires_at: NOW - 60,
      billingDateKind: 'access_until',
    },
    {
      ...makeAccount('auto-renewal-rollover', 2, 15, 20, 4, 5, false),
      subscription_expires_at: NOW - 3600,
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 15,
        quota_5h_reset_at: NOW + 4 * HOUR,
        quota_7d_used: 20,
        quota_7d_reset_at: NOW + 5 * DAY,
        billing_date_kind: 'next_renewal',
        subscription_date_source: 'browser',
      },
    },
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'least_used'},
    NOW,
  );
  const expiredCand = evaluation.candidates.find(c => c.id === 'expired-cancelled')!;
  const autoRenewCand = evaluation.candidates.find(c => c.id === 'auto-renewal-rollover')!;

  expect(expiredCand.tier).toBe(3);
  expect(expiredCand.reasonKey).toBe('relay.reason.authExpired');
  expect(autoRenewCand.tier).toBe(0);
  expect(evaluation.recommended?.id).toBe('auto-renewal-rollover');
});

test('computeWindowBurnEta guards <15m or <10% noise and computes exhaustion ETA before reset', () => {
  // Too early (< 900s elapsed: 4h50m remaining -> 600s elapsed) -> null
  expect(computeWindowBurnEta(25, NOW + 5 * HOUR - 600, NOW, 5)).toBeNull();
  // Too little usage (< 10%) -> null
  expect(computeWindowBurnEta(8, NOW + 3 * HOUR, NOW, 5)).toBeNull();

  // 5h window: 1h elapsed (4h = 14400s remaining), 50% used -> 50%/h -> hits 98% in (48 / 50) * 3600 = 3456s (< 14400s)
  const fast = computeWindowBurnEta(50, NOW + 4 * HOUR, NOW, 5, 98)!;
  expect(fast.ratePerHour).toBe(50);
  expect(fast.hitsBeforeReset).toBe(true);
  expect(fast.etaToTargetSec).toBe(3456);
  expect(fast.projectedEndPct).toBe(100);

  // 5h window: 3h elapsed (2h = 7200s remaining), 30% used -> 10%/h -> projected end 50% (< 98%) -> hitsBeforeReset = false
  const safe = computeWindowBurnEta(30, NOW + 2 * HOUR, NOW, 5, 98)!;
  expect(safe.ratePerHour).toBe(10);
  expect(safe.hitsBeforeReset).toBe(false);
  expect(safe.etaToTargetSec).toBeNull();
  expect(safe.projectedEndPct).toBe(50);
});

test('noteRelayAccountRateLimited atomically updates cooldownUntilSec and sunkOrder in a single notification', () => {
  resetSmartRelayConfig();
  updateSmartRelayConfig({enabled: true, rateLimitMode: 'sink_to_end'});
  let notifications = 0;
  const unsub = subscribeSmartRelayConfig(() => {
    notifications += 1;
  });
  try {
    const updated = noteRelayAccountRateLimited('acc-rate', (NOW + 300) * 1000, NOW);
    expect(notifications).toBe(1);
    expect(updated.cooldownUntilSec['acc-rate']).toBe(NOW + 300);
    expect(updated.sunkOrder['acc-rate']).toBe(1);
  } finally {
    unsub();
    resetSmartRelayConfig();
  }
});

test('defaultCliModel and defaultCliEffort sanitize aliases and format --model/--effort args', () => {
  expect(RELAY_CLI_MODELS).toContain('claude-opus-5-5');
  expect(RELAY_CLI_EFFORTS).toContain('max');

  expect(sanitizeRelayCliModel('opus')).toBe('claude-opus-5-5');
  expect(sanitizeRelayCliModel('  CLAUDE-OPUS-5-5 ')).toBe('claude-opus-5-5');
  expect(sanitizeRelayCliModel('fable')).toBe('claude-fable-5-2');
  expect(sanitizeRelayCliModel('sonnet')).toBe('claude-sonnet-5-5');
  expect(sanitizeRelayCliModel('haiku')).toBe('claude-haiku-5-5');
  expect(sanitizeRelayCliModel('opusplan')).toBe('opusplan');
  expect(sanitizeRelayCliModel('unknown-model')).toBe('');

  expect(sanitizeRelayCliEffort(' MAX ')).toBe('max');
  expect(sanitizeRelayCliEffort('xhigh')).toBe('xhigh');
  expect(sanitizeRelayCliEffort('invalid')).toBe('');

  const cfg = sanitizeSmartRelayConfig({
    default_cli_model: 'opus',
    default_cli_effort: 'max',
  });
  expect(cfg.defaultCliModel).toBe('claude-opus-5-5');
  expect(cfg.defaultCliEffort).toBe('max');
  expect(formatRelayCliModelEffortArgs(cfg)).toEqual(['--model', 'claude-opus-5-5', '--effort', 'max']);
  expect(formatRelayCliModelEffortArgs(defaultSmartRelayConfig)).toEqual([]);
});

test('syncNativeSmartRelayConfigIfLive discards stale in-flight native reads when a local edit lands mid-flight', async () => {
  resetSmartRelayConfig();
  const prevWin = (globalThis as {window?: unknown}).window;
  const stateDeferred: {resolve: ((val: unknown) => void) | null} = {resolve: null};
  const invokeCalls: string[] = [];
  (globalThis as {window?: unknown}).window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    __TAURI_INTERNALS__: {
      metadata: {currentWindow: {label: 'main'}},
      invoke: (cmd: string) => {
        invokeCalls.push(cmd);
        if (cmd === 'identities_orchestrator_state') {
          return new Promise(resolve => {
            stateDeferred.resolve = resolve;
          });
        }
        if (cmd === 'identities_orchestrator_configure') {
          return Promise.resolve({
            config_persisted: true,
            config: getSmartRelayConfig(),
          });
        }
        return Promise.resolve(null);
      },
    },
  };

  try {
    expect(canSyncNativeSmartRelay()).toBe(true);
    const pendingRead = syncNativeSmartRelayConfigIfLive();
    // Wait a microtask so dynamic import('@tauri-apps/api/core') invokes identities_orchestrator_state
    for (let i = 0; i < 10 && !stateDeferred.resolve; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    expect(invokeCalls).toContain('identities_orchestrator_state');

    // User makes a fresh edit in Smart Relay modal while the older state read is still in flight
    updateSmartRelayConfig({enabled: true, strategy: 'reset_harvest', spentThresholdPct: 95});
    expect(getSmartRelayConfig().strategy).toBe('reset_harvest');

    // Older native read resolves afterward with stale strategy ('smart', enabled: false)
    stateDeferred.resolve?.({
      config_persisted: true,
      config: {...defaultSmartRelayConfig, enabled: false, strategy: 'smart'},
    });
    await pendingRead;

    // Fresh local edit must NOT be overwritten by the stale read
    expect(getSmartRelayConfig().enabled).toBe(true);
    expect(getSmartRelayConfig().strategy).toBe('reset_harvest');
    expect(getSmartRelayConfig().spentThresholdPct).toBe(95);
  } finally {
    if (prevWin === undefined) {
      delete (globalThis as {window?: unknown}).window;
    } else {
      (globalThis as {window?: unknown}).window = prevWin;
    }
    resetSmartRelayConfig();
  }
});

test('defaultCliModel and defaultCliEffort sanitize aliases and format --model/--effort args', () => {
  expect(RELAY_CLI_MODELS).toContain('claude-opus-5-5');
  expect(RELAY_CLI_EFFORTS).toContain('max');

  expect(sanitizeRelayCliModel('opus')).toBe('claude-opus-5-5');
  expect(sanitizeRelayCliModel('  CLAUDE-OPUS-5-5 ')).toBe('claude-opus-5-5');
  expect(sanitizeRelayCliModel('fable')).toBe('claude-fable-5-2');
  expect(sanitizeRelayCliModel('sonnet')).toBe('claude-sonnet-5-5');
  expect(sanitizeRelayCliModel('haiku')).toBe('claude-haiku-5-5');
  expect(sanitizeRelayCliModel('opusplan')).toBe('opusplan');
  expect(sanitizeRelayCliModel('unknown-model')).toBe('');

  expect(sanitizeRelayCliEffort(' MAX ')).toBe('max');
  expect(sanitizeRelayCliEffort('xhigh')).toBe('xhigh');
  expect(sanitizeRelayCliEffort('invalid')).toBe('');

  const cfg = sanitizeSmartRelayConfig({
    default_cli_model: 'opus',
    default_cli_effort: 'max',
  });
  expect(cfg.defaultCliModel).toBe('claude-opus-5-5');
  expect(cfg.defaultCliEffort).toBe('max');
  expect(formatRelayCliModelEffortArgs(cfg)).toEqual(['--model', 'claude-opus-5-5', '--effort', 'max']);
  expect(formatRelayCliModelEffortArgs(defaultSmartRelayConfig)).toEqual([]);
});

test('current_spent beats preferred_recovered when current is 5h 0% while still recommending the recovered preferred account', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('exhausted-current', 0, 100, 45, 2, 4, true), // 5h 0% remaining!
    makeAccount('preferred-star', 1, 15, 25, 4, 5, false), // Recovered (< 90%)
    makeAccount('other-spare', 2, 5, 10, 4, 6, false),
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      strategy: 'least_used',
      preferredAccountId: 'preferred-star',
      returnToPreferred: true,
      preferredReturnThresholdPct: 90,
    },
    NOW,
  );

  expect(evaluation.shouldRelayNow).toBe(true);
  expect(evaluation.relayTriggerKind).toBe('current_spent');
  expect(evaluation.recommended?.id).toBe('preferred-star');
  expect(evaluation.recommended?.isPreferred).toBe(true);
});

test('0% remaining with valid auth and known quota classifies as Tier 2 spent and feeds avg5hRemainingPct and soonestResetSec', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('zero-5h', 0, 100, 40, 2, 5, true), // rem5h = 0, rem7d = 60, r5 = NOW + 2h
    makeAccount('healthy-1', 1, 20, 20, 4, 6, false), // rem5h = 80, rem7d = 80
    makeAccount('cooling-1', 2, 10, 10, 1, 4, false), // inCooldown -> tier 3, r5 = NOW + 1h
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      cooldownUntilSec: {'cooling-1': NOW + 900},
    },
    NOW,
  );

  const zeroCand = evaluation.candidates.find(c => c.id === 'zero-5h')!;
  expect(zeroCand.tier).toBe(2);

  const pool = summarizeRelayPool(evaluation.candidates, NOW);
  expect(pool.spentCount).toBe(1);
  expect(pool.unavailableCount).toBe(1); // cooling-1 only
  expect(pool.cooldownCount).toBe(1);
  // avg5hRemainingPct includes zero-5h (0%) + healthy-1 (80%) -> 40%
  expect(pool.avg5hRemainingPct).toBe(40);
  // soonestResetSec includes tier 2 (NOW + 2h) AND inCooldown (NOW + 1h) -> NOW + 1h
  expect(pool.soonestResetSec).toBe(NOW + 1 * HOUR);
});

test('inferred5h on preferred account blocks premature preferred_recovered when current is healthy', () => {
  const accounts: RelayAccountInput[] = [
    makeAccount('healthy-current', 0, 35, 35, 3, 4, true),
    {
      id: 'preferred-inferred-5h',
      name: 'Preferred Inferred 5h',
      email: 'pref5h@example.invalid',
      plan: 'pro',
      auth_status: 'valid',
      isCurrent: false,
      listIndex: 1,
      summary: {
        quota_source: 'server_anchor',
        quota_observed_at_ms: (NOW - 6 * HOUR) * 1000,
        quota_5h_used: 95,
        quota_5h_reset_at: NOW - HOUR, // 5h elapsed -> inferred5h = true
        quota_7d_used: 30,
        quota_7d_reset_at: NOW + 4 * DAY, // 7d active -> inferred = false
      },
    },
  ];

  const evaluation = evaluateSmartRelay(
    accounts,
    {
      ...defaultSmartRelayConfig,
      enabled: true,
      preferredAccountId: 'preferred-inferred-5h',
      returnToPreferred: true,
      preferredReturnThresholdPct: 90,
    },
    NOW,
  );

  const prefCand = evaluation.candidates.find(c => c.id === 'preferred-inferred-5h')!;
  expect(prefCand.inferred5h).toBe(true);
  expect(prefCand.inferred).toBe(false);
  expect(evaluation.relayTriggerKind).not.toBe('preferred_recovered');
  expect(evaluation.shouldRelayNow).toBe(false);
});

test('buildSubagentMarkdownTemplate enforces haiku/low/PowerShell+Bash frontmatter and single-line command without backticks', () => {
  const tpl = buildSubagentMarkdownTemplate();
  expect(tpl).toContain('model: claude-haiku-5-5');
  expect(tpl).toContain('effort: low');
  expect(tpl).toContain('tools: PowerShell, Bash, Read, Grep, Glob');
  expect(tpl).toContain(
    'pwsh -NoProfile -ExecutionPolicy Bypass -File "$HOME/.local/bin/claude-subagent.ps1" -PromptFile "<path-to-task.md>" -SessionTag "<task-tag>" -ReadOnly',
  );
  // No PowerShell backtick line continuations inside the code block
  expect(tpl).not.toContain(' `\n');
});

test('flushNativeSmartRelaySync awaits inflight configure writes and handles errors cleanly without throwing', async () => {
  resetSmartRelayConfig();
  // Offline/non-Tauri resolves immediately
  await expect(flushNativeSmartRelaySync()).resolves.toBeUndefined();

  const prevWin = (globalThis as {window?: unknown}).window;
  const writeDeferred: {resolve: ((v: unknown) => void) | null} = {resolve: null};
  let rejectNext = false;
  (globalThis as {window?: unknown}).window = {
    localStorage: {getItem: () => null, setItem: () => {}, removeItem: () => {}},
    __TAURI_INTERNALS__: {
      metadata: {currentWindow: {label: 'main'}},
      invoke: (cmd: string) => {
        if (cmd === 'identities_orchestrator_configure') {
          if (rejectNext) return Promise.reject(new Error('mock-sync-fail'));
          return new Promise(resolve => {
            writeDeferred.resolve = resolve;
          });
        }
        return Promise.resolve(null);
      },
    },
  };

  try {
    updateSmartRelayConfig({enabled: true, strategy: 'pace'});
    let flushed = false;
    const flushPromise = flushNativeSmartRelaySync().then(() => {
      flushed = true;
    });
    for (let i = 0; i < 10 && !writeDeferred.resolve; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    expect(flushed).toBe(false);
    writeDeferred.resolve?.({config_persisted: true, config: getSmartRelayConfig()});
    await flushPromise;
    expect(flushed).toBe(true);
    expect(getLastNativeSmartRelaySyncError()).toBeNull();

    // Sync failure should be caught/recorded cleanly without throwing
    rejectNext = true;
    updateSmartRelayConfig({strategy: 'smart'});
    await expect(flushNativeSmartRelaySync()).resolves.toBeUndefined();
    expect(getLastNativeSmartRelaySyncError()).toContain('mock-sync-fail');
  } finally {
    if (prevWin === undefined) delete (globalThis as {window?: unknown}).window;
    else (globalThis as {window?: unknown}).window = prevWin;
    resetSmartRelayConfig();
  }
});

test('summarizeCleanroomPipelineStages reports truthful skipped, warning, error, and ok statuses without greenwashing', () => {
  const mk = (stage: string, status: Progress['status']): Progress => ({
    stage,
    status,
    message: `${stage}:${status}`,
    current: 1,
    total: 1,
    elapsed_ms: 10,
  });

  // 1. Unlinked browser switch (no browser event) -> exit_align MUST be 'skipped', NOT 'ok'
  const unlinked = summarizeCleanroomPipelineStages(
    [
      mk('stop', 'ok'),
      mk('validate', 'ok'),
      mk('archive', 'ok'),
      mk('cleanroom', 'ok'),
      mk('commit', 'ok'),
      mk('verify', 'ok'),
      mk('done', 'ok'),
    ],
    false,
    false,
  );
  expect(unlinked.map(s => [s.id, s.status])).toEqual([
    ['lock_guard', 'ok'],
    ['cleanroom_vault', 'ok'],
    ['exit_align', 'skipped'],
  ]);

  // 2. Warning in cleanroom / verify + browser warning -> truthful 'warning' badges
  const warned = summarizeCleanroomPipelineStages(
    [
      mk('stop', 'ok'),
      mk('cleanroom', 'warning'),
      mk('commit', 'ok'),
      mk('verify', 'ok'),
      mk('browser', 'warning'),
      mk('done', 'ok'),
    ],
    false,
    false,
  );
  expect(warned.map(s => [s.id, s.status])).toEqual([
    ['lock_guard', 'ok'],
    ['cleanroom_vault', 'warning'],
    ['exit_align', 'warning'],
  ]);

  // 3. Rollback occurred (even if rollback itself logged 'ok') -> cleanroom_vault MUST be 'error'
  const rolledBack = summarizeCleanroomPipelineStages(
    [
      mk('stop', 'ok'),
      mk('archive', 'error'),
      mk('rollback', 'running'),
      mk('rollback', 'ok'),
      mk('done', 'error'),
    ],
    false,
    true,
  );
  expect(rolledBack.map(s => [s.id, s.status])).toEqual([
    ['lock_guard', 'ok'],
    ['cleanroom_vault', 'error'],
    ['exit_align', 'skipped'],
  ]);

  // 4. Full happy path with post-commit browser ok -> all three 'ok'
  const fullOk = summarizeCleanroomPipelineStages(
    [
      mk('stop', 'ok'),
      mk('validate', 'ok'),
      mk('cleanroom', 'ok'),
      mk('commit', 'ok'),
      mk('verify', 'ok'),
      mk('browser', 'running'),
      mk('browser', 'ok'),
      mk('done', 'ok'),
    ],
    false,
    false,
  );
  expect(fullOk.map(s => [s.id, s.status])).toEqual([
    ['lock_guard', 'ok'],
    ['cleanroom_vault', 'ok'],
    ['exit_align', 'ok'],
  ]);

  // 5. Neither stop nor validate ran -> lock_guard MUST be 'skipped' on finish
  const noLock = summarizeCleanroomPipelineStages(
    [mk('cleanroom', 'ok'), mk('commit', 'ok'), mk('done', 'ok')],
    false,
    false,
  );
  expect(noLock.map(s => [s.id, s.status])).toEqual([
    ['lock_guard', 'skipped'],
    ['cleanroom_vault', 'ok'],
    ['exit_align', 'skipped'],
  ]);
});

test('relayHandoffMode defaults to clean_handoff, accepts snake_case alias, rejects unknown values and round-trips through native payload sanitize', () => {
  expect(RELAY_HANDOFF_MODES).toEqual(['clean_handoff', 'fork_resume']);
  expect(defaultSmartRelayConfig.relayHandoffMode).toBe('clean_handoff');
  expect(sanitizeSmartRelayConfig(null).relayHandoffMode).toBe('clean_handoff');
  expect(sanitizeSmartRelayConfig({}).relayHandoffMode).toBe('clean_handoff');
  expect(sanitizeSmartRelayConfig({relayHandoffMode: 'fork_resume'}).relayHandoffMode).toBe('fork_resume');
  expect(sanitizeSmartRelayConfig({relay_handoff_mode: 'fork_resume'}).relayHandoffMode).toBe('fork_resume');
  expect(sanitizeSmartRelayConfig({relayHandoffMode: 'resume_everything'}).relayHandoffMode).toBe('clean_handoff');
  expect(sanitizeSmartRelayConfig({relayHandoffMode: 7}).relayHandoffMode).toBe('clean_handoff');

  resetSmartRelayConfig();
  const updated = updateSmartRelayConfig({relayHandoffMode: 'fork_resume'});
  expect(updated.relayHandoffMode).toBe('fork_resume');
  const payload = JSON.parse(JSON.stringify(getSmartRelayConfig())) as Record<string, unknown>;
  expect(payload.relayHandoffMode).toBe('fork_resume');
  expect(sanitizeSmartRelayConfig(payload).relayHandoffMode).toBe('fork_resume');
  resetSmartRelayConfig();
  expect(getSmartRelayConfig().relayHandoffMode).toBe('clean_handoff');
});

test('HandoffSummary and HandoffItem match the camelCase native checkpoint contract', () => {
  const summary: HandoffSummary = {
    createdAtSec: NOW,
    dismissed: false,
    handoffMdPath: 'handoff/latest-handoff.md',
    handoffDir: 'handoff',
    sessionCount: 2,
    outputReadyCount: 1,
    interruptedCount: 1,
    externalRunningCount: 0,
    copyPrompt: 'Read handoff/latest-handoff.md first.',
    items: [
      {id: 'sub-01', status: 'output_ready', title: 'Explore', outputPath: 'handoff/subagent-outputs/sub-01.md'},
      {id: 'sub-02', status: 'interrupted_429', title: 'Plan'},
    ],
  };
  const item: HandoffItem = summary.items[1];
  expect(item.outputPath ?? null).toBeNull();
  expect(Object.keys(summary).sort()).toEqual(
    [
      'copyPrompt',
      'createdAtSec',
      'dismissed',
      'externalRunningCount',
      'handoffDir',
      'handoffMdPath',
      'interruptedCount',
      'items',
      'outputReadyCount',
      'sessionCount',
    ].sort(),
  );
});

test('RELAY_SPENT_THRESHOLDS supports 80 and 85 in config sanitization and Smart Relay evaluation triggers', () => {
  expect(RELAY_SPENT_THRESHOLDS).toEqual([80, 85, 90, 95, 98, 100]);
  expect(defaultSmartRelayConfig.spentThresholdPct).toBe(98);

  expect(sanitizeSmartRelayConfig({spentThresholdPct: 80}).spentThresholdPct).toBe(80);
  expect(sanitizeSmartRelayConfig({spentThresholdPct: 85}).spentThresholdPct).toBe(85);
  expect(sanitizeSmartRelayConfig({spentThresholdPct: 79}).spentThresholdPct).toBe(98);
  expect(sanitizeSmartRelayConfig({spentThresholdPct: 82}).spentThresholdPct).toBe(98);

  const accountsAt79: RelayAccountInput[] = [
    makeAccount('current', 0, 79, 30, 3, 4, true),
    makeAccount('standby', 1, 20, 20, 4, 5, false),
  ];
  const below80 = evaluateSmartRelay(
    accountsAt79,
    {...defaultSmartRelayConfig, enabled: true, spentThresholdPct: 80},
    NOW,
  );
  expect(below80.currentCandidate?.tier).toBe(0);
  expect(below80.shouldRelayNow).toBe(false);

  const accountsAt80: RelayAccountInput[] = [
    makeAccount('current', 0, 80, 30, 3, 4, true),
    makeAccount('standby', 1, 20, 20, 4, 5, false),
  ];
  const at80 = evaluateSmartRelay(
    accountsAt80,
    {...defaultSmartRelayConfig, enabled: true, spentThresholdPct: 80},
    NOW,
  );
  expect(at80.currentCandidate?.tier).toBe(2);
  expect(at80.shouldRelayNow).toBe(true);
  expect(at80.relayTriggerKind).toBe('current_spent');
  expect(at80.recommended?.id).toBe('standby');

  const accountsAt84: RelayAccountInput[] = [
    makeAccount('current', 0, 84, 30, 3, 4, true),
    makeAccount('standby', 1, 20, 20, 4, 5, false),
  ];
  const below85 = evaluateSmartRelay(
    accountsAt84,
    {...defaultSmartRelayConfig, enabled: true, spentThresholdPct: 85},
    NOW,
  );
  expect(below85.currentCandidate?.tier).toBe(0);
  expect(below85.shouldRelayNow).toBe(false);

  const accountsAt85: RelayAccountInput[] = [
    makeAccount('current', 0, 85, 30, 3, 4, true),
    makeAccount('standby', 1, 20, 20, 4, 5, false),
  ];
  const at85 = evaluateSmartRelay(
    accountsAt85,
    {...defaultSmartRelayConfig, enabled: true, spentThresholdPct: 85},
    NOW,
  );
  expect(at85.currentCandidate?.tier).toBe(2);
  expect(at85.shouldRelayNow).toBe(true);
  expect(at85.relayTriggerKind).toBe('current_spent');
  expect(at85.recommended?.id).toBe('standby');

  // Verify awaitingManualReset also respects 80 and 85 on 7d usage
  const resetCardAccounts: RelayAccountInput[] = [
    {
      ...makeAccount('card-at-82-7d', 0, 25, 82, 3, 5, true),
      summary: {
        quota_source: 'server_anchor',
        quota_5h_used: 25,
        quota_5h_reset_at: NOW + 3 * HOUR,
        quota_7d_used: 82,
        quota_7d_reset_at: NOW + 5 * DAY,
        manual_resets_remaining: 1,
      },
    },
    makeAccount('backup', 1, 10, 20, 4, 5, false),
  ];
  const evalCard80 = evaluateSmartRelay(
    resetCardAccounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest', spentThresholdPct: 80},
    NOW,
  );
  expect(evalCard80.candidates.find(c => c.id === 'card-at-82-7d')?.awaitingManualReset).toBe(true);
  expect(evalCard80.shouldRelayNow).toBe(true);

  const evalCard85 = evaluateSmartRelay(
    resetCardAccounts,
    {...defaultSmartRelayConfig, enabled: true, strategy: 'reset_harvest', spentThresholdPct: 85},
    NOW,
  );
  expect(evalCard85.candidates.find(c => c.id === 'card-at-82-7d')?.awaitingManualReset).toBe(false);
  expect(evalCard85.shouldRelayNow).toBe(false);
});

test('findSameExitClusterWarning detects >=3 included accounts sharing the same normalized exit endpoint', () => {
  // 1) 2 accounts on same port -> null
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: 'http://127.0.0.1:7899'},
        {id: 'a2', isIncluded: true, proxy: 'socks5://127.0.0.1:7899'},
      ],
      {},
    ),
  ).toBeNull();

  // 2) 3 included accounts on mixed http/socks5h/localhost:7899 -> { endpoint: ':7899', count: 3 }
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: 'http://127.0.0.1:7899/'},
        {id: 'a2', isIncluded: true, proxy: 'socks5h://127.0.0.1:7899'},
        {id: 'a3', isIncluded: true, proxy: null},
      ],
      {'a3': 'HTTP://LOCALHOST:7899/'},
    ),
  ).toEqual({endpoint: ':7899', count: 3});

  // 3) 4 accounts split 2+2 on :7899 and :7898 -> null
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: 'http://127.0.0.1:7899'},
        {id: 'a2', isIncluded: true, proxy: 'socks5://localhost:7899'},
        {id: 'a3', isIncluded: true, proxy: 'http://127.0.0.1:7898'},
        {id: 'a4', isIncluded: true, proxy: 'http://[::1]:7898/'},
      ],
      {},
    ),
  ).toBeNull();

  // 4) Excluded accounts not counted (2 included + 2 excluded on :7899 -> null)
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: null},
        {id: 'a2', isIncluded: true, proxy: 'socks5://127.0.0.1:7899'},
        {id: 'a3', isIncluded: false, proxy: 'http://127.0.0.1:7899'},
        {id: 'a4', isIncluded: false, proxy: null},
      ],
      {},
    ),
  ).toBeNull();
});

test('findSameExitClusterWarning honors cli_default_proxy fallback, null unproxied skip, ::1 loopback, and multi-cluster counts', () => {
  // Custom cli_default_proxy fallback groups unpinned accounts onto :7900 instead of hardcoded :7899
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: null},
        {id: 'a2', isIncluded: true, proxy: 'http://[::1]:7900'},
        {id: 'a3', isIncluded: true, proxy: 'socks5://::1:7900'},
      ],
      {},
      'http://127.0.0.1:7900',
    ),
  ).toEqual({endpoint: ':7900', count: 3});

  // Explicit null cli_default_proxy skips unproxied entries instead of fabricating :7899
  expect(
    findSameExitClusterWarning(
      [
        {id: 'a1', isIncluded: true, proxy: null},
        {id: 'a2', isIncluded: true, proxy: null},
        {id: 'a3', isIncluded: true, proxy: 'http://127.0.0.1:7899'},
      ],
      {},
      null,
    ),
  ).toBeNull();

  // Multi-cluster (>1 clusters hitting >=3) reports clusterCount & clusters list sorted descending
  const multi = findSameExitClusterWarning(
    [
      {id: 'a1', isIncluded: true},
      {id: 'a2', isIncluded: true},
      {id: 'a3', isIncluded: true},
      {id: 'b1', isIncluded: true},
      {id: 'b2', isIncluded: true},
      {id: 'b3', isIncluded: true},
      {id: 'b4', isIncluded: true},
    ],
    {
      a1: 'http://127.0.0.1:7899',
      a2: 'http://localhost:7899',
      a3: 'socks5h://[::1]:7899',
      b1: 'http://127.0.0.1:7901',
      b2: 'http://127.0.0.1:7901',
      b3: 'http://localhost:7901',
      b4: 'http://::1:7901',
    },
    null,
  );
  expect(multi).toEqual({
    endpoint: ':7901',
    count: 4,
    clusterCount: 2,
    clusters: [
      {endpoint: ':7901', count: 4},
      {endpoint: ':7899', count: 3},
    ],
  });
});

test('isSlotBrowserProxyAligned normalizes schemes and loopback aliases while detecting port or proxy mismatches', () => {
  expect(isSlotBrowserProxyAligned('socks5h://127.0.0.1:7899', 'http://localhost:7899/')).toBe(true);
  expect(isSlotBrowserProxyAligned('http://[::1]:7899', 'socks5://127.0.0.1:7899')).toBe(true);
  expect(isSlotBrowserProxyAligned('http://user:pass@::1:7900', 'http://127.0.0.1:7900')).toBe(true);
  expect(isSlotBrowserProxyAligned('', null)).toBe(true);
  expect(isSlotBrowserProxyAligned('http://127.0.0.1:7899', 'http://127.0.0.1:7900')).toBe(false);
  expect(isSlotBrowserProxyAligned('', 'http://127.0.0.1:7899')).toBe(false);
  expect(isSlotBrowserProxyAligned('http://127.0.0.1:7899', '')).toBe(false);
});

test('SmartRelayConfig omits dead autoSwitchWhenIdle field and strips legacy autoSwitchWhenIdle on sanitize', () => {
  expect('autoSwitchWhenIdle' in defaultSmartRelayConfig).toBe(false);
  const sanitized = sanitizeSmartRelayConfig({autoSwitchWhenIdle: true, enabled: true});
  expect('autoSwitchWhenIdle' in sanitized).toBe(false);
  expect(sanitized.enabled).toBe(true);
});

test('clearAccountCooldown invokes identities_orchestrator_clear_cooldown in native mode (including clearNoReturn) and transitions omitted cli_default_proxy to null', async () => {
  resetSmartRelayConfig();
  expect(getCliDefaultProxy()).toBeUndefined();
  const prevWin = (globalThis as {window?: unknown}).window;
  const invokeCalls: Array<{cmd: string; args: unknown}> = [];
  let omitCliProxyInState = false;
  (globalThis as {window?: unknown}).window = {
    localStorage: {getItem: () => null, setItem: () => {}, removeItem: () => {}},
    __TAURI_INTERNALS__: {
      metadata: {currentWindow: {label: 'main'}},
      invoke: (cmd: string, args: unknown) => {
        invokeCalls.push({cmd, args});
        if (cmd === 'identities_orchestrator_state') {
          return Promise.resolve(
            omitCliProxyInState
              ? {
                  schema: 1,
                  config_persisted: true,
                  config: {...defaultSmartRelayConfig, enabled: true},
                }
              : {
                  schema: 1,
                  config_persisted: true,
                  cli_default_proxy: 'http://127.0.0.1:7899',
                  config: {...defaultSmartRelayConfig, enabled: true},
                },
          );
        }
        if (cmd === 'identities_orchestrator_clear_cooldown') {
          const reqId = (args as {id?: string})?.id;
          return Promise.resolve({
            config_persisted: true,
            cli_default_proxy: 'http://127.0.0.1:7901',
            config: {
              ...defaultSmartRelayConfig,
              enabled: true,
              cooldownUntilSec: {'acc-other': NOW + 900},
              noReturnAccountId: reqId === 'acc-reset' ? null : 'acc-reset',
              noReturnUntilSec: reqId === 'acc-reset' ? 0 : NOW + 600,
            },
          });
        }
        return Promise.resolve(null);
      },
    },
  };
  try {
    await syncNativeSmartRelayConfigIfLive();
    expect(getCliDefaultProxy()).toBe('http://127.0.0.1:7899');
    omitCliProxyInState = true;
    await syncNativeSmartRelayConfigIfLive();
    expect(getCliDefaultProxy()).toBeNull();

    hydrateSmartRelayConfig({
      ...defaultSmartRelayConfig,
      enabled: true,
      cooldownUntilSec: {'acc-1': NOW + 600, 'acc-reset': NOW + 500},
      noReturnAccountId: 'acc-reset',
      noReturnUntilSec: NOW + 600,
    });
    const localAfter = clearAccountCooldown('acc-1');
    expect(localAfter.cooldownUntilSec['acc-1']).toBeUndefined();
    await flushNativeSmartRelaySync();
    expect(getSmartRelayConfig().cooldownUntilSec['acc-other']).toBe(NOW + 900);
    expect(getSmartRelayConfig().cooldownUntilSec['acc-1']).toBeUndefined();
    expect(getCliDefaultProxy()).toBe('http://127.0.0.1:7901');

    // clearAccountCooldown(id, true) when noReturnAccountId === id must STILL invoke clear_cooldown atomically
    invokeCalls.length = 0;
    const afterNoReturn = clearAccountCooldown('acc-reset', true);
    expect(afterNoReturn.noReturnAccountId).toBeNull();
    await flushNativeSmartRelaySync();
    expect(invokeCalls.map(c => c.cmd)).toEqual(['identities_orchestrator_clear_cooldown']);
    expect(invokeCalls[0].args).toEqual({id: 'acc-reset'});
    expect(getSmartRelayConfig().cooldownUntilSec['acc-other']).toBe(NOW + 900);
    expect(getSmartRelayConfig().noReturnAccountId).toBeNull();
  } finally {
    if (prevWin === undefined) delete (globalThis as {window?: unknown}).window;
    else (globalThis as {window?: unknown}).window = prevWin;
    resetSmartRelayConfig();
    expect(getCliDefaultProxy()).toBeUndefined();
  }
});

test('HandoffSummary supports optional handoffReason when provided', () => {
  const summary: HandoffSummary = {
    createdAtSec: NOW,
    dismissed: false,
    handoffMdPath: 'handoff/latest-handoff.md',
    handoffDir: 'handoff',
    sessionCount: 1,
    outputReadyCount: 1,
    interruptedCount: 0,
    externalRunningCount: 0,
    handoffReason: 'rate_limited',
    copyPrompt: 'Read handoff/latest-handoff.md first.',
    items: [],
  };
  expect(summary.handoffReason).toBe('rate_limited');
});
