// [INPUT]: Tauri AppHandle、本地 ~/.claude/projects JSONL 增量缓存、当前账号快照与零侵入进程检测状态。
// [OUTPUT]: 独立可开关无边框置顶「实时额度悬浮监控窗」（monitor）生命周期控制（支持置顶、位置锁定、边缘磁吸、贴边自动折叠隐藏、紧凑/展开多尺寸切换）与含 5h API 等效美元花费的零网络本地实时遥测快照。
// [POS]: 悬浮小窗与实时本地遥测边界；仅做本地文件 mtime/size 缓存读取与只读状态聚合，绝不发起后台 OAuth 轮询或跨进程内存读取。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
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
const MAX_JSONL_BYTES: u64 = 32 * 1024 * 1024;
const FIVE_HOUR_SECS: u64 = 5 * 3600;
const VELOCITY_WINDOW_SECS: u64 = 600;
const CONTEXT_LIMIT_TOKENS: f64 = 200_000.0;

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
    pub tokens_5h_total: u64,
    pub tokens_per_min: u64,
    pub requests_5h: u64,
    pub cost_5h_usd: f64,
    pub cache_savings_5h_usd: f64,
    pub cache_hit_pct: Option<u8>,
    pub context_used_pct: Option<u8>,
    pub latest_model: Option<String>,
    pub latest_turn_at_sec: Option<u64>,
    pub burn_rate_pct_hr: Option<f64>,
    pub exhaustion_eta_mins: Option<u64>,
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

#[derive(Clone, Debug)]
struct TurnSample {
    key: String,
    ts: u64,
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
    model: String,
}

#[derive(Clone, Debug)]
struct CachedJsonlFile {
    mtime_nanos: u128,
    len: u64,
    turns: Vec<TurnSample>,
}

static JSONL_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedJsonlFile>>> = OnceLock::new();

fn jsonl_cache() -> &'static Mutex<HashMap<PathBuf, CachedJsonlFile>> {
    JSONL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize_model(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "claude".into();
    }
    trimmed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(48)
        .collect()
}

fn model_rates_per_m(model: &str) -> (f64, f64, f64, f64) {
    let lower = model.to_ascii_lowercase();
    if lower.contains("opus") {
        if lower.contains("4-5")
            || lower.contains("4.5")
            || lower.contains("4-6")
            || lower.contains("4.6")
        {
            (5.0, 25.0, 6.25, 0.50)
        } else {
            (15.0, 75.0, 18.75, 1.50)
        }
    } else if lower.contains("haiku") {
        if lower.contains("4-5") || lower.contains("4.5") {
            (1.0, 5.0, 1.25, 0.10)
        } else {
            (0.80, 4.0, 1.00, 0.08)
        }
    } else {
        (3.0, 15.0, 3.75, 0.30)
    }
}

fn estimate_turn_cost_usd(sample: &TurnSample) -> (f64, f64) {
    let (in_rate, out_rate, write_rate, read_rate) = model_rates_per_m(&sample.model);
    let cost = ((sample.input as f64) * in_rate
        + (sample.output as f64) * out_rate
        + (sample.cache_creation as f64) * write_rate
        + (sample.cache_read as f64) * read_rate)
        / 1_000_000.0;
    let savings = ((sample.cache_read as f64) * (in_rate - read_rate).max(0.0)) / 1_000_000.0;
    (cost, savings)
}

