/**
 * [INPUT]: Local identity records, passive/online quota snapshots (including Reset Card grants), current timestamp and browser localStorage.
 * [OUTPUT]: Magpie-inspired 3-tier account classification (with rested inferred7d/inferred5h Tier 0 promotion, 0% remaining Tier 2 spent semantics, subExpired non-next_renewal guard, SoonReset <=24h harvest tie-break bonus & threshold-aware Reset-Card awaitingManualReset demotion), canonical plan slug/manual plan helpers (CANONICAL_MANUAL_PLANS / normalizePlanSlug), truthful percentage formatter (formatTruthfulPercent), 5h/7d window burn-pace delta & exhaustion ETA (computeWindowPaceDelta / computeWindowBurnEta), dynamic anti-ping-pong switch margin (computeDynamicSwitchMarginPct / meetsDynamicSwitchMargin), per-account cooldown jail & rate-limit helper (noteRelayAccountRateLimited), one-way noReturnAccountId lock, 6 routing strategies (Smart / Reset Harvest / Pace / LeastUsed / Ordered / Rotate), 3-state affinityMode (auto / session / manual), expanded RELAY_SPENT_THRESHOLDS (80/85/90/95/98/100, default 98) & maxSameExitConcurrency (default 1, 1..5 valid), current_spent-prioritized evaluation & preferred-account hysteresis return (!inferred && !inferred5h), rate-limit queue demotion, pool capacity summary with totalManualResetsRemaining, awaitingResetCount & cooldown-inclusive soonestResetSec (summarizeRelayPool), 3-tier Reset-Card expiry urgency (computeResetCardExpiryUrgency), slot HTTP proxy validation & >=3 same-exit cluster detection (validateSlotHttpProxy / findSameExitClusterWarning), persistent default CLI model & effort level helpers (RELAY_CLI_MODELS / RELAY_CLI_EFFORTS / formatRelayCliModelEffortArgs), Bash/PowerShell-safe subagent markdown template (buildSubagentMarkdownTemplate), 5-item MRU recent launch directories store (useRelayLaunchDirs), and guarded reactive Smart Relay configuration store synced to native smart_relay_v1.json (syncNativeSmartRelayConfigIfLive / flushNativeSmartRelaySync).
 * [POS]: Pure frontend multi-account rotation & smart relay model; default OFF, never terminates running claude.exe or bypasses vault isolation.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useSyncExternalStore} from 'react';
import type {IdentitySubscriptionMetadata, ManualResetGrant} from './identity-model';
import {evaluateQuota, type QuotaInput} from './identity-quota';

export type RelayStrategy = 'smart' | 'reset_harvest' | 'pace' | 'least_used' | 'ordered' | 'rotate';
export type RelayRateLimitMode = 'keep_position' | 'sink_to_end';
export type RelayAffinityMode = 'auto' | 'session' | 'manual';
export type RelaySpentThreshold = 80 | 85 | 90 | 95 | 98 | 100;
export type RelayMaxSameExitConcurrency = 1 | 2 | 3 | 4 | 5;
export const RELAY_CLI_MODELS = [
  '',
  'claude-opus-5-5',
  'claude-fable-5-2',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'opusplan',
] as const;
export type RelayCliModel = (typeof RELAY_CLI_MODELS)[number];
export const RELAY_CLI_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type RelayCliEffort = (typeof RELAY_CLI_EFFORTS)[number];
export type WindowPaceStatus = 'ahead' | 'on_track' | 'behind' | 'unknown';

export const CANONICAL_MANUAL_PLANS = ['Free', 'Pro', 'Max 5x', 'Max 20x', 'Ultra', 'Team'] as const;
export type CanonicalManualPlan = (typeof CANONICAL_MANUAL_PLANS)[number];
export type PlanTierSlug = 'free' | 'pro' | 'max' | 'ultra' | 'team' | 'unknown';

export function normalizePlanSlug(plan: string | null | undefined): PlanTierSlug {
  if (!plan || typeof plan !== 'string') return 'unknown';
  const norm = plan.trim().toLowerCase();
  if (!norm) return 'unknown';
  if (norm === 'ultra' || norm.includes('ultra')) return 'ultra';
  if (norm === 'free' || norm.startsWith('free ')) return 'free';
  if (norm === 'max' || norm.startsWith('max')) return 'max';
  if (
    norm === 'team' ||
    norm === 'enterprise' ||
    norm.startsWith('team ') ||
    norm.startsWith('enterprise')
  ) {
    return 'team';
  }
  if (norm === 'pro' || norm === 'pro / max' || norm.startsWith('pro')) return 'pro';
  return 'unknown';
}

export type WindowPaceDelta = {
  status: WindowPaceStatus;
  elapsedPct: number;
  usedPct: number;
  deltaPct: number;
};

export type WindowBurnEta = {
  ratePerHour: number;
  etaToTargetSec: number | null;
  remainingWindowSec: number;
  projectedEndPct: number;
  hitsBeforeReset: boolean;
};

export const RELAY_STRATEGIES: readonly RelayStrategy[] = ['smart', 'reset_harvest', 'pace', 'least_used', 'ordered', 'rotate'];
export const RELAY_RATE_LIMIT_MODES: readonly RelayRateLimitMode[] = ['keep_position', 'sink_to_end'];
export const RELAY_AFFINITY_MODES: readonly RelayAffinityMode[] = ['auto', 'session', 'manual'];
export const RELAY_SPENT_THRESHOLDS: readonly RelaySpentThreshold[] = [80, 85, 90, 95, 98, 100];

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
 * Estimates burn rate and time until hitting `targetPct` (default 98%) before window reset.
 * Returns null when elapsed window time < 900s (15m) or usedPct < 10%.
 */
