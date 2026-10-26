// [INPUT]: Bounded Claude Code usage JSONL, identity HMAC keys, private SQLite ledger and optional IANA display timezone.
// [OUTPUT]: Redacted aggregates, per-model reasoning effort breakdowns, DST-correct local calendar trends with explicit hourly intervals, and stable fallback attribution.
// [POS]: Read-only identity usage command and pre-switch collection boundary; never reads credentials, archives, or session bodies into the ledger.
// [PROTOCOL]: Complete-line offsets, bounded prefix/tail hashes, and bounded cursor effort context live only in the usage ledger; identity database user_version remains 3. See identities/CLAUDE.md.
use super::{catalog, private};
use chrono::{DateTime, Datelike, Days, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::{GapInfo, Tz};
use ring::digest;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
static USAGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<u64>,
    pub totals: UsageTotals,
}
#[derive(Clone, Serialize)]
pub struct UsageEffort {
    pub effort: String,
    pub totals: UsageTotals,
}
#[derive(Clone, Serialize)]
pub struct UsageModel {
    pub model: String,
    pub totals: UsageTotals,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub efforts: Vec<UsageEffort>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct UsageAttributionConfig {
    pub fallback_account_id: Option<String>,
    pub fallback_account_name: Option<String>,
    pub unassigned_requests: u64,
    pub unassigned_tokens: u64,
}

#[derive(Clone, Serialize)]
pub struct UsageSnapshot {
    pub generated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    pub tracking_since: Option<u64>,
    pub totals: UsageTotals,
    pub unattributed: UsageTotals,
    pub accounts: Vec<UsageAccount>,
    pub daily: Vec<UsageDaily>,
    pub granularity: String,
    pub models: Vec<UsageModel>,
    pub warnings: Vec<String>,
    pub attribution: UsageAttributionConfig,
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
    pub effort: String,
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
pub(super) const USAGE_PARSER_VERSION: i64 = 1;
pub(super) const MAX_EFFORT_RECOVERY_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug)]
pub(super) struct FileCursor {
    pub size: u64,
    pub mtime: u64,
    pub offset: u64,
    pub guard: String,
    pub effort: String,
    pub parser_version: i64,
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

fn clean_effort_str(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(24)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn clean_effort(obj: &Value, msg: &Value) -> String {
    let raw = obj
        .get("perTurnEffort")
        .and_then(Value::as_str)
        .or_else(|| obj.get("effort").and_then(Value::as_str))
        .or_else(|| msg.get("perTurnEffort").and_then(Value::as_str))
        .or_else(|| msg.get("effort").and_then(Value::as_str))
        .unwrap_or("")
        .trim();
    clean_effort_str(raw)
}

fn recover_prefix_effort(path: &Path, start_offset: u64) -> String {
    if start_offset == 0 {
        return String::new();
    }
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let scan_start = start_offset.saturating_sub(MAX_EFFORT_RECOVERY_BYTES);
    if file.seek(SeekFrom::Start(scan_start)).is_err() {
        return String::new();
    }
    let mut reader = BufReader::new(file);
    if scan_start > 0 {
        // Discard the initial partial line so only cleanly delimited lines are parsed.
        match bounded_line(&mut reader) {
            Ok(Some((_, true))) => {}
            _ => return String::new(),
        }
    }
    let mut recovered = String::new();
    loop {
        let pos = match reader.stream_position() {
            Ok(p) => p,
            Err(_) => break,
        };
        if pos >= start_offset {
            break;
        }
        let (line, terminated) = match bounded_line(&mut reader) {
            Ok(Some(v)) => v,
            _ => break,
        };
        if !terminated {
            break;
        }
        let end_pos = match reader.stream_position() {
            Ok(p) => p,
            Err(_) => break,
        };
        if end_pos > start_offset {
            break;
        }
        if line.is_empty() {
            continue;
        }
        if let Ok(obj) = serde_json::from_slice::<Value>(&line) {
            let effort = clean_effort(&obj, obj.get("message").unwrap_or(&Value::Null));
            if !effort.is_empty() {
                recovered = effort;
            }
        }
    }
    recovered
}

fn effort_rank(effort: &str) -> u8 {
    match effort {
        "max" => 0,
        "xhigh" => 1,
        "high" => 2,
        "medium" => 3,
        "low" => 4,
        _ => 5,
    }
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
    let (size, mtime, offset, complete, _) =
        parse_file_from_with_context(path, file_tag, events, warnings, 0, "")?;
    Some((size, mtime, complete && offset == size))
}

pub(super) fn parse_file_from(
    path: &Path,
    file_tag: &str,
    events: &mut HashMap<String, Event>,
    warnings: &mut Vec<String>,
    start_offset: u64,
) -> Option<(u64, u64, u64, bool)> {
    let (size, mtime, offset, complete, _) =
        parse_file_from_with_context(path, file_tag, events, warnings, start_offset, "")?;
    Some((size, mtime, offset, complete))
}

pub(super) fn parse_file_from_with_context(
    path: &Path,
    file_tag: &str,
    events: &mut HashMap<String, Event>,
    warnings: &mut Vec<String>,
    start_offset: u64,
    initial_effort: &str,
) -> Option<(u64, u64, u64, bool, String)> {
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
    let mut last_effort = clean_effort_str(initial_effort);
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
        let line_effort = clean_effort(&obj, obj.get("message").unwrap_or(&Value::Null));
        if !line_effort.is_empty() {
            last_effort = line_effort.clone();
        }
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
        let effort = if !line_effort.is_empty() {
            line_effort
        } else {
            last_effort.clone()
        };
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
            effort,
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
                if old.effort.is_empty() && !event.effort.is_empty() {
                    old.effort = event.effort.clone();
                }
            })
            .or_insert(event);
    }
    if weak {
        warnings.push("weak_ids".into());
    }
    Some((meta.len(), modified, complete_offset, complete, last_effort))
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
    cache: &mut Vec<(String, u64, u64, u64, String, String, i64)>,
    known: &HashMap<String, FileCursor>,
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
                old.offset <= meta.len()
                    && !old.guard.is_empty()
                    && cursor_guard(&path, old.offset).ok().as_ref() == Some(&old.guard)
            });
            if let (Some(old), Some(mtime)) = (old, mtime) {
                if old.size == meta.len() && old.mtime == mtime && old.offset == meta.len() {
                    continue;
                }
            }
            let (start_offset, initial_effort) = match (old, mtime) {
                (Some(old), Some(mtime))
                    if meta.len() > old.size || (meta.len() == old.size && mtime == old.mtime) =>
                {
                    let offset = old.offset.min(old.size);
                    let effort = if old.parser_version >= USAGE_PARSER_VERSION {
                        clean_effort_str(&old.effort)
                    } else if offset > 0 {
                        recover_prefix_effort(&path, offset)
                    } else {
                        String::new()
                    };
                    (offset, effort)
                }
                _ => (0, String::new()),
            };
            if let Some((len, mtime, offset, complete, last_effort)) = parse_file_from_with_context(
                &path,
                &tag,
                events,
                warnings,
                start_offset,
                &initial_effort,
            ) {
                if !complete {
                    continue;
                }
                match cursor_guard(&path, offset) {
                    Ok(guard) => cache.push((
                        tag,
                        len,
                        mtime,
                        offset,
                        guard,
                        last_effort,
                        USAGE_PARSER_VERSION,
                    )),
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
    conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS events(event_key TEXT PRIMARY KEY,message_key TEXT,ts INTEGER NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL DEFAULT '',input INTEGER NOT NULL,output INTEGER NOT NULL,creation INTEGER NOT NULL,cache_read INTEGER NOT NULL,reasoning INTEGER,account_key TEXT,weak INTEGER NOT NULL,sidechain INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS files(file_key TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,guard TEXT NOT NULL DEFAULT '',effort TEXT NOT NULL DEFAULT '',parser_version INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS boundaries(ts INTEGER NOT NULL,account_key TEXT); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|_| "usage ledger schema unavailable")?;
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
    let (has_file_effort, has_parser_version): (bool, bool) = conn
        .prepare("PRAGMA table_info(files)")
        .and_then(|mut q| {
            let rows = q.query_map([], |r| r.get::<_, String>(1))?;
            let mut effort = false;
            let mut version = false;
            for col in rows.flatten() {
                if col == "effort" {
                    effort = true;
                }
                if col == "parser_version" {
                    version = true;
                }
            }
            Ok((effort, version))
        })
        .map_err(|_| "usage ledger schema unavailable")?;
    if !has_file_effort {
        conn.execute(
            "ALTER TABLE files ADD COLUMN effort TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|_| "usage ledger migration failed")?;
    }
    if !has_parser_version {
        conn.execute(
            "ALTER TABLE files ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0",
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
    let has_effort: bool = conn
        .prepare("PRAGMA table_info(events)")
        .ok()
        .and_then(|mut q| {
            q.query_map([], |r| r.get::<_, String>(1))
                .ok()
                .map(|rows| rows.flatten().any(|n| n == "effort"))
        })
        .unwrap_or(false);
    if !has_effort {
        conn.execute(
            "ALTER TABLE events ADD COLUMN effort TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|_| "usage ledger migration failed")?;
        conn.execute("UPDATE files SET guard=''", [])
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
    cache: &[(String, u64, u64, u64, String, String, i64)],
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
        tx.execute("INSERT INTO events(event_key,message_key,ts,model,effort,input,output,creation,cache_read,reasoning,account_key,weak,sidechain) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(event_key) DO UPDATE SET ts=MAX(events.ts,excluded.ts),input=MAX(events.input,excluded.input),output=MAX(events.output,excluded.output),creation=MAX(events.creation,excluded.creation),cache_read=MAX(events.cache_read,excluded.cache_read),reasoning=CASE WHEN events.reasoning IS NULL THEN excluded.reasoning WHEN excluded.reasoning IS NULL THEN events.reasoning ELSE MAX(events.reasoning,excluded.reasoning) END,model=CASE WHEN events.model='unknown' THEN excluded.model ELSE events.model END,effort=CASE WHEN excluded.effort!='' THEN excluded.effort ELSE events.effort END,weak=MIN(events.weak,excluded.weak)",params![e.event_key,e.message_key,e.ts as i64,e.model,e.effort,e.counts.input as i64,e.counts.output as i64,e.counts.creation as i64,e.counts.read as i64,e.counts.reasoning.map(|x|x as i64),e.account,e.weak as i64,e.sidechain as i64]).map_err(|_|"usage event write failed")?;
    }
    for (key, size, mtime, offset, guard, effort, parser_version) in cache {
        tx.execute(
            "INSERT INTO files(file_key,size,mtime,offset,guard,effort,parser_version) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(file_key) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,offset=excluded.offset,guard=excluded.guard,effort=excluded.effort,parser_version=excluded.parser_version",
            params![
                key,
                *size as i64,
                *mtime as i64,
                *offset as i64,
                guard,
                effort,
                *parser_version,
            ],
        )
        .map_err(|_| "usage cache write failed")?;
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
        "yesterday" => 1,
        "week" => 6,
        "month" => 29,
        _ => return Err("period must be all/today/yesterday/week/month".into()),
    };
    Ok(Some(
        ((day - days) * 86400 - offset as i64 * 60).max(0) as u64
    ))
}

fn offset_end(period: &str, now_sec: u64, offset: i32) -> Option<u64> {
    if period == "yesterday" {
        offset_start("today", now_sec, offset).ok().flatten()
    } else {
        None
    }
}

const INVALID_TIMEZONE: &str = "usage timezone is invalid";
const INVALID_TIME_RANGE: &str = "usage time range is invalid";

fn parse_timezone(timezone: Option<&str>) -> Result<Option<Tz>, String> {
    timezone
        .map(|name| name.parse::<Tz>().map_err(|_| INVALID_TIMEZONE.into()))
        .transpose()
}

fn local_datetime(timezone: Tz, ts: u64) -> Result<DateTime<Tz>, String> {
    i64::try_from(ts)
        .ok()
        .and_then(|ts| DateTime::<Utc>::from_timestamp(ts, 0))
        .map(|utc| utc.with_timezone(&timezone))
        .ok_or_else(|| INVALID_TIME_RANGE.into())
}

// Midnight can be ambiguous or absent in IANA history. Choose the earliest
// occurrence, or the first valid instant of the civil day after a midnight gap.
// A wholly skipped date shares the next date's boundary and still has a zero row.
fn local_midnight(timezone: Tz, date: NaiveDate) -> Result<u64, String> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or(INVALID_TIME_RANGE)?;
    timezone
        .from_local_datetime(&midnight)
        .earliest()
        .or_else(|| GapInfo::new(&midnight, &timezone).and_then(|gap| gap.end))
        .map(|value| value.timestamp().max(0) as u64)
        .ok_or_else(|| INVALID_TIME_RANGE.into())
}

fn named_start(period: &str, clock: u64, timezone: Tz) -> Result<Option<u64>, String> {
    let days = match period {
        "all" => return Ok(None),
        "today" => 0,
        "yesterday" => 1,
        "week" => 6,
        "month" => 29,
        _ => return Err("period must be all/today/yesterday/week/month".into()),
    };
    let date = local_datetime(timezone, clock)?
        .date_naive()
        .checked_sub_days(Days::new(days))
        .ok_or(INVALID_TIME_RANGE)?;
    local_midnight(timezone, date).map(Some)
}

fn named_end(period: &str, clock: u64, timezone: Tz) -> Result<Option<u64>, String> {
    if period == "yesterday" {
        named_start("today", clock, timezone)
    } else {
        Ok(None)
    }
}

fn named_hour_slots(timezone: Tz, clock: u64, yesterday: bool) -> Result<Vec<UsageDaily>, String> {
    let mut date = local_datetime(timezone, clock)?.date_naive();
    if yesterday {
        date = date.pred_opt().ok_or(INVALID_TIME_RANGE)?;
    }
    let start = local_midnight(timezone, date)?;
    let end = local_midnight(timezone, date.succ_opt().ok_or(INVALID_TIME_RANGE)?)?;
    let mut boundaries = vec![start, end];
    for hour in 0..24 {
        let local = date.and_hms_opt(hour, 0, 0).ok_or(INVALID_TIME_RANGE)?;
        match timezone.from_local_datetime(&local) {
            LocalResult::Single(value) => boundaries.push(value.timestamp().max(0) as u64),
            LocalResult::Ambiguous(first, second) => {
                boundaries.push(first.timestamp().max(0) as u64);
                boundaries.push(second.timestamp().max(0) as u64);
            }
            LocalResult::None => {}
        }
    }
    // Include offset changes that occur between wall-hour boundaries (e.g.
    // Lord Howe's thirty-minute rollback). Read offsets from the IANA database;
    // locate the exact transition second rather than rounding the interval.
    let offset = |ts| {
        local_datetime(timezone, ts).map(|value| {
            value
                .naive_local()
                .signed_duration_since(value.naive_utc())
                .num_seconds()
        })
    };
    let mut previous = start;
    let mut previous_offset = offset(start)?;
    while previous < end {
        let next = previous.saturating_add(60).min(end);
        let next_offset = offset(next)?;
        if next_offset != previous_offset {
            let (mut left, mut right) = (previous, next);
            while right - left > 1 {
                let mid = left + (right - left) / 2;
                if offset(mid)? == previous_offset {
                    left = mid;
                } else {
                    right = mid;
                }
            }
            boundaries.push(right);
        }
        previous = next;
        previous_offset = next_offset;
    }
    boundaries.retain(|boundary| *boundary >= start && *boundary <= end);
    boundaries.sort_unstable();
    boundaries.dedup();
    boundaries
        .windows(2)
        .map(|interval| {
            Ok(UsageDaily {
                day: local_datetime(timezone, interval[0])?
                    .format("%Y-%m-%dT%H:%M%:z")
                    .to_string(),
                start_at: Some(interval[0]),
                end_at: Some(interval[1]),
                totals: UsageTotals::default(),
            })
        })
        .collect()
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
        "yesterday" => ((day - 1) * 24, day * 24 - 1),
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
    let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
    if let Ok(mut q) = conn.prepare(
        "SELECT file_key,size,mtime,offset,guard,COALESCE(effort,''),COALESCE(parser_version,0) FROM files",
    ) {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                FileCursor {
                    size: r.get::<_, i64>(1)?.max(0) as u64,
                    mtime: r.get::<_, i64>(2)?.max(0) as u64,
                    offset: r.get::<_, i64>(3)?.max(0) as u64,
                    guard: r.get::<_, String>(4)?,
                    effort: r.get::<_, String>(5)?,
                    parser_version: r.get::<_, i64>(6)?,
                },
            ))
        }) {
            known.extend(rows.flatten());
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
    let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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

fn ensure_default_fallback_account(vault: &Path) {
    let Ok(config) = read_attribution_config(vault) else {
        return;
    };
    if config.fallback_account_id.is_some() {
        return;
    }
    let Ok(db) = identity_db_readonly(vault) else {
        return;
    };
    let active: Option<String> = db
        .query_row("SELECT value FROM state WHERE key='active'", [], |r| {
            r.get(0)
        })
        .optional()
        .ok()
        .flatten();
    let default_id: Option<String> = active
        .filter(|id| {
            db.query_row(
                "SELECT EXISTS(SELECT 1 FROM identities WHERE id=?1 AND empty=0 AND account_key IS NOT NULL AND account_key != '')",
                [id],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(false)
        })
        .or_else(|| {
            db.query_row(
                "SELECT id FROM identities WHERE empty=0 AND account_key IS NOT NULL AND account_key != '' ORDER BY saved_at DESC, id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
        });
    if let Some(id) = default_id {
        let _ = set_fallback_account_id(vault, &id);
    }
}

#[tauri::command]
pub async fn usage_statistics_read(
    app: tauri::AppHandle,
    period: String,
    account_id: Option<String>,
    offset_minutes: i32,
    fallback_account_name: Option<String>,
    timezone: Option<String>,
) -> Result<UsageSnapshot, String> {
    parse_timezone(timezone.as_deref())?;
    if !(-840..=840).contains(&offset_minutes) {
        return Err("offset_minutes must be within ±840".into());
    }
    if !matches!(
        period.as_str(),
        "all" | "today" | "yesterday" | "week" | "month"
    ) {
        return Err("period must be all/today/yesterday/week/month".into());
    }
    if let Some(id) = account_id.as_deref() {
        if id != "unattributed" && !super::valid_id(id) {
            return Err("account_id is invalid".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "usage ledger unavailable")?
            .join("identity-vault");
        let home = crate::cleaner::identity::root()?;
        ensure_default_fallback_account(&vault);
        read_at_with_timezone_now(
            &vault,
            &home,
            &period,
            account_id.as_deref(),
            offset_minutes,
            fallback_account_name.as_deref(),
            timezone.as_deref(),
            now(),
        )
    })
    .await
    .map_err(|_| "usage statistics worker interrupted".to_string())?
}

#[allow(dead_code)]
#[tauri::command]
pub async fn usage_attribution_read(
    app: tauri::AppHandle,
) -> Result<UsageAttributionConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "usage ledger unavailable")?
            .join("identity-vault");
        read_attribution_config(&vault)
    })
    .await
    .map_err(|_| "usage attribution worker interrupted".to_string())?
}

#[allow(dead_code)]
#[tauri::command]
pub async fn usage_attribution_set(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<UsageAttributionConfig, String> {
    if !super::valid_id(&account_id) {
        return Err("account_id is invalid".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "usage ledger unavailable")?
            .join("identity-vault");
        set_fallback_account_id(&vault, &account_id)
    })
    .await
    .map_err(|_| "usage attribution worker interrupted".to_string())?
}

#[allow(dead_code)]
#[tauri::command]
pub async fn usage_attribution_clear(
    app: tauri::AppHandle,
) -> Result<UsageAttributionConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "usage ledger unavailable")?
            .join("identity-vault");
        clear_fallback_account_id(&vault)
    })
    .await
    .map_err(|_| "usage attribution worker interrupted".to_string())?
}