fn parse_jsonl_turns(path: &Path) -> Vec<TurnSample> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let path_tag = path.to_string_lossy();
    let mut turns = Vec::new();
    let mut current_ts: Option<u64> = None;
    for (idx, line) in text.lines().enumerate() {
        if !line.contains("\"assistant\"") && !line.contains("\"timestamp\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(ts_raw) = obj.get("timestamp").and_then(Value::as_str) {
            if let Some(parsed) = crate::identities::profile::parse_iso_epoch_sec(ts_raw) {
                current_ts = Some(parsed);
            }
        }
        if obj.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(ts) = current_ts else {
            continue;
        };
        let Some(msg) = obj.get("message") else {
            continue;
        };
        let raw_model = msg.get("model").and_then(Value::as_str).unwrap_or("");
        if raw_model.trim().eq_ignore_ascii_case("<synthetic>") {
            continue;
        }
        let Some(usage) = msg.get("usage") else {
            continue;
        };
        let n = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
        let input = n(usage.get("input_tokens"));
        let output = n(usage.get("output_tokens"));
        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or_else(|| {
                usage
                    .get("cache_creation")
                    .map(|v| {
                        n(v.get("ephemeral_5m_input_tokens"))
                            .saturating_add(n(v.get("ephemeral_1h_input_tokens")))
                    })
                    .unwrap_or(0)
            });
        let cache_read = n(usage.get("cache_read_input_tokens"));
        if input + output + cache_creation + cache_read == 0 {
            continue;
        }
        let msg_id = msg.get("id").and_then(Value::as_str).unwrap_or("");
        let req_id = obj.get("requestId").and_then(Value::as_str).unwrap_or("");
        let key = if !msg_id.is_empty() || !req_id.is_empty() {
            format!("{msg_id}\0{req_id}")
        } else {
            format!("{path_tag}#{ts}#{idx}")
        };
        turns.push(TurnSample {
            key,
            ts,
            input,
            output,
            cache_creation,
            cache_read,
            model: sanitize_model(raw_model),
        });
    }
    turns
}

fn collect_recent_jsonl_files(
    dir: &Path,
    min_mtime_sec: u64,
    depth: usize,
    out: &mut Vec<(PathBuf, u128, u64)>,
) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            let len = meta.len();
            if len == 0 || len > MAX_JSONL_BYTES {
                continue;
            }
            let Ok(mtime) = meta.modified() else {
                continue;
            };
            let Ok(dur) = mtime.duration_since(UNIX_EPOCH) else {
                continue;
            };
            if dur.as_secs().saturating_add(60) >= min_mtime_sec {
                out.push((path, dur.as_nanos(), len));
            }
        } else if meta.is_dir() {
            collect_recent_jsonl_files(&path, min_mtime_sec, depth + 1, out);
        }
    }
}