export function computeWindowBurnEta(
  usedPct: number | null | undefined,
  resetSec: number | null | undefined,
  nowSec: number,
  windowHours: 5 | 168,
  targetPct = 98,
): WindowBurnEta | null {
  if (
    usedPct === null ||
    usedPct === undefined ||
    !Number.isFinite(usedPct) ||
    typeof resetSec !== 'number' ||
    !Number.isFinite(resetSec) ||
    !Number.isFinite(nowSec) ||
    resetSec <= nowSec
  ) {
    return null;
  }
  const clampedUsed = Math.max(0, Math.min(100, usedPct));
  if (clampedUsed < 10) {
    return null;
  }
  const windowSec = windowHours * 3600;
  const remainingWindowSec = Math.min(windowSec, Math.max(0, resetSec - nowSec));
  const elapsedSec = windowSec - remainingWindowSec;
  if (elapsedSec < 900) {
    return null;
  }
  const ratePerSec = clampedUsed / elapsedSec;
  const ratePerHour = Math.round(ratePerSec * 3600 * 10) / 10;
  const effectiveTarget =
    typeof targetPct === 'number' && Number.isFinite(targetPct)
      ? Math.max(1, Math.min(100, targetPct))
      : 98;
  const projectedEndPct = Math.max(
    clampedUsed,
    Math.min(100, Math.round((clampedUsed + ratePerSec * remainingWindowSec) * 10) / 10),
  );
  if (clampedUsed >= effectiveTarget) {
    return {
      ratePerHour,
      etaToTargetSec: 0,
      remainingWindowSec,
      projectedEndPct,
      hitsBeforeReset: true,
    };
  }
  const secToTarget = Math.ceil((effectiveTarget - clampedUsed) / ratePerSec);
  const hitsBeforeReset = secToTarget < remainingWindowSec;
  return {
    ratePerHour,
    etaToTargetSec: hitsBeforeReset ? secToTarget : null,
    remainingWindowSec,
    projectedEndPct,
    hitsBeforeReset,
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

export type RelayHandoffMode = 'clean_handoff' | 'fork_resume';
export const RELAY_HANDOFF_MODES: readonly RelayHandoffMode[] = ['clean_handoff', 'fork_resume'];

/** One worker/session row of the latest cross-account handoff checkpoint (camelCase Rust `HandoffItem`). */
export interface HandoffItem {
  id: string;
  status: string;
  title: string;
  outputPath?: string | null;
}

/** Latest cross-account handoff checkpoint written by the native switch pipeline (camelCase Rust `HandoffSummary`). */
export interface HandoffSummary {
  createdAtSec: number;
  dismissed: boolean;
  handoffMdPath: string;
  handoffDir: string;
  sessionCount: number;
  outputReadyCount: number;
  interruptedCount: number;
  externalRunningCount: number;
  copyPrompt: string;
  items: HandoffItem[];
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
  autoContinueOnRelay: boolean;
  relayHandoffMode: RelayHandoffMode;
  maxSameExitConcurrency: RelayMaxSameExitConcurrency;
  defaultCliModel: RelayCliModel;
  defaultCliEffort: RelayCliEffort;
  preferredAccountId: string | null;
  excludedAccountIds: string[];
  slotProxies: Record<string, string>;
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
  autoContinueOnRelay: false,
  relayHandoffMode: 'clean_handoff',
  maxSameExitConcurrency: 1,
  defaultCliModel: '',
  defaultCliEffort: '',
  preferredAccountId: null,
  excludedAccountIds: [],
  slotProxies: {},
  sunkOrder: {},
  rotationTick: {},
  cooldownUntilSec: {},
  noReturnAccountId: null,
  noReturnUntilSec: 0,
};

/**
 * Validates and normalizes an optional per-account slot HTTP proxy endpoint (`http://host:port`).
 * Strictly rejects `socks5://` (Bun #71177 compatibility) and ASCII control characters.
 */
export function validateSlotHttpProxy(raw: string): {ok: boolean; normalized: string; errorKey?: string} {
  if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw)) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {ok: true, normalized: ''};
  }
  if (/^socks(?:5h?|4a?)?:\/\//i.test(trimmed)) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.socks5Forbidden'};
  }
  if (/\s/.test(trimmed) || !/^http:\/\//i.test(trimmed)) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
  const authorityMatch = trimmed.match(/^http:\/\/([^/?#]+)\/?$/i);
  if (!authorityMatch) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
  const portMatch = authorityMatch[1].match(/:(\d{1,5})$/);
  if (!portMatch) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
  const portNum = Number(portMatch[1]);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash ||
      !url.hostname
    ) {
      return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
    }
    return {ok: true, normalized: `http://${url.hostname.toLowerCase()}:${portNum}`};
  } catch {
    return {ok: false, normalized: '', errorKey: 'relay.proxy.invalidHttp'};
  }
}

function normalizeClusterEndpoint(raw: string, fallback = '127.0.0.1:7899'): string {
  const source = raw.trim() || fallback.trim() || '127.0.0.1:7899';
  let cleaned = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  cleaned = (cleaned.split(/[/?#]/)[0] ?? '').trim();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx !== -1) {
    cleaned = cleaned.slice(atIdx + 1).trim();
  }
  cleaned = cleaned.replace(/\/+$/, '').toLowerCase();
  if (!cleaned) {
    return fallback !== '127.0.0.1:7899' ? normalizeClusterEndpoint('127.0.0.1:7899') : ':7899';
  }
  if (/^:\d{1,5}$/.test(cleaned)) {
    return cleaned;
  }
  const loopbackMatch = cleaned.match(/^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/);
  if (loopbackMatch) {
    return `:${loopbackMatch[1]}`;
  }
  return cleaned;
}

/**
 * Detects when >= 3 included accounts in the Smart Relay pool resolve to the same normalized proxy exit endpoint.
 * Normalizes `http://`, `https://`, `socks5://`, `socks5h://`, and loopback hosts (`127.0.0.1`, `localhost`, `[::1]`)
 * to a compact endpoint label (e.g. `:7899` for loopback ports or `host:port` otherwise).
 */
export function findSameExitClusterWarning(
  entries: ReadonlyArray<{id: string; isIncluded: boolean; proxy?: string | null}>,
  slotProxies: Record<string, string>,
  defaultEndpoint = '127.0.0.1:7899',
): {endpoint: string; count: number} | null {
  if (!Array.isArray(entries) || entries.length < 3) return null;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || entry.isIncluded !== true) continue;
    const rawProxy = (slotProxies?.[entry.id] || entry.proxy || defaultEndpoint).trim();
    const endpoint = normalizeClusterEndpoint(rawProxy, defaultEndpoint);
    counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
  }
  let bestEndpoint: string | null = null;
  let bestCount = 0;
  for (const [endpoint, count] of counts.entries()) {
    if (count >= 3 && count > bestCount) {
      bestEndpoint = endpoint;
      bestCount = count;
    }
  }
  return bestEndpoint ? {endpoint: bestEndpoint, count: bestCount} : null;
}

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

function sanitizeSlotProxies(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = typeof key === 'string' ? key.trim() : '';
    if (!id || id.length > 80 || typeof val !== 'string') continue;
    const res = validateSlotHttpProxy(val);
    if (res.ok && res.normalized) {
      out[id] = res.normalized;
      if (Object.keys(out).length >= 200) break;
    }
  }
  return out;
}

