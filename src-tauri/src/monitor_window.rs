// [INPUT]: Tauri AppHandle、共享用量账本当前已验证账号统计、当前配额快照与零侵入进程检测状态。
// [OUTPUT]: monitor 窗口生命周期控制（置顶、锁定、磁吸、贴边隐藏、三态尺寸）与当前账号5h四类Token/去重响应、固定近10分钟均值速率和最近实际模型的零网络快照。
// [POS]: 悬浮小窗与本地遥测边界；复用 identities::usage 增量采集和严格账号查询，不独立扫描会话、不猜成本/上下文上限，不发起 OAuth 轮询或跨进程内存读取。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewUrl,
    WebviewWindowBuilder,
};

const MONITOR_LABEL: &str = "monitor";
pub const MONITOR_WIDTH: f64 = 340.0;
pub const MONITOR_HEIGHT: f64 = 258.0;
pub const MONITOR_COMPACT_HEIGHT: f64 = 152.0;
pub const MONITOR_COLLAPSED_WIDTH: f64 = 52.0;
pub const MONITOR_COLLAPSED_HEIGHT: f64 = 138.0;
const SNAP_THRESHOLD_LOGICAL_PX: f64 = 28.0;
const UNSNAP_THRESHOLD_LOGICAL_PX: f64 = 44.0;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MonitorDockEdge {
    Left,
    Right,
    Top,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorWindowState {
    pub open: bool,
    pub always_on_top: bool,
    pub compact: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub auto_hide: bool,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub docked_edge: Option<MonitorDockEdge>,
}

impl Default for MonitorWindowState {
    fn default() -> Self {
        Self {
            open: false,
            always_on_top: true,
            compact: false,
            locked: false,
            auto_hide: false,
            collapsed: false,
            docked_edge: Some(MonitorDockEdge::Right),
        }
    }
}

#[derive(Default)]
struct MonitorRuntimeMemory {
    state: MonitorWindowState,
    saved_expanded_pos: Option<PhysicalPosition<i32>>,
}

pub struct ManagedMonitorState(Mutex<MonitorRuntimeMemory>);

impl Default for ManagedMonitorState {
    fn default() -> Self {
        Self(Mutex::new(MonitorRuntimeMemory::default()))
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveTokenMetrics {
    pub available: bool,
    pub tokens_5h_total: u64,
    pub tokens_per_min: u64,
    pub requests_5h: u64,
    pub input_5h: u64,
    pub output_5h: u64,
    pub cache_write_5h: u64,
    pub cache_read_5h: u64,
    pub cache_hit_pct: Option<u8>,
    pub latest_model: Option<String>,
    pub latest_turn_at_sec: Option<u64>,
    pub jsonl_revision: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorLiveTelemetry {
    pub observed_at_ms: u64,
    pub running: bool,
    pub session_count: usize,
    pub client_label: Option<String>,
    pub active_id: String,
    pub active_name: Option<String>,
    pub current: crate::identities::profile::Current,
    pub metrics: LiveTokenMetrics,
    pub route_protected: bool,
    pub window: MonitorWindowState,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn metrics_from_usage(
    usage: Option<crate::identities::usage::MonitorUsage>,
    expected_account: Option<&str>,
) -> LiveTokenMetrics {
    let Some(usage) = usage.filter(|usage| Some(usage.account_key.as_str()) == expected_account)
    else {
        return LiveTokenMetrics::default();
    };
    let totals = usage.totals;
    let prompt = totals
        .input_tokens
        .saturating_add(totals.cache_creation_tokens)
        .saturating_add(totals.cache_read_tokens);
    let cache_hit_pct = (prompt > 0)
        .then(|| ((totals.cache_read_tokens as f64 / prompt as f64) * 100.0).round() as u8);
    LiveTokenMetrics {
        available: true,
        tokens_5h_total: totals.total_tokens,
        // A fixed 10-minute average is accounting throughput, never generation tok/s.
        tokens_per_min: usage.recent_tokens.saturating_add(5) / 10,
        requests_5h: totals.requests,
        input_5h: totals.input_tokens,
        output_5h: totals.output_tokens,
        cache_write_5h: totals.cache_creation_tokens,
        cache_read_5h: totals.cache_read_tokens,
        cache_hit_pct,
        latest_model: usage.latest_model,
        latest_turn_at_sec: usage.latest_at,
        jsonl_revision: usage.revision,
    }
}

fn current_window_state(app: &tauri::AppHandle) -> MonitorWindowState {
    let mut state = app
        .try_state::<ManagedMonitorState>()
        .map(|s| {
            s.0.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .state
        })
        .unwrap_or_default();
    if app.get_webview_window(MONITOR_LABEL).is_none() {
        state.open = false;
    }
    state
}

fn update_window_state(
    app: &tauri::AppHandle,
    mutate: impl FnOnce(&mut MonitorRuntimeMemory),
) -> MonitorWindowState {
    let next = if let Some(managed) = app.try_state::<ManagedMonitorState>() {
        let mut guard = managed
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        mutate(&mut guard);
        guard.state
    } else {
        let mut fallback = MonitorRuntimeMemory::default();
        mutate(&mut fallback);
        fallback.state
    };
    let _ = app.emit("monitor-window-state", next);
    next
}

pub fn target_logical_size(state: &MonitorWindowState) -> LogicalSize<f64> {
    if state.collapsed {
        LogicalSize {
            width: MONITOR_COLLAPSED_WIDTH,
            height: MONITOR_COLLAPSED_HEIGHT,
        }
    } else if state.compact {
        LogicalSize {
            width: MONITOR_WIDTH,
            height: MONITOR_COMPACT_HEIGHT,
        }
    } else {
        LogicalSize {
            width: MONITOR_WIDTH,
            height: MONITOR_HEIGHT,
        }
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != MONITOR_LABEL {
        return;
    }
    match event {
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
            let _ = update_window_state(window.app_handle(), |mem| {
                mem.state.open = false;
            });
        }
        tauri::WindowEvent::Resized(_) => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }
        }
        _ => {}
    }
}

fn enforce_monitor_geometry(window: &tauri::WebviewWindow, state: &MonitorWindowState) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let _ = window.set_maximizable(false);
    let _ = window.set_resizable(false);
    let fixed = Size::Logical(target_logical_size(state));
    let _ = window.set_min_size(Some(fixed));
    let _ = window.set_max_size(Some(fixed));
    let _ = window.set_size(fixed);
}

fn position_top_right(app: &tauri::AppHandle, window: &tauri::WebviewWindow, width: f64) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let margin_px = (16.0 * scale).round() as i32;
        let width_px = (width * scale).round() as i32;
        let min_x = area.position.x + 12;
        let min_y = area.position.y + 12;
        let x = (area.position.x + (area.size.width as i32) - width_px - margin_px).max(min_x);
        let y = (area.position.y + margin_px).max(min_y);
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
    }
}