pub(crate) fn validate_account_id_exists(vault: &Path, id: &str) -> Result<String, String> {
    if !super::valid_id(id) {
        return Err("account_id is invalid".into());
    }
    let db = identity_db_readonly(vault)?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE id=?1 AND empty=0)",
            [id],
            |r| r.get(0),
        )
        .map_err(|_| "identity catalog query failed")?;
    if !exists {
        return Err("account_id does not exist in catalog".into());
    }
    Ok(id.to_string())
}

pub(crate) fn set_fallback_account_id(
    vault: &Path,
    account_id: &str,
) -> Result<UsageAttributionConfig, String> {
    let verified_id = validate_account_id_exists(vault, account_id)?;
    let ledger_path = vault.join("usage.sqlite");
    let conn = open_ledger(&ledger_path)?;
    conn.execute(
        "INSERT INTO meta(key,value) VALUES('fallback_account_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [&verified_id],
    )
    .map_err(|_| "usage attribution write failed")?;
    read_attribution_config(vault)
}

pub(crate) fn clear_fallback_account_id(vault: &Path) -> Result<UsageAttributionConfig, String> {
    let ledger_path = vault.join("usage.sqlite");
    let conn = open_ledger(&ledger_path)?;
    conn.execute("DELETE FROM meta WHERE key='fallback_account_id'", [])
        .map_err(|_| "usage attribution clear failed")?;
    read_attribution_config(vault)
}

