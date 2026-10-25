/**
 * [INPUT]: 原生 monitor_live_telemetry 零轮询本地遥测、当前外观/玻璃/字体/隐私偏好与 BroadcastChannel 跨窗同步消息。
 * [OUTPUT]: 无边框置顶固定尺寸「实时额度悬浮监控窗」（FloatingMonitorApp），采用 Token Monitor 双列并排 5h/7d 进度条、会话上下文微表与双宫格速率磁贴。
 * [POS]: 独立桌面悬浮 HUD 视图（?window=monitor）；100% 本地只读遥测，零后台 OAuth 请求，零跨进程内存读取，固定窗口尺寸且禁止双击最大化。
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
  computeContextMeter,
  computeMonitorWindowBar,
  deriveMonitorActivityMode,
  formatCompactCount,
  formatExhaustionEta,
  formatVelocityLabel,
  formatWindowResetLabel,
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
    if (event.button !== 0 || event.detail > 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, [data-no-drag]')) return;
    void invoke('monitor_window_start_drag').catch(() => {
      void getCurrentWindow().startDragging();
    });
  };

  const handleBlockDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
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
      : '';
  const reset5hInferred = Boolean(
    evaluated?.inferred5h || current?.quota_5h_source === 'reset_inferred',
  );
  const reset5hLabel = formatWindowResetLabel(
    reset5hCountdown,
    reset5hInferred,
    '5h',
    locale,
  );

  const reset7dCountdown =
    evaluated?.r7 && evaluated.r7 > nowSec
      ? formatCompactEta(evaluated.r7, nowSec)
      : '';
  const reset7dInferred = Boolean(
    evaluated?.inferred7d || current?.quota_7d_source === 'reset_inferred',
  );
  const reset7dLabel = formatWindowResetLabel(
    reset7dCountdown,
    reset7dInferred,
    '7d',
    locale,
  );

  const weeklyPace =
    bar7d.used !== null && evaluated?.r7
      ? evaluateWeeklyPace(bar7d.used, evaluated.r7, nowSec)
      : null;

  const contextMeter = computeContextMeter(metrics?.contextUsedPct);
  const exhaustionWarn = formatExhaustionEta(metrics?.exhaustionEtaMins, locale);
  const velocityText = formatVelocityLabel(metrics?.tokensPerMin ?? 0);
  const sessionModelLabel =
    metrics?.latestModel ||
    (activityMode === 'active'
      ? telemetry?.clientLabel || 'Claude CLI'
      : t('monitor.localZeroPollingBadge'));

  return (
    <div
      className="monitor-hud-shell"
      data-compact={compact ? 'true' : 'false'}
      onDoubleClick={handleBlockDoubleClick}
    >
      <header
        className="monitor-hud-header"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleBlockDoubleClick}
      >
        <div className="monitor-hud-status">
          <span className="monitor-hud-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path
                d="M8 1.25v13.5M1.25 8h13.5M3.22 3.22l9.56 9.56M12.78 3.22L3.22 12.78M5.42 1.76l5.16 12.48M1.76 10.58l12.48-5.16"
                stroke="currentColor"
                strokeWidth="1.45"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span
            className={`monitor-hud-dot${activityMode === 'active' ? ' is-active' : ''}`}
            aria-hidden="true"
          />
          <span className="monitor-hud-status-text">
            {activityMode === 'active'
              ? `${t('monitor.statusActive')}${telemetry?.clientLabel ? ` · ${telemetry.clientLabel}` : ''}`
              : t('monitor.statusIdle')}
          </span>
        </div>
        <div className="monitor-hud-controls" data-no-drag>
          <button
            type="button"
            className="monitor-hud-icon-btn"
            title={t('monitor.refreshNow')}
            aria-label={t('monitor.refreshNow')}
            onClick={() => void fetchTelemetry()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M13.25 8A5.25 5.25 0 1 1 11.7 4.28M13.25 2.75v2.6h-2.6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`monitor-hud-icon-btn${compact ? ' is-active-mode' : ''}`}
            title={t(compact ? 'monitor.expandedMode' : 'monitor.compactMode')}
            aria-label={t(compact ? 'monitor.expandedMode' : 'monitor.compactMode')}
            onClick={() => void handleToggleCompact()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              {compact ? (
                <path
                  d="M2.5 4.25h11M2.5 8h11M2.5 11.75h11"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              ) : (
                <rect
                  x="2.5"
                  y="3.5"
                  width="11"
                  height="9"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              )}
            </svg>
          </button>
          <button
            type="button"
            className={`monitor-hud-icon-btn${alwaysOnTop ? ' is-pinned' : ''}`}
            title={t(alwaysOnTop ? 'monitor.unpinTop' : 'monitor.pinTop')}
            aria-label={t(alwaysOnTop ? 'monitor.unpinTop' : 'monitor.pinTop')}
            onClick={() => void handleTogglePin()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M9.8 2.4 13.6 6.2 12.2 7.6 10.4 6.8 7.5 9.7 8.3 11.5 6.9 12.9 4.5 10.5 2.1 12.9M6.3 5.6 9.8 2.4"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="monitor-hud-icon-btn"
            title={t('monitor.closeWindow')}
            aria-label={t('monitor.closeWindow')}
            onClick={() => void handleClose()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.45"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="monitor-hud-account-row"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleBlockDoubleClick}
      >
        <div className="monitor-hud-account-ident">
          <span className="monitor-hud-account-name" title={maskedTitle}>
            {maskedTitle}
          </span>
          {current?.present && (
            <span className="monitor-hud-account-check" aria-hidden="true">
              ✓
            </span>
          )}
        </div>
        {current?.plan && (
          <div className="monitor-hud-badges">
            <span className="monitor-hud-badge">{current.plan}</span>
          </div>
        )}
      </div>

      <section className="monitor-limit-windows" aria-label={t('monitor.title')}>
        <div className="monitor-limit-window">
          <div className="monitor-limit-text">
            <span className="monitor-limit-label">5h</span>
            <span className="monitor-limit-pct">{pctLabel5h}</span>
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
          <div className="monitor-limit-reset">
            <span className="monitor-limit-reset-text">{reset5hLabel}</span>
            {exhaustionWarn && (
              <span className="monitor-hud-eta-warn" title={exhaustionWarn}>
                ⚠ {exhaustionWarn}
              </span>
            )}
          </div>
        </div>

        <div className="monitor-limit-window">
          <div className="monitor-limit-text">
            <span className="monitor-limit-label">7d</span>
            <span className="monitor-limit-pct">{pctLabel7d}</span>
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
          <div className="monitor-limit-reset">
            <span className="monitor-limit-reset-text">{reset7dLabel}</span>
          </div>
        </div>
      </section>

      <div className="monitor-feathered-divider" aria-hidden="true" />

      {!compact ? (
        <div className="monitor-hud-detail-body">
          <div className="monitor-session-strip">
            <div className="monitor-session-left">
              <span
                className={`monitor-session-glyph${activityMode === 'active' ? ' is-active' : ''}`}
                aria-hidden="true"
              >
                {activityMode === 'active' ? '✻' : '⊙'}
              </span>
              <span className="monitor-session-model" title={sessionModelLabel}>
                {sessionModelLabel}
              </span>
              <span className="monitor-session-reqs">
                · {metrics?.requests5h ?? 0} reqs
              </span>
            </div>
            <div
              className={`monitor-session-context tone-${contextMeter.tone}`}
              title={`${t('monitor.contextLoad')}: ${contextMeter.usedPct != null ? `${contextMeter.usedPct}%` : '—'}`}
            >
              <span className="monitor-context-meter" aria-hidden="true">
                <span
                  className="monitor-context-meter-fill"
                  style={{width: `${contextMeter.fillWidthPct}%`}}
                />
              </span>
              <span className="monitor-context-pct">
                {contextMeter.usedPct != null ? `${contextMeter.usedPct}%` : '200k —'}
              </span>
            </div>
          </div>

          <div className="monitor-usage-tiles">
            <div className="monitor-usage-tile">
              <span className="monitor-usage-label">{t('monitor.tokens5h')}</span>
              <span className="monitor-usage-value">
                {formatCompactCount(metrics?.tokens5hTotal ?? 0)}
              </span>
              <span className="monitor-usage-sub">
                {t('monitor.cacheHit')}{' '}
                {metrics?.cacheHitPct != null ? `${metrics.cacheHitPct}%` : '—'}
              </span>
            </div>
            <div className="monitor-usage-tile">
              <span className="monitor-usage-label">{t('monitor.velocity')}</span>
              <span className="monitor-usage-value">{velocityText}</span>
              <span className="monitor-usage-sub">
                {metrics?.burnRatePctHr != null
                  ? t('monitor.burnRate', {rate: metrics.burnRatePctHr})
                  : t('monitor.routeProtected')}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="monitor-hud-compact-body">
          <div className="monitor-usage-tiles is-compact-overview">
            <div className="monitor-usage-tile">
              <span className="monitor-usage-label">{t('monitor.window5h')}</span>
              <span className="monitor-usage-value">
                {bar5h.used === null
                  ? '—'
                  : displayMode === 'used'
                    ? `${bar5h.used}%`
                    : `${bar5h.remaining}%`}
              </span>
              <span className="monitor-usage-sub">{reset5hLabel}</span>
            </div>
            <div className="monitor-usage-tile">
              <span className="monitor-usage-label">{t('monitor.window7d')}</span>
              <span className="monitor-usage-value">
                {bar7d.used === null
                  ? '—'
                  : displayMode === 'used'
                    ? `${bar7d.used}%`
                    : `${bar7d.remaining}%`}
              </span>
              <span className="monitor-usage-sub">{reset7dLabel}</span>
            </div>
          </div>
          <div className="monitor-compact-status-row">
            <span className="monitor-compact-shield">
              ✓ {t('monitor.routeProtected')} · {t('monitor.localZeroPollingBadge')}
            </span>
            <span className="monitor-compact-velocity">{velocityText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
