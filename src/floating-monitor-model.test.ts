// [INPUT]: Pure floating-monitor-model functions and synthetic telemetry inputs.
// [OUTPUT]: Unit test assertions for activity mode, compact token formatting, burn-rate ETA, and window bar tones.
// [POS]: Bun test suite for src/floating-monitor-model.ts.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import { describe, expect, test } from 'bun:test'
import {
  clampMonitorOpacityPct,
  computeContextMeter,
  computeMonitorWindowBar,
  cycleMonitorOpacityPct,
  deriveMonitorActivityMode,
  formatCompactCount,
  formatCompactExhaustionEta,
  formatExhaustionEta,
  formatMonitorUsd,
  formatVelocityLabel,
  formatWindowResetLabel,
  recommendedMonitorPollIntervalMs,
} from './floating-monitor-model'
import {
  defaultPreferences,
  getPreferences,
  reloadPreferencesFromStorage,
  updatePreferences,
} from './settings-model'
import {
  clearCustomWallpaper,
  getCustomWallpaper,
  reloadCustomWallpaperFromStorage,
  setCustomWallpaper,
} from './wallpaper-store'

describe('floating-monitor-model', () => {
  test('derives active vs idle mode from process status and recent JSONL turn timestamp', () => {
    const now = 1_760_000_000
    expect(deriveMonitorActivityMode(true, undefined, now)).toBe('active')
    expect(deriveMonitorActivityMode(false, now - 60, now)).toBe('active')
    expect(deriveMonitorActivityMode(false, now - 300, now)).toBe('idle')
    expect(deriveMonitorActivityMode(false, undefined, now)).toBe('idle')
    expect(recommendedMonitorPollIntervalMs('active')).toBe(3_000)
    expect(recommendedMonitorPollIntervalMs('idle')).toBe(12_000)
  })

  test('formats compact counts and token velocity labels cleanly', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(845)).toBe('845')
    expect(formatCompactCount(1_420)).toBe('1.4k')
    expect(formatCompactCount(142_600)).toBe('143k')
    expect(formatCompactCount(2_340_000)).toBe('2.3M')
    expect(formatVelocityLabel(1_420)).toBe('1.4k tok/m')
  })

  test('formats exhaustion ETA in both Chinese and English', () => {
    expect(formatExhaustionEta(undefined, 'zh')).toBeNull()
    expect(formatExhaustionEta(45, 'zh')).toBe('约 45m 触顶')
    expect(formatExhaustionEta(45, 'en')).toBe('~45m to limit')
    expect(formatExhaustionEta(95, 'zh')).toBe('约 1h 35m 触顶')
    expect(formatExhaustionEta(95, 'en')).toBe('~1h 35m to limit')
    expect(formatExhaustionEta(120, 'zh')).toBe('约 2h 触顶')
    expect(formatExhaustionEta(120, 'en')).toBe('~2h to limit')
    expect(formatCompactExhaustionEta(70)).toBe('~1h10m')
    expect(formatCompactExhaustionEta(120)).toBe('~2h')
    expect(formatMonitorUsd(0)).toBe('$0.00')
    expect(formatMonitorUsd(0.008)).toBe('<$0.01')
    expect(formatMonitorUsd(1.25)).toBe('$1.25')
    expect(formatMonitorUsd(42.8)).toBe('$42.80')
    expect(clampMonitorOpacityPct(20)).toBe(50)
    expect(clampMonitorOpacityPct(100)).toBe(100)
    expect(cycleMonitorOpacityPct(100)).toBe(88)
    expect(cycleMonitorOpacityPct(60)).toBe(100)
  })

  test('computes remaining percentage and semantic tone for 5h/7d bars', () => {
    expect(computeMonitorWindowBar(undefined)).toEqual({
      used: null,
      remaining: null,
      fillWidthPct: 0,
      tone: 'unknown',
    })
    expect(computeMonitorWindowBar(38)).toEqual({
      used: 38,
      remaining: 62,
      fillWidthPct: 62,
      tone: 'ok',
    })
    expect(computeMonitorWindowBar(80).tone).toBe('warn')
    expect(computeMonitorWindowBar(92).tone).toBe('danger')
  })

  test('computes context meter and window reset labels cleanly', () => {
    expect(computeContextMeter(undefined)).toEqual({
      usedPct: null,
      fillWidthPct: 0,
      tone: 'unknown',
    })
    expect(computeContextMeter(40)).toEqual({
      usedPct: 40,
      fillWidthPct: 40,
      tone: 'ok',
    })
    expect(computeContextMeter(75).tone).toBe('warn')
    expect(computeContextMeter(94).tone).toBe('danger')

    expect(formatWindowResetLabel('14h 11m', false, '7d', 'zh')).toBe('重置 14h 11m')
    expect(formatWindowResetLabel('14h 11m', false, '7d', 'en')).toBe('Reset 14h 11m')
    expect(formatWindowResetLabel('', true, '5h', 'zh')).toBe('重置 5h')
    expect(formatWindowResetLabel('', true, '5h', 'en')).toBe('Reset 5h')
    expect(formatWindowResetLabel('', false, '5h', 'zh')).toBe('—')
  })

  test('cross-window storage reload synchronizes preferences and custom wallpaper', () => {
    const store = new Map<string, string>()
    const prevWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v)
        },
        removeItem: (k: string) => {
          store.delete(k)
        },
      },
    }
    try {
      updatePreferences({ theme: 'light', accent: 'terracotta', glassBlur: 22 })
      store.set(
        'claude-local.preferences.v1',
        JSON.stringify({
          ...defaultPreferences,
          theme: 'dark',
          accent: 'violet',
          glassBlur: 34,
          glassOpacity: 64,
          wallpaperDim: 28,
          quotaDisplay: 'used',
        }),
      )
      const synced = reloadPreferencesFromStorage()
      expect(synced.theme).toBe('dark')
      expect(synced.accent).toBe('violet')
      expect(synced.glassBlur).toBe(34)
      expect(synced.glassOpacity).toBe(64)
      expect(synced.wallpaperDim).toBe(28)
      expect(synced.quotaDisplay).toBe('used')
      expect(getPreferences().accent).toBe('violet')

      clearCustomWallpaper()
      expect(getCustomWallpaper()).toBeNull()
      const sampleRecord = {
        dataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
        suggestedAccent: 'emerald' as const,
        width: 1280,
        height: 720,
        updatedAt: 1_760_000_000_000,
      }
      store.set('claude-local.custom-wallpaper.v1', JSON.stringify(sampleRecord))
      const syncedWp = reloadCustomWallpaperFromStorage()
      expect(syncedWp?.suggestedAccent).toBe('emerald')
      expect(getCustomWallpaper()?.width).toBe(1280)
      setCustomWallpaper({ ...sampleRecord, suggestedAccent: 'amber' })
      expect(getCustomWallpaper()?.suggestedAccent).toBe('amber')
      clearCustomWallpaper()
    } finally {
      ;(globalThis as { window?: unknown }).window = prevWindow
    }
  })
})
