/**
 * [INPUT]: Local identity records, passive/online quota snapshots, current timestamp and browser localStorage.
 * [OUTPUT]: Magpie-inspired 3-tier account classification, 5 routing strategies (Smart / Pace / Ordered / LeastUsed / Rotate), preferred-account hysteresis return, rate-limit queue demotion, and reactive Smart Relay configuration store.
 * [POS]: Pure frontend multi-account rotation & smart relay model; default OFF, never terminates running claude.exe or bypasses vault isolation.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useSyncExternalStore} from 'react';
import {evaluateQuota, type QuotaInput} from './identity-quota';

export type RelayStrategy = 'smart' | 'ordered' | 'rotate' | 'least_used' | 'pace';
export type RelayRateLimitMode = 'keep_position' | 'sink_to_end';
export type RelayAffinityMode = 'auto' | 'session' | 'manual';
export type RelaySpentThreshold = 90 | 95 | 98 | 100;

export const RELAY_STRATEGIES: readonly RelayStrategy[] = ['smart', 'ordered', 'rotate', 'least_used', 'pace'];
export const RELAY_RATE_LIMIT_MODES: readonly RelayRateLimitMode[] = ['keep_position', 'sink_to_end'];
export const RELAY_AFFINITY_MODES: readonly RelayAffinityMode[] = ['auto', 'session', 'manual'];
export const RELAY_SPENT_THRESHOLDS: readonly RelaySpentThreshold[] = [90, 95, 98, 100];

export type SmartRelayConfig = {
  enabled: boolean;
  strategy: RelayStrategy;
  rateLimitMode: RelayRateLimitMode;
  affinityMode: RelayAffinityMode;
  spentThresholdPct: RelaySpentThreshold;
  returnToPreferred: boolean;
  preferredReturnThresholdPct: 80 | 85 | 90;
  autoSwitchWhenIdle: boolean;
  preferredAccountId: string | null;
  excludedAccountIds: string[];
  sunkOrder: Record<string, number>;
  rotationTick: Record<string, number>;
};

const STORAGE_KEY = 'claude-local.smart-relay.v1';

export const defaultSmartRelayConfig: SmartRelayConfig = {
  enabled: false,
  strategy: 'smart',
  rateLimitMode: 'keep_position',
  affinityMode: 'auto',
  spentThresholdPct: 98,
  returnToPreferred: true,
  preferredReturnThresholdPct: 90,
  autoSwitchWhenIdle: false,
  preferredAccountId: null,
  excludedAccountIds: [],
  sunkOrder: {},
  rotationTick: {},
};

function sanitizeRecordMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length <= 80 && typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      out[key] = Math.floor(val);
    }
  }
  return out;
}

export function sanitizeSmartRelayConfig(raw: unknown): SmartRelayConfig {
  if (!raw || typeof raw !== 'object') return {...defaultSmartRelayConfig};
  const input = raw as Record<string, unknown>;
  const strategy: RelayStrategy =
    typeof input.strategy === 'string' && (RELAY_STRATEGIES as readonly string[]).includes(input.strategy)
      ? (input.strategy as RelayStrategy)
      : defaultSmartRelayConfig.strategy;
  const rateLimitMode: RelayRateLimitMode =
    typeof input.rateLimitMode === 'string' && (RELAY_RATE_LIMIT_MODES as readonly string[]).includes(input.rateLimitMode)
      ? (input.rateLimitMode as RelayRateLimitMode)
      : defaultSmartRelayConfig.rateLimitMode;
  const affinityMode: RelayAffinityMode =
    typeof input.affinityMode === 'string' && (RELAY_AFFINITY_MODES as readonly string[]).includes(input.affinityMode)
      ? (input.affinityMode as RelayAffinityMode)
      : defaultSmartRelayConfig.affinityMode;
  const spentThresholdPct: RelaySpentThreshold =
    typeof input.spentThresholdPct === 'number' && (RELAY_SPENT_THRESHOLDS as readonly number[]).includes(input.spentThresholdPct)
      ? (input.spentThresholdPct as RelaySpentThreshold)
      : defaultSmartRelayConfig.spentThresholdPct;
  const preferredReturnThresholdPct: 80 | 85 | 90 =
    input.preferredReturnThresholdPct === 80 || input.preferredReturnThresholdPct === 85 || input.preferredReturnThresholdPct === 90
      ? input.preferredReturnThresholdPct
      : defaultSmartRelayConfig.preferredReturnThresholdPct;
  const preferredAccountId =
    typeof input.preferredAccountId === 'string' && input.preferredAccountId.trim().length > 0 && input.preferredAccountId.length <= 80
      ? input.preferredAccountId.trim()
      : null;
  const excludedAccountIds = Array.isArray(input.excludedAccountIds)
    ? Array.from(
        new Set(
          input.excludedAccountIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0 && id.length <= 80,
          ),
        ),
      ).slice(0, 200)
    : [];
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaultSmartRelayConfig.enabled,
    strategy,
    rateLimitMode,
    affinityMode,
    spentThresholdPct,
    returnToPreferred: typeof input.returnToPreferred === 'boolean' ? input.returnToPreferred : defaultSmartRelayConfig.returnToPreferred,
    preferredReturnThresholdPct,
    autoSwitchWhenIdle: typeof input.autoSwitchWhenIdle === 'boolean' ? input.autoSwitchWhenIdle : defaultSmartRelayConfig.autoSwitchWhenIdle,
    preferredAccountId,
    excludedAccountIds,
    sunkOrder: sanitizeRecordMap(input.sunkOrder),
    rotationTick: sanitizeRecordMap(input.rotationTick),
  };
}

function loadSmartRelayConfig(): SmartRelayConfig {
  if (typeof window === 'undefined') return {...defaultSmartRelayConfig};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {...defaultSmartRelayConfig};
    return sanitizeSmartRelayConfig(JSON.parse(raw));
  } catch {
    return {...defaultSmartRelayConfig};
  }
}

let currentRelayConfig: SmartRelayConfig = loadSmartRelayConfig();
const relayListeners = new Set<() => void>();

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', event => {
    if (!event.key || event.key === STORAGE_KEY) {
      currentRelayConfig = loadSmartRelayConfig();
      relayListeners.forEach(fn => fn());
    }
  });
}

function publishRelayConfig(next: SmartRelayConfig): SmartRelayConfig {
  currentRelayConfig = sanitizeSmartRelayConfig(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentRelayConfig));
    } catch {
      /* Keep in-memory state if storage is unavailable */
    }
  }
  relayListeners.forEach(fn => fn());
  return currentRelayConfig;
}

