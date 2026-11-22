// [INPUT]: cli-slots/<record_id>、身份保险库 Store/Record（含 32 字节主密钥）、宿主机 ~/.claude 与 ~/.claude.json、运行中 ClaudeProcess 快照与跨进程 slot_pacing_v1.json。
// [OUTPUT]: Windows (PID, CreationTime) 防 PID 复用槽位会话识别、8+ hex 唯一前缀槽位解析、同出口并发守卫、孤儿租约/死会话清理、隔离槽位干净物化（skills 始终有界复制排除 synced 禁用联接、按 record_id HMAC 派生稳定独立 userID/anonymousId/machineID 与确定性 firstStartTime、same_owner 缺失 UUID 拒认、清理 1p_failed_events 遥测死信、强锁 NO_PROXY 含 ::1）、跨进程单调同出口错峰节流（1800–3400ms）、崩溃凭据抢救回灌及 429/鉴权失败即时冷却入狱。
// [POS]: orchestrator 子代理槽位生命周期层；严格遵守句柄排空、防串号漂移与私有 ACL 写盘边界，保持主目录 ~/.claude.json s13 userID 不变。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{
    config::{
        acquire_orchestrate_lock, default_schema_one, exit_key, load_config, now_epoch_ms,
        read_claude_dir_http_proxy, read_safe_value, read_settings_http_proxy,
        safe_real_dir, save_config, truncate_display, validate_http_proxy, SmartRelayConfig,
        ACTIVE_LEASE_STARTUP_WINDOW_SEC, CLI_SLOTS_DIR, DEFAULT_COOLDOWN_SEC, MAX_COPY_BYTES,
        MAX_COPY_DEPTH, MAX_COPY_FILES, MAX_SESSION_JSON_BYTES, MAX_SLOT_JSON_BYTES,
        PROXY_ENV_KEYS_URL, SLOT_DRIFTED_FILE, SLOT_LEASE_FILE, SLOT_MANIFEST_FILE,
        SLOT_PACING_FILE, STRIP_SLOT_ENV_KEYS,
    },
    evaluator::{evaluate_pool, resolve_slot_proxy, AccountView, ActiveSlotView},
};
use crate::{
    cleaner::{self, identity, ClaudeProcess},
    identities::{codec, database, private, profile, store::Store, usage, valid_id},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
const WIN_EPOCH_DIFF_TICKS: u64 = 116_444_736_000_000_000;
#[cfg(windows)]
const WIN_EPOCH_DIFF_MS: u64 = 11_644_473_600_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SlotLease {
    schema: u8,
    record_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proxy: Option<String>,
    acquired_at_sec: u64,
    jitter_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SlotManifest {
    schema: u8,
    record_id: String,
    created_at_sec: u64,
    links: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SlotAcquireResult {
    pub schema: u8,
    pub ok: bool,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jitter_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_on_exit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_same_exit_concurrency: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SlotReleaseResult {
    pub schema: u8,
    pub ok: bool,
    pub status: String,
    pub record_id: String,
    pub credentials_synced: bool,
    pub usage_ingested: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_until_sec: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(windows)]
fn session_file_matches_process_creation(
    proc: &ClaudeProcess,
    session_path: &Path,
    session_json: Option<&Value>,
) -> bool {
    if proc.created <= WIN_EPOCH_DIFF_TICKS {
        return true;
    }
    let proc_start_ms = (proc.created / 10_000).saturating_sub(WIN_EPOCH_DIFF_MS);
    if let Some(val) = session_json {
        let raw_ts = val
            .get("startedAt")
            .or_else(|| val.get("started_at"))
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_i64().filter(|&x| x > 0).map(|x| x as u64))
            });
        if let Some(ts) = raw_ts {
            let started_ms = if ts < 10_000_000_000 {
                ts.saturating_mul(1000)
            } else {
                ts
            };
            if proc_start_ms > started_ms.saturating_add(15_000) {
                return false;
            }
            return true;
        }
    }
    if let Ok(meta) = fs::symlink_metadata(session_path) {
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                let mtime_ms = dur.as_millis().min(u64::MAX as u128) as u64;
                if mtime_ms > 0 && proc_start_ms > mtime_ms.saturating_add(5_000) {
                    return false;
                }
            }
        }
    }
    true
}

#[cfg(not(windows))]
fn session_file_matches_process_creation(
    _proc: &ClaudeProcess,
    _session_path: &Path,
    _session_json: Option<&Value>,
) -> bool {
    true
}

fn collect_slot_sessions_in_dir(
    slot_dir: &Path,
    running_map: &HashMap<i32, &ClaudeProcess>,
) -> Vec<profile::ActiveSession> {
    if running_map.is_empty() || !safe_real_dir(slot_dir) {
        return Vec::new();
    }
    let sessions_dir = slot_dir.join("sessions");
    if !safe_real_dir(&sessions_dir) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&sessions_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen_pids = HashSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Some(stem) = name_str.strip_suffix(".json") else {
            continue;
        };
        let Ok(pid) = stem.parse::<i32>() else {
            continue;
        };
        if pid <= 0 || !seen_pids.insert(pid) {
            continue;
        }
        let Some(proc) = running_map.get(&pid) else {
            continue;
        };
        let session_path = entry.path();
        let val = read_safe_value(&session_path, MAX_SESSION_JSON_BYTES);
        if !session_file_matches_process_creation(proc, &session_path, val.as_ref()) {
            continue;
        }
        let mut workspace = None;
        let mut entrypoint = proc.name.clone();
        if let Some(val) = val {
            if let Some(cwd) = val.get("cwd").and_then(Value::as_str) {
                let folder = Path::new(cwd)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(cwd);
                workspace = truncate_display(folder, 48);
            }
            if let Some(ep) = val.get("entrypoint").and_then(Value::as_str) {
                entrypoint = match ep {
                    "cli" => "CLI".into(),
                    "claude-vscode" => "VS Code".into(),
                    "claude-desktop" => "Claude Desktop".into(),
                    "sdk-cli" => "SDK".into(),
                    "mcp" => "MCP".into(),
                    other => truncate_display(other, 24).unwrap_or(entrypoint),
                };
            }
        }
        out.push(profile::ActiveSession {
            pid,
            workspace,
            entrypoint,
        });
    }
    out.sort_by_key(|s| s.pid);
    out
}

