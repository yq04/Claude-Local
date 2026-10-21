// [INPUT]: Bounded Claude Code project JSONL usage records, identity HMAC keys, and a private independent SQLite ledger.
// [OUTPUT]: Redacted aggregates with indexed time-range reads, hourly/daily trends and persistent user-selected fallback attribution.
// [POS]: Read-only identity usage command and pre-switch collection boundary; never reads credentials, archives, or session bodies into the ledger.
// [PROTOCOL]: Complete-line offsets and bounded prefix/tail hashes live only in the usage ledger; identity database user_version remains 3. See identities/CLAUDE.md.
use super::{catalog, private};
use ring::digest;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const MAX_DEPTH: usize = 6;
const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Default, Serialize)]
pub struct UsageTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub reasoning_tokens: Option<u64>,
    pub requests: u64,
}

#[derive(Clone, Serialize)]
pub struct UsageAccount {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub current: bool,
    pub totals: UsageTotals,
}
#[derive(Clone, Serialize)]
pub struct UsageDaily {
    pub day: String,
    pub totals: UsageTotals,
}
#[derive(Clone, Serialize)]
pub struct UsageModel {
    pub model: String,
    pub totals: UsageTotals,
}
#[derive(Clone, Serialize)]
pub struct UsageSnapshot {
    pub generated_at: u64,
    pub tracking_since: Option<u64>,
    pub totals: UsageTotals,
    pub unattributed: UsageTotals,
    pub accounts: Vec<UsageAccount>,
    pub daily: Vec<UsageDaily>,
    pub granularity: String,
    pub models: Vec<UsageModel>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Default)]
pub(super) struct Counts {
    pub input: u64,
    pub output: u64,
    pub creation: u64,
    pub read: u64,
    pub reasoning: Option<u64>,
}
impl Counts {
    pub(super) fn from_usage(u: &Value) -> Option<Self> {
        let n = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
        let creation = u
            .get("cache_creation_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or_else(|| {
                u.get("cache_creation")
                    .map(|v| {
                        n(v.get("ephemeral_5m_input_tokens"))
                            .saturating_add(n(v.get("ephemeral_1h_input_tokens")))
                    })
                    .unwrap_or(0)
            });
        let output = n(u.get("output_tokens"));
        let explicit_reasoning = u
            .get("reasoning_tokens")
            .and_then(Value::as_u64)
            .or_else(|| {
                u.pointer("/output_tokens_details/reasoning_tokens")
                    .and_then(Value::as_u64)
            });
        let value = Self {
            input: n(u.get("input_tokens")),
            output,
            creation,
            read: n(u.get("cache_read_input_tokens")),
            reasoning: explicit_reasoning,
        };
        (value.input + value.output + value.creation + value.read > 0).then_some(value)
    }
    fn add_to(&self, out: &mut UsageTotals) {
        out.input_tokens = out.input_tokens.saturating_add(self.input);
        out.output_tokens = out.output_tokens.saturating_add(self.output);
        out.cache_creation_tokens = out.cache_creation_tokens.saturating_add(self.creation);
        out.cache_read_tokens = out.cache_read_tokens.saturating_add(self.read);
        out.total_tokens = out
            .input_tokens
            .saturating_add(out.output_tokens)
            .saturating_add(out.cache_creation_tokens)
            .saturating_add(out.cache_read_tokens);
        out.requests = out.requests.saturating_add(1);
        if let Some(r) = self.reasoning {
            out.reasoning_tokens = Some(out.reasoning_tokens.unwrap_or(0).saturating_add(r));
        }
    }
    pub(super) fn component_max(self, other: Self) -> Self {
        Self {
            input: self.input.max(other.input),
            output: self.output.max(other.output),
            creation: self.creation.max(other.creation),
            read: self.read.max(other.read),
            reasoning: match (self.reasoning, other.reasoning) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, None) | (None, a) => a,
            },
        }
    }
}
#[derive(Clone)]
pub(super) struct Event {
    pub event_key: String,
    pub message_key: Option<String>,
    pub ts: u64,
    pub model: String,
    pub counts: Counts,
    pub account: Option<String>,
    pub weak: bool,
    pub sidechain: bool,
}
fn hex_hash(bytes: &[u8]) -> String {
    digest::digest(&digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
fn clean_model(v: &Value) -> String {
    let raw = v.as_str().unwrap_or("").trim();
    if raw.is_empty() {
        return "unknown".into();
    }
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(80)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn bounded_line(reader: &mut BufReader<File>) -> io::Result<Option<(Vec<u8>, bool)>> {
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok(if overflow {
                Some((Vec::new(), false))
            } else {
                (!line.is_empty()).then_some((line, false))
            });
        }
        let newline = buf.iter().position(|b| *b == b'\n');
        let take = newline.map_or(buf.len(), |p| p + 1);
        if !overflow && line.len().saturating_add(take) <= MAX_LINE_BYTES {
            line.extend_from_slice(&buf[..take]);
        } else {
            overflow = true;
        }
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some((if overflow { Vec::new() } else { line }, true)));
        }
        if overflow {
            while !reader.fill_buf()?.is_empty() {
                let b = reader.fill_buf()?;
                if let Some(p) = b.iter().position(|x| *x == b'\n') {
                    reader.consume(p + 1);
                    return Ok(Some((Vec::new(), true)));
                }
                let n = b.len();
                reader.consume(n);
            }
            return Ok(Some((Vec::new(), false)));
        }
    }
}

