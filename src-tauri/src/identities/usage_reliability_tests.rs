// [INPUT]: Temporary synthetic profiles, usage logs and ledgers; no real identity or native process access.
// [OUTPUT]: Evidence-backed login attribution, conserved scopes, frozen fallback, session migration and parent replay regressions.
// [POS]: Unit-only child of usage.
// [PROTOCOL]: Temporary data only; test cleanup never targets a user directory.
use super::*;

fn fixture(label: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "claude-local-usage-reliability-{label}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let vault = path.join("vault");
    let home = path.join("home");
    private::directory(&vault).unwrap();
    private::directory(&home.join(".claude/projects/project")).unwrap();
    private::write(&vault.join("key.bin"), &[37; 32]).unwrap();
    (path, vault, home)
}
fn login(home: &Path, name: &str) -> String {
    let value = serde_json::json!({"oauthAccount":{"accountUuid":name,"organizationUuid":"fixture-org","displayName":name,"emailAddress":format!("{name}@example.invalid")}});
    fs::write(home.join(".claude.json"), value.to_string()).unwrap();
    catalog::account_key(&value, &[37; 32]).unwrap()
}
fn event(key: &str, ts: u64, session: Option<&str>) -> Event {
    Event {
        event_key: key.into(),
        message_key: None,
        session_key: session.map(attribution::session_hash),
        session_start: None,
        ts,
        model: "sonnet".into(),
        effort: String::new(),
        counts: Counts {
            input: 2,
            output: 3,
            creation: 5,
            read: 7,
            reasoning: Some(1),
        },
        account: None,
        weak: false,
        sidechain: false,
    }
}
fn iso(ts: u64) -> String {
    DateTime::<Utc>::from_timestamp(ts as i64, 0)
        .unwrap()
        .to_rfc3339()
}
fn root(session: &str, ts: u64) -> String {
    serde_json::json!({"type":"user","sessionId":session,"parentUuid":null,"timestamp":iso(ts),"message":{"content":"synthetic"}}).to_string()
}
fn assistant(session: &str, ts: u64, message: &str, sidechain: bool, input: u64) -> String {
    serde_json::json!({"type":"assistant","sessionId":session,"timestamp":iso(ts),"requestId":format!("r-{message}"),"isSidechain":sidechain,"message":{"id":message,"model":"sonnet","usage":{"input_tokens":input,"output_tokens":3,"cache_creation_input_tokens":5,"cache_read_input_tokens":7}}}).to_string()
}

