// [INPUT]: Cleaner 白名单、共享 Code 登录键常量、完整目录快照、用户保留策略与 JSON 配置。
// [OUTPUT]: 账号凭据/归属与必要缓存的受限身份目标；旧归档只读兼容、写回前投影保护设备和 UI/实验状态；显式切换后的窄账号缓存维护不改诊断或历史正文。
// [POS]: 身份保险库复用原有路径边界；不扫描项目源码、Shell 或系统代理配置。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use crate::identities::Policy;
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Source {
    pub path: PathBuf,
    pub category: String,
    pub keys: Vec<String>,
}
pub(crate) fn credential_keys(policy: &Policy) -> Vec<String> {
    let mut keys = config::CREDENTIAL_KEYS
        .iter()
        .map(|key| (*key).into())
        .collect::<Vec<String>>();
    if !policy.mcp {
        keys.extend(
            [
                "mcpOAuth",
                "mcpOAuthClientConfig",
                "mcpXaaIdp",
                "mcpXaaIdpConfig",
            ]
            .map(str::to_string),
        );
    }
    if !policy.plugins {
        keys.push("pluginSecrets".into());
    }
    keys
}
pub(crate) const SETTINGS_IDENTITY_KEYS: &[&str] = &[
    "env.CLAUDE_CODE_OAUTH_TOKEN",
    "env.ANTHROPIC_API_KEY",
    "env.ANTHROPIC_AUTH_TOKEN",
    "env.HTTP_PROXY",
    "env.HTTPS_PROXY",
    "env.ALL_PROXY",
    "env.NO_PROXY",
    "env.http_proxy",
    "env.https_proxy",
    "env.all_proxy",
    "env.no_proxy",
    "apiKeyHelper",
];
fn definitions(root: &Path, policy: &Policy) -> Vec<Source> {
    let mut result: Vec<_> = targets::definitions(root)
        .into_iter()
        .filter(|t| {
            (matches!(t.group, "cache" | "history" | "account" | "desktop")
                || (t.group == "backups"
                    && (t.path.starts_with(root.join(".claude"))
                        || t.path.file_name().is_some_and(|n| {
                            n.to_string_lossy().starts_with(".claude.json.backup")
                        }))))
                && !(t.group == "history" && policy.history)
                && !(t.group == "cache" && policy.cache)
        })
        .map(|t| Source {
            path: t.path,
            category: t.group.into(),
            keys: if matches!(t.operation, Operation::Edit(config::EditKind::Account)) {
                config::ACCOUNT_KEYS.iter().map(|s| s.to_string()).collect()
            } else {
                Vec::new()
            },
        })
        .collect();
    if let Some(source) = result
        .iter_mut()
        .find(|s| s.path == root.join(".claude.json"))
    {
        if !policy.mcp {
            source.keys.push("mcpServers".into());
        }
        if !policy.projects {
            source.keys.push("projects".into());
            source.keys.push("githubRepoPaths".into());
        }
    }
    if let Some(source) = result
        .iter_mut()
        .find(|s| s.path == root.join(".claude/.credentials.json"))
    {
        source.keys = credential_keys(policy);
    }
    if !policy.mcp {
        let roots: std::collections::BTreeSet<_> = result
            .iter()
            .filter(|s| {
                s.category == "desktop" && s.path.file_name().is_some_and(|n| n == "Local Storage")
            })
            .filter_map(|s| s.path.parent().map(Path::to_path_buf))
            .collect();
        for desktop in roots {
            result.push(Source {
                path: desktop.join("claude_desktop_config.json"),
                category: "mcp".into(),
                keys: vec!["mcpServers".into()],
            });
        }
    }
    for name in ["settings.json", "settings.local.json"] {
        result.push(Source {
            path: root.join(".claude").join(name),
            category: "settings".into(),
            keys: if policy.settings {
                SETTINGS_IDENTITY_KEYS.iter().map(|k| (*k).into()).collect()
            } else {
                Vec::new()
            },
        });
    }
    for (category, keep, names) in [
        (
            "skills",
            policy.skills,
            vec!["skills", "commands", "agents", "hooks"],
        ),
        ("plugins", policy.plugins, vec!["plugins"]),
        ("mcp", policy.mcp, vec![".mcp.json"]),
    ] {
        if !keep {
            for name in names {
                result.push(Source {
                    path: root.join(".claude").join(name),
                    category: category.into(),
                    keys: Vec::new(),
                });
            }
        }
    }
    result.sort_by(|a, b| a.path.cmp(&b.path));
    result.dedup_by(|a, b| a.path == b.path);
    result
}
pub(crate) fn sources(root: &Path, policy: &Policy) -> Result<Vec<Source>, String> {
    let mut result = Vec::new();
    for source in definitions(root, policy) {
        let meta = match fs::symlink_metadata(&source.path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("身份数据无法完整读取；未修改任何数据。".into()),
        };
        #[cfg(test)]
        if !linked(&meta) {
            assert_eq!(
                canonicalize(&source.path).ok().as_deref(),
                Some(source.path.as_path()),
                "fixture source must be canonical"
            );
        }
        if linked(&meta)
            || canonicalize(&source.path).ok().as_deref() != Some(source.path.as_path())
        {
            return Err("身份路径包含链接或特殊文件。".into());
        }
        crate::identities::private::safe(&source.path)?;
        targets::measure(&source.path)?;
        if !source.keys.is_empty() {
            let text = fs::read_to_string(&source.path).map_err(|_| "身份配置无法读取。")?;
            if extract(&source, &text)?
                .as_object()
                .is_some_and(|o| o.is_empty())
            {
                continue;
            }
        }
        result.push(source);
    }
    let all = result.clone();
    result.retain(|s| {
        !all.iter()
            .any(|p| p.path != s.path && p.keys.is_empty() && s.path.starts_with(&p.path))
    });
    Ok(result)
}
fn preserved_client_path(root: &Path, path: &Path) -> bool {
    [".claude/.user-id", ".claude/.machine-id"]
        .iter()
        .any(|p| path == root.join(p))
        || [
            "Library/Preferences/com.anthropic.claudefordesktop.plist",
            "Library/Saved Application State/com.anthropic.claudefordesktop.savedState",
        ]
        .iter()
        .any(|p| path == root.join(p))
        || (path.parent() == Some(root.join("Library/Preferences/ByHost").as_path())
            && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                n.starts_with("com.anthropic.claudefordesktop") && n.ends_with(".plist")
            }))
        || targets::desktop_roots(root).iter().any(|desktop| {
            [
                "ant-did",
                "ant-device-registry.json",
                ".machine-id",
                "machine-id",
                "sentry",
            ]
            .iter()
            .any(|name| path == desktop.join(name))
        })
}
fn writable_account_key(key: &str) -> bool {
    config::ACCOUNT_KEYS.contains(&key)
        || ["mcpServers", "projects", "githubRepoPaths"].contains(&key)
}
/// Reading a legacy manifest is distinct from authorizing its current write set.
/// Old broad account snapshots remain verifiable; device/UI state never moves back.
pub(crate) fn writable_source(root: &Path, source: &Source) -> Option<Source> {
    if preserved_client_path(root, &source.path) {
        return None;
    }
    let mut projected = source.clone();
    if source.path == root.join(".claude.json") && source.category == "account" {
        if projected.keys.is_empty() {
            projected.keys = config::ACCOUNT_KEYS
                .iter()
                .copied()
                .chain(["mcpServers", "projects", "githubRepoPaths"])
                .map(str::to_string)
                .collect();
        } else {
            projected.keys.retain(|key| writable_account_key(key));
        }
        if projected.keys.is_empty() {
            return None;
        }
    }
    Some(projected)
}
pub(crate) fn allowed(root: &Path, source: &Source) -> bool {
    let all = definitions(root, &Policy::all());
    let known = all.iter().any(|t| {
        t.path == source.path
            && t.category == source.category
            && ((source.path == root.join(".claude.json")
                && source.category == "account"
                && !source.keys.is_empty()
                && source
                    .keys
                    .iter()
                    .all(|k| !k.contains('.') && !k.contains('/')))
                || source.keys.iter().all(|k| t.keys.contains(k))
                || (source.category == "settings"
                    && source
                        .keys
                        .iter()
                        .all(|k| SETTINGS_IDENTITY_KEYS.contains(&k.as_str()))))
    });
    let special = source.keys.is_empty()
        && [
            (
                "Library/Preferences/ByHost",
                "com.anthropic.claudefordesktop",
            ),
            ("Library/Caches", "com.anthropic.claudefordesktop"),
            ("Library/Logs/DiagnosticReports", "Claude"),
            ("Library/Application Support/CrashReporter", "Claude"),
        ]
        .iter()
        .any(|(parent, prefix)| {
            source.path.parent() == Some(root.join(parent).as_path())
                && source
                    .path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| s.starts_with(prefix))
        });
    // These exact old device/preference targets may be authenticated and read,
    // but writable_source excludes them from clearing and restoring.
    let legacy_preserved = source.keys.is_empty()
        && matches!(source.category.as_str(), "account" | "desktop")
        && preserved_client_path(root, &source.path);
    known || special || legacy_preserved
}
pub(crate) fn fingerprint(path: &Path) -> Result<Vec<u8>, String> {
    Ok(targets::measure(path)?.2)
}
fn pointer(key: &str) -> String {
    format!("/{}", key.replace('.', "/"))
}
pub(crate) fn extract(source: &Source, text: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "身份配置不是有效 JSON。")?;
    if !value.is_object() {
        return Err("身份配置不是对象。".into());
    }
    Ok(serde_json::Value::Object(
        source
            .keys
            .iter()
            .filter_map(|k| value.pointer(&pointer(k)).cloned().map(|v| (k.clone(), v)))
            .collect(),
    ))
}
pub(crate) fn apply_config(source: &Source, saved: &serde_json::Value) -> Result<(), String> {
    if source.path.exists() {
        crate::identities::private::protect(&source.path)?;
    }
    let text = if source.path.exists() {
        fs::read_to_string(&source.path).map_err(|_| "身份配置无法读取。")?
    } else {
        "{}".into()
    };
    let mut current: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "身份配置不是有效 JSON。")?;
    if !current.is_object() {
        return Err("身份配置不是对象。".into());
    }
    for key in &source.keys {
        if source.category == "account"
            && source
                .path
                .file_name()
                .is_some_and(|name| name == ".claude.json")
            && !writable_account_key(key)
        {
            continue;
        }
        let mut parts = key.split('.');
        let first = parts.next().unwrap();
        let obj = if let Some(second) = parts.next() {
            let parent = current
                .as_object_mut()
                .unwrap()
                .entry(first)
                .or_insert_with(|| serde_json::json!({}));
            let object = parent.as_object_mut().ok_or("身份配置不是对象。")?;
            if let Some(v) = saved.get(key) {
                object.insert(second.into(), v.clone());
            } else {
                object.remove(second);
            }
            continue;
        } else {
            current.as_object_mut().unwrap()
        };
        if let Some(v) = saved.get(key) {
            obj.insert(first.into(), v.clone());
        } else {
            obj.remove(first);
        }
    }
    let bytes = serde_json::to_vec_pretty(&current).map_err(|_| "身份配置无法保存。")?;
    if source.path.exists() {
        file_io::atomic_write(&source.path, &bytes, 0o600)
    } else {
        crate::identities::private::write(&source.path, &bytes)
    }
}
pub(crate) fn merge_kept_projects(
    claude_json_path: &Path,
    saved: &serde_json::Value,
) -> Result<(), String> {
    if !claude_json_path.exists() {
        return Ok(());
    }
    crate::identities::private::protect(claude_json_path)?;
    let text = fs::read_to_string(claude_json_path).map_err(|_| "身份配置无法读取。")?;
    let mut current: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "身份配置不是有效 JSON。")?;
    let Some(curr_obj) = current.as_object_mut() else {
        return Ok(());
    };
    let mut changed = false;
    for top_key in ["projects", "githubRepoPaths"] {
        let Some(saved_map) = saved.get(top_key).and_then(|v| v.as_object()) else {
            continue;
        };
        if saved_map.is_empty() {
            continue;
        }
        let live_entry = curr_obj
            .entry(top_key)
            .or_insert_with(|| serde_json::json!({}));
        if let Some(live_map) = live_entry.as_object_mut() {
            for (k, v) in saved_map {
                if !k.contains('\u{FFFD}') && !live_map.contains_key(k) {
                    live_map.insert(k.clone(), v.clone());
                    changed = true;
                }
            }
        }
    }
    if changed {
        let bytes = serde_json::to_vec_pretty(&current).map_err(|_| "身份配置无法保存。")?;
        file_io::atomic_write(claude_json_path, &bytes, 0o600)?;
    }
    Ok(())
}
pub(crate) fn root() -> Result<PathBuf, String> {
    home()
}
pub(crate) fn ensure_stopped() -> Result<(), String> {
    if running()? {
        Err("请先结束 Claude 进程，再切换身份。".into())
    } else {
        Ok(())
    }
}