pub(super) fn parse_file(
    path: &Path,
    file_tag: &str,
    events: &mut HashMap<String, Event>,
    warnings: &mut Vec<String>,
) -> Option<(u64, u64, bool)> {
    let (size, mtime, offset, complete) = parse_file_from(path, file_tag, events, warnings, 0)?;
    Some((size, mtime, complete && offset == size))
}

pub(super) fn parse_file_from(
    path: &Path,
    file_tag: &str,
    events: &mut HashMap<String, Event>,
    warnings: &mut Vec<String>,
    start_offset: u64,
) -> Option<(u64, u64, u64, bool)> {
    let meta = match fs::symlink_metadata(path) {
        Ok(v) => v,
        Err(_) => {
            warnings.push("partial_scan".into());
            return None;
        }
    };
    if !meta.is_file() || meta.len() == 0 {
        warnings.push("partial_scan".into());
        return None;
    }
    if private::safe(path).is_err() {
        warnings.push("partial_scan".into());
        return None;
    }
    let modified = match meta
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
    {
        Some(v) => v.as_nanos() as u64,
        None => {
            warnings.push("partial_scan".into());
            return None;
        }
    };
    let mut reader = match File::open(path) {
        Ok(v) => BufReader::new(v),
        Err(_) => {
            warnings.push("partial_scan".into());
            return None;
        }
    };
    if start_offset > meta.len() {
        warnings.push("partial_scan".into());
        return None;
    }
    reader.seek(SeekFrom::Start(start_offset)).ok()?;
    let mut complete_offset = start_offset;
    let mut weak = false;
    let mut complete = true;
    loop {
        let (line, terminated) = match bounded_line(&mut reader) {
            Ok(Some(v)) => v,
            Ok(None) => break,
            Err(_) => {
                warnings.push("partial_scan".into());
                complete = false;
                break;
            }
        };
        if !terminated {
            // Claude often appends a JSONL record in multiple writes. Keep the offset at
            // the start of this tail so the next poll retries only this unfinished line.
            break;
        }
        complete_offset = reader.stream_position().ok()?;
        if line.is_empty() {
            warnings.push("invalid_records".into());
            complete = false;
            continue;
        }
        let Ok(obj) = serde_json::from_slice::<Value>(&line) else {
            warnings.push("invalid_records".into());
            complete = false;
            continue;
        };
        if obj.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(current_ts) = obj
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(super::profile::parse_iso_epoch_sec)
        else {
            warnings.push("invalid_records".into());
            complete = false;
            continue;
        };
        let Some(msg) = obj.get("message") else {
            continue;
        };
        let Some(counts) = msg.get("usage").and_then(Counts::from_usage) else {
            continue;
        };
        if current_ts == 0 {
            warnings.push("invalid_records".into());
            continue;
        }
        let raw_model = msg.get("model").and_then(Value::as_str).unwrap_or("");
        if raw_model.trim().eq_ignore_ascii_case("<synthetic>") {
            continue;
        }
        let model = clean_model(&msg["model"]);
        let msg_id = msg.get("id").and_then(Value::as_str).unwrap_or("");
        let request_id = obj.get("requestId").and_then(Value::as_str).unwrap_or("");
        let session = obj
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(file_tag);
        let is_weak = msg_id.is_empty() || request_id.is_empty();
        weak |= is_weak;
        // Hash all identifiers at the boundary. The ledger never stores raw IDs, paths, or message bodies.
        let identity = if !msg_id.is_empty() && !request_id.is_empty() {
            format!("{msg_id}\0{request_id}")
        } else if !msg_id.is_empty() {
            format!("{session}\0message\0{msg_id}")
        } else if !request_id.is_empty() {
            format!("{session}\0request\0{request_id}")
        } else if let Some(uuid) = obj
            .get("uuid")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            format!("uuid\0{uuid}")
        } else {
            format!(
                "weak\0{session}\0{current_ts}\0{}\0{}\0{}\0{}",
                counts.input, counts.output, counts.creation, counts.read
            )
        };
        let event_key = hex_hash(identity.as_bytes());
        let message_key = (!msg_id.is_empty()).then(|| hex_hash(msg_id.as_bytes()));
        let sidechain = obj
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let event = Event {
            event_key: event_key.clone(),
            message_key,
            ts: current_ts,
            model,
            counts,
            account: None,
            weak: is_weak,
            sidechain,
        };
        events
            .entry(event_key)
            .and_modify(|old| {
                old.counts = old.counts.component_max(event.counts);
                if event.ts > old.ts {
                    old.ts = event.ts;
                }
                if old.model == "unknown" {
                    old.model = event.model.clone();
                }
            })
            .or_insert(event);
    }
    if weak {
        warnings.push("weak_ids".into());
    }
    Some((meta.len(), modified, complete_offset, complete))
}

