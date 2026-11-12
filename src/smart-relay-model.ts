/**
 * [INPUT]: Local identity records, passive/online quota snapshots, current timestamp and browser localStorage.
 * [OUTPUT]: Magpie-inspired 3-tier account classification (with rested inferred7d/inferred5h Tier 0 promotion & SoonReset <=24h harvest tie-break bonus), truthful percentage formatter (formatTruthfulPercent), 5h/7d window burn-pace delta (computeWindowPaceDelta), dynamic anti-ping-pong switch margin (computeDynamicSwitchMarginPct / meetsDynamicSwitchMargin), per-account cooldown jail & rate-limit helper (noteRelayAccountRateLimited), one-way noReturnAccountId lock, 5 routing strategies (Smart / Pace / Ordered / LeastUsed / Rotate), 3-state affinityMode (auto / session / manual), preferred-account hysteresis return, rate-limit queue demotion, pool capacity summary with truthful avg5hRemainingPct (summarizeRelayPool), and reactive Smart Relay configuration store.
 * [POS]: Pure frontend multi-account rotation & smart relay model; default OFF, never terminates running claude.exe or bypasses vault isolation.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useSyncExternalStore} from 'react';
import {evaluateQuota, type QuotaInput} from './identity-quota';

export type RelayStrategy = 'smart' | 'ordered' | 'rotate' | 'least_used' | 'pace';
export type RelayRateLimitMode = 'keep_position' | 'sink_to_end';
export type RelayAffinityMode = 'auto' | 'session' | 'manual';
export type RelaySpentThreshold = 90 | 95 | 98 | 100;
export type WindowPaceStatus = 'ahead' | 'on_track' | 'behind' | 'unknown';

export type WindowPaceDelta = {
  status: WindowPaceStatus;
  elapsedPct: number;
  usedPct: number;
  deltaPct: number;
};

export const RELAY_STRATEGIES: readonly RelayStrategy[] = ['smart', 'ordered', 'rotate', 'least_used', 'pace'];
export const RELAY_RATE_LIMIT_MODES: readonly RelayRateLimitMode[] = ['keep_position', 'sink_to_end'];
export const RELAY_AFFINITY_MODES: readonly RelayAffinityMode[] = ['auto', 'session', 'manual'];
export const RELAY_SPENT_THRESHOLDS: readonly RelaySpentThreshold[] = [90, 95, 98, 100];

/**
 * Formats a quota percentage truthfully without misleading rounding near 0% or 100%.
 * - Never rounds 99.0%..99.99% up to '100%' (caps at '99.9%').
 * - Never rounds 0.01%..0.99% down to '0%' (floors at '0.1%').
 */
export function formatTruthfulPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return '--%';
  }
  const v = Math.max(0, Math.min(100, pct));
  if (v >= 100) return '100%';
  if (v <= 0) return '0%';
  if (v >= 99.0) {
    return `${Math.min(99.9, Math.round(v * 10) / 10).toFixed(1)}%`;
  }
  if (v < 1.0) {
    return `${Math.max(0.1, Math.round(v * 10) / 10).toFixed(1)}%`;
  }
  return `${Math.round(v)}%`;
}

/**
 * Computes the burn-pace delta between percentage of quota used and percentage of window time elapsed.
 */
export function computeWindowPaceDelta(
  usedPct: number | null | undefined,
  resetSec: number | null | undefined,
  nowSec: number,
  windowHours: 5 | 168,
): WindowPaceDelta {
  if (
    usedPct === null ||
    usedPct === undefined ||
    !Number.isFinite(usedPct) ||
    typeof resetSec !== 'number' ||
    !Number.isFinite(resetSec) ||
    resetSec <= nowSec
  ) {
    return {status: 'unknown', elapsedPct: 0, usedPct: 0, deltaPct: 0};
  }
  const windowSec = windowHours * 3600;
  const remainingSec = Math.min(windowSec, Math.max(0, resetSec - nowSec));
  const elapsedSec = Math.max(0, windowSec - remainingSec);
  const elapsedPct = Math.max(0, Math.min(100, (elapsedSec / windowSec) * 100));
  const clampedUsed = Math.max(0, Math.min(100, usedPct));
  const deltaPct = Math.round(clampedUsed - elapsedPct);
  const suppressWeeklyLeadInAhead = windowHours === 168 && elapsedSec < 24 * 3600;
  const status: WindowPaceStatus =
    deltaPct >= 10
      ? suppressWeeklyLeadInAhead
        ? 'on_track'
        : 'ahead'
      : deltaPct <= -10
        ? 'behind'
        : 'on_track';
  return {
    status,
    elapsedPct,
    usedPct: clampedUsed,
    deltaPct,
  };
}