pub(crate) fn read_attribution_config(vault: &Path) -> Result<UsageAttributionConfig, String> {
    let ledger_path = vault.join("usage.sqlite");
    let conn = open_ledger(&ledger_path)?;
    let saved_fallback: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='fallback_account_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "usage attribution unavailable")?;

    let db = identity_db_readonly(vault).ok();
    let fallback_account_name = if let (Some(id), Some(db)) = (saved_fallback.as_ref(), db.as_ref())
    {
        db.query_row(
            "SELECT name FROM identities WHERE id=?1 AND empty=0",
            [id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    } else {
        None
    };

    let effective_fallback_id = if fallback_account_name.is_some() {
        saved_fallback
    } else {
        None
    };

    let mut known_keys = std::collections::HashSet::new();
    if let Some(db) = db.as_ref() {
        if let Ok(mut q) = db.prepare(
            "SELECT account_key FROM identities WHERE empty=0 AND account_key IS NOT NULL AND account_key != ''",
        ) {
            if let Ok(rows) = q.query_map([], |r| r.get::<_, String>(0)) {
                for k in rows.flatten() {
                    known_keys.insert(k);
                }
            }
        }
    }

    let mut unassigned_requests = 0u64;
    let mut unassigned_tokens = 0u64;
    if let Ok(mut q) =
        conn.prepare("SELECT COALESCE(account_key,''),input,output,creation,cache_read FROM events")
    {
        if let Ok(rows) = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?.max(0) as u64,
                r.get::<_, i64>(2)?.max(0) as u64,
                r.get::<_, i64>(3)?.max(0) as u64,
                r.get::<_, i64>(4)?.max(0) as u64,
            ))
        }) {
            for row in rows.flatten() {
                let (owner, i, o, c, r) = row;
                if owner.is_empty() || !known_keys.contains(&owner) {
                    unassigned_requests = unassigned_requests.saturating_add(1);
                    unassigned_tokens = unassigned_tokens
                        .saturating_add(i)
                        .saturating_add(o)
                        .saturating_add(c)
                        .saturating_add(r);
                }
            }
        }
    }

    Ok(UsageAttributionConfig {
        fallback_account_id: effective_fallback_id,
        fallback_account_name,
        unassigned_requests,
        unassigned_tokens,
    })
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
    vault: &Path,
    home: &Path,
    period: &str,
    account_id: Option<&str>,
    offset: i32,
    fallback_name: Option<&str>,
) -> Result<UsageSnapshot, String> {
    read_at_with_timezone_now(
        vault,
        home,
        period,
        account_id,
        offset,
        fallback_name,
        None,
        now(),
    )
}