export function getSmartRelayConfig(): SmartRelayConfig {
  return currentRelayConfig;
}

export function updateSmartRelayConfig(patch: Partial<SmartRelayConfig>): SmartRelayConfig {
  return publishRelayConfig({...currentRelayConfig, ...patch});
}

export function resetSmartRelayConfig(): SmartRelayConfig {
  return publishRelayConfig({...defaultSmartRelayConfig});
}

export function noteRelayAccountSwitch(fromAccountId: string | null, toAccountId: string): SmartRelayConfig {
  const nextTick = Math.max(0, ...Object.values(currentRelayConfig.rotationTick)) + 1;
  const rotationTick = {...currentRelayConfig.rotationTick, [toAccountId]: nextTick};
  const sunkOrder = {...currentRelayConfig.sunkOrder};
  if (fromAccountId && currentRelayConfig.rateLimitMode === 'sink_to_end') {
    const nextSink = Math.max(0, ...Object.values(sunkOrder)) + 1;
    sunkOrder[fromAccountId] = nextSink;
  }
  return updateSmartRelayConfig({rotationTick, sunkOrder});
}

export function subscribeSmartRelayConfig(listener: () => void): () => void {
  relayListeners.add(listener);
  return () => relayListeners.delete(listener);
}

export function useSmartRelayConfig(): SmartRelayConfig {
  return useSyncExternalStore(subscribeSmartRelayConfig, getSmartRelayConfig, getSmartRelayConfig);
}

export type RelayAccountInput = {
  id: string;
  name: string;
  email?: string | null;
  plan?: string | null;
  auth_status?: string | null;
  subscription_expires_at?: number | null;
  isCurrent: boolean;
  listIndex: number;
  summary?: QuotaInput | null;
};