pub fn scan_live_token_metrics(
    projects_dir: &Path,
    now_sec: u64,
    quota_5h_used: Option<u8>,
    quota_5h_reset_at: Option<u64>,
) -> LiveTokenMetrics {
    let min_epoch = now_sec.saturating_sub(FIVE_HOUR_SECS);
    let mut files = Vec::new();
    if projects_dir.is_dir() {
        collect_recent_jsonl_files(projects_dir, min_epoch, 0, &mut files);
    }
    let mut active_paths = HashSet::with_capacity(files.len());
    let mut deduped: BTreeMap<String, TurnSample> = BTreeMap::new();
    let mut max_mtime_nanos: u128 = 0;

    for (path, mtime_nanos, len) in files {
        if mtime_nanos > max_mtime_nanos {
            max_mtime_nanos = mtime_nanos;
        }
        active_paths.insert(path.clone());
        let turns = {
            let cached = jsonl_cache()
                .lock()
                .ok()
                .and_then(|cache| cache.get(&path).cloned())
                .filter(|entry| entry.mtime_nanos == mtime_nanos && entry.len == len);
            if let Some(hit) = cached {
                hit.turns
            } else {
                let parsed = parse_jsonl_turns(&path);
                if let Ok(mut cache) = jsonl_cache().lock() {
                    cache.insert(
                        path,
                        CachedJsonlFile {
                            mtime_nanos,
                            len,
                            turns: parsed.clone(),
                        },
                    );
                }
                parsed
            }
        };
        for sample in turns {
            if sample.ts < min_epoch {
                continue;
            }
            deduped
                .entry(sample.key.clone())
                .and_modify(|existing| {
                    existing.input = existing.input.max(sample.input);
                    existing.output = existing.output.max(sample.output);
                    existing.cache_creation = existing.cache_creation.max(sample.cache_creation);
                    existing.cache_read = existing.cache_read.max(sample.cache_read);
                    if sample.ts >= existing.ts {
                        existing.ts = sample.ts;
                        existing.model = sample.model.clone();
                    }
                })
                .or_insert(sample);
        }
    }

    if let Ok(mut cache) = jsonl_cache().lock() {
        cache.retain(|path, _| active_paths.contains(path));
    }

    let mut tokens_5h_total = 0u64;
    let mut prompt_5h_total = 0u64;
    let mut cache_read_5h_total = 0u64;
    let mut requests_5h = 0u64;
    let mut cost_5h_usd = 0.0f64;
    let mut cache_savings_5h_usd = 0.0f64;
    let mut recent_tokens = 0u64;
    let mut earliest_recent_ts: Option<u64> = None;
    let mut latest_turn: Option<TurnSample> = None;
    let velocity_cutoff = now_sec.saturating_sub(VELOCITY_WINDOW_SECS);

    for sample in deduped.values() {
        let prompt = sample
            .input
            .saturating_add(sample.cache_creation)
            .saturating_add(sample.cache_read);
        let turn_total = prompt.saturating_add(sample.output);
        tokens_5h_total = tokens_5h_total.saturating_add(turn_total);
        prompt_5h_total = prompt_5h_total.saturating_add(prompt);
        cache_read_5h_total = cache_read_5h_total.saturating_add(sample.cache_read);
        requests_5h = requests_5h.saturating_add(1);
        let (turn_cost, turn_savings) = estimate_turn_cost_usd(sample);
        cost_5h_usd += turn_cost;
        cache_savings_5h_usd += turn_savings;

        if sample.ts >= velocity_cutoff {
            recent_tokens = recent_tokens.saturating_add(turn_total);
            earliest_recent_ts = Some(
                earliest_recent_ts
                    .map(|prev| prev.min(sample.ts))
                    .unwrap_or(sample.ts),
            );
        }

        if latest_turn
            .as_ref()
            .map(|prev| sample.ts >= prev.ts)
            .unwrap_or(true)
        {
            latest_turn = Some(sample.clone());
        }
    }

    let tokens_per_min = if recent_tokens > 0 {
        let span_secs = earliest_recent_ts
            .map(|start| now_sec.saturating_sub(start).clamp(60, VELOCITY_WINDOW_SECS))
            .unwrap_or(VELOCITY_WINDOW_SECS);
        ((recent_tokens as f64) / (span_secs as f64 / 60.0)).round() as u64
    } else {
        0
    };

    let cache_hit_pct = if prompt_5h_total > 0 {
        Some(
            (((cache_read_5h_total as f64) / (prompt_5h_total as f64)) * 100.0)
                .round()
                .clamp(0.0, 100.0) as u8,
        )
    } else {
        None
    };

    let (context_used_pct, latest_model, latest_turn_at_sec) = if let Some(turn) = latest_turn {
        let latest_prompt = turn
            .input
            .saturating_add(turn.cache_creation)
            .saturating_add(turn.cache_read);
        let ctx_pct = (((latest_prompt as f64) / CONTEXT_LIMIT_TOKENS) * 100.0)
            .round()
            .clamp(0.0, 100.0) as u8;
        (Some(ctx_pct), Some(turn.model), Some(turn.ts))
    } else {
        (None, None, None)
    };

    let (burn_rate_pct_hr, exhaustion_eta_mins) = match (quota_5h_used, quota_5h_reset_at) {
        (Some(used), Some(reset_at)) if used > 0 && reset_at > now_sec => {
            let remaining_secs = reset_at.saturating_sub(now_sec).min(FIVE_HOUR_SECS);
            let elapsed_secs = FIVE_HOUR_SECS.saturating_sub(remaining_secs).max(300);
            let rate_hr = (used as f64) / (elapsed_secs as f64 / 3600.0);
            let rounded_rate = (rate_hr * 10.0).round() / 10.0;
            let eta = if used < 100 && rate_hr > 0.5 {
                let remaining_pct = (100 - used) as f64;
                let mins = ((remaining_pct / rate_hr) * 60.0).round() as u64;
                if mins.saturating_mul(60) < remaining_secs {
                    Some(mins.max(1))
                } else {
                    None
                }
            } else {
                None
            };
            (Some(rounded_rate), eta)
        }
        _ => (None, None),
    };

    let jsonl_revision = format!(
        "{}:{}:{}",
        active_paths.len(),
        max_mtime_nanos,
        tokens_5h_total
    );

    LiveTokenMetrics {
        tokens_5h_total,
        tokens_per_min,
        requests_5h,
        cost_5h_usd: (cost_5h_usd * 1000.0).round() / 1000.0,
        cache_savings_5h_usd: (cache_savings_5h_usd * 1000.0).round() / 1000.0,
        cache_hit_pct,
        context_used_pct,
        latest_model,
        latest_turn_at_sec,
        burn_rate_pct_hr,
        exhaustion_eta_mins,
        jsonl_revision,
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
    let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) else {
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
    let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) else {
        mem.state.collapsed = collapsed;
        enforce_monitor_geometry(window, &mem.state);
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let pos = window
        .outer_position()
        .unwrap_or(PhysicalPosition {
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
                let max_x = (area.position.x + (area.size.width as i32) - expanded_w_px - pad)
                    .max(min_x);
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

        let projects_dir = root_path.join(".claude").join("projects");
        let metrics = scan_live_token_metrics(
            &projects_dir,
            now_sec,
            current.quota_5h_used,
            current.quota_5h_reset_at,
        );

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
    fn scan_live_token_metrics_computes_velocity_cache_hit_cost_and_burn_eta() {
        let dir = std::env::temp_dir().join(format!(
            "claude-local-monitor-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let proj = dir.join("project-a");
        fs::create_dir_all(&proj).unwrap();

        let now_sec = 1_760_000_000u64;
        let line1 = r#"{"type":"assistant","timestamp":"2025-10-09T08:50:00Z","requestId":"req_1","message":{"id":"msg_1","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":4000,"output_tokens":1000,"cache_creation_input_tokens":6000,"cache_read_input_tokens":30000}}}"#;
        let line2 = r#"{"type":"assistant","timestamp":"2025-10-09T08:52:00Z","requestId":"req_2","message":{"id":"msg_2","model":"claude-opus-4-6","usage":{"input_tokens":10000,"output_tokens":2000,"cache_creation_input_tokens":10000,"cache_read_input_tokens":60000}}}"#;
        let file_path = proj.join("session.jsonl");
        fs::write(&file_path, format!("{line1}\n{line2}\n")).unwrap();

        let metrics = scan_live_token_metrics(&dir, now_sec, Some(50), Some(now_sec + 10_800));
        assert_eq!(metrics.requests_5h, 2);
        assert_eq!(metrics.tokens_5h_total, 123_000);
        assert!(metrics.tokens_per_min > 0);
        assert!(metrics.cost_5h_usd > 0.20);
        assert!(metrics.cache_savings_5h_usd > 0.30);
        assert_eq!(metrics.cache_hit_pct, Some(75));
        assert_eq!(metrics.context_used_pct, Some(40));
        assert_eq!(metrics.latest_model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(metrics.burn_rate_pct_hr, Some(25.0));
        assert_eq!(metrics.exhaustion_eta_mins, Some(120));

        let metrics_cached =
            scan_live_token_metrics(&dir, now_sec, Some(50), Some(now_sec + 10_800));
        assert_eq!(metrics_cached, metrics);

        let _ = fs::remove_dir_all(&dir);
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
