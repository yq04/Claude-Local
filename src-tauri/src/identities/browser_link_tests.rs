// [INPUT]: 临时 SQLite 目录、虚构身份 ID 与可注入的数据库拒绝。
// [OUTPUT]: 默认联动与脱敏、CLI事务/回滚保留养号选择与独占槽位、受控转正同 ID/种子及失败草稿清理回归。
// [POS]: 浏览器选择与身份事务同提交的证明，不读取真实账号或钥匙串。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
fn record(id: &str) -> database::Record {
    database::Record {
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
fn warming_card(vault: &std::path::Path, id: &str) {
    private::write(&vault.join("warming_cards.json"), &serde_json::to_vec(&serde_json::json!({
        "version": 1, "cards": [{ "id": id, "name": "Warming sample", "email": "warming@example.invalid", "note": null,
        "stage": "pro_ready", "created_ymd": "2026-10-01", "last_warmed_ymd": null, "created_at": 1, "updated_at": 1 }]
    })).unwrap()).unwrap();
}
struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        Self(
            std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("baga-binding-{}", new_id().unwrap())),
        )
    }
    fn db(&self) -> database::Database {
        database::Database::open(&self.0).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn browser_binding_switches_atomically_reuses_slots_and_restores_previous_selection() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    let b = record(&new_id().unwrap());
    db.remember(&a).unwrap();
    db.configure_browser(true, false, Some(&a.id)).unwrap();
    let slot_a = db.browser_slot().unwrap();
    assert_eq!(
        db.browser_seed(&slot_a).unwrap(),
        Some(browser_link::seed(&a.id, 0))
    );
    db.pending(&a, "empty").unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    db.complete("empty").unwrap();
    let draft = db.browser_slot().unwrap();
    assert_ne!(draft, slot_a);
    db.pending(&b, &a.id).unwrap();
    assert_eq!(
        db.browser_for(&b.id).unwrap().as_deref(),
        Some(draft.as_str())
    );
    db.complete(&a.id).unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    for _ in 0..4 {
        db.pending(&a, &b.id).unwrap();
        db.complete(&b.id).unwrap();
        assert_eq!(db.browser_slot().unwrap(), draft);
        db.pending(&b, &a.id).unwrap();
        db.complete(&a.id).unwrap();
        assert_eq!(db.browser_slot().unwrap(), slot_a);
    }
    assert_eq!(db.browser_link().unwrap().bound_ids.len(), 2);
    db.configure_browser(true, false, None).unwrap();
    db.complete(&a.id).unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    db.pending(&a, &b.id).unwrap();
    drop(db);
    let mut db = f.db();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    assert!(db.configure_browser(false, false, None).is_err());
    db.complete(&a.id).unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    db.configure_browser(false, false, None).unwrap();
    assert_eq!(db.browser_slot().unwrap(), "legacy");
    db.configure_browser(true, false, Some(&a.id)).unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot_a);
    db.complete("empty").unwrap();
    let blank = db.browser_slot().unwrap();
    assert_ne!(blank, slot_a);
    assert_ne!(blank, draft);
}
#[test]
fn rejected_binding_rolls_back_identity_and_recovery_and_seed_collisions_are_resolved() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    let b = record(&new_id().unwrap());
    db.configure_browser(true, false, None).unwrap();
    let original = db.browser_slot().unwrap();
    db.connection
        .execute(
            "INSERT INTO browser_bindings VALUES(?1,?2,?3)",
            rusqlite::params![
                new_id().unwrap(),
                new_id().unwrap(),
                browser_link::seed(&a.id, 0)
            ],
        )
        .unwrap();
    db.pending(&a, "empty").unwrap();
    let slot = db.browser_for(&a.id).unwrap().unwrap();
    assert_eq!(
        db.browser_seed(&slot).unwrap(),
        Some(browser_link::seed(&a.id, 1))
    );
    db.complete(&a.id).unwrap();
    db.connection.execute_batch("CREATE TRIGGER reject_binding BEFORE INSERT ON browser_bindings BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(db.pending(&b, &a.id).is_err());
    assert_eq!(db.browser_slot().unwrap(), original);
    assert!(db.get("recovery").unwrap().is_none());
    assert!(!db.records().unwrap().iter().any(|r| r.id == b.id));
}
#[test]
fn version_two_catalog_gains_browser_table_without_changing_existing_identity() {
    let f = Fixture::new();
    let db = f.db();
    let a = record(&new_id().unwrap());
    db.remember(&a).unwrap();
    let mut db = db;
    db.configure_browser(false, false, None).unwrap();
    db.connection
        .execute_batch("DROP TABLE browser_bindings; PRAGMA user_version=2;")
        .unwrap();
    drop(db);
    let db = f.db();
    assert_eq!(db.records().unwrap()[0].id, a.id);
    assert!(!db.browser_link().unwrap().enabled);
    assert_eq!(db.browser_slot().unwrap(), "legacy");
}
#[test]
fn merging_old_duplicate_cards_keeps_the_selected_browser_data() {
    let f = Fixture::new();
    let mut db = f.db();
    let mut old = record(&new_id().unwrap());
    let mut retained = record(&new_id().unwrap());
    old.account_key = Some("same-account".into());
    retained.account_key = old.account_key.clone();
    retained.saved_at = 2;
    db.remember(&old).unwrap();
    db.remember(&retained).unwrap();
    db.configure_browser(true, false, Some(&old.id)).unwrap();
    let selected = db.browser_slot().unwrap();
    db.compact().unwrap();
    assert_eq!(db.records().unwrap().len(), 1);
    assert_eq!(
        db.browser_for(&retained.id).unwrap().as_deref(),
        Some(selected.as_str())
    );
    assert_eq!(db.browser_slot().unwrap(), selected);
}