export function sanitizeRelayCliModel(raw: unknown): RelayCliModel {
  if (typeof raw !== 'string') return '';
  const norm = raw.trim().toLowerCase();
  if (!norm) return '';
  if ((RELAY_CLI_MODELS as readonly string[]).includes(norm)) {
    return norm as RelayCliModel;
  }
  switch (norm) {
    case 'opus':
    case 'opus[1m]':
    case 'best':
      return 'claude-opus-5-5';
    case 'fable':
    case 'fable[1m]':
      return 'claude-fable-5-2';
    case 'sonnet':
    case 'sonnet[1m]':
      return 'claude-sonnet-5-5';
    case 'haiku':
      return 'claude-haiku-5-5';
    default:
      return '';
  }
}

export function sanitizeRelayCliEffort(raw: unknown): RelayCliEffort {
  if (typeof raw !== 'string') return '';
  const norm = raw.trim().toLowerCase();
  return (RELAY_CLI_EFFORTS as readonly string[]).includes(norm) ? (norm as RelayCliEffort) : '';
}

export function formatRelayCliModelEffortArgs(
  cfg: Pick<SmartRelayConfig, 'defaultCliModel' | 'defaultCliEffort'> | null | undefined,
): string[] {
  if (!cfg) return [];
  const args: string[] = [];
  if (cfg.defaultCliModel) {
    args.push('--model', cfg.defaultCliModel);
  }
  if (cfg.defaultCliEffort) {
    args.push('--effort', cfg.defaultCliEffort);
  }
  return args;
}

export function relayCliModelDisplayLabel(model: RelayCliModel, followLabel: string): string {
  switch (model) {
    case 'claude-opus-5-5':
      return 'Opus 5.5';
    case 'claude-fable-5-2':
      return 'Fable 5.2';
    case 'claude-sonnet-5-5':
      return 'Sonnet 5.5';
    case 'claude-haiku-5-5':
      return 'Haiku 5.5';
    case 'opusplan':
      return 'OpusPlan';
    default:
      return followLabel;
  }
}

export function sanitizeSmartRelayConfig(raw: unknown): SmartRelayConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...defaultSmartRelayConfig,
      excludedAccountIds: [],
      slotProxies: {},
      sunkOrder: {},
      rotationTick: {},
      cooldownUntilSec: {},
    };
  }
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
  const relayHandoffMode: RelayHandoffMode =
    typeof (input.relayHandoffMode ?? input.relay_handoff_mode) === 'string' &&
    (RELAY_HANDOFF_MODES as readonly string[]).includes(String(input.relayHandoffMode ?? input.relay_handoff_mode))
      ? (String(input.relayHandoffMode ?? input.relay_handoff_mode) as RelayHandoffMode)
      : defaultSmartRelayConfig.relayHandoffMode;
  const maxSameExitConcurrency: RelayMaxSameExitConcurrency =
    typeof input.maxSameExitConcurrency === 'number' &&
    Number.isInteger(input.maxSameExitConcurrency) &&
    input.maxSameExitConcurrency >= 1 &&
    input.maxSameExitConcurrency <= 5
      ? (input.maxSameExitConcurrency as RelayMaxSameExitConcurrency)
      : defaultSmartRelayConfig.maxSameExitConcurrency;
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
    autoContinueOnRelay:
      typeof input.autoContinueOnRelay === 'boolean'
        ? input.autoContinueOnRelay
        : defaultSmartRelayConfig.autoContinueOnRelay,
    relayHandoffMode,
    maxSameExitConcurrency,
    defaultCliModel: sanitizeRelayCliModel(input.defaultCliModel ?? input.default_cli_model),
    defaultCliEffort: sanitizeRelayCliEffort(input.defaultCliEffort ?? input.default_cli_effort),
    preferredAccountId,
    excludedAccountIds,
    slotProxies: sanitizeSlotProxies(input.slotProxies),
    sunkOrder: sanitizeRecordMap(input.sunkOrder),
    rotationTick: sanitizeRecordMap(input.rotationTick),
    cooldownUntilSec: sanitizeRecordMap(input.cooldownUntilSec),
    noReturnAccountId,
    noReturnUntilSec,
  };
}

function loadSmartRelayConfig(): SmartRelayConfig {
  if (typeof window === 'undefined') return sanitizeSmartRelayConfig(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeSmartRelayConfig(null);
    return sanitizeSmartRelayConfig(JSON.parse(raw));
  } catch {
    return sanitizeSmartRelayConfig(null);
  }
}

let currentRelayConfig: SmartRelayConfig = loadSmartRelayConfig();
const relayListeners = new Set<() => void>();
let inflightNativeSync: Promise<SmartRelayConfig | null> | null = null;
let inflightRelayWritePromise: Promise<void> | null = null;
let lastNativeRelaySyncError: string | null = null;

export const RELAY_LAUNCH_DIRS_STORAGE_KEY = 'claude-local.relayLaunchDirs.v1';
export const MAX_RELAY_LAUNCH_DIRS = 5;

