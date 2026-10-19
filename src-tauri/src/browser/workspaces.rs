// [INPUT]: 身份 SQLite 绑定、独立浏览器根目录、受限配置和用户确认后的切换事务。
// [OUTPUT]: 每身份独占资料/配置选择、初始稳定种子、安全退出/重开与崩溃时启动阻断；退出成功与随后同步各自发出真实阶段事件。
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
fn block(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
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
    transition(app, reporter, false, action)
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
pub(super) fn transition(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    force: bool,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let _guard = browser.gate.lock().unwrap();
    let root = root(app)?;
    if !force && !database(&root)?.browser_link()?.enabled {
        return action();
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
        if (result.is_ok() && database(&root)?.browser_link()?.enabled) || was_running {
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
