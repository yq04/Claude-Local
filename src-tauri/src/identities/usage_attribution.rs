// [INPUT]: Existing live account HMAC, bounded allowlisted display metadata, explicit empty-switch receipts and hashed JSONL session evidence.
// [OUTPUT]: Usage-only identity registry, conservative observed login windows and a frozen historical fallback cutoff.
// [POS]: Private child of usage; no archive creation, process control, source writes or credential reads.
// [PROTOCOL]: Managed empty receipts are distinct from legacy/externally detected unknown gaps. Existing event ownership is immutable.
use super::*;

pub(super) fn migrate(conn: &Connection) -> Result<(), String> {
    let has_session = conn
        .prepare("PRAGMA table_info(events)")
        .and_then(|mut q| {
            Ok(q.query_map([], |r| r.get::<_, String>(1))?
                .flatten()
                .any(|v| v == "session_key"))
        })
        .map_err(|_| "usage ledger schema unavailable")?;
    if !has_session {
        conn.execute("ALTER TABLE events ADD COLUMN session_key TEXT", [])
            .map_err(|_| "usage ledger migration failed")?;
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS usage_identities(account_key TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,email TEXT,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS live_windows(seq INTEGER PRIMARY KEY,started_at INTEGER NOT NULL,account_key TEXT,controlled INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS events_session ON events(session_key);")
        .map_err(|_| "usage ledger migration failed")?;
    let legacy: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM meta WHERE key='fallback_account_id')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if legacy {
        let _ = fallback_before(conn, true)?;
    }
    Ok(())
}

pub(super) fn fallback_before(conn: &Connection, initialize: bool) -> Result<Option<u64>, String> {
    let saved = conn
        .query_row(
            "SELECT value FROM meta WHERE key='fallback_before'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "usage attribution unavailable")?;
    if let Some(saved) = saved {
        return Ok(saved.parse().ok());
    }
    if !initialize {
        return Ok(None);
    }
    // Freeze existing history once. Later scans, renamed accounts and target changes never advance it.
    let cutoff: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(ts),0) FROM events WHERE ts<=?1",
            [now().min(i64::MAX as u64) as i64],
            |r| r.get(0),
        )
        .map_err(|_| "usage attribution unavailable")?;
    conn.execute(
        "INSERT OR IGNORE INTO meta(key,value) VALUES('fallback_before',?1)",
        [cutoff.to_string()],
    )
    .map_err(|_| "usage attribution write failed")?;
    Ok(Some(cutoff.max(0) as u64))
}

fn display(value: &Value, name: &str, max: usize) -> Option<String> {
    let raw = value.get(name)?.as_str()?.trim();
    (!raw.is_empty() && raw.len() <= max && !raw.chars().any(char::is_control))
        .then(|| raw.to_string())
}

pub(super) fn observe(conn: &Connection, vault: &Path, home: &Path, clock: u64) -> Option<String> {
    let account = live_account_key(vault, home);
    if let Some(key) = account.as_ref() {
        let path = home.join(".claude.json");
        let mut name = None;
        let mut email = None;
        if private::safe(&path).is_ok() {
            let mut bytes = zeroize::Zeroizing::new(Vec::new());
            if File::open(&path)
                .and_then(|f| f.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes))
                .is_ok()
                && bytes.len() <= 8 * 1024 * 1024
            {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    // Read only display allowlist; recheck HMAC before committing this projection.
                    name = display(&value["oauthAccount"], "displayName", 80);
                    email = display(&value["oauthAccount"], "emailAddress", 254);
                }
            }
        }
        if live_account_key(vault, home).as_ref() != Some(key) {
            return None;
        }
        let id = hex_hash(format!("usage-identity-v1\0{key}").as_bytes())[..32].to_string();
        let name = name
            .or_else(|| email.clone())
            .unwrap_or_else(|| "Local account".into());
        conn.execute("INSERT INTO usage_identities(account_key,id,name,email,first_seen,last_seen) VALUES(?1,?2,?3,?4,?5,?5) ON CONFLICT(account_key) DO UPDATE SET name=excluded.name,email=excluded.email,last_seen=excluded.last_seen", params![key,id,name,email,clock as i64]).ok()?;
    }
    let latest: Option<Option<String>> = conn
        .query_row(
            "SELECT account_key FROM live_windows ORDER BY seq DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if latest.as_ref() != Some(&account) {
        let pending = conn
            .query_row(
                "SELECT value FROM meta WHERE key='pending_empty_login'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u64>().ok());
        let controlled = account.is_some() && pending.is_some_and(|ts| ts <= clock);
        let since = if controlled {
            pending.unwrap().saturating_add(1)
        } else {
            clock.saturating_add(1)
        };
        conn.execute(
            "INSERT INTO live_windows(started_at,account_key,controlled) VALUES(?1,?2,?3)",
            params![since as i64, account, controlled as i64],
        )
        .ok()?;
        if account.is_some() {
            let _ = conn.execute("DELETE FROM meta WHERE key='pending_empty_login'", []);
        }
    }
    account
}

pub(super) fn session_hash(id: &str) -> String {
    hex_hash(format!("usage-session-v1\0{id}").as_bytes())
}

pub(super) fn session_roots(path: &Path) -> HashMap<String, u64> {
    let mut roots = HashMap::new();
    let Ok(file) = File::open(path) else {
        return roots;
    };
    let mut prefix = Vec::new();
    if file
        .take(MAX_EFFORT_RECOVERY_BYTES)
        .read_to_end(&mut prefix)
        .is_err()
    {
        return roots;
    }
    for line in prefix
        .split_inclusive(|b| *b == b'\n')
        .filter(|line| line.last() == Some(&b'\n'))
    {
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("user")
            || value.get("parentUuid") != Some(&Value::Null)
            || value.get("isSidechain").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let Some(id) = value
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 254)
        else {
            continue;
        };
        let Some(ts) = value
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(super::super::profile::parse_iso_epoch_sec)
        else {
            continue;
        };
        roots
            .entry(session_hash(id))
            .and_modify(|old: &mut u64| *old = (*old).min(ts))
            .or_insert(ts);
    }
    roots
}

pub(super) fn session_owner(conn: &Connection, event: &Event) -> Option<String> {
    event.session_key.as_ref()?;
    let (since, owner, controlled): (i64, Option<String>, bool) = conn
        .query_row(
            "SELECT started_at,account_key,controlled FROM live_windows ORDER BY seq DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()?;
    let since = since.max(0) as u64;
    // A controlled empty switch first proved all prior CLI processes stopped. It can
    // safely account a resumed session's new turns; arbitrary observed changes cannot.
    let started = controlled
        || event
            .session_start
            .is_some_and(|start| start >= since && start <= event.ts);
    (started && event.ts >= since).then_some(owner).flatten()
}

pub(super) fn append_registry(
    conn: &Connection,
    live: Option<&str>,
    map: &mut HashMap<String, UsageAccount>,
    ids: &mut HashMap<String, String>,
) {
    let Ok(mut q) = conn
        .prepare("SELECT account_key,id,name,email FROM usage_identities ORDER BY first_seen,id")
    else {
        return;
    };
    let Ok(rows) = q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    }) else {
        return;
    };
    for (key, id, name, email) in rows.flatten() {
        if let Some(account) = map.get_mut(&key) {
            account.current = live == Some(key.as_str());
            continue;
        }
        ids.insert(key.clone(), id.clone());
        map.insert(
            key.clone(),
            UsageAccount {
                id,
                name,
                email,
                current: live == Some(key.as_str()),
                totals: UsageTotals::default(),
            },
        );
    }
}
