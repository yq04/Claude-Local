// [INPUT]: Synthetic private vault, account config, existing profile markers and injected runtime observations.
// [OUTPUT]: CLI proof/fingerprint/seed refusal, exact-slot rollback and no CLI/cookie/preference mutation regressions.
// [POS]: Offline lifecycle tests; never open browsers, inspect live identities or stop any real process.
// [PROTOCOL]: Update header on change and check CLAUDE.md.
use super::*;
use crate::identities::{database::Record, Policy};

const FP: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn record(name: &str) -> Record {
    Record {
        id: crate::identities::new_id().unwrap(),
        name: name.into(),
        archive: "synthetic.baga".into(),
        saved_at: 1,
        bytes: 1,
        policy: Policy::default(),
        empty: false,
        account_key: None,
    }
}

#[test]
fn runtime_sampling_preserves_unknown_and_distinguishes_background_from_window() {
    let stopped = runtime_result("legacy".into(), Ok((false, Some(false))));
    assert_eq!(
        (stopped.running, stopped.window_open),
        (Some(false), Some(false))
    );
    let hidden = runtime_result("legacy".into(), Ok((true, Some(false))));
    assert_eq!(
        (hidden.running, hidden.window_open),
        (Some(true), Some(false))
    );
    let unknown = runtime_result("legacy".into(), Err("synthetic error".into()));
    assert_eq!((unknown.running, unknown.window_open), (None, None));
    let other_platform = runtime_result("legacy".into(), Ok((true, None)));
    assert_eq!(
        (other_platform.running, other_platform.window_open),
        (Some(true), None)
    );
}