fn prune_dead_slot_sessions(slot_dir: &Path, live_pids: &[i32]) {
    let sessions_dir = slot_dir.join("sessions");
    if !safe_real_dir(&sessions_dir) {
        return;
    }
    let live_set: HashSet<i32> = live_pids.iter().copied().collect();
    let Ok(entries) = fs::read_dir(&sessions_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if cleaner::linked(&meta) || !meta.is_file() {
            continue;
        }
        let Some(stem) = path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(|s| s.strip_suffix(".json"))
        else {
            continue;
        };
        if let Ok(pid) = stem.parse::<i32>() {
            if !live_set.contains(&pid) {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

pub(crate) fn live_slot_pids_in_dir(slot_dir: &Path, running: &[ClaudeProcess]) -> Vec<i32> {
    if running.is_empty() {
        return Vec::new();
    }
    let running_map: HashMap<i32, &ClaudeProcess> =
        running.iter().map(|p| (p.pid, p)).collect();
    collect_slot_sessions_in_dir(slot_dir, &running_map)
        .into_iter()
        .map(|s| s.pid)
        .collect()
}

pub(crate) fn slot_sessions_by_record(
    app_data_dir: &Path,
    running: &[ClaudeProcess],
) -> BTreeMap<String, Vec<profile::ActiveSession>> {
    let mut map = BTreeMap::new();
    if running.is_empty() {
        return map;
    }
    let slots_root = app_data_dir.join(CLI_SLOTS_DIR);
    if !safe_real_dir(&slots_root) {
        return map;
    }
    let Ok(entries) = fs::read_dir(&slots_root) else {
        return map;
    };
    let running_map: HashMap<i32, &ClaudeProcess> =
        running.iter().map(|p| (p.pid, p)).collect();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str() else {
            continue;
        };
        if !valid_id(id) {
            continue;
        }
        let sessions = collect_slot_sessions_in_dir(&entry.path(), &running_map);
        if !sessions.is_empty() {
            map.insert(id.to_string(), sessions);
        }
    }
    map
}

pub(crate) fn slot_pids_by_record(
    app_data_dir: &Path,
    running: &[ClaudeProcess],
) -> BTreeMap<String, Vec<i32>> {
    slot_sessions_by_record(app_data_dir, running)
        .into_iter()
        .map(|(id, sessions)| (id, sessions.into_iter().map(|s| s.pid).collect()))
        .collect()
}

fn read_slot_lease(slot_dir: &Path) -> Option<SlotLease> {
    let path = slot_dir.join(SLOT_LEASE_FILE);
    let val = read_safe_value(&path, 16 * 1024)?;
    serde_json::from_value(val).ok()
}

pub(crate) fn slot_lease_fresh_by_mtime(slot_dir: &Path) -> bool {
    let path = slot_dir.join(SLOT_LEASE_FILE);
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return false;
    };
    if cleaner::linked(&meta) || !meta.is_file() {
        return false;
    }
    meta.modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .is_some_and(|age| age < Duration::from_secs(ACTIVE_LEASE_STARTUP_WINDOW_SEC))
}

fn scrub_slot_telemetry_dead_letters(slot_dir: &Path) {
    let telem = slot_dir.join("telemetry");
    if !safe_real_dir(&telem) {
        return;
    }
    let Ok(entries) = fs::read_dir(&telem) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if name_str.starts_with("1p_failed_events.") && name_str.ends_with(".json") {
            let p = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&p) {
                if !cleaner::linked(&meta) && meta.is_file() {
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }
}

pub(crate) fn scrub_idle_slot_artifacts(slot_dir: &Path) {
    for rel in [
        ".credentials.json",
        SLOT_LEASE_FILE,
        ".oauth_refresh.lock",
        ".oauth_refresh.lock.owner",
        ".storage-write.lock",
        ".claude.json.lock",
        "settings.json.lock",
    ] {
        let p = slot_dir.join(rel);
        if let Ok(meta) = fs::symlink_metadata(&p) {
            if !cleaner::linked(&meta) {
                if meta.is_dir() {
                    let _ = cleaner::file_io::remove_dir_all_retry(&p);
                } else if meta.is_file() {
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }
    scrub_slot_telemetry_dead_letters(slot_dir);
}

pub(crate) fn remove_idle_slot_dir(slot_dir: &Path) -> Result<(), String> {
    if !slot_dir.exists() {
        return Ok(());
    }
    for linked_sub in ["skills", "commands", "agents", "rules", "hooks"] {
        let _ = safe_remove_slot_entry(&slot_dir.join(linked_sub));
    }
    safe_remove_slot_entry(slot_dir)
}

pub(super) fn scan_active_slots(
    app_data_dir: &Path,
    slot_pids: &BTreeMap<String, Vec<i32>>,
    now_sec: u64,
) -> Vec<ActiveSlotView> {
    let slots_root = app_data_dir.join(CLI_SLOTS_DIR);
    if !safe_real_dir(&slots_root) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&slots_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str() else {
            continue;
        };
        if !valid_id(id) {
            continue;
        }
        let slot_dir = entry.path();
        if !safe_real_dir(&slot_dir) {
            continue;
        }
        let pids = slot_pids.get(id).cloned().unwrap_or_default();
        let mut lease = read_slot_lease(&slot_dir);
        let lease_fresh = lease.as_ref().is_some_and(|l| {
            now_sec.saturating_sub(l.acquired_at_sec) < ACTIVE_LEASE_STARTUP_WINDOW_SEC
        });
        if pids.is_empty() && lease.is_some() && !lease_fresh {
            let lease_path = slot_dir.join(SLOT_LEASE_FILE);
            if let Ok(meta) = fs::symlink_metadata(&lease_path) {
                if !cleaner::linked(&meta) && meta.is_file() {
                    let _ = fs::remove_file(&lease_path);
                }
            }
            lease = None;
        }
        let drifted = slot_dir.join(SLOT_DRIFTED_FILE).exists();
        if pids.is_empty() && lease.is_none() && !drifted {
            continue;
        }
        let proxy = lease
            .as_ref()
            .and_then(|l| l.proxy.clone())
            .or_else(|| read_settings_http_proxy(&slot_dir.join("settings.json")));
        out.push(ActiveSlotView {
            record_id: id.to_string(),
            proxy,
            session_tag: lease.as_ref().and_then(|l| l.session_tag.clone()),
            acquired_at_sec: lease.as_ref().map(|l| l.acquired_at_sec),
            lease_active: !pids.is_empty() || lease_fresh,
            live_pids: pids,
            drifted,
        });
    }
    out.sort_by(|a, b| a.record_id.cmp(&b.record_id));
    out
}

pub(super) fn exit_concurrency_counts(
    app_data_dir: &Path,
    home: &Path,
    active_id: &str,
    config: &SmartRelayConfig,
    cli_running: bool,
    active_slots: &[ActiveSlotView],
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    if cli_running {
        let live_proxy = config
            .slot_proxies
            .get(active_id)
            .cloned()
            .or_else(|| read_claude_dir_http_proxy(&home.join(".claude")));
        let key = exit_key(live_proxy.as_deref());
        *counts.entry(key).or_insert(0) += 1;
    }
    for slot in active_slots {
        if slot.lease_active {
            let key = exit_key(slot.proxy.as_deref());
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    let browser_root = app_data_dir.join("browser");
    if browser_root.is_dir() {
        for (_slot, profile_dir) in
            crate::browser::kill_switch::running_managed_profiles(&browser_root)
        {
            let b_proxy = profile_dir
                .parent()
                .and_then(|scope| crate::browser::config::load(scope).ok())
                .map(|cfg| cfg.proxy)
                .filter(|p| !p.trim().is_empty());
            let key = exit_key(b_proxy.as_deref());
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn safe_remove_slot_entry(path: &Path) -> Result<(), String> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if cleaner::linked(&meta) {
        #[cfg(target_os = "windows")]
        {
            if fs::remove_dir(path).is_err() {
                fs::remove_file(path).map_err(|e| format!("移除旧槽位链接失败: {e}"))?;
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            fs::remove_file(path).map_err(|e| format!("移除旧槽位链接失败: {e}"))?;
        }
    } else if meta.is_dir() {
        cleaner::file_io::remove_dir_all_retry(path)
            .map_err(|e| format!("清理旧槽位目录失败: {e}"))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("移除旧槽位文件失败: {e}"))?;
    }
    Ok(())
}

fn copy_dir_bounded_excluding(
    src: &Path,
    dst: &Path,
    exclude_top_dir: Option<&str>,
) -> Result<(), String> {
    struct Budget {
        files: usize,
        bytes: u64,
    }
    fn walk_copy(
        src: &Path,
        dst: &Path,
        depth: usize,
        exclude_top_dir: Option<&str>,
        budget: &mut Budget,
    ) -> Result<(), String> {
        if depth > MAX_COPY_DEPTH {
            return Ok(());
        }
        private::directory(dst)?;
        let entries = fs::read_dir(src).map_err(|e| format!("读取槽位资源失败: {e}"))?;
        for entry in entries.flatten() {
            if depth == 0 {
                if let Some(ex) = exclude_top_dir {
                    if entry
                        .file_name()
                        .to_str()
                        .is_some_and(|n| n.eq_ignore_ascii_case(ex))
                    {
                        continue;
                    }
                }
            }
            let src_path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&src_path) else {
                continue;
            };
            if cleaner::linked(&meta) {
                continue;
            }
            let dst_path = dst.join(entry.file_name());
            if meta.is_dir() {
                walk_copy(&src_path, &dst_path, depth + 1, None, budget)?;
            } else if meta.is_file() {
                budget.files += 1;
                budget.bytes = budget.bytes.saturating_add(meta.len());
                if budget.files > MAX_COPY_FILES || budget.bytes > MAX_COPY_BYTES {
                    return Err("relay.error.slotResourceTooLarge".into());
                }
                let data = fs::read(&src_path).map_err(|e| format!("读取槽位资源失败: {e}"))?;
                private::write(&dst_path, &data)?;
            }
        }
        Ok(())
    }
    let mut budget = Budget { files: 0, bytes: 0 };
    walk_copy(src, dst, 0, exclude_top_dir, &mut budget)
}

#[cfg(target_os = "windows")]
fn try_windows_junction(src: &Path, dst: &Path) -> bool {
    let Ok(canon_src) = dunce::canonicalize(src) else {
        return false;
    };
    let Some(dst_parent) = dst.parent() else {
        return false;
    };
    let Ok(canon_parent) = dunce::canonicalize(dst_parent) else {
        return false;
    };
    let Some(dst_name) = dst.file_name() else {
        return false;
    };
    let clean_dst = canon_parent.join(dst_name);
    let src_str = canon_src.to_string_lossy();
    let dst_str = clean_dst.to_string_lossy();
    let bad = |s: &str| {
        s.chars()
            .any(|c| matches!(c, '&' | '|' | '<' | '>' | '"' | '^' | '%' | '\r' | '\n' | '\0'))
    };
    if bad(&src_str) || bad(&dst_str) {
        return false;
    }
    if private::safe(&canon_src).is_err() || private::safe(&canon_parent).is_err() {
        return false;
    }
    let Ok(output) = Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&clean_dst)
        .arg(&canon_src)
        .output()
    else {
        return false;
    };
    output.status.success()
        && fs::symlink_metadata(&clean_dst).is_ok_and(|m| cleaner::linked(&m))
}

#[cfg(not(target_os = "windows"))]
fn try_windows_junction(_src: &Path, _dst: &Path) -> bool {
    false
}

fn link_or_copy_shared_subdir(
    src_root: &Path,
    slot_dir: &Path,
    name: &str,
) -> Result<Option<String>, String> {
    let dst = slot_dir.join(name);
    safe_remove_slot_entry(&dst)?;
    let src = src_root.join(name);
    let Ok(meta) = fs::symlink_metadata(&src) else {
        return Ok(None);
    };
    if cleaner::linked(&meta) || !meta.is_dir() || private::safe(&src).is_err() {
        return Ok(None);
    }
    // Never expose account-bound remote `skills/synced` across accounts via a directory junction.
    if name == "skills" {
        copy_dir_bounded_excluding(&src, &dst, Some("synced"))?;
        return Ok(Some("copy".into()));
    }
    if try_windows_junction(&src, &dst) {
        return Ok(Some("junction".into()));
    }
    copy_dir_bounded_excluding(&src, &dst, None)?;
    Ok(Some("copy".into()))
}

fn build_slot_settings(home: &Path, resolved_proxy: Option<&str>) -> Value {
    let claude_dir = home.join(".claude");
    let mut root = match read_safe_value(&claude_dir.join("settings.json"), 2 * 1024 * 1024) {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    let mut env = match root.remove("env") {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    if let Some(Value::Object(mut local_map)) =
        read_safe_value(&claude_dir.join("settings.local.json"), 2 * 1024 * 1024)
    {
        if let Some(Value::Object(local_env)) = local_map.remove("env") {
            for (k, v) in local_env {
                env.insert(k, v);
            }
        }
        for (k, v) in local_map {
            root.insert(k, v);
        }
    }

    env.insert("DISABLE_TELEMETRY".into(), Value::String("1".into()));
    env.insert("DISABLE_ERROR_REPORTING".into(), Value::String("1".into()));
    env.insert("DO_NOT_TRACK".into(), Value::String("1".into()));
    for k in STRIP_SLOT_ENV_KEYS {
        env.remove(*k);
    }
    for k in PROXY_ENV_KEYS_URL {
        env.remove(*k);
    }
    if let Some(proxy_url) = resolved_proxy {
        for k in PROXY_ENV_KEYS_URL {
            env.insert((*k).into(), Value::String(proxy_url.to_string()));
        }
    }
    let no_proxy = env
        .get("NO_PROXY")
        .or_else(|| env.get("no_proxy"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
        .map(|s| {
            if s.contains("localhost") && s.contains("127.0.0.1") && s.contains("::1") {
                s.to_string()
            } else {
                format!("{s},localhost,127.0.0.1,::1")
            }
        })
        .unwrap_or_else(|| "localhost,127.0.0.1,::1".to_string());
    env.insert("NO_PROXY".into(), Value::String(no_proxy.clone()));
    env.insert("no_proxy".into(), Value::String(no_proxy));
    root.insert("env".into(), Value::Object(env));
    Value::Object(root)
}

pub(crate) fn derive_slot_user_id(master_key: &[u8], record_id: &str) -> String {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, master_key);
    let msg = format!("claude-local-slot-userid:v1:{record_id}");
    let tag = ring::hmac::sign(&key, msg.as_bytes());
    tag.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn derive_slot_anonymous_id(master_key: &[u8], record_id: &str) -> String {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, master_key);
    let msg = format!("claude-local-slot-anonid:v1:{record_id}");
    let tag = ring::hmac::sign(&key, msg.as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&tag.as_ref()[..16]);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "claude-cli-v1-{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

pub(crate) fn derive_slot_machine_id(master_key: &[u8], record_id: &str) -> String {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, master_key);
    let msg = format!("claude-local-slot-machineid:v1:{record_id}");
    let tag = ring::hmac::sign(&key, msg.as_bytes());
    tag.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn derive_slot_first_start_time(
    master_key: &[u8],
    record_id: &str,
    _saved_at: u64,
) -> Option<String> {
    // Use a fixed constant anchor epoch so `firstStartTime` is 100% deterministic for
    // `(master_key, record_id)` across archive rotations and matches `~/.claude.json` 1:1.
    const FIRST_START_ANCHOR_SEC: u64 = 1_740_000_000;
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, master_key);
    let msg = format!("claude-local-slot-firststart:v1:{record_id}");
    let tag = ring::hmac::sign(&key, msg.as_bytes());
    let jitter_sec = u32::from_be_bytes([
        tag.as_ref()[0],
        tag.as_ref()[1],
        tag.as_ref()[2],
        tag.as_ref()[3],
    ]) as u64
        % (14 * 86_400);
    let jitter_ms =
        (u16::from_be_bytes([tag.as_ref()[4], tag.as_ref()[5]]) as u32 % 1000) * 1_000_000;
    let stamped_sec = FIRST_START_ANCHOR_SEC
        .saturating_sub(3_600 + jitter_sec)
        .max(1_700_000_000);
    chrono::DateTime::<chrono::Utc>::from_timestamp(stamped_sec as i64, jitter_ms)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

pub(super) fn materialize_slot_dir(
    app_data_dir: &Path,
    store: &Store,
    record: &database::Record,
    resolved_proxy: Option<&str>,
    session_tag: Option<String>,
    jitter_ms: u64,
    now_sec: u64,
) -> Result<PathBuf, String> {
    let slots_root = app_data_dir.join(CLI_SLOTS_DIR);
    private::directory(&slots_root)?;
    let slot_dir = slots_root.join(&record.id);
    if let Ok(meta) = fs::symlink_metadata(&slot_dir) {
        if cleaner::linked(&meta) {
            return Err("relay.error.unsafeSlotPath".into());
        }
    }
    private::directory(&slot_dir)?;

    let stage = store.load(record)?;
    let cred_src_path = store.home.join(".claude/.credentials.json");
    let mut filtered_creds = Map::new();
    if let Some(idx) = stage
        .manifest
        .sources
        .iter()
        .position(|s| s.path == cred_src_path)
    {
        if let Some(Value::Object(obj)) =
            read_safe_value(&stage.path.join(format!("data/{idx}")), 1024 * 1024)
        {
            for key in identity::base_credential_keys() {
                if let Some(v) = obj.get(*key) {
                    filtered_creds.insert((*key).into(), v.clone());
                }
            }
        }
    }
    let creds_bytes = serde_json::to_vec_pretty(&Value::Object(filtered_creds))
        .map_err(|_| "relay.error.serializeFailed".to_string())?;
    private::write(&slot_dir.join(".credentials.json"), &creds_bytes)?;

    let claude_src_path = store.home.join(".claude.json");
    let mut slot_claude = Map::new();
    let mut staged_uuid: Option<String> = None;
    if let Some(idx) = stage
        .manifest
        .sources
        .iter()
        .position(|s| s.path == claude_src_path)
    {
        if let Some(Value::Object(obj)) =
            read_safe_value(&stage.path.join(format!("data/{idx}")), MAX_SLOT_JSON_BYTES)
        {
            if let Some(oauth) = obj.get("oauthAccount") {
                staged_uuid = oauth
                    .get("accountUuid")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                slot_claude.insert("oauthAccount".into(), oauth.clone());
            }
        }
    }
    let existing_slot_claude_path = slot_dir.join(".claude.json");
    if !slot_dir.join(SLOT_DRIFTED_FILE).exists() {
        if let Some(Value::Object(existing_obj)) =
            read_safe_value(&existing_slot_claude_path, MAX_SLOT_JSON_BYTES)
        {
            let existing_uuid = existing_obj
                .get("oauthAccount")
                .and_then(|o| o.get("accountUuid"))
                .and_then(Value::as_str);
            let same_owner = match (staged_uuid.as_deref(), existing_uuid) {
                (Some(expected), Some(actual)) => expected.eq_ignore_ascii_case(actual),
                _ => false,
            };
            if same_owner {
                if let Some(n) = existing_obj.get("numStartups").and_then(Value::as_u64) {
                    slot_claude.insert("numStartups".into(), Value::from(n.saturating_add(1)));
                }
                for keep_key in ["cachedGrowthBookFeatures", "cachedGrowthBookFeaturesAt"] {
                    if let Some(val) = existing_obj.get(keep_key) {
                        slot_claude.insert(keep_key.into(), val.clone());
                    }
                }
            }
        }
    }
    let fallback_sec = if record.saved_at > 1_000_000_000_000 {
        record.saved_at / 1000
    } else if record.saved_at > 0 {
        record.saved_at
    } else {
        now_sec
    };
    if let Some(fst) = derive_slot_first_start_time(&store.key, &record.id, fallback_sec) {
        slot_claude.insert("firstStartTime".into(), Value::String(fst));
    }
    if !slot_claude.contains_key("numStartups") {
        slot_claude.insert("numStartups".into(), Value::from(1u64));
    }
    slot_claude.insert(
        "userID".into(),
        Value::String(derive_slot_user_id(&store.key, &record.id)),
    );
    slot_claude.insert(
        "anonymousId".into(),
        Value::String(derive_slot_anonymous_id(&store.key, &record.id)),
    );
    slot_claude.insert(
        "machineID".into(),
        Value::String(derive_slot_machine_id(&store.key, &record.id)),
    );
    if let Some(Value::Object(live_obj)) = read_safe_value(&claude_src_path, MAX_SLOT_JSON_BYTES) {
        if let Some(mcp_servers) = live_obj.get("mcpServers") {
            slot_claude.insert("mcpServers".into(), mcp_servers.clone());
        }
    }
    slot_claude.insert("profileFetchedAt".into(), Value::from(now_epoch_ms()));
    let claude_bytes = serde_json::to_vec_pretty(&Value::Object(slot_claude))
        .map_err(|_| "relay.error.serializeFailed".to_string())?;
    private::write(&existing_slot_claude_path, &claude_bytes)?;
    scrub_slot_telemetry_dead_letters(&slot_dir);

    let settings_val = build_slot_settings(&store.home, resolved_proxy);
    let settings_bytes = serde_json::to_vec_pretty(&settings_val)
        .map_err(|_| "relay.error.serializeFailed".to_string())?;
    private::write(&slot_dir.join("settings.json"), &settings_bytes)?;

    let live_claude_dir = store.home.join(".claude");
    for file_name in ["CLAUDE.md", "keybindings.json", ".mcp.json"] {
        let src = live_claude_dir.join(file_name);
        let dst = slot_dir.join(file_name);
        if let Ok(meta) = fs::symlink_metadata(&src) {
            if !cleaner::linked(&meta)
                && meta.is_file()
                && meta.len() <= 2 * 1024 * 1024
                && private::safe(&src).is_ok()
            {
                if let Ok(bytes) = fs::read(&src) {
                    private::write(&dst, &bytes)?;
                }
            }
        } else {
            let _ = safe_remove_slot_entry(&dst);
        }
    }

    let mut links = BTreeMap::new();
    for dir_name in ["skills", "commands", "agents", "rules", "hooks"] {
        if let Some(mode) = link_or_copy_shared_subdir(&live_claude_dir, &slot_dir, dir_name)? {
            links.insert(dir_name.to_string(), mode);
        }
    }

    private::directory(&slot_dir.join("projects"))?;
    private::directory(&slot_dir.join("sessions"))?;
    prune_dead_slot_sessions(&slot_dir, &[]);

    let manifest = SlotManifest {
        schema: 1,
        record_id: record.id.clone(),
        created_at_sec: now_sec,
        links,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| "relay.error.serializeFailed".to_string())?;
    private::write(&slot_dir.join(SLOT_MANIFEST_FILE), &manifest_bytes)?;

    let lease = SlotLease {
        schema: 1,
        record_id: record.id.clone(),
        session_tag,
        proxy: resolved_proxy.map(str::to_string),
        acquired_at_sec: now_sec,
        jitter_ms,
    };
    let lease_bytes = serde_json::to_vec_pretty(&lease)
        .map_err(|_| "relay.error.serializeFailed".to_string())?;
    private::write(&slot_dir.join(SLOT_LEASE_FILE), &lease_bytes)?;

    Ok(slot_dir)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct SlotPacingFile {
    #[serde(default = "default_schema_one")]
    schema: u8,
    #[serde(default)]
    exits: BTreeMap<String, u64>,
}

fn reserve_exit_launch_jitter_ms(
    app_data_dir: &Path,
    exit_key_str: &str,
    active_on_exit: usize,
    now_sec: u64,
) -> u64 {
    let wall_ms = now_epoch_ms();
    let now_ms = if (wall_ms / 1000).abs_diff(now_sec) <= 5 {
        wall_ms
    } else {
        now_sec.saturating_mul(1000)
    };
    let path = app_data_dir.join(SLOT_PACING_FILE);
    let mut state = read_safe_value(&path, 64 * 1024)
        .and_then(|v| serde_json::from_value::<SlotPacingFile>(v).ok())
        .unwrap_or_else(|| SlotPacingFile {
            schema: 1,
            exits: BTreeMap::new(),
        });
    state.schema = 1;
    state.exits.retain(|k, &mut ts| {
        let key_clean = k.trim();
        !key_clean.is_empty()
            && key_clean == k
            && key_clean.len() <= 128
            && !key_clean.chars().any(char::is_control)
            && ts > 0
            && ts >= now_ms.saturating_sub(3_600_000)
            && ts <= now_ms.saturating_add(60_000)
    });
    while state.exits.len() >= 128 {
        if let Some(oldest_key) = state
            .exits
            .iter()
            .min_by_key(|(_, &ts)| ts)
            .map(|(k, _)| k.clone())
        {
            state.exits.remove(&oldest_key);
        } else {
            break;
        }
    }

    let prev_ms = state.exits.get(exit_key_str).copied();
    let scheduled_ms = if let Some(prev) = prev_ms.filter(|&ts| ts.saturating_add(3400) > now_ms) {
        let gap_ms = random_jitter(1800, 3400);
        prev.max(now_ms)
            .saturating_add(gap_ms)
            .min(now_ms.saturating_add(20_000))
    } else if active_on_exit > 0 {
        now_ms.saturating_add(random_jitter(800, 2200))
    } else {
        now_ms.saturating_add(random_jitter(0, 250))
    };

    state.exits.insert(exit_key_str.to_string(), scheduled_ms);
    if let Ok(bytes) = serde_json::to_vec_pretty(&state) {
        if bytes.len() <= 64 * 1024 {
            let _ = private::write(&path, &bytes);
        }
    }
    scheduled_ms.saturating_sub(now_ms)
}

fn random_jitter(min_ms: u64, max_ms: u64) -> u64 {
    if max_ms <= min_ms {
        return min_ms;
    }
    let span = max_ms - min_ms + 1;
    let rand_u16 = codec::random::<2>().map(u16::from_le_bytes).unwrap_or(0) as u64;
    min_ms + (rand_u16 % span)
}

fn slot_acquire_error(status: &str, reason: &str) -> SlotAcquireResult {
    SlotAcquireResult {
        schema: 1,
        ok: false,
        status: status.into(),
        record_id: None,
        name: None,
        slot_dir: None,
        proxy: None,
        jitter_ms: None,
        active_on_exit: None,
        max_same_exit_concurrency: None,
        retry_after_ms: None,
        reason: Some(reason.into()),
        error: Some(reason.into()),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn slot_acquire_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    record_id_opt: Option<&str>,
    session_tag_opt: Option<&str>,
    proxy_override_opt: Option<&str>,
    exclude_record_ids: Option<&[String]>,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> SlotAcquireResult {
    let _lock = match acquire_orchestrate_lock(app_data_dir) {
        Ok(g) => g,
        Err(e) => return slot_acquire_error("error", &e),
    };
    let eval = match evaluate_pool(app_data_dir, vault, home, now_sec, procs, None, None) {
        Ok(ev) => ev,
        Err(e) => return slot_acquire_error("error", &e),
    };
    let mut store = match Store::open(vault, home) {
        Ok(s) => s,
        Err(e) => return slot_acquire_error("error", &e),
    };

    if let Some(raw_override) = proxy_override_opt.map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(err) = validate_http_proxy(raw_override) {
            return slot_acquire_error("error", &err);
        }
    }

    let exit_counts = exit_concurrency_counts(
        app_data_dir,
        home,
        &eval.active,
        &eval.config,
        eval.cli_running,
        &eval.active_slots,
    );
    let max_conc = eval.config.max_same_exit_concurrency;
    let db = match database::Database::open(vault) {
        Ok(d) => d,
        Err(e) => return slot_acquire_error("error", &e),
    };
    let summaries = db.summaries().unwrap_or_default();

    let excluded_ids: HashSet<String> = exclude_record_ids
        .unwrap_or(&[])
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let clean_requested_id = record_id_opt
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let chosen: Option<(AccountView, Option<String>, usize)> = if let Some(req_id) = clean_requested_id
    {
        let req_lower = req_id.to_ascii_lowercase();
        let is_hex_prefix = req_lower.len() >= 8
            && req_lower.len() <= 32
            && req_lower.bytes().all(|b| b.is_ascii_hexdigit());
        if !valid_id(&req_lower) && !is_hex_prefix {
            return slot_acquire_error("error", "relay.error.slotNotFound");
        }
        let acct = if valid_id(&req_lower) {
            let Some(found) = eval.accounts.iter().find(|a| a.id == req_lower).cloned() else {
                return slot_acquire_error("error", "relay.error.slotNotFound");
            };
            found
        } else {
            let matches: Vec<&AccountView> = eval
                .accounts
                .iter()
                .filter(|a| a.id.starts_with(&req_lower))
                .collect();
            if matches.len() != 1 {
                return slot_acquire_error("error", "relay.error.slotNotFound");
            }
            matches[0].clone()
        };
        if acct.id == eval.active {
            return slot_acquire_error("error", "relay.error.targetSlotBusy");
        }
        if acct.drifted
            || app_data_dir
                .join(CLI_SLOTS_DIR)
                .join(&acct.id)
                .join(SLOT_DRIFTED_FILE)
                .exists()
        {
            return slot_acquire_error("error", "relay.error.slotCredentialDrift");
        }
        let has_active_lease = eval
            .active_slots
            .iter()
            .any(|s| s.record_id == acct.id && s.lease_active);
        if !acct.slot_pids.is_empty() || has_active_lease {
            return slot_acquire_error("error", "relay.error.targetSlotBusy");
        }
        let sum = summaries.get(&acct.id).cloned().unwrap_or_default();
        let proxy = match resolve_slot_proxy(&acct.id, &sum, &eval.config, home, proxy_override_opt)
        {
            Ok(p) => p,
            Err(e) => return slot_acquire_error("error", &e),
        };
        let key = exit_key(proxy.as_deref());
        let active_on_exit = exit_counts.get(&key).copied().unwrap_or(0);
        if active_on_exit >= max_conc as usize {
            return SlotAcquireResult {
                schema: 1,
                ok: false,
                status: "concurrency_capped".into(),
                record_id: Some(acct.id),
                name: Some(acct.name),
                slot_dir: None,
                proxy,
                jitter_ms: None,
                active_on_exit: Some(active_on_exit),
                max_same_exit_concurrency: Some(max_conc),
                retry_after_ms: Some(5000),
                reason: Some("relay.error.slotConcurrencyCapped".into()),
                error: Some("relay.error.slotConcurrencyCapped".into()),
            };
        }
        Some((acct, proxy, active_on_exit))
    } else {
        let candidates: Vec<&String> = eval
            .ranked_slot_targets
            .iter()
            .filter(|id| !excluded_ids.contains(id.as_str()))
            .collect();
        if candidates.is_empty() {
            return slot_acquire_error("error", "relay.error.slotNotFound");
        }
        let mut first_capped: Option<(String, Option<String>, usize)> = None;
        let mut picked = None;
        for cand_id in candidates {
            let Some(acct) = eval.accounts.iter().find(|a| &a.id == cand_id).cloned() else {
                continue;
            };
            let sum = summaries.get(&acct.id).cloned().unwrap_or_default();
            let proxy =
                match resolve_slot_proxy(&acct.id, &sum, &eval.config, home, proxy_override_opt) {
                    Ok(p) => p,
                    Err(e) => return slot_acquire_error("error", &e),
                };
            let key = exit_key(proxy.as_deref());
            let active_on_exit = exit_counts.get(&key).copied().unwrap_or(0);
            if active_on_exit >= max_conc as usize {
                if first_capped.is_none() {
                    first_capped = Some((acct.id, proxy, active_on_exit));
                }
                continue;
            }
            picked = Some((acct, proxy, active_on_exit));
            break;
        }
        if picked.is_none() {
            if let Some((_, proxy, active_on_exit)) = first_capped {
                return SlotAcquireResult {
                    schema: 1,
                    ok: false,
                    status: "concurrency_capped".into(),
                    record_id: None,
                    name: None,
                    slot_dir: None,
                    proxy,
                    jitter_ms: None,
                    active_on_exit: Some(active_on_exit),
                    max_same_exit_concurrency: Some(max_conc),
                    retry_after_ms: Some(5000),
                    reason: Some("relay.error.slotConcurrencyCapped".into()),
                    error: Some("relay.error.slotConcurrencyCapped".into()),
                };
            }
            return slot_acquire_error("error", "relay.error.slotNotFound");
        }
        picked
    };

    let Some((acct, resolved_proxy, active_on_exit)) = chosen else {
        return slot_acquire_error("error", "relay.error.slotNotFound");
    };

    // Pre-sync any un-released rotated credentials from an earlier crashed run before overwriting.
    let existing_slot_dir = app_data_dir.join(CLI_SLOTS_DIR).join(&acct.id);
    if existing_slot_dir.exists() && !existing_slot_dir.join(SLOT_DRIFTED_FILE).exists() {
        match store.sync_slot_credentials(&acct.id, &existing_slot_dir) {
            Ok(_) => {
                if let Ok(rec) = store.record(&acct.id) {
                    if let Some(acct_key) = rec.account_key.as_deref() {
                        let _ = usage::collect_slot_usage(vault, &existing_slot_dir, acct_key);
                    }
                }
            }
            Err(err) => return slot_acquire_error("error", &err),
        }
    }

    let record = match store.record(&acct.id) {
        Ok(r) => r,
        Err(e) => return slot_acquire_error("error", &e),
    };
    let chosen_exit_key = exit_key(resolved_proxy.as_deref());
    let jitter_ms =
        reserve_exit_launch_jitter_ms(app_data_dir, &chosen_exit_key, active_on_exit, now_sec);
    let clean_tag = session_tag_opt.and_then(|t| truncate_display(t, 64));

    match materialize_slot_dir(
        app_data_dir,
        &store,
        &record,
        resolved_proxy.as_deref(),
        clean_tag,
        jitter_ms,
        now_sec,
    ) {
        Ok(slot_dir) => SlotAcquireResult {
            schema: 1,
            ok: true,
            status: "acquired".into(),
            record_id: Some(record.id),
            name: Some(record.name),
            slot_dir: Some(slot_dir.to_string_lossy().into_owned()),
            proxy: resolved_proxy,
            jitter_ms: Some(jitter_ms),
            active_on_exit: Some(active_on_exit),
            max_same_exit_concurrency: Some(max_conc),
            retry_after_ms: None,
            reason: None,
            error: None,
        },
        Err(e) => slot_acquire_error("error", &e),
    }
}

pub(super) fn apply_slot_failure_cooldown(
    app_data_dir: &Path,
    vault: &Path,
    record_id: &str,
    rate_limited: Option<bool>,
    auth_error: Option<bool>,
    retry_after_sec: Option<u64>,
    now_sec: u64,
) -> Option<u64> {
    if rate_limited != Some(true) && auth_error != Some(true) {
        return None;
    }
    let mut dur = retry_after_sec
        .unwrap_or(DEFAULT_COOLDOWN_SEC)
        .clamp(60, 18_000);
    if rate_limited == Some(true) && auth_error != Some(true) && retry_after_sec.is_none() {
        if let Ok(db) = database::Database::open(vault) {
            if let Ok(summaries) = db.summaries() {
                if let Some(r5) = summaries
                    .get(record_id)
                    .and_then(|s| s.quota_5h_reset_at)
                    .filter(|&t| t > now_sec)
                {
                    let rem = r5 - now_sec;
                    if (60..dur).contains(&rem) {
                        dur = rem;
                    }
                }
            }
        }
    }
    let until = now_sec.saturating_add(dur);
    let mut cfg = load_config(app_data_dir);
    cfg.cooldown_until_sec.remove("current");
    let prev = cfg.cooldown_until_sec.get(record_id).copied().unwrap_or(0);
    if until > prev {
        cfg.cooldown_until_sec.insert(record_id.to_string(), until);
    }
    if cfg.rate_limit_mode == "sink_to_end" {
        let next_sink = cfg
            .sunk_order
            .values()
            .copied()
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        cfg.sunk_order.insert(record_id.to_string(), next_sink);
    }
    let next_tick = cfg
        .rotation_tick
        .values()
        .copied()
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    cfg.rotation_tick.insert(record_id.to_string(), next_tick);
    let _ = save_config(app_data_dir, &cfg);
    Some(until.max(prev))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn slot_release_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    record_id: &str,
    rate_limited: Option<bool>,
    auth_error: Option<bool>,
    retry_after_sec: Option<u64>,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> Result<SlotReleaseResult, String> {
    if !valid_id(record_id) {
        return Err("relay.error.invalidAccountId".into());
    }
    let _lock = acquire_orchestrate_lock(app_data_dir)?;
    let slot_dir = app_data_dir.join(CLI_SLOTS_DIR).join(record_id);
    if !slot_dir.exists() {
        let cooldown_until_sec = apply_slot_failure_cooldown(
            app_data_dir,
            vault,
            record_id,
            rate_limited,
            auth_error,
            retry_after_sec,
            now_sec,
        );
        return Ok(SlotReleaseResult {
            schema: 1,
            ok: true,
            status: "released".into(),
            record_id: record_id.to_string(),
            credentials_synced: false,
            usage_ingested: 0,
            cooldown_until_sec,
            reason: None,
            error: None,
        });
    }
    private::safe(&slot_dir)?;
    let live_pids = live_slot_pids_in_dir(&slot_dir, procs);
    if !live_pids.is_empty() {
        return Err("relay.error.targetSlotBusy".into());
    }
    prune_dead_slot_sessions(&slot_dir, &[]);

    let mut store = Store::open(vault, home)?;
    let record = store.record(record_id)?;
    let sync_res = store.sync_slot_credentials(record_id, &slot_dir);

    let mut usage_ingested = 0usize;
    let drifted = sync_res
        .as_ref()
        .is_err_and(|e| e == "relay.error.slotCredentialDrift")
        || slot_dir.join(SLOT_DRIFTED_FILE).exists();

    if !drifted {
        if let Some(acct_key) = record.account_key.as_deref() {
            usage_ingested = usage::collect_slot_usage(vault, &slot_dir, acct_key);
        }
    }

    if !drifted && sync_res.is_ok() {
        scrub_idle_slot_artifacts(&slot_dir);
    } else {
        let lease_path = slot_dir.join(SLOT_LEASE_FILE);
        if let Ok(meta) = fs::symlink_metadata(&lease_path) {
            if !cleaner::linked(&meta) && meta.is_file() {
                let _ = fs::remove_file(&lease_path);
            }
        }
    }

    let cooldown_until_sec = apply_slot_failure_cooldown(
        app_data_dir,
        vault,
        record_id,
        rate_limited,
        auth_error,
        retry_after_sec,
        now_sec,
    );

    match sync_res {
        Ok(synced) => Ok(SlotReleaseResult {
            schema: 1,
            ok: true,
            status: "released".into(),
            record_id: record_id.to_string(),
            credentials_synced: synced,
            usage_ingested,
            cooldown_until_sec,
            reason: None,
            error: None,
        }),
        Err(err) => Err(err),
    }
}