fn evaluate_and_apply_edge_snap(
    window: &tauri::WebviewWindow,
    state: &MonitorWindowState,
) -> Option<MonitorDockEdge> {
    let Ok(Some(monitor)) = window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
    else {
        return state.docked_edge;
    };
    let Ok(pos) = window.outer_position() else {
        return state.docked_edge;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let logical = target_logical_size(state);
    let width_px = (logical.width * scale).round() as i32;
    let height_px = (logical.height * scale).round() as i32;
    let snap_px = (SNAP_THRESHOLD_LOGICAL_PX * scale).round() as i32;
    let unsnap_px = (UNSNAP_THRESHOLD_LOGICAL_PX * scale).round() as i32;
    let edge_pad = (6.0 * scale).round() as i32;

    let left_dist = (pos.x - area.position.x).abs();
    let right_edge_x = area.position.x + (area.size.width as i32) - width_px;
    let right_dist = (right_edge_x - pos.x).abs();
    let top_dist = (pos.y - area.position.y).abs();

    let min_y = area.position.y + edge_pad;
    let max_y = (area.position.y + (area.size.height as i32) - height_px - edge_pad).max(min_y);
    let clamped_y = pos.y.clamp(min_y, max_y);

    if left_dist <= snap_px {
        let target_x = area.position.x + edge_pad;
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: target_x,
            y: clamped_y,
        }));
        Some(MonitorDockEdge::Left)
    } else if right_dist <= snap_px {
        let target_x = (right_edge_x - edge_pad).max(area.position.x + edge_pad);
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: target_x,
            y: clamped_y,
        }));
        Some(MonitorDockEdge::Right)
    } else if top_dist <= snap_px {
        let min_x = area.position.x + edge_pad;
        let max_x = (right_edge_x - edge_pad).max(min_x);
        let target_x = pos.x.clamp(min_x, max_x);
        let target_y = area.position.y + edge_pad;
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: target_x,
            y: target_y,
        }));
        Some(MonitorDockEdge::Top)
    } else if left_dist > unsnap_px && right_dist > unsnap_px && top_dist > unsnap_px {
        None
    } else {
        state.docked_edge
    }
}