#[test]
fn new_catalog_defaults_to_linking_with_a_stable_reserved_first_identity_id() {
    let f = Fixture::new();
    let db = f.db();
    assert!(db.browser_link().unwrap().enabled);
    assert_eq!(db.browser_slot().unwrap(), "legacy");
    let draft = db.browser_draft().unwrap().unwrap();
    assert!(valid_id(&draft));
    drop(db);
    let mut db = f.db();
    assert_eq!(db.browser_draft().unwrap().as_deref(), Some(draft.as_str()));
    db.pending(&record(&draft), "empty").unwrap();
    assert_eq!(
        db.browser_seed("legacy").unwrap(),
        Some(browser_link::seed(&draft, 0))
    );
    db.complete("empty").unwrap();
    assert_ne!(db.browser_slot().unwrap(), "legacy");
}
#[test]
fn browser_card_uses_only_bound_display_fields_and_never_renames_old_browser_for_new_account() {
    let f = Fixture::new();
    let mut db = f.db();
    let home = f.0.join("home");
    private::directory(&home).unwrap();
    let key = [7u8; 32];
    private::write(&f.0.join("key.bin"), &key).unwrap();
    let account = serde_json::json!({"oauthAccount":{"accountUuid":"A","organizationUuid":"team","displayName":"Alice","emailAddress":"alice@example.invalid","organizationName":"Team","accessToken":"secret-token"},"primaryApiKey":"private-key"});
    private::write(
        &home.join(".claude.json"),
        &serde_json::to_vec(&account).unwrap(),
    )
    .unwrap();
    let mut a = record(&new_id().unwrap());
    a.name = "Saved Alice".into();
    a.account_key = catalog::account_key(&account, &key);
    db.remember(&a).unwrap();
    db.configure_browser(true, false, Some(&a.id)).unwrap();
    let snapshot = db.browser_identity(&f.0, &home).unwrap();
    assert_eq!(snapshot.status, "linked");
    assert_eq!(snapshot.email.as_deref(), Some("alice@example.invalid"));
    let serialized = serde_json::to_string(&snapshot).unwrap();
    for forbidden in [
        "secret-token",
        "private-key",
        "accountUuid",
        a.account_key.as_deref().unwrap(),
    ] {
        assert!(!serialized.contains(forbidden));
    }
    private::write(
        &home.join(".claude.json"),
        br#"{"oauthAccount":{"accountUuid":"B","emailAddress":"other@example.invalid"}}"#,
    )
    .unwrap();
    let snapshot = db.browser_identity(&f.0, &home).unwrap();
    assert_eq!(snapshot.status, "mismatch");
    assert_eq!(snapshot.name.as_deref(), Some("Saved Alice"));
    assert!(snapshot.email.is_none());
    private::write(&home.join(".claude.json"), b"{}").unwrap();
    db.configure_browser(true, false, None).unwrap();
    assert_eq!(db.browser_identity(&f.0, &home).unwrap().status, "empty");
    private::write(&home.join(".claude.json"), b"invalid-json").unwrap();
    assert_eq!(db.browser_identity(&f.0, &home).unwrap().status, "unknown");
    db.configure_browser(false, false, None).unwrap();
    let snapshot = db.browser_identity(&f.0, &home).unwrap();
    assert_eq!(snapshot.status, "unlinked");
    assert!(snapshot.name.is_none());
}