/**
 * Computes the minimum remaining percentage required for a candidate to beat an active account
 * without ping-pong switching (`min(activeRem * 2, activeRem + 3)`, capped at 100).
 */
export function computeDynamicSwitchMarginPct(activeRemPct: number): number {
  const clamped = Math.max(0, Math.min(100, activeRemPct));
  return Math.min(100, Math.min(clamped * 2, clamped + 3));
}

/**
 * Checks whether a candidate exceeds the dynamic switch margin on both 5h and 7d windows
 * (or rescues a starving 5h window with >= +20% 5h headroom while maintaining >= 7d headroom).
 */
export function meetsDynamicSwitchMargin(
  candidate: Pick<RelayCandidate, 'rem5h' | 'rem7d'>,
  active: Pick<RelayCandidate, 'rem5h' | 'rem7d'>,
): boolean {
  const meets5h = candidate.rem5h >= computeDynamicSwitchMarginPct(active.rem5h);
  const meets7d = candidate.rem7d >= computeDynamicSwitchMarginPct(active.rem7d);
  if (meets5h && meets7d) return true;
  if (active.rem5h < 10 && candidate.rem5h >= active.rem5h + 20 && candidate.rem7d >= active.rem7d) {
    return true;
  }
  return false;
}

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
  cooldownUntilSec: Record<string, number>;
  noReturnAccountId: string | null;
  noReturnUntilSec: number;
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
  cooldownUntilSec: {},
  noReturnAccountId: null,
  noReturnUntilSec: 0,
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
  const noReturnAccountId =
    typeof input.noReturnAccountId === 'string' && input.noReturnAccountId.trim().length > 0 && input.noReturnAccountId.length <= 80
      ? input.noReturnAccountId.trim()
      : null;
  const noReturnUntilSec =
    typeof input.noReturnUntilSec === 'number' && Number.isFinite(input.noReturnUntilSec) && input.noReturnUntilSec >= 0
      ? Math.floor(input.noReturnUntilSec)
      : defaultSmartRelayConfig.noReturnUntilSec;
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
    cooldownUntilSec: sanitizeRecordMap(input.cooldownUntilSec),
    noReturnAccountId,
    noReturnUntilSec,
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

export function setAccountCooldown(accountId: string, untilSec: number): SmartRelayConfig {
  const cooldownUntilSec = {
    ...currentRelayConfig.cooldownUntilSec,
    [accountId]: Math.max(0, Math.floor(untilSec)),
  };
  return updateSmartRelayConfig({cooldownUntilSec});
}

export function clearAccountCooldown(accountId: string): SmartRelayConfig {
  const cooldownUntilSec = {...currentRelayConfig.cooldownUntilSec};
  delete cooldownUntilSec[accountId];
  return updateSmartRelayConfig({cooldownUntilSec});
}

export function isAccountInCooldown(
  config: SmartRelayConfig,
  accountId: string,
  nowSec: number,
): boolean {
  return (config.cooldownUntilSec?.[accountId] ?? 0) > nowSec;
}

export function noteRelayAccountRateLimited(
  accountId: string,
  retryAtMs?: number | null,
  nowSec = Math.floor(Date.now() / 1000),
): SmartRelayConfig {
  const untilSec =
    typeof retryAtMs === 'number' && Number.isFinite(retryAtMs) && retryAtMs > nowSec * 1000
      ? Math.ceil(retryAtMs / 1000)
      : nowSec + 15 * 60;
  const next = setAccountCooldown(accountId, untilSec);
  if (next.rateLimitMode === 'sink_to_end') {
    const sunkOrder = {...next.sunkOrder};
    const nextSink = Math.max(0, ...Object.values(sunkOrder)) + 1;
    sunkOrder[accountId] = nextSink;
    return updateSmartRelayConfig({sunkOrder});
  }
  return next;
}