// At most 8 KiB of completed data is read to distinguish normal appends from
// prefix/boundary rewrites. Store only hashes, never source bytes or paths.
fn cursor_guard(path: &Path, offset: u64) -> io::Result<String> {
    let mut file = File::open(path)?;
    let length = offset.min(4096) as usize;
    let mut sample = vec![0; length * 2];
    file.read_exact(&mut sample[..length])?;
    file.seek(SeekFrom::Start(offset.saturating_sub(length as u64)))?;
    file.read_exact(&mut sample[length..])?;
    Ok(hex_hash(&sample))
}

fn scan_dir(
    dir: &Path,
    depth: usize,
    events: &mut HashMap<String, Event>,
    warnings: &mut Vec<String>,
    cache: &mut Vec<(String, u64, u64, u64, String)>,
    known: &HashMap<String, (u64, u64, u64, String)>,
) {
    if depth > MAX_DEPTH {
        warnings.push("partial_scan".into());
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        warnings.push("partial_scan".into());
        return;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            warnings.push("partial_scan".into());
            continue;
        };
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            warnings.push("partial_scan".into());
            continue;
        };
        if super::private::safe(&path).is_err() {
            warnings.push("partial_scan".into());
            continue;
        }
        if meta.is_dir() {
            scan_dir(&path, depth + 1, events, warnings, cache, known);
        } else if meta.is_file() && path.extension().is_some_and(|x| x == "jsonl") {
            let tag = hex_hash(path.to_string_lossy().as_bytes());
            let mtime = meta
                .modified()
                .ok()
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .map(|v| v.as_nanos() as u64);
            let old = known.get(&tag).filter(|old| {
                old.2 <= meta.len()
                    && !old.3.is_empty()
                    && cursor_guard(&path, old.2).ok().as_ref() == Some(&old.3)
            });
            if let (Some(old), Some(mtime)) = (old, mtime) {
                if old.0 == meta.len() && old.1 == mtime && old.2 == meta.len() {
                    continue;
                }
            }
            let start_offset = match (old, mtime) {
                (Some(old), Some(mtime))
                    if meta.len() > old.0 || (meta.len() == old.0 && mtime == old.1) =>
                {
                    old.2.min(old.0)
                }
                _ => 0,
            };
            if let Some((len, mtime, offset, complete)) =
                parse_file_from(&path, &tag, events, warnings, start_offset)
            {
                if !complete {
                    continue;
                }
                match cursor_guard(&path, offset) {
                    Ok(guard) => cache.push((tag, len, mtime, offset, guard)),
                    Err(_) => warnings.push("partial_scan".into()),
                }
            }
        }
    }
}