pub(crate) fn processes_running() -> Result<bool, String> {
    running()
}

pub(crate) fn running_processes() -> Vec<ClaudeProcess> {
    super::processes().unwrap_or_default()
}

pub(crate) fn account_key(key: &str) -> bool {
    config::ACCOUNT_KEYS.contains(&key)
}

// ----- 只检查桌面身份路径元数据，不读取 Cookie 或数据库正文 -----
pub(crate) fn desktop_present(root: &Path) -> bool {
    definitions(root, &Policy::default())
        .into_iter()
        .filter(|s| s.category == "desktop")
        .any(|s| {
            crate::identities::private::parents(s.path.parent().unwrap()).is_ok()
                && crate::identities::private::safe(&s.path).is_ok()
        })
}

fn remove_safe_entry(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if linked(&meta) || canonicalize(path).ok().as_deref() != Some(path) {
        return;
    }
    let Some(parent) = path.parent() else {
        return;
    };
    if crate::identities::private::parents(parent).is_err()
        || crate::identities::private::safe(path).is_err()
    {
        return;
    }
    if meta.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else if meta.is_file() {
        let _ = fs::remove_file(path);
    }
}

fn root_has_running_claude(root: &Path) -> bool {
    #[cfg(test)]
    if crate::cleaner::identity::root().ok().as_deref() != Some(root) {
        return false;
    }
    let _ = root;
    running().unwrap_or(true)
}

