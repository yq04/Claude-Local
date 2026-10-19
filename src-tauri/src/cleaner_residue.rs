// [INPUT]: 默认 Claude 文件白名单、完整元数据快照、独立扫描计划、身份恢复状态和 Cleaner 共用事务锁。
// [OUTPUT]: 手动文件残留扫描与按快照 ID 选择清理及逐目标完成进度；界面仅接收路径、计数、影响和固定键名。
// [POS]: 身份页的文件维护边界；不访问钥匙串、不停止进程、不处理 Shell/共享代理、保险库或浏览器资料。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;

fn named_artifact(path: &Path, root: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let parent = path.parent();
    if parent == Some(root.join("Library/Caches").as_path()) {
        return name == "claude-cli-nodejs"
            || name == "com.anthropic.claudefordesktop"
            || name.starts_with("com.anthropic.claudefordesktop.");
    }
    if [
        "Library/Logs/DiagnosticReports",
        "Library/Application Support/CrashReporter",
    ]
    .iter()
    .any(|relative| parent == Some(root.join(relative).as_path()))
    {
        return name == "Claude"
            || name.starts_with("Claude-")
            || name.starts_with("Claude_")
            || name.starts_with("Claude.")
            || name.starts_with("Claude Helper ")
            || name.starts_with("Claude Helper-")
            || name.starts_with("Claude Helper_");
    }
    true
}

fn definitions(root: &Path) -> (Vec<targets::Target>, Vec<String>) {
    let (targets, warnings) = targets::definitions_with_warnings(root);
    let allowed = targets
        .into_iter()
        .filter(|target| {
            let personal_preferences = target.path.starts_with(root.join("Library/Preferences"))
                || target
                    .path
                    .starts_with(root.join("Library/Saved Application State"));
            !personal_preferences
                && named_artifact(&target.path, root)
                && (matches!(target.group, "cache" | "history" | "account" | "desktop")
                    || (target.group == "backups"
                        && (target.path.starts_with(root.join(".claude"))
                            || target.path.file_name().is_some_and(|name| {
                                name.to_string_lossy().starts_with(".claude.json.backup")
                            }))))
        })
        .map(|mut target| {
            if target.path == root.join(".claude/.credentials.json") {
                target.operation = Operation::Edit(config::EditKind::Credentials);
                target.impact =
                    "仅移除 Code 文件登录凭据；保留 MCP 和插件秘密，不改动钥匙串。".into();
            }
            target
        })
        .collect();
    (allowed, warnings)
}

fn collect_progress(root: &Path, reporter: &Reporter) -> (Scan, usize) {
    let mut scan = Scan {
        folder: root.to_string_lossy().into_owned(),
        ..Scan::default()
    };
    let batch = generation();
    let (targets, warnings) = definitions(root);
    scan.warnings = warnings;
    let total = targets.len();
    reporter.log(
        "scan",
        "running",
        "正在检查默认 Claude 文件残留。",
        0,
        Some(total),
    );
    for (index, target) in targets.into_iter().enumerate() {
        add_target(&mut scan, target, batch);
        reporter.log(
            "scan",
            "running",
            "已检查文件残留目标。",
            index + 1,
            Some(total),
        );
    }
    scan.message = format!("已发现 {} 个文件残留项目。", scan.items.len());
    (scan, total)
}

fn ensure_no_recovery(vault: &Path) -> Result<(), String> {
    if crate::identities::database::Database::open(vault)?
        .get("recovery")?
        .is_some()
    {
        return Err("请先恢复未完成的身份切换。".into());
    }
    Ok(())
}

fn clean(
    root: &Path,
    vault: &Path,
    plan: &Scan,
    ids: &[String],
    state: &Cleaner,
    check_running: impl Fn() -> Result<bool, String>,
    reporter: &Reporter,
) -> Result<CleanResult, String> {
    if Path::new(&plan.folder) != root {
        return Err("用户目录已变化，请重新扫描。".into());
    }
    ensure_no_recovery(vault)?;
    if check_running()? {
        return Err("请先结束 Claude 进程，再重新扫描并清理文件残留。".into());
    }
    let items = selected(plan, ids)?;
    let (allowed, _) = definitions(root);
    for item in &items {
        if !allowed.iter().any(|target| {
            Path::new(&item.path) == target.path && item.operation == target.operation
        }) {
            return Err("文件残留快照超出默认 Claude 范围，请重新扫描。".into());
        }
    }
    transaction::perform_items(root, &items, state, check_running, reporter)
}

#[tauri::command]
pub async fn claude_residue_scan(
    app: tauri::AppHandle,
    on_progress: Channel<Progress>,
) -> Result<Scan, String> {
    let state = app.state::<Cleaner>();
    state.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let state = worker.state::<Cleaner>();
        *state.residue_plan.lock().unwrap() = None;
        reporter.log("scan", "running", "正在检查默认 Claude 文件残留。", 0, None);
        let result: Result<Scan, String> = (|| {
            let (mut scan, checked) = collect_progress(&home()?, &reporter);
            scan.processes = processes()?;
            scan.running = !scan.processes.is_empty();
            if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
                scan.warnings
                    .push("仅检查默认 Claude 目录；自定义配置目录不在本次范围内。".into());
            }
            for warning in &scan.warnings {
                reporter.log("scan", "warning", warning, 0, None);
            }
            reporter.log("scan", "ok", &scan.message, checked, Some(checked));
            *state.residue_plan.lock().unwrap() = Some(scan.clone());
            Ok(scan)
        })();
        if let Err(error) = &result {
            reporter.fail(error);
        }
        result
    })
    .await
    .map_err(|_| "文件残留扫描被中断，请重试。".to_string())
    .and_then(|result| result);
    state.leave();
    result
}

#[tauri::command]
pub async fn claude_residue_clean(
    app: tauri::AppHandle,
    ids: Vec<String>,
    on_progress: Channel<Progress>,
) -> Result<CleanResult, String> {
    let state = app.state::<Cleaner>();
    state.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let state = worker.state::<Cleaner>();
        let result = (|| {
            // 一次性快照：成功、拒绝或部分失败后均需重新扫描，不能重复提交旧 ID。
            let plan = state
                .residue_plan
                .lock()
                .unwrap()
                .take()
                .ok_or("请先扫描当前 Claude 文件残留。")?;
            let vault = worker
                .path()
                .app_data_dir()
                .map_err(|_| "身份保险库无法定位。")?
                .join("identity-vault");
            clean(&home()?, &vault, &plan, &ids, &state, running, &reporter)
        })();
        if let Err(error) = &result {
            reporter.fail(error);
        }
        result
    })
    .await
    .map_err(|_| "文件清理中断，请重新扫描检查剩余项目。".to_string())
    .and_then(|result| result);
    state.leave();
    result
}

#[cfg(test)]
#[path = "cleaner_residue_tests.rs"]
mod tests;
