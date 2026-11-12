// [INPUT]: Native monitor_live_telemetry payload, active-account quota windows, and account-scoped shared-ledger token counters.
// [OUTPUT]: Pure token composition/formatting, window time-pace calculation & positive buffer badge formatting, truthful quota labels, HUD opacity persistence, adaptive local polling cadence, and singleton cross-window BroadcastChannel helpers.
// [POS]: Pure model layer for the toggleable Floating Monitor HUD and main-window live telemetry strip; zero network I/O.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import type { Locale } from './i18n'
import type { QuotaSource } from './identity-model'
import { formatTruthfulPercent } from './smart-relay-model'

export { formatTruthfulPercent }

export type MonitorDockEdge = 'left' | 'right' | 'top'

export interface MonitorWindowState {
  open: boolean
  alwaysOnTop: boolean
  compact: boolean
  locked?: boolean
  clickThrough?: boolean
  autoHide?: boolean
  collapsed?: boolean
  dockedEdge?: MonitorDockEdge | null
}

export interface WindowTimePace {
  available: boolean
  elapsedPct: number | null
  paceDeltaPct: number | null
  projectedEndPct: number | null
  tone: 'safe' | 'steady' | 'ahead' | 'unknown'
}

export function computeWindowTimePace(
  resetAtSec: number | null | undefined,
  windowSeconds: number,
  usedPct: number | null | undefined,
  nowSec: number,
): WindowTimePace {
  if (
    !resetAtSec ||
    !Number.isFinite(resetAtSec) ||
    resetAtSec <= nowSec ||
    windowSeconds <= 0
  ) {
    return {
      available: false,
      elapsedPct: null,
      paceDeltaPct: null,
      projectedEndPct: null,
      tone: 'unknown',
    }
  }
  const remainingSec = resetAtSec - nowSec
  if (remainingSec > windowSeconds) {
    return {
      available: false,
      elapsedPct: null,
      paceDeltaPct: null,
      projectedEndPct: null,
      tone: 'unknown',
    }
  }
  const elapsedSec = windowSeconds - remainingSec
  const elapsedPct = Math.max(0, Math.min(100, Math.round((elapsedSec / windowSeconds) * 100)))
  if (usedPct === null || usedPct === undefined || !Number.isFinite(usedPct)) {
    return {
      available: true,
      elapsedPct,
      paceDeltaPct: null,
      projectedEndPct: null,
      tone: 'unknown',
    }
  }
  const clampedUsed = Math.max(0, Math.min(100, Math.round(usedPct)))
  const paceDeltaPct = clampedUsed - elapsedPct
  const suppressWeeklyLeadIn = windowSeconds >= 7 * 86400 && elapsedSec < 86400
  const projectedEndPct =
    elapsedPct >= 5 && !suppressWeeklyLeadIn
      ? Math.min(999, Math.round((clampedUsed / elapsedPct) * 100))
      : null
  const tone: WindowTimePace['tone'] =
    paceDeltaPct >= 15
      ? suppressWeeklyLeadIn
        ? 'steady'
        : 'ahead'
      : paceDeltaPct <= -10
        ? 'safe'
        : 'steady'
  return {
    available: true,
    elapsedPct,
    paceDeltaPct,
    projectedEndPct,
    tone,
  }
}

export function formatWindowPaceBadge(
  pace: WindowTimePace,
  language: Locale = 'zh',
): string | null {
  if (!pace.available || pace.paceDeltaPct === null || !Number.isFinite(pace.paceDeltaPct)) {
    return null
  }
  if (pace.paceDeltaPct > 0) {
    return language === 'en'
      ? `+${pace.paceDeltaPct}% vs time`
      : `超前 +${pace.paceDeltaPct}%`
  }
  if (pace.paceDeltaPct < 0) {
    const bufferPct = Math.abs(pace.paceDeltaPct)
    return language === 'en'
      ? `${bufferPct}% buffer`
      : `余量 ${bufferPct}%`
  }
  return language === 'en' ? 'On pace' : '匀速'
}