function normalizeLaunchDirEntry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 520 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed[0].toUpperCase()}:\\`;
  }
  if (trimmed === '/' || trimmed === '\\') return trimmed;
  return trimmed.replace(/[\\/]+$/, '');
}

function sanitizeRelayLaunchDirs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seenLower = new Set<string>();
  for (const item of raw) {
    const norm = normalizeLaunchDirEntry(item);
    if (!norm) continue;
    const key = norm.replace(/\//g, '\\').toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    out.push(norm);
    if (out.length >= MAX_RELAY_LAUNCH_DIRS) break;
  }
  return out;
}

function loadRelayLaunchDirs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RELAY_LAUNCH_DIRS_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeRelayLaunchDirs(JSON.parse(raw));
  } catch {
    return [];
  }
}

let currentLaunchDirs: string[] = loadRelayLaunchDirs();
const launchDirListeners = new Set<() => void>();

function publishRelayLaunchDirs(next: string[]): string[] {
  currentLaunchDirs = sanitizeRelayLaunchDirs(next);
  if (typeof window !== 'undefined') {
    try {
      if (currentLaunchDirs.length === 0) {
        window.localStorage.removeItem(RELAY_LAUNCH_DIRS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(RELAY_LAUNCH_DIRS_STORAGE_KEY, JSON.stringify(currentLaunchDirs));
      }
    } catch {
      /* Keep in-memory MRU list if localStorage is unavailable */
    }
  }
  launchDirListeners.forEach(fn => fn());
  return currentLaunchDirs;
}

export function getRelayLaunchDirs(): string[] {
  return currentLaunchDirs;
}

export function recordRelayLaunchDir(dir: string): string[] {
  const norm = normalizeLaunchDirEntry(dir);
  if (!norm) return currentLaunchDirs;
  const targetKey = norm.replace(/\//g, '\\').toLowerCase();
  const rest = currentLaunchDirs.filter(d => d.replace(/\//g, '\\').toLowerCase() !== targetKey);
  return publishRelayLaunchDirs([norm, ...rest].slice(0, MAX_RELAY_LAUNCH_DIRS));
}

export function removeRelayLaunchDir(dir: string): string[] {
  const norm = normalizeLaunchDirEntry(dir);
  if (!norm) return currentLaunchDirs;
  const targetKey = norm.replace(/\//g, '\\').toLowerCase();
  return publishRelayLaunchDirs(
    currentLaunchDirs.filter(d => d.replace(/\//g, '\\').toLowerCase() !== targetKey),
  );
}

export function clearRelayLaunchDirs(): string[] {
  return publishRelayLaunchDirs([]);
}

export function formatLaunchDirChip(dir: string): {leaf: string; parent: string} {
  const norm = normalizeLaunchDirEntry(dir) ?? dir.trim();
  if (/^[A-Za-z]:\\$/.test(norm) || norm === '/' || norm === '\\') {
    return {leaf: norm, parent: ''};
  }
  const normalizedSlashes = norm.replace(/\//g, '\\');
  const lastSep = normalizedSlashes.lastIndexOf('\\');
  if (lastSep <= 0) {
    return {leaf: norm, parent: ''};
  }
  return {
    leaf: normalizedSlashes.slice(lastSep + 1),
    parent: normalizedSlashes.slice(0, lastSep),
  };
}

export function subscribeRelayLaunchDirs(listener: () => void): () => void {
  launchDirListeners.add(listener);
  return () => launchDirListeners.delete(listener);
}

export function useRelayLaunchDirs(): string[] {
  return useSyncExternalStore(subscribeRelayLaunchDirs, getRelayLaunchDirs, getRelayLaunchDirs);
}

export function canSyncNativeSmartRelay(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & {
    __TAURI_INTERNALS__?: {metadata?: unknown};
    usageFixture?: unknown;
    identityFixture?: unknown;
    localPreviewCommands?: unknown;
  };
  return (
    Boolean(win.__TAURI_INTERNALS__?.metadata) &&
    !('usageFixture' in win) &&
    !('identityFixture' in win) &&
    !('localPreviewCommands' in win)
  );
}

let relayWriteEpoch = 0;
let inflightRelayWrites = 0;

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', event => {
    if (!event.key || event.key === STORAGE_KEY) {
      relayWriteEpoch += 1;
      currentRelayConfig = loadSmartRelayConfig();
      relayListeners.forEach(fn => fn());
    }
    if (!event.key || event.key === RELAY_LAUNCH_DIRS_STORAGE_KEY) {
      currentLaunchDirs = loadRelayLaunchDirs();
      launchDirListeners.forEach(fn => fn());
    }
  });
}

function publishRelayConfig(next: SmartRelayConfig, syncNative = true): SmartRelayConfig {
  const writeEpoch = syncNative ? ++relayWriteEpoch : relayWriteEpoch;
  currentRelayConfig = sanitizeSmartRelayConfig(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentRelayConfig));
    } catch {
      /* Keep in-memory state if storage is unavailable */
    }
    if (syncNative && canSyncNativeSmartRelay()) {
      const payloadConfig = currentRelayConfig;
      lastNativeRelaySyncError = null;
      inflightRelayWrites += 1;
      let writePromise: Promise<void> | null = null;
      writePromise = (async () => {
        try {
          const {invoke} = await import('@tauri-apps/api/core');
          const res = await invoke<unknown>('identities_orchestrator_configure', {config: payloadConfig});
          if (!res || typeof res !== 'object' || writeEpoch !== relayWriteEpoch) return;
          const payload = res as {config?: unknown};
          const rawConfig = 'config' in payload ? payload.config : res;
          if (rawConfig && typeof rawConfig === 'object') {
            hydrateSmartRelayConfig(rawConfig);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastNativeRelaySyncError = msg;
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[smart-relay] native config sync failed:', msg);
          }
        } finally {
          inflightRelayWrites = Math.max(0, inflightRelayWrites - 1);
          if (inflightRelayWritePromise === writePromise) {
            inflightRelayWritePromise = null;
          }
        }
      })();
      inflightRelayWritePromise = writePromise;
    }
  }
  relayListeners.forEach(fn => fn());
  return currentRelayConfig;
}

export function getLastNativeSmartRelaySyncError(): string | null {
  return lastNativeRelaySyncError;
}

export async function flushNativeSmartRelaySync(): Promise<void> {
  if (!canSyncNativeSmartRelay()) return;
  while (inflightRelayWritePromise) {
    const current = inflightRelayWritePromise;
    await current;
  }
}

export function hydrateSmartRelayConfig(raw: unknown): SmartRelayConfig {
  const sanitized = sanitizeSmartRelayConfig(raw);
  if (JSON.stringify(sanitized) === JSON.stringify(currentRelayConfig)) {
    return currentRelayConfig;
  }
  return publishRelayConfig(sanitized, false);
}

/**
 * Reads persisted `smart_relay_v1.json` from the native Tauri host (guarded out in Playwright synthetic fixtures)
 * so Settings and Identities never clobber CLI-written cooldowns, rotation ticks, or strategy edits, while
 * monotonic `relayWriteEpoch` + `inflightRelayWrites` prevent out-of-order background polls from reverting newer local edits.
 */
export function syncNativeSmartRelayConfigIfLive(): Promise<SmartRelayConfig | null> {
  if (!canSyncNativeSmartRelay()) return Promise.resolve(null);
  if (inflightRelayWrites > 0) return Promise.resolve(getSmartRelayConfig());
  if (inflightNativeSync) return inflightNativeSync;
  const syncStartEpoch = relayWriteEpoch;
  inflightNativeSync = import('@tauri-apps/api/core')
    .then(async ({invoke}) => {
      const res = await invoke<unknown>('identities_orchestrator_state');
      if (syncStartEpoch !== relayWriteEpoch || inflightRelayWrites > 0) {
        return getSmartRelayConfig();
      }
      if (!res || typeof res !== 'object') return null;
      const payload = res as {config?: unknown; config_persisted?: unknown};
      if (payload.config_persisted === true) {
        const rawConfig = 'config' in payload ? payload.config : res;
        if (rawConfig && typeof rawConfig === 'object') {
          return hydrateSmartRelayConfig(rawConfig);
        }
        return null;
      }
      if (payload.config_persisted === false) {
        const localCfg = getSmartRelayConfig();
        if (JSON.stringify(localCfg) !== JSON.stringify(sanitizeSmartRelayConfig(null))) {
          await invoke('identities_orchestrator_configure', {config: localCfg}).catch(() => {});
        }
      }
      return getSmartRelayConfig();
    })
    .catch(() => null)
    .finally(() => {
      inflightNativeSync = null;
    });
  return inflightNativeSync;
}

export function getSmartRelayConfig(): SmartRelayConfig {
  return currentRelayConfig;
}

export function updateSmartRelayConfig(patch: Partial<SmartRelayConfig>): SmartRelayConfig {
  return publishRelayConfig({...currentRelayConfig, ...patch});
}

export function resetSmartRelayConfig(): SmartRelayConfig {
  return publishRelayConfig(sanitizeSmartRelayConfig(null));
}

export function setAccountCooldown(accountId: string, untilSec: number): SmartRelayConfig {
  const cooldownUntilSec = {
    ...currentRelayConfig.cooldownUntilSec,
    [accountId]: Math.max(0, Math.floor(untilSec)),
  };
  return updateSmartRelayConfig({cooldownUntilSec});
}

export function clearAccountCooldown(accountId: string, clearNoReturn = false): SmartRelayConfig {
  const cooldownUntilSec = {...currentRelayConfig.cooldownUntilSec};
  delete cooldownUntilSec[accountId];
  const patch: Partial<SmartRelayConfig> = {cooldownUntilSec};
  if (clearNoReturn && currentRelayConfig.noReturnAccountId === accountId) {
    patch.noReturnAccountId = null;
    patch.noReturnUntilSec = 0;
  }
  return updateSmartRelayConfig(patch);
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
  const cooldownUntilSec = {
    ...currentRelayConfig.cooldownUntilSec,
    [accountId]: Math.max(0, Math.floor(untilSec)),
  };
  if (currentRelayConfig.rateLimitMode === 'sink_to_end') {
    const sunkOrder = {...currentRelayConfig.sunkOrder};
    const nextSink = Math.max(0, ...Object.values(sunkOrder)) + 1;
    sunkOrder[accountId] = nextSink;
    return updateSmartRelayConfig({cooldownUntilSec, sunkOrder});
  }
  return updateSmartRelayConfig({cooldownUntilSec});
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
  subscriptionExpiresAt?: number | null;
  billing_date_kind?: IdentitySubscriptionMetadata['billing_date_kind'];
  billingDateKind?: IdentitySubscriptionMetadata['billing_date_kind'];
  isCurrent: boolean;
  listIndex: number;
  summary?: (QuotaInput & IdentitySubscriptionMetadata & {subscription_expires_at?: number | null; auth_has_refresh?: boolean | null; proxy?: string | null}) | null;
};

export type RelayCandidate = {
  id: string;
  name: string;
  email: string | null;
  plan: string | null;
  proxy?: string | null;
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
  inferred5h: boolean;
  inCooldown: boolean;
  cooldownRemainingSec: number;
  pace5hDeltaPct: number;
  manualResetsRemaining: number;
  earliestResetGrantEndsAt: number | null;
  awaitingManualReset: boolean;
  effectiveWeeklyPoolRemPct: number;
  resetHarvestUrgency: number;
  /**
   * Magpie 3-Tier partition:
   * 0 = fine (healthy, used < lowThreshold 90%, including rested 5h/7d windows)
   * 1 = low (reserve, 90% <= used < spentThreshold)
   * 2 = spent (exhausted, used >= spentThreshold or 0% remaining, or awaitingManualReset < 100%)
   * 3 = unavailable (auth expired, missing quota, cooldown jail, or awaitingManualReset at 100% 7d)
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
  awaitingResetCandidates: RelayCandidate[];
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
  totalManualResetsRemaining: number;
  awaitingResetCount: number;
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
  let totalManualResetsRemaining = 0;
  let awaitingResetCount = 0;
  let sumRem5h = 0;
  let sumRem7d = 0;
  let knownQuotaCount = 0;
  let soonestResetSec: number | null = null;

  for (const c of included) {
    if (c.inCooldown) cooldownCount++;
    totalManualResetsRemaining += c.manualResetsRemaining;
    if (c.awaitingManualReset) awaitingResetCount++;
    if (c.tier === 0) readyCount++;
    else if (c.tier === 1) lowCount++;
    else if (c.tier === 2) spentCount++;
    else unavailableCount++;

    if (c.tier <= 2 && c.known5h && c.known7d) {
      sumRem5h += c.rem5h;
      sumRem7d += c.rem7d;
      knownQuotaCount++;
    }

    if (c.tier === 1 || c.tier === 2 || c.inCooldown) {
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
    totalManualResetsRemaining,
    awaitingResetCount,
    avg5hRemainingPct: knownQuotaCount > 0 ? Math.round(sumRem5h / knownQuotaCount) : 0,
    avgRem7dPct: knownQuotaCount > 0 ? Math.round(sumRem7d / knownQuotaCount) : 0,
    soonestResetSec,
  };
}

export type ResetCardExpiryUrgency = 'critical' | 'warning' | 'normal';

export function computeResetCardExpiryUrgency(
  earliestEndsAtSec: number | null | undefined,
  manualResetsRemaining: number,
  nowSec: number,
): ResetCardExpiryUrgency | null {
  if (!Number.isFinite(manualResetsRemaining) || manualResetsRemaining <= 0) return null;
  if (
    typeof earliestEndsAtSec !== 'number' ||
    !Number.isFinite(earliestEndsAtSec) ||
    earliestEndsAtSec <= nowSec
  ) {
    return 'normal';
  }
  const remSec = earliestEndsAtSec - nowSec;
  if (remSec <= 24 * 3600) return 'critical';
  if (remSec <= GRANT_EXPIRING_SOON_SEC) return 'warning';
  return 'normal';
}

/**
 * Returns a copy-ready `.claude/agents/pro-pool-worker.md` definition calling `~/.local/bin/claude-subagent.ps1`
 * to run an isolated secondary slot worker without switching `~/.claude`.
 */
export function buildSubagentMarkdownTemplate(): string {
  return [
    '---',
    'name: pro-pool-worker',
    'description: Delegate scoped subtasks to an isolated secondary Claude Pro/Max slot via ~/.local/bin/claude-subagent.ps1 without switching ~/.claude.',
    'model: claude-haiku-5-5',
    'effort: low',
    'tools: PowerShell, Bash, Read, Grep, Glob',
    '---',
    '',
    '# Pro Pool Worker',
    '',
    'Run secondary-account subtasks in an isolated `CLAUDE_CONFIG_DIR` slot via `~/.local/bin/claude-subagent.ps1`.',
    '',
    '```bash',
    'pwsh -NoProfile -ExecutionPolicy Bypass -File "$HOME/.local/bin/claude-subagent.ps1" -PromptFile "<path-to-task.md>" -SessionTag "<task-tag>" -ReadOnly',
    '```',
    '',
    'Guidelines:',
    '- Before fanning out 3+ parallel subagents, run `pwsh -NoProfile -ExecutionPolicy Bypass -File "$HOME/.local/bin/claude-subagent.ps1" -Status` once to inspect `ready` slots and `Max Same-Exit Concurrency` (default 2), dispatching in waves of 2 to avoid `concurrency_capped` waits.',
    '- Omit `-AccountId` to let the pool auto-select and automatically fail over across healthy Pro slots on 429/auth errors.',
    '- Omit `-ReadOnly` only when the worker owns disjoint file edits.',
    '- Pass `-Resume <session-uuid>` from `[CL-SLOT-TRACE]` for follow-up turns on the same slot.',
    '',
  ].join('\n');
}

