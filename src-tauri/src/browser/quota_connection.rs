// [INPUT]: Explicit user remedy click, frozen account ID, expected 64-hex identity, Cleaner per-account shard + Browser slot gate and managed browser profile storage.
// [OUTPUT]: Safe isolated fixed-URL launch (usage or claude.ai) with early SlotGate acquisition on bound slots, CliProofCache initial read + uncached TOCTOU revalidate, RunningMemoGuard deduplication, hot-open drift + `enable_quota_bridge` drift controlled reopen & 3-arg forwarding, `SingletonLock` safety check, readiness wait, Kill-Switch activity notification, and loopback proxy preflight without blocking on Browser::gate or online quota commits.
// [POS]: Isolated browser connection launcher for multi-account simultaneous profiles and remedy queue; opens only pinned URLs, never executes arbitrary URLs or loops, and never acquires SlotGate inside *_locked primitives.
// [PROTOCOL]: Update header on change and check CLAUDE.md.
use super::*;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const USAGE_SETTINGS_URL: &str = "https://claude.ai/settings/usage";
pub const CLAUDE_AI_NEW_URL: &str = "https://claude.ai/new";

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct LaunchPhaseTimings {
    pub enter_quota_ms: u64,
    pub browser_gate_ms: u64,
    pub cli_proof_ms: u64,
    pub machine_snapshot_ms: u64,
    pub process_scan_ms: u64,
    pub exit_preflight_ms: u64,
    pub preferences_io_ms: u64,
    pub drift_restart_ms: u64,
    pub launch_spawn_ms: u64,
    pub total_ms: u64,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
pub fn resolve_bound_profile_target(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<BoundProfileTarget, String> {
    let mut cache = super::lifecycle::CliProofCache::default();
    resolve_bound_profile_target_with_cache(app, account_id, expected_identity, &mut cache)
}

fn resolve_saved_bound_profile_target(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<BoundProfileTarget, String> {
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

pub(super) fn resolve_bound_profile_target_with_cache(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    proof_cache: &mut super::lifecycle::CliProofCache,
) -> Result<BoundProfileTarget, String> {
    if account_id == "current" {
        return super::lifecycle::current_target_cached(app, expected_identity, proof_cache)
            .map(|target| target.bound);
    }
    resolve_saved_bound_profile_target(app, account_id, expected_identity)
}

pub(super) fn resolve_bound_profile_target_uncached(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<BoundProfileTarget, String> {
    if account_id == "current" {
        return super::lifecycle::current_target_uncached(app, expected_identity)
            .map(|target| target.bound);
    }
    resolve_saved_bound_profile_target(app, account_id, expected_identity)
}

pub(super) fn lookup_existing_bound_slot_with_cache(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    proof_cache: &mut super::lifecycle::CliProofCache,
) -> Option<String> {
    let root = super::root(app).ok()?;
    let db = super::workspaces::database(&root).ok()?;
    if db.get("recovery").ok().flatten().is_some() {
        return None;
    }
    if account_id == "current" {
        let proof = super::lifecycle::prove_cli_cached(app, proof_cache).ok()?;
        if !proof.fingerprint.eq_ignore_ascii_case(expected_identity) {
            return None;
        }
        return db.browser_for(&proof.id).ok().flatten();
    }
    if !crate::identities::valid_id(account_id) {
        return None;
    }
    db.browser_for(account_id).ok().flatten()
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

#[allow(dead_code)]
pub(crate) fn materialize_identity_profile_locked(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<(), String> {
    let mut cache = super::lifecycle::CliProofCache::default();
    materialize_identity_profile_with_cache(app, account_id, expected_identity, &mut cache)
}

pub(super) fn materialize_identity_profile_with_cache(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    proof_cache: &mut super::lifecycle::CliProofCache,
) -> Result<(), String> {
    validate_fingerprint(expected_identity)?;
    let root = super::root(app)?;
    super::workspaces::ready(&root)?;
    if account_id == "current" {
        let proof = super::lifecycle::prove_cli_cached(app, proof_cache)?;
        if !proof.fingerprint.eq_ignore_ascii_case(expected_identity) {
            return Err("quotaOnline.accountMismatch".into());
        }
        super::workspaces::ensure_identity_slot(&root, &proof.id)?;
        return Ok(());
    }
    if !crate::identities::valid_id(account_id) {
        return Err("quotaOnline.accountMismatch".into());
    }
    let db = super::workspaces::database(&root)?;
    if db.get("recovery")?.is_some() {
        return Err("quotaOnline.busy".into());
    }
    if !db.browser_link()?.enabled {
        return Err("quotaOnline.unavailable".into());
    }
    let records = db.records()?;
    let summaries = db.summaries()?;
    let matched = records.iter().any(|r| {
        r.id == account_id
            && !r.empty
            && summaries
                .get(&r.id)
                .and_then(|s| s.quota_identity.as_deref())
                .is_some_and(|fp| fp.eq_ignore_ascii_case(expected_identity))
    });
    if !matched {
        return Err("quotaOnline.accountMismatch".into());
    }
    super::workspaces::ensure_identity_slot(&root, account_id)?;
    Ok(())
}

pub(crate) fn build_hot_forward_args(profile: &Path, target_url: &str) -> Vec<String> {
    vec![
        format!("--user-data-dir={}", profile.display()),
        "--profile-directory=Default".into(),
        target_url.to_string(),
    ]
}

pub(crate) fn launch_config_drifted(
    previous: Option<&super::LaunchRuntimeSnapshot>,
    desired: &super::LaunchRuntimeSnapshot,
) -> bool {
    previous.is_some_and(|prev| prev != desired)
}

#[allow(dead_code)]
pub(crate) fn launch_scope_url_locked(
    app: &tauri::AppHandle,
    scope: &Path,
    target_url: &str,
    revalidate: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    launch_scope_url_with_options_locked(
        app,
        scope,
        target_url,
        super::config::LaunchOptions::legacy_default(),
        None,
        revalidate,
    )
}

pub(crate) fn launch_scope_url_with_options_locked(
    app: &tauri::AppHandle,
    scope: &Path,
    target_url: &str,
    options: super::config::LaunchOptions,
    mut timings: Option<&mut LaunchPhaseTimings>,
    revalidate: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let root = super::root(app)?;
    let slot = super::slot_name_for_scope(scope);
    let profile = scope.join("profile");
    super::profile::check_path(&root, &profile)?;
    if !profile.is_dir() || !scope.join("config.json").is_file() {
        return Err("quotaOnline.unavailable".into());
    }

    let engine = super::engine(app)?;
    let binary = super::binary(&engine);
    if !binary.is_file() {
        return Err("quotaOnline.unavailable".into());
    }

    let config = super::load_config_ensured_seed(&root, scope, Some(&slot))?;
    let t_machine = std::time::Instant::now();
    let machine = super::config::machine()?;
    config.validate(&machine)?;
    if let Some(t) = timings.as_deref_mut() {
        t.machine_snapshot_ms = t_machine.elapsed().as_millis() as u64;
    }

    let t_scan = std::time::Instant::now();
    let mut running = super::profile::running(&profile)?;
    if let Some(t) = timings.as_deref_mut() {
        t.process_scan_ms = t_scan.elapsed().as_millis() as u64;
    }

    let state = app.state::<Browser>();
    let desired = super::LaunchRuntimeSnapshot::from_config_with_options(&config, &machine, options);
    let prev_snapshot = state.read_launched_config(scope, &slot);
    let drifted = running
        && (launch_config_drifted(prev_snapshot.as_ref(), &desired)
            || (options.enable_quota_bridge && prev_snapshot.is_none()));

    super::kill_switch::ensure_launch_route_healthy_when_triggered(app, Some(&slot), &config, &machine)?;
    let t_preflight = std::time::Instant::now();
    super::config::preflight_browser_launch_policy(&config, &machine, !running || drifted)?;
    if let Some(t) = timings.as_deref_mut() {
        t.exit_preflight_ms = t_preflight.elapsed().as_millis() as u64;
    }

    if drifted {
        let t_drift = std::time::Instant::now();
        super::profile::quit(&profile)?;
        state.clear_launched_config(scope, &slot);
        running = false;
        if let Some(t) = timings.as_deref_mut() {
            t.drift_restart_ms = t_drift.elapsed().as_millis() as u64;
        }
    }

    let cmd_args = if !running {
        super::launch::prepare_slot_singleton_for_launch(&root, &profile)?;
        let t_prefs = std::time::Instant::now();
        super::profile::preferences(&profile, &config, &machine)?;
        if let Some(t) = timings.as_deref_mut() {
            t.preferences_io_ms = t_prefs.elapsed().as_millis() as u64;
        }
        let mut args = super::config::arguments_with_options(
            &config,
            &machine,
            &profile,
            "",
            &super::version(&engine),
            options,
        );
        args.pop(); // Remove empty default page
        args.push(target_url.to_string());
        args
    } else {
        build_hot_forward_args(&profile, target_url)
    };

    let log_path = scope.join("engine.log");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|_| "浏览器诊断日志不可用。")?;

    revalidate()?;
    let fresh_config = super::config::load(scope)?;
    if serde_json::to_value(&fresh_config).ok() != serde_json::to_value(&config).ok() {
        return Err("quotaOnline.accountMismatch".into());
    }

    let t_spawn = std::time::Instant::now();
    super::profile::invalidate_running_memo(&profile);
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
    if !running {
        super::launch::wait_scope_launch_ready(&profile, &mut child)?;
        state.record_launched_config(scope, &slot, &desired);
    }
    super::kill_switch::on_managed_browser_spawned(app, true);
    if let Some(t) = timings.as_deref_mut() {
        t.launch_spawn_ms = t_spawn.elapsed().as_millis() as u64;
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

pub(super) fn launch_bound_profile_target_with_options(
    app: &tauri::AppHandle,
    target: &BoundProfileTarget,
    options: super::config::LaunchOptions,
    timings: Option<&mut LaunchPhaseTimings>,
) -> Result<(), String> {
    let target_url = match options.purpose {
        super::config::LaunchPurpose::BrowseClaudeAi => CLAUDE_AI_NEW_URL,
        _ => USAGE_SETTINGS_URL,
    };
    let scope = target.scope.clone();
    launch_scope_url_with_options_locked(app, &scope, target_url, options, timings, || {
        let fresh = resolve_bound_profile_target_uncached(
            app,
            &target.account_id,
            &target.expected_identity,
        )?;
        revalidate_target(target, &fresh)
    })
}

#[allow(dead_code)]
pub fn launch_bound_profile_url_locked(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    target_url: &str,
) -> Result<(), String> {
    let mut proof_cache = super::lifecycle::CliProofCache::default();
    let target = resolve_bound_profile_target_with_cache(
        app,
        account_id,
        expected_identity,
        &mut proof_cache,
    )?;
    let scope = target.scope.clone();
    launch_scope_url_with_options_locked(
        app,
        &scope,
        target_url,
        super::config::LaunchOptions::legacy_default(),
        None,
        || {
            let fresh =
                resolve_bound_profile_target_uncached(app, account_id, expected_identity)?;
            revalidate_target(&target, &fresh)
        },
    )
}

#[allow(dead_code)]
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
    open_mode: Option<String>,
) -> Result<(), String> {
    let purpose = match open_mode.as_deref() {
        Some("claude_ai") => super::config::LaunchPurpose::BrowseClaudeAi,
        _ => super::config::LaunchPurpose::QuotaSync,
    };
    let options = super::config::LaunchOptions::for_purpose(purpose);
    tauri::async_runtime::spawn_blocking(move || {
        let total_start = std::time::Instant::now();
        let mut timings = LaunchPhaseTimings::default();

        // Step 1: acquire Cleaner per-account browser gate (concurrent with online.rs enter_quota and other accounts)
        let t_cleaner = std::time::Instant::now();
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        let _account_guard = cleaner.enter_browser_account(&expected_identity)?;
        timings.enter_quota_ms = t_cleaner.elapsed().as_millis() as u64;

        let _running_memo = super::profile::begin_running_memo();
        let mut proof_cache = super::lifecycle::CliProofCache::default();
        let browser = app.state::<Browser>();

        // Step 2: lookup existing bound slot and acquire SlotGate before materialize (covers ensure_slot self-heal)
        let t_proof = std::time::Instant::now();
        let pre_slot = lookup_existing_bound_slot_with_cache(
            &app,
            &account_id,
            &expected_identity,
            &mut proof_cache,
        );
        let proof_lookup_ms = t_proof.elapsed().as_millis() as u64;

        let t_gate = std::time::Instant::now();
        let pre_gate = pre_slot.as_deref().map(|s| browser.slot_gate(s));
        let mut pre_guard = pre_gate.as_ref().map(|g| g.lock());
        let mut gate_ms = t_gate.elapsed().as_millis() as u64;

        let t_materialize = std::time::Instant::now();
        materialize_identity_profile_with_cache(
            &app,
            &account_id,
            &expected_identity,
            &mut proof_cache,
        )?;
        let target = resolve_bound_profile_target_with_cache(
            &app,
            &account_id,
            &expected_identity,
            &mut proof_cache,
        )?;
        timings.cli_proof_ms = proof_lookup_ms + t_materialize.elapsed().as_millis() as u64;

        // Step 3: if newly materialized or slot changed, switch to target SlotGate (never blocks on Browser::gate)
        let _late_gate;
        let _late_guard;
        if pre_slot.as_deref() != Some(target.slot.as_str()) {
            let t_late = std::time::Instant::now();
            drop(pre_guard.take());
            _late_gate = browser.slot_gate(&target.slot);
            _late_guard = Some(_late_gate.lock());
            gate_ms += t_late.elapsed().as_millis() as u64;
        }
        timings.browser_gate_ms = gate_ms;

        let result = launch_bound_profile_target_with_options(
            &app,
            &target,
            options,
            Some(&mut timings),
        );
        timings.total_ms = total_start.elapsed().as_millis() as u64;
        if let Ok(json) = serde_json::to_string(&timings) {
            eprintln!("[claude-local][launch-timings] {json}");
        }
        result
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

    #[test]
    fn ensure_identity_slot_materializes_distinct_profiles_for_multiple_saved_accounts() {
        let f = Fixture::new();
        let root = f.0.join("browser");
        std::fs::create_dir_all(&root).unwrap();
        let a = crate::identities::new_id().unwrap();
        let b = crate::identities::new_id().unwrap();
        let c = crate::identities::new_id().unwrap();
        let fp_a = "1111111111111111111111111111111111111111111111111111111111111111";
        let fp_b = "2222222222222222222222222222222222222222222222222222222222222222";
        let fp_c = "3333333333333333333333333333333333333333333333333333333333333333";

        {
            let mut db = f.db();
            db.remember(&record(&a)).unwrap();
            db.remember(&record(&b)).unwrap();
            db.remember(&record(&c)).unwrap();
            // Only `a` is bound initially when browser linking is enabled; `b` and `c` are saved cards.
            db.configure_browser(true, false, Some(&a)).unwrap();
        }

        let scope_a = super::super::workspaces::ensure_identity_slot(&root, &a).unwrap();
        let scope_b = super::super::workspaces::ensure_identity_slot(&root, &b).unwrap();
        let scope_c = super::super::workspaces::ensure_identity_slot(&root, &c).unwrap();
        assert_ne!(scope_a, scope_b);
        assert_ne!(scope_b, scope_c);
        assert_ne!(scope_a, scope_c);

        let db = f.db();
        let active_slot = db.browser_slot().unwrap();
        assert_eq!(Some(active_slot.as_str()), db.browser_for(&a).unwrap().as_deref());

        let saved_records = [
            (a.as_str(), Some(fp_a)),
            (b.as_str(), Some(fp_b)),
            (c.as_str(), Some(fp_c)),
        ];
        let t_a = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            "current",
            fp_a,
            Some((&a, fp_a)),
            &saved_records,
        )
        .unwrap();
        let t_b = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &b,
            fp_b,
            None,
            &saved_records,
        )
        .unwrap();
        let t_c = resolve_bound_profile_target_pure(
            &root,
            &db,
            false,
            &c,
            fp_c,
            None,
            &saved_records,
        )
        .unwrap();

        assert_ne!(t_a.profile, t_b.profile);
        assert_ne!(t_b.profile, t_c.profile);
        assert_ne!(t_a.profile, t_c.profile);
        let cfg_a = super::super::config::load(&t_a.scope).unwrap();
        let cfg_b = super::super::config::load(&t_b.scope).unwrap();
        let cfg_c = super::super::config::load(&t_c.scope).unwrap();
        assert!(cfg_a.seed > 0 && cfg_b.seed > 0 && cfg_c.seed > 0);
        assert_ne!(cfg_a.seed, cfg_b.seed);
        assert_ne!(cfg_b.seed, cfg_c.seed);
    }

    #[test]
    fn hot_open_drift_detection_and_lightweight_forwarding() {
        let f = Fixture::new();
        let scope = f.0.join("browser/contexts/slot_a");
        let profile = scope.join("profile");
        std::fs::create_dir_all(&profile).unwrap();

        let args = build_hot_forward_args(&profile, CLAUDE_AI_NEW_URL);
        assert_eq!(args.len(), 3);
        assert_eq!(args[0], format!("--user-data-dir={}", profile.display()));
        assert_eq!(args[1], "--profile-directory=Default");
        assert_eq!(args[2], CLAUDE_AI_NEW_URL);
        assert!(!args.iter().any(|a| a.starts_with("--fingerprint")));
        assert!(!args.iter().any(|a| a.starts_with("--proxy-server")));

        let machine = super::super::config::Machine {
            platform: "windows".into(),
            version: "10.0.22631.0".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en_US".into(),
            locale_country: "US".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into()],
            system_proxy: String::new(),
        };
        let cfg = super::super::config::Config {
            seed: 1001,
            proxy: "socks5://127.0.0.1:7899".into(),
            follow_machine: false,
            language: "en-US".into(),
            timezone: "America/New_York".into(),
            native_graphics: false,
        };
        let snap_base = super::super::LaunchRuntimeSnapshot::from_config(&cfg, &machine);
        assert!(!launch_config_drifted(None, &snap_base));
        assert!(!launch_config_drifted(Some(&snap_base), &snap_base));

        let mut cfg_proxy = cfg.clone();
        cfg_proxy.proxy = "socks5://127.0.0.1:7900".into();
        let snap_proxy = super::super::LaunchRuntimeSnapshot::from_config(&cfg_proxy, &machine);
        assert!(launch_config_drifted(Some(&snap_base), &snap_proxy));

        let mut cfg_seed = cfg.clone();
        cfg_seed.seed = 2002;
        let snap_seed = super::super::LaunchRuntimeSnapshot::from_config(&cfg_seed, &machine);
        assert!(launch_config_drifted(Some(&snap_base), &snap_seed));

        let mut cfg_gfx = cfg.clone();
        cfg_gfx.native_graphics = true;
        let snap_gfx = super::super::LaunchRuntimeSnapshot::from_config(&cfg_gfx, &machine);
        assert!(launch_config_drifted(Some(&snap_base), &snap_gfx));

        // Verify Browser::record_launched_config persists <scope>/launch.snapshot.json outside profile
        let browser = super::super::Browser::default();
        browser.record_launched_config(&scope, "slot_a", &snap_base);
        assert!(scope.join("launch.snapshot.json").is_file());
        assert!(!profile.join("launch.snapshot.json").exists());
        browser.launched_configs.lock().unwrap().clear();
        assert_eq!(
            browser.read_launched_config(&scope, "slot_a"),
            Some(snap_base)
        );
        browser.clear_launched_config(&scope, "slot_a");
        assert!(!scope.join("launch.snapshot.json").exists());
    }

    #[test]
    fn benchmark_m1_before_vs_after_offline_bottlenecks() {
        use std::io::{BufRead, BufReader, Write};
        use std::sync::{Arc, Barrier};
        use std::time::{Duration, Instant};

        let f = Fixture::new();
        let root = f.0.join("browser");
        let vault = f.0.join("identity-vault");
        let home = f.0.join("synthetic-cli");
        let profile_dir = root.join("contexts/bench/profile");
        std::fs::create_dir_all(profile_dir.join("Default")).unwrap();
        crate::identities::private::directory(&home).unwrap();
        crate::identities::private::directory(&vault).unwrap();

        // 1. .claude.json 9x full read+parse vs 1x cache miss (2 reads) + 1x hit (0 reads) + 1x uncached revalidate (2 reads) = 4 reads
        let db = f.db();
        let key = [23u8; 32];
        crate::identities::private::write(&vault.join("key.bin"), &key).unwrap();
        let mut big_obj = serde_json::json!({
            "oauthAccount": {
                "accountUuid": "bench-acct",
                "emailAddress": "bench@example.invalid",
                "organizationUuid": "bench-org",
                "displayName": "Bench User"
            },
            "projects": {}
        });
        // Pad to ~6 MiB to mirror real-world large .claude.json session history
        let pad = "x".repeat(4096);
        for i in 0..1500 {
            big_obj["projects"][format!("/proj/{i}")] = serde_json::json!({ "history": pad });
        }
        let claude_bytes = serde_json::to_vec(&big_obj).unwrap();
        crate::identities::private::write(&home.join(".claude.json"), &claude_bytes).unwrap();
        let mut rec = record("bench-id");
        let payload = serde_json::to_vec(&("uuid", "bench-acct", "bench-org")).unwrap();
        rec.account_key = Some(
            ring::hmac::sign(
                &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &key),
                &payload,
            )
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
        );
        db.remember(&rec).unwrap();

        let t_before_claude = Instant::now();
        let claude_path = home.join(".claude.json");
        for _ in 0..3 {
            // Pre-M1 per-call cost: catalog::current_id (1) + prove_cli_at read (2) + second catalog::current_id (3)
            // repeated 3 times across materialize -> resolve -> revalidate = 9 reads + 6 catalog::current_id calls
            let id1 = crate::identities::catalog::current_id(&vault, &home, &db)
                .unwrap()
                .unwrap();
            let raw = std::fs::read(&claude_path).unwrap();
            let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap();
            let _ = crate::identities::profile::quota_identity(&parsed).unwrap();
            let id2 = crate::identities::catalog::current_id(&vault, &home, &db)
                .unwrap()
                .unwrap();
            assert_eq!(id1, id2);
        }
        let before_claude_ms = t_before_claude.elapsed().as_secs_f64() * 1000.0;

        let t_after_claude = Instant::now();
        let mut cache = super::super::lifecycle::CliProofCache::default();
        // materialize (cache miss: 2 reads) + resolve (cache hit: 0 reads) + revalidate (uncached TOCTOU check: 2 reads) = 4 reads vs 9 reads
        let _ = super::super::lifecycle::prove_cli_cached_at(&vault, &home, &db, 0, &mut cache)
            .unwrap();
        let _ = super::super::lifecycle::prove_cli_cached_at(&vault, &home, &db, 0, &mut cache)
            .unwrap();
        let _ = super::super::lifecycle::prove_cli_at(&vault, &home, &db).unwrap();
        let after_claude_ms = t_after_claude.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(cache.misses, 1);
        assert_eq!(cache.hits, 1);

        // 2. OS version probe: PowerShell cold spawn vs ntdll!RtlGetVersion
        #[cfg(target_os = "windows")]
        let (before_ver_ms, after_ver_ms) = {
            use std::os::windows::process::CommandExt;
            let t_ps = Instant::now();
            let ps_out = Command::new("powershell")
                .creation_flags(0x0800_0000)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "[System.Environment]::OSVersion.Version.ToString()",
                ])
                .output()
                .unwrap();
            let ps_ver = String::from_utf8_lossy(&ps_out.stdout).trim().to_string();
            let ps_ms = t_ps.elapsed().as_secs_f64() * 1000.0;

            let t_rtl = Instant::now();
            let rtl_ver = crate::windows::os_version_string();
            let rtl_ms = t_rtl.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(ps_ver, rtl_ver);
            assert!(rtl_ms < 50.0);
            (ps_ms, rtl_ms)
        };
        #[cfg(not(target_os = "windows"))]
        let (before_ver_ms, after_ver_ms) = (0.0f64, 0.0f64);

        // 3. Exit preflight: simulated pre-M1 (cold Thread + cold Tokio + hung URL1 first) vs post-M1 (1.1.1.1-like fast URL1 first + pooled client + cache hit)
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_srv = stop.clone();
        std::thread::spawn(move || {
            while !stop_srv.load(std::sync::atomic::Ordering::Relaxed) {
                if let Ok((mut stream, _)) = listener.accept() {
                    std::thread::spawn(move || {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                        let mut reader = BufReader::new(&stream);
                        let mut req_line = String::new();
                        if reader.read_line(&mut req_line).unwrap_or(0) == 0 {
                            return;
                        }
                        let mut hdr = String::new();
                        while reader.read_line(&mut hdr).unwrap_or(0) > 0 {
                            if hdr == "\r\n" {
                                break;
                            }
                            hdr.clear();
                        }
                        if req_line.contains("hung-dns") {
                            std::thread::sleep(Duration::from_millis(2000));
                            return;
                        }
                        let body = "ip=198.51.100.1\nloc=US\n";
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                    });
                }
            }
        });
        let proxy_url = format!("http://{addr}");
        let m = super::super::config::Machine {
            platform: "windows".into(),
            version: "10.0.22631.0".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en_US".into(),
            locale_country: "CN".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into()],
            system_proxy: String::new(),
        };
        let cfg = super::super::config::Config {
            seed: 555,
            proxy: proxy_url.clone(),
            ..super::super::config::Config::default()
        };

        // Simulate legacy preflight (cold thread + cold Tokio runtime + hung URL1 first)
        let t_before_exit = Instant::now();
        let legacy_res: Option<String> = std::thread::spawn({
            let proxy = proxy_url.clone();
            move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .ok()?;
                rt.block_on(async move {
                    let req_proxy = reqwest::Proxy::all(&proxy).ok()?;
                    let client = reqwest::Client::builder()
                        .no_proxy()
                        .proxy(req_proxy)
                        .timeout(Duration::from_millis(2000))
                        .build()
                        .ok()?;
                    let _ = client.get("http://hung-dns.invalid/cdn-cgi/trace").send().await;
                    let resp = client
                        .get("http://fast-ip.invalid/cdn-cgi/trace")
                        .send()
                        .await
                        .ok()?;
                    let bytes = resp.bytes().await.ok()?;
                    let text = std::str::from_utf8(&bytes).ok()?;
                    super::super::config::parse_trace_loc(text)
                })
            }
        })
        .join()
        .unwrap();
        let before_exit_ms = t_before_exit.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(legacy_res.as_deref(), Some("US"));

        let t_after_exit_miss = Instant::now();
        super::super::config::evaluate_browser_launch_policy_with_urls(
            &cfg,
            &m,
            true,
            false,
            &[
                "http://fast-ip.invalid/cdn-cgi/trace",
                "http://hung-dns.invalid/cdn-cgi/trace",
            ],
        )
        .unwrap();
        let after_exit_miss_ms = t_after_exit_miss.elapsed().as_secs_f64() * 1000.0;

        let t_after_exit_hit = Instant::now();
        super::super::config::evaluate_browser_launch_policy_with_urls(
            &cfg,
            &m,
            true,
            false,
            &[
                "http://fast-ip.invalid/cdn-cgi/trace",
                "http://hung-dns.invalid/cdn-cgi/trace",
            ],
        )
        .unwrap();
        let after_exit_hit_ms = t_after_exit_hit.elapsed().as_secs_f64() * 1000.0;
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = std::net::TcpStream::connect(addr);

        // 4. Preferences + Local State: 10x unconditional write_json (fsync) vs 10x dirty-write skip
        super::super::profile::preferences(&profile_dir, &cfg, &m).unwrap();
        let prefs_val: serde_json::Value =
            serde_json::from_slice(&std::fs::read(profile_dir.join("Default/Preferences")).unwrap())
                .unwrap();
        let ls_val: serde_json::Value =
            serde_json::from_slice(&std::fs::read(profile_dir.join("Local State")).unwrap())
                .unwrap();
        let t_before_prefs = Instant::now();
        for _ in 0..10 {
            super::super::profile::write_json(&profile_dir.join("Default/Preferences"), &prefs_val)
                .unwrap();
            super::super::profile::write_json(&profile_dir.join("Local State"), &ls_val).unwrap();
        }
        let before_prefs_ms = t_before_prefs.elapsed().as_secs_f64() * 1000.0;

        let t_after_prefs = Instant::now();
        for _ in 0..10 {
            super::super::profile::preferences(&profile_dir, &cfg, &m).unwrap();
        }
        let after_prefs_ms = t_after_prefs.elapsed().as_secs_f64() * 1000.0;

        // 5. Cleaner lock contention: real exclusive Mutex hold (120ms quota work) blocking 2 browser threads vs concurrent Cleaner shards
        let legacy_gate = Arc::new(std::sync::Mutex::new(()));
        let hold_ready_before = Arc::new(Barrier::new(2));
        let browsers_start_before = Arc::new(Barrier::new(3));
        let h_quota_before = std::thread::spawn({
            let gate = legacy_gate.clone();
            let ready = hold_ready_before.clone();
            move || {
                let _q_guard = gate.lock().unwrap();
                ready.wait();
                std::thread::sleep(Duration::from_millis(120));
            }
        });
        hold_ready_before.wait();
        let t_before_lock = Instant::now();
        let h_ba_before = std::thread::spawn({
            let gate = legacy_gate.clone();
            let start = browsers_start_before.clone();
            move || {
                start.wait();
                let _g = gate.lock().unwrap();
            }
        });
        let h_bb_before = std::thread::spawn({
            let gate = legacy_gate.clone();
            let start = browsers_start_before.clone();
            move || {
                start.wait();
                let _g = gate.lock().unwrap();
            }
        });
        browsers_start_before.wait();
        h_ba_before.join().unwrap();
        h_bb_before.join().unwrap();
        let before_lock_ms = t_before_lock.elapsed().as_secs_f64() * 1000.0;
        h_quota_before.join().unwrap();

        let cleaner = Arc::new(crate::cleaner::Cleaner::default());
        let hold_ready_after = Arc::new(Barrier::new(2));
        let browsers_start_after = Arc::new(Barrier::new(3));
        let both_entered_after = Arc::new(Barrier::new(2));
        let h_quota_after = std::thread::spawn({
            let c = cleaner.clone();
            let ready = hold_ready_after.clone();
            move || {
                c.enter_quota().unwrap();
                ready.wait();
                std::thread::sleep(Duration::from_millis(120));
                c.leave();
            }
        });
        hold_ready_after.wait();
        let t_after_lock = Instant::now();
        let h_a = std::thread::spawn({
            let c = cleaner.clone();
            let start = browsers_start_after.clone();
            let both = both_entered_after.clone();
            move || {
                start.wait();
                let _g = c.enter_browser_account("acct_a").unwrap();
                both.wait();
            }
        });
        let h_b = std::thread::spawn({
            let c = cleaner.clone();
            let start = browsers_start_after.clone();
            let both = both_entered_after.clone();
            move || {
                start.wait();
                let _g = c.enter_browser_account("acct_b").unwrap();
                both.wait();
            }
        });
        browsers_start_after.wait();
        h_a.join().unwrap();
        h_b.join().unwrap();
        let after_lock_ms = t_after_lock.elapsed().as_secs_f64() * 1000.0;
        h_quota_after.join().unwrap();

        println!("\n=== M1 Offline Bottleneck Benchmark (Before vs After) ===");
        println!(
            "| Stage | Before (ms) | After (ms) | Notes |\n|---|---:|---:|---|\n| .claude.json proof (6 MiB) | {before_claude_ms:.2} | {after_claude_ms:.2} | 9x full parse vs 1x cache miss + 1x hit + 1x uncached revalidate (4 reads) |\n| Windows OS version | {before_ver_ms:.2} | {after_ver_ms:.2} | PowerShell cold spawn vs ntdll!RtlGetVersion |\n| Exit preflight | {before_exit_ms:.2} | {after_exit_miss_ms:.2} (miss) / {after_exit_hit_ms:.2} (hit) | Hung URL1 + cold Tokio vs fast URL1 + pooled client + cache |\n| Preferences+LocalState x10 | {before_prefs_ms:.2} | {after_prefs_ms:.2} | Unconditional fsync vs dirty-write skip |\n| Cleaner quota+browser lock | {before_lock_ms:.2} | {after_lock_ms:.2} | Exclusive Mutex blocked behind 120ms quota hold vs concurrent multi-account |"
        );

        assert!(after_claude_ms < before_claude_ms);
        assert!(after_exit_miss_ms < before_exit_ms);
        assert!(after_prefs_ms < before_prefs_ms);
        assert!(before_lock_ms >= 90.0);
        assert!(after_lock_ms < 50.0);
        assert!(after_lock_ms < before_lock_ms);
    }
}