export type RelayCandidate = {
  id: string;
  name: string;
  email: string | null;
  plan: string | null;
  isCurrent: boolean;
  isPreferred: boolean;
  isIncluded: boolean;
  listIndex: number;
  known5h: boolean;
  known7d: boolean;
  used5h: number;
  used7d: number;
  rem5h: number;
  rem7d: number;
  r5: number | null;
  r7: number | null;
  effectiveUsed: number;
  effectiveRem: number;
  inferred: boolean;
  /**
   * Magpie 3-Tier partition:
   * 0 = fine (healthy, used < lowThreshold 90%)
   * 1 = low (reserve, 90% <= used < spentThreshold)
   * 2 = spent (exhausted, used >= spentThreshold)
   * 3 = unavailable (auth expired, missing quota, or 7d inferred/exhausted)
   */
  tier: 0 | 1 | 2 | 3;
  weeklyPacePctPerHour: number;
  paceBandIndex: number;
  sinkSeq: number;
  rotationSeq: number;
  subscriptionExpiresHour: number | null;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
};

export type RelayEvaluation = {
  candidates: RelayCandidate[];
  currentCandidate: RelayCandidate | null;
  recommended: RelayCandidate | null;
  preferredCandidate: RelayCandidate | null;
  shouldRelayNow: boolean;
  relayTriggerKind: 'preferred_recovered' | 'current_spent' | 'better_candidate' | null;
};

const LOW_SHARE_PCT = 90;
const FRESH_WEEKLY_PACE = 100 / 168;

/**
 * Evaluates all accounts using Magpie's 3-tier quota classification and the selected routing strategy:
 * - `smart`: Tier 0/1/2 -> soonest 7d renewal hour -> soonest 5h renewal hour -> subscription expiry -> highest effectiveRem
 * - `pace` (重置前用完): Tier 0/1/2 -> 10% weekly burn pace bands (rem7d / max(hoursLeft7d, 1)) -> highest effectiveRem
 * - `least_used` (用量少的优先): Tier 0/1/2 -> lowest effectiveUsed (highest effectiveRem) -> rotationSeq -> listIndex
 * - `ordered` (按顺序): Tier 0/1/2 -> sunkOrder (if sink_to_end) -> user's listIndex
 * - `rotate` (轮流): Tier 0/1/2 -> lowest rotationSeq (least recently rotated to) -> highest effectiveRem -> listIndex
 */