fn apply_collapsed_transition(
    window: &tauri::WebviewWindow,
    mem: &mut MonitorRuntimeMemory,
    collapsed: bool,
) {
    let Ok(Some(monitor)) = window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
    else {
        mem.state.collapsed = collapsed;
        enforce_monitor_geometry(window, &mem.state);
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let pos = window.outer_position().unwrap_or(PhysicalPosition {
        x: area.position.x + (area.size.width as i32) - (MONITOR_WIDTH * scale) as i32 - 16,
        y: area.position.y + 20,
    });

    if collapsed {
        if !mem.state.collapsed {
            mem.saved_expanded_pos = Some(pos);
        }
        let mid_x = area.position.x + (area.size.width as i32) / 2;
        let dock_edge = match mem.state.docked_edge {
            Some(MonitorDockEdge::Left) => MonitorDockEdge::Left,
            Some(MonitorDockEdge::Right) => MonitorDockEdge::Right,
            _ => {
                if pos.x + ((MONITOR_WIDTH * scale) as i32 / 2) < mid_x {
                    MonitorDockEdge::Left
                } else {
                    MonitorDockEdge::Right
                }
            }
        };
        mem.state.docked_edge = Some(dock_edge);
        mem.state.collapsed = true;
        enforce_monitor_geometry(window, &mem.state);

        let collapsed_w_px = (MONITOR_COLLAPSED_WIDTH * scale).round() as i32;
        let collapsed_h_px = (MONITOR_COLLAPSED_HEIGHT * scale).round() as i32;
        let min_y = area.position.y + 12;
        let max_y = (area.position.y + (area.size.height as i32) - collapsed_h_px - 12).max(min_y);
        let target_y = pos.y.clamp(min_y, max_y);
        let target_x = match dock_edge {
            MonitorDockEdge::Left => area.position.x,
            _ => (area.position.x + (area.size.width as i32) - collapsed_w_px).max(area.position.x),
        };
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: target_x,
            y: target_y,
        }));
    } else {
        mem.state.collapsed = false;
        enforce_monitor_geometry(window, &mem.state);
        let logical = target_logical_size(&mem.state);
        let expanded_w_px = (logical.width * scale).round() as i32;
        let expanded_h_px = (logical.height * scale).round() as i32;
        let pad = (8.0 * scale).round() as i32;
        let min_y = area.position.y + pad;
        let max_y = (area.position.y + (area.size.height as i32) - expanded_h_px - pad).max(min_y);
        let base_y = mem
            .saved_expanded_pos
            .map(|p| p.y)
            .unwrap_or(pos.y)
            .clamp(min_y, max_y);
        let target_x = match mem.state.docked_edge {
            Some(MonitorDockEdge::Left) => area.position.x + pad,
            Some(MonitorDockEdge::Right) => {
                (area.position.x + (area.size.width as i32) - expanded_w_px - pad)
                    .max(area.position.x + pad)
            }
            _ => {
                let min_x = area.position.x + pad;
                let max_x =
                    (area.position.x + (area.size.width as i32) - expanded_w_px - pad).max(min_x);
                mem.saved_expanded_pos
                    .map(|p| p.x)
                    .unwrap_or(pos.x)
                    .clamp(min_x, max_x)
            }
        };
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: target_x,
            y: base_y,
        }));
    }
}

