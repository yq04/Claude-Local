// [INPUT]: Explicit system-change snapshots and bounded private app-data history.
// [OUTPUT]: Per-operation before/after records and conflict-aware restore planning.
// [POS]: Journals only values the application actually changes; unknown values are never invented.
// [PROTOCOL]: Update src/CLAUDE.md and both locale catalogs when changing this contract.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

const MAX_BYTES: u64 = 64 * 1024;
const MAX_OPERATIONS: usize = 20;
static CHANGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecord {
    pub id: String,
    pub operation: String,
    pub before: Map<String, Value>,
    pub after: Map<String, Value>,
    pub restorable: Vec<String>,
    pub completed: bool,
    pub message: String,
    pub changed_at: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    records: Vec<ChangeRecord>,
}

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "系统修改记录无法定位。")?
        .join("system-change-history.json"))
}
fn read(path: &PathBuf) -> Result<History, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(History::default()),
        Err(_) => Err("系统修改记录无法读取。".into()),
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES => {
            Err("系统修改记录无效或超过大小限制。".into())
        }
        Ok(_) => {
            crate::identities::private::safe(path)?;
            let bytes = fs::read(path).map_err(|_| "系统修改记录无法读取。")?;
            let history: History =
                serde_json::from_slice(&bytes).map_err(|_| "系统修改记录格式无效。")?;
            if history.records.len() > MAX_OPERATIONS {
                return Err("系统修改记录超过数量限制。".into());
            }
            Ok(history)
        }
    }
}
fn save(path: &PathBuf, history: &History) -> Result<(), String> {
    let bytes = serde_json::to_vec(history).map_err(|_| "系统修改记录无法序列化。")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("系统修改记录超过大小限制。".into());
    }
    if let Some(parent) = path.parent() {
        crate::identities::private::directory(parent)?;
    }
    crate::identities::private::write(path, &bytes)
}
fn stamp() -> String {
    // Seconds since Unix epoch are display metadata; no account or identity is persisted.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}
fn values(snapshot: &Value, operation: &str) -> Map<String, Value> {
    let mut result = Map::new();
    let fields: &[&str] = match operation {
        "timezone" => &["timezone"],
        "language" => &["language", "locale"],
        "region" => &["timezone", "language", "locale"],
        "align" => &["timezone", "language", "locale", "locationEnabled"],
        "location" => &["locationEnabled"],
        _ => &[],
    };
    for field in fields {
        let key = match *field {
            "language" => "languages",
            "locationEnabled" => "location_enabled",
            other => other,
        };
        let value = if *field == "language" {
            snapshot[key].as_array().and_then(|a| a.first()).cloned()
        } else {
            snapshot.get(key).cloned()
        };
        if let Some(value) = value.filter(|v| !v.is_null() || *field == "locationEnabled") {
            result.insert((*field).into(), value);
        }
    }
    result
}
fn record_observation(
    record: &mut ChangeRecord,
    operation: &str,
    after: &Value,
    success: bool,
    message: &str,
) {
    record.after = values(after, operation);
    record
        .after
        .retain(|field, value| record.before.get(field) != Some(value));
    record.restorable = record
        .before
        .keys()
        .filter(|key| {
            ["timezone", "language", "locale"].contains(&key.as_str())
                && record.after.contains_key(*key)
        })
        .cloned()
        .collect();
    record.completed = success && !record.after.is_empty();
    record.message = message.chars().take(500).collect();
}

pub fn begin(app: &tauri::AppHandle, operation: &str, before: &Value) -> Result<String, String> {
    let _guard = CHANGE_LOCK.lock().map_err(|_| "系统修改记录暂不可用。")?;
    let path = history_path(app)?;
    let mut history = read(&path)?;
    let id = crate::identities::new_id()?;
    let original = values(before, operation);
    let record = ChangeRecord {
        id: id.clone(),
        operation: operation.into(),
        before: original,
        after: Map::new(),
        restorable: Vec::new(),
        completed: false,
        message: "pending".into(),
        changed_at: stamp(),
    };
    history.records.insert(0, record);
    history.records.truncate(MAX_OPERATIONS);
    save(&path, &history)?; // Persistence is required before any native mutation.
    Ok(id)
}
pub fn finish(
    app: &tauri::AppHandle,
    id: &str,
    operation: &str,
    after: &Value,
    success: bool,
    message: &str,
) -> Result<(), String> {
    let _guard = CHANGE_LOCK
        .lock()
        .map_err(|_| "系统修改记录暂不可用。".to_string())?;
    let path = history_path(app)?;
    let mut history = read(&path)?;
    let record = history
        .records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or("系统修改记录项丢失。")?;
    record_observation(record, operation, after, success, message);
    save(&path, &history)
}
pub fn list(app: &tauri::AppHandle) -> Result<Vec<ChangeRecord>, String> {
    let _guard = CHANGE_LOCK.lock().map_err(|_| "系统修改记录暂不可用。")?;
    Ok(read(&history_path(app)?)?.records)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreField {
    pub field: String,
    pub before: Value,
    pub app_written: Value,
    pub current: Value,
    pub conflict: bool,
}

pub fn plan(
    records: &[ChangeRecord],
    id: &str,
    current: &Value,
) -> Result<Vec<RestoreField>, String> {
    let record = records
        .iter()
        .find(|r| r.id == id)
        .ok_or("找不到这次系统修改记录。")?;
    let current = values(current, &record.operation);
    Ok(record
        .restorable
        .iter()
        .filter_map(|field| {
            Some(RestoreField {
                field: field.clone(),
                before: record.before.get(field)?.clone(),
                app_written: record.after.get(field)?.clone(),
                current: current.get(field)?.clone(),
                conflict: current.get(field)? != record.after.get(field)?,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn fixture(bytes: &[u8]) -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "claude-local-system-history-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        file.write_all(bytes).unwrap();
        path
    }
    #[test]
    fn snapshot_fields_are_limited_and_unknowns_stay_unknown() {
        let snap = serde_json::json!({"timezone":"Etc/UTC","languages":["en-US"],"locale":"en_US","location_enabled":null,"proxy":"secret-like"});
        assert_eq!(values(&snap, "region").len(), 3);
        assert_eq!(values(&snap, "location")["locationEnabled"], Value::Null);
        assert!(!values(&snap, "region").contains_key("proxy"));
    }
    #[test]
    fn restore_plan_flags_user_changes_and_refuses_missing_fields() {
        let mut before = Map::new();
        before.insert("timezone".into(), Value::String("Etc/UTC".into()));
        let mut after = Map::new();
        after.insert("timezone".into(), Value::String("America/New_York".into()));
        let record = ChangeRecord {
            id: "id".into(),
            operation: "timezone".into(),
            before,
            after,
            restorable: vec!["timezone".into()],
            completed: true,
            message: String::new(),
            changed_at: String::new(),
        };
        let current = serde_json::json!({"timezone":"Europe/London"});
        let result = plan(&[record], "id", &current).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].conflict);
        assert!(plan(&[], "missing", &current).is_err());
    }
    #[test]
    fn partial_failure_records_observed_completed_fields() {
        let mut before = Map::new();
        before.insert("timezone".into(), Value::String("Etc/UTC".into()));
        before.insert("language".into(), Value::String("en-US".into()));
        let mut record = ChangeRecord {
            id: "id".into(),
            operation: "region".into(),
            before,
            after: Map::new(),
            restorable: Vec::new(),
            completed: false,
            message: String::new(),
            changed_at: String::new(),
        };
        record_observation(
            &mut record,
            "region",
            &serde_json::json!({"timezone":"America/New_York","languages":["en-US"]}),
            false,
            "region setter failed after timezone change",
        );
        assert_eq!(record.after["timezone"], "America/New_York");
        assert_eq!(record.restorable, vec!["timezone"]);
        assert!(!record.completed);
    }
    #[test]
    fn malformed_and_oversized_history_are_rejected() {
        let malformed = fixture(b"not json");
        assert!(read(&malformed).is_err());
        fs::remove_file(malformed).unwrap();
        let oversized = fixture(&vec![b' '; (MAX_BYTES + 1) as usize]);
        assert!(read(&oversized).is_err());
        fs::remove_file(oversized).unwrap();
    }
}