pub(super) fn open_ledger(path: &Path) -> Result<Connection, String> {
    private::directory(path.parent().ok_or("usage ledger path invalid")?)?;
    if !path.exists() {
        private::create(path)
            .map_err(|_| "usage ledger cannot be created")?
            .sync_all()
            .map_err(|_| "usage ledger cannot be synced")?;
    }
    private::protect(path)?;
    let conn = Connection::open(path).map_err(|_| "usage ledger cannot be opened")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "usage ledger busy")?;
    conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS events(event_key TEXT PRIMARY KEY,message_key TEXT,ts INTEGER NOT NULL,model TEXT NOT NULL,input INTEGER NOT NULL,output INTEGER NOT NULL,creation INTEGER NOT NULL,cache_read INTEGER NOT NULL,reasoning INTEGER,account_key TEXT,weak INTEGER NOT NULL,sidechain INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS files(file_key TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS boundaries(ts INTEGER NOT NULL,account_key TEXT); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|_| "usage ledger schema unavailable")?;
    let has_offset: bool = conn
        .prepare("PRAGMA table_info(files)")
        .ok()
        .and_then(|mut q| {
            q.query_map([], |r| r.get::<_, String>(1))
                .ok()
                .map(|rows| rows.flatten().any(|n| n == "offset"))
        })
        .unwrap_or(false);
    if !has_offset {
        conn.execute(
            "ALTER TABLE files ADD COLUMN offset INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|_| "usage ledger migration failed")?;
        // Previous cache rows were only committed after a complete-file parse.
        conn.execute("UPDATE files SET offset=size", [])
            .map_err(|_| "usage ledger migration failed")?;
    }
    let has_guard: bool = conn
        .prepare("PRAGMA table_info(files)")
        .and_then(|mut q| {
            let rows = q.query_map([], |r| r.get::<_, String>(1))?;
            Ok(rows.flatten().any(|name| name == "guard"))
        })
        .map_err(|_| "usage ledger schema unavailable")?;
    if !has_guard {
        // Revalidate old cached files once; existing event ownership is unchanged.
        conn.execute(
            "ALTER TABLE files ADD COLUMN guard TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|_| "usage ledger migration failed")?;
    }
    let has_message: bool = conn
        .prepare("PRAGMA table_info(events)")
        .ok()
        .and_then(|mut q| {
            q.query_map([], |r| r.get::<_, String>(1))
                .ok()
                .map(|rows| rows.flatten().any(|n| n == "message_key"))
        })
        .unwrap_or(false);
    if !has_message {
        conn.execute("ALTER TABLE events ADD COLUMN message_key TEXT", [])
            .map_err(|_| "usage ledger migration failed")?;
    }
    let has_sidechain: bool = conn
        .prepare("PRAGMA table_info(events)")
        .ok()
        .and_then(|mut q| {
            q.query_map([], |r| r.get::<_, String>(1))
                .ok()
                .map(|rows| rows.flatten().any(|n| n == "sidechain"))
        })
        .unwrap_or(false);
    if !has_sidechain {
        conn.execute(
            "ALTER TABLE events ADD COLUMN sidechain INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|_| "usage ledger migration failed")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS events_timestamp ON events(ts); CREATE INDEX IF NOT EXISTS events_message ON events(message_key,sidechain);")
        .map_err(|_| "usage ledger index unavailable")?;
    Ok(conn)
}

fn ensure_tracking_start(conn: &Connection, vault: &Path, home: &Path) {
    let has: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='tracking_since'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if has.is_some() {
        return;
    }
    // A legacy lower bound is trusted only when the persisted active slot matches the live HMAC account.
    let db = match identity_db_readonly(vault) {
        Ok(v) => v,
        Err(_) => return,
    };
    let active: String = match db.query_row("SELECT value FROM state WHERE key='active'", [], |r| {
        r.get(0)
    }) {
        Ok(v) => v,
        Err(_) => return,
    };
    let account = match live_account_key(vault, home) {
        Some(v) => v,
        None => return,
    };
    let owner: Option<String> = db
        .query_row(
            "SELECT id FROM identities WHERE account_key=?1 AND empty=0",
            [&account],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if owner.as_deref() != Some(active.as_str()) {
        return;
    }
    let since = db
        .query_row(
            "SELECT value FROM state WHERE key='active_since'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or_else(now);
    let _ = conn.execute(
        "INSERT OR IGNORE INTO meta(key,value) VALUES('tracking_since',?1)",
        [since.to_string()],
    );
    let _ = conn.execute(
        "INSERT INTO boundaries(ts,account_key) VALUES(?1,?2)",
        params![since as i64, account],
    );
}

fn identity_db_readonly(vault: &Path) -> Result<Connection, String> {
    let path = vault.join("identities.sqlite");
    private::parents(vault)?;
    private::safe(&path)?;
    Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "identity index unavailable".into())
}
fn live_account_key(vault: &Path, home: &Path) -> Option<String> {
    let key_path = vault.join("key.bin");
    private::parents(vault).ok()?;
    if private::safe(&key_path).is_err() {
        return None;
    }
    let key = zeroize::Zeroizing::new(fs::read(key_path).ok()?);
    if key.len() != 32 {
        return None;
    }
    catalog::live_key(home, &key).ok().flatten()
}
fn mark_external_gap(conn: &Connection, vault: &Path, home: &Path) {
    let latest: Option<Option<String>> = conn
        .query_row(
            "SELECT account_key FROM boundaries ORDER BY ts DESC,rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(Some(previous)) = latest else {
        return;
    };
    let active = identity_db_readonly(vault).ok().and_then(|db| {
        db.query_row("SELECT value FROM state WHERE key='active'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
    });
    let actual = live_account_key(vault, home);
    let valid = if let (Some(key), Some(id)) = (actual.as_ref(), active.as_ref()) {
        identity_db_readonly(vault).ok().and_then(|db| {
            db.query_row(
                "SELECT id FROM identities WHERE account_key=?1 AND empty=0",
                [key],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .filter(|found| found == id)
            .map(|_| key.clone())
        })
    } else {
        None
    };
    if valid.as_deref() == Some(previous.as_str()) {
        return;
    }
    let cutoff = conn
        .query_row("SELECT value FROM meta WHERE key='last_scan'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u64>().ok())
        .or_else(|| {
            conn.query_row(
                "SELECT value FROM meta WHERE key='tracking_since'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u64>().ok())
        })
        .unwrap_or_else(now);
    let _ = conn.execute(
        "INSERT INTO boundaries(ts,account_key) VALUES(?1,NULL)",
        params![cutoff as i64],
    );
}

pub(super) fn persist_scan(
    conn: &Connection,
    events: HashMap<String, Event>,
    boundaries: &[(u64, Option<String>)],
    cache: &[(String, u64, u64, u64, String)],
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|_| "usage ledger write failed")?;
    let mut sorted: Vec<_> = events.into_values().collect();
    sorted.sort_by_key(|e| e.ts);
    let mut bounds = boundaries.to_vec();
    bounds.sort_by_key(|b| b.0);
    for mut e in sorted {
        e.account = bounds
            .iter()
            .rev()
            .find(|(ts, _)| *ts <= e.ts)
            .and_then(|(_, a)| a.clone());
        if let Some(message_key) = e.message_key.as_ref() {
            let parent_exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM events WHERE message_key=?1 AND sidechain=0)",
                    [message_key],
                    |r| r.get(0),
                )
                .map_err(|_| "usage event lookup failed")?;
            if e.sidechain && parent_exists {
                continue;
            }
            if !e.sidechain {
                tx.execute(
                    "DELETE FROM events WHERE message_key=?1 AND sidechain=1",
                    [message_key],
                )
                .map_err(|_| "usage replay cleanup failed")?;
            }
        }
        tx.execute("INSERT INTO events(event_key,message_key,ts,model,input,output,creation,cache_read,reasoning,account_key,weak,sidechain) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(event_key) DO UPDATE SET ts=MAX(events.ts,excluded.ts),input=MAX(events.input,excluded.input),output=MAX(events.output,excluded.output),creation=MAX(events.creation,excluded.creation),cache_read=MAX(events.cache_read,excluded.cache_read),reasoning=CASE WHEN events.reasoning IS NULL THEN excluded.reasoning WHEN excluded.reasoning IS NULL THEN events.reasoning ELSE MAX(events.reasoning,excluded.reasoning) END,model=CASE WHEN events.model='unknown' THEN excluded.model ELSE events.model END,weak=MIN(events.weak,excluded.weak)",params![e.event_key,e.message_key,e.ts as i64,e.model,e.counts.input as i64,e.counts.output as i64,e.counts.creation as i64,e.counts.read as i64,e.counts.reasoning.map(|x|x as i64),e.account,e.weak as i64,e.sidechain as i64]).map_err(|_|"usage event write failed")?;
    }
    for (key, size, mtime, offset, guard) in cache {
        tx.execute("INSERT INTO files(file_key,size,mtime,offset,guard) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(file_key) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,offset=excluded.offset,guard=excluded.guard",params![key,*size as i64,*mtime as i64,*offset as i64,guard]).map_err(|_|"usage cache write failed")?;
    }
    tx.execute("INSERT INTO meta(key,value) VALUES('last_scan',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[now().to_string()]).map_err(|_|"usage scan timestamp write failed")?;
    tx.commit().map_err(|_| "usage ledger commit failed".into())
}

fn offset_start(period: &str, now_sec: u64, offset: i32) -> Result<Option<u64>, String> {
    if !(-840..=840).contains(&offset) {
        return Err("offset_minutes must be within ±840".into());
    }
    if period == "all" {
        return Ok(None);
    }
    let local_now = (now_sec as i64).saturating_add((offset as i64) * 60);
    let day = local_now.div_euclid(86400);
    let days = match period {
        "today" => 0,
        "week" => 6,
        "month" => 29,
        _ => return Err("period must be all/today/week/month".into()),
    };
    Ok(Some(
        ((day - days) * 86400 - offset as i64 * 60).max(0) as u64
    ))
}
pub(super) fn day_label(ts: u64, offset: i32) -> String {
    let z = (ts as i64 + offset as i64 * 60).div_euclid(86400) + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    if m <= 2 {
        y += 1;
    }
    format!("{y:04}-{m:02}-{d:02}")
}
fn hour_label(ts: u64, offset: i32) -> String {
    let local = (ts as i64).saturating_add(offset as i64 * 60);
    format!(
        "{}T{:02}:00",
        day_label(ts, offset),
        local.div_euclid(3600).rem_euclid(24)
    )
}
pub(super) fn bucket_span(
    period: &str,
    now_sec: u64,
    offset: i32,
    earliest: Option<i64>,
) -> (i64, i64) {
    let local = (now_sec as i64).saturating_add(offset as i64 * 60);
    let day = local.div_euclid(86400);
    match period {
        "today" => (day * 24, local.div_euclid(3600)),
        "week" => (day - 6, day),
        "month" => (day - 29, day),
        _ => (earliest.unwrap_or(day), day),
    }
}
fn add_row(
    out: &mut UsageTotals,
    input: i64,
    output: i64,
    creation: i64,
    read: i64,
    reasoning: Option<i64>,
) {
    Counts {
        input: input.max(0) as u64,
        output: output.max(0) as u64,
        creation: creation.max(0) as u64,
        read: read.max(0) as u64,
        reasoning: reasoning.map(|x| x.max(0) as u64),
    }
    .add_to(out);
}

pub(crate) fn collect_before_switch(vault: &Path, home: &Path, _account_key: Option<&str>) {
    let projects = home.join(".claude").join("projects");
    let Ok(meta) = fs::symlink_metadata(&projects) else {
        return;
    };
    if !meta.is_dir() || private::safe(&projects).is_err() {
        return;
    }
    let ledger_path = vault.join("usage.sqlite");
    let Ok(conn) = open_ledger(&ledger_path) else {
        return;
    };
    ensure_tracking_start(&conn, vault, home);
    mark_external_gap(&conn, vault, home);
    let mut known = HashMap::new();
    if let Ok(mut q) = conn.prepare("SELECT file_key,size,mtime,offset,guard FROM files") {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?.max(0) as u64,
                r.get::<_, i64>(2)?.max(0) as u64,
                r.get::<_, i64>(3)?.max(0) as u64,
                r.get::<_, String>(4)?,
            ))
        }) {
            known.extend(rows.flatten().map(|(k, s, m, o, g)| (k, (s, m, o, g))));
        }
    }
    let mut events = HashMap::new();
    let mut warnings = Vec::new();
    let mut cache = Vec::new();
    scan_dir(&projects, 0, &mut events, &mut warnings, &mut cache, &known);
    let mut boundaries = Vec::new();
    if let Ok(mut q) = conn.prepare("SELECT ts,account_key FROM boundaries ORDER BY ts") {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?.max(0) as u64,
                r.get::<_, Option<String>>(1)?,
            ))
        }) {
            boundaries.extend(rows.flatten());
        }
    }
    let _ = persist_scan(&conn, events, &boundaries, &cache);
}

