// [INPUT]: Explicit user remedy click, frozen account ID, expected 64-hex identity and managed browser profile storage.
// [OUTPUT]: Safe isolated fixed-usage-page launch; current CLI uses bounded live account proof, without changing global slot/session or reading credentials.
// [POS]: Isolated browser connection launcher for centralized remedy queue; opens only to pinned usage URL, never executes arbitrary URLs or loops.
// [PROTOCOL]: Update header on change and check CLAUDE.md.
use super::*;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const USAGE_SETTINGS_URL: &str = "https://claude.ai/settings/usage";

struct CleanerGuard(tauri::AppHandle);

impl Drop for CleanerGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundProfileTarget {
    pub account_id: String,
    pub expected_identity: String,
    pub slot: String,
    pub scope: PathBuf,
    pub profile: PathBuf,
}

pub fn validate_fingerprint(expected_identity: &str) -> Result<(), String> {
    if expected_identity.len() != 64 || !expected_identity.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("quotaOnline.accountMismatch".into());
    }
    Ok(())
}

pub(crate) fn resolve_bound_profile_target_pure(
    root: &Path,
    db: &crate::identities::database::Database,
    recovery_pending: bool,
    account_id: &str,
    expected_identity: &str,
    current_binding: Option<(&str, &str)>,
    saved_records: &[(&str, Option<&str>)],
) -> Result<BoundProfileTarget, String> {
    validate_fingerprint(expected_identity)?;

    if recovery_pending {
        return Err("quotaOnline.busy".into());
    }

    if !db.browser_link()?.enabled {
        return Err("quotaOnline.unavailable".into());
    }

    let slot = if account_id == "current" {
        let (id, current_fp) =
            current_binding.ok_or_else(|| "quotaOnline.unavailable".to_string())?;
        if !current_fp.eq_ignore_ascii_case(expected_identity) {
            return Err("quotaOnline.accountMismatch".into());
        }
        db.browser_for(id)?
            .ok_or_else(|| "quotaOnline.unavailable".to_string())?
    } else {
        if !crate::identities::valid_id(account_id) {
            return Err("quotaOnline.accountMismatch".into());
        }
        let matched = saved_records.iter().any(|(id, fp)| {
            *id == account_id && fp.is_some_and(|f| f.eq_ignore_ascii_case(expected_identity))
        });
        if !matched {
            return Err("quotaOnline.accountMismatch".into());
        }
        db.browser_for(account_id)?
            .ok_or_else(|| "quotaOnline.unavailable".to_string())?
    };

    let scope = super::workspaces::slot_path(root, &slot)?;
    let profile = scope.join("profile");
    super::profile::check_path(root, &profile)?;

    if !profile.is_dir() || !scope.join("config.json").is_file() {
        return Err("quotaOnline.unavailable".into());
    }

    Ok(BoundProfileTarget {
        account_id: account_id.to_string(),
        expected_identity: expected_identity.to_string(),
        slot,
        scope,
        profile,
    })
}

pub fn resolve_bound_profile_target(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<BoundProfileTarget, String> {
    if account_id == "current" {
        return super::lifecycle::current_target(app, expected_identity).map(|target| target.bound);
    }
    let root = super::root(app)?;
    super::workspaces::ready(&root)?;
    let db = super::workspaces::database(&root)?;
    let recovery_pending = db.get("recovery")?.is_some();

    let records = db.records()?;
    let summaries = db.summaries()?;
    let saved_records = records
        .iter()
        .map(|r| {
            (
                r.id.as_str(),
                summaries
                    .get(&r.id)
                    .and_then(|s| s.quota_identity.as_deref()),
            )
        })
        .collect::<Vec<_>>();

    resolve_bound_profile_target_pure(
        &root,
        &db,
        recovery_pending,
        account_id,
        expected_identity,
        None,
        &saved_records,
    )
}

fn revalidate_target(
    frozen: &BoundProfileTarget,
    fresh: &BoundProfileTarget,
) -> Result<(), String> {
    if frozen != fresh {
        return Err("quotaOnline.accountMismatch".into());
    }
    Ok(())
}

pub fn launch_bound_profile_url_locked(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    target_url: &str,
) -> Result<(), String> {
    let target = resolve_bound_profile_target(app, account_id, expected_identity)?;

    let engine = super::engine(app)?;
    let binary = super::binary(&engine);
    if !binary.is_file() {
        return Err("quotaOnline.unavailable".into());
    }

    let config = super::config::load(&target.scope)?;
    let machine = super::config::machine()?;
    config.validate(&machine)?;
    if !super::profile::running(&target.profile)? {
        super::profile::preferences(&target.profile, &config, &machine)?;
    }

    let log_path = target.scope.join("engine.log");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|_| "浏览器诊断日志不可用。")?;

    let mut cmd_args = super::config::arguments(
        &config,
        &machine,
        &target.profile,
        "",
        &super::version(&engine),
    );
    cmd_args.pop(); // Remove empty default page
    cmd_args.push(target_url.to_string());

    let fresh = resolve_bound_profile_target(app, account_id, expected_identity)?;
    revalidate_target(&target, &fresh)?;
    let fresh_config = super::config::load(&fresh.scope)?;
    if serde_json::to_value(&fresh_config).ok() != serde_json::to_value(&config).ok() {
        return Err("quotaOnline.accountMismatch".into());
    }

    let mut command = Command::new(binary);
    command
        .args(cmd_args)
        .stdin(Stdio::null())
        .stdout(file.try_clone().map_err(|_| "浏览器日志不可用。")?)
        .stderr(file);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|_| "无法启动已绑定的浏览器资料。")?;
    super::kill_switch::clear_alert(app);
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