#[tauri::command]
pub async fn monitor_window_state(app: tauri::AppHandle) -> MonitorWindowState {
    current_window_state(&app)
}

#[tauri::command]
pub async fn monitor_window_set_open(
    app: tauri::AppHandle,
    open: bool,
) -> Result<MonitorWindowState, String> {
    let mut current = current_window_state(&app);
    if open {
        current.collapsed = false;
        let size = target_logical_size(&current);
        if let Some(existing) = app.get_webview_window(MONITOR_LABEL) {
            let _ = existing.unminimize();
            let next = update_window_state(&app, |mem| {
                mem.state.open = true;
                mem.state.collapsed = false;
                apply_collapsed_transition(&existing, mem, false);
            });
            let _ = existing.show();
            let _ = existing.set_always_on_top(next.always_on_top);
            let _ = existing.set_focus();
            Ok(next)
        } else {
            let win = WebviewWindowBuilder::new(
                &app,
                MONITOR_LABEL,
                WebviewUrl::App("index.html?window=monitor".into()),
            )
            .title("Claude-Local Monitor")
            .inner_size(size.width, size.height)
            .min_inner_size(size.width, size.height)
            .max_inner_size(size.width, size.height)
            .decorations(false)
            .always_on_top(current.always_on_top)
            .resizable(false)
            .maximizable(false)
            .visible(false)
            .build()
            .map_err(|_| "无法创建实时额度悬浮监控窗。".to_string())?;
            enforce_monitor_geometry(&win, &current);
            position_top_right(&app, &win, size.width);
            let _ = win.show();
            let _ = win.set_always_on_top(current.always_on_top);
            let _ = win.set_focus();
            Ok(update_window_state(&app, |mem| {
                mem.state.open = true;
                mem.state.collapsed = false;
                mem.state.docked_edge = Some(MonitorDockEdge::Right);
            }))
        }
    } else {
        if let Some(existing) = app.get_webview_window(MONITOR_LABEL) {
            let _ = existing.hide();
        }
        Ok(update_window_state(&app, |mem| mem.state.open = false))
    }
}

#[tauri::command]
pub async fn monitor_window_set_always_on_top(
    app: tauri::AppHandle,
    always_on_top: bool,
) -> Result<MonitorWindowState, String> {
    if let Some(win) = app.get_webview_window(MONITOR_LABEL) {
        win.set_always_on_top(always_on_top)
            .map_err(|_| "无法切换悬浮窗置顶状态。".to_string())?;
    }
    Ok(update_window_state(&app, |mem| {
        mem.state.always_on_top = always_on_top
    }))
}

#[tauri::command]
pub async fn monitor_window_set_compact(
    app: tauri::AppHandle,
    compact: bool,
) -> Result<MonitorWindowState, String> {
    let win = app.get_webview_window(MONITOR_LABEL);
    Ok(update_window_state(&app, |mem| {
        mem.state.compact = compact;
        mem.state.collapsed = false;
        if let Some(ref w) = win {
            enforce_monitor_geometry(w, &mem.state);
        }
    }))
}

#[tauri::command]
pub async fn monitor_window_set_locked(
    app: tauri::AppHandle,
    locked: bool,
) -> Result<MonitorWindowState, String> {
    Ok(update_window_state(&app, |mem| {
        mem.state.locked = locked;
    }))
}

