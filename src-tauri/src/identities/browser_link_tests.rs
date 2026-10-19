// [INPUT]: 临时 SQLite 目录、虚构身份 ID 与可注入的数据库拒绝。
// [OUTPUT]: 默认勾选、显式关闭保留、摘要脱敏与绑定不匹配、A/B 绑定复用、空资料轮换、稳定种子冲突、回滚/重开与旧目录迁移回归。
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