#[test]
fn warming_browser_only_selection_keeps_cli_state_and_has_independent_bound_seed() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    db.remember(&a).unwrap();
    db.complete(&a.id).unwrap();
    let active = db.get("active").unwrap();
    let since = db.get("active_since").unwrap();
    let cli_slot = db.browser_slot().unwrap();
    let w = new_id().unwrap();
    let (slot, seed) = db.bind_warming(&w).unwrap();
    assert_ne!(slot, cli_slot);
    assert_eq!(db.bind_warming(&w).unwrap(), (slot.clone(), seed));
    let other = db.bind_warming(&new_id().unwrap()).unwrap();
    assert_ne!(other.0, slot);
    assert_ne!(other.1, seed);
    db.switch_browser_slot_only(&slot).unwrap();
    assert_eq!(db.get("active").unwrap(), active);
    assert_eq!(db.get("active_since").unwrap(), since);
    assert_eq!(db.browser_slot().unwrap(), slot);
    assert_eq!(
        db.browser_for(&a.id).unwrap().as_deref(),
        Some(cli_slot.as_str())
    );
    assert_eq!(db.records().unwrap().len(), 1);
    assert!(db.browser_draft().unwrap().is_none());
    assert!(db.switch_browser_slot_only("../escape").is_err());
    assert!(db.remove_warming_binding(&w).is_err());
    db.switch_browser_slot_only(&cli_slot).unwrap();
    db.remove_warming_binding(&w).unwrap();
    assert!(db.browser_for(&w).unwrap().is_none());
    db.pending(&a, "empty").unwrap();
    assert!(db.switch_browser_slot_only(&other.0).is_err());
    assert!(db.bind_warming(&new_id().unwrap()).is_err());
}

#[test]
fn warming_promotion_requires_controlled_empty_and_keeps_id_slot_seed_across_reopen() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    db.remember(&a).unwrap();
    db.complete(&a.id).unwrap();
    let cli_slot = db.browser_slot().unwrap();
    let w = new_id().unwrap();
    warming_card(&f.0, &w);
    let (slot, seed) = db.bind_warming(&w).unwrap();
    db.prepare_warming_promotion(&w, &slot).unwrap();
    assert_eq!(db.get("active").unwrap().as_deref(), Some(a.id.as_str()));
    assert!(
        db.browser_draft().unwrap().is_none(),
        "outgoing Pro cannot reuse warming ID"
    );
    db.pending(&a, "empty").unwrap();
    assert!(db.browser_draft().unwrap().is_none());
    db.complete("empty").unwrap();
    assert_eq!(db.browser_slot().unwrap(), slot);
    assert_eq!(
        db.browser_for(&a.id).unwrap().as_deref(),
        Some(cli_slot.as_str())
    );
    drop(db);
    let mut db = f.db();
    assert_eq!(db.browser_draft().unwrap().as_deref(), Some(w.as_str()));
    let identity = db
        .browser_identity(&f.0, &f.0.join("unavailable-home"))
        .unwrap();
    assert_eq!(identity.status, "warming");
    assert_eq!(identity.name.as_deref(), Some("Warming sample"));
    assert_eq!(identity.email.as_deref(), Some("warming@example.invalid"));
    assert!(identity.cli_proxy.is_none());
    db.remember(&record(&w)).unwrap();
    db.complete(&w).unwrap();
    assert_eq!(db.browser_for(&w).unwrap().as_deref(), Some(slot.as_str()));
    assert_eq!(db.browser_seed(&slot).unwrap(), Some(seed));
    assert!(db.get("browser.promotion").unwrap().is_none());
    assert!(db.browser_draft().unwrap().is_none());
}