fn is_lock_stale(path: &Path, stale_secs: u64) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    meta.modified()
        .ok()
        .and_then(|m| m.elapsed().ok())
        .is_some_and(|age| age.as_secs() >= stale_secs)
}

/// 清理 Claude Code 在异常退出、进程强杀或切换账号后遗留的 OAuth / 配置互斥锁文件及已退出进程的孤儿会话描述文件，防止下次启动阻塞或报锁冲突。
/// 借鉴 `realiti4/claude-swap` (`claude_locks.py`) 锁协议：当无 Claude 进程运行时立即清理全部残留锁；若仍有进程运行，则严格遵循 Claude Code `proper-lockfile` 过期阈值（凭据锁 60s、配置锁 10s）。
pub(crate) fn clear_stale_locks(root: &Path) {
    let is_running = root_has_running_claude(root);
    for (rel, stale_secs) in [
        (".claude/.oauth_refresh.lock", 60u64),
        (".claude/.oauth_refresh.lock.owner", 60u64),
        (".claude/daemon.lock", 60u64),
        (".claude.lock", 60u64),
        (".claude.json.lock", 10u64),
        (".claude/settings.json.lock", 10u64),
        (".claude/settings.local.json.lock", 10u64),
    ] {
        let p = root.join(rel);
        if !is_running || is_lock_stale(&p, stale_secs) {
            remove_safe_entry(&p);
        }
    }
    let live_pids: std::collections::BTreeSet<i32> =
        running_processes().into_iter().map(|p| p.pid).collect();
    if let Ok(entries) = fs::read_dir(root.join(".claude/sessions")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let pid_part = name.split('.').next().unwrap_or("");
            if let Ok(pid) = pid_part.parse::<i32>() {
                if !live_pids.contains(&pid) {
                    remove_safe_entry(&entry.path());
                }
            }
        }
    }
}

const EMAIL_REMINDER_PREFIX: &str = "The user's email address is ";
const EMAIL_REMINDER_SUFFIX: &str = ". Use it only to identify the user";

fn has_foreign_email_in_text(text: &str, active_email: &str) -> bool {
    let mut rest = text;
    while let Some(start) = rest.find(EMAIL_REMINDER_PREFIX) {
        let after_prefix = &rest[start + EMAIL_REMINDER_PREFIX.len()..];
        if let Some(end) = after_prefix.find(EMAIL_REMINDER_SUFFIX) {
            let found = &after_prefix[..end];
            if !found.is_empty() && found.len() <= 254 && found != active_email {
                return true;
            }
            rest = &after_prefix[end + EMAIL_REMINDER_SUFFIX.len()..];
        } else {
            break;
        }
    }
    false
}

fn replace_foreign_email_in_line(line: &str, active_email: &str) -> Option<String> {
    if !line.contains(EMAIL_REMINDER_PREFIX) {
        return None;
    }
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    let mut changed = false;
    while let Some(start) = rest.find(EMAIL_REMINDER_PREFIX) {
        out.push_str(&rest[..start]);
        let after_prefix = &rest[start + EMAIL_REMINDER_PREFIX.len()..];
        if let Some(end) = after_prefix.find(EMAIL_REMINDER_SUFFIX) {
            let found = &after_prefix[..end];
            if !found.is_empty() && found.len() <= 254 && found != active_email {
                out.push_str(EMAIL_REMINDER_PREFIX);
                out.push_str(active_email);
                out.push_str(EMAIL_REMINDER_SUFFIX);
                changed = true;
            } else {
                out.push_str(
                    &rest[start
                        ..start + EMAIL_REMINDER_PREFIX.len() + end + EMAIL_REMINDER_SUFFIX.len()],
                );
            }
            rest = &after_prefix[end + EMAIL_REMINDER_SUFFIX.len()..];
        } else {
            out.push_str(&rest[start..start + EMAIL_REMINDER_PREFIX.len()]);
            rest = after_prefix;
        }
    }
    out.push_str(rest);
    changed.then_some(out)
}