#[tauri::command]
pub async fn monitor_window_set_auto_hide(
    app: tauri::AppHandle,
    auto_hide: bool,
) -> Result<MonitorWindowState, String> {
    let win = app.get_webview_window(MONITOR_LABEL);
    Ok(update_window_state(&app, |mem| {
        mem.state.auto_hide = auto_hide;
        if !auto_hide && mem.state.collapsed {
            if let Some(ref w) = win {
                apply_collapsed_transition(w, mem, false);
            } else {
                mem.state.collapsed = false;
            }
        }
    }))
}

#[tauri::command]
pub async fn monitor_window_set_collapsed(
    app: tauri::AppHandle,
    collapsed: bool,
) -> Result<MonitorWindowState, String> {
    let win = app.get_webview_window(MONITOR_LABEL);
    Ok(update_window_state(&app, |mem| {
        if let Some(ref w) = win {
            apply_collapsed_transition(w, mem, collapsed);
        } else {
            mem.state.collapsed = collapsed;
        }
    }))
}

#[tauri::command]
pub async fn monitor_window_snap_edge(app: tauri::AppHandle) -> Result<MonitorWindowState, String> {
    let win = app.get_webview_window(MONITOR_LABEL);
    Ok(update_window_state(&app, |mem| {
        if mem.state.collapsed {
            return;
        }
        if let Some(ref w) = win {
            mem.state.docked_edge = evaluate_and_apply_edge_snap(w, &mem.state);
            if let Ok(pos) = w.outer_position() {
                mem.saved_expanded_pos = Some(pos);
            }
        }
    }))
}

#[tauri::command]
pub async fn monitor_window_start_drag(app: tauri::AppHandle) -> Result<(), String> {
    let state = current_window_state(&app);
    if state.locked {
        return Ok(());
    }
    if let Some(win) = app.get_webview_window(MONITOR_LABEL) {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        }
        let _ = win.start_dragging();
    }
    Ok(())
}