#[test]
fn return_target_requires_proven_cli_and_exact_existing_seed_and_binding() {
    let fixture = super::super::tests::sample();
    let root = fixture.join("browser");
    let mut db = workspaces::database(&root).unwrap();
    let cli = record("Synthetic CLI");
    db.remember(&cli).unwrap();
    db.configure_browser(true, false, Some(&cli.id)).unwrap();
    let cli_slot = db.browser_for(&cli.id).unwrap().unwrap();
    assert!(
        resolve_cli_target(&root, &db, Some((&cli.id, FP)), FP).is_err(),
        "missing profiles are not created"
    );
    let cli_scope = workspaces::ensure(&root).unwrap();
    private::write(&cli_scope.join("profile/Cookies"), b"synthetic CLI cookie").unwrap();
    let original_config = fs::read(cli_scope.join("config.json")).unwrap();
    let seed = db.browser_seed(&cli_slot).unwrap();
    let warming = crate::identities::new_id().unwrap();
    let (warming_slot, warming_seed) = db.bind_warming(&warming).unwrap();
    db.switch_browser_slot_only(&warming_slot).unwrap();
    let warming_scope = workspaces::ensure(&root).unwrap();
    private::write(
        &warming_scope.join("profile/Cookies"),
        b"synthetic warming cookie",
    )
    .unwrap();
    let cli_pointer = db.get("active").unwrap();
    let enabled = db.get("browser.enabled").unwrap();
    assert!(
        resolve_cli_target(&root, &db, None, FP).is_err(),
        "db.active alone is not proof"
    );
    assert!(
        resolve_cli_target(&root, &db, Some((&warming, FP)), FP).is_err(),
        "warming IDs are never CLI targets"
    );
    assert!(resolve_cli_target(&root, &db, Some((&cli.id, FP)), "").is_err());
    assert!(resolve_cli_target(&root, &db, Some((&cli.id, FP)), &"f".repeat(64)).is_err());
    let target = resolve_cli_target(&root, &db, Some((&cli.id, FP)), FP).unwrap();
    assert_eq!(target.bound.slot, cli_slot);
    assert_eq!(
        workspaces::selected_slot_readonly(&root).unwrap(),
        warming_slot
    );

    // Exercise the production select+rollback helpers with synthetic launch
    // failure, including preserved CLI pointer, seeds, cookies and preferences.
    private::write(&root.join("launch.args"), b"synthetic original args\n").unwrap();
    workspaces::select_existing_slot(&root, &warming_slot, &cli_slot).unwrap();
    private::write(&root.join("launch.args"), b"synthetic failed launch args\n").unwrap();
    rollback_selection(&root, &warming_slot, &cli_slot).unwrap();
    restore_launch_args(&root, Some(b"synthetic original args\n")).unwrap();
    assert_eq!(db.browser_slot().unwrap(), warming_slot);
    assert_eq!(db.get("active").unwrap(), cli_pointer);
    assert_eq!(db.get("browser.enabled").unwrap(), enabled);
    assert_eq!(db.browser_seed(&cli_slot).unwrap(), seed);
    assert_eq!(db.browser_seed(&warming_slot).unwrap(), Some(warming_seed));
    assert_eq!(
        fs::read(cli_scope.join("config.json")).unwrap(),
        original_config
    );
    assert_eq!(
        fs::read(cli_scope.join("profile/Cookies")).unwrap(),
        b"synthetic CLI cookie"
    );
    assert_eq!(
        fs::read(warming_scope.join("profile/Cookies")).unwrap(),
        b"synthetic warming cookie"
    );
    assert_eq!(
        fs::read(root.join("launch.args")).unwrap(),
        b"synthetic original args\n"
    );
    assert!(
        rollback_selection(&root, &warming_slot, &cli_slot).is_err(),
        "stale rollback cannot replace a later selection"
    );

    private::write(&cli_scope.join("seed.owner"), b"1").unwrap();
    assert!(resolve_cli_target(&root, &db, Some((&cli.id, FP)), FP).is_err());
    private::write(
        &cli_scope.join("seed.owner"),
        target.seed.to_string().as_bytes(),
    )
    .unwrap();
    let mut wrong_config = config::load(&cli_scope).unwrap();
    wrong_config.seed = target.seed.wrapping_add(1);
    config::save(&cli_scope, &wrong_config).unwrap();
    assert!(resolve_cli_target(&root, &db, Some((&cli.id, FP)), FP).is_err());
    config::save(
        &cli_scope,
        &serde_json::from_slice(&original_config).unwrap(),
    )
    .unwrap();

    // Recovery and promotion are refused before any slot writes.
    let raw = rusqlite::Connection::open(fixture.join("identity-vault/identities.sqlite")).unwrap();
    for marker in ["recovery", "browser.promotion"] {
        raw.execute(
            "INSERT INTO state(key,value) VALUES(?1,'synthetic')",
            [marker],
        )
        .unwrap();
        assert!(resolve_cli_target(&root, &db, Some((&cli.id, FP)), FP).is_err());
        assert!(workspaces::select_existing_slot(&root, &warming_slot, &cli_slot).is_err());
        raw.execute("DELETE FROM state WHERE key=?1", [marker])
            .unwrap();
    }
    drop(raw);
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn live_cli_proof_follows_hmac_account_instead_of_stale_active_pointer() {
    let fixture = super::super::tests::sample();
    let root = fixture.join("browser");
    let vault = fixture.join("identity-vault");
    let home = fixture.join("synthetic-cli");
    private::directory(&home).unwrap();
    let mut db = workspaces::database(&root).unwrap();
    let key = [17u8; 32];
    private::write(&vault.join("key.bin"), &key).unwrap();
    let value = serde_json::json!({"oauthAccount": {
        "accountUuid": "synthetic-account", "emailAddress": "synthetic@example.invalid",
        "organizationUuid": "synthetic-org", "displayName": "Synthetic CLI"
    }});
    private::write(
        &home.join(".claude.json"),
        &serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let mut live = record("Synthetic current");
    let payload = serde_json::to_vec(&("uuid", "synthetic-account", "synthetic-org")).unwrap();
    live.account_key = Some(
        ring::hmac::sign(
            &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &key),
            &payload,
        )
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect(),
    );
    let stale = record("Synthetic stale pointer");
    db.remember(&live).unwrap();
    db.remember(&stale).unwrap();
    db.complete(&stale.id).unwrap();
    let pointer = db.get("active").unwrap();
    let proof = prove_cli_at(&vault, &home, &db).unwrap();
    assert_eq!(proof.id, live.id);
    assert_eq!(
        Some(proof.fingerprint),
        crate::identities::profile::quota_identity(&value)
    );
    assert_eq!(db.get("active").unwrap(), pointer);
    private::write(
        &home.join(".claude.json"),
        b"{\"oauthAccount\":{\"accountUuid\":\"unknown\"}}",
    )
    .unwrap();
    assert!(prove_cli_at(&vault, &home, &db).is_err());
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}