#[test]
fn warming_promotion_cancel_or_rollback_cannot_reuse_reserved_id() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    db.remember(&a).unwrap();
    db.complete(&a.id).unwrap();
    let original = db.browser_slot().unwrap();
    let w = new_id().unwrap();
    warming_card(&f.0, &w);
    let (slot, seed) = db.bind_warming(&w).unwrap();
    db.prepare_warming_promotion(&w, &slot).unwrap();
    db.rollback_warming_promotion(&w).unwrap();
    assert_eq!(db.browser_slot().unwrap(), original);
    assert!(db.get("browser.promotion").unwrap().is_none());
    db.prepare_warming_promotion(&w, &slot).unwrap();
    db.pending(&a, "empty").unwrap();
    db.complete(&a.id).unwrap();
    assert_eq!(db.browser_slot().unwrap(), original);
    assert!(db.browser_draft().unwrap().is_none());
    assert_eq!(db.browser_seed(&slot).unwrap(), Some(seed));
    db.prepare_warming_promotion(&w, &slot).unwrap();
    db.pending(&a, "empty").unwrap();
    db.complete("empty").unwrap();
    db.switch_browser_slot_only(&original).unwrap();
    assert!(db.get("browser.promotion").unwrap().is_none());
    assert!(db.browser_draft().unwrap().is_none());
}

#[test]
fn cli_database_transactions_keep_warming_selection_across_commit_reopen_rollback_and_delete() {
    let f = Fixture::new();
    let mut db = f.db();
    let a = record(&new_id().unwrap());
    let b = record(&new_id().unwrap());
    let w = new_id().unwrap();
    warming_card(&f.0, &w);
    let (slot, seed) = db.bind_warming(&w).unwrap();
    db.switch_browser_slot_only(&slot).unwrap();
    // Neither outgoing nor incoming CLI identity has an existing browser slot.
    db.remember(&a).unwrap();
    db.remember(&b).unwrap();
    db.pending(&a, &b.id).unwrap();
    let cli_a = db.browser_for(&a.id).unwrap().unwrap();
    let cli_b = db.browser_for(&b.id).unwrap().unwrap();
    assert_ne!(cli_a, slot);
    assert_ne!(cli_b, slot);
    assert_ne!(cli_a, cli_b);
    assert_eq!(db.get("browser.previous").unwrap(), Some(slot.clone()));
    assert_eq!(db.get("browser.next").unwrap(), Some(slot.clone()));
    drop(db);
    let mut db = f.db();
    assert!(db.get("recovery").unwrap().is_some());
    db.complete(&a.id).unwrap();
    assert_eq!(
        db.browser_slot().unwrap(),
        slot,
        "rollback preserves the selected warming card"
    );
    db.pending(&a, &b.id).unwrap();
    db.complete(&b.id).unwrap();
    assert_eq!(db.get("active").unwrap(), Some(b.id.clone()));
    assert_eq!(db.browser_slot().unwrap(), slot);
    db.complete(&b.id).unwrap();
    assert_eq!(
        db.browser_slot().unwrap(),
        slot,
        "same-account shortcut does not steal the browser"
    );
    db.complete("empty").unwrap();
    assert_eq!(
        db.browser_slot().unwrap(),
        slot,
        "direct current deletion preserves warming"
    );
    let c = record(&new_id().unwrap());
    db.remember(&c).unwrap();
    db.complete(&c.id).unwrap();
    assert_ne!(db.browser_for(&c.id).unwrap(), Some(slot.clone()));
    assert_eq!(
        db.browser_slot().unwrap(),
        slot,
        "saving a new CLI identity keeps warming"
    );
    db.forget(&b.id).unwrap();
    assert_eq!(db.browser_for(&w).unwrap(), Some(slot.clone()));
    assert_eq!(db.browser_seed(&slot).unwrap(), Some(seed));
    assert!(db.current_browser_is_warming().unwrap());
    assert!(db.get("recovery").unwrap().is_none());
    assert!(db.get("browser.previous").unwrap().is_none());
    assert!(db.get("browser.next").unwrap().is_none());
}
