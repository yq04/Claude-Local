// [INPUT]: 所选浏览器槽位、只读精确资料进程/窗口、live CLI账号HMAC与冻结额度指纹和既有绑定。
// [OUTPUT]: 无缓存/凭据/网络采样的运行三态、桌面专用CLI摘要，以及仅浏览器的返回核验与失败补偿。
// [POS]: Cleaner -> Browser门内的归属边界；不停止CLI、不切CLI身份、不创建缺失绑定或改变联动偏好。
// [PROTOCOL]: Update header on change and check CLAUDE.md.
use super::*;
use crate::identities::{browser_link::BrowserIdentity, catalog, database::Database, private};
use std::io::Read;

const UNAVAILABLE: &str = "当前 CLI 身份或既有浏览器绑定无法确认，请刷新身份后重试。";
const CHANGED: &str = "当前 CLI 身份或浏览器绑定已变化，未继续打开。";

pub(super) struct IdentityGuard(tauri::AppHandle);
impl IdentityGuard {
    pub(super) fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        app.state::<crate::cleaner::Cleaner>()
            .enter_quota()
            .map_err(|_| "身份操作正在进行，请稍后重试。")?;
        Ok(Self(app.clone()))
    }
}
impl Drop for IdentityGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}

pub(super) struct CliProof {
    pub(super) id: String,
    pub(super) fingerprint: String,
    identity: BrowserIdentity,
}

/// Only the bounded public account metadata in .claude.json is needed here.
/// Never call identities::state/profile::read: those also inspect credentials,
/// ledgers and session history and do not belong to this browser action.
pub(super) fn prove_cli(app: &tauri::AppHandle) -> Result<CliProof, String> {
    let root = root(app)?;
    let db = workspaces::database(&root)?;
    let vault = root.parent().ok_or(UNAVAILABLE)?.join("identity-vault");
    prove_cli_at(&vault, &crate::cleaner::identity::root()?, &db)
}

