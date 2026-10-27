// [INPUT]: Native monitor_live_telemetry payload, active account quota windows, and local JSONL velocity/cost metrics.
// [OUTPUT]: Pure formatting, burn-rate ETA evaluation, USD cost formatting, HUD opacity persistence, adaptive local polling cadence, and cross-window BroadcastChannel helpers.
// [POS]: Pure model layer for the toggleable Floating Monitor HUD and main-window live telemetry strip; zero network I/O.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import type { Locale } from './i18n'
import type { QuotaSource } from './identity-model'

export type MonitorDockEdge = 'left' | 'right' | 'top'

export interface MonitorWindowState {
  open: boolean
  alwaysOnTop: boolean
  compact: boolean
  locked?: boolean
  autoHide?: boolean
  collapsed?: boolean
  dockedEdge?: MonitorDockEdge | null
}

export interface LiveUsageMetrics {
  tokens5hTotal: number
  tokensPerMin: number
  requests5h: number
  cost5hUsd?: number
  cacheSavings5hUsd?: number
  cacheHitPct?: number
  contextUsedPct?: number
  latestModel?: string
  latestTurnAtSec?: number
  burnRatePctHr?: number
  exhaustionEtaMins?: number
  jsonlRevision: string
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
  fillWidthPct: number
  tone: MonitorBarTone
}

export const MONITOR_BUS_CHANNEL = 'claude-local:monitor-bus'
export const MONITOR_OPACITY_STORAGE_KEY = 'claude-local.monitor.opacity.v1'
export const MONITOR_OPACITY_PRESETS = [100, 88, 75, 62] as const

export type MonitorBusMessage =
  | { type: 'telemetry-updated'; revision?: string }
  | { type: 'appearance-updated' }
  | { type: 'privacy-updated'; hideAccount: boolean }
  | { type: 'language-updated'; language: Locale }
  | { type: 'window-state'; state: MonitorWindowState }

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
  if (rounded < 1_000_000) {
    const k = rounded / 1_000
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`
  }
  const m = rounded / 1_000_000
  return `${m >= 100 ? Math.round(m) : Number(m.toFixed(1))}M`
}

export function formatVelocityLabel(tokensPerMin: number | undefined | null): string {
  return `${formatCompactCount(tokensPerMin)} tok/m`
}

export function formatMonitorUsd(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '$0.00'
  }
  if (value < 0.01) {
    return '<$0.01'
  }
  if (value < 100) {
    return `$${value.toFixed(2)}`
  }
  return `$${Math.round(value)}`
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
      fillWidthPct: 0,
      tone: 'unknown',
    }
  }
  const used = Math.max(0, Math.min(100, Math.round(usedPct)))
  const remaining = 100 - used
  const tone: MonitorBarTone =
    used >= 90 ? 'danger' : used >= 75 ? 'warn' : 'ok'
  return {
    used,
    remaining,
    fillWidthPct: remaining === 0 ? 0 : Math.max(4, remaining),
    tone,
  }
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

export function postMonitorBusMessage(message: MonitorBusMessage): void {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(MONITOR_BUS_CHANNEL)
    channel.postMessage(message)
    channel.close()
  } catch {
    // Ignore environments without BroadcastChannel support
  }
}
