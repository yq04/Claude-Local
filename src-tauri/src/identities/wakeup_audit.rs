// [INPUT]: Wakeup trigger, bounded result fields and expired/new 5h reset anchors.
// [OUTPUT]: A private, bounded local audit file containing no account identifiers, routes or request data.
// [POS]: Shared by native wakeup IPC and future in-process scheduler; this module never writes quota state.
// [PROTOCOL]: Keep entries allowlisted and update identities/CLAUDE.md when changing the schema.
use super::OnlineQuotaResult;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};
use std::sync::{Mutex, OnceLock};

const MAX_ENTRIES: usize = 200;
const MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
static AUDIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Entry {
    request_id: String,
    trigger: String,
    local_slot: String,
    stage: String,
    status: String,
    at_ms: u64,
    old_reset_at: Option<u64>,
    new_reset_at: Option<u64>,
}

fn request_id() -> Result<String, String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut bytes = [0u8; 16];
    SystemRandom::new().fill(&mut bytes).map_err(|_| "quotaOnline.unavailable")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub(super) fn record(
    app_data: &Path,
    trigger: &str,
    expected_identity: &str,
    old_reset_at: Option<u64>,
    result: &OnlineQuotaResult,
) -> Result<(), String> {
    if !matches!(trigger, "auto" | "manual") {
        return Err("quotaOnline.unavailable".into());
    }
    let _guard = AUDIT_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "quotaOnline.unavailable")?;
    let path = app_data.join("wakeup-audit.json");
    crate::identities::private::directory(app_data)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "quotaOnline.unavailable")?.as_secs();
    let mut entries: Vec<Entry> = if path.exists() {
        crate::identities::private::safe(&path)?;
        let metadata = fs::metadata(&path).map_err(|_| "quotaOnline.unavailable")?;
        if metadata.len() > 256 * 1024 { return Err("quotaOnline.unavailable".into()); }
        let file = fs::File::open(&path).map_err(|_| "quotaOnline.unavailable")?;
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(256 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "quotaOnline.unavailable")?;
        if bytes.len() > 256 * 1024 { return Err("quotaOnline.unavailable".into()); }
        let parsed: Vec<Entry> = serde_json::from_slice(&bytes).map_err(|_| "quotaOnline.unavailable")?;
        parsed.into_iter().filter(valid_entry).collect()
    } else { Vec::new() };
    entries.retain(|entry| (entry.at_ms / 1000).saturating_add(MAX_AGE_SECS) >= now);
    entries.push(Entry {
        request_id: request_id()?,
        trigger: trigger.into(),
        local_slot: local_slot(expected_identity),
        stage: result.stage.as_deref().filter(|v| matches!(*v, "profile" | "messages" | "usage" | "route" | "exit_check" | "commit")).unwrap_or("commit").into(),
        status: status_name(&result.status).into(),
        at_ms: now.saturating_mul(1000),
        old_reset_at,
        new_reset_at: result.wakeup_5h_reset_at,
    });
    if entries.len() > MAX_ENTRIES { entries.drain(..entries.len() - MAX_ENTRIES); }
    let bytes = serde_json::to_vec(&entries).map_err(|_| "quotaOnline.unavailable")?;
    crate::identities::private::write(&path, &bytes)
}

fn local_slot(identity: &str) -> String {
    use ring::digest::{digest, SHA256};
    let mut material = b"ai.local.claude-local/wakeup-audit-slot/v1\0".to_vec();
    material.extend_from_slice(identity.as_bytes());
    let hash = digest(&SHA256, &material);
    format!("slot-{}", hash.as_ref()[..8].iter().map(|b| format!("{b:02x}")).collect::<String>())
}

fn valid_entry(entry: &Entry) -> bool {
    entry.request_id.len() == 32 && entry.request_id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && matches!(entry.trigger.as_str(), "auto" | "manual")
        && entry.local_slot.len() == 21 && entry.local_slot.starts_with("slot-")
        && entry.local_slot[5..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && matches!(entry.stage.as_str(), "profile" | "messages" | "usage" | "route" | "exit_check" | "commit")
        && matches!(entry.status.as_str(), "updated" | "cached" | "cooldown" | "auth_required" | "unavailable" | "rate_limited" | "network_error" | "invalid_response" | "account_mismatch" | "route_unavailable" | "cancelled" | "not_run" | "deadline_exceeded")
        && entry.at_ms > 0 && entry.old_reset_at.is_none_or(|v| v > 0) && entry.new_reset_at.is_none_or(|v| v > 0)
}

fn status_name(status: &super::OnlineStatus) -> &'static str {
    use super::OnlineStatus::*;
    match status {
        Updated => "updated", Cached => "cached", Cooldown => "cooldown", AuthRequired => "auth_required",
        Unavailable => "unavailable", RateLimited => "rate_limited", NetworkError => "network_error",
        InvalidResponse => "invalid_response", AccountMismatch => "account_mismatch", RouteUnavailable => "route_unavailable",
        Cancelled => "cancelled", NotRun => "not_run", DeadlineExceeded => "deadline_exceeded",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audit_is_anonymous_and_bounded() {
        let root = std::env::temp_dir().join(format!("wakeup-audit-{}", request_id().unwrap()));
        fs::create_dir_all(&root).unwrap();
        let mut result = OnlineQuotaResult::unavailable();
        result.status = super::super::OnlineStatus::Updated;
        result.stage = Some("commit".into());
        result.wakeup_effect = Some(super::super::WakeupEffect::New5hConfirmed);
        result.wakeup_5h_reset_at = Some(2_000_000_000);
        for i in 0..MAX_ENTRIES + 1 { record(&root, "auto", "synthetic-identity", Some(i as u64 + 1), &result).unwrap(); }
        let path = root.join("wakeup-audit.json");
        let bytes = fs::read(&path).unwrap();
        let entries: Vec<Entry> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(entries.len(), MAX_ENTRIES);
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("synthetic-identity"));
        assert!(entries.iter().all(|entry| entry.local_slot == local_slot("synthetic-identity")));
        assert_ne!(local_slot("identity-a"), local_slot("identity-b"));
        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(root);
    }
}
