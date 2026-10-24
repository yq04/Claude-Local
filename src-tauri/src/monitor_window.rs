// [INPUT]: Tauri AppHandle、本地 ~/.claude/projects JSONL 增量缓存、当前账号快照与零侵入进程检测状态。
// [OUTPUT]: 独立可开关无边框置顶「实时额度悬浮监控窗」（monitor）生命周期控制与零网络本地实时遥测快照。
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
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewUrl, WebviewWindowBuilder};

const MONITOR_LABEL: &str = "monitor";
const EXPANDED_WIDTH: f64 = 340.0;
const EXPANDED_HEIGHT: f64 = 256.0;
const COMPACT_WIDTH: f64 = 320.0;
const COMPACT_HEIGHT: f64 = 152.0;
const MAX_JSONL_BYTES: u64 = 32 * 1024 * 1024;
const FIVE_HOUR_SECS: u64 = 5 * 3600;
const VELOCITY_WINDOW_SECS: u64 = 600;
const CONTEXT_LIMIT_TOKENS: f64 = 200_000.0;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorWindowState {
    pub open: bool,
    pub always_on_top: bool,
    pub compact: bool,
}

impl Default for MonitorWindowState {
    fn default() -> Self {
        Self {
            open: false,
            always_on_top: true,
            compact: false,
        }
    }
}

pub struct ManagedMonitorState(Mutex<MonitorWindowState>);

impl Default for ManagedMonitorState {
    fn default() -> Self {
        Self(Mutex::new(MonitorWindowState::default()))
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveTokenMetrics {
    pub tokens_5h_total: u64,
    pub tokens_per_min: u64,
    pub requests_5h: u64,
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
            *s.0.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        })
        .unwrap_or_default();
    if app.get_webview_window(MONITOR_LABEL).is_none() {
        state.open = false;
    }
    state
}

fn update_window_state(
    app: &tauri::AppHandle,
    mutate: impl FnOnce(&mut MonitorWindowState),
) -> MonitorWindowState {
    let next = if let Some(managed) = app.try_state::<ManagedMonitorState>() {
        let mut guard = managed
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        mutate(&mut guard);
        *guard
    } else {
        let mut fallback = MonitorWindowState::default();
        mutate(&mut fallback);
        fallback
    };
    let _ = app.emit("monitor-window-state", next);
    next
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != MONITOR_LABEL {
        return;
    }
    if matches!(
        event,
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
    ) {
        let _ = update_window_state(window.app_handle(), |state| {
            state.open = false;
        });
    }
}

fn position_top_right(app: &tauri::AppHandle, window: &tauri::WebviewWindow, width: f64) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let margin_px = (20.0 * scale).round() as i32;
        let width_px = (width * scale).round() as i32;
        let min_x = area.position.x + 16;
        let min_y = area.position.y + 16;
        let x = (area.position.x + (area.size.width as i32) - width_px - margin_px).max(min_x);
        let y = (area.position.y + margin_px).max(min_y);
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
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
    let current = current_window_state(&app);
    if open {
        let (target_w, target_h) = if current.compact {
            (COMPACT_WIDTH, COMPACT_HEIGHT)
        } else {
            (EXPANDED_WIDTH, EXPANDED_HEIGHT)
        };
        if let Some(existing) = app.get_webview_window(MONITOR_LABEL) {
            let _ = existing.unminimize();
            let _ = existing.show();
            let _ = existing.set_always_on_top(current.always_on_top);
            let _ = existing.set_focus();
        } else {
            let win = WebviewWindowBuilder::new(
                &app,
                MONITOR_LABEL,
                WebviewUrl::App("index.html?window=monitor".into()),
            )
            .title("Claude-Local Monitor")
            .inner_size(target_w, target_h)
            .min_inner_size(290.0, 136.0)
            .max_inner_size(460.0, 380.0)
            .decorations(false)
            .always_on_top(current.always_on_top)
            .resizable(true)
            .visible(false)
            .build()
            .map_err(|_| "无法创建实时额度悬浮监控窗。".to_string())?;
            position_top_right(&app, &win, target_w);
            let _ = win.show();
            let _ = win.set_always_on_top(current.always_on_top);
            let _ = win.set_focus();
        }
        Ok(update_window_state(&app, |s| s.open = true))
    } else {
        if let Some(existing) = app.get_webview_window(MONITOR_LABEL) {
            let _ = existing.hide();
        }
        Ok(update_window_state(&app, |s| s.open = false))
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
    Ok(update_window_state(&app, |s| {
        s.always_on_top = always_on_top
    }))
}

#[tauri::command]
pub async fn monitor_window_set_compact(
    app: tauri::AppHandle,
    compact: bool,
) -> Result<MonitorWindowState, String> {
    if let Some(win) = app.get_webview_window(MONITOR_LABEL) {
        let (w, h) = if compact {
            (COMPACT_WIDTH, COMPACT_HEIGHT)
        } else {
            (EXPANDED_WIDTH, EXPANDED_HEIGHT)
        };
        let _ = win.set_size(Size::Logical(LogicalSize { width: w, height: h }));
    }
    Ok(update_window_state(&app, |s| s.compact = compact))
}

#[tauri::command]
pub async fn monitor_window_start_drag(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(MONITOR_LABEL) {
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
    fn scan_live_token_metrics_computes_velocity_cache_hit_and_burn_eta() {
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

        // 2025-10-09T08:52:00Z = 1759999920 (80 seconds before now_sec = 1_760_000_000)
        // Reset in 3 hours (10800s), so 2 hours elapsed, 50% used -> 25%/hr burn rate -> remaining 50% exhausted in 120 mins (< 180 mins reset)
        let metrics = scan_live_token_metrics(&dir, now_sec, Some(50), Some(now_sec + 10_800));
        assert_eq!(metrics.requests_5h, 2);
        // Turn 1: 4000+1000+6000+30000 = 41,000; Turn 2: 10000+2000+10000+60000 = 82,000 -> total 123,000
        assert_eq!(metrics.tokens_5h_total, 123_000);
        assert!(metrics.tokens_per_min > 0);
        // Prompt total = (4000+6000+30000) + (10000+10000+60000) = 120,000; cache_read = 90,000 -> 75%
        assert_eq!(metrics.cache_hit_pct, Some(75));
        // Latest turn prompt = 80,000 / 200,000 = 40%
        assert_eq!(metrics.context_used_pct, Some(40));
        assert_eq!(metrics.latest_model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(metrics.burn_rate_pct_hr, Some(25.0));
        assert_eq!(metrics.exhaustion_eta_mins, Some(120));

        // Second call hits the mtime/len cache and returns identical results
        let metrics_cached =
            scan_live_token_metrics(&dir, now_sec, Some(50), Some(now_sec + 10_800));
        assert_eq!(metrics_cached, metrics);

        let _ = fs::remove_dir_all(&dir);
    }
}
