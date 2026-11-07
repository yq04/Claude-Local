// [INPUT]: Pure floating-monitor-model functions and synthetic account-scoped telemetry inputs.
// [OUTPUT]: Assertions for disjoint token composition, window time pace & pace badges, truthful quota percentage labels, unavailable rates, activity mode, compact formatting, opacity and quota window tones.
// [POS]: Bun test suite for src/floating-monitor-model.ts.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import { describe, expect, test } from 'bun:test'
import {
  clampMonitorOpacityPct,
  computeContextMeter,
  computeMonitorBarFillPct,
  computeMonitorWindowBar,
  computeWindowTimePace,
  cycleMonitorOpacityPct,
  deriveMonitorActivityMode,
  formatCompactCount,
  formatCompactExhaustionEta,
  formatExhaustionEta,
  formatMonitorCacheStats,
  formatVelocityLabel,
  formatWindowPaceBadge,
  formatWindowResetLabel,
  monitorTokenComposition,
  readMonitorRelayStandbyHint,
  recommendedMonitorPollIntervalMs,
  writeMonitorRelayStandbyHint,
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
    expect(formatCompactCount(999_600)).toBe('1M')
    expect(formatCompactCount(2_340_000)).toBe('2.3M')
    expect(formatCompactCount(6_080_000_000)).toBe('6.1B')
    expect(formatVelocityLabel(1_420)).toBe('1.4k tok/m')
    expect(formatMonitorCacheStats(undefined)).toEqual({ hitPctText: '—', reuseRatioText: null })
    expect(
      formatMonitorCacheStats({
        available: true,
        tokens5hTotal: 5_763_042,
        tokensPerMin: 336_000,
        requests5h: 20,
        input5h: 42,
        output5h: 106_000,
        cacheWrite5h: 457_000,
        cacheRead5h: 5_200_000,
        cacheHitPct: 92,
        jsonlRevision: 'r1',
      }),
    ).toEqual({ hitPctText: '91.9%', reuseRatioText: '11.4×' })
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
    expect(clampMonitorOpacityPct(20)).toBe(50)
    expect(clampMonitorOpacityPct(100)).toBe(100)
    expect(cycleMonitorOpacityPct(100)).toBe(88)
    expect(cycleMonitorOpacityPct(60)).toBe(100)
  })

  test('keeps unavailable rates distinct from real zero and composes disjoint token counters', () => {
    expect(formatVelocityLabel(undefined)).toBe('—')
    expect(formatVelocityLabel(0)).toBe('0 tok/m')
    const parts = monitorTokenComposition({
      available: true,
      tokens5hTotal: 1_000,
      tokensPerMin: 100,
      requests5h: 2,
      input5h: 100,
      output5h: 200,
      cacheWrite5h: 300,
      cacheRead5h: 400,
      jsonlRevision: 'fixture',
    })
    expect(parts.map(part => part.tokens)).toEqual([100, 200, 300, 400])
    expect(parts.map(part => part.share)).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(monitorTokenComposition(undefined).every(part => part.share === 0)).toBe(true)
  })

  test('computes remaining percentage, truthful labels and semantic tone for 5h/7d bars', () => {
    expect(computeMonitorWindowBar(undefined)).toEqual({
      used: null,
      remaining: null,
      usedLabel: '--%',
      remainingLabel: '--%',
      fillWidthPct: 0,
      tone: 'unknown',
    })
    expect(computeMonitorWindowBar(38)).toEqual({
      used: 38,
      remaining: 62,
      usedLabel: '38%',
      remainingLabel: '62%',
      fillWidthPct: 62,
      tone: 'ok',
    })
    expect(computeMonitorWindowBar(99.4)).toEqual({
      used: 99,
      remaining: 1,
      usedLabel: '99.4%',
      remainingLabel: '0.6%',
      fillWidthPct: 4,
      tone: 'danger',
    })
    expect(computeMonitorWindowBar(99.6)).toEqual({
      used: 100,
      remaining: 0,
      usedLabel: '99.6%',
      remainingLabel: '0.4%',
      fillWidthPct: 4,
      tone: 'danger',
    })
    expect(computeMonitorWindowBar(100)).toEqual({
      used: 100,
      remaining: 0,
      usedLabel: '100%',
      remainingLabel: '0%',
      fillWidthPct: 0,
      tone: 'danger',
    })
    expect(computeMonitorWindowBar(0.4)).toEqual({
      used: 0,
      remaining: 100,
      usedLabel: '0.4%',
      remainingLabel: '99.6%',
      fillWidthPct: 100,
      tone: 'ok',
    })
    expect(computeMonitorWindowBar(80).tone).toBe('warn')
    expect(computeMonitorWindowBar(92).tone).toBe('danger')
    expect(computeMonitorBarFillPct(computeMonitorWindowBar(99.6), 'used')).toBe(96)
    expect(computeMonitorBarFillPct(computeMonitorWindowBar(100), 'used')).toBe(100)
    expect(computeMonitorBarFillPct(computeMonitorWindowBar(0.4), 'used')).toBe(4)
    expect(computeMonitorBarFillPct(computeMonitorWindowBar(0), 'used')).toBe(0)
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

  test('computes 5h/7d window time pace, delta, projected end and tone', () => {
    const now = 1_760_000_000
    const win5h = 5 * 3600

    expect(computeWindowTimePace(null, win5h, 40, now)).toEqual({
      available: false,
      elapsedPct: null,
      paceDeltaPct: null,
      projectedEndPct: null,
      tone: 'unknown',
    })
    expect(computeWindowTimePace(now - 10, win5h, 40, now).available).toBe(false)
    expect(computeWindowTimePace(now + win5h + 60, win5h, 40, now).available).toBe(false)

    // 50% time elapsed, unknown usedPct
    expect(computeWindowTimePace(now + win5h / 2, win5h, null, now)).toEqual({
      available: true,
      elapsedPct: 50,
      paceDeltaPct: null,
      projectedEndPct: null,
      tone: 'unknown',
    })

    // 50% time elapsed, 52% used -> steady (+2%, projected 104%)
    expect(computeWindowTimePace(now + win5h / 2, win5h, 52, now)).toEqual({
      available: true,
      elapsedPct: 50,
      paceDeltaPct: 2,
      projectedEndPct: 104,
      tone: 'steady',
    })

    // 40% time elapsed, 60% used -> ahead (+20%, projected 150%)
    expect(computeWindowTimePace(now + win5h * 0.6, win5h, 60, now)).toEqual({
      available: true,
      elapsedPct: 40,
      paceDeltaPct: 20,
      projectedEndPct: 150,
      tone: 'ahead',
    })

    // 60% time elapsed, 30% used -> safe (-30%, projected 50%)
    expect(computeWindowTimePace(now + win5h * 0.4, win5h, 30, now)).toEqual({
      available: true,
      elapsedPct: 60,
      paceDeltaPct: -30,
      projectedEndPct: 50,
      tone: 'safe',
    })

    // < 5% elapsed suppresses projectedEndPct
    expect(computeWindowTimePace(now + win5h * 0.98, win5h, 10, now)).toEqual({
      available: true,
      elapsedPct: 2,
      paceDeltaPct: 8,
      projectedEndPct: null,
      tone: 'steady',
    })

    // formatWindowPaceBadge in zh and en
    expect(formatWindowPaceBadge(computeWindowTimePace(null, win5h, 40, now), 'zh')).toBeNull()
    expect(formatWindowPaceBadge(computeWindowTimePace(now + win5h / 2, win5h, null, now), 'en')).toBeNull()

    const aheadPace = computeWindowTimePace(now + win5h * 0.6, win5h, 60, now)
    expect(formatWindowPaceBadge(aheadPace, 'zh')).toBe('超前 +20%')
    expect(formatWindowPaceBadge(aheadPace, 'en')).toBe('+20% vs time')

    const safePace = computeWindowTimePace(now + win5h * 0.4, win5h, 30, now)
    expect(formatWindowPaceBadge(safePace, 'zh')).toBe('余量 -30%')
    expect(formatWindowPaceBadge(safePace, 'en')).toBe('-30% vs time')

    const onPace = computeWindowTimePace(now + win5h * 0.5, win5h, 50, now)
    expect(formatWindowPaceBadge(onPace, 'zh')).toBe('匀速')
    expect(formatWindowPaceBadge(onPace, 'en')).toBe('On pace')
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

      writeMonitorRelayStandbyHint({
        enabled: true,
        candidateName: 'Pro Backup',
        candidateEmail: 'backup@example.invalid',
        effectiveRemPct: 92,
        shouldRelayNow: false,
      })
      expect(readMonitorRelayStandbyHint()?.candidateName).toBe('Pro Backup')
      writeMonitorRelayStandbyHint(null)
      expect(readMonitorRelayStandbyHint()).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = prevWindow
    }
  })
})