fn prove_cli_at(vault: &Path, home: &Path, db: &Database) -> Result<CliProof, String> {
    if db.get("recovery")?.is_some() || db.get("browser.promotion")?.is_some() {
        return Err(UNAVAILABLE.into());
    }
    let id = catalog::current_id(vault, home, db)?.ok_or(UNAVAILABLE)?;
    let record = db
        .records()?
        .into_iter()
        .find(|record| record.id == id && !record.empty)
        .ok_or(UNAVAILABLE)?;
    let path = home.join(".claude.json");
    private::parents(home)?;
    private::safe(&path)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| UNAVAILABLE)?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return Err(UNAVAILABLE.into());
    }
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    fs::File::open(&path)
        .map_err(|_| UNAVAILABLE)?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(UNAVAILABLE.into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?;
    let fingerprint = crate::identities::profile::quota_identity(&value).ok_or(UNAVAILABLE)?;
    quota_connection::validate_fingerprint(&fingerprint)?;
    if catalog::current_id(vault, home, db)?.as_deref() != Some(id.as_str()) {
        return Err(CHANGED.into());
    }
    let field = |key: &str, max: usize| {
        value["oauthAccount"][key]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
            .map(str::to_string)
    };
    Ok(CliProof {
        id,
        fingerprint,
        identity: BrowserIdentity {
            linked: db.browser_link()?.enabled,
            status: "linked",
            name: Some(record.name),
            email: field("emailAddress", 254),
            organization: field("organizationName", 120),
            cli_proxy: None,
        },
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CliTarget {
    pub(super) bound: quota_connection::BoundProfileTarget,
    seed: u32,
    config: serde_json::Value,
}

fn resolve_cli_target(
    root: &Path,
    db: &Database,
    proof: Option<(&str, &str)>,
    expected: &str,
) -> Result<CliTarget, String> {
    quota_connection::validate_fingerprint(expected)?;
    if db.get("recovery")?.is_some() || db.get("browser.promotion")?.is_some() {
        return Err(UNAVAILABLE.into());
    }
    let (id, fingerprint) = proof.ok_or(UNAVAILABLE)?;
    if !crate::identities::valid_id(id)
        || !db
            .records()?
            .iter()
            .any(|record| record.id == id && !record.empty)
    {
        return Err(UNAVAILABLE.into());
    }
    let bound = quota_connection::resolve_bound_profile_target_pure(
        root,
        db,
        false,
        "current",
        expected,
        Some((id, fingerprint)),
        &[],
    )?;
    let seed = db
        .browser_seed(&bound.slot)?
        .filter(|seed| *seed > 0)
        .ok_or(UNAVAILABLE)?;
    let config_path = bound.scope.join("config.json");
    let stamp = bound.scope.join("seed.owner");
    profile::check_path(root, &config_path)?;
    profile::check_path(root, &stamp)?;
    let config = config::load(&bound.scope)?;
    // Refuse rather than letting ensure() regenerate a fingerprint on return.
    if config.seed != seed
        || fs::metadata(&stamp)
            .ok()
            .filter(|m| m.is_file() && m.len() <= 10)
            .is_none()
        || fs::read_to_string(stamp).ok().as_deref() != Some(seed.to_string().as_str())
    {
        return Err(UNAVAILABLE.into());
    }
    Ok(CliTarget {
        bound,
        seed,
        config: serde_json::to_value(config).map_err(|_| UNAVAILABLE)?,
    })
}

pub(super) fn current_target(app: &tauri::AppHandle, expected: &str) -> Result<CliTarget, String> {
    let proof = prove_cli(app)?;
    let root = root(app)?;
    resolve_cli_target(
        &root,
        &workspaces::database(&root)?,
        Some((&proof.id, &proof.fingerprint)),
        expected,
    )
}

pub(super) fn snapshot_cli(app: &tauri::AppHandle) -> (Option<BrowserIdentity>, Option<String>) {
    let Ok(proof) = prove_cli(app) else {
        return (None, None);
    };
    let expected = current_target(app, &proof.fingerprint)
        .ok()
        .map(|_| proof.fingerprint);
    (
        Some(mask_browser_identity(
            proof.identity,
            crate::ui_privacy::effective_privacy_mask(app),
        )),
        expected,
    )
}

#[derive(Serialize)]
pub struct Runtime {
    slot: String,
    running: Option<bool>,
    window_open: Option<bool>,
}

fn runtime_result(slot: String, sample: Result<(bool, Option<bool>), String>) -> Runtime {
    match sample {
        Ok((running, window_open)) => Runtime {
            slot,
            running: Some(running),
            window_open,
        },
        Err(_) => Runtime {
            slot,
            running: None,
            window_open: None,
        },
    }
}

#[tauri::command]
pub async fn browser_runtime_read(app: tauri::AppHandle) -> Result<Runtime, String> {
    run(move || {
        let browser = app.state::<Browser>();
        let _guard = browser
            .gate
            .try_lock()
            .map_err(|_| "浏览器操作正在进行。")?;
        let root = root(&app)?;
        // No ensure(), config/machine reads, cache scan or identity proof.
        let slot = workspaces::selected_slot_readonly(&root)?;
        let sample = (|| {
            let profile = workspaces::slot_path(&root, &slot)?.join("profile");
            profile::check_path(&root, &profile)?;
            #[cfg(target_os = "windows")]
            {
                crate::windows::browser_runtime(&profile)
                    .map(|(running, visible)| (running, Some(visible)))
            }
            #[cfg(not(target_os = "windows"))]
            {
                profile::running(&profile).map(|running| (running, None))
            }
        })();
        Ok(runtime_result(slot, sample))
    })
    .await
}

fn rollback_selection(root: &Path, previous: &str, target: &str) -> Result<(), String> {
    workspaces::select_existing_slot(root, target, previous)
}

fn return_locked(
    app: &tauri::AppHandle,
    expected: &str,
    reporter: &Reporter,
) -> Result<Snapshot, String> {
    let target = current_target(app, expected)?;
    let root = root(app)?;
    let previous = workspaces::database(&root)?.browser_slot()?;
    let old_profile = workspaces::slot_path(&root, &previous)?.join("profile");
    // Validate every known failure before closing any window.
    let config = config::load(&target.bound.scope)?;
    config.validate(&config::machine()?)?;
    if !binary(&engine(app)?).is_file() {
        return Err("内置浏览器引擎不可用。".into());
    }
    if root.join("identity-switch.pending").exists() {
        return Err(UNAVAILABLE.into());
    }
    let target_was_running = profile::running(&target.bound.profile)?;
    let args_path = root.join("launch.args");
    profile::check_path(&root, &args_path)?;
    let previous_args = match fs::metadata(&args_path) {
        Ok(meta) if meta.is_file() && meta.len() <= 128 * 1024 => {
            Some(fs::read(&args_path).map_err(|_| "无法保存浏览器启动参数。")?)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        _ => return Err("无法保存浏览器启动参数。".into()),
    };
    let mut selected = false;
    let mut launch_attempted = false;
    workspaces::block(app, &root)?;
    let result = (|| {
        if previous != target.bound.slot {
            reporter.log(
                "browser",
                "running",
                "正在正常退出当前浏览器，CLI 保持运行。",
                0,
                None,
            );
            profile::quit(&old_profile)?;
        }
        if current_target(app, expected)? != target {
            return Err(CHANGED.into());
        }
        workspaces::select_existing_slot(&root, &previous, &target.bound.slot)?;
        selected = true;
        refresh_launch_args(app)?;
        launch_attempted = true;
        launch_locked(app, reporter)
    })();
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            // A failed launch may already have opened the target. Only restore
            // the pointer after its normal exit; never claim old windows reopen.
            if selected && previous != target.bound.slot {
                if launch_attempted
                    && !target_was_running
                    && profile::quit(&target.bound.profile).is_err()
                {
                    return Err(format!("{error} 当前已选择 CLI 浏览器，未能正常关闭新窗口；原浏览器未自动重开，CLI 身份未改变。"));
                }
                let rollback = rollback_selection(&root, &previous, &target.bound.slot)
                    .and_then(|_| restore_launch_args(&root, previous_args.as_deref()));
                if rollback.is_err() {
                    return Err(format!("{error} 浏览器恢复未完成，请刷新当前选择；原窗口未自动重开，CLI 身份未改变。"));
                }
            } else if restore_launch_args(&root, previous_args.as_deref()).is_err() {
                return Err(format!(
                    "{error} 浏览器启动保护恢复未完成，请刷新后重试；CLI 身份未改变。"
                ));
            }
            *app.state::<Browser>().session.lock().unwrap() = None;
            forget_start_url(app);
            Err(format!(
                "{error} 已保留原浏览器选择；浏览器窗口未自动重开，CLI 身份未改变。"
            ))
        }
    }
}

fn restore_launch_args(root: &Path, previous: Option<&[u8]>) -> Result<(), String> {
    let path = root.join("launch.args");
    profile::check_path(root, &path)?;
    match previous {
        Some(bytes) => private::write(&path, bytes)?,
        None => match fs::remove_file(&path) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("无法恢复浏览器启动参数。".into()),
        },
    }
    workspaces::unblock(root)
}

#[tauri::command]
pub async fn browser_return_to_cli(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    expected_identity: String,
    on_progress: Option<tauri::ipc::JavaScriptChannelId>,
) -> Result<Snapshot, String> {
    let on_progress = on_progress.map(|id| id.channel_on(webview));
    run(move || {
        let _cleaner = IdentityGuard::acquire(&app)?;
        let browser = app.state::<Browser>();
        let _guard = browser.gate.lock().unwrap();
        return_locked(&app, &expected_identity, &Reporter::channel(on_progress))
    })
    .await
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