export function evaluateSmartRelay(
  accounts: readonly RelayAccountInput[],
  config: SmartRelayConfig,
  nowSec: number,
): RelayEvaluation {
  const effectiveSpentThreshold: number =
    config.strategy === 'ordered' && config.spentThresholdPct < 100
      ? config.spentThresholdPct
      : config.spentThresholdPct;
  const lowThreshold = Math.min(LOW_SHARE_PCT, effectiveSpentThreshold);

  const rawCandidates: RelayCandidate[] = accounts.map(acc => {
    const q = evaluateQuota(acc.summary, nowSec);
    const isIncluded = !config.excludedAccountIds.includes(acc.id);
    const isPreferred = config.preferredAccountId === acc.id;
    const sinkSeq = config.rateLimitMode === 'sink_to_end' ? (config.sunkOrder[acc.id] ?? 0) : 0;
    const rotationSeq = config.rotationTick[acc.id] ?? 0;
    const subscriptionExpiresHour =
      typeof acc.subscription_expires_at === 'number' && acc.subscription_expires_at > nowSec
        ? Math.floor(acc.subscription_expires_at / 3600)
        : null;

    if (!q || !q.known5h || !q.known7d || q.inferred7d || acc.auth_status === 'expired') {
      return {
        id: acc.id,
        name: acc.name,
        email: acc.email ?? null,
        plan: acc.plan ?? null,
        isCurrent: acc.isCurrent,
        isPreferred,
        isIncluded,
        listIndex: acc.listIndex,
        known5h: Boolean(q?.known5h),
        known7d: Boolean(q?.known7d),
        used5h: q?.used5h ?? 0,
        used7d: q?.used7d ?? 0,
        rem5h: q?.rem5h ?? 0,
        rem7d: q?.rem7d ?? 0,
        r5: q?.r5 ?? null,
        r7: q?.r7 ?? null,
        effectiveUsed: 100,
        effectiveRem: 0,
        inferred: Boolean(q && !q.recommendable),
        tier: 3,
        weeklyPacePctPerHour: 0,
        paceBandIndex: 999,
        sinkSeq,
        rotationSeq,
        subscriptionExpiresHour,
        reasonKey: acc.auth_status === 'expired' ? 'relay.reason.authExpired' : 'relay.reason.quotaUnknown',
      };
    }

    const effectiveRem = q.effectiveRem;
    const effectiveUsed = Math.max(0, Math.min(100, 100 - effectiveRem));
    const tier: 0 | 1 | 2 | 3 =
      effectiveRem <= 0 || q.rem7d <= 0
        ? 3
        : effectiveUsed >= effectiveSpentThreshold
          ? 2
          : effectiveUsed >= lowThreshold
            ? 1
            : 0;

    const hoursLeft7d =
      q.r7 && q.r7 > nowSec ? Math.max(1, (q.r7 - nowSec) / 3600) : 168;
    const weeklyPacePctPerHour = q.rem7d > 0 ? q.rem7d / hoursLeft7d : FRESH_WEEKLY_PACE;

    return {
      id: acc.id,
      name: acc.name,
      email: acc.email ?? null,
      plan: acc.plan ?? null,
      isCurrent: acc.isCurrent,
      isPreferred,
      isIncluded,
      listIndex: acc.listIndex,
      known5h: q.known5h,
      known7d: q.known7d,
      used5h: q.used5h,
      used7d: q.used7d,
      rem5h: q.rem5h,
      rem7d: q.rem7d,
      r5: q.r5,
      r7: q.r7,
      effectiveUsed,
      effectiveRem,
      inferred: !q.recommendable,
      tier,
      weeklyPacePctPerHour,
      paceBandIndex: 0,
      sinkSeq,
      rotationSeq,
      subscriptionExpiresHour,
      reasonKey: 'relay.reason.smart',
    };
  });

  // Compute Magpie 10% pace bands (paceBands in internal/routes/strategies.go:296)
  const fineByPace = [...rawCandidates]
    .filter(c => c.tier <= 1)
    .sort((a, b) => b.weeklyPacePctPerHour - a.weeklyPacePctPerHour);
  let bandIndex = 0;
  let bandTop = fineByPace[0]?.weeklyPacePctPerHour ?? 0;
  for (const item of fineByPace) {
    if (bandTop > 0 && item.weeklyPacePctPerHour < bandTop * 0.9) {
      bandIndex++;
      bandTop = item.weeklyPacePctPerHour;
    }
    item.paceBandIndex = bandIndex;
  }

  // Assign human-readable reason keys per candidate & strategy
  for (const item of rawCandidates) {
    if (item.tier === 3) continue;
    const hours7d = item.r7 && item.r7 > nowSec ? Math.max(1, Math.round((item.r7 - nowSec) / 3600)) : null;
    if (item.isPreferred && item.effectiveUsed < config.preferredReturnThresholdPct) {
      item.reasonKey = 'relay.reason.preferredReady';
      item.reasonParams = {rem: item.effectiveRem};
    } else if (config.strategy === 'pace' && hours7d !== null) {
      item.reasonKey = 'relay.reason.burnBeforeReset';
      item.reasonParams = {rem: item.rem7d, hours: hours7d};
    } else if (config.strategy === 'smart' && hours7d !== null) {
      item.reasonKey = 'relay.reason.soonestReset';
      item.reasonParams = {rem: item.effectiveRem, hours: hours7d};
    } else if (config.strategy === 'least_used') {
      item.reasonKey = 'relay.reason.leastUsed';
      item.reasonParams = {rem: item.effectiveRem};
    } else if (config.strategy === 'rotate') {
      item.reasonKey = 'relay.reason.rotateNext';
      item.reasonParams = {rem: item.effectiveRem};
    } else {
      item.reasonKey = 'relay.reason.orderedNext';
      item.reasonParams = {rem: item.effectiveRem};
    }
  }

  const compareByStrategy = (a: RelayCandidate, b: RelayCandidate): number => {
    // 1. Included accounts always beat excluded accounts
    if (a.isIncluded !== b.isIncluded) return a.isIncluded ? -1 : 1;
    // 2. Magpie 3-Tier partition: fine (0) -> low (1) -> spent (2) -> unavailable (3)
    if (a.tier !== b.tier) return a.tier - b.tier;
    // 3. Rate-limit / exhaustion demotion ('sink_to_end' / '排到最后') within the same tier
    if (config.rateLimitMode === 'sink_to_end' && a.sinkSeq !== b.sinkSeq) {
      return a.sinkSeq - b.sinkSeq;
    }
    // 4. Within Tier 1 (low, 90-98%), Magpie always sorts by lowest used (highest effectiveRem)
    if (a.tier === 1) {
      if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
      if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
      return a.listIndex - b.listIndex;
    }

    // 5. Strategy-specific comparison within Tier 0 (fine)
    switch (config.strategy) {
      case 'ordered': {
        return a.listIndex - b.listIndex;
      }
      case 'rotate': {
        if (a.rotationSeq !== b.rotationSeq) return a.rotationSeq - b.rotationSeq;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        return a.listIndex - b.listIndex;
      }
      case 'least_used': {
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        if (a.rotationSeq !== b.rotationSeq) return a.rotationSeq - b.rotationSeq;
        return a.listIndex - b.listIndex;
      }
      case 'pace': {
        if (a.paceBandIndex !== b.paceBandIndex) return a.paceBandIndex - b.paceBandIndex;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        return a.listIndex - b.listIndex;
      }
      case 'smart':
      default: {
        // Magpie Smart: compare 7d renewal hour bucket first, then 5h renewal hour bucket
        const aR7Hour = a.r7 && a.r7 > nowSec ? Math.floor(a.r7 / 3600) : null;
        const bR7Hour = b.r7 && b.r7 > nowSec ? Math.floor(b.r7 / 3600) : null;
        if (aR7Hour !== bR7Hour) {
          if (aR7Hour === null) return 1;
          if (bR7Hour === null) return -1;
          return aR7Hour - bR7Hour;
        }
        const aR5Hour = a.r5 && a.r5 > nowSec ? Math.floor(a.r5 / 3600) : null;
        const bR5Hour = b.r5 && b.r5 > nowSec ? Math.floor(b.r5 / 3600) : null;
        if (aR5Hour !== bR5Hour) {
          if (aR5Hour === null) return 1;
          if (bR5Hour === null) return -1;
          return aR5Hour - bR5Hour;
        }
        if (a.subscriptionExpiresHour !== b.subscriptionExpiresHour) {
          if (a.subscriptionExpiresHour === null) return 1;
          if (b.subscriptionExpiresHour === null) return -1;
          return a.subscriptionExpiresHour - b.subscriptionExpiresHour;
        }
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        return a.listIndex - b.listIndex;
      }
    }
  };

  const sorted = [...rawCandidates].sort(compareByStrategy);
  const currentCandidate = rawCandidates.find(c => c.isCurrent) ?? null;
  const preferredCandidate =
    config.preferredAccountId
      ? (rawCandidates.find(c => c.id === config.preferredAccountId) ?? null)
      : null;

  // Check if preferred account is ready to return to (Magpie hysteresis return: used < preferredReturnThresholdPct)
  const preferredReadyToReturn =
    Boolean(
      config.returnToPreferred &&
        preferredCandidate &&
        !preferredCandidate.isCurrent &&
        preferredCandidate.isIncluded &&
        preferredCandidate.tier === 0 &&
        preferredCandidate.effectiveUsed < config.preferredReturnThresholdPct,
    );

  // Pick top saved candidate
  const savedEligible = sorted.filter(c => !c.isCurrent && c.isIncluded && c.tier <= 1);
  const topStrategySaved = savedEligible[0] ?? null;

  let recommended: RelayCandidate | null = null;
  let relayTriggerKind: RelayEvaluation['relayTriggerKind'] = null;
  let shouldRelayNow = false;

  if (preferredReadyToReturn && preferredCandidate) {
    recommended = preferredCandidate;
    relayTriggerKind = 'preferred_recovered';
    shouldRelayNow = true;
  } else if (topStrategySaved) {
    const currentSpentOrMissing =
      !currentCandidate ||
      currentCandidate.tier >= 2 ||
      currentCandidate.effectiveUsed >= (config.affinityMode === 'session' ? 100 : effectiveSpentThreshold);

    recommended = topStrategySaved;
    if (currentSpentOrMissing) {
      relayTriggerKind = 'current_spent';
      shouldRelayNow = true;
    } else {
      relayTriggerKind = 'better_candidate';
      shouldRelayNow = false;
    }
  }

  return {
    candidates: sorted,
    currentCandidate,
    recommended,
    preferredCandidate,
    shouldRelayNow,
    relayTriggerKind,
  };
}