export interface LiveUsageMetrics {
  available: boolean
  tokens5hTotal: number
  tokensPerMin: number
  requests5h: number
  input5h: number
  output5h: number
  cacheWrite5h: number
  cacheRead5h: number
  cacheHitPct?: number
  latestModel?: string
  latestTurnAtSec?: number
  jsonlRevision: string
}

export function monitorTokenComposition(metrics: LiveUsageMetrics | undefined) {
  const parts = [
    {kind: 'input', tokens: metrics?.input5h ?? 0},
    {kind: 'output', tokens: metrics?.output5h ?? 0},
    {kind: 'cacheWrite', tokens: metrics?.cacheWrite5h ?? 0},
    {kind: 'cacheRead', tokens: metrics?.cacheRead5h ?? 0},
  ] as const
  const total = parts.reduce((sum, part) => sum + part.tokens, 0)
  return parts.map(part => ({...part, share: total > 0 ? part.tokens / total : 0}))
}

export interface MonitorCurrentAccount {
  present: boolean
  display_name?: string
  email?: string
  organization?: string
  unavailable: boolean
  plan?: string
  auth_status?: string
  proxy?: string
  quota_identity?: string
  quota_observed_at_ms?: number
  quota_source?: QuotaSource
  quota_5h_source?: QuotaSource
  quota_7d_source?: QuotaSource
  quota_5h_observed_at_ms?: number
  quota_7d_observed_at_ms?: number
  quota_5h_used?: number
  quota_5h_reset_at?: number
  quota_no_5h_limit?: boolean
  quota_7d_used?: number
  quota_7d_reset_at?: number
}

export interface MonitorLiveTelemetry {
  observedAtMs: number
  running: boolean
  sessionCount: number
  clientLabel?: string
  activeId: string
  activeName?: string
  current: MonitorCurrentAccount
  metrics: LiveUsageMetrics
  routeProtected: boolean
  window: MonitorWindowState
}

export type MonitorActivityMode = 'active' | 'idle'

export type MonitorBarTone = 'ok' | 'warn' | 'danger' | 'unknown'

export interface MonitorWindowBar {
  used: number | null
  remaining: number | null
  usedLabel: string
  remainingLabel: string
  fillWidthPct: number
  tone: MonitorBarTone
}

export const MONITOR_BUS_CHANNEL = 'claude-local:monitor-bus'
export const MONITOR_OPACITY_STORAGE_KEY = 'claude-local.monitor.opacity.v1'
export const MONITOR_RELAY_STANDBY_STORAGE_KEY = 'claude-local.monitor.relay-standby.v1'
export const MONITOR_OPACITY_PRESETS = [100, 88, 75, 62] as const

export interface MonitorRelayStandbyHint {
  enabled: boolean
  candidateName: string | null
  candidateEmail?: string | null
  effectiveRemPct: number | null
  shouldRelayNow: boolean
}

export type MonitorBusMessage =
  | { type: 'telemetry-updated'; revision?: string }
  | { type: 'quota-ledger-updated'; revision?: string }
  | { type: 'identity-switched' }
  | { type: 'appearance-updated' }
  | { type: 'privacy-updated'; hideAccount: boolean }
  | { type: 'language-updated'; language: Locale }
  | { type: 'window-state'; state: MonitorWindowState }
  | { type: 'relay-standby-updated'; hint: MonitorRelayStandbyHint | null }

export function readMonitorRelayStandbyHint(): MonitorRelayStandbyHint | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(MONITOR_RELAY_STANDBY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MonitorRelayStandbyHint>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.enabled !== 'boolean') return null
    return {
      enabled: parsed.enabled,
      candidateName: typeof parsed.candidateName === 'string' ? parsed.candidateName : null,
      candidateEmail: typeof parsed.candidateEmail === 'string' ? parsed.candidateEmail : null,
      effectiveRemPct:
        typeof parsed.effectiveRemPct === 'number' && Number.isFinite(parsed.effectiveRemPct)
          ? parsed.effectiveRemPct
          : null,
      shouldRelayNow: Boolean(parsed.shouldRelayNow),
    }
  } catch {
    return null
  }
}