const LOW_SHARE_PCT = 90;
const FRESH_WEEKLY_PACE = 100 / 168;
const GRANT_EXPIRING_SOON_SEC = 72 * 3600;

export function extractResetCardInfo(
  summary: (QuotaInput & IdentitySubscriptionMetadata) | null | undefined,
  nowSec: number,
): {manualResetsRemaining: number; earliestResetGrantEndsAt: number | null} {
  const rawRemaining = summary?.manual_resets_remaining;
  const rawRem =
    typeof rawRemaining === 'number' && Number.isFinite(rawRemaining) && rawRemaining > 0
      ? Math.floor(rawRemaining)
      : 0;
  const grants = Array.isArray(summary?.manual_resets_grants) ? summary!.manual_resets_grants : [];
  const positiveGrants = grants.filter(
    (g): g is ManualResetGrant =>
      Boolean(g) &&
      typeof g.resets_left === 'number' &&
      Number.isFinite(g.resets_left) &&
      g.resets_left > 0,
  );
  if (positiveGrants.length > 0) {
    let futureSum = 0;
    let minFutureEnd: number | null = null;
    let hadExpiredPositive = false;
    for (const g of positiveGrants) {
      const left = Math.floor(g.resets_left);
      const endsAt =
        typeof g.ends_at === 'number' && Number.isFinite(g.ends_at) ? Math.floor(g.ends_at) : null;
      if (endsAt === null || endsAt > nowSec) {
        futureSum += left;
        if (endsAt !== null && (minFutureEnd === null || endsAt < minFutureEnd)) {
          minFutureEnd = endsAt;
        }
      } else {
        hadExpiredPositive = true;
      }
    }
    if (futureSum > 0) {
      const count = hadExpiredPositive
        ? rawRem > 0
          ? Math.min(rawRem, futureSum)
          : futureSum
        : rawRem > 0
          ? rawRem
          : futureSum;
      return {
        manualResetsRemaining: count,
        earliestResetGrantEndsAt: minFutureEnd,
      };
    }
    // Strategy A1: never zero positive manual_resets_remaining on local clock alone.
    return {manualResetsRemaining: rawRem, earliestResetGrantEndsAt: null};
  }
  if (rawRem <= 0) {
    return {manualResetsRemaining: 0, earliestResetGrantEndsAt: null};
  }
  const fallbackEnd = summary?.manual_resets_grant_ends_at;
  const earliestResetGrantEndsAt =
    typeof fallbackEnd === 'number' && Number.isFinite(fallbackEnd) && fallbackEnd > nowSec
      ? Math.floor(fallbackEnd)
      : null;
  return {manualResetsRemaining: rawRem, earliestResetGrantEndsAt};
}