export function noteRelayAccountSwitch(
  fromAccountId: string | null,
  toAccountId: string,
  fromReset5hSec?: number | null,
): SmartRelayConfig {
  const nextTick = Math.max(0, ...Object.values(currentRelayConfig.rotationTick)) + 1;
  const rotationTick = {...currentRelayConfig.rotationTick, [toAccountId]: nextTick};
  const sunkOrder = {...currentRelayConfig.sunkOrder};
  if (fromAccountId && currentRelayConfig.rateLimitMode === 'sink_to_end') {
    const nextSink = Math.max(0, ...Object.values(sunkOrder)) + 1;
    sunkOrder[fromAccountId] = nextSink;
  }
  let noReturnAccountId = currentRelayConfig.noReturnAccountId;
  let noReturnUntilSec = currentRelayConfig.noReturnUntilSec;
  if (toAccountId === noReturnAccountId) {
    noReturnAccountId = null;
    noReturnUntilSec = 0;
  }
  if (fromAccountId && typeof fromReset5hSec === 'number' && Number.isFinite(fromReset5hSec) && fromReset5hSec > 0) {
    noReturnAccountId = fromAccountId;
    noReturnUntilSec = Math.floor(fromReset5hSec);
  }
  return updateSmartRelayConfig({rotationTick, sunkOrder, noReturnAccountId, noReturnUntilSec});
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
  no5hLimit?: boolean;
  soonReset24h?: boolean;
  used5h: number;
  used7d: number;
  rem5h: number;
  rem7d: number;
  r5: number | null;
  r7: number | null;
  effectiveUsed: number;
  effectiveRem: number;
  inferred: boolean;
  inCooldown: boolean;
  cooldownRemainingSec: number;
  pace5hDeltaPct: number;
  /**
   * Magpie 3-Tier partition:
   * 0 = fine (healthy, used < lowThreshold 90%, including rested 5h/7d windows)
   * 1 = low (reserve, 90% <= used < spentThreshold)
   * 2 = spent (exhausted, used >= spentThreshold)
   * 3 = unavailable (auth expired, missing quota, cooldown jail, or 0% remaining)
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
  standbyCandidate?: RelayCandidate | null;
  preferredCandidate: RelayCandidate | null;
  shouldRelayNow: boolean;
  relayTriggerKind: 'preferred_recovered' | 'current_spent' | 'better_candidate' | null;
};

export interface RelayPoolSummary {
  includedCount: number;
  readyCount: number;      // tier === 0
  lowCount: number;        // tier === 1
  spentCount: number;      // tier === 2
  unavailableCount: number;// tier === 3
  cooldownCount: number;   // included candidates where inCooldown === true
  avg5hRemainingPct: number; // rounded average of rem5h across included candidates with known quota (tier <= 2), or 0
  avgRem7dPct: number;     // rounded average of rem7d across included candidates with known quota (tier <= 2), or 0
  soonestResetSec: number | null; // minimum positive (reset5h or reset7d > nowSec) among tier 1/2 candidates, or null
}

export function summarizeRelayPool(
  candidates: readonly RelayCandidate[],
  nowSec = 0,
): RelayPoolSummary {
  const included = candidates.filter(c => c.isIncluded);
  let readyCount = 0;
  let lowCount = 0;
  let spentCount = 0;
  let unavailableCount = 0;
  let cooldownCount = 0;
  let sumRem5h = 0;
  let sumRem7d = 0;
  let knownQuotaCount = 0;
  let soonestResetSec: number | null = null;

  for (const c of included) {
    if (c.inCooldown) cooldownCount++;
    if (c.tier === 0) readyCount++;
    else if (c.tier === 1) lowCount++;
    else if (c.tier === 2) spentCount++;
    else unavailableCount++;

    if (c.tier <= 2 && c.known5h && c.known7d) {
      sumRem5h += c.rem5h;
      sumRem7d += c.rem7d;
      knownQuotaCount++;
    }

    if (c.tier === 1 || c.tier === 2) {
      if (typeof c.r5 === 'number' && c.r5 > nowSec) {
        soonestResetSec = soonestResetSec === null ? c.r5 : Math.min(soonestResetSec, c.r5);
      }
      if (typeof c.r7 === 'number' && c.r7 > nowSec) {
        soonestResetSec = soonestResetSec === null ? c.r7 : Math.min(soonestResetSec, c.r7);
      }
    }
  }

  return {
    includedCount: included.length,
    readyCount,
    lowCount,
    spentCount,
    unavailableCount,
    cooldownCount,
    avg5hRemainingPct: knownQuotaCount > 0 ? Math.round(sumRem5h / knownQuotaCount) : 0,
    avgRem7dPct: knownQuotaCount > 0 ? Math.round(sumRem7d / knownQuotaCount) : 0,
    soonestResetSec,
  };
}

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
    const q = evaluateQuota(acc.summary ? {...acc.summary, plan: acc.summary.plan ?? acc.plan} : null, nowSec);
    const isIncluded = !config.excludedAccountIds.includes(acc.id);
    const isPreferred = config.preferredAccountId === acc.id;
    const sinkSeq = config.rateLimitMode === 'sink_to_end' ? (config.sunkOrder[acc.id] ?? 0) : 0;
    const rotationSeq = config.rotationTick[acc.id] ?? 0;
    const inCooldown = isAccountInCooldown(config, acc.id, nowSec);
    const cooldownRemainingSec = inCooldown
      ? Math.max(0, (config.cooldownUntilSec?.[acc.id] ?? 0) - nowSec)
      : 0;
    const pace5hDeltaPct =
      q && q.known5h && !q.no5hLimit ? computeWindowPaceDelta(q.used5h, q.r5, nowSec, 5).deltaPct : 0;
    const subscriptionExpiresHour =
      typeof acc.subscription_expires_at === 'number' && acc.subscription_expires_at > nowSec
        ? Math.floor(acc.subscription_expires_at / 3600)
        : null;

    if (!q || !q.known5h || !q.known7d || acc.auth_status === 'expired') {
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
        no5hLimit: Boolean(q?.no5hLimit),
        soonReset24h: false,
        used5h: q?.used5h ?? 0,
        used7d: q?.used7d ?? 0,
        rem5h: q?.rem5h ?? 0,
        rem7d: q?.rem7d ?? 0,
        r5: q?.r5 ?? null,
        r7: q?.r7 ?? null,
        effectiveUsed: 100,
        effectiveRem: 0,
        inferred: Boolean(q?.inferred7d),
        inCooldown,
        cooldownRemainingSec,
        pace5hDeltaPct,
        tier: 3,
        weeklyPacePctPerHour: 0,
        paceBandIndex: 999,
        sinkSeq,
        rotationSeq,
        subscriptionExpiresHour,
        reasonKey: inCooldown
          ? 'relay.reason.cooldown'
          : acc.auth_status === 'expired'
            ? 'relay.reason.authExpired'
            : 'relay.reason.quotaUnknown',
        reasonParams: inCooldown
          ? {mins: Math.max(1, Math.ceil(cooldownRemainingSec / 60))}
          : undefined,
      };
    }

    const effectiveRem = q.effectiveRem;
    const effectiveUsed = Math.max(0, Math.min(100, 100 - effectiveRem));
    // Magpie WeekLow rule (internal/routes/strategies.go:33-48): in 'smart' and 'pace' modes,
    // an account with plenty of 5h quota (< lowThreshold) whose 7d quota is in the low band (90%..97%)
    // stays in Tier 0 so perishable weekly quota is burned before reset rather than held back.
    const isWeekLowPromoted =
      (config.strategy === 'smart' || config.strategy === 'pace') &&
      q.used5h < lowThreshold &&
      effectiveUsed < effectiveSpentThreshold;
    const tier: 0 | 1 | 2 | 3 =
      inCooldown || effectiveRem <= 0 || q.rem7d <= 0
        ? 3
        : effectiveUsed >= effectiveSpentThreshold
          ? 2
          : effectiveUsed >= lowThreshold && !isWeekLowPromoted
            ? 1
            : 0;

    const hoursLeft7d =
      q.r7 && q.r7 > nowSec ? Math.max(1, (q.r7 - nowSec) / 3600) : 168;
    const weeklyPacePctPerHour = q.rem7d > 0 ? q.rem7d / hoursLeft7d : FRESH_WEEKLY_PACE;
    const soonReset24h =
      q.rem7d >= 15 &&
      q.rem5h > 10 &&
      typeof q.r7 === 'number' &&
      q.r7 - nowSec > 0 &&
      q.r7 - nowSec <= 86400;

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
      no5hLimit: q.no5hLimit,
      soonReset24h,
      used5h: q.used5h,
      used7d: q.used7d,
      rem5h: q.rem5h,
      rem7d: q.rem7d,
      r5: q.r5,
      r7: q.r7,
      effectiveUsed,
      effectiveRem,
      inferred: Boolean(q.inferred7d),
      inCooldown,
      cooldownRemainingSec,
      pace5hDeltaPct,
      tier,
      weeklyPacePctPerHour,
      paceBandIndex: 0,
      sinkSeq,
      rotationSeq,
      subscriptionExpiresHour,
      reasonKey: inCooldown ? 'relay.reason.cooldown' : 'relay.reason.smart',
      reasonParams: inCooldown
        ? {mins: Math.max(1, Math.ceil(cooldownRemainingSec / 60))}
        : undefined,
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

  const isNoReturnLocked = (c: RelayCandidate): boolean =>
    Boolean(
      config.noReturnAccountId === c.id &&
        (config.noReturnUntilSec ?? 0) > nowSec &&
        !c.isCurrent,
    );

  const compareByStrategy = (a: RelayCandidate, b: RelayCandidate): number => {
    // 1. Included accounts always beat excluded accounts
    if (a.isIncluded !== b.isIncluded) return a.isIncluded ? -1 : 1;
    // 2. Magpie 3-Tier partition: fine (0) -> low (1) -> spent (2) -> unavailable (3)
    if (a.tier !== b.tier) return a.tier - b.tier;
    // 2b. One-way no-return lock demotes recently-exhausted account until its 5h window resets
    const aLocked = isNoReturnLocked(a);
    const bLocked = isNoReturnLocked(b);
    if (aLocked !== bLocked) return aLocked ? 1 : -1;
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
        if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        return a.listIndex - b.listIndex;
      }
      case 'least_used': {
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        if (a.rotationSeq !== b.rotationSeq) return a.rotationSeq - b.rotationSeq;
        return a.listIndex - b.listIndex;
      }
      case 'pace': {
        if (a.paceBandIndex !== b.paceBandIndex) return a.paceBandIndex - b.paceBandIndex;
        if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        return a.listIndex - b.listIndex;
      }
      case 'smart':
      default: {
        // SoonReset (<=24h) Harvest Bonus: harvest accounts with >=15% 7d & >10% 5h expiring within 24h before reset
        if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
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

  const sessionSpentThreshold =
    config.spentThresholdPct >= 95 ? 100 : Math.max(effectiveSpentThreshold, 95);
  const sessionLockActive =
    config.affinityMode === 'session' &&
    Boolean(
      currentCandidate &&
        currentCandidate.tier < 3 &&
        currentCandidate.effectiveUsed < sessionSpentThreshold,
    );

  // Check if preferred account is ready to return to (Magpie hysteresis return: used < preferredReturnThresholdPct)
  const preferredReadyToReturn =
    Boolean(
      !sessionLockActive &&
        config.returnToPreferred &&
        preferredCandidate &&
        !preferredCandidate.isCurrent &&
        preferredCandidate.isIncluded &&
        !isNoReturnLocked(preferredCandidate) &&
        preferredCandidate.tier === 0 &&
        !preferredCandidate.inferred &&
        preferredCandidate.effectiveUsed < config.preferredReturnThresholdPct,
    );

  // Pick top saved candidate (skipping no-return locked candidate unless no other Tier 0/1 candidate exists)
  const allSavedEligible = sorted.filter(c => !c.isCurrent && c.isIncluded && c.tier <= 1);
  const unlockedSavedEligible = allSavedEligible.filter(c => !isNoReturnLocked(c));
  const savedEligible = unlockedSavedEligible.length > 0 ? unlockedSavedEligible : allSavedEligible;
  const topStrategySaved = savedEligible[0] ?? null;

  let recommended: RelayCandidate | null = null;
  let relayTriggerKind: RelayEvaluation['relayTriggerKind'] = null;
  let shouldRelayNow = false;

  if (preferredReadyToReturn && preferredCandidate) {
    recommended = preferredCandidate;
    relayTriggerKind = 'preferred_recovered';
    shouldRelayNow =
      config.affinityMode !== 'manual' &&
      Boolean(recommended && (!currentCandidate || recommended.name !== currentCandidate.name || !recommended.isCurrent));
  } else if (topStrategySaved) {
    const currentSpentOrMissing =
      !currentCandidate ||
      currentCandidate.tier >= 3 ||
      (config.affinityMode === 'session'
        ? currentCandidate.effectiveUsed >= sessionSpentThreshold
        : currentCandidate.tier >= 2 || currentCandidate.effectiveUsed >= effectiveSpentThreshold);

    if (currentSpentOrMissing) {
      recommended = topStrategySaved;
      relayTriggerKind = 'current_spent';
      shouldRelayNow =
        config.affinityMode !== 'manual' &&
        Boolean(recommended && (!currentCandidate || recommended.name !== currentCandidate.name || !recommended.isCurrent));
    } else if (!currentCandidate || meetsDynamicSwitchMargin(topStrategySaved, currentCandidate)) {
      recommended = topStrategySaved;
      relayTriggerKind = 'better_candidate';
      shouldRelayNow = false;
    }
  }

  return {
    candidates: sorted,
    currentCandidate,
    recommended,
    standbyCandidate: recommended ?? topStrategySaved,
    preferredCandidate,
    shouldRelayNow,
    relayTriggerKind,
  };
}
