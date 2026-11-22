// [INPUT]: 主配置根目录 `.claude/jobs/<short>/adopt.json` / `state.json`、`.claude/sessions/<pid>.json` 与运行中 Claude 进程快照。
// [OUTPUT]: 后台待接管作业活体探测（job_dir_has_live_adopt / active_adopt_jobs）、防误删引用的转录路径集合（live_adopt_referenced_paths）与进程到 LiveSession 的脱敏投影（active_sessions_from_processes）。
// [POS]: identities/profile 子模块：后台守护与子代理接管作业的只读检查层，绝不停止或修改运行中的进程。
// [PROTOCOL]: 变更时更新此头部，然后检查 profile/CLAUDE.md
use super::{display, read_bounded_json, LiveSession};
use serde_json::Value;
use std::{fs, path::Path};

fn valid_adopt_job_id(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn adopt_pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if pid == std::process::id() {
        return true;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        const STILL_ACTIVE: u32 = 259;
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
        unsafe { CloseHandle(handle) };
        ok != 0 && exit_code == STILL_ACTIVE
    }
    #[cfg(not(windows))]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
}

fn resolve_adopt_agent_file(home: &Path, job_dir: &Path, raw: &str) -> Option<std::path::PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 1024 || trimmed.chars().any(char::is_control) {
        return None;
    }
    let claude_root = dunce::canonicalize(&home.join(".claude")).ok()?;
    let direct = std::path::PathBuf::from(trimmed);
    let candidates = if direct.is_absolute() {
        vec![direct]
    } else {
        vec![job_dir.join(trimmed), home.join(".claude").join(trimmed)]
    };
    for cand in candidates {
        let Ok(meta) = fs::symlink_metadata(&cand) else {
            continue;
        };
        if crate::cleaner::linked(&meta) || !meta.is_file() {
            continue;
        }
        if let Ok(canon) = dunce::canonicalize(&cand) {
            if canon.starts_with(&claude_root) {
                return Some(canon);
            }
        }
    }
    None
}

