/**
 * [INPUT]: 原生 monitor_live_telemetry 零轮询本地遥测、当前外观/壁纸/玻璃/字体/隐私偏好与 BroadcastChannel 跨窗同步消息。
 * [OUTPUT]: 无边框置顶多态「实时额度悬浮监控窗」（FloatingMonitorApp），融合 Token Monitor 与 Claude-Local 玻璃美学，支持置顶固定、位置锁定、边缘磁吸、贴边自动隐藏胶囊、无级透明度调节及 5h/7d 进度 + 5h API 等效美元花费遥测。
 * [POS]: 独立桌面悬浮 HUD 视图（?window=monitor）；100% 本地只读遥测，零后台 OAuth 请求，零跨进程内存读取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useCallback, useEffect, useRef, useState} from 'react';
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
  MONITOR_BUS_CHANNEL,
  MONITOR_OPACITY_PRESETS,
  postMonitorBusMessage,
  readMonitorOpacityPct,
  recommendedMonitorPollIntervalMs,
  writeMonitorOpacityPct,
  type MonitorBusMessage,
  type MonitorDockEdge,
  type MonitorLiveTelemetry,
  type MonitorWindowState,
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
  const [locked, setLocked] = useState(false);
  const [autoHide, setAutoHide] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dockedEdge, setDockedEdge] = useState<MonitorDockEdge | null>('right');
  const [opacityPct, setOpacityPct] = useState<number>(readMonitorOpacityPct);
  const [opacityMenuOpen, setOpacityMenuOpen] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);

  const applyWindowState = useCallback((w: MonitorWindowState) => {
    setAlwaysOnTop(w.alwaysOnTop);
    setCompact(w.compact);
    if (typeof w.locked === 'boolean') setLocked(w.locked);
    if (typeof w.autoHide === 'boolean') setAutoHide(w.autoHide);
    if (typeof w.collapsed === 'boolean') setCollapsed(w.collapsed);
    if (w.dockedEdge !== undefined) setDockedEdge(w.dockedEdge ?? null);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      const snap = await invoke<MonitorLiveTelemetry>('monitor_live_telemetry');
      setTelemetry(snap);
      applyWindowState(snap.window);
      setNowSec(Math.floor(Date.now() / 1000));
    } catch {
      // Keep last known snapshot on transient local read contention
    }
  }, [applyWindowState]);

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
    telemetry?.metrics?.latestTurnAtSec,
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
      setOpacityPct(readMonitorOpacityPct());
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
          if (msg.type === 'window-state') {
            applyWindowState(msg.state);
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
  }, [applyWindowState, fetchTelemetry]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  const handleTogglePin = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_always_on_top', {
        alwaysOnTop: next,
      });
      applyWindowState(state);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setAlwaysOnTop(!next);
    }
  };

  const handleToggleLock = async () => {
    const next = !locked;
    setLocked(next);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_locked', {
        locked: next,
      });
      applyWindowState(state);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setLocked(!next);
    }
  };

  const handleToggleAutoHide = async () => {
    const next = !autoHide;
    setAutoHide(next);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_auto_hide', {
        autoHide: next,
      });
      applyWindowState(state);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setAutoHide(!next);
    }
  };

  const handleSetCollapsed = async (nextCollapsed: boolean) => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setCollapsed(nextCollapsed);
    if (nextCollapsed) setOpacityMenuOpen(false);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_collapsed', {
        collapsed: nextCollapsed,
      });
      applyWindowState(state);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setCollapsed(!nextCollapsed);
    }
  };

  const handleToggleCompact = async () => {
    const next = !compact;
    setCompact(next);
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_compact', {
        compact: next,
      });
      applyWindowState(state);
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      setCompact(!next);
    }
  };

  const handleClose = async () => {
    try {
      const state = await invoke<MonitorWindowState>('monitor_window_set_open', {
        open: false,
      });
      postMonitorBusMessage({type: 'window-state', state});
    } catch {
      void getCurrentWindow().hide();
    }
  };

  const handleUpdateOpacity = (nextPct: number) => {
    const saved = writeMonitorOpacityPct(clampMonitorOpacityPct(nextPct));
    setOpacityPct(saved);
  };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (locked || collapsed) return;
    if (event.button !== 0 || event.detail > 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, [data-no-drag]')) return;
    setOpacityMenuOpen(false);
    const triggerEdgeSnap = () => {
      window.removeEventListener('mouseup', triggerEdgeSnap);
      window.removeEventListener('blur', triggerEdgeSnap);
      window.setTimeout(() => {
        void invoke<MonitorWindowState>('monitor_window_snap_edge')
          .then(state => {
            applyWindowState(state);
            postMonitorBusMessage({type: 'window-state', state});
          })
          .catch(() => {});
      }, 90);
    };
    window.addEventListener('mouseup', triggerEdgeSnap, {once: true});
    window.addEventListener('blur', triggerEdgeSnap, {once: true});
    void invoke('monitor_window_start_drag').catch(() => {
      void getCurrentWindow().startDragging();
    });
  };

  const handleShellMouseEnter = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (collapsed) {
      void handleSetCollapsed(false);
    }
  };

  const handleShellMouseLeave = () => {
    if (!collapsed && autoHide && !opacityMenuOpen && (dockedEdge === 'left' || dockedEdge === 'right')) {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
      collapseTimerRef.current = window.setTimeout(() => {
        void handleSetCollapsed(true);
      }, 420);
    }
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

  const pctValue5h =
    bar5h.used === null
      ? '—'
      : displayMode === 'used'
        ? `${bar5h.used}%`
        : `${bar5h.remaining}%`;

  const pctValue7d =
    bar7d.used === null
      ? '—'
      : displayMode === 'used'
        ? `${bar7d.used}%`
        : `${bar7d.remaining}%`;

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
  const exhaustionWarnFull = formatExhaustionEta(metrics?.exhaustionEtaMins, locale);
  const exhaustionWarnCompact = formatCompactExhaustionEta(metrics?.exhaustionEtaMins);
  const velocityText = formatVelocityLabel(metrics?.tokensPerMin ?? 0);
  const cost5hText = formatMonitorUsd(metrics?.cost5hUsd ?? 0);
  const savings5hText = formatMonitorUsd(metrics?.cacheSavings5hUsd ?? 0);
  const sessionModelLabel =
    metrics?.latestModel ||
    (activityMode === 'active'
      ? telemetry?.clientLabel || 'Claude CLI'
      : t('monitor.localZeroPollingBadge'));

  const shellStyle = {
    '--monitor-opacity': String(opacityPct / 100),
  } as React.CSSProperties;

  if (collapsed) {
    return (
      <div
        className={`monitor-hud-shell is-collapsed dock-${dockedEdge || 'right'}`}
        style={shellStyle}
        onMouseEnter={handleShellMouseEnter}
        onClick={() => void handleSetCollapsed(false)}
        onDoubleClick={handleBlockDoubleClick}
        role="button"
        tabIndex={0}
        aria-label={t('monitor.expandEdge')}
        title={t('monitor.expandEdge')}
      >
        <div className="monitor-collapsed-top">
          <span className="monitor-hud-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path
                d="M8 1.25v13.5M1.25 8h13.5M3.22 3.22l9.56 9.56M12.78 3.22L3.22 12.78"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span
            className={`monitor-hud-dot${activityMode === 'active' ? ' is-active' : ''}`}
            aria-hidden="true"
          />
        </div>
        <div className="monitor-collapsed-pills">
          <div className={`monitor-collapsed-pill tone-${bar5h.tone}`}>
            <small>5h</small>
            <strong>{pctValue5h}</strong>
          </div>
          <div className={`monitor-collapsed-pill tone-${bar7d.tone}`}>
            <small>7d</small>
            <strong>{pctValue7d}</strong>
          </div>
        </div>
        <span className="monitor-collapsed-chevron" aria-hidden="true">
          {dockedEdge === 'left' ? '›' : '‹'}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`monitor-hud-shell${locked ? ' is-locked' : ''}${dockedEdge ? ` dock-${dockedEdge}` : ''}`}
      data-compact={compact ? 'true' : 'false'}
      style={shellStyle}
      onMouseEnter={handleShellMouseEnter}
      onMouseLeave={handleShellMouseLeave}
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
          <span
            className="monitor-hud-status-text"
            title={
              activityMode === 'active'
                ? `${t('monitor.statusActive')}${telemetry?.clientLabel ? ` · ${telemetry.clientLabel}` : ''}`
                : t('monitor.statusIdle')
            }
          >
            {activityMode === 'active' ? t('monitor.statusActive') : t('monitor.statusIdle')}
          </span>
        </div>
        <div className="monitor-hud-controls" data-no-drag>
          <button
            type="button"
            className={`monitor-hud-icon-btn${opacityMenuOpen || opacityPct < 94 ? ' is-active-mode' : ''}`}
            title={`${t('monitor.opacityLabel')} ${opacityPct}%`}
            aria-label={t('monitor.opacityLabel')}
            onClick={() => setOpacityMenuOpen(prev => !prev)}
            onContextMenu={e => {
              e.preventDefault();
              handleUpdateOpacity(cycleMonitorOpacityPct(opacityPct));
            }}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.35" />
              <path d="M8 2.6a5.4 5.4 0 0 1 0 10.8V2.6Z" fill="currentColor" opacity="0.65" />
            </svg>
          </button>
          <button
            type="button"
            className={`monitor-hud-icon-btn${autoHide ? ' is-active-mode' : ''}`}
            title={t(autoHide ? 'monitor.autoHideOn' : 'monitor.autoHideOff')}
            aria-label={t(autoHide ? 'monitor.autoHideOn' : 'monitor.autoHideOff')}
            onClick={() => void handleToggleAutoHide()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M13.25 2.75v10.5M3.25 8h7.25M7.75 5.25 10.5 8l-2.75 2.75"
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
            title={t('monitor.collapseToEdge')}
            aria-label={t('monitor.collapseToEdge')}
            onClick={() => void handleSetCollapsed(true)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M5.5 3.75 9.75 8 5.5 12.25M12.25 3.5v9"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`monitor-hud-icon-btn${locked ? ' is-pinned' : ''}`}
            title={t(locked ? 'monitor.unlockPosition' : 'monitor.lockPosition')}
            aria-label={t(locked ? 'monitor.unlockPosition' : 'monitor.lockPosition')}
            onClick={() => void handleToggleLock()}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <rect x="3.5" y="7.2" width="9" height="6.2" rx="1.6" stroke="currentColor" strokeWidth="1.35" />
              <path
                d={locked ? 'M5.5 7.2V5.3a2.5 2.5 0 0 1 5 0v1.9' : 'M5.5 7.2V5.1a2.5 2.5 0 0 1 4.6-1.3'}
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
              />
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

      {opacityMenuOpen && (
        <div className="monitor-opacity-popover" data-no-drag>
          <span className="monitor-opacity-title">{t('monitor.opacityLabel')}</span>
          <input
            type="range"
            min={50}
            max={100}
            step={2}
            value={opacityPct}
            onChange={e => handleUpdateOpacity(Number(e.currentTarget.value))}
            aria-label={t('monitor.opacityLabel')}
          />
          <div className="monitor-opacity-presets">
            {MONITOR_OPACITY_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                className={Math.abs(opacityPct - preset) <= 2 ? 'is-selected' : ''}
                onClick={() => handleUpdateOpacity(preset)}
              >
                {preset}%
              </button>
            ))}
          </div>
        </div>
      )}

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
        <div className="monitor-hud-badges">
          {(metrics?.cost5hUsd ?? 0) > 0 && (
            <span className="monitor-hud-cost-pill" title={`${t('monitor.cost5h')}: ${cost5hText}`}>
              5h {cost5hText}
            </span>
          )}
          {current?.plan && <span className="monitor-hud-badge">{current.plan}</span>}
        </div>
      </div>

      <section className="monitor-limit-windows" aria-label={t('monitor.title')}>
        <div className={`monitor-limit-window tone-${bar5h.tone}`}>
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
            <span className="monitor-limit-reset-text" title={reset5hLabel}>
              {reset5hLabel}
            </span>
            {exhaustionWarnCompact ? (
              <span className="monitor-hud-eta-warn" title={exhaustionWarnFull ?? undefined}>
                ⚠ {exhaustionWarnCompact}
              </span>
            ) : metrics?.burnRatePctHr != null && metrics.burnRatePctHr > 0 ? (
              <span className="monitor-hud-burn-tag">{metrics.burnRatePctHr}%/h</span>
            ) : null}
          </div>
        </div>

        <div className={`monitor-limit-window tone-${bar7d.tone}`}>
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
            <span className="monitor-limit-reset-text" title={reset7dLabel}>
              {reset7dLabel}
            </span>
            {weeklyPace && !weeklyPace.suppressed && (
              <span className={`monitor-hud-burn-tag${weeklyPace.ahead ? ' is-ahead' : ''}`}>
                {weeklyPace.deltaUsedPct >= 0 ? `+${weeklyPace.deltaUsedPct}%` : `${weeklyPace.deltaUsedPct}%`}
              </span>
            )}
          </div>
        </div>
      </section>

      {!compact ? (
        <div className="monitor-hud-detail-body">
          <div className="monitor-feathered-divider" aria-hidden="true" />
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
                · {metrics?.requests5h ?? 0} {t('monitor.callsShort')}
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
            <div className="monitor-usage-tile">
              <span className="monitor-usage-label">{t('monitor.cost5h')}</span>
              <span className="monitor-usage-value is-accent">{cost5hText}</span>
              <span className="monitor-usage-sub">
                {t('monitor.savedShort')} {savings5hText}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="monitor-hud-compact-footer">
          <span className="monitor-compact-shield">
            <span className={`monitor-session-glyph${activityMode === 'active' ? ' is-active' : ''}`}>
              {activityMode === 'active' ? '✻' : '⊙'}
            </span>{' '}
            {sessionModelLabel} · {formatCompactCount(metrics?.tokens5hTotal ?? 0)} tok
          </span>
          <span className="monitor-compact-velocity">
            {velocityText} · {cost5hText}
          </span>
        </div>
      )}
    </div>
  );
}