export function writeMonitorRelayStandbyHint(hint: MonitorRelayStandbyHint | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    if (!hint) {
      window.localStorage.removeItem(MONITOR_RELAY_STANDBY_STORAGE_KEY)
    } else {
      window.localStorage.setItem(MONITOR_RELAY_STANDBY_STORAGE_KEY, JSON.stringify(hint))
    }
  } catch {
    // Ignore storage errors
  }
}

export function clampMonitorOpacityPct(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 94
  return Math.max(50, Math.min(100, Math.round(value)))
}

export function readMonitorOpacityPct(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 94
  try {
    const raw = window.localStorage.getItem(MONITOR_OPACITY_STORAGE_KEY)
    if (!raw) return 94
    return clampMonitorOpacityPct(Number(raw))
  } catch {
    return 94
  }
}

export function writeMonitorOpacityPct(pct: number): number {
  const clamped = clampMonitorOpacityPct(pct)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(MONITOR_OPACITY_STORAGE_KEY, String(clamped))
    } catch {
      // Ignore storage quota errors
    }
  }
  return clamped
}

export function cycleMonitorOpacityPct(current: number): number {
  const clamped = clampMonitorOpacityPct(current)
  const idx = MONITOR_OPACITY_PRESETS.findIndex(p => Math.abs(p - clamped) <= 3)
  const nextIdx = idx === -1 ? 0 : (idx + 1) % MONITOR_OPACITY_PRESETS.length
  return MONITOR_OPACITY_PRESETS[nextIdx]
}

export function deriveMonitorActivityMode(
  running: boolean,
  latestTurnAtSec: number | undefined,
  nowSec: number,
): MonitorActivityMode {
  if (running) return 'active'
  if (
    typeof latestTurnAtSec === 'number' &&
    Number.isFinite(latestTurnAtSec) &&
    nowSec >= latestTurnAtSec &&
    nowSec - latestTurnAtSec <= 180
  ) {
    return 'active'
  }
  return 'idle'
}

export function recommendedMonitorPollIntervalMs(mode: MonitorActivityMode): number {
  return mode === 'active' ? 3_000 : 12_000
}