/**
 * Evaluates all accounts using Magpie's 3-tier quota classification and the selected routing strategy:
 * - `smart`: Tier 0/1/2 -> SoonReset <=24h -> 72h expiring Reset Card -> soonest 7d renewal hour -> soonest 5h renewal hour -> subscription expiry -> highest effectiveRem -> Reset Card tie-break
 * - `reset_harvest`: Tier 0/1/2 -> positive manualResetsRemaining -> earliest deadline (earliestResetGrantEndsAt ?? r7) hour -> highest resetHarvestUrgency -> r5 hour -> highest effectiveRem (fallback to `smart` when neither holds reset cards)
 * - `pace` (重置前用完): Tier 0/1/2 -> 72h expiring Reset Card -> 10% weekly burn pace bands -> SoonReset <=24h -> highest effectiveRem -> Reset Card tie-break
 * - `least_used` (用量少的优先): Tier 0/1/2 -> lowest effectiveUsed (highest effectiveRem) -> rotationSeq -> listIndex
 * - `ordered` (按顺序): Tier 0/1/2 -> sunkOrder (if sink_to_end) -> user's listIndex
 * - `rotate` (轮流): Tier 0/1/2 -> lowest rotationSeq (least recently rotated to) -> highest effectiveRem -> listIndex
 */