fn file_has_foreign_session_markers(
    path: &Path,
    active_acct: Option<&str>,
    active_org: Option<&str>,
    active_email: Option<&str>,
) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    if linked(&meta)
        || !meta.is_file()
        || meta.len() == 0
        || meta.len() > 64 * 1024 * 1024
        || canonicalize(path).ok().as_deref() != Some(path)
        || crate::identities::private::safe(path).is_err()
    {
        return false;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    if let Some(act_email) = active_email {
        if has_foreign_email_in_text(&text, act_email) {
            return true;
        }
    }
    if let Some(act_org) = active_org {
        if text.contains("\"credential_org\"") {
            for line in text.lines() {
                if !line.contains("\"credential_org\"") {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                    if val.get("type").and_then(|t| t.as_str()) == Some("attachment")
                        && val.pointer("/attachment/type").and_then(|t| t.as_str())
                            == Some("credential_org")
                        && val
                            .pointer("/attachment/organizationUuid")
                            .and_then(|u| u.as_str())
                            .is_some_and(|u| !u.is_empty() && u != act_org)
                    {
                        return true;
                    }
                }
            }
        }
    }
    if text.contains("\"bridge-session\"") {
        for line in text.lines() {
            if !line.contains("\"bridge-session\"") {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                if val.get("type").and_then(|t| t.as_str()) == Some("bridge-session") {
                    let foreign_owner_acct = active_acct.is_some_and(|act| {
                        val.get("ownerAccountUuid")
                            .or_else(|| val.get("bridgeOwnerAccountUuid"))
                            .and_then(|u| u.as_str())
                            .is_some_and(|u| !u.is_empty() && u != act)
                    });
                    let foreign_owner_org = active_org.is_some_and(|org| {
                        val.get("ownerOrganizationUuid")
                            .or_else(|| val.get("bridgeOwnerOrganizationUuid"))
                            .and_then(|u| u.as_str())
                            .is_some_and(|u| !u.is_empty() && u != org)
                    });
                    if foreign_owner_acct || foreign_owner_org {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn family_needs_foreign_sanitization(
    family_files: &[PathBuf],
    active_acct: Option<&str>,
    active_org: Option<&str>,
    active_email: Option<&str>,
) -> bool {
    if family_files
        .iter()
        .any(|f| file_has_foreign_session_markers(f, active_acct, active_org, active_email))
    {
        return true;
    }
    let mut has_removed_thinking_marker = false;
    let mut has_residual_foreign_blob_or_sig = false;
    for path in family_files {
        let Ok(meta) = fs::symlink_metadata(path) else {
            continue;
        };
        if linked(&meta) || !meta.is_file() || meta.len() == 0 || meta.len() > 64 * 1024 * 1024 {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        if text.contains("[Thinking removed]") {
            has_removed_thinking_marker = true;
        }
        if text.contains("\"api-request-blob\"")
            || text.contains("\"api-request\"")
            || text.contains("\"api-request-shape\"")
            || text.contains("\"signature\"")
        {
            has_residual_foreign_blob_or_sig = true;
        }
    }
    has_removed_thinking_marker && has_residual_foreign_blob_or_sig
}

/// 借鉴 `KarpelesLab/teamclaude` (`tool-pair-sanitize.js`) 与 Claude Code `ensureToolResultPairing`：
/// 当账号因 5h 限额耗尽 (429) 或手动中断而卡在 `tool_use` 半途时，修复末尾或跨轮次未配对的 `tool_use` / 孤儿 `tool_result`，
/// 旧兼容诊断转换：保持 `uuid` / `parentUuid` 链；产品切换和恢复不调用此转换。
fn repair_unpaired_tool_blocks_in_lines(lines: &[String]) -> Option<Vec<String>> {
    let has_tool_blocks = lines
        .iter()
        .any(|l| l.contains("\"tool_use\"") || l.contains("\"tool_result\""));
    if !has_tool_blocks {
        return None;
    }
    let mut tool_use_ids = std::collections::BTreeSet::new();
    let mut tool_result_ids = std::collections::BTreeSet::new();
    for line in lines {
        if !line.contains("\"tool_use\"") && !line.contains("\"tool_result\"") {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match val.get("type").and_then(|t| t.as_str()) {
            Some("assistant") => {
                if let Some(arr) = val.pointer("/message/content").and_then(|c| c.as_array()) {
                    for item in arr {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                if !id.is_empty() {
                                    tool_use_ids.insert(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            Some("user") => {
                if let Some(arr) = val.pointer("/message/content").and_then(|c| c.as_array()) {
                    for item in arr {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            if let Some(id) = item.get("tool_use_id").and_then(|i| i.as_str()) {
                                if !id.is_empty() {
                                    tool_result_ids.insert(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if tool_use_ids == tool_result_ids {
        return None;
    }
    let mut out = Vec::with_capacity(lines.len());
    let mut modified = false;
    for line in lines {
        if !line.contains("\"tool_use\"") && !line.contains("\"tool_result\"") {
            out.push(line.clone());
            continue;
        }
        let Ok(mut val) = serde_json::from_str::<serde_json::Value>(line) else {
            out.push(line.clone());
            continue;
        };
        let mut line_changed = false;
        match val.get("type").and_then(|t| t.as_str()) {
            Some("assistant") => {
                if let Some(content_arr) = val
                    .pointer_mut("/message/content")
                    .and_then(|c| c.as_array_mut())
                {
                    let before = content_arr.len();
                    content_arr.retain(|item| {
                        if item.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                            return true;
                        }
                        item.get("id")
                            .and_then(|i| i.as_str())
                            .is_some_and(|id| tool_result_ids.contains(id))
                    });
                    if content_arr.len() != before {
                        let has_visible_block = content_arr.iter().any(|item| {
                            !matches!(
                                item.get("type").and_then(|t| t.as_str()),
                                Some("thinking" | "redacted_thinking")
                            )
                        });
                        if !has_visible_block {
                            content_arr.push(serde_json::json!({
                                "type": "text",
                                "text": "[Tool use interrupted]",
                                "citations": []
                            }));
                        }
                        line_changed = true;
                    }
                }
            }
            Some("user") => {
                if let Some(content_arr) = val
                    .pointer_mut("/message/content")
                    .and_then(|c| c.as_array_mut())
                {
                    let before = content_arr.len();
                    content_arr.retain(|item| {
                        if item.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                            return true;
                        }
                        item.get("tool_use_id")
                            .and_then(|i| i.as_str())
                            .is_some_and(|id| tool_use_ids.contains(id))
                    });
                    if content_arr.len() != before {
                        if content_arr.is_empty() {
                            *content_arr = vec![serde_json::json!({
                                "type": "text",
                                "text": "[Orphaned tool result removed due to conversation resume]"
                            })];
                        }
                        line_changed = true;
                    }
                }
            }
            _ => {}
        }
        if line_changed {
            if let Ok(serialized) = serde_json::to_string(&val) {
                out.push(serialized);
                modified = true;
                continue;
            }
        }
        out.push(line.clone());
    }
    modified.then_some(out)
}

fn sanitize_jsonl_session_file(
    path: &Path,
    active_org: Option<&str>,
    active_email: Option<&str>,
    strip_thinking: bool,
    repair_tools: bool,
) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if linked(&meta)
        || !meta.is_file()
        || meta.len() == 0
        || meta.len() > 64 * 1024 * 1024
        || canonicalize(path).ok().as_deref() != Some(path)
        || crate::identities::private::safe(path).is_err()
    {
        return;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    if !strip_thinking
        && !repair_tools
        && !text.contains("\"credential_org\"")
        && !text.contains(EMAIL_REMINDER_PREFIX)
    {
        return;
    }
    let mut out_lines: Vec<String> = Vec::new();
    let mut file_modified = false;
    for line in text.lines() {
        let mut current: std::borrow::Cow<'_, str> = std::borrow::Cow::Borrowed(line);
        if strip_thinking
            && (current.contains("\"api-request") || current.contains("\"bridge-session\""))
        {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&current) {
                if matches!(
                    val.get("type").and_then(|t| t.as_str()),
                    Some(
                        "api-request" | "api-request-shape" | "api-request-blob" | "bridge-session"
                    )
                ) {
                    file_modified = true;
                    continue;
                }
            }
        }
        if let Some(act_email) = active_email {
            if let Some(replaced) = replace_foreign_email_in_line(&current, act_email) {
                current = std::borrow::Cow::Owned(replaced);
                file_modified = true;
            }
        }
        if let Some(act_org) = active_org {
            if current.contains("\"credential_org\"") {
                if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&current) {
                    if val.get("type").and_then(|t| t.as_str()) == Some("attachment")
                        && val.pointer("/attachment/type").and_then(|t| t.as_str())
                            == Some("credential_org")
                        && val
                            .pointer("/attachment/organizationUuid")
                            .and_then(|u| u.as_str())
                            .is_some_and(|u| !u.is_empty() && u != act_org)
                    {
                        if let Some(att) = val.get_mut("attachment").and_then(|a| a.as_object_mut())
                        {
                            att.insert(
                                "organizationUuid".into(),
                                serde_json::Value::String(act_org.into()),
                            );
                            if let Ok(serialized) = serde_json::to_string(&val) {
                                current = std::borrow::Cow::Owned(serialized);
                                file_modified = true;
                            }
                        }
                    }
                }
            }
        }
        if strip_thinking
            && (current.contains("\"thinking\"") || current.contains("\"redacted_thinking\""))
        {
            if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&current) {
                if val.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                    if let Some(content_arr) = val
                        .pointer_mut("/message/content")
                        .and_then(|c| c.as_array_mut())
                    {
                        let before_len = content_arr.len();
                        content_arr.retain(|item| {
                            !matches!(
                                item.get("type").and_then(|t| t.as_str()),
                                Some("thinking" | "redacted_thinking")
                            )
                        });
                        if content_arr.len() != before_len {
                            if content_arr.is_empty() {
                                *content_arr = vec![serde_json::json!({
                                    "type": "text",
                                    "text": "[Thinking removed]",
                                    "citations": []
                                })];
                            }
                            if let Ok(serialized) = serde_json::to_string(&val) {
                                current = std::borrow::Cow::Owned(serialized);
                                file_modified = true;
                            }
                        }
                    }
                }
            }
        }
        out_lines.push(current.into_owned());
    }
    if strip_thinking || repair_tools {
        if let Some(repaired) = repair_unpaired_tool_blocks_in_lines(&out_lines) {
            out_lines = repaired;
            file_modified = true;
        }
    }
    if file_modified {
        let mut out = String::with_capacity(text.len());
        for line in &out_lines {
            out.push_str(line);
            out.push('\n');
        }
        let _ = file_io::atomic_write(path, out.as_bytes(), 0o600);
    }
}

/// 旧正文转换，仅供兼容诊断；产品入口不调用，也不以此改变遥测或服务行为：
/// 1) 旧实现会改写 `credential_org.organizationUuid` 至 `active_org`；
/// 2) 旧实现会改写 `session_context.userEmail` 至 `active_email`；
/// 3) 剥离异账号会话中绑定原组织密钥的 `thinking` / `redacted_thinking` 签名块、诊断回放块 (`api-request*`) 与远程桥接记录 (`bridge-session`)；
/// 4) 修复因额度耗尽 (429) 或中断遗留的未配对 `tool_use` / 孤儿 `tool_result`（保持 `uuid`/`parentUuid` 链不断裂）。
fn sanitize_project_sessions(
    root: &Path,
    active_acct: Option<&str>,
    active_org: Option<&str>,
    active_email: Option<&str>,
) -> std::collections::BTreeSet<String> {
    let mut foreign_session_ids = std::collections::BTreeSet::new();
    if active_acct.is_none() && active_org.is_none() && active_email.is_none() {
        return foreign_session_ids;
    }
    let is_running = root_has_running_claude(root);
    let projects_dir = root.join(".claude/projects");
    let Ok(proj_entries) = fs::read_dir(&projects_dir) else {
        return foreign_session_ids;
    };
    for proj_entry in proj_entries.flatten() {
        let proj_path = proj_entry.path();
        let Ok(p_meta) = fs::symlink_metadata(&proj_path) else {
            continue;
        };
        if linked(&p_meta) || !p_meta.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&proj_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if linked(&meta) {
                continue;
            }
            if meta.is_file() {
                let Some(stem) = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|n| n.strip_suffix(".jsonl"))
                else {
                    continue;
                };
                let mut family_files = vec![path.clone()];
                let subagents_dir = proj_path.join(stem).join("subagents");
                if let Ok(s_meta) = fs::symlink_metadata(&subagents_dir) {
                    if !linked(&s_meta) && s_meta.is_dir() {
                        if let Ok(sub_entries) = fs::read_dir(&subagents_dir) {
                            for sub_entry in sub_entries.flatten() {
                                let sub_path = sub_entry.path();
                                if sub_path.extension().is_some_and(|e| e == "jsonl") {
                                    family_files.push(sub_path);
                                }
                            }
                        }
                    }
                }
                let is_foreign = family_needs_foreign_sanitization(
                    &family_files,
                    active_acct,
                    active_org,
                    active_email,
                );
                if is_foreign {
                    foreign_session_ids.insert(stem.to_string());
                    for f in &family_files {
                        sanitize_jsonl_session_file(f, active_org, active_email, true, true);
                    }
                } else if !is_running {
                    for f in &family_files {
                        sanitize_jsonl_session_file(f, None, None, false, true);
                    }
                }
            } else if meta.is_dir() {
                let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if proj_path.join(format!("{dir_name}.jsonl")).exists() {
                    continue;
                }
                let subagents_dir = path.join("subagents");
                if let Ok(s_meta) = fs::symlink_metadata(&subagents_dir) {
                    if !linked(&s_meta) && s_meta.is_dir() {
                        if let Ok(sub_entries) = fs::read_dir(&subagents_dir) {
                            for sub_entry in sub_entries.flatten() {
                                let sub_path = sub_entry.path();
                                if sub_path.extension().is_some_and(|e| e == "jsonl")
                                    && file_has_foreign_session_markers(
                                        &sub_path,
                                        active_acct,
                                        active_org,
                                        active_email,
                                    )
                                {
                                    sanitize_jsonl_session_file(
                                        &sub_path,
                                        active_org,
                                        active_email,
                                        true,
                                        true,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    foreign_session_ids
}

/// 在明确的身份切换或恢复完成后，只维护账号绑定的缓存白名单。
/// 不扫描或改写会话、项目遥测、凭据及其他用户工作区内容。
pub(crate) fn maintain_account_caches(root: &Path) -> Result<(), String> {
    let claude_json = root.join(".claude.json");
    let meta = match fs::symlink_metadata(&claude_json) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Ok(()),
    };
    if linked(&meta)
        || !meta.is_file()
        || meta.len() > 8 * 1024 * 1024
        || canonicalize(&claude_json).ok().as_deref() != Some(claude_json.as_path())
    {
        return Ok(());
    }
    crate::identities::private::parents(root)?;
    crate::identities::private::safe(&claude_json)?;
    let bytes = fs::read(&claude_json).map_err(|_| "身份配置无法读取。")?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "身份配置不是有效 JSON。")?;
    let Some(acct) = value["oauthAccount"]["accountUuid"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
        .map(str::to_string)
    else {
        return Ok(());
    };
    let org = value["oauthAccount"]["organizationUuid"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
        .map(str::to_string);

    let mut modified = false;
    if let Some(obj) = value.as_object_mut() {
        if let Some(active_org) = org.as_deref() {
            for key in ["s1mAccessCache", "passesEligibilityCache"] {
                if let Some(entries) = obj.get_mut(key).and_then(|v| v.as_object_mut()) {
                    let before = entries.len();
                    entries.retain(|k, _| k == active_org);
                    modified |= entries.len() != before;
                }
            }
        }
        for key in [
            "cachedUsageUtilization",
            "cachedArtifactRoster",
            "githubWebConnectionStatusCache",
        ] {
            if obj
                .get(key)
                .and_then(|v| v.get("accountUuid"))
                .and_then(|v| v.as_str())
                .is_some_and(|u| !u.is_empty() && u != acct)
            {
                obj.remove(key);
                modified = true;
            }
        }
    }
    if modified {
        let text = serde_json::to_string_pretty(&value).map_err(|_| "身份配置无法更新缓存。")?;
        file_io::atomic_write(&claude_json, format!("{text}\n").as_bytes(), 0o600)
            .map_err(|_| "身份配置无法更新缓存。")?;
    }

    for relative in [".claude/plugins/synced", ".claude/cache/model-catalog"] {
        if let Ok(entries) = fs::read_dir(root.join(relative)) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_plugins = relative.ends_with("synced");
                let candidate = if is_plugins {
                    name.contains('-')
                } else {
                    name.ends_with("-cc.json")
                };
                let matches_active = if is_plugins {
                    name.contains(&acct) || org.as_deref().is_some_and(|o| name.contains(o))
                } else {
                    name.starts_with(&acct) || org.as_deref().is_some_and(|o| name.starts_with(o))
                };
                if candidate && !matches_active {
                    remove_safe_entry(&entry.path());
                }
            }
        }
    }
    Ok(())
}

/// 清理与当前活跃 `.claude.json` 账号 UUID 不一致的旧跨账号残留。
/// 仅保留给显式测试/兼容诊断使用；产品入口调用上方窄缓存维护函数。
#[allow(dead_code)]
pub(crate) fn sanitize_cross_account_residue(root: &Path) -> Result<(), String> {
    clear_stale_locks(root);
    let claude_json = root.join(".claude.json");
    let meta = match fs::symlink_metadata(&claude_json) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Ok(()),
    };
    if linked(&meta)
        || !meta.is_file()
        || meta.len() > 8 * 1024 * 1024
        || canonicalize(&claude_json).ok().as_deref() != Some(claude_json.as_path())
    {
        return Ok(());
    }
    crate::identities::private::parents(root)?;
    crate::identities::private::safe(&claude_json)?;
    let bytes = fs::read(&claude_json).map_err(|_| "身份配置无法读取。")?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "身份配置不是有效 JSON。")?;
    let Some(acct) = value["oauthAccount"]["accountUuid"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
        .map(str::to_string)
    else {
        return Ok(());
    };
    let org = value["oauthAccount"]["organizationUuid"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
        .map(str::to_string);
    let email = value["oauthAccount"]["emailAddress"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
        .map(str::to_string);
    let foreign_session_ids =
        sanitize_project_sessions(root, Some(&acct), org.as_deref(), email.as_deref());
    let acct_prefix = &acct[..acct.len().min(8)];
    let org_prefix = org.as_deref().map(|o| &o[..o.len().min(8)]);

    let mut claude_modified = false;
    if let Some(obj) = value.as_object_mut() {
        if let Some(ref active_org) = org {
            for org_cache_key in ["s1mAccessCache", "passesEligibilityCache"] {
                if let Some(org_map) = obj.get_mut(org_cache_key).and_then(|v| v.as_object_mut()) {
                    let before = org_map.len();
                    org_map.retain(|k, _| k == active_org);
                    if org_map.len() != before {
                        claude_modified = true;
                    }
                }
            }
        }
        for cache_key in [
            "cachedUsageUtilization",
            "cachedArtifactRoster",
            "githubWebConnectionStatusCache",
        ] {
            if obj
                .get(cache_key)
                .and_then(|v| v.get("accountUuid"))
                .and_then(|v| v.as_str())
                .is_some_and(|u| !u.is_empty() && u != acct)
            {
                obj.remove(cache_key);
                claude_modified = true;
            }
        }
        let mut live_session_ids = std::collections::BTreeSet::new();
        if let Ok(proj_dirs) = fs::read_dir(root.join(".claude/projects")) {
            for proj_entry in proj_dirs.flatten() {
                if let Ok(files) = fs::read_dir(proj_entry.path()) {
                    for file in files.flatten() {
                        if let Some(stem) = file
                            .file_name()
                            .to_str()
                            .and_then(|n| n.strip_suffix(".jsonl"))
                        {
                            live_session_ids.insert(stem.to_string());
                        }
                    }
                }
            }
        }
        if let Some(projects) = obj.get_mut("projects").and_then(|v| v.as_object_mut()) {
            let before_len = projects.len();
            projects.retain(|k, _| !k.contains('\u{FFFD}'));
            if projects.len() != before_len {
                claude_modified = true;
            }
            for (_, proj_val) in projects.iter_mut() {
                let Some(proj_obj) = proj_val.as_object_mut() else {
                    continue;
                };
                let last_sid = proj_obj
                    .get("lastSessionId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                let stale_session = last_sid
                    .as_deref()
                    .is_some_and(|sid| !live_session_ids.contains(sid));
                let foreign_session = last_sid
                    .as_deref()
                    .is_some_and(|sid| foreign_session_ids.contains(sid));
                if stale_session {
                    if proj_obj.remove("lastSessionId").is_some() {
                        claude_modified = true;
                    }
                }
                if stale_session || foreign_session {
                    for session_key in [
                        "lastCost",
                        "lastDuration",
                        "lastAPIDuration",
                        "lastAPIDurationWithoutRetries",
                        "lastFpsAverage",
                        "lastFpsLow1Pct",
                        "lastGracefulShutdown",
                        "lastLinesAdded",
                        "lastLinesRemoved",
                        "lastModelUsage",
                        "lastSessionMetrics",
                        "lastStartTime",
                        "lastToolDuration",
                        "lastTotalCacheCreationInputTokens",
                        "lastTotalCacheReadInputTokens",
                        "lastTotalInputTokens",
                        "lastTotalOutputTokens",
                        "lastTotalWebSearchRequests",
                    ] {
                        if proj_obj.remove(session_key).is_some() {
                            claude_modified = true;
                        }
                    }
                }
            }
        }
    }
    if claude_modified {
        if let Ok(text) = serde_json::to_string_pretty(&value) {
            let formatted = format!("{text}\n");
            let _ = file_io::atomic_write(&claude_json, formatted.as_bytes(), 0o600);
        }
    }

    if let Ok(entries) = fs::read_dir(root.join(".claude/plugins/synced")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.contains('-') {
                let matches_active =
                    name.contains(&acct) || org.as_deref().is_some_and(|o| name.contains(o));
                if !matches_active {
                    remove_safe_entry(&entry.path());
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir(root.join(".claude/cache/model-catalog")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with("-cc.json") {
                let matches_active =
                    name.starts_with(&acct) || org.as_deref().is_some_and(|o| name.starts_with(o));
                if !matches_active {
                    remove_safe_entry(&entry.path());
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir(root.join(".claude/backups")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(".claude.json.backup") {
                let path = entry.path();
                if let Ok(m) = fs::symlink_metadata(&path) {
                    if !linked(&m) && m.is_file() && m.len() <= 8 * 1024 * 1024 {
                        let backup_acct = fs::read(&path)
                            .ok()
                            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                            .and_then(|v| {
                                v["oauthAccount"]["accountUuid"]
                                    .as_str()
                                    .map(str::to_string)
                            });
                        if backup_acct
                            .as_deref()
                            .is_some_and(|u| !u.is_empty() && u != acct)
                        {
                            remove_safe_entry(&path);
                        }
                    }
                }
            }
        }
    }

    for desktop in targets::desktop_roots(root) {
        let Ok(d_meta) = fs::symlink_metadata(&desktop) else {
            continue;
        };
        if linked(&d_meta)
            || !d_meta.is_dir()
            || canonicalize(&desktop).ok().as_deref() != Some(desktop.as_path())
            || crate::identities::private::safe(&desktop).is_err()
        {
            continue;
        }
        let mut foreign_desktop_root = false;
        let mut has_matching_desktop_account = false;
        let cfg_path = desktop.join("config.json");
        if let Ok(c_meta) = fs::symlink_metadata(&cfg_path) {
            if !linked(&c_meta)
                && c_meta.is_file()
                && c_meta.len() <= 4 * 1024 * 1024
                && canonicalize(&cfg_path).ok().as_deref() == Some(cfg_path.as_path())
                && crate::identities::private::safe(&cfg_path).is_ok()
            {
                if let Ok(mut cfg) = fs::read(&cfg_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .ok_or(())
                {
                    if let Some(obj) = cfg.as_object_mut() {
                        let mut cfg_modified = false;
                        match obj
                            .get("lastKnownAccountUuid")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                        {
                            Some(last) if last == acct => {
                                has_matching_desktop_account = true;
                            }
                            Some(_) => {
                                foreign_desktop_root = true;
                                for k in [
                                    "lastKnownAccountUuid",
                                    "oauth:tokenCache",
                                    "oauth:tokenCacheV2",
                                    "first_launch_at",
                                    "version_first_launch",
                                    "hasTrackedInitialActivation",
                                    "windowSizeWasSignedIn",
                                    "planUsageLastTrayOpenAt",
                                ] {
                                    if obj.remove(k).is_some() {
                                        cfg_modified = true;
                                    }
                                }
                            }
                            None => {}
                        }
                        let remove_keys: Vec<String> = obj
                            .keys()
                            .filter(|k| {
                                (k.starts_with("dxt:allowlist")
                                    && !k.ends_with(&format!(":{acct}"))
                                    && !org
                                        .as_deref()
                                        .is_some_and(|o| k.ends_with(&format!(":{o}"))))
                                    || (foreign_desktop_root
                                        && k.starts_with("remote_uploads_migration_done_v1_"))
                            })
                            .cloned()
                            .collect();
                        if !remove_keys.is_empty() {
                            for k in remove_keys {
                                obj.remove(&k);
                            }
                            cfg_modified = true;
                        }
                        if cfg_modified {
                            if foreign_desktop_root {
                                remove_safe_entry(&cfg_path);
                            } else if let Ok(text) = serde_json::to_string_pretty(&cfg) {
                                let formatted = format!("{text}\n");
                                let _ =
                                    file_io::atomic_write(&cfg_path, formatted.as_bytes(), 0o600);
                            }
                        }
                    }
                }
            }
        }
        let cowork_path = desktop.join("cowork-enabled-cli-ops.json");
        if let Ok(m) = fs::symlink_metadata(&cowork_path) {
            if !linked(&m) && m.is_file() && m.len() <= 1024 * 1024 {
                if let Some(owner) = fs::read(&cowork_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .and_then(|v| {
                        v.get("ownerAccountId")
                            .and_then(|u| u.as_str())
                            .map(str::to_string)
                    })
                {
                    if !owner.is_empty() && owner != acct {
                        remove_safe_entry(&cowork_path);
                        if !has_matching_desktop_account {
                            foreign_desktop_root = true;
                        }
                    }
                }
            }
        }
        for sub in ["local-agent-mode-sessions", "claude-code-sessions"] {
            let dir = desktop.join(sub);
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name == "skills-plugin" {
                    if let Ok(org_entries) = fs::read_dir(entry.path()) {
                        for org_entry in org_entries.flatten() {
                            let org_name = org_entry.file_name().to_string_lossy().into_owned();
                            let has_foreign_acct =
                                fs::read_dir(org_entry.path()).ok().is_some_and(|mut it| {
                                    it.any(|e| {
                                        e.ok().is_some_and(|c| {
                                            let cn = c.file_name().to_string_lossy().into_owned();
                                            cn.contains('-')
                                                && cn != acct
                                                && org.as_deref() != Some(cn.as_str())
                                        })
                                    })
                                });
                            let is_foreign_org = org.as_deref().is_some_and(|o| {
                                org_name != o && org_name != "00000000-0000-4000-8000-000000000001"
                            });
                            if has_foreign_acct || is_foreign_org {
                                remove_safe_entry(&org_entry.path());
                            }
                        }
                    }
                    if fs::read_dir(entry.path())
                        .ok()
                        .is_some_and(|mut it| it.next().is_none())
                    {
                        remove_safe_entry(&entry.path());
                    }
                } else if name != acct
                    && name != acct_prefix
                    && org.as_deref() != Some(name.as_str())
                    && org_prefix != Some(name.as_str())
                {
                    remove_safe_entry(&entry.path());
                }
            }
            if fs::read_dir(&dir)
                .ok()
                .is_some_and(|mut it| it.next().is_none())
            {
                remove_safe_entry(&dir);
            }
        }
        let spaces = desktop.join("spaces-present");
        if let Ok(entries) = fs::read_dir(&spaces) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name != acct
                    && name != acct_prefix
                    && org.as_deref() != Some(name.as_str())
                    && org_prefix != Some(name.as_str())
                {
                    remove_safe_entry(&entry.path());
                }
            }
            if fs::read_dir(&spaces)
                .ok()
                .is_some_and(|mut it| it.next().is_none())
            {
                remove_safe_entry(&spaces);
            }
        }
        if foreign_desktop_root {
            remove_safe_entry(&cfg_path);
            for target in targets::desktop_storage(root, &desktop) {
                remove_safe_entry(&target.path);
            }
            for dev in [
                "Cache",
                "Code Cache",
                "GPUCache",
                "DawnGraphiteCache",
                "DawnWebGPUCache",
                "fcache",
                "model-catalog",
                "Crashpad",
                "logs",
                "Network",
                "declarative_performance_observer.db",
                "declarative_performance_observer.db-journal",
            ] {
                remove_safe_entry(&desktop.join(dev));
            }
        } else if !has_matching_desktop_account
            && !desktop.join("Local Storage").exists()
            && !desktop.join("Cookies").exists()
            && !desktop.join("Network/Cookies").exists()
        {
            for stale in [
                "DIPS",
                "DIPS-journal",
                "DIPS-wal",
                "DIPS-shm",
                "Shared Dictionary",
                "SharedStorage",
                "SharedStorage-wal",
                "blob_storage",
                "DawnGraphiteCache",
                "DawnWebGPUCache",
            ] {
                remove_safe_entry(&desktop.join(stale));
            }
        }
    }
    Ok(())
}