pub fn launch_identity_profile_locked(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<(), String> {
    launch_bound_profile_url_locked(app, account_id, expected_identity, USAGE_SETTINGS_URL)
}

#[tauri::command]
pub async fn browser_open_identity_profile(
    app: tauri::AppHandle,
    account_id: String,
    expected_identity: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Step 1: acquire Cleaner enter_quota to freeze identity changes without epoch bump
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        cleaner.enter_quota().map_err(|_| "quotaOnline.busy")?;
        let _cleaner_guard = CleanerGuard(app.clone());

        // Step 2: acquire Browser gate in the exact same order as identity mutators
        let browser = app.state::<Browser>();
        let _browser_guard = browser.gate.lock().unwrap();

        // Launch under the door; release both guards on completion
        launch_identity_profile_locked(&app, &account_id, &expected_identity)
    })
    .await
    .map_err(|_| "浏览器操作被中断。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identities::{
        database::{Database, Record},
        Policy,
    };

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().canonicalize().unwrap().join(format!(
                "claude-local-quota-connection-{}",
                crate::identities::new_id().unwrap()
            )))
        }
        fn db(&self) -> Database {
            Database::open(&self.0.join("identity-vault")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn record(id: &str) -> Record {
        Record {
            id: id.into(),
            name: id.into(),
            archive: format!("{id}.baga"),
            saved_at: 1,
            bytes: 1,
            policy: Policy::default(),
            empty: false,
            account_key: Some(id.into()),
        }
    }

    #[test]
    fn validate_fingerprint_enforces_64_hex_digits() {
        assert!(validate_fingerprint("").is_err());
        assert!(validate_fingerprint("not_a_valid_hex_string").is_err());
        assert!(validate_fingerprint("12345").is_err());
        assert!(validate_fingerprint(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"
        )
        .is_err());
        let valid_64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert!(validate_fingerprint(valid_64).is_ok());
        let valid_caps = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
        assert!(validate_fingerprint(valid_caps).is_ok());
    }

    #[test]
    fn pinned_usage_url_is_claude_settings_usage() {
        assert_eq!(USAGE_SETTINGS_URL, "https://claude.ai/settings/usage");
    }

    #[test]
    fn resolver_invariants_reject_recovery_disabled_link_and_missing_profile() {
        let fixture = Fixture::new();
        let root = fixture.0.join("browser");
        std::fs::create_dir_all(&root).unwrap();
        let mut db = fixture.db();

        let fp = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        let a = crate::identities::new_id().unwrap();
        let b = crate::identities::new_id().unwrap();
        db.remember(&record(&a)).unwrap();
        db.remember(&record(&b)).unwrap();
        db.configure_browser(true, false, Some(&b)).unwrap();
        db.configure_browser(true, false, Some(&a)).unwrap();
        let active_slot = db.browser_slot().unwrap();

        // Recovery active -> rejects before path resolution.
        let err = resolve_bound_profile_target_pure(&root, &db, true, &b, fp, None, &[]);
        assert_eq!(err.unwrap_err(), "quotaOnline.busy");

        // Fingerprint mismatch -> rejects with accountMismatch.
        let wrong_fp = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        let err = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &b,
            wrong_fp,
            None,
            &[(b.as_str(), Some(fp))],
        );
        assert_eq!(err.unwrap_err(), "quotaOnline.accountMismatch");

        // Stale / unbound account -> rejects with unavailable.
        let c = crate::identities::new_id().unwrap();
        let err = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &c,
            fp,
            None,
            &[(c.as_str(), Some(fp))],
        );
        assert_eq!(err.unwrap_err(), "quotaOnline.unavailable");

        let b_slot = db.browser_for(&b).unwrap().unwrap();
        let slot_path = root.join("contexts").join(&b_slot);
        // Bound account with missing profile/config refuses to create a new profile.
        let err = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &b,
            fp,
            None,
            &[(b.as_str(), Some(fp))],
        );
        assert_eq!(err.unwrap_err(), "quotaOnline.unavailable");

        // Complete existing bound profile resolves without touching global slot, seed or config.
        std::fs::create_dir_all(slot_path.join("profile")).unwrap();
        std::fs::write(slot_path.join("config.json"), b"{ synthetic config }").unwrap();
        let original_config = std::fs::read(slot_path.join("config.json")).unwrap();
        let original_seed = db.browser_seed(&b_slot).unwrap();
        let resolved = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &b,
            fp,
            None,
            &[(b.as_str(), Some(fp))],
        )
        .unwrap();
        assert_eq!(resolved.slot, b_slot);
        assert_eq!(resolved.account_id, b);
        assert_eq!(db.browser_slot().unwrap(), active_slot); // Active slot pointer unchanged!
        assert_eq!(db.browser_seed(&resolved.slot).unwrap(), original_seed);
        assert_eq!(
            std::fs::read(slot_path.join("config.json")).unwrap(),
            original_config
        );
        let stale = BoundProfileTarget {
            slot: "replacement".into(),
            ..resolved.clone()
        };
        assert!(revalidate_target(&resolved, &stale).is_err());

        // Current means the current identity's own binding, even when the global slot points elsewhere.
        db.configure_browser(true, false, Some(&b)).unwrap();
        let current_slot = db.browser_slot().unwrap();
        let a_slot = db.browser_for(&a).unwrap().unwrap();
        let a_path = root.join("contexts").join(&a_slot);
        std::fs::create_dir_all(a_path.join("profile")).unwrap();
        std::fs::write(a_path.join("config.json"), b"{ current account config }").unwrap();
        let current_target = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            "current",
            fp,
            Some((&a, fp)),
            &[],
        )
        .unwrap();
        assert_eq!(current_target.slot, a_slot);
        assert_eq!(db.browser_slot().unwrap(), current_slot);
    }
}