#[tauri::command]
pub async fn monitor_live_telemetry(app: tauri::AppHandle) -> Result<MonitorLiveTelemetry, String> {
    let window = current_window_state(&app);
    let vault_path = app
        .path()
        .app_data_dir()
        .map_err(|_| "身份保险库无法定位。".to_string())?
        .join("identity-vault");
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = crate::cleaner::identity::root()?;
        let observed_at_ms = now_ms();
        let now_sec = observed_at_ms / 1000;
        let running = crate::cleaner::identity::processes_running().unwrap_or(false);
        let sessions = crate::identities::profile::active_sessions(&root_path);
        let session_count = sessions.len();
        let client_label = sessions.first().map(|s| s.entrypoint.clone());
        let expected_account = crate::identities::usage::live_account_key(&vault_path, &root_path);

        let mut active_id = "current".to_string();
        let mut active_name = None;
        if let Ok(db) = crate::identities::database::Database::open(&vault_path) {
            if let Ok(Some(id)) =
                crate::identities::catalog::current_id(&vault_path, &root_path, &db)
            {
                active_id = id.clone();
                if let Ok(records) = db.records() {
                    active_name = records
                        .into_iter()
                        .find(|r| r.id == id && !r.empty)
                        .map(|r| r.name);
                }
            }
        }

        let mut current = crate::identities::profile::read_live(&root_path, &vault_path);
        crate::identities::online::apply_metadata(
            &vault_path,
            current.quota_identity.as_deref(),
            &mut current.web,
        );

        // No monitor/collector lock is held while usage acquires its shared lock.
        // Unknown accounts stay unavailable; never borrow another account or a fallback.
        // A ledger read failure must not retain a previous account's token snapshot.
        let usage = crate::identities::usage::monitor_usage(&vault_path, &root_path, now_sec)
            .unwrap_or(None);
        let metrics = metrics_from_usage(usage, expected_account.as_deref());

        Ok(MonitorLiveTelemetry {
            observed_at_ms,
            running: running || session_count > 0,
            session_count,
            client_label,
            active_id,
            active_name,
            route_protected: true,
            current,
            metrics,
            window,
        })
    })
    .await
    .map_err(|_| "实时额度遥测读取被中断。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_usage_metrics_keep_unknown_distinct_from_confirmed_zero() {
        let unavailable = metrics_from_usage(None, None);
        assert!(!unavailable.available);
        assert_eq!(unavailable.latest_model, None);
        let empty = metrics_from_usage(
            Some(crate::identities::usage::MonitorUsage {
                account_key: "account-a".into(),
                totals: crate::identities::usage::UsageTotals::default(),
                recent_tokens: 0,
                latest_model: None,
                latest_at: None,
                revision: "zero".into(),
            }),
            Some("account-a"),
        );
        assert!(empty.available);
        assert_eq!(empty.tokens_5h_total, 0);
        assert_eq!(empty.cache_hit_pct, None);
    }

    #[test]
    fn shared_usage_metrics_report_disjoint_counters_and_fixed_ten_minute_rate() {
        let totals = crate::identities::usage::UsageTotals {
            input_tokens: 10_000,
            output_tokens: 2_000,
            cache_creation_tokens: 10_000,
            cache_read_tokens: 60_000,
            total_tokens: 82_000,
            requests: 2,
            ..Default::default()
        };
        let metrics = metrics_from_usage(
            Some(crate::identities::usage::MonitorUsage {
                account_key: "account-a".into(),
                totals,
                recent_tokens: 82_000,
                latest_model: Some("claude-opus-4-6".into()),
                latest_at: Some(1_760_000_000),
                revision: "fixture".into(),
            }),
            Some("account-a"),
        );
        assert!(metrics.available);
        assert_eq!(metrics.tokens_5h_total, 82_000);
        assert_eq!(metrics.tokens_per_min, 8_200);
        assert_eq!(metrics.requests_5h, 2);
        assert_eq!(metrics.cache_hit_pct, Some(75));
        assert_eq!(metrics.latest_model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(metrics.latest_turn_at_sec, Some(1_760_000_000));
        assert_eq!(
            metrics.input_5h + metrics.output_5h + metrics.cache_write_5h + metrics.cache_read_5h,
            metrics.tokens_5h_total
        );
    }

    #[test]
    fn metrics_reject_an_account_change_between_profile_and_usage_reads() {
        let metrics = metrics_from_usage(
            Some(crate::identities::usage::MonitorUsage {
                account_key: "account-b".into(),
                totals: crate::identities::usage::UsageTotals {
                    total_tokens: 999,
                    ..Default::default()
                },
                recent_tokens: 999,
                latest_model: Some("claude-sonnet-4-6".into()),
                latest_at: Some(1_760_000_000),
                revision: "other-account".into(),
            }),
            Some("account-a"),
        );
        assert!(!metrics.available);
        assert_eq!(metrics.tokens_5h_total, 0);
        assert_eq!(metrics.latest_model, None);
    }

    #[test]
    fn monitor_window_uses_multi_mode_fixed_geometry() {
        assert_eq!(MONITOR_WIDTH, 340.0);
        assert_eq!(MONITOR_HEIGHT, 258.0);
        assert_eq!(MONITOR_COMPACT_HEIGHT, 152.0);
        assert_eq!(MONITOR_COLLAPSED_WIDTH, 52.0);
        assert_eq!(MONITOR_COLLAPSED_HEIGHT, 138.0);
        let default_state = MonitorWindowState::default();
        assert!(!default_state.open);
        assert!(default_state.always_on_top);
        assert!(!default_state.compact);
        assert!(!default_state.locked);
        assert!(!default_state.auto_hide);
        assert!(!default_state.collapsed);
        assert_eq!(default_state.docked_edge, Some(MonitorDockEdge::Right));
        let expanded_size = target_logical_size(&default_state);
        assert_eq!(expanded_size.width, 340.0);
        assert_eq!(expanded_size.height, 258.0);
        let mut compact_state = default_state;
        compact_state.compact = true;
        assert_eq!(target_logical_size(&compact_state).height, 152.0);
        let mut collapsed_state = default_state;
        collapsed_state.collapsed = true;
        assert_eq!(target_logical_size(&collapsed_state).width, 52.0);
    }
}