pub(crate) fn commit_switch_boundary(vault: &Path, home: &Path, account_key: Option<&str>) {
    let Ok(conn) = open_ledger(&vault.join("usage.sqlite")) else {
        return;
    };
    ensure_tracking_start(&conn, vault, home);
    let verified = account_key
        .filter(|requested| live_account_key(vault, home).as_deref() == Some(*requested))
        .and_then(|requested| {
            let db = identity_db_readonly(vault).ok()?;
            let active = db
                .query_row("SELECT value FROM state WHERE key='active'", [], |r| {
                    r.get::<_, String>(0)
                })
                .optional()
                .ok()
                .flatten()?;
            let owner = db
                .query_row(
                    "SELECT account_key FROM identities WHERE id=?1 AND empty=0",
                    [active],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()
                .ok()
                .flatten()?;
            (owner.as_deref() == Some(requested)).then_some(requested)
        });
    // JSONL timestamps have second precision. Leave the switching second unknown so a
    // request written on either side of the filesystem commit cannot be assigned wrongly.
    let boundary = now();
    let _ = conn.execute(
        "INSERT INTO boundaries(ts,account_key) VALUES(?1,NULL)",
        params![boundary as i64],
    );
    if let Some(account) = verified {
        let _ = conn.execute(
            "INSERT INTO boundaries(ts,account_key) VALUES(?1,?2)",
            params![boundary.saturating_add(1) as i64, account],
        );
    }
}

#[tauri::command]
pub async fn usage_statistics_read(
    app: tauri::AppHandle,
    period: String,
    account_id: Option<String>,
    offset_minutes: i32,
    fallback_account_name: Option<String>,
) -> Result<UsageSnapshot, String> {
    if !(-840..=840).contains(&offset_minutes) {
        return Err("offset_minutes must be within ±840".into());
    }
    if !matches!(period.as_str(), "all" | "today" | "week" | "month") {
        return Err("period must be all/today/week/month".into());
    }
    if let Some(id) = account_id.as_deref() {
        if id != "unattributed" && !super::valid_id(id) {
            return Err("account_id is invalid".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        cleaner.enter()?;
        let result = (|| {
            let vault = app
                .path()
                .app_data_dir()
                .map_err(|_| "usage ledger unavailable")?
                .join("identity-vault");
            let home = crate::cleaner::identity::root()?;
            read_at_with_fallback(
                &vault,
                &home,
                &period,
                account_id.as_deref(),
                offset_minutes,
                fallback_account_name.as_deref(),
            )
        })();
        cleaner.leave();
        result
    })
    .await
    .map_err(|_| "usage statistics worker interrupted".to_string())?
}

pub(super) fn read_at(
    vault: &Path,
    home: &Path,
    period: &str,
    account_id: Option<&str>,
    offset: i32,
) -> Result<UsageSnapshot, String> {
    read_at_with_fallback(vault, home, period, account_id, offset, None)
}

pub(super) fn read_at_with_fallback(
    vault: &Path, home: &Path, period: &str, account_id: Option<&str>, offset: i32,
    fallback_name: Option<&str>,
) -> Result<UsageSnapshot, String> {
    let ledger_path = vault.join("usage.sqlite");
    let mut warnings = Vec::new();
    let conn = open_ledger(&ledger_path)?;
    ensure_tracking_start(&conn, vault, home);
    mark_external_gap(&conn, vault, home);
    let mut events = HashMap::new();
    let mut cache = Vec::new();
    let mut known = HashMap::new();
    if let Ok(meta) = fs::symlink_metadata(home.join(".claude/projects")) {
        let projects = home.join(".claude/projects");
        if meta.is_dir() && private::safe(&projects).is_ok() {
            if let Ok(mut q) = conn.prepare("SELECT file_key,size,mtime,offset,guard FROM files") {
                if let Ok(rows) = q.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?.max(0) as u64,
                        r.get::<_, i64>(2)?.max(0) as u64,
                        r.get::<_, i64>(3)?.max(0) as u64,
                        r.get::<_, String>(4)?,
                    ))
                }) {
                    known.extend(rows.flatten().map(|(k, s, m, o, g)| (k, (s, m, o, g))));
                }
            }
            scan_dir(&projects, 0, &mut events, &mut warnings, &mut cache, &known);
        }
    }
    let mut boundaries = Vec::new();
    if let Ok(mut q) = conn.prepare("SELECT ts,account_key FROM boundaries ORDER BY ts") {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?.max(0) as u64,
                r.get::<_, Option<String>>(1)?,
            ))
        }) {
            boundaries.extend(rows.flatten());
        }
    }
    if persist_scan(&conn, events, boundaries.as_slice(), &cache).is_err() {
        warnings.push("partial_scan".into());
    }
    let tracking = conn
        .query_row(
            "SELECT value FROM meta WHERE key='tracking_since'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|x| x.parse().ok());
    let tracking = if let Some(v) = tracking {
        Some(v)
    } else {
        warnings.push("attribution_gap".into());
        let v = now();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO meta(key,value) VALUES('tracking_since',?1)",
            [v.to_string()],
        );
        Some(v)
    };
    let db = identity_db_readonly(vault).ok();
    let active = db.as_ref().and_then(|d| {
        d.query_row("SELECT value FROM state WHERE key='active'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
    });
    let live = if db.is_some() {
        live_account_key(vault, home)
    } else {
        None
    };
    let current = db
        .as_ref()
        .and_then(|d| {
            live.as_ref().and_then(|key| {
                d.query_row(
                    "SELECT id FROM identities WHERE account_key=?1 AND empty=0",
                    [key],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
            })
        })
        .filter(|id| active.as_deref() == Some(id));
    let mut account_map: HashMap<String, UsageAccount> = HashMap::new();
    let mut unbound_accounts = Vec::new();
    let mut key_to_id = HashMap::new();
    let mut summaries = HashMap::new();
    if let Some(db) = db.as_ref() {
        if let Ok(mut q) = db.prepare("SELECT id,summary FROM identity_summaries") {
            if let Ok(rows) =
                q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for row in rows.flatten() {
                    if let Ok(v) = serde_json::from_str::<Value>(&row.1) {
                        summaries.insert(row.0, v);
                    }
                }
            }
        }
        if let Ok(mut q) = db.prepare(
            "SELECT id,name,account_key FROM identities WHERE empty=0 ORDER BY saved_at DESC,id",
        ) {
            if let Ok(rows) = q.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    let (id, name, key) = row;
                    let email = summaries
                        .get(&id)
                        .and_then(|v| v.get("email"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let account = UsageAccount {
                        id: id.clone(),
                        name,
                        email,
                        current: current.as_deref() == Some(&id),
                        totals: UsageTotals::default(),
                    };
                    if let Some(key) = key.filter(|k| !k.is_empty()) {
                        key_to_id.entry(key.clone()).or_insert(id);
                        account_map.entry(key).or_insert(account);
                    } else {
                        unbound_accounts.push(account);
                    }
                }
            }
        }
    }
    if !unbound_accounts.is_empty() {
        warnings.push("attribution_gap".into());
    }
    // Persist only a stable catalog ID. A private build preference seeds the first
    // selection; renaming never redirects history to a different account.
    let saved_fallback: Option<String> = conn.query_row(
        "SELECT value FROM meta WHERE key='fallback_account_id'", [], |r| r.get(0)
    ).optional().map_err(|_| "usage attribution unavailable")?;
    let candidates: Vec<_> = account_map.values().filter(|a| Some(a.name.as_str()) == fallback_name).collect();
    if saved_fallback.is_none() && candidates.len() == 1 {
        conn.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('fallback_account_id',?1)",
            [&candidates[0].id]).map_err(|_| "usage attribution unavailable")?;
    }
    let fallback_id: Option<String> = conn.query_row(
        "SELECT value FROM meta WHERE key='fallback_account_id'", [], |r| r.get(0)
    ).optional().map_err(|_| "usage attribution unavailable")?;
    let fallback_id = fallback_id.filter(|id| account_map.values().any(|a| &a.id == id));
    let snapshot_now = now();
    let start = offset_start(period, snapshot_now, offset)?;
    let weak_from = start.unwrap_or(0).min(i64::MAX as u64) as i64;
    let has_weak: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE weak=1 AND ts>=?1 AND ts<=?2)",
            params![weak_from, snapshot_now as i64],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if has_weak {
        warnings.push("weak_ids".into());
    }
    let mut rows = Vec::new();
    {
        let mut q=conn.prepare("SELECT COALESCE(account_key,''),ts,model,input,output,creation,cache_read,reasoning FROM events WHERE ts>=?1 AND ts<=?2 ORDER BY ts").map_err(|_|"usage ledger unavailable")?;
        let mapped = q
            .query_map(params![weak_from, snapshot_now as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?.max(0) as u64,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                ))
            })
            .map_err(|_| "usage ledger unavailable")?;
        for row in mapped {
            if let Ok(x) = row {
                rows.push(x);
            }
        }
    }
    let mut totals = UsageTotals::default();
    let mut unknown = UsageTotals::default();
    let hourly = period == "today";
    let mut buckets: BTreeMap<i64, UsageTotals> = BTreeMap::new();
    let mut models: BTreeMap<String, UsageTotals> = BTreeMap::new();
    for (owner, ts, model, i, o, c, r, reason) in rows {
        if start.is_some_and(|s| ts < s) || ts > snapshot_now {
            continue;
        }
        let id = key_to_id.get(&owner).cloned().or_else(|| fallback_id.clone());
        if owner.is_empty() && id.is_none() {
            add_row(&mut unknown, i, o, c, r, reason);
        } else if let Some(id) = id.as_ref() {
            if let Some(a) = account_map.values_mut().find(|a| &a.id == id) {
                add_row(&mut a.totals, i, o, c, r, reason);
            }
        }
        let selected = match account_id {
            None => id.is_some(),
            Some("unattributed") => owner.is_empty() && id.is_none(),
            Some(filter) => id.as_deref() == Some(filter),
        };
        if selected {
            add_row(&mut totals, i, o, c, r, reason);
            let local_second = (ts as i64).saturating_add(offset as i64 * 60);
            let bucket = if hourly {
                local_second.div_euclid(3600)
            } else {
                local_second.div_euclid(86400)
            };
            add_row(buckets.entry(bucket).or_default(), i, o, c, r, reason);
            add_row(models.entry(model).or_default(), i, o, c, r, reason);
        }
    }
    if unknown.requests > 0 {
        warnings.push("attribution_gap".into());
    }
    if !warnings.is_empty() {
        warnings.sort();
        warnings.dedup();
    }
    let mut accounts: Vec<_> = account_map.into_values().collect();
    accounts.extend(unbound_accounts);
    let earliest = buckets.keys().next().copied();
    let (first_bucket, last_bucket) = bucket_span(period, snapshot_now, offset, earliest);
    let daily = if first_bucket <= last_bucket {
        (first_bucket..=last_bucket)
            .map(|bucket| {
                let label = if hourly {
                    hour_label((bucket * 3600 - offset as i64 * 60).max(0) as u64, offset)
                } else {
                    day_label((bucket * 86400 - offset as i64 * 60).max(0) as u64, offset)
                };
                UsageDaily {
                    day: label,
                    totals: buckets.remove(&bucket).unwrap_or_default(),
                }
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(UsageSnapshot {
        generated_at: snapshot_now,
        tracking_since: tracking,
        totals,
        unattributed: unknown,
        accounts,
        daily,
        granularity: if hourly { "hour" } else { "day" }.into(),
        models: models
            .into_iter()
            .map(|(model, totals)| UsageModel { model, totals })
            .collect(),
        warnings,
    })
}
