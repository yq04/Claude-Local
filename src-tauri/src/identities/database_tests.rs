// [INPUT]: Synthetic SQLite schemas in canonical temporary directories and concurrent Database::open calls.
// [OUTPUT]: Repeated contended first creation and serialized SQLite schema initialization coverage.
// [POS]: Database initialization tests only; never reads real identity data or starts native/browser operations.
// [PROTOCOL]: Keep fixtures synthetic and all filesystem changes inside unique temporary roots.
use super::{database::Database, new_id, private};
use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Barrier},
    thread,
};

fn temp_path(label: &str) -> PathBuf {
    std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "claude-local-db-{label}-{}-{}",
            std::process::id(),
            new_id().unwrap()
        ))
}

fn temp_root(label: &str) -> PathBuf {
    let root = temp_path(label);
    fs::create_dir_all(&root).unwrap();
    std::fs::canonicalize(root).unwrap()
}

fn concurrent_opens(root: PathBuf, count: usize) -> Vec<Result<Database, String>> {
    let barrier = Arc::new(Barrier::new(count));
    let workers = (0..count)
        .map(|_| {
            let root = root.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                Database::open(&root)
            })
        })
        .collect::<Vec<_>>();
    workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect()
}

#[test]
fn concurrent_first_open_initializes_one_database() {
    // Fresh files exercise Windows' create-handle/read-only-fallback window each round.
    for _ in 0..24 {
        let root = temp_root("first-open");
        private::directory(&root).unwrap();
        let results = concurrent_opens(root.clone(), 2);
        assert!(
            results.iter().all(Result::is_ok),
            "first-open errors: {:?}",
            results.iter().map(|r| r.as_ref().err()).collect::<Vec<_>>()
        );
        let db = Connection::open(root.join("identities.sqlite")).unwrap();
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 3);
        let browser_state: i64 = db.query_row("SELECT COUNT(*) FROM state WHERE key IN ('browser.enabled','browser.active','browser.draft')", [], |row| row.get(0)).unwrap();
        assert_eq!(browser_state, 3);
        drop(db);
        drop(results);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn concurrent_first_open_creates_missing_vault_directory() {
    let root = temp_path("missing-root");
    let results = concurrent_opens(root.clone(), 2);
    assert!(
        results.iter().all(Result::is_ok),
        "missing-root errors: {:?}",
        results.iter().map(|r| r.as_ref().err()).collect::<Vec<_>>()
    );
    let db = Connection::open(root.join("identities.sqlite")).unwrap();
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 3);
    drop(db);
    drop(results);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_open_migrates_existing_v1_database() {
    let root = temp_root("v1-migration");
    private::directory(&root).unwrap();
    let path = root.join("identities.sqlite");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL, policy TEXT NOT NULL, empty INTEGER NOT NULL); PRAGMA user_version=1;").unwrap();
    drop(db);

    let results = concurrent_opens(root.clone(), 2);
    assert!(
        results.iter().all(Result::is_ok),
        "migration errors: {:?}",
        results.iter().map(|r| r.as_ref().err()).collect::<Vec<_>>()
    );
    let db = Connection::open(path).unwrap();
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 3);
    let columns: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('identities') WHERE name='account_key'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(columns, 1);
    drop(db);
    drop(results);
    fs::remove_dir_all(root).unwrap();
}