fn find_session_file_by_id(home: &Path, session_id: &str) -> Option<std::path::PathBuf> {
    let clean = session_id.trim();
    if clean.is_empty()
        || clean.len() > 128
        || !clean
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return None;
    }
    let claude_root = dunce::canonicalize(&home.join(".claude")).ok()?;
    let target_jsonl = format!("{clean}.jsonl");
    let projects_dir = home.join(".claude/projects");
    if let Ok(projects) = fs::read_dir(&projects_dir) {
        for proj in projects.flatten() {
            let p_path = proj.path();
            if fs::symlink_metadata(&p_path).is_err_and(|_| true)
                || crate::cleaner::linked(&fs::symlink_metadata(&p_path).ok()?)
            {
                continue;
            }
            for cand in [
                p_path.join(&target_jsonl),
                p_path.join("subagents").join(&target_jsonl),
            ] {
                if let Ok(meta) = fs::symlink_metadata(&cand) {
                    if !crate::cleaner::linked(&meta) && meta.is_file() {
                        if let Ok(canon) = dunce::canonicalize(&cand) {
                            if canon.starts_with(&claude_root) {
                                return Some(canon);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn inspect_job_adopt(home: &Path, job_dir: &Path) -> (bool, Vec<std::path::PathBuf>) {
    let Ok(dir_meta) = fs::symlink_metadata(job_dir) else {
        return (false, Vec::new());
    };
    if crate::cleaner::linked(&dir_meta) || !dir_meta.is_dir() {
        return (false, Vec::new());
    }
    let adopt_path = job_dir.join("adopt.json");
    let Ok(adopt_meta) = fs::symlink_metadata(&adopt_path) else {
        return (false, Vec::new());
    };
    if crate::cleaner::linked(&adopt_meta)
        || !adopt_meta.is_file()
        || adopt_meta.len() == 0
        || adopt_meta.len() > 512 * 1024
    {
        return (false, Vec::new());
    }
    let Ok(bytes) = fs::read(&adopt_path) else {
        return (false, Vec::new());
    };
    let Ok(val) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return (false, Vec::new());
    };

    let state_stopped = {
        let state_path = job_dir.join("state.json");
        fs::symlink_metadata(&state_path)
            .ok()
            .filter(|m| !crate::cleaner::linked(m) && m.is_file() && m.len() <= 64 * 1024)
            .and_then(|_| fs::read(&state_path).ok())
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|sv| {
                sv.get("state")
                    .or_else(|| sv.get("status"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case("stopped"))
            })
            .unwrap_or(false)
    };

    let mut has_live_shell = false;
    if let Some(shells) = val.get("shells").and_then(|v| v.as_array()) {
        for item in shells {
            let pid_opt = item
                .get("pid")
                .and_then(|v| v.as_u64())
                .or_else(|| item.as_u64())
                .and_then(|p| u32::try_from(p).ok());
            if pid_opt.is_some_and(adopt_pid_is_alive) {
                has_live_shell = true;
                break;
            }
        }
    }

    if state_stopped && !has_live_shell {
        return (false, Vec::new());
    }

    let mut referenced_files: Vec<std::path::PathBuf> = Vec::new();
    let mut has_live_agent = false;
    if let Some(agents) = val.get("agents").and_then(|v| v.as_array()) {
        for item in agents {
            let ended = item
                .get("status")
                .or_else(|| item.get("state"))
                .and_then(|v| v.as_str())
                .is_some_and(|s| {
                    matches!(
                        s.trim().to_ascii_lowercase().as_str(),
                        "stopped" | "completed" | "failed" | "done" | "exited"
                    )
                });
            if ended {
                continue;
            }
            let mut matched = false;
            for key in [
                "transcriptPath",
                "transcript_path",
                "sessionPath",
                "session_path",
                "filePath",
                "file_path",
            ] {
                if let Some(raw) = item.get(key).and_then(|v| v.as_str()) {
                    if let Some(p) = resolve_adopt_agent_file(home, job_dir, raw) {
                        if !referenced_files.contains(&p) {
                            referenced_files.push(p);
                        }
                        matched = true;
                    }
                }
            }
            if !matched {
                for key in ["sessionId", "session_id", "agentId", "agent_id"] {
                    if let Some(id) = item.get(key).and_then(|v| v.as_str()) {
                        if let Some(p) = find_session_file_by_id(home, id) {
                            if !referenced_files.contains(&p) {
                                referenced_files.push(p);
                            }
                            matched = true;
                        }
                    }
                }
            }
            if matched {
                has_live_agent = true;
            }
        }
    }

    if has_live_shell || has_live_agent {
        (true, referenced_files)
    } else {
        (false, Vec::new())
    }
}

pub(crate) fn job_dir_has_live_adopt(home: &Path, job_dir: &Path) -> bool {
    inspect_job_adopt(home, job_dir).0
}

pub(crate) fn live_adopt_referenced_paths(home: &Path) -> Vec<std::path::PathBuf> {
    let jobs_dir = home.join(".claude/jobs");
    let Ok(dir_meta) = fs::symlink_metadata(&jobs_dir) else {
        return Vec::new();
    };
    if crate::cleaner::linked(&dir_meta) || !dir_meta.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&jobs_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_adopt_job_id(&name) {
            continue;
        }
        let (live, refs) = inspect_job_adopt(home, &entry.path());
        if live {
            for p in refs {
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

pub(crate) fn active_adopt_jobs(home: &Path) -> Vec<String> {
    let jobs_dir = home.join(".claude/jobs");
    let Ok(dir_meta) = fs::symlink_metadata(&jobs_dir) else {
        return Vec::new();
    };
    if crate::cleaner::linked(&dir_meta) || !dir_meta.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&jobs_dir) else {
        return Vec::new();
    };
    let mut ranked: Vec<(u8, String)> = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_adopt_job_id(&name) {
            continue;
        }
        let job_path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&job_path) else {
            continue;
        };
        if crate::cleaner::linked(&meta) || !meta.is_dir() {
            continue;
        }
        let has_adopt_file = fs::symlink_metadata(job_path.join("adopt.json"))
            .is_ok_and(|m| !crate::cleaner::linked(&m) && m.is_file());
        if has_adopt_file {
            if job_dir_has_live_adopt(home, &job_path) {
                ranked.push((0, name));
            }
            continue;
        }
        let state_path = job_path.join("state.json");
        let has_live_state = fs::symlink_metadata(&state_path)
            .ok()
            .filter(|m| !crate::cleaner::linked(m) && m.is_file() && m.len() <= 64 * 1024)
            .is_some_and(|_| {
                fs::read(&state_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .and_then(|sv| {
                        sv.get("state")
                            .or_else(|| sv.get("status"))
                            .and_then(|v| v.as_str())
                            .map(|s| !s.eq_ignore_ascii_case("stopped"))
                    })
                    .unwrap_or(true)
            });
        if has_live_state {
            ranked.push((1, name));
        }
    }
    ranked.sort();
    ranked.truncate(8);
    ranked.into_iter().map(|(_, name)| name).collect()
}

pub(crate) fn active_sessions_from_processes(
    home: &Path,
    running: &[crate::cleaner::ClaudeProcess],
) -> Vec<LiveSession> {
    if running.is_empty() {
        return Vec::new();
    }
    let sessions_dir = home.join(".claude/sessions");
    let mut out = Vec::with_capacity(running.len());
    for proc in running {
        let background = proc.role().is_background();
        let mut workspace = None;
        let mut entrypoint = proc.name.clone();
        let session_file = sessions_dir.join(format!("{}.json", proc.pid));
        if let Some(val) = read_bounded_json(&session_file, 64 * 1024) {
            if let Some(cwd) = val.get("cwd").and_then(Value::as_str) {
                let folder = Path::new(cwd)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::to_string)
                    .or_else(|| Some(cwd.to_string()));
                workspace = display(folder, 48);
            }
            if let Some(ep) = val.get("entrypoint").and_then(Value::as_str) {
                entrypoint = match ep {
                    "cli" => "CLI".into(),
                    "claude-vscode" => "VS Code".into(),
                    "claude-desktop" => "Claude Desktop".into(),
                    "sdk-cli" => "SDK".into(),
                    "mcp" => "MCP".into(),
                    other => display(Some(other.to_string()), 24).unwrap_or(entrypoint),
                };
            }
        }
        out.push(LiveSession {
            pid: proc.pid,
            workspace,
            entrypoint,
            background,
            child_shells: if background {
                Vec::new()
            } else {
                proc.child_shells().to_vec()
            },
        });
    }
    out
}
