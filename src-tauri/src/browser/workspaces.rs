// [INPUT]: 身份 SQLite 绑定、独立浏览器根目录、受限配置和用户确认后的切换事务。
// [OUTPUT]: CLI/养号独占资料与稳定种子、只读槽位查询、普通CLI事务保留养号会话、显式返回/转正/恢复启动阻断。
// [POS]: 身份与浏览器的协调边界；资料不压缩、不复制、不合并 Cookie，失败状态如实返回。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use crate::identities::{browser_link, database::Database, private};

pub(super) fn database(root: &Path) -> Result<Database, String> {
    Database::open(
        &root
            .parent()
            .ok_or("应用目录不可用。")?
            .join("identity-vault"),
    )
}
pub(super) fn slot_path(root: &Path, slot: &str) -> Result<PathBuf, String> {
    if !browser_link::valid_slot(slot) {
        return Err("浏览器资料选择无效。".into());
    }
    let path = if slot == "legacy" {
        root.to_path_buf()
    } else {
        root.join("contexts").join(slot)
    };
    profile::check_path(root, &path)?;
    Ok(path)
}
pub(super) fn scope(root: &Path) -> Result<PathBuf, String> {
    slot_path(root, &database(root)?.browser_slot()?)
}
/// Runtime sampling must not call Database::open: it initializes schemas and
/// ACLs. Read the two selection fields from one read-only SQLite snapshot.
pub(super) fn selected_slot_readonly(root: &Path) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    let vault = root
        .parent()
        .ok_or("应用目录不可用。")?
        .join("identity-vault");
    let path = vault.join("identities.sqlite");
    private::parents(&vault)?;
    private::safe(&path)?;
    let mut connection = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法读取浏览器选择。")?;
    connection
        .busy_timeout(std::time::Duration::from_millis(100))
        .map_err(|_| "无法读取浏览器选择。")?;
    let tx = connection
        .transaction()
        .map_err(|_| "无法读取浏览器选择。")?;
    let read = |key: &str| {
        tx.query_row("SELECT value FROM state WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "无法读取浏览器选择。".to_string())
    };
    let slot = if read("browser.enabled")?.as_deref() == Some("1") {
        read("browser.active")?.ok_or("浏览器资料选择无效。")?
    } else {
        "legacy".to_string()
    };
    if !browser_link::valid_slot(&slot) {
        return Err("浏览器资料选择无效。".into());
    }
    Ok(slot)
}
/// Existing-profile return/rollback changes only the selection, never enabled,
/// draft, promotion, CLI active, bindings or seeds. Compare the old pointer in
/// the same transaction so a later native selection is not overwritten.
pub(super) fn select_existing_slot(root: &Path, expected: &str, next: &str) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    if !browser_link::valid_slot(expected) || !browser_link::valid_slot(next) {
        return Err("浏览器资料选择无效。".into());
    }
    let vault = root
        .parent()
        .ok_or("应用目录不可用。")?
        .join("identity-vault");
    let path = vault.join("identities.sqlite");
    private::parents(&vault)?;
    private::safe(&path)?;
    let mut connection = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法更新浏览器选择。")?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "无法更新浏览器选择。")?;
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| "无法更新浏览器选择。")?;
    let read = |key: &str| {
        tx.query_row("SELECT value FROM state WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "无法更新浏览器选择。".to_string())
    };
    if read("recovery")?.is_some()
        || read("browser.promotion")?.is_some()
        || read("browser.enabled")?.as_deref() != Some("1")
        || read("browser.active")?.as_deref() != Some(expected)
    {
        return Err("浏览器资料选择已变化，请刷新后重试。".into());
    }
    tx.execute(
        "UPDATE state SET value=?1 WHERE key='browser.active'",
        [next],
    )
    .map_err(|_| "无法更新浏览器选择。")?;
    tx.commit().map_err(|_| "无法更新浏览器选择。".into())
}
pub(super) fn ready(root: &Path) -> Result<(), String> {
    if database(root)?.get("recovery")?.is_some() {
        return Err("浏览器保持关闭，请先恢复身份切换。".into());
    }
    Ok(())
}
pub(super) fn ensure(root: &Path) -> Result<PathBuf, String> {
    let db = database(root)?;
    if db.get("recovery")?.is_some() {
        return Err("浏览器保持关闭，请先恢复身份切换。".into());
    }
    let slot = db.browser_slot()?;
    let path = slot_path(root, &slot)?;
    private::directory(&path)?;
    let seed = match db.browser_seed(&slot)? {
        Some(seed) => seed,
        None => browser_link::seed(&db.browser_draft()?.unwrap_or_else(|| slot.clone()), 0).max(1),
    };
    let stamp = path.join("seed.owner");
    profile::check_path(root, &stamp)?;
    let bound = db.browser_link()?.enabled;
    let first = !path.join("config.json").exists();
    if first || (bound && fs::read_to_string(&stamp).ok().as_deref() != Some(&seed.to_string())) {
        let mut config = if first && slot != "legacy" {
            config::load(root)?
        } else {
            config::load(&path)?
        };
        if bound {
            config.seed = seed;
        }
        config::save(&path, &config)?;
        if bound {
            private::write(&stamp, seed.to_string().as_bytes())?;
        }
    }
    private::directory(&path.join("profile"))?;
    Ok(path)
}
pub(super) fn block(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    private::directory(root)?;
    private::write(&root.join("identity-switch.pending"), b"1")?;
    *app.state::<Browser>().session.lock().unwrap() = None;
    *app.state::<Browser>().host.lock().unwrap() = None;
    forget_start_url(app);
    Ok(())
}
pub(super) fn unblock(root: &Path) -> Result<(), String> {
    let path = root.join("identity-switch.pending");
    profile::check_path(root, &path)?;
    match fs::remove_file(&path) {
        Ok(()) => {
            private::sync_parent(&path);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法更新浏览器启动状态。".into()),
    }
}
pub(crate) fn identity_action(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, false, false, action)
}
pub(crate) fn switch_identity(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, false, true, action)
}
/// Promotion deliberately transfers the warming browser into the CLI workflow.
/// Force coordination before prepare_warming_promotion installs its marker.
pub(crate) fn promote_warming_identity(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, true, true, action)
}
/// Caller holds Cleaner short gate; lock order is always Cleaner -> Browser.
pub(crate) fn switch_warming_browser(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    slot: &str,
    open_mode: &str,
) -> Result<(), String> {
    validate_warming_open_mode(open_mode)?;
    if !browser_link::valid_slot(slot) {
        return Err("浏览器资料选择无效。".into());
    }
    let browser = app.state::<Browser>();
    let _guard = browser.gate.lock().unwrap();
    switch_browser_locked(app, reporter, slot, open_mode, false)
}
/// Detach a selected warming card before deletion, retaining its data until the
/// separately confirmed delete_saved action. Caller owns Cleaner short gate.
pub(crate) fn detach_warming_browser(
    app: &tauri::AppHandle,
    reporter: &Reporter,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let _guard = browser.gate.lock().unwrap();
    let root = root(app)?;
    ready(&root)?;
    let db = database(&root)?;
    let slot = fresh_browser_slot(&root, &db)?;
    switch_browser_locked(app, reporter, &slot, "switch_only", true)
}
pub(super) fn fresh_browser_slot(root: &Path, db: &Database) -> Result<String, String> {
    if db.get("recovery")?.is_some() {
        return Err("请先恢复未完成的身份切换。".into());
    }
    for _ in 0..128 {
        let slot = crate::identities::new_id()?;
        if slot == db.browser_slot()? || db.browser_seed(&slot)?.is_some() {
            continue;
        }
        match fs::symlink_metadata(slot_path(root, &slot)?) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(slot),
            Ok(_) => continue,
            Err(_) => return Err("无法检查新浏览器资料目录。".into()),
        }
    }
    Err("无法分配新的空浏览器资料。".into())
}
/// Browser gate is already held; both paths perform identical process/session
/// transitions. Fresh detach slots must be unbound and absent before old quit.
fn switch_browser_locked(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    slot: &str,
    open_mode: &str,
    fresh: bool,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let root = root(app)?;
    ready(&root)?;
    let mut db = database(&root)?;
    // Refuse an unbound scope before stopping the existing browser.
    if fresh {
        if !crate::identities::valid_id(slot) || db.browser_seed(slot)?.is_some() {
            return Err("新浏览器资料选择无效。".into());
        }
        match fs::symlink_metadata(slot_path(&root, slot)?) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => return Err("新浏览器资料目录已存在或无法检查。".into()),
        }
    } else if db.browser_seed(slot)?.is_none() {
        return Err("养号浏览器绑定不存在。".into());
    }
    let previous = db.browser_slot()?;
    if previous != slot {
        let old_profile = slot_path(&root, &previous)?.join("profile");
        block(app, &root)?;
        reporter.log("browser", "running", "正在正常退出旧浏览器资料。", 0, None);
        if let Err(error) = profile::quit(&old_profile) {
            let _ = refresh_launch_args(app);
            return Err(error);
        }
        reporter.log("browser", "ok", "旧浏览器资料已退出。", 1, Some(1));
    }
    if let Err(error) = db.switch_browser_slot_only(slot) {
        let _ = refresh_launch_args(app);
        return Err(error);
    }
    *browser.warning.lock().unwrap() = None;
    super::kill_switch::clear_alert(app);
    ensure(&root)?;
    refresh_launch_args(app)?;
    match open_mode {
        "claude_ai" => {
            launch_with_urls_locked(app, reporter, &["https://claude.ai/new"])?;
        }
        "verify" => {
            launch_locked(app, reporter)?;
        }
        "switch_only" => {
            renew_session(app);
        }
        _ => unreachable!(),
    }
    reporter.log(
        "browser",
        "ok",
        "养号浏览器资料已同步，CLI 身份保持不变。",
        1,
        Some(1),
    );
    Ok(())
}
pub(super) fn validate_warming_open_mode(open_mode: &str) -> Result<(), String> {
    match open_mode {
        "claude_ai" | "verify" | "switch_only" => Ok(()),
        _ => Err("养号浏览器打开方式无效。".into()),
    }
}
pub(crate) fn delete_saved(
    app: &tauri::AppHandle,
    id: &str,
    remove_profile: bool,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let _guard = browser.gate.lock().unwrap();
    let root = root(app)?;
    let db = database(&root)?;
    let slot = db.browser_for(id)?;
    if remove_profile {
        if let Some(slot) = slot.as_deref() {
            if slot == db.browser_slot()? {
                return Err("关联浏览器资料正在使用，不能删除。".into());
            }
            let path = slot_path(&root, slot)?.join("profile");
            if profile::running(&path)? {
                return Err("关联浏览器资料正在使用，不能删除。".into());
            }
        }
    }
    action()?;
    if remove_profile {
        if let Some(slot) = slot {
            let scope = slot_path(&root, &slot)?;
            let target = if slot == "legacy" {
                scope.join("profile")
            } else {
                scope
            };
            profile::check_path(&root, &target)?;
            if target.exists() {
                private::safe(&target)?;
                fs::remove_dir_all(&target)
                    .map_err(|_| "身份已删除，关联浏览器资料未完全删除，请检查。")?;
            }
        }
    }
    Ok(())
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TransitionMode {
    Unlinked,
    PreserveWarming,
    Coordinate,
}
/// This is the production decision, also exercised with synthetic databases.
/// Recovery and explicit promotion/configuration never bypass browser safety.
pub(super) fn transition_mode(db: &Database, force: bool) -> Result<TransitionMode, String> {
    if force || db.get("recovery")?.is_some() || db.get("browser.promotion")?.is_some() {
        return Ok(TransitionMode::Coordinate);
    }
    if !db.browser_link()?.enabled {
        return Ok(TransitionMode::Unlinked);
    }
    if db.current_browser_is_warming()? {
        return Ok(TransitionMode::PreserveWarming);
    }
    Ok(TransitionMode::Coordinate)
}
pub(super) fn transition(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    force: bool,
    launch_on_linked: bool,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let _guard = browser.gate.lock().unwrap();
    let root = root(app)?;
    match transition_mode(&database(&root)?, force)? {
        TransitionMode::Unlinked => return action(),
        TransitionMode::PreserveWarming => {
            let selected = scope(&root)?;
            let result = action();
            // Successful CLI work leaves the browser session, launch.args and
            // live profile untouched. An unresolved failure still quarantines
            // the browser until the existing recovery transaction is resolved.
            let safety: Result<(), String> = (|| {
                if database(&root)?.get("recovery")?.is_some() {
                    block(app, &root)?;
                    *browser.warning.lock().unwrap() =
                        Some("浏览器保持关闭，请先恢复身份切换。".into());
                    reporter.log("browser", "running", "正在正常退出关联浏览器。", 0, None);
                    profile::quit(&selected.join("profile"))?;
                }
                Ok(())
            })();
            if let Err(error) = &safety {
                reporter.log("browser", "error", error, 0, None);
            }
            return result.and(safety);
        }
        TransitionMode::Coordinate => (),
    }
    *browser.warning.lock().unwrap() = None;
    let profile = scope(&root)?.join("profile");
    let was_running = profile::running(&profile)?;
    block(app, &root)?;
    reporter.log("browser", "running", "正在正常退出关联浏览器。", 0, None);
    if let Err(error) = profile::quit(&profile) {
        let _ = refresh_launch_args(app);
        return Err(error);
    }
    reporter.log("browser", "ok", "关联浏览器已退出。", 1, Some(1));
    let result = action();
    let finish = (|| {
        reporter.log("browser", "running", "正在同步关联浏览器资料。", 0, None);
        refresh_launch_args(app)?;
        if result.is_ok()
            && (was_running || launch_on_linked)
            && database(&root)?.browser_link()?.enabled
        {
            launch_locked(app, reporter)?;
        }
        Ok::<_, String>(())
    })();
    if let Err(error) = finish {
        let warning = if database(&root)?.get("recovery")?.is_some() {
            "浏览器保持关闭，请先恢复身份切换。"
        } else {
            "身份状态已保存，浏览器未能重开；请重试打开浏览器。"
        };
        *browser.warning.lock().unwrap() = Some(warning.into());
        reporter.log("browser", "error", &error, 0, None);
    } else {
        reporter.log("browser", "ok", "浏览器资料已与身份同步。", 1, Some(1));
    }
    result
}