#[test]
fn unsaved_live_identity_registers_and_only_new_root_session_binds() {
    let (dir, vault, home) = fixture("unsaved");
    let clock = now().saturating_sub(100);
    let owner = login(&home, "new-account");
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    attribution::observe(&conn, &vault, &home, clock);
    let logs = format!(
        "{}\n{}\n{}\n{}\n",
        root("old-session", clock - 10),
        assistant("old-session", clock + 3, "old", false, 2),
        root("new-session", clock + 2),
        assistant("new-session", clock + 4, "new", false, 2)
    );
    fs::write(home.join(".claude/projects/project/session.jsonl"), logs).unwrap();
    drop(conn);
    let snap =
        read_at_with_timezone_now(&vault, &home, "all", None, 0, None, None, clock + 10).unwrap();
    assert!(
        !vault.join("identities.sqlite").exists(),
        "usage registration must not fabricate an archive catalog"
    );
    assert_eq!(snap.accounts.len(), 1);
    assert!(snap.accounts[0].current);
    assert_eq!(snap.accounts[0].totals.total_tokens, 17);
    assert_eq!(snap.unattributed.total_tokens, 17);
    assert_eq!(snap.totals.total_tokens, 34);
    assert_eq!(snap.totals.sessions, Some(2));
    assert_eq!(
        snap.activity.as_ref().map(|a| (a.sessions, a.active_days)),
        Some((2, 1))
    );
    assert_eq!(
        read_attribution_config(&vault).unwrap().unassigned_requests,
        1,
        "registered HMAC is known even before archiving"
    );
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    let assigned: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE account_key=?1",
            [owner],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(assigned, 1);
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn controlled_empty_receipt_allows_resumed_session_without_archiving() {
    let (dir, vault, home) = fixture("controlled");
    let clock = now() - 100;
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    conn.execute(
        "INSERT INTO meta VALUES('pending_empty_login',?1)",
        [clock.to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO live_windows(started_at,account_key) VALUES(?1,NULL)",
        [clock as i64],
    )
    .unwrap();
    let owner = login(&home, "direct-login");
    attribution::observe(&conn, &vault, &home, clock + 10);
    let mut events = HashMap::new();
    let mut resumed = event("resumed", clock + 5, Some("preexisting-session"));
    resumed.session_start = Some(clock - 1000);
    events.insert(resumed.event_key.clone(), resumed);
    events.insert(
        "before-empty".into(),
        event("before-empty", clock - 1, Some("preexisting-session")),
    );
    events.insert("no-session".into(), event("no-session", clock + 6, None));
    persist_scan(&conn, events, &[], &[]).unwrap();
    let known: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE account_key=?1",
            [owner],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(known, 1);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM meta WHERE key='pending_empty_login'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn external_change_does_not_take_over_old_sessions_and_upsert_preserves_owner() {
    let (dir, vault, home) = fixture("external");
    let clock = now() - 100;
    let owner = login(&home, "alpha");
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    attribution::observe(&conn, &vault, &home, clock);
    let mut first = event("existing", clock + 2, None);
    first.session_start = Some(clock + 1);
    persist_scan(
        &conn,
        HashMap::from([("existing".into(), first.clone())]),
        &[(1, Some(owner.clone()))],
        &[],
    )
    .unwrap();
    login(&home, "beta");
    attribution::observe(&conn, &vault, &home, clock + 3);
    first.session_key = Some(attribution::session_hash("old"));
    let mut old = event("continued", clock + 5, Some("old"));
    old.session_start = Some(clock - 5);
    persist_scan(
        &conn,
        HashMap::from([("existing".into(), first), ("continued".into(), old)]),
        &[],
        &[],
    )
    .unwrap();
    let original: (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT account_key,session_key FROM events WHERE event_key='existing'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(original.0, Some(owner));
    assert!(original.1.is_some());
    assert_eq!(
        conn.query_row(
            "SELECT account_key FROM events WHERE event_key='continued'",
            [],
            |r| r.get::<_, Option<String>>(0)
        )
        .unwrap(),
        None
    );
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unknown_and_deleted_owners_conserve_all_four_token_components() {
    let (dir, vault, home) = fixture("conserve");
    let clock = now() - 100;
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    let unknown = event("unknown", clock, Some("s1"));
    let deleted = event("deleted", clock + 2, Some("s2"));
    persist_scan(
        &conn,
        HashMap::from([("unknown".into(), unknown), ("deleted".into(), deleted)]),
        &[(clock + 1, Some("removed-account".into()))],
        &[],
    )
    .unwrap();
    drop(conn);
    let all = read_at(&vault, &home, "all", None, 0).unwrap();
    let unknown = read_at(&vault, &home, "all", Some("unattributed"), 0).unwrap();
    assert_eq!(
        (
            all.totals.input_tokens,
            all.totals.output_tokens,
            all.totals.cache_creation_tokens,
            all.totals.cache_read_tokens
        ),
        (4, 6, 10, 14)
    );
    assert_eq!(all.totals.total_tokens, 34);
    assert_eq!(unknown.totals.total_tokens, 34);
    assert_eq!(all.unattributed.total_tokens, 34);
    assert_eq!(
        all.daily.iter().map(|d| d.totals.total_tokens).sum::<u64>(),
        34
    );
    assert_eq!(
        all.models
            .iter()
            .map(|m| m.totals.total_tokens)
            .sum::<u64>(),
        34
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn parent_wins_same_strong_key_in_both_file_read_orders() {
    for side_first in [false, true] {
        let (dir, _vault, home) = fixture("parent");
        let clock = now() - 100;
        let side = home.join(".claude/projects/project/side.jsonl");
        let parent = home.join(".claude/projects/project/parent.jsonl");
        fs::write(
            &side,
            format!("{}\n", assistant("s", clock, "same", true, 999)),
        )
        .unwrap();
        fs::write(
            &parent,
            format!("{}\n", assistant("s", clock, "same", false, 2)),
        )
        .unwrap();
        let mut events = HashMap::new();
        for path in if side_first {
            [&side, &parent]
        } else {
            [&parent, &side]
        } {
            parse_file(path, "synthetic", &mut events, &mut Vec::new()).unwrap();
        }
        assert_eq!(events.len(), 1);
        let row = events.into_values().next().unwrap();
        assert!(!row.sidechain);
        assert_eq!(row.counts.input, 2);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn old_parser_cursor_replays_session_evidence_without_reassigning_history() {
    let (dir, vault, home) = fixture("replay");
    let clock = now() - 100;
    fs::write(
        home.join(".claude/projects/project/s.jsonl"),
        format!("{}\n", assistant("s", clock, "m", false, 2)),
    )
    .unwrap();
    read_at(&vault, &home, "all", None, 0).unwrap();
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    conn.execute(
        "UPDATE events SET session_key=NULL,account_key='historical-owner'",
        [],
    )
    .unwrap();
    conn.execute("UPDATE files SET parser_version=1", [])
        .unwrap();
    drop(conn);
    let snap = read_at(&vault, &home, "all", None, 0).unwrap();
    assert_eq!(snap.totals.sessions, Some(1));
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    assert_eq!(
        conn.query_row("SELECT account_key FROM events", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "historical-owner"
    );
    assert_eq!(
        conn.query_row("SELECT parser_version FROM files", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        USAGE_PARSER_VERSION
    );
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn legacy_fallback_freezes_history_and_repeated_boundary_commit_is_idempotent() {
    let (dir, vault, home) = fixture("legacy-cutoff");
    let owner = login(&home, "alpha");
    let id = "1234567890abcdef1234567890abcdef";
    let clock = now() - 100;
    let db = Connection::open(vault.join("identities.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE identities(id TEXT PRIMARY KEY,name TEXT,empty INTEGER,account_key TEXT,saved_at INTEGER); CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE identity_summaries(id TEXT PRIMARY KEY,summary TEXT);").unwrap();
    db.execute(
        "INSERT INTO identities VALUES(?1,'Alpha',0,?2,1)",
        params![id, owner],
    )
    .unwrap();
    db.execute("INSERT INTO state VALUES('active',?1)", [id])
        .unwrap();
    db.execute(
        "INSERT INTO state VALUES('active_since',?1)",
        [clock.to_string()],
    )
    .unwrap();
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    persist_scan(
        &conn,
        HashMap::from([("old".into(), event("old", clock, None))]),
        &[],
        &[],
    )
    .unwrap();
    conn.execute("INSERT INTO meta VALUES('fallback_account_id',?1)", [id])
        .unwrap();
    drop(conn);
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    assert_eq!(
        attribution::fallback_before(&conn, false).unwrap(),
        Some(clock)
    );
    persist_scan(
        &conn,
        HashMap::from([("new".into(), event("new", clock + 10, None))]),
        &[],
        &[],
    )
    .unwrap();
    drop(conn);
    let snap = read_at(&vault, &home, "all", None, 0).unwrap();
    assert_eq!(snap.totals.total_tokens, 34);
    assert_eq!(snap.unattributed.total_tokens, 17);
    assert_eq!(snap.accounts[0].totals.total_tokens, 17);
    commit_switch_boundary(&vault, &home, Some(&owner));
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM boundaries", [], |r| r.get(0))
        .unwrap();
    drop(conn);
    commit_switch_boundary(&vault, &home, Some(&owner));
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM boundaries", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    assert_eq!(
        attribution::fallback_before(&conn, false).unwrap(),
        Some(clock)
    );
    drop(conn);
    drop(db);
    fs::remove_dir_all(dir).unwrap();
}