pub(super) fn read_at_with_timezone_now(
    vault: &Path,
    home: &Path,
    period: &str,
    account_id: Option<&str>,
    offset: i32,
    fallback_name: Option<&str>,
    timezone: Option<&str>,
    snapshot_now: u64,
) -> Result<UsageSnapshot, String> {
    let timezone = parse_timezone(timezone)?;
    // Validate before touching the ledger, including for offset-only callers.
    offset_start(period, snapshot_now, offset)?;
    let start = match timezone {
        Some(timezone) => named_start(period, snapshot_now, timezone)?,
        None => offset_start(period, snapshot_now, offset)?,
    };
    let end = match timezone {
        Some(timezone) => named_end(period, snapshot_now, timezone)?,
        None => offset_end(period, snapshot_now, offset),
    };
    let hourly = period == "today" || period == "yesterday";
    let mut hourly_slots = if hourly {
        timezone
            .map(|timezone| named_hour_slots(timezone, snapshot_now, period == "yesterday"))
            .transpose()?
    } else {
        None
    };
    let ledger_path = vault.join("usage.sqlite");
    let mut warnings = Vec::new();
    let conn = open_ledger(&ledger_path)?;
    ensure_tracking_start(&conn, vault, home);
    mark_external_gap(&conn, vault, home);
    let mut events = HashMap::new();
    let mut cache = Vec::new();
    let mut known = HashMap::new();
    let projects = home.join(".claude").join("projects");
    if let Ok(meta) = fs::symlink_metadata(&projects) {
        if meta.is_dir() && private::safe(&projects).is_ok() {
            if let Ok(mut q) = conn.prepare(
                "SELECT file_key,size,mtime,offset,guard,COALESCE(effort,''),COALESCE(parser_version,0) FROM files",
            ) {
                if let Ok(rows) = q.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        FileCursor {
                            size: r.get::<_, i64>(1)?.max(0) as u64,
                            mtime: r.get::<_, i64>(2)?.max(0) as u64,
                            offset: r.get::<_, i64>(3)?.max(0) as u64,
                            guard: r.get::<_, String>(4)?,
                            effort: r.get::<_, String>(5)?,
                            parser_version: r.get::<_, i64>(6)?,
                        },
                    ))
                }) {
                    known.extend(rows.flatten());
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
    let saved_fallback: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='fallback_account_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "usage attribution unavailable")?;
    let candidates: Vec<_> = account_map
        .values()
        .filter(|a| Some(a.name.as_str()) == fallback_name)
        .collect();
    let fallback_id = saved_fallback
        .clone()
        .filter(|id| account_map.values().any(|a| &a.id == id))
        .or_else(|| {
            if candidates.len() == 1 {
                Some(candidates[0].id.clone())
            } else {
                None
            }
        });
    let weak_from = start.unwrap_or(0).min(i64::MAX as u64) as i64;
    let weak_to = end
        .map(|e| e.saturating_sub(1))
        .unwrap_or(snapshot_now)
        .min(snapshot_now)
        .min(i64::MAX as u64) as i64;
    let has_weak: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE weak=1 AND ts>=?1 AND ts<=?2)",
            params![weak_from, weak_to],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if has_weak {
        warnings.push("weak_ids".into());
    }
    let mut rows = Vec::new();
    {
        let mut q=conn.prepare("SELECT COALESCE(account_key,''),ts,model,COALESCE(effort,''),input,output,creation,cache_read,reasoning FROM events WHERE ts>=?1 AND ts<=?2 ORDER BY ts").map_err(|_|"usage ledger unavailable")?;
        let mapped = q
            .query_map(params![weak_from, weak_to], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?.max(0) as u64,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, Option<i64>>(8)?,
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
    let mut buckets: BTreeMap<i64, UsageTotals> = BTreeMap::new();
    let mut models: BTreeMap<String, UsageTotals> = BTreeMap::new();
    let mut model_efforts: BTreeMap<String, BTreeMap<String, UsageTotals>> = BTreeMap::new();
    for (owner, ts, model, effort, i, o, c, r, reason) in rows {
        if start.is_some_and(|s| ts < s) || end.is_some_and(|e| ts >= e) || ts > snapshot_now {
            continue;
        }
        let id = key_to_id
            .get(&owner)
            .cloned()
            .or_else(|| fallback_id.clone());
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
            let bucket = if let Some(timezone) = timezone {
                if let Some(slots) = hourly_slots.as_ref() {
                    let index = slots
                        .partition_point(|slot| slot.start_at.unwrap_or(0) <= ts)
                        .saturating_sub(1);
                    slots[index].start_at.unwrap_or(0) as i64
                } else {
                    local_datetime(timezone, ts)?
                        .date_naive()
                        .num_days_from_ce() as i64
                }
            } else {
                let local_second = (ts as i64).saturating_add(offset as i64 * 60);
                if hourly {
                    local_second.div_euclid(3600)
                } else {
                    local_second.div_euclid(86400)
                }
            };
            add_row(buckets.entry(bucket).or_default(), i, o, c, r, reason);
            add_row(models.entry(model.clone()).or_default(), i, o, c, r, reason);
            if !effort.is_empty() {
                add_row(
                    model_efforts
                        .entry(model)
                        .or_default()
                        .entry(effort)
                        .or_default(),
                    i,
                    o,
                    c,
                    r,
                    reason,
                );
            }
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
    let (first_bucket, last_bucket) = if let Some(timezone) = timezone {
        let today = local_datetime(timezone, snapshot_now)?
            .date_naive()
            .num_days_from_ce() as i64;
        (
            match period {
                "week" => today - 6,
                "month" => today - 29,
                _ => earliest.unwrap_or(today),
            },
            today,
        )
    } else {
        bucket_span(period, snapshot_now, offset, earliest)
    };
    let daily = if let Some(mut slots) = hourly_slots.take() {
        for slot in &mut slots {
            slot.totals = buckets
                .remove(&(slot.start_at.unwrap_or(0) as i64))
                .unwrap_or_default();
        }
        slots
    } else if first_bucket <= last_bucket {
        (first_bucket..=last_bucket)
            .map(|bucket| {
                let label = if timezone.is_some() {
                    NaiveDate::from_num_days_from_ce_opt(bucket as i32)
                        .map(|date| date.format("%Y-%m-%d").to_string())
                        .unwrap_or_default()
                } else if hourly {
                    hour_label((bucket * 3600 - offset as i64 * 60).max(0) as u64, offset)
                } else {
                    day_label((bucket * 86400 - offset as i64 * 60).max(0) as u64, offset)
                };
                UsageDaily {
                    day: label,
                    start_at: None,
                    end_at: None,
                    totals: buckets.remove(&bucket).unwrap_or_default(),
                }
            })
            .collect()
    } else {
        Vec::new()
    };
    let attribution = {
        let effective_id = saved_fallback.filter(|id| accounts.iter().any(|a| &a.id == id));
        let fallback_account_name = effective_id.as_ref().and_then(|id| {
            accounts
                .iter()
                .find(|a| &a.id == id)
                .map(|a| a.name.clone())
        });
        let mut unassigned_requests = 0u64;
        let mut unassigned_tokens = 0u64;
        if let Ok(mut q) = conn
            .prepare("SELECT COALESCE(account_key,''),input,output,creation,cache_read FROM events")
        {
            if let Ok(rows) = q.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?.max(0) as u64,
                    r.get::<_, i64>(2)?.max(0) as u64,
                    r.get::<_, i64>(3)?.max(0) as u64,
                    r.get::<_, i64>(4)?.max(0) as u64,
                ))
            }) {
                for row in rows.flatten() {
                    let (owner, i, o, c, r) = row;
                    if owner.is_empty() || !key_to_id.contains_key(&owner) {
                        unassigned_requests = unassigned_requests.saturating_add(1);
                        unassigned_tokens = unassigned_tokens
                            .saturating_add(i)
                            .saturating_add(o)
                            .saturating_add(c)
                            .saturating_add(r);
                    }
                }
            }
        }
        UsageAttributionConfig {
            fallback_account_id: effective_id,
            fallback_account_name,
            unassigned_requests,
            unassigned_tokens,
        }
    };
    Ok(UsageSnapshot {
        generated_at: snapshot_now,
        timezone: timezone.map(|timezone| timezone.name().to_string()),
        tracking_since: tracking,
        totals,
        unattributed: unknown,
        accounts,
        daily,
        granularity: if hourly { "hour" } else { "day" }.into(),
        models: models
            .into_iter()
            .map(|(model, totals)| {
                let mut efforts: Vec<UsageEffort> = model_efforts
                    .remove(&model)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(effort, totals)| UsageEffort { effort, totals })
                    .collect();
                efforts.sort_by(|a, b| {
                    b.totals
                        .total_tokens
                        .cmp(&a.totals.total_tokens)
                        .then_with(|| effort_rank(&a.effort).cmp(&effort_rank(&b.effort)))
                        .then_with(|| a.effort.cmp(&b.effort))
                });
                UsageModel {
                    model,
                    totals,
                    efforts,
                }
            })
            .collect(),
        warnings,
        attribution,
    })
}
