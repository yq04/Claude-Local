// [INPUT]: 身份保险库与临时文件系统样本。
// [OUTPUT]: SQLite 策略持久化、完整认证归档、原始历史恢复、持久恢复检查点与真实阶段/局部完成计数/回滚事件回归，不读取真实 Claude 凭据。
// [POS]: 身份管理的离线验证入口；平台真实登入需用户验收。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
#[cfg(windows)]
use dunce::canonicalize;
#[cfg(not(windows))]
use std::fs::canonicalize;
fn fixture_write(path: impl AsRef<std::path::Path>, bytes: impl AsRef<[u8]>) -> Result<(), String> {
    private::write(path.as_ref(), bytes.as_ref())?;
    assert_eq!(
        canonicalize(path.as_ref()).unwrap(),
        path.as_ref(),
        "fixture must use canonical paths"
    );
    Ok(())
}
#[test]
fn operation_progress_tracks_completed_sources_and_explicit_rollback() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-progress-{}", new_id().unwrap()));
    let home = folder.join("home");
    private::directory(&home.join(".claude/cache")).unwrap();
    fixture_write(home.join(".claude/cache/entry"), "fixture").unwrap();
    fixture_write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"accountUuid":"fixture-account"}}"#,
    )
    .unwrap();
    let raw_session = br#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"foreign-org"}}
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"preserve","signature":"foreign-signature"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"dangling"}]}}"#;
    private::directory(&home.join(".claude/projects/demo")).unwrap();
    fixture_write(
        home.join(".claude/projects/demo/sess-rollback.jsonl"),
        raw_session,
    )
    .unwrap();
    let mut store = store::Store::open(&folder.join("vault"), &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "Fixture", &Policy::default(), &reporter)
        .unwrap();
    let events = reporter
        .events()
        .into_iter()
        .map(|event| serde_json::to_value(event).unwrap())
        .collect::<Vec<_>>();
    let position = |stage: &str, status: &str| {
        events
            .iter()
            .position(|event| event["stage"] == stage && event["status"] == status)
            .unwrap()
    };
    assert!(position("compress", "running") < position("compress", "ok"));
    assert!(position("compress", "ok") < position("verify_archive", "running"));
    assert!(position("verify_archive", "running") < position("verify_archive", "ok"));
    assert!(position("verify_archive", "ok") < position("clear", "running"));
    assert!(position("clear", "ok") < position("commit", "ok"));
    assert!(position("commit", "ok") < position("verify", "ok"));
    let completed = events
        .iter()
        .find(|event| event["stage"] == "archive" && event["status"] == "ok")
        .unwrap();
    let total = completed["total"].as_u64().unwrap();
    assert!(total >= 2);
    assert_eq!(completed["current"].as_u64(), Some(total));
    let archived = events
        .iter()
        .filter(|event| {
            event["stage"] == "archive"
                && event["status"] == "running"
                && event["current"].as_u64().unwrap_or(0) > 0
        })
        .map(|event| event["current"].as_u64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(archived, (1..=total).collect::<Vec<_>>());
    let target = store
        .records()
        .into_iter()
        .find(|record| !record.empty)
        .unwrap()
        .id;
    store.fail_after_clear = true;
    let failed = Reporter::channel(None);
    assert!(store
        .switch(&target, "Empty", &Policy::default(), &failed)
        .is_err());
    let events = failed.events();
    assert!(events
        .iter()
        .any(|event| event.stage() == "rollback" && event.status() == "running"));
    assert!(events
        .iter()
        .any(|event| event.stage() == "rollback" && event.status() == "ok"));
    assert!(!events
        .iter()
        .any(|event| event.stage() == "verify" && event.status() == "ok"));
    assert_eq!(
        std::fs::read(home.join(".claude/projects/demo/sess-rollback.jsonl")).unwrap(),
        raw_session
    );
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn database_metadata_and_recovery_are_transactional() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let mut db = database::Database::open(&folder).unwrap();
    let record = database::Record {
        id: new_id().unwrap(),
        name: "工作".into(),
        archive: "fixture.baga".into(),
        saved_at: 1,
        bytes: 22,
        policy: Policy::default(),
        empty: false,
        account_key: None,
    };
    db.pending(&record, "empty").unwrap();
    assert_eq!(db.get("recovery").unwrap(), Some(record.id.clone()));
    let list = db.records().unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].policy.skills);
    assert!(list[0].policy.history);
    db.complete("empty").unwrap();
    assert_eq!(db.get("active").unwrap().as_deref(), Some("empty"));
    assert!(db.get("active_since").unwrap().is_some());
    assert!(db.get("recovery").unwrap().is_none());
    drop(db);
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn empty_identity_and_saved_identity_preserve_user_choices() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    private::directory(&home).unwrap();
    private::directory(&home.join(".claude/skills/personal")).unwrap();
    fixture_write(home.join(".claude/skills/personal/SKILL.md"), "keep").unwrap();
    fixture_write(home.join(".claude.json"),r#"{"oauthAccount":{"emailAddress":"fixture@example.invalid"},"mcpServers":{"private":"keep"},"projects":{"mine":true}}"#).unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"disposable fixture credential"}}"#,
    )
    .unwrap();
    let mut store = store::Store::open(&vault, &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "个人", &Policy::default(), &reporter)
        .unwrap();
    assert!(serde_json::from_slice::<serde_json::Value>(
        &std::fs::read(home.join(".claude/.credentials.json")).unwrap()
    )
    .unwrap()
    .get("claudeAiOauth")
    .is_none());
    assert!(home.join(".claude/skills/personal/SKILL.md").exists());
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude.json")).unwrap()).unwrap();
    assert!(value.get("oauthAccount").is_none());
    assert!(value.get("mcpServers").is_some());
    let records = store.records();
    let original = records.iter().find(|r| !r.empty).unwrap();
    let id = original.id.clone();
    let bytes = std::fs::read(vault.join(&original.archive)).unwrap();
    assert!(!bytes.windows(10).any(|s| s == b"disposable"));
    store
        .switch(&id, "空身份", &Policy::default(), &reporter)
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(home.join(".claude/.credentials.json")).unwrap()
        )
        .unwrap()["claudeAiOauth"]["accessToken"],
        "disposable fixture credential"
    );
    let mut choice = Policy::default();
    choice.skills = false;
    store
        .switch("empty", "包含技能", &choice, &reporter)
        .unwrap();
    assert!(!home.join(".claude/skills").exists());
    let with_skills = store.records().into_iter().find(|r| r.id == id).unwrap();
    store
        .switch(&with_skills.id, "空身份", &choice, &reporter)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(home.join(".claude/skills/personal/SKILL.md")).unwrap(),
        "keep"
    );
    store.fail_after_clear = true;
    assert!(store
        .switch("empty", "故障样本", &choice, &reporter)
        .is_err());
    assert!(home.join(".claude/.credentials.json").exists());
    assert!(home.join(".claude/skills/personal/SKILL.md").exists());
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn interrupted_switch_can_recover_and_preserves_pre_recovery_state() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    private::directory(&home.join(".claude")).unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"original fixture"}}"#,
    )
    .unwrap();
    fixture_write(
        home.join(".claude.json"),
        serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "fixture-account",
                "organizationUuid": "fixture-org"
            },
            "s1mAccessCache": {
                "fixture-org": {"eligible": true},
                "foreign-org": {"eligible": false}
            },
            "projects": {
                "D:/fixture": {
                    "lastSessionId": "sess-recovery",
                    "lastCost": 3.5,
                    "lastModelUsage": {"fixture-model": {"costUSD": 3.5}}
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let raw_session = br#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"foreign-org"}}
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"preserve","signature":"foreign-signature"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"dangling"}]}}"#;
    private::directory(&home.join(".claude/projects/demo")).unwrap();
    fixture_write(
        home.join(".claude/projects/demo/sess-recovery.jsonl"),
        raw_session,
    )
    .unwrap();
    let mut store = store::Store::open(&folder.join("vault"), &home).unwrap();
    let reporter = Reporter::channel(None);
    let mut policy = Policy::default();
    policy.history = false;
    let (saved, stage) = store.save("原身份", &policy, &reporter).unwrap();
    store.db.pending(&saved, "empty").unwrap();
    store
        .clear(&store::Store::selected(&stage, &policy), &reporter, "clear")
        .unwrap();
    fixture_write(
        home.join(".claude/history.jsonl"),
        "new work after interruption",
    )
    .unwrap();
    store.recover("恢复前状态", &reporter).unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(home.join(".claude/.credentials.json")).unwrap()
        )
        .unwrap()["claudeAiOauth"]["accessToken"],
        "original fixture"
    );
    assert!(store.records().iter().any(|r| r.name == "恢复前状态"));
    assert!(store.db.get("recovery").unwrap().is_none());
    assert_eq!(
        std::fs::read(home.join(".claude/projects/demo/sess-recovery.jsonl")).unwrap(),
        raw_session
    );
    let recovered_config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude.json")).unwrap()).unwrap();
    assert!(recovered_config["s1mAccessCache"]
        .get("fixture-org")
        .is_some());
    assert!(recovered_config["s1mAccessCache"]
        .get("foreign-org")
        .is_none());
    assert_eq!(
        recovered_config["projects"]["D:/fixture"]["lastSessionId"],
        "sess-recovery"
    );
    assert_eq!(recovered_config["projects"]["D:/fixture"]["lastCost"], 3.5);
    assert!(recovered_config["projects"]["D:/fixture"]
        .get("lastModelUsage")
        .is_some());
    drop(stage);
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn damaged_saved_archive_never_changes_live_identity() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    private::directory(&home.join(".claude")).unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"first"}}"#,
    )
    .unwrap();
    let mut store = store::Store::open(&vault, &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "first", &Policy::default(), &reporter)
        .unwrap();
    let original = store.records().into_iter().find(|r| !r.empty).unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"second"}}"#,
    )
    .unwrap();
    let path = vault.join(&original.archive);
    let mut bytes = std::fs::read(&path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    fixture_write(path, bytes).unwrap();
    assert!(store
        .switch(&original.id, "second", &Policy::default(), &reporter)
        .is_err());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(home.join(".claude/.credentials.json")).unwrap()
        )
        .unwrap()["claudeAiOauth"]["accessToken"],
        "second"
    );
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
#[cfg(unix)]
#[test]
fn selected_symlink_is_refused_without_changing_source() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    private::directory(&home.join(".claude")).unwrap();
    fixture_write(folder.join("outside"), "keep").unwrap();
    std::os::unix::fs::symlink(
        folder.join("outside"),
        home.join(".claude/.credentials.json"),
    )
    .unwrap();
    let mut store = store::Store::open(&folder.join("vault"), &home).unwrap();
    assert!(store
        .switch(
            "empty",
            "fixture",
            &Policy::default(),
            &Reporter::channel(None)
        )
        .is_err());
    assert_eq!(
        std::fs::read_to_string(folder.join("outside")).unwrap(),
        "keep"
    );
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn direct_delete_respects_kept_data_and_removes_only_selected_archive() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    private::directory(&home.join(".claude/skills/private")).unwrap();
    fixture_write(
        home.join(".claude/skills/private/SKILL.md"),
        "personal asset",
    )
    .unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"fixture"},"mcpOAuth":"shared"}"#,
    )
    .unwrap();
    let mut store = store::Store::open(&vault, &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "saved", &Policy::default(), &reporter)
        .unwrap();
    let saved = store.records().into_iter().find(|r| !r.empty).unwrap();
    store
        .switch(&saved.id, "empty", &Policy::default(), &reporter)
        .unwrap();
    let count = store.records().len();
    store
        .delete("current", &Policy::default(), &reporter)
        .unwrap();
    assert_eq!(count, store.records().len());
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude/.credentials.json")).unwrap())
            .unwrap();
    assert!(value.get("claudeAiOauth").is_none());
    assert_eq!(value["mcpOAuth"], "shared");
    assert!(home.join(".claude/skills/private/SKILL.md").exists());
    store
        .delete(&saved.id, &Policy::default(), &reporter)
        .unwrap();
    assert!(!vault.join(&saved.archive).exists());
    assert!(!store.records().iter().any(|r| r.id == saved.id));
    assert_eq!(
        std::fs::read_to_string(home.join(".claude/skills/private/SKILL.md")).unwrap(),
        "personal asset"
    );
    assert!(store
        .delete(&saved.id, &Policy::default(), &reporter)
        .is_err());
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn restoring_full_settings_preserves_newer_shared_settings_when_requested() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    private::directory(&home.join(".claude")).unwrap();
    fixture_write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"id":"first"},"theme":"old","mcpServers":{"private":"old"}}"#,
    )
    .unwrap();
    fixture_write(
        home.join(".claude/settings.json"),
        r#"{"theme":"old","env":{"ANTHROPIC_API_KEY":"first"}}"#,
    )
    .unwrap();
    let mut store = store::Store::open(&folder.join("vault"), &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "all", &Policy::all(), &reporter)
        .unwrap();
    let saved = store.records().into_iter().find(|r| !r.empty).unwrap();
    fixture_write(
        home.join(".claude.json"),
        r#"{"theme":"latest","mcpServers":{"private":"latest"}}"#,
    )
    .unwrap();
    fixture_write(
        home.join(".claude/settings.json"),
        r#"{"theme":"latest","env":{"OTHER":"keep"}}"#,
    )
    .unwrap();
    store
        .switch(&saved.id, "shared", &Policy::default(), &reporter)
        .unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(value["oauthAccount"]["id"], "first");
    assert_eq!(value["theme"], "latest");
    assert_eq!(value["mcpServers"]["private"], "latest");
    let settings: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(settings["theme"], "latest");
    assert_eq!(settings["env"]["OTHER"], "keep");
    assert_eq!(settings["env"]["ANTHROPIC_API_KEY"], "first");
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn missing_master_key_never_replaces_a_retired_registered_archive() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    private::directory(&home.join(".claude")).unwrap();
    fixture_write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"fixture"}}"#,
    )
    .unwrap();
    let mut store = store::Store::open(&vault, &home).unwrap();
    store
        .switch(
            "empty",
            "saved",
            &Policy::default(),
            &Reporter::channel(None),
        )
        .unwrap();
    let saved = store.records().into_iter().find(|r| !r.empty).unwrap();
    drop(store);
    let retired = vault.join(format!(".trash-{}", saved.id));
    std::fs::rename(vault.join(saved.archive), &retired).unwrap();
    std::fs::remove_file(vault.join("key.bin")).unwrap();
    assert!(store::Store::open(&vault, &home).is_err());
    assert!(!vault.join("key.bin").exists());
    assert!(retired.exists());
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn master_key_length_boundaries_preserve_existing_key_bytes() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-key-boundary-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    private::directory(&home).unwrap();
    private::directory(&vault).unwrap();
    let key_path = vault.join("key.bin");
    for length in [31, 32, 33] {
        let synthetic_key = vec![0xa5; length];
        private::write(&key_path, &synthetic_key).unwrap();
        let opened = store::Store::open(&vault, &home);
        assert_eq!(opened.is_ok(), length == 32);
        drop(opened);
        assert_eq!(std::fs::read(&key_path).unwrap(), synthetic_key);
    }
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn standard_fs_written_files_are_accepted_by_profile_catalog_and_switch() {
    let folder = canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("baga-identity-test-{}", new_id().unwrap()));
    let home = folder.join("home");
    let vault = folder.join("vault");
    std::fs::create_dir_all(home.join(".claude/projects/demo")).unwrap();
    std::fs::write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"accountUuid":"std-fs-user","organizationUuid":"std-org","emailAddress":"stdfs@example.invalid","displayName":"StdFsUser"},"mcpServers":{"keep":{}}}"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"std-fs-token"}}"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".claude/history.jsonl"),
        "{\"display\":\"hello\"}\n",
    )
    .unwrap();
    std::fs::write(
        home.join(".claude/projects/demo/session.jsonl"),
        "{\"session\":1}\n",
    )
    .unwrap();

    let current = profile::read(&home);
    assert!(current.present);
    assert!(!current.unavailable);
    assert_eq!(current.display_name.as_deref(), Some("StdFsUser"));
    assert_eq!(current.email.as_deref(), Some("stdfs@example.invalid"));

    let mut store = store::Store::open(&vault, &home).unwrap();
    let reporter = Reporter::channel(None);
    store
        .switch("empty", "默认写入身份", &Policy::default(), &reporter)
        .unwrap();
    let saved = store.records().into_iter().find(|r| !r.empty).unwrap();
    assert_eq!(saved.name, "默认写入身份");
    assert!(catalog::current_id(&vault, &home, &store.db)
        .unwrap()
        .is_none());

    store
        .switch(&saved.id, "空身份", &Policy::default(), &reporter)
        .unwrap();
    assert_eq!(
        catalog::current_id(&vault, &home, &store.db)
            .unwrap()
            .as_deref(),
        Some(saved.id.as_str())
    );
    let restored = profile::read(&home);
    assert!(restored.present);
    assert!(!restored.unavailable);
    assert_eq!(restored.display_name.as_deref(), Some("StdFsUser"));
    drop(store);
    std::fs::remove_dir_all(folder).unwrap();
}