export function formatCompactCount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '0'
  }
  const rounded = Math.round(value)
  if (rounded < 1_000) {
    return String(rounded)
  }
  if (rounded < 999_500) {
    const k = rounded / 1_000
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`
  }
  if (rounded < 999_500_000) {
    const m = rounded / 1_000_000
    return `${m >= 100 ? Math.round(m) : Number(m.toFixed(1))}M`
  }
  const b = rounded / 1_000_000_000
  return `${b >= 100 ? Math.round(b) : Number(b.toFixed(1))}B`
}

export function formatMonitorCacheStats(metrics: LiveUsageMetrics | undefined): {
  hitPctText: string
  reuseRatioText: string | null
} {
  if (!metrics || !metrics.available) {
    return { hitPctText: '—', reuseRatioText: null }
  }
  const prompt = (metrics.input5h ?? 0) + (metrics.cacheWrite5h ?? 0) + (metrics.cacheRead5h ?? 0)
  if (prompt <= 0) {
    return {
      hitPctText: metrics.cacheHitPct != null ? `${metrics.cacheHitPct}%` : '—',
      reuseRatioText: null,
    }
  }
  const rawPct = (metrics.cacheRead5h / prompt) * 100
  const hitPctText =
    rawPct >= 99.95
      ? '100%'
      : Math.abs(rawPct - Math.round(rawPct)) < 0.05
        ? `${Math.round(rawPct)}%`
        : `${rawPct.toFixed(1)}%`
  const reuseRatioText =
    metrics.cacheWrite5h > 0 && metrics.cacheRead5h > 0
      ? `${(metrics.cacheRead5h / metrics.cacheWrite5h).toFixed(1)}×`
      : null
  return { hitPctText, reuseRatioText }
}

export function formatVelocityLabel(tokensPerMin: number | undefined | null): string {
  if (tokensPerMin == null || !Number.isFinite(tokensPerMin)) return '—'
  return `${formatCompactCount(tokensPerMin)} tok/m`
}

export function formatExhaustionEta(
  etaMins: number | undefined | null,
  language: Locale = 'zh',
): string | null {
  if (typeof etaMins !== 'number' || !Number.isFinite(etaMins) || etaMins <= 0) {
    return null
  }
  const totalMins = Math.max(1, Math.round(etaMins))
  if (totalMins < 60) {
    return language === 'en' ? `~${totalMins}m to limit` : `约 ${totalMins}m 触顶`
  }
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (mins === 0) {
    return language === 'en' ? `~${hours}h to limit` : `约 ${hours}h 触顶`
  }
  return language === 'en'
    ? `~${hours}h ${mins}m to limit`
    : `约 ${hours}h ${mins}m 触顶`
}

export function formatCompactExhaustionEta(
  etaMins: number | undefined | null,
): string | null {
  if (typeof etaMins !== 'number' || !Number.isFinite(etaMins) || etaMins <= 0) {
    return null
  }
  const totalMins = Math.max(1, Math.round(etaMins))
  if (totalMins < 60) {
    return `~${totalMins}m`
  }
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  return mins === 0 ? `~${hours}h` : `~${hours}h${mins}m`
}

export interface MonitorContextMeter {
  usedPct: number | null
  fillWidthPct: number
  tone: MonitorBarTone
}

export function computeMonitorWindowBar(usedPct: number | undefined | null): MonitorWindowBar {
  if (typeof usedPct !== 'number' || !Number.isFinite(usedPct)) {
    return {
      used: null,
      remaining: null,
      usedLabel: formatTruthfulPercent(null),
      remainingLabel: formatTruthfulPercent(null),
      fillWidthPct: 0,
      tone: 'unknown',
    }
  }
  const clampedUsed = Math.max(0, Math.min(100, usedPct))
  const clampedRemaining = 100 - clampedUsed
  const used = Math.max(0, Math.min(100, Math.round(clampedUsed)))
  const remaining = 100 - used
  const usedLabel = formatTruthfulPercent(clampedUsed)
  const remainingLabel = formatTruthfulPercent(clampedRemaining)
  const tone: MonitorBarTone =
    used >= 90 ? 'danger' : used >= 75 ? 'warn' : 'ok'
  return {
    used,
    remaining,
    usedLabel,
    remainingLabel,
    fillWidthPct: clampedRemaining <= 0 ? 0 : Math.max(4, remaining),
    tone,
  }
}

export function computeMonitorBarFillPct(
  bar: MonitorWindowBar,
  displayMode: 'remaining' | 'used',
): number {
  if (bar.used === null) return 0
  if (displayMode === 'remaining') return bar.fillWidthPct
  if (bar.usedLabel === '0%') return 0
  if (bar.usedLabel === '100%') return 100
  return Math.max(4, Math.min(96, bar.used))
}

export function computeContextMeter(contextUsedPct: number | undefined | null): MonitorContextMeter {
  if (typeof contextUsedPct !== 'number' || !Number.isFinite(contextUsedPct)) {
    return {
      usedPct: null,
      fillWidthPct: 0,
      tone: 'unknown',
    }
  }
  const usedPct = Math.max(0, Math.min(100, Math.round(contextUsedPct)))
  const tone: MonitorBarTone =
    usedPct >= 90 ? 'danger' : usedPct >= 70 ? 'warn' : 'ok'
  return {
    usedPct,
    fillWidthPct: usedPct === 0 ? 0 : Math.max(8, usedPct),
    tone,
  }
}

export function formatWindowResetLabel(
  countdown: string | undefined | null,
  inferred: boolean,
  windowTag: '5h' | '7d',
  language: Locale = 'zh',
): string {
  const prefix = language === 'en' ? 'Reset' : '重置'
  const trimmed = (countdown ?? '').trim()
  if (trimmed.length > 0) {
    return `${prefix} ${trimmed}`
  }
  if (inferred) {
    return `${prefix} ${windowTag}`
  }
  return '—'
}

let sharedMonitorBusChannel: BroadcastChannel | null = null

export function postMonitorBusMessage(message: MonitorBusMessage): void {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    if (!sharedMonitorBusChannel) {
      sharedMonitorBusChannel = new BroadcastChannel(MONITOR_BUS_CHANNEL)
    }
    sharedMonitorBusChannel.postMessage(message)
  } catch {
    sharedMonitorBusChannel = null
  }
}
