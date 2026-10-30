// [INPUT]: 临时应用数据目录、虚构浏览器资料与身份绑定配置。
// [OUTPUT]: 临时 Cookie/缓存/种子隔离、真实养号保留/转正/恢复编排决策、删除前空槽位脱离及路径逃逸拒绝回归。
// [POS]: 浏览器存储边界的离线证明，不启动真实用户的浏览器或访问钥匙串。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
#[test]
fn linked_profiles_keep_separate_data_and_configs_without_compressing_or_copying() {
    let fixture = tests::sample();
    let root = fixture.join("browser");
    crate::identities::private::directory(&root).unwrap();
    let legacy = root.join("profile/Default");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join("Bookmarks"), b"old").unwrap();
    let mut db = workspaces::database(&root).unwrap();
    let a = crate::identities::new_id().unwrap();
    let b = crate::identities::new_id().unwrap();
    db.configure_browser(true, false, Some(&a)).unwrap();
    let scope_a = workspaces::ensure(&root).unwrap();
    assert_eq!(
        config::load(&scope_a).unwrap().seed,
        crate::identities::browser_link::seed(&a, 0)
    );
    let data_a = scope_a.join("profile/Default");
    fs::create_dir_all(&data_a).unwrap();
    fs::write(data_a.join("Cookies"), b"A").unwrap();
    let mut config_a = config::load(&scope_a).unwrap();
    config_a.seed = 12345;
    config::save(&scope_a, &config_a).unwrap();
    db.configure_browser(true, false, Some(&b)).unwrap();
    let scope_b = workspaces::ensure(&root).unwrap();
    assert_ne!(scope_a, scope_b);
    let data_b = scope_b.join("profile/Default");
    assert!(!data_b.exists());
    fs::create_dir_all(data_b.join("Cache")).unwrap();
    fs::write(data_b.join("Cookies"), b"B").unwrap();
    fs::write(data_b.join("Cache/data"), b"cache").unwrap();
    profile::clear(&scope_b.join("profile"), false, |_, _| {}).unwrap();
    assert_eq!(fs::read(data_a.join("Cookies")).unwrap(), b"A");
    assert_eq!(fs::read(data_b.join("Cookies")).unwrap(), b"B");
    db.configure_browser(true, false, Some(&a)).unwrap();
    assert_eq!(workspaces::ensure(&root).unwrap(), scope_a);
    assert_eq!(config::load(&scope_a).unwrap().seed, 12345);
    db.configure_browser(false, false, None).unwrap();
    assert_eq!(workspaces::scope(&root).unwrap(), root);
    assert_eq!(fs::read(legacy.join("Bookmarks")).unwrap(), b"old");
    for bad in ["../escape", "/tmp", "", "Default", "AABB"] {
        assert!(workspaces::slot_path(&root, bad).is_err());
    }
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}
#[test]
fn recovery_refuses_profile_launch_preparation() {
    let fixture = tests::sample();
    let root = fixture.join("browser");
    let db = workspaces::database(&root).unwrap();
    drop(db);
    let connection =
        rusqlite::Connection::open(fixture.join("identity-vault/identities.sqlite")).unwrap();
    connection
        .execute(
            "INSERT INTO state VALUES('recovery',?1)",
            [crate::identities::new_id().unwrap()],
        )
        .unwrap();
    assert!(workspaces::ensure(&root).unwrap_err().contains("恢复"));
    drop(connection);
    fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn warming_workspace_selection_preserves_cli_files_and_per_slot_cookie_config() {
    let fixture = tests::sample();
    let root = fixture.join("browser");
    let mut db = workspaces::database(&root).unwrap();
    let cli = fixture.join("synthetic-cli");
    crate::identities::private::directory(&cli).unwrap();
    crate::identities::private::write(&cli.join(".claude.json"), b"synthetic CLI bytes").unwrap();
    let a = db
        .bind_warming(&crate::identities::new_id().unwrap())
        .unwrap();
    let b = db
        .bind_warming(&crate::identities::new_id().unwrap())
        .unwrap();
    let active = db.get("active").unwrap();
    db.switch_browser_slot_only(&a.0).unwrap();
    let scope_a = workspaces::ensure(&root).unwrap();
    fs::write(scope_a.join("profile/Cookies"), b"synthetic A cookie").unwrap();
    let mut cfg = config::load(&scope_a).unwrap();
    cfg.follow_machine = false;
    cfg.timezone = "America/New_York".into();
    config::save(&scope_a, &cfg).unwrap();
    db.switch_browser_slot_only(&b.0).unwrap();
    let scope_b = workspaces::ensure(&root).unwrap();
    assert_ne!(scope_a, scope_b);
    assert!(!scope_b.join("profile/Cookies").exists());
    assert_eq!(config::load(&scope_b).unwrap().seed, b.1);
    db.switch_browser_slot_only(&a.0).unwrap();
    assert_eq!(workspaces::ensure(&root).unwrap(), scope_a);
    assert_eq!(config::load(&scope_a).unwrap().seed, a.1);
    assert_eq!(config::load(&scope_a).unwrap().timezone, "America/New_York");
    assert_eq!(
        fs::read(scope_a.join("profile/Cookies")).unwrap(),
        b"synthetic A cookie"
    );
    assert_eq!(
        fs::read(cli.join(".claude.json")).unwrap(),
        b"synthetic CLI bytes"
    );
    assert_eq!(db.get("active").unwrap(), active);
    let detached = workspaces::fresh_browser_slot(&root, &db).unwrap();
    assert!(crate::identities::valid_id(&detached));
    assert_ne!(detached, a.0);
    assert_ne!(detached, b.0);
    assert!(db.browser_seed(&detached).unwrap().is_none());
    assert!(!workspaces::slot_path(&root, &detached).unwrap().exists());
    db.switch_browser_slot_only(&detached).unwrap();
    let blank_scope = workspaces::ensure(&root).unwrap();
    assert!(!blank_scope.join("profile/Cookies").exists());
    assert_eq!(
        fs::read(scope_a.join("profile/Cookies")).unwrap(),
        b"synthetic A cookie"
    );
    assert_eq!(config::load(&scope_a).unwrap().seed, a.1);
    assert_eq!(db.get("active").unwrap(), active);
    assert_eq!(
        fs::read(cli.join(".claude.json")).unwrap(),
        b"synthetic CLI bytes"
    );
    for mode in ["claude_ai", "verify", "switch_only"] {
        workspaces::validate_warming_open_mode(mode).unwrap();
    }
    for mode in ["", "https://example.invalid", "arbitrary"] {
        assert!(workspaces::validate_warming_open_mode(mode).is_err());
    }
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn cli_transition_preserves_only_verified_warming_and_coordinates_promotion_or_recovery() {
    use workspaces::TransitionMode::{Coordinate, PreserveWarming, Unlinked};
    let fixture = tests::sample();
    let root = fixture.join("browser");
    let vault = fixture.join("identity-vault");
    let mut db = workspaces::database(&root).unwrap();
    let mode = |db: &crate::identities::database::Database, force| {
        workspaces::transition_mode(db, force).unwrap()
    };
    assert_eq!(
        mode(&db, false),
        Coordinate,
        "an empty draft is not warming"
    );
    let id = crate::identities::new_id().unwrap();
    let (slot, _) = db.bind_warming(&id).unwrap();
    db.switch_browser_slot_only(&slot).unwrap();
    assert_eq!(
        mode(&db, false),
        Coordinate,
        "a binding alone is not a card"
    );
    crate::identities::private::write(
        &vault.join("warming_cards.json"),
        &serde_json::to_vec(&serde_json::json!({
            "version": 1, "cards": [{ "id": id, "name": "Synthetic warming", "email": null, "note": null,
            "stage": "pro_ready", "created_ymd": "2026-10-01", "last_warmed_ymd": null, "created_at": 1, "updated_at": 1 }]
        })).unwrap(),
    ).unwrap();
    let selected = workspaces::ensure(&root).unwrap();
    fs::write(selected.join("profile/Cookies"), b"synthetic browser state").unwrap();
    assert_eq!(mode(&db, false), PreserveWarming);
    assert_eq!(
        mode(&db, true),
        Coordinate,
        "explicit promotion/configuration must close the browser"
    );
    db.prepare_warming_promotion(&id, &slot).unwrap();
    assert_eq!(
        mode(&db, false),
        Coordinate,
        "a pending promotion owns the browser"
    );
    db.rollback_warming_promotion(&id).unwrap();
    assert_eq!(mode(&db, false), PreserveWarming);
    let cli = crate::identities::database::Record {
        id: crate::identities::new_id().unwrap(),
        name: "Synthetic CLI".into(),
        archive: "synthetic.baga".into(),
        saved_at: 1,
        bytes: 1,
        policy: crate::identities::Policy::default(),
        empty: false,
        account_key: None,
    };
    db.pending(&cli, "empty").unwrap();
    assert_eq!(
        mode(&db, false),
        Coordinate,
        "recovery never bypasses blocking/quit"
    );
    assert!(workspaces::ensure(&root).is_err());
    db.complete(&cli.id).unwrap();
    assert_eq!(mode(&db, false), PreserveWarming);
    assert_eq!(
        fs::read(selected.join("profile/Cookies")).unwrap(),
        b"synthetic browser state"
    );
    db.configure_browser(false, false, None).unwrap();
    assert_eq!(mode(&db, false), Unlinked);
    assert_eq!(mode(&db, true), Coordinate);
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}
