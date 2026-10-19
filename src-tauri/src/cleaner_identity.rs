// [INPUT]: Cleaner 白名单、共享 Code 登录键常量、完整目录快照、用户保留策略与 JSON 配置。
// [OUTPUT]: 受限身份目标与配置身份键（含独立代理环境变量与 githubRepoPaths）的提取/清空/恢复、跨账号残留隔离自愈，保留工作区未选择的个人资产及桌面身份路径元数据检测。
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
                SETTINGS_IDENTITY_KEYS
                    .iter()
                    .map(|k| (*k).into())
                    .collect()
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
    for mut source in definitions(root, policy) {
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
        if source.path == root.join(".claude.json") && !policy.settings {
            let value: serde_json::Value =
                serde_json::from_slice(&fs::read(&source.path).map_err(|_| "身份配置无法读取。")?)
                    .map_err(|_| "身份配置不是有效 JSON。")?;
            let object = value.as_object().ok_or("身份配置不是对象。")?;
            source.keys = object
                .keys()
                .filter(|k| {
                    !(policy.mcp && *k == "mcpServers")
                        && !(policy.projects && (*k == "projects" || *k == "githubRepoPaths"))
                })
                .cloned()
                .collect();
            if source.keys.is_empty() {
                continue;
            }
        }
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
    known || special
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

/// 清理 Claude Code 在异常退出、进程强杀或切换账号后遗留的 OAuth / 配置互斥锁文件及已退出进程的孤儿会话描述文件，防止下次启动阻塞或报锁冲突。
pub(crate) fn clear_stale_locks(root: &Path) {
    for rel in [
        ".claude/.oauth_refresh.lock",
        ".claude/.oauth_refresh.lock.owner",
        ".claude/daemon.lock",
        ".claude.lock",
        ".claude.json.lock",
    ] {
        remove_safe_entry(&root.join(rel));
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

/// 清理与当前活跃 `.claude.json` 账号 UUID 不一致的历史跨账号残留（如异账号 dxt:allowlist、异账号会话目录、plugins/synced、model-catalog 及未同步的 Claude-3p 旧登录）。
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
    let acct_prefix = &acct[..acct.len().min(8)];
    let org_prefix = org.as_deref().map(|o| &o[..o.len().min(8)]);

    let mut claude_modified = false;
    if let Some(obj) = value.as_object_mut() {
        if let Some(ref active_org) = org {
            for org_cache_key in ["s1mAccessCache", "passesEligibilityCache"] {
                if let Some(org_map) = obj
                    .get_mut(org_cache_key)
                    .and_then(|v| v.as_object_mut())
                {
                    let before = org_map.len();
                    org_map.retain(|k, _| k == active_org);
                    if org_map.len() != before {
                        claude_modified = true;
                    }
                }
            }
        }
        for acct_cache_key in ["metricsStatusCacheByPrincipal", "groveConfigCache"] {
            if let Some(principals) = obj
                .get_mut(acct_cache_key)
                .and_then(|v| v.as_object_mut())
            {
                let before = principals.len();
                principals.retain(|k, _| {
                    k.contains(&acct) || org.as_deref().is_some_and(|o| k.contains(o))
                });
                if principals.len() != before {
                    claude_modified = true;
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
                let stale_session = proj_obj
                    .get("lastSessionId")
                    .and_then(|v| v.as_str())
                    .is_some_and(|sid| !sid.is_empty() && !live_session_ids.contains(sid));
                if stale_session {
                    for session_key in [
                        "lastSessionId",
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
                let matches_active = name.contains(&acct)
                    || org.as_deref().is_some_and(|o| name.contains(o));
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
                let matches_active = name.starts_with(&acct)
                    || org.as_deref().is_some_and(|o| name.starts_with(o));
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
                        if backup_acct.as_deref().is_some_and(|u| !u.is_empty() && u != acct) {
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
        let dev_reg_path = desktop.join("ant-device-registry.json");
        if let Ok(m) = fs::symlink_metadata(&dev_reg_path) {
            if !linked(&m)
                && m.is_file()
                && m.len() <= 1024 * 1024
                && canonicalize(&dev_reg_path).ok().as_deref() == Some(dev_reg_path.as_path())
                && crate::identities::private::safe(&dev_reg_path).is_ok()
            {
                if let Some(mut reg) = fs::read(&dev_reg_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                {
                    if let Some(obj) = reg.as_object_mut() {
                        let before = obj.len();
                        obj.retain(|k, _| k == &acct || org.as_deref() == Some(k.as_str()));
                        if obj.len() != before {
                            if obj.is_empty() {
                                remove_safe_entry(&dev_reg_path);
                                remove_safe_entry(&desktop.join("ant-did"));
                                if !has_matching_desktop_account {
                                    foreign_desktop_root = true;
                                }
                            } else if let Ok(text) = serde_json::to_string(&reg) {
                                let _ =
                                    file_io::atomic_write(&dev_reg_path, text.as_bytes(), 0o600);
                            }
                        }
                    }
                }
            }
        }
        let sentry_scope = desktop.join("sentry/scope_v3.json");
        if let Ok(m) = fs::symlink_metadata(&sentry_scope) {
            if !linked(&m) && m.is_file() && m.len() <= 1024 * 1024 {
                let user_id = fs::read(&sentry_scope)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .and_then(|v| {
                        v.pointer("/scope/user/id")
                            .and_then(|u| u.as_str())
                            .map(str::to_string)
                    });
                if user_id.as_deref() != Some(acct.as_str()) {
                    remove_safe_entry(&desktop.join("sentry"));
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
                "ant-did",
                "ant-device-registry.json",
                ".machine-id",
                "machine-id",
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
                "sentry",
                "DawnGraphiteCache",
                "DawnWebGPUCache",
            ] {
                remove_safe_entry(&desktop.join(stale));
            }
        }
    }
    Ok(())
}
