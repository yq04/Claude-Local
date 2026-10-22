// [INPUT]: Synthetic usage fragments and isolated temporary files/SQLite ledgers.
// [OUTPUT]: Regressions for idempotency/ownership, cursors, named-timezone DST calendars, stable fallback attribution and token semantics.
// [POS]: Unit tests for identities::usage; never touches the user's Claude profile or identity vault.
// [PROTOCOL]: Keep all fixtures synthetic and scoped to temporary directories.
use super::usage::{self, Counts, Event};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_dir(label: &str) -> PathBuf {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("claude-local-usage-{label}-{id}"));
    super::private::directory(&path).unwrap();
    path
}
fn event(key: &str, ts: u64, counts: Counts) -> Event {
    Event {
        event_key: key.into(),
        message_key: None,
        ts,
        model: "sonnet".into(),
        counts,
        account: None,
        weak: false,
        sidechain: false,
    }
}

#[test]
fn stream_duplicates_merge_by_component_max_and_are_globally_idempotent() {
    let dir = temp_dir("dedup");
    let conn = usage::open_ledger(&dir.join("usage.sqlite")).unwrap();
    let first = Counts {
        input: 100,
        output: 20,
        creation: 30,
        read: 40,
        reasoning: Some(5),
    };
    let later = Counts {
        input: 100,
        output: 24,
        creation: 10,
        read: 42,
        reasoning: Some(7),
    };
    let mut events = HashMap::new();
    events.insert("stable-hash".into(), event("stable-hash", 100, first));
    usage::persist_scan(&conn, events, &[(1, Some("opaque-account".into()))], &[]).unwrap();
    let mut events = HashMap::new();
    events.insert("stable-hash".into(), event("stable-hash", 101, later));
    usage::persist_scan(&conn, events, &[(1, Some("opaque-account".into()))], &[]).unwrap();
    let mut replay = HashMap::new();
    replay.insert("stable-hash".into(), event("stable-hash", 101, later));
    usage::persist_scan(&conn, replay, &[(1, Some("opaque-account".into()))], &[]).unwrap();
    let row: (i64, i64, i64, i64, Option<i64>, i64) = conn
        .query_row(
            "SELECT input,output,creation,cache_read,reasoning,COUNT(*) FROM events",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(row, (100, 24, 30, 42, Some(7), 1));
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn missing_identity_window_stays_unattributed_even_after_a_later_boundary() {
    let dir = temp_dir("window");
    let conn = usage::open_ledger(&dir.join("usage.sqlite")).unwrap();
    let counts = Counts {
        input: 10,
        output: 3,
        creation: 0,
        read: 2,
        reasoning: None,
    };
    let mut events = HashMap::new();
    events.insert("old-event".into(), event("old-event", 100, counts));
    usage::persist_scan(&conn, events, &[], &[]).unwrap();
    let mut replay = HashMap::new();
    replay.insert("old-event".into(), event("old-event", 100, counts));
    usage::persist_scan(&conn, replay, &[(50, Some("later-account".into()))], &[]).unwrap();
    let owner: Option<String> = conn
        .query_row("SELECT account_key FROM events", [], |r| r.get(0))
        .unwrap();
    assert_eq!(owner, None);
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn explicit_reasoning_is_optional_and_is_not_added_to_total() {
    let without = Counts::from_usage(
        &json!({"input_tokens":2,"output_tokens":5,"cache_read_input_tokens":3}),
    )
    .unwrap();
    let explicit=Counts::from_usage(&json!({"input_tokens":2,"output_tokens":5,"reasoning_tokens":4,"cache_read_input_tokens":3})).unwrap();
    assert_eq!(without.reasoning, None);
    assert_eq!(explicit.reasoning, Some(4));
    assert_eq!(without.input + without.output + without.read, 10);
    assert_eq!(explicit.input + explicit.output + explicit.read, 10);
}

#[test]
fn parser_skips_bad_lines_and_hashes_request_identifiers_before_persistence() {
    let dir = temp_dir("parse");
    let path = dir.join("fake-session.jsonl");
    let mut f = fs::File::create(&path).unwrap();
    writeln!(f, "not json").unwrap();
    writeln!(f,"{{\"type\":\"assistant\",\"timestamp\":\"2026-01-02T03:04:05Z\",\"requestId\":\"synthetic-request\",\"message\":{{\"id\":\"synthetic-message\",\"model\":\"claude-sonnet-4\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":2}}}}}}").unwrap();
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    usage::parse_file(&path, "synthetic-session-hash", &mut events, &mut warnings).unwrap();
    assert_eq!(events.len(), 1);
    let stored_key = events.keys().next().unwrap();
    assert!(!stored_key.contains("synthetic-request"));
    assert!(!stored_key.contains("synthetic-message"));
    assert!(warnings.contains(&"invalid_records".into()));
    drop(f);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn parser_streams_large_files_and_refuses_links() {
    let dir = temp_dir("bounds");
    let large = dir.join("large.jsonl");
    let mut f = fs::File::create(&large).unwrap();
    writeln!(f,"{{\"type\":\"assistant\",\"timestamp\":\"2026-01-02T03:04:05Z\",\"requestId\":\"req\",\"message\":{{\"id\":\"msg\",\"usage\":{{\"input_tokens\":1}}}}}}").unwrap();
    f.set_len(70 * 1024 * 1024).unwrap();
    drop(f);
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    assert!(usage::parse_file(&large, "large-session", &mut events, &mut warnings).is_some());
    assert_eq!(events.len(), 1);
    let link = dir.join("linked.jsonl");
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(&large, &link).is_ok();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&large, &link).is_ok();
    if linked {
        assert!(usage::parse_file(&link, "linked-session", &mut events, &mut warnings).is_none());
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn parser_uses_message_identity_without_request_id_and_rejects_synthetic_usage() {
    let dir = temp_dir("fallback");
    let path = dir.join("session.jsonl");
    let mut f = fs::File::create(&path).unwrap();
    for out in [2, 9] {
        writeln!(f,"{{\"type\":\"assistant\",\"sessionId\":\"sess\",\"timestamp\":\"2026-01-02T03:04:05Z\",\"message\":{{\"id\":\"same-message\",\"model\":\"sonnet\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":{out}}}}}}}").unwrap();
    }
    writeln!(f,"{{\"type\":\"assistant\",\"timestamp\":\"2026-01-02T03:04:06Z\",\"requestId\":\"synthetic\",\"message\":{{\"id\":\"fake\",\"model\":\"<synthetic>\",\"usage\":{{\"input_tokens\":999}}}}}}").unwrap();
    drop(f);
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    usage::parse_file(&path, "file-session-hash", &mut events, &mut warnings).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events.values().next().unwrap().counts.output, 9);
    assert!(events.keys().all(|key| !key.contains("same-message")));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn parent_message_beats_sidechain_replay_with_larger_cached_counts() {
    let dir = temp_dir("sidechain");
    let conn = usage::open_ledger(&dir.join("usage.sqlite")).unwrap();
    let message_key = "hashed-message".to_string();
    let mut parent = event(
        "parent-request",
        100,
        Counts {
            input: 2,
            output: 20,
            creation: 0,
            read: 0,
            reasoning: None,
        },
    );
    parent.message_key = Some(message_key.clone());
    let mut replay = event(
        "replay-request",
        101,
        Counts {
            input: 2,
            output: 50,
            creation: 0,
            read: 0,
            reasoning: None,
        },
    );
    replay.message_key = Some(message_key);
    replay.sidechain = true;
    let mut events = HashMap::new();
    events.insert(parent.event_key.clone(), parent);
    events.insert(replay.event_key.clone(), replay);
    usage::persist_scan(&conn, events, &[(1, Some("account".into()))], &[]).unwrap();
    let row: (i64, i64) = conn
        .query_row("SELECT COUNT(*),SUM(output) FROM events", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(row, (1, 20));
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn offset_day_bucket_uses_the_supplied_local_utc_offset() {
    let ts = 1_767_225_600; // 2026-01-01 00:00 UTC
    assert_eq!(usage::day_label(ts, 0), "2026-01-01");
    assert_eq!(usage::day_label(ts, -300), "2025-12-31");
}

#[test]
fn aggregate_filters_keep_account_and_unattributed_totals_global_and_ignore_removed_accounts() {
    let dir = temp_dir("aggregate");
    let vault = dir.join("vault");
    super::private::directory(&vault).unwrap();
    let home = dir.join("home");
    super::private::directory(&home).unwrap();
    let db_path = vault.join("identities.sqlite");
    super::private::create(&db_path)
        .unwrap()
        .sync_all()
        .unwrap();
    let index = rusqlite::Connection::open(&db_path).unwrap();
    index.execute_batch("CREATE TABLE identities(id TEXT,name TEXT,archive TEXT,saved_at INTEGER,bytes INTEGER,policy TEXT,empty INTEGER,account_key TEXT); CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE identity_summaries(id TEXT PRIMARY KEY,summary TEXT);").unwrap();
    let aid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let bid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    for (id, name, key, email) in [
        (aid, "Alpha", "acct-a", "a@example.invalid"),
        (bid, "Beta", "acct-b", "b@example.invalid"),
    ] {
        index
            .execute(
                "INSERT INTO identities VALUES(?1,?2,'x',1,0,'{}',0,?3)",
                rusqlite::params![id, name, key],
            )
            .unwrap();
        index
            .execute(
                "INSERT INTO identity_summaries VALUES(?1,?2)",
                rusqlite::params![id, json!({"email":email}).to_string()],
            )
            .unwrap();
    }
    let legacy_id = "cccccccccccccccccccccccccccccccc";
    index
        .execute(
            "INSERT INTO identities VALUES(?1,'Legacy','x',1,0,'{}',0,NULL)",
            [legacy_id],
        )
        .unwrap();
    drop(index);
    let conn = usage::open_ledger(&vault.join("usage.sqlite")).unwrap();
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let c = Counts {
        input: 1,
        output: 0,
        creation: 0,
        read: 0,
        reasoning: None,
    };
    let mut events = HashMap::new();
    for (key, ts) in [
        ("a", t - 1000),
        ("b", t - 900),
        ("u", t - 800),
        ("removed", t - 700),
    ] {
        events.insert(key.into(), event(key, ts, c));
    }
    let boundaries = vec![
        (t - 1100, Some("acct-a".into())),
        (t - 950, Some("acct-b".into())),
        (t - 850, None),
        (t - 750, Some("deleted-account".into())),
    ];
    usage::persist_scan(&conn, events, &boundaries, &[]).unwrap();
    drop(conn);

    let all = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    assert_eq!(all.totals.input_tokens, 2); // currently bound A + B only
    assert_eq!(all.unattributed.input_tokens, 1);
    assert_eq!(
        all.accounts
            .iter()
            .map(|a| a.totals.input_tokens)
            .sum::<u64>(),
        2
    );
    assert!(all
        .accounts
        .iter()
        .any(|a| a.id == legacy_id && a.totals.input_tokens == 0));
    assert_eq!(
        all.accounts
            .iter()
            .find(|a| a.id == aid)
            .unwrap()
            .email
            .as_deref(),
        Some("a@example.invalid")
    );
    let one = usage::read_at(&vault, &home, "all", Some(aid), 0).unwrap();
    assert_eq!(one.totals.input_tokens, 1);
    assert_eq!(one.unattributed.input_tokens, 1); // independent of account filter
    assert_eq!(
        one.accounts
            .iter()
            .map(|a| a.totals.input_tokens)
            .sum::<u64>(),
        2
    );
    let unknown = usage::read_at(&vault, &home, "all", Some("unattributed"), 0).unwrap();
    assert_eq!(unknown.totals.input_tokens, 1);
    assert_eq!(
        unknown
            .daily
            .iter()
            .map(|d| d.totals.input_tokens)
            .sum::<u64>(),
        1
    );
    // An explicit fallback absorbs both unknown and no-longer-mapped owners.
    let assigned =
        usage::read_at_with_fallback(&vault, &home, "all", None, 0, Some("Alpha")).unwrap();
    assert_eq!(assigned.unattributed.requests, 0);
    assert_eq!(assigned.totals.input_tokens, 4);
    assert_eq!(
        assigned
            .accounts
            .iter()
            .find(|a| a.id == aid)
            .unwrap()
            .totals
            .input_tokens,
        3
    );
    assert_eq!(
        assigned
            .daily
            .iter()
            .map(|d| d.totals.input_tokens)
            .sum::<u64>(),
        4
    );
    assert_eq!(
        assigned
            .models
            .iter()
            .map(|m| m.totals.input_tokens)
            .sum::<u64>(),
        4
    );
    // A later name preference cannot silently redirect the saved ID.
    let index = rusqlite::Connection::open(&db_path).unwrap();
    index
        .execute("UPDATE identities SET name='Renamed' WHERE id=?1", [aid])
        .unwrap();
    let assigned =
        usage::read_at_with_fallback(&vault, &home, "all", Some(aid), 0, Some("Beta")).unwrap();
    assert_eq!(assigned.totals.input_tokens, 3);
    let ledger = usage::open_ledger(&vault.join("usage.sqlite")).unwrap();
    let mut later = HashMap::new();
    later.insert(
        "future-unknown".into(),
        event(
            "future-unknown",
            110,
            Counts {
                input: 7,
                ..Counts::default()
            },
        ),
    );
    usage::persist_scan(&ledger, later, &[], &[]).unwrap();
    drop(ledger);
    let repeated = usage::read_at(&vault, &home, "all", Some(aid), 0).unwrap();
    assert_eq!(repeated.totals.input_tokens, 10);
    assert_eq!(
        usage::read_at(&vault, &home, "all", Some(aid), 0)
            .unwrap()
            .totals
            .input_tokens,
        10
    );
    drop(index);
    drop(all);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn empty_identity_vault_returns_a_readable_empty_snapshot_without_creating_identity_index() {
    let dir = temp_dir("empty");
    let vault = dir.join("new-vault");
    let home = dir.join("home");
    let snapshot = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    assert!(snapshot.accounts.is_empty());
    assert_eq!(snapshot.totals.total_tokens, 0);
    assert!(!vault.join("identities.sqlite").exists());
    assert!(vault.join("usage.sqlite").exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn first_unbound_scan_stays_unknown_then_save_current_starts_a_verified_new_window() {
    let dir = temp_dir("first-bind");
    let vault = dir.join("vault");
    let home = dir.join("home");
    super::private::directory(&vault).unwrap();
    super::private::directory(&home.join(".claude/projects/project")).unwrap();
    let session = home.join(".claude/projects/project/session.jsonl");
    let mut file = fs::File::create(&session).unwrap();
    writeln!(file, "{{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"requestId\":\"old-request\",\"message\":{{\"id\":\"old-message\",\"model\":\"sonnet\",\"usage\":{{\"input_tokens\":2}}}}}}").unwrap();
    drop(file);

    let first = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    assert_eq!(first.tracking_since.is_some(), true);
    assert_eq!(first.unattributed.input_tokens, 2);
    assert!(!vault.join("identities.sqlite").exists());

    let id = "dddddddddddddddddddddddddddddddd";
    let key = vec![7u8; 32];
    let config = json!({"oauthAccount":{"accountUuid":"synthetic-account","organizationUuid":"synthetic-org","emailAddress":"synthetic@example.invalid"}});
    fs::write(home.join(".claude.json"), config.to_string()).unwrap();
    let key_path = vault.join("key.bin");
    let mut key_file = super::private::create(&key_path).unwrap();
    key_file.write_all(&key).unwrap();
    drop(key_file);
    let account_key = super::catalog::account_key(&config, &key).unwrap();
    let db_path = vault.join("identities.sqlite");
    let db_file = super::private::create(&db_path).unwrap();
    db_file.sync_all().unwrap();
    drop(db_file);
    let db = rusqlite::Connection::open(&db_path).unwrap();
    db.execute_batch("CREATE TABLE identities(id TEXT PRIMARY KEY,name TEXT,archive TEXT,saved_at INTEGER,bytes INTEGER,policy TEXT,empty INTEGER,account_key TEXT); CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE identity_summaries(id TEXT PRIMARY KEY,summary TEXT);").unwrap();
    db.execute(
        "INSERT INTO identities VALUES(?1,'Bound','x',1,0,'{}',0,?2)",
        rusqlite::params![id, account_key],
    )
    .unwrap();
    db.execute("INSERT INTO state VALUES('active',?1)", [id])
        .unwrap();
    drop(db);

    // This is the post-commit save_current hook: it verifies the live HMAC and active slot.
    usage::commit_switch_boundary(&vault, &home, Some(&account_key));
    let mut file = fs::OpenOptions::new().append(true).open(&session).unwrap();
    writeln!(file, "{{\"type\":\"assistant\",\"timestamp\":\"2099-01-01T00:00:02Z\",\"requestId\":\"new-request\",\"message\":{{\"id\":\"new-message\",\"model\":\"sonnet\",\"usage\":{{\"input_tokens\":3}}}}}}").unwrap();
    drop(file);
    let after = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    assert_eq!(after.unattributed.input_tokens, 2);
    // This fixture deliberately uses a timestamp far in the future; invalid future
    // records must not inflate visible totals or create a trend bucket.
    assert_eq!(after.totals.input_tokens, 0);
    assert!(after
        .daily
        .iter()
        .all(|bucket| bucket.totals.input_tokens == 0));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn damaged_file_warning_survives_cached_reads_without_double_counting() {
    let dir = temp_dir("damaged-repeat");
    let vault = dir.join("vault");
    let home = dir.join("home");
    super::private::directory(&vault).unwrap();
    let project = home.join(".claude/projects/project");
    super::private::directory(&project).unwrap();
    let path = project.join("damaged.jsonl");
    let mut f = fs::File::create(&path).unwrap();
    writeln!(f,"{{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"requestId\":\"once\",\"message\":{{\"id\":\"one\",\"model\":\"sonnet\",\"usage\":{{\"input_tokens\":4}}}}}}").unwrap();
    writeln!(f, "not-json").unwrap();
    drop(f);
    let first = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    let second = usage::read_at(&vault, &home, "all", None, 0).unwrap();
    assert!(first.warnings.contains(&"invalid_records".into()));
    assert!(second.warnings.contains(&"invalid_records".into()));
    assert_eq!(first.unattributed.input_tokens, 4);
    assert_eq!(second.unattributed.input_tokens, 4);
    let conn = usage::open_ledger(&vault.join("usage.sqlite")).unwrap();
    let cached: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cached, 0);
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn incremental_scan_retries_only_an_unterminated_tail_after_append() {
    let dir = temp_dir("append-tail");
    let path = dir.join("session.jsonl");
    let complete = b"{\"type\":\"assistant\",\"timestamp\":\"2026-01-02T03:04:05Z\",\"requestId\":\"one\",\"message\":{\"id\":\"first\",\"model\":\"sonnet\",\"usage\":{\"input_tokens\":2}}}\n";
    let tail = b"{\"type\":\"assistant\",\"timestamp\":\"2026-01-02T03:04:06Z\",\"requestId\":\"two\",\"message\":{\"id\":\"second\",\"model\":\"sonnet\",\"usage\":{";
    let mut file = fs::File::create(&path).unwrap();
    file.write_all(complete).unwrap();
    file.write_all(tail).unwrap();
    drop(file);

    let tag = "synthetic-file-tag";
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    let (_, _, offset, complete_scan) =
        usage::parse_file_from(&path, tag, &mut events, &mut warnings, 0).unwrap();
    assert!(complete_scan);
    assert_eq!(offset, complete.len() as u64);
    assert_eq!(events.len(), 1);

    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(b"\"input_tokens\":3}}}\n").unwrap();
    drop(file);
    let mut appended = HashMap::new();
    let (_, _, next_offset, complete_scan) =
        usage::parse_file_from(&path, tag, &mut appended, &mut warnings, offset).unwrap();
    assert!(complete_scan);
    assert_eq!(appended.len(), 1);
    assert_eq!(appended.values().next().unwrap().counts.input, 3);
    assert_eq!(next_offset, fs::metadata(&path).unwrap().len());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn trend_bucket_spans_are_hourly_today_and_seven_or_thirty_local_days() {
    let now = 1_767_225_600; // 2026-01-01 00:00 UTC
    let (first, last) = usage::bucket_span("today", now + 13 * 3600 + 17 * 60, 0, None);
    assert_eq!(last - first + 1, 14);
    let (first, last) = usage::bucket_span("week", now, 0, None);
    assert_eq!(last - first + 1, 7);
    let (first, last) = usage::bucket_span("month", now, 0, None);
    assert_eq!(last - first + 1, 30);
    let (first, last) = usage::bucket_span("all", now, 0, Some(20_000));
    assert_eq!(first, 20_000);
    assert!(last > first);
}

#[test]
fn oversized_unterminated_tail_keeps_its_boundary_until_a_newline_arrives() {
    let dir = temp_dir("oversized-tail");
    let path = dir.join("session.jsonl");
    fs::write(&path, vec![b'x'; 2 * 1024 * 1024 + 64]).unwrap();
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    let (_, _, offset, complete) =
        usage::parse_file_from(&path, "oversized", &mut events, &mut warnings, 0).unwrap();
    assert!(complete);
    assert_eq!(offset, 0);
    assert!(warnings.is_empty());
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(file).unwrap();
    writeln!(
        file,
        "{}",
        json!({"type":"assistant","timestamp":"2026-01-01T01:00:00Z",
        "requestId":"after-oversized","message":{"id":"after","usage":{"input_tokens":7}}})
    )
    .unwrap();
    drop(file);
    let (_, _, offset, complete) =
        usage::parse_file_from(&path, "oversized", &mut events, &mut warnings, offset).unwrap();
    assert!(!complete);
    assert_eq!(offset, fs::metadata(&path).unwrap().len());
    assert_eq!(events.len(), 1);
    assert!(warnings.contains(&"invalid_records".into()));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn cached_ingestion_detects_larger_rewrites_truncation_and_same_size_changes() {
    let dir = temp_dir("cursor-rewrites");
    let vault = dir.join("vault");
    let home = dir.join("home");
    let project = home.join(".claude/projects/project");
    super::private::directory(&project).unwrap();
    let path = project.join("session.jsonl");
    let record = |id: &str, count| {
        format!(
            "{}\n",
            json!({"type":"assistant",
        "timestamp":"2026-01-01T01:00:00Z","requestId":id,
        "message":{"id":id,"usage":{"input_tokens":count}}})
        )
    };
    fs::write(&path, record("first", 2)).unwrap();
    let read = || usage::read_at(&vault, &home, "all", Some("unattributed"), 0).unwrap();
    assert_eq!(read().totals.input_tokens, 2);
    fs::write(&path, record("first", 20) + &record("second", 3)).unwrap();
    assert_eq!(
        read().totals.input_tokens,
        23,
        "A larger rewrite must re-read the changed prefix"
    );
    fs::write(&path, record("first", 90)).unwrap();
    assert_eq!(
        read().totals.input_tokens,
        93,
        "Truncation re-reads while preserving ledger history"
    );
    fs::write(&path, record("first", 99)).unwrap();
    assert_eq!(
        read().totals.input_tokens,
        102,
        "Same-size edits must not reuse the old cursor"
    );
    let mut append = fs::OpenOptions::new().append(true).open(&path).unwrap();
    append.write_all(record("third", 7).as_bytes()).unwrap();
    drop(append);
    assert_eq!(read().totals.input_tokens, 109);
    assert_eq!(
        read().totals.input_tokens,
        109,
        "Cache hits must remain idempotent"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn legacy_file_cursor_migrates_without_changing_explicit_history_ownership() {
    let dir = temp_dir("legacy-cursor");
    let path = dir.join("usage.sqlite");
    super::private::create(&path).unwrap().sync_all().unwrap();
    let legacy = rusqlite::Connection::open(&path).unwrap();
    legacy.execute_batch("CREATE TABLE files(file_key TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime INTEGER NOT NULL); INSERT INTO files VALUES('old-file',123,456);").unwrap();
    drop(legacy);
    let conn = usage::open_ledger(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT offset FROM files", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        123
    );
    let counts = Counts {
        input: 4,
        ..Counts::default()
    };
    let mut first = HashMap::new();
    first.insert("history".into(), event("history", 100, counts));
    usage::persist_scan(&conn, first, &[], &[]).unwrap();
    conn.execute("UPDATE events SET account_key='explicit-history-owner'", [])
        .unwrap();
    let mut replay = HashMap::new();
    replay.insert(
        "history".into(),
        event("history", 101, Counts { input: 6, ..counts }),
    );
    replay.insert("new-unknown".into(), event("new-unknown", 102, counts));
    usage::persist_scan(&conn, replay, &[], &[]).unwrap();
    let row: (String, i64) = conn
        .query_row(
            "SELECT account_key,input FROM events WHERE event_key='history'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(row, ("explicit-history-owner".into(), 6));
    assert_eq!(
        conn.query_row(
            "SELECT account_key FROM events WHERE event_key='new-unknown'",
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
fn snapshots_include_hourly_today_full_history_and_consistent_period_totals() {
    let dir = temp_dir("snapshot-buckets");
    let vault = dir.join("vault");
    let home = dir.join("home");
    let conn = usage::open_ledger(&vault.join("usage.sqlite")).unwrap();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut records = HashMap::new();
    for (key, ts, count) in [
        ("today", now, 11),
        ("history", now - 65 * 86400, 23),
        ("future", now + 86400, 37),
    ] {
        records.insert(
            key.into(),
            event(
                key,
                ts,
                Counts {
                    input: count,
                    ..Counts::default()
                },
            ),
        );
    }
    usage::persist_scan(&conn, records, &[], &[]).unwrap();
    drop(conn);
    for offset in [-300, 330] {
        for (period, expected, total) in [
            ("today", 0, 11),
            ("week", 7, 11),
            ("month", 30, 11),
            ("all", 66, 34),
        ] {
            let snapshot =
                usage::read_at(&vault, &home, period, Some("unattributed"), offset).unwrap();
            assert_eq!(snapshot.totals.input_tokens, total);
            assert_eq!(
                snapshot
                    .daily
                    .iter()
                    .map(|row| row.totals.input_tokens)
                    .sum::<u64>(),
                total
            );
            if period == "today" {
                assert_eq!(snapshot.granularity, "hour");
                let hours = ((snapshot.generated_at as i64 + offset as i64 * 60).rem_euclid(86400)
                    / 3600
                    + 1) as usize;
                assert_eq!(snapshot.daily.len(), hours);
                assert!(snapshot.daily.iter().all(|row| row.day.contains('T')));
            } else {
                assert_eq!(snapshot.granularity, "day");
                assert_eq!(snapshot.daily.len(), expected);
            }
        }
    }
    fs::remove_dir_all(dir).unwrap();
}

fn timezone_fixture(
    period: &str,
    timezone: Option<&str>,
    clock: u64,
    records: &[(&str, u64, u64)],
) -> usage::UsageSnapshot {
    let dir = temp_dir("timezone");
    let vault = dir.join("vault");
    let conn = usage::open_ledger(&vault.join("usage.sqlite")).unwrap();
    let events = records
        .iter()
        .map(|(key, ts, count)| {
            (
                (*key).into(),
                event(
                    key,
                    *ts,
                    Counts {
                        input: *count,
                        ..Counts::default()
                    },
                ),
            )
        })
        .collect();
    usage::persist_scan(&conn, events, &[], &[]).unwrap();
    drop(conn);
    let snapshot = usage::read_at_with_timezone_now(
        &vault,
        &dir.join("home"),
        period,
        Some("unattributed"),
        0,
        None,
        timezone,
        clock,
    )
    .unwrap();
    fs::remove_dir_all(dir).unwrap();
    snapshot
}

#[test]
fn named_timezone_spring_day_has_23_real_hours_and_calendar_boundaries() {
    // New York 2026-03-08 spans 05:00Z through 04:00Z next day.
    let midnight = 1_772_946_000;
    let records = [
        ("before", midnight - 1, 100),
        ("start", midnight, 2),
        ("after-jump", midnight + 2 * 3600, 3),
        ("late", midnight + 23 * 3600 - 1, 5),
        ("future", midnight + 23 * 3600, 1000),
    ];
    let snapshot = timezone_fixture(
        "today",
        Some("America/New_York"),
        midnight + 23 * 3600 - 1,
        &records,
    );
    assert_eq!(snapshot.timezone.as_deref(), Some("America/New_York"));
    assert_eq!(snapshot.daily.len(), 23);
    assert_eq!(snapshot.daily[0].day, "2026-03-08T00:00-05:00");
    assert_eq!(snapshot.daily[2].day, "2026-03-08T03:00-04:00");
    assert_eq!(snapshot.totals.input_tokens, 10);
    assert_eq!(
        snapshot
            .daily
            .iter()
            .map(|row| row.totals.input_tokens)
            .sum::<u64>(),
        10
    );
    assert_eq!(snapshot.daily.first().unwrap().start_at, Some(midnight));
    assert_eq!(
        snapshot.daily.last().unwrap().end_at,
        Some(midnight + 23 * 3600)
    );
    let week = timezone_fixture(
        "week",
        Some("America/New_York"),
        midnight + 23 * 3600 + 12 * 3600,
        &records,
    );
    assert_eq!(week.daily.len(), 7);
    assert_eq!(week.daily[0].day, "2026-03-03");
    assert_eq!(week.daily.last().unwrap().day, "2026-03-09");
    assert_eq!(
        week.daily
            .iter()
            .find(|row| row.day == "2026-03-07")
            .unwrap()
            .totals
            .input_tokens,
        100
    );
    assert_eq!(
        week.daily
            .iter()
            .find(|row| row.day == "2026-03-08")
            .unwrap()
            .totals
            .input_tokens,
        10
    );
}

#[test]
fn named_timezone_fall_repeated_hours_keep_offsets_and_conserve_totals() {
    // New York 2026-11-01 spans 04:00Z through 05:00Z next day.
    let midnight = 1_793_505_600;
    let records = [
        ("before", midnight - 1, 100),
        ("first-one", midnight + 5400, 7),
        ("second-one", midnight + 9000, 11),
        ("late", midnight + 25 * 3600 - 1, 13),
    ];
    let snapshot = timezone_fixture(
        "today",
        Some("America/New_York"),
        midnight + 25 * 3600 - 1,
        &records,
    );
    assert_eq!(snapshot.daily.len(), 25);
    assert_eq!(snapshot.daily[1].day, "2026-11-01T01:00-04:00");
    assert_eq!(snapshot.daily[2].day, "2026-11-01T01:00-05:00");
    assert_eq!(snapshot.daily[1].totals.input_tokens, 7);
    assert_eq!(snapshot.daily[2].totals.input_tokens, 11);
    assert_eq!(snapshot.totals.input_tokens, 31);
    assert_eq!(
        snapshot
            .daily
            .iter()
            .map(|row| row.totals.input_tokens)
            .sum::<u64>(),
        31
    );
    for pair in snapshot.daily.windows(2) {
        assert_eq!(pair[0].end_at, pair[1].start_at);
    }
    let month = timezone_fixture(
        "month",
        Some("America/New_York"),
        midnight + 25 * 3600 + 12 * 3600,
        &records,
    );
    assert_eq!(month.daily.len(), 30);
    assert_eq!(month.daily[0].day, "2026-10-04");
    assert_eq!(month.daily.last().unwrap().day, "2026-11-02");
    assert_eq!(
        month
            .daily
            .iter()
            .find(|row| row.day == "2026-10-31")
            .unwrap()
            .totals
            .input_tokens,
        100
    );
    assert_eq!(
        month
            .daily
            .iter()
            .find(|row| row.day == "2026-11-01")
            .unwrap()
            .totals
            .input_tokens,
        31
    );
}

#[test]
fn named_timezone_utc_future_slots_and_legacy_offset_remain_compatible() {
    let midnight = 1_767_225_600; // 2026-01-01T00:00Z
    let records = [
        ("now", midnight + 3600, 7),
        ("future", midnight + 7200, 100),
    ];
    let named = timezone_fixture("today", Some("UTC"), midnight + 3600, &records);
    assert_eq!(named.daily.len(), 24);
    assert_eq!(named.daily[0].day, "2026-01-01T00:00+00:00");
    assert_eq!(named.totals.input_tokens, 7);
    assert!(named
        .daily
        .iter()
        .skip(2)
        .all(|row| row.totals.requests == 0));
    let legacy = timezone_fixture("today", None, midnight + 3600, &records);
    assert_eq!(legacy.timezone, None);
    assert_eq!(legacy.daily.len(), 2);
    assert_eq!(legacy.daily[0].day, "2026-01-01T00:00");
    assert!(legacy
        .daily
        .iter()
        .all(|row| row.start_at.is_none() && row.end_at.is_none()));
    assert_eq!(legacy.totals.input_tokens, named.totals.input_tokens);
}

#[test]
fn named_timezone_invalid_input_fails_before_opening_a_ledger() {
    let dir = temp_dir("invalid-timezone");
    for timezone in ["", "America/Invented", "UTC+05:00"] {
        let result = usage::read_at_with_timezone_now(
            &dir.join("vault"),
            &dir.join("home"),
            "today",
            None,
            330,
            None,
            Some(timezone),
            1_767_225_600,
        );
        assert_eq!(result.err().as_deref(), Some("usage timezone is invalid"));
        assert!(!dir.join("vault").exists());
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn named_timezone_lord_howe_half_hour_rollback_keeps_exact_intervals() {
    let midnight = chrono::DateTime::parse_from_rfc3339("2026-04-05T00:00:00+11:00")
        .unwrap()
        .timestamp() as u64;
    let records = [
        ("first", midnight + 100 * 60, 3),
        ("repeated", midnight + 130 * 60, 5),
        ("after", midnight + 151 * 60, 7),
        ("late", midnight + 1470 * 60 - 1, 11),
    ];
    let snapshot = timezone_fixture(
        "today",
        Some("Australia/Lord_Howe"),
        midnight + 1470 * 60 - 1,
        &records,
    );
    assert_eq!(snapshot.daily.len(), 25);
    assert_eq!(snapshot.daily[1].day, "2026-04-05T01:00+11:00");
    assert_eq!(snapshot.daily[2].day, "2026-04-05T01:30+10:30");
    assert_eq!(
        snapshot.daily[2].end_at.unwrap() - snapshot.daily[2].start_at.unwrap(),
        1800
    );
    assert_eq!(
        snapshot
            .daily
            .iter()
            .map(|row| row.end_at.unwrap() - row.start_at.unwrap())
            .sum::<u64>(),
        1470 * 60
    );
    assert_eq!(
        snapshot
            .daily
            .iter()
            .map(|row| row.totals.input_tokens)
            .sum::<u64>(),
        26
    );
    assert_eq!(snapshot.totals.input_tokens, 26);
    for pair in snapshot.daily.windows(2) {
        assert_eq!(pair[0].end_at, pair[1].start_at);
    }
    let week = timezone_fixture(
        "week",
        Some("Australia/Lord_Howe"),
        midnight + 1470 * 60 + 3600,
        &records,
    );
    assert_eq!(
        week.daily
            .iter()
            .find(|row| row.day == "2026-04-05")
            .unwrap()
            .totals
            .input_tokens,
        26
    );
}

#[test]
fn named_timezone_windows_use_start_date_offset_and_history_keeps_zero_dates() {
    for (date, timezone) in [
        ("2026-03-09T12:00:00-04:00", "America/New_York"),
        ("2026-11-02T12:00:00-05:00", "America/New_York"),
    ] {
        let clock = chrono::DateTime::parse_from_rfc3339(date)
            .unwrap()
            .timestamp() as u64;
        for (period, first_date) in [
            (
                "week",
                if date.contains("03-09") {
                    "2026-03-03T00:00:00-05:00"
                } else {
                    "2026-10-27T00:00:00-04:00"
                },
            ),
            (
                "month",
                if date.contains("03-09") {
                    "2026-02-08T00:00:00-05:00"
                } else {
                    "2026-10-04T00:00:00-04:00"
                },
            ),
        ] {
            let start = chrono::DateTime::parse_from_rfc3339(first_date)
                .unwrap()
                .timestamp() as u64;
            let snapshot = timezone_fixture(
                period,
                Some(timezone),
                clock,
                &[("before", start - 1, 100), ("start", start, 7)],
            );
            assert_eq!(snapshot.totals.input_tokens, 7);
            assert_eq!(snapshot.daily[0].totals.input_tokens, 7);
        }
        let past = clock - 10 * 86400;
        let snapshot = timezone_fixture(
            "all",
            Some(timezone),
            clock,
            &[("past", past, 7), ("now", clock, 11)],
        );
        assert_eq!(snapshot.daily.len(), 11);
        assert_eq!(
            snapshot
                .daily
                .iter()
                .map(|row| row.totals.input_tokens)
                .sum::<u64>(),
            18
        );
        assert!(snapshot.daily[1..10]
            .iter()
            .all(|row| row.totals.requests == 0));
    }
}
