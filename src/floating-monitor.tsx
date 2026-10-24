/**
 * [INPUT]: 原生 monitor_live_telemetry 零轮询本地遥测、当前外观/玻璃/字体/隐私偏好与 BroadcastChannel 跨窗同步消息。
 * [OUTPUT]: 无边框置顶可折叠「实时额度悬浮监控窗」（FloatingMonitorApp），展示当前账号 5h/7d 双槽进度、燃烧速率与触顶预警。
 * [POS]: 独立桌面悬浮 HUD 视图（?window=monitor）；100% 本地只读遥测，零后台 OAuth 请求，零跨进程内存读取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useCallback, useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useI18n, setLocale, type Locale} from './i18n';
import {
  initializeAppearancePreferences,
  initializePrivacyPreference,
  maskDisplayName,
  maskEmailAddress,
  reloadPreferencesFromStorage,
  usePreferences,
} from './settings-model';
import {
  evaluateQuota,
  evaluateWeeklyPace,
  formatCompactEta,
} from './identity-quota';
import {
  computeMonitorWindowBar,
  deriveMonitorActivityMode,
  formatCompactCount,
  formatExhaustionEta,
  formatVelocityLabel,
  MONITOR_BUS_CHANNEL,
  postMonitorBusMessage,
  recommendedMonitorPollIntervalMs,
  type MonitorBusMessage,
  type MonitorLiveTelemetry,
} from './floating-monitor-model';
import {
  initializeCustomWallpaper,
  reloadCustomWallpaperFromStorage,
  syncCustomWallpaperToDom,
} from './wallpaper-store';
import './floating-monitor.css';

export function FloatingMonitorApp() {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const [telemetry, setTelemetry] = useState<MonitorLiveTelemetry | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [compact, setCompact] = useState(false);

  const fetchTelemetry = useCallback(async () => {
    try {
      const snap = await invoke<MonitorLiveTelemetry>('monitor_live_telemetry');
      setTelemetry(snap);
      setAlwaysOnTop(snap.window.alwaysOnTop);
      setCompact(snap.window.compact);
      setNowSec(Math.floor(Date.now() / 1000));
    } catch {
      // Keep last known snapshot on transient local read contention
    }
  }, []);

  useEffect(() => {
    syncCustomWallpaperToDom();
    void initializeAppearancePreferences();
    void initializeCustomWallpaper();
    void initializePrivacyPreference();
    void invoke<Locale>('ui_language_read')
      .then(next => setLocale(next))
      .catch(() => {});
    void fetchTelemetry();
  }, [fetchTelemetry]);

  const activityMode = deriveMonitorActivityMode(
    telemetry?.running ?? false,
    telemetry?.metrics.latestTurnAtSec,
    nowSec,
  );
  const pollIntervalMs = recommendedMonitorPollIntervalMs(activityMode);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchTelemetry();
    }, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetchTelemetry, pollIntervalMs]);

  useEffect(() => {
    const clockId = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1_000);
    return () => window.clearInterval(clockId);
  }, []);

  useEffect(() => {
    const onStorage = () => {
      reloadPreferencesFromStorage();
      reloadCustomWallpaperFromStorage();
      void fetchTelemetry();
    };
    window.addEventListener('storage', onStorage);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(MONITOR_BUS_CHANNEL);
        channel.onmessage = (event: MessageEvent<MonitorBusMessage>) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'language-updated') {
            setLocale(msg.language);
          }
          if (msg.type === 'appearance-updated' || msg.type === 'privacy-updated') {
            reloadPreferencesFromStorage();
            reloadCustomWallpaperFromStorage();
          }
          void fetchTelemetry();
        };
      } catch {
        channel = null;
      }
    }
    return () => {
      window.removeEventListener('storage', onStorage);
      if (channel) channel.close();
    };
  }, [fetchTelemetry]);

  const handleTogglePin = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      const state = await invoke<{open: boolean; alwaysOnTop: boolean; compact: boolean}>(
        'monitor_window_set_always_on_top',
        {alwaysOnTop: next},
      );
      setAlwaysOnTop(state.alwaysOnTop);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setAlwaysOnTop(!next);
    }
  };

  const handleToggleCompact = async () => {
    const next = !compact;
    setCompact(next);
    try {
      const state = await invoke<{open: boolean; alwaysOnTop: boolean; compact: boolean}>(
        'monitor_window_set_compact',
        {compact: next},
      );
      setCompact(state.compact);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setCompact(!next);
    }
  };

  const handleClose = async () => {
    try {
      const state = await invoke<{open: boolean; alwaysOnTop: boolean; compact: boolean}>(
        'monitor_window_set_open',
        {open: false},
      );
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      void getCurrentWindow().hide();
    }
  };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) return;
    void invoke('monitor_window_start_drag').catch(() => {
      void getCurrentWindow().startDragging();
    });
  };

  const current = telemetry?.current;
  const metrics = telemetry?.metrics;
  const hideAccount = prefs.privacyMask;
  const displayMode = prefs.quotaDisplay;

  const rawTitle =
    telemetry?.activeName ||
    current?.display_name ||
    current?.email ||
    t('monitor.noActiveAccount');
  const maskedTitle = current?.present
    ? current.email && rawTitle === current.email
      ? maskEmailAddress(rawTitle, hideAccount)
      : maskDisplayName(rawTitle, current.email, hideAccount)
    : t('monitor.noActiveAccount');

  const evaluated = evaluateQuota(current, nowSec);
  const bar5h = computeMonitorWindowBar(
    evaluated?.known5h ? evaluated.used5h : current?.quota_5h_used,
  );
  const bar7d = computeMonitorWindowBar(
    evaluated?.known7d ? evaluated.used7d : current?.quota_7d_used,
  );

  const pctLabel5h =
    bar5h.used === null
      ? '—'
      : displayMode === 'used'
        ? `${t('identityCard.used')} ${bar5h.used}%`
        : `${t('identityCard.remaining')} ${bar5h.remaining}%`;

  const pctLabel7d =
    bar7d.used === null
      ? '—'
      : displayMode === 'used'
        ? `${t('identityCard.used')} ${bar7d.used}%`
        : `${t('identityCard.remaining')} ${bar7d.remaining}%`;

  const reset5hCountdown =
    evaluated?.r5 && evaluated.r5 > nowSec
      ? formatCompactEta(evaluated.r5, nowSec)
      : evaluated?.inferred5h || current?.quota_5h_source === 'reset_inferred'
        ? '5h'
        : '';

  const reset7dCountdown =
    evaluated?.r7 && evaluated.r7 > nowSec
      ? formatCompactEta(evaluated.r7, nowSec)
      : evaluated?.inferred7d || current?.quota_7d_source === 'reset_inferred'
        ? '7d'
        : '';

  const weeklyPace =
    bar7d.used !== null && evaluated?.r7
      ? evaluateWeeklyPace(bar7d.used, evaluated.r7, nowSec)
      : null;

  const exhaustionWarn = formatExhaustionEta(metrics?.exhaustionEtaMins, locale);
  const velocityText = formatVelocityLabel(metrics?.tokensPerMin ?? 0);

  return (
    <div className="monitor-hud-shell" data-compact={compact ? 'true' : 'false'}>
      <div
        className="monitor-hud-header"
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
      >
        <div className="monitor-hud-status" data-tauri-drag-region>
          <span
            className={`monitor-hud-dot${activityMode === 'active' ? ' is-active' : ''}`}
            aria-hidden="true"
          />
          <span className="monitor-hud-status-text" data-tauri-drag-region>
            {activityMode === 'active'
              ? `${t('monitor.statusActive')}${telemetry?.clientLabel ? ` · ${telemetry.clientLabel}` : ''}`
              : t('monitor.statusIdle')}
          </span>
        </div>
        <div className="monitor-hud-controls">
          <button
            type="button"
            className="monitor-hud-icon-btn"
            title={t('monitor.refreshNow')}
            aria-label={t('monitor.refreshNow')}
            onClick={() => void fetchTelemetry()}
          >
            ↻
          </button>
          <button
            type="button"
            className="monitor-hud-icon-btn"
            title={t(compact ? 'monitor.expandedMode' : 'monitor.compactMode')}
            aria-label={t(compact ? 'monitor.expandedMode' : 'monitor.compactMode')}
            onClick={() => void handleToggleCompact()}
          >
            {compact ? '▾' : '▴'}
          </button>
          <button
            type="button"
            className={`monitor-hud-icon-btn${alwaysOnTop ? ' is-pinned' : ''}`}
            title={t(alwaysOnTop ? 'monitor.unpinTop' : 'monitor.pinTop')}
            aria-label={t(alwaysOnTop ? 'monitor.unpinTop' : 'monitor.pinTop')}
            onClick={() => void handleTogglePin()}
          >
            📌
          </button>
          <button
            type="button"
            className="monitor-hud-icon-btn"
            title={t('monitor.closeWindow')}
            aria-label={t('monitor.closeWindow')}
            onClick={() => void handleClose()}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="monitor-hud-account-row">
        <span className="monitor-hud-account-name" title={maskedTitle}>
          {maskedTitle}
        </span>
        {current?.plan && (
          <div className="monitor-hud-badges">
            <span className="monitor-hud-badge">{current.plan}</span>
          </div>
        )}
      </div>

      <div className="monitor-hud-windows">
        <div className="monitor-hud-window-card">
          <div className="monitor-hud-window-top">
            <div className="monitor-hud-window-left">
              <span className="monitor-hud-window-tag">5h</span>
              <span className="monitor-hud-window-pct">{pctLabel5h}</span>
              {reset5hCountdown && (
                <span className="monitor-hud-window-reset">· {reset5hCountdown}</span>
              )}
            </div>
            <div className="monitor-hud-window-right">
              <span>{velocityText}</span>
              {exhaustionWarn && (
                <span className="monitor-hud-eta-warn">⚠ {exhaustionWarn}</span>
              )}
            </div>
          </div>
          <div className="monitor-hud-track">
            <div
              className={`monitor-hud-fill tone-${bar5h.tone}`}
              style={{
                width: `${
                  bar5h.used === null
                    ? 0
                    : displayMode === 'used'
                      ? bar5h.used
                      : bar5h.fillWidthPct
                }%`,
              }}
            />
          </div>
        </div>

        {!compact && (
          <div className="monitor-hud-window-card">
            <div className="monitor-hud-window-top">
              <div className="monitor-hud-window-left">
                <span className="monitor-hud-window-tag">7d</span>
                <span className="monitor-hud-window-pct">{pctLabel7d}</span>
                {reset7dCountdown && (
                  <span className="monitor-hud-window-reset">· {reset7dCountdown}</span>
                )}
              </div>
              <div className="monitor-hud-window-right">
                {weeklyPace && !weeklyPace.suppressed && (
                  <span>
                    {weeklyPace.ahead
                      ? t('quota.paceAhead', {
                          delta: weeklyPace.deltaUsedPct,
                          expected:
                            displayMode === 'used'
                              ? weeklyPace.expectedUsedPct
                              : weeklyPace.expectedRemPct,
                        })
                      : t('quota.paceBalanced', {
                          expected:
                            displayMode === 'used'
                              ? weeklyPace.expectedUsedPct
                              : weeklyPace.expectedRemPct,
                        })}
                  </span>
                )}
              </div>
            </div>
            <div className="monitor-hud-track">
              <div
                className={`monitor-hud-fill tone-${bar7d.tone}`}
                style={{
                  width: `${
                    bar7d.used === null
                      ? 0
                      : displayMode === 'used'
                        ? bar7d.used
                        : bar7d.fillWidthPct
                  }%`,
                }}
              />
              {weeklyPace && !weeklyPace.suppressed && (
                <span
                  className="monitor-hud-pace-tick"
                  title={t('quota.paceTickLabel', {
                    expected:
                      displayMode === 'used'
                        ? weeklyPace.expectedUsedPct
                        : weeklyPace.expectedRemPct,
                  })}
                  style={{
                    left: `${
                      displayMode === 'used'
                        ? weeklyPace.expectedUsedPct
                        : weeklyPace.expectedRemPct
                    }%`,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {!compact && (
        <div className="monitor-hud-footer">
          <div className="monitor-hud-metric-pill">
            <span className="monitor-hud-metric-label">{t('monitor.tokens5h')}</span>
            <span className="monitor-hud-metric-value">
              {formatCompactCount(metrics?.tokens5hTotal ?? 0)}
            </span>
          </div>
          <div className="monitor-hud-metric-pill">
            <span className="monitor-hud-metric-label">{t('monitor.cacheHit')}</span>
            <span className="monitor-hud-metric-value">
              {metrics?.cacheHitPct != null ? `${metrics.cacheHitPct}%` : '—'}
            </span>
          </div>
          <div className="monitor-hud-metric-pill">
            <span className="monitor-hud-metric-label">{t('monitor.contextLoad')}</span>
            <span className="monitor-hud-metric-value">
              {metrics?.contextUsedPct != null ? `${metrics.contextUsedPct}%` : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