export function evaluateSmartRelay(
  accounts: readonly RelayAccountInput[],
  config: SmartRelayConfig,
  nowSec: number,
): RelayEvaluation {
  const effectiveSpentThreshold: number = config.spentThresholdPct;
  const lowThreshold = Math.min(LOW_SHARE_PCT, effectiveSpentThreshold);

  const rawCandidates: RelayCandidate[] = accounts.map((acc): RelayCandidate => {
    const resolvedPlan = acc.summary?.manual_plan ?? acc.summary?.plan ?? acc.plan ?? null;
    const q = evaluateQuota(acc.summary ? {...acc.summary, plan: resolvedPlan} : null, nowSec);
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
    const rawSubExpiresAt =
      acc.subscriptionExpiresAt ??
      acc.subscription_expires_at ??
      acc.summary?.subscription_expires_at ??
      null;
    const rawBillingKind =
      acc.billingDateKind ??
      acc.billing_date_kind ??
      acc.summary?.billing_date_kind ??
      null;
    const isAutoRenewalOnly =
      rawBillingKind === 'next_renewal' && acc.summary?.subscription_date_source !== 'manual';
    const subExpired = Boolean(
      typeof rawSubExpiresAt === 'number' &&
        Number.isFinite(rawSubExpiresAt) &&
        rawSubExpiresAt > 0 &&
        rawSubExpiresAt <= nowSec &&
        !isAutoRenewalOnly,
    );
    const authBad =
      acc.auth_status === 'missing' ||
      (acc.auth_status === 'expired' && acc.summary?.auth_has_refresh !== true);
    const subscriptionExpiresHour =
      typeof rawSubExpiresAt === 'number' && rawSubExpiresAt > nowSec
        ? Math.floor(rawSubExpiresAt / 3600)
        : null;
    const {manualResetsRemaining, earliestResetGrantEndsAt} = extractResetCardInfo(acc.summary, nowSec);
    const known7d = Boolean(q?.known7d);
    const rem7d = q?.rem7d ?? 0;
    const used7d = q?.used7d ?? 0;
    const effectiveWeeklyPoolRemPct = rem7d + manualResetsRemaining * 100;
    const deadlineSec = earliestResetGrantEndsAt ?? q?.r7 ?? null;
    const hoursToDeadline =
      deadlineSec !== null && deadlineSec > nowSec ? Math.max(1, (deadlineSec - nowSec) / 3600) : 168;
    const resetHarvestUrgency =
      manualResetsRemaining > 0 ? effectiveWeeklyPoolRemPct / hoursToDeadline : 0;
    const awaitingResetThreshold = Math.min(effectiveSpentThreshold, 98);
    const awaitingManualReset =
      !authBad &&
      !subExpired &&
      manualResetsRemaining > 0 &&
      known7d &&
      used7d >= awaitingResetThreshold;

    if (!q || !q.known5h || !q.known7d || authBad || subExpired) {
      return {
        id: acc.id,
        name: acc.name,
        email: acc.email ?? null,
        plan: resolvedPlan,
        proxy: acc.summary?.proxy ?? null,
        isCurrent: acc.isCurrent,
        isPreferred,
        isIncluded,
        listIndex: acc.listIndex,
        known5h: Boolean(q?.known5h),
        known7d,
        no5hLimit: Boolean(q?.no5hLimit),
        soonReset24h: false,
        used5h: q?.used5h ?? 0,
        used7d,
        rem5h: q?.rem5h ?? 0,
        rem7d,
        r5: q?.r5 ?? null,
        r7: q?.r7 ?? null,
        effectiveUsed: 100,
        effectiveRem: 0,
        inferred: Boolean(q?.inferred7d),
        inferred5h: Boolean(q?.inferred5h),
        inCooldown,
        cooldownRemainingSec,
        pace5hDeltaPct,
        manualResetsRemaining,
        earliestResetGrantEndsAt,
        awaitingManualReset,
        effectiveWeeklyPoolRemPct,
        resetHarvestUrgency,
        tier: 3,
        weeklyPacePctPerHour: 0,
        paceBandIndex: 999,
        sinkSeq,
        rotationSeq,
        subscriptionExpiresHour,
        reasonKey: inCooldown
          ? 'relay.reason.cooldown'
          : authBad || subExpired
            ? 'relay.reason.authExpired'
            : awaitingManualReset
              ? 'relay.reason.awaitingManualReset'
              : 'relay.reason.quotaUnknown',
        reasonParams: inCooldown
          ? {mins: Math.max(1, Math.ceil(cooldownRemainingSec / 60))}
          : awaitingManualReset && !authBad && !subExpired
            ? {count: manualResetsRemaining}
            : undefined,
      };
    }

    const effectiveRem = q.effectiveRem;
    const effectiveUsed = Math.max(0, Math.min(100, 100 - effectiveRem));
    // Magpie WeekLow rule (internal/routes/strategies.go:33-48): in 'smart' and 'pace' modes,
    // an account with plenty of 5h quota (< lowThreshold) whose 7d quota is in the low band (90%..97%)
    // stays in Tier 0 so perishable weekly quota is burned before reset rather than held back.
    const isWeekLowPromoted =
      (config.strategy === 'smart' || config.strategy === 'pace' || config.strategy === 'reset_harvest') &&
      q.used5h < lowThreshold &&
      effectiveUsed < effectiveSpentThreshold;
    const tier: 0 | 1 | 2 | 3 =
      inCooldown
        ? 3
        : awaitingManualReset
          ? (q.used7d >= 100 ? 3 : 2)
          : effectiveRem <= 0 || q.rem7d <= 0
            ? 2
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
      plan: resolvedPlan,
      proxy: acc.summary?.proxy ?? null,
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
      inferred5h: Boolean(q.inferred5h),
      inCooldown,
      cooldownRemainingSec,
      pace5hDeltaPct,
      manualResetsRemaining,
      earliestResetGrantEndsAt,
      awaitingManualReset,
      effectiveWeeklyPoolRemPct,
      resetHarvestUrgency,
      tier,
      weeklyPacePctPerHour,
      paceBandIndex: 0,
      sinkSeq,
      rotationSeq,
      subscriptionExpiresHour,
      reasonKey: inCooldown
        ? 'relay.reason.cooldown'
        : awaitingManualReset
          ? 'relay.reason.awaitingManualReset'
          : 'relay.reason.smart',
      reasonParams: inCooldown
        ? {mins: Math.max(1, Math.ceil(cooldownRemainingSec / 60))}
        : awaitingManualReset
          ? {count: manualResetsRemaining}
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
    if (item.inCooldown) continue;
    if (item.awaitingManualReset && item.reasonKey !== 'relay.reason.authExpired') {
      item.reasonKey = 'relay.reason.awaitingManualReset';
      item.reasonParams = {count: item.manualResetsRemaining};
      continue;
    }
    if (item.tier === 3) continue;
    const hours7d = item.r7 && item.r7 > nowSec ? Math.max(1, Math.round((item.r7 - nowSec) / 3600)) : null;
    if (item.isPreferred && item.effectiveUsed < config.preferredReturnThresholdPct) {
      item.reasonKey = 'relay.reason.preferredReady';
      item.reasonParams = {rem: item.effectiveRem};
    } else if (config.strategy === 'reset_harvest' && item.manualResetsRemaining > 0) {
      item.reasonKey = 'relay.reason.resetHarvest';
      item.reasonParams = {count: item.manualResetsRemaining, rem: item.effectiveRem};
    } else if (config.strategy === 'pace' && hours7d !== null) {
      item.reasonKey = 'relay.reason.burnBeforeReset';
      item.reasonParams = {rem: item.rem7d, hours: hours7d};
    } else if ((config.strategy === 'smart' || config.strategy === 'reset_harvest') && hours7d !== null) {
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

  const hasExpiringGrant72h = (c: RelayCandidate): boolean =>
    c.manualResetsRemaining > 0 &&
    c.earliestResetGrantEndsAt !== null &&
    c.earliestResetGrantEndsAt > nowSec &&
    c.earliestResetGrantEndsAt - nowSec <= GRANT_EXPIRING_SOON_SEC;

  const compareHourBucket = (aSec: number | null, bSec: number | null): number => {
    const aHour = aSec && aSec > nowSec ? Math.floor(aSec / 3600) : null;
    const bHour = bSec && bSec > nowSec ? Math.floor(bSec / 3600) : null;
    if (aHour !== bHour) {
      if (aHour === null) return 1;
      if (bHour === null) return -1;
      return aHour - bHour;
    }
    return 0;
  };

  const compareSmartTier0 = (a: RelayCandidate, b: RelayCandidate): number => {
    // SoonReset (<=24h) Harvest Bonus: harvest accounts with >=15% 7d & >10% 5h expiring within 24h before reset
    if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
    // Urgent Reset-Card boost: grant expiring <= 72h OR multi-card pool (manualResetsRemaining >= 2)
    const aUrgentReset = hasExpiringGrant72h(a) || a.manualResetsRemaining >= 2;
    const bUrgentReset = hasExpiringGrant72h(b) || b.manualResetsRemaining >= 2;
    if (aUrgentReset !== bUrgentReset) return aUrgentReset ? -1 : 1;
    if (aUrgentReset && bUrgentReset) {
      const grantCmp = compareHourBucket(a.earliestResetGrantEndsAt, b.earliestResetGrantEndsAt);
      if (grantCmp !== 0) return grantCmp;
      if (b.manualResetsRemaining !== a.manualResetsRemaining) {
        return b.manualResetsRemaining - a.manualResetsRemaining;
      }
    }
    // Magpie Smart: compare 7d renewal hour bucket first, then 5h renewal hour bucket
    const r7Cmp = compareHourBucket(a.r7, b.r7);
    if (r7Cmp !== 0) return r7Cmp;
    const r5Cmp = compareHourBucket(a.r5, b.r5);
    if (r5Cmp !== 0) return r5Cmp;
    if (a.subscriptionExpiresHour !== b.subscriptionExpiresHour) {
      if (a.subscriptionExpiresHour === null) return 1;
      if (b.subscriptionExpiresHour === null) return -1;
      return a.subscriptionExpiresHour - b.subscriptionExpiresHour;
    }
    if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
    if ((a.manualResetsRemaining > 0) !== (b.manualResetsRemaining > 0)) {
      return a.manualResetsRemaining > 0 ? -1 : 1;
    }
    if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
    return a.listIndex - b.listIndex;
  };

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
      case 'reset_harvest': {
        const aHasReset = a.manualResetsRemaining > 0;
        const bHasReset = b.manualResetsRemaining > 0;
        if (aHasReset !== bHasReset) return aHasReset ? -1 : 1;
        if (!aHasReset && !bHasReset) {
          return compareSmartTier0(a, b);
        }
        const deadlineCmp = compareHourBucket(
          a.earliestResetGrantEndsAt ?? a.r7,
          b.earliestResetGrantEndsAt ?? b.r7,
        );
        if (deadlineCmp !== 0) return deadlineCmp;
        if (b.resetHarvestUrgency !== a.resetHarvestUrgency) {
          return b.resetHarvestUrgency - a.resetHarvestUrgency;
        }
        const r5Cmp = compareHourBucket(a.r5, b.r5);
        if (r5Cmp !== 0) return r5Cmp;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        return a.listIndex - b.listIndex;
      }
      case 'pace': {
        const aExp72 = hasExpiringGrant72h(a);
        const bExp72 = hasExpiringGrant72h(b);
        if (aExp72 !== bExp72) return aExp72 ? -1 : 1;
        if (aExp72 && bExp72) {
          const grantCmp = compareHourBucket(a.earliestResetGrantEndsAt, b.earliestResetGrantEndsAt);
          if (grantCmp !== 0) return grantCmp;
        }
        if (a.paceBandIndex !== b.paceBandIndex) return a.paceBandIndex - b.paceBandIndex;
        if (Boolean(a.soonReset24h) !== Boolean(b.soonReset24h)) return a.soonReset24h ? -1 : 1;
        if (b.effectiveRem !== a.effectiveRem) return b.effectiveRem - a.effectiveRem;
        if ((a.manualResetsRemaining > 0) !== (b.manualResetsRemaining > 0)) {
          return a.manualResetsRemaining > 0 ? -1 : 1;
        }
        if (a.inferred !== b.inferred) return a.inferred ? 1 : -1;
        return a.listIndex - b.listIndex;
      }
      case 'smart':
      default: {
        return compareSmartTier0(a, b);
      }
    }
  };

  const sorted = [...rawCandidates].sort(compareByStrategy);
  const currentCandidate = rawCandidates.find(c => c.isCurrent) ?? null;
  const preferredCandidate =
    config.preferredAccountId
      ? (rawCandidates.find(c => c.id === config.preferredAccountId) ?? null)
      : null;
  const awaitingResetCandidates = sorted.filter(c => c.isIncluded && c.awaitingManualReset);

  const sessionSpentThreshold =
    config.spentThresholdPct >= 95 ? 100 : Math.max(effectiveSpentThreshold, 95);
  const sessionLockActive =
    config.affinityMode === 'session' &&
    Boolean(
      currentCandidate &&
        !currentCandidate.awaitingManualReset &&
        currentCandidate.tier < 3 &&
        currentCandidate.effectiveUsed < sessionSpentThreshold,
    );

  // Check if preferred account is ready to return to (Magpie hysteresis return: used < preferredReturnThresholdPct, non-inferred 5h & 7d)
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
        !preferredCandidate.inferred5h &&
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

  const currentSpentOrMissing =
    !currentCandidate ||
    currentCandidate.awaitingManualReset ||
    currentCandidate.tier >= 3 ||
    (config.affinityMode === 'session'
      ? currentCandidate.effectiveUsed >= sessionSpentThreshold
      : currentCandidate.tier >= 2 || currentCandidate.effectiveUsed >= effectiveSpentThreshold);

  const spentTarget =
    preferredReadyToReturn && preferredCandidate ? preferredCandidate : topStrategySaved;

  if (currentSpentOrMissing) {
    if (spentTarget) {
      recommended = spentTarget;
      relayTriggerKind = 'current_spent';
      shouldRelayNow = config.affinityMode !== 'manual' && Boolean(recommended && !recommended.isCurrent);
    }
  } else if (preferredReadyToReturn && preferredCandidate) {
    recommended = preferredCandidate;
    relayTriggerKind = 'preferred_recovered';
    shouldRelayNow = config.affinityMode !== 'manual' && Boolean(recommended && !recommended.isCurrent);
  } else if (topStrategySaved && meetsDynamicSwitchMargin(topStrategySaved, currentCandidate)) {
    recommended = topStrategySaved;
    relayTriggerKind = 'better_candidate';
    shouldRelayNow = false;
  }

  return {
    candidates: sorted,
    currentCandidate,
    recommended,
    standbyCandidate: recommended ?? topStrategySaved,
    preferredCandidate,
    awaitingResetCandidates,
    shouldRelayNow,
    relayTriggerKind,
  };
}
