// [INPUT]: Explicit account selectors and frozen fingerprints, packaged Python collector, account-bound browser summaries and fixed local quota/config file metadata.
// [OUTPUT]: Bounded retained/cancellable batch snapshots and two-phase commit grants; Python owns every ledger write.
// [POS]: Shared orchestration allows 10s cold runtime probes within one 30s preparation budget outside the identity door; frozen identity/epoch is rechecked at commit.
// [PROTOCOL]: Batch progress is quota-batch-progress; update identities/CLAUDE.md and the package resource allowlist.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const MAX_QUOTA_BATCH: usize = 256;
const BATCH_BUDGET: Duration = Duration::from_secs(120);
const PREPARATION_BUDGET: Duration = Duration::from_secs(30);
const RUNTIME_PROBE_BUDGET: Duration = Duration::from_secs(10);
const COMMIT_GRACE: Duration = Duration::from_secs(45);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OnlineStatus {
    Updated,
    Cached,
    Cooldown,
    AuthRequired,
    Unavailable,
    RateLimited,
    NetworkError,
    InvalidResponse,
    AccountMismatch,
    RouteUnavailable,
    Cancelled,
    NotRun,
    DeadlineExceeded,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OnlineQuotaResult {
    pub status: OnlineStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_observed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_windows: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_updated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct QuotaTarget {
    pub account_id: String,
    pub expected_identity: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuotaAccountResult {
    pub account_id: String,
    pub expected_identity: String,
    pub result: OnlineQuotaResult,
}

#[derive(Clone, Debug, Serialize)]
pub struct BatchQuotaResult {
    pub request_id: String,
    pub results: Vec<QuotaAccountResult>,
    pub completed: usize,
    pub total: usize,
    pub state: QuotaTaskState,
    pub targets: Vec<QuotaTarget>,
    pub started_at_ms: u64,
    pub deadline_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuotaTaskState {
    Queued,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    DeadlineExceeded,
}

impl QuotaTaskState {
    fn active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }
}

struct QuotaTask {
    snapshot: Mutex<BatchQuotaResult>,
    cancel: AtomicBool,
    deadline: Instant,
}

#[derive(Default)]
struct TaskRegistry {
    recent: Vec<Arc<QuotaTask>>,
}
static TASKS: OnceLock<Mutex<TaskRegistry>> = OnceLock::new();
fn tasks() -> &'static Mutex<TaskRegistry> {
    TASKS.get_or_init(|| Mutex::new(TaskRegistry::default()))
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl QuotaTask {
    fn stopped(&self) -> Option<OnlineStatus> {
        if self.cancel.load(Ordering::SeqCst) {
            Some(OnlineStatus::Cancelled)
        } else if Instant::now() >= self.deadline {
            Some(OnlineStatus::DeadlineExceeded)
        } else {
            None
        }
    }
}

#[tauri::command]
pub fn identities_quota_batch_state(
    _app: tauri::AppHandle,
    request_id: Option<String>,
) -> Result<Option<BatchQuotaResult>, String> {
    let registry = tasks().lock().map_err(|_| "quotaOnline.unavailable")?;
    Ok(registry.recent.iter().rev().find_map(|task| {
        let snapshot = task.snapshot.lock().ok()?;
        if request_id
            .as_ref()
            .is_none_or(|id| id == &snapshot.request_id)
        {
            Some(snapshot.clone())
        } else {
            None
        }
    }))
}

#[tauri::command]
pub fn identities_cancel_quota_batch(
    _app: tauri::AppHandle,
    request_id: String,
) -> Result<BatchQuotaResult, String> {
    let registry = tasks().lock().map_err(|_| "quotaOnline.unavailable")?;
    let task = registry
        .recent
        .iter()
        .find(|task| task.snapshot.lock().unwrap().request_id == request_id)
        .ok_or("quotaOnline.unavailable")?;
    let mut snapshot = task
        .snapshot
        .lock()
        .map_err(|_| "quotaOnline.unavailable")?;
    if snapshot.state.active() {
        task.cancel.store(true, Ordering::SeqCst);
        snapshot.state = QuotaTaskState::Cancelling;
    }
    Ok(snapshot.clone())
}

#[derive(Clone, Debug, Serialize)]
struct QuotaBatchProgress {
    request_id: String,
    account_id: String,
    expected_identity: String,
    result: OnlineQuotaResult,
    completed: usize,
    total: usize,
    state: QuotaTaskState,
}

struct CleanerGuard(tauri::AppHandle);

impl Drop for CleanerGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}

impl OnlineQuotaResult {
    fn unavailable() -> Self {
        Self {
            status: OnlineStatus::Unavailable,
            source: None,
            observed_at_ms: None,
            last_observed_at_ms: None,
            retry_at_ms: None,
            updated_windows: None,
            metadata_updated: None,
            runtime_stage: None,
            runtime_reason: None,
            reason: None,
            stage: None,
            route_mode: None,
            retry_scope: None,
            verified_at_ms: None,
        }
    }

    fn unavailable_at(stage: &str, reason: &str) -> Self {
        Self {
            runtime_stage: Some(stage.into()),
            runtime_reason: Some(reason.into()),
            ..Self::unavailable()
        }
    }
}

#[derive(Clone, Default, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct WebMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_date_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_date: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_remaining: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_valid_until: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_observed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_observed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_observed_at_ms: Option<u64>,
}

fn valid_account(account: &str) -> bool {
    account == "current" || super::valid_id(account)
}

/// Inspect fixed local quota/config metadata only. Full identity summaries are
/// read by the visible page after their local observations have changed.
#[tauri::command]
pub fn identities_quota_revision(app: tauri::AppHandle) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "quotaOnline.unavailable")?;
    let home = crate::cleaner::identity::root().map_err(|_| "quotaOnline.unavailable")?;
    quota_revision(&root, &home)
}

fn quota_revision(root: &Path, home: &Path) -> Result<String, String> {
    let mut revision = String::new();
    for path in [
        root.join("quota_ledger.json"),
        root.join("identity-vault/quota_web_metadata.json"),
        home.join(".claude.json"),
    ] {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !crate::cleaner::linked(&metadata) => {
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|time| time.as_nanos())
                    .unwrap_or(0);
                revision.push_str(&format!("{}:{modified};", metadata.len()));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                revision.push_str("missing;")
            }
            _ => return Err("quotaOnline.unavailable".into()),
        }
    }
    Ok(revision)
}

fn matches_identity(expected: &str, actual: Option<&str>) -> bool {
    expected.len() == 64
        && expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && actual == Some(expected)
}

fn validate_request_binding(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<(), String> {
    let state = super::state(app)?;
    if state.recovery.is_some() {
        return Err("quotaOnline.accountMismatch".into());
    }
    let actual = if account_id == "current" && state.current.present {
        state.current.quota_identity.as_deref()
    } else if state.records.iter().any(|record| record.id == account_id) {
        state
            .summaries
            .get(account_id)
            .and_then(|summary| summary.quota_identity.as_deref())
    } else {
        None
    };
    if matches_identity(expected_identity, actual) {
        Ok(())
    } else {
        Err("quotaOnline.accountMismatch".into())
    }
}

fn script_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(packaged) = installed_script(&app.path().resource_dir().ok()?) {
        return Some(packaged);
    }
    #[cfg(debug_assertions)]
    {
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/claude_quota_online.py");
        if source.is_file() {
            return Some(source);
        }
    }
    None
}

fn installed_script(resource_root: &Path) -> Option<PathBuf> {
    let script = resource_root.join("scripts/claude_quota_online.py");
    script.is_file().then_some(script)
}

// The command adapter and synthetic installed-resource fixture use this exact
// freeze/resolve/execute/grant path. Context never changes transport endpoints.
trait CollectorContext {
    type Guard;
    fn freeze(&self, account: &str, identity: &str) -> Result<u64, String>;
    fn paths(&self) -> Result<(Option<PathBuf>, PathBuf, PathBuf), String>;
    fn grant(
        &self,
        request: &Value,
        task: Option<&QuotaTask>,
        epoch: u64,
        deadline: Instant,
    ) -> Result<Self::Guard, OnlineQuotaResult>;
}

struct NativeCollector<'a>(&'a tauri::AppHandle);

impl CollectorContext for NativeCollector<'_> {
    type Guard = CleanerGuard;

    fn freeze(&self, account: &str, identity: &str) -> Result<u64, String> {
        freeze_binding(self.0, account, identity)
    }

    fn paths(&self) -> Result<(Option<PathBuf>, PathBuf, PathBuf), String> {
        Ok((
            script_path(self.0),
            self.0.path().app_data_dir().map_err(|_| "quotaOnline.unavailable")?,
            crate::cleaner::identity::root()?,
        ))
    }

    fn grant(
        &self,
        request: &Value,
        task: Option<&QuotaTask>,
        epoch: u64,
        grant_wait: Instant,
    ) -> Result<Self::Guard, OnlineQuotaResult> {
        let app = self.0;
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        let account = request.get("account_id").and_then(Value::as_str).unwrap_or("");
        let identity = request.get("expected_identity").and_then(Value::as_str).unwrap_or("");
        grant_door(&cleaner, task, epoch, grant_wait, || {
            validate_request_binding(app, account, identity)
        })?;
        Ok(CleanerGuard(app.clone()))
    }
}

fn grant_door(
    cleaner: &crate::cleaner::Cleaner,
    task: Option<&QuotaTask>,
    epoch: u64,
    deadline: Instant,
    validate: impl FnOnce() -> Result<(), String>,
) -> Result<(), OnlineQuotaResult> {
    loop {
        if Instant::now() >= deadline || task.and_then(QuotaTask::stopped).is_some() {
            return Err(task.and_then(QuotaTask::stopped).map(terminal_result)
                .unwrap_or_else(OnlineQuotaResult::unavailable));
        }
        if cleaner.enter_quota().is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    if task.and_then(QuotaTask::stopped).is_some()
        || cleaner.identity_epoch() != epoch
        || validate().is_err()
    {
        cleaner.leave();
        return Err(task.and_then(QuotaTask::stopped).map(terminal_result)
            .unwrap_or_else(account_mismatch));
    }
    Ok(())
}

fn parse_result(bytes: &[u8]) -> Option<OnlineQuotaResult> {
    if bytes.len() > 16 * 1024 {
        return None;
    }
    let result: OnlineQuotaResult = serde_json::from_slice(bytes).ok()?;
    if result.reason.as_deref().is_some_and(|v| {
        !matches!(
            v,
            "unsupported_proxy" | "route_changed" | "auth_required" | "rate_limited"
        )
    }) || result
        .stage
        .as_deref()
        .is_some_and(|v| !matches!(v, "route" | "commit"))
        || result
            .route_mode
            .as_deref()
            .is_some_and(|v| !matches!(v, "account_proxy" | "host_system"))
        || result
            .retry_scope
            .as_deref()
            .is_some_and(|v| !matches!(v, "oauth" | "all"))
        || result
            .verified_at_ms
            .is_some_and(|v| v == 0 || v > now_ms().saturating_add(300_000))
    {
        return None;
    }
    if result
        .updated_windows
        .as_ref()
        .is_some_and(|windows| windows.len() > 2 || windows.iter().any(|w| w != "5h" && w != "7d"))
    {
        return None;
    }
    if result
        .runtime_stage
        .as_deref()
        .is_some_and(|v| v != "probe" && v != "execute")
        || result.runtime_reason.as_deref().is_some_and(|v| {
            !matches!(
                v,
                "missing_resource"
                    | "no_compatible_runtime"
                    | "missing_dependency"
                    | "probe_failed"
                    | "timeout"
                    | "invalid_response"
            )
        })
    {
        return None;
    }
    if result
        .source
        .as_deref()
        .is_some_and(|source| source != "oauth" && source != "browser")
    {
        return None;
    }
    Some(result)
}

fn runtime_probe(
    executable: &str,
    script: &Path,
    task: Option<&QuotaTask>,
    preparation_deadline: Instant,
) -> Result<(), &'static str> {
    let deadline = preparation_deadline
        .min(task.map(|t| t.deadline).unwrap_or(preparation_deadline))
        .min(Instant::now() + RUNTIME_PROBE_BUDGET);
    if Instant::now() >= deadline || task.is_some_and(|t| t.stopped().is_some()) {
        return Err("timeout");
    }
    let mut command = Command::new(executable);
    if executable == "py" {
        command.arg("-3");
    }
    command
        .arg("-E")
        .arg("-s")
        .arg(script)
        .arg("--runtime-info")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "probe_failed")?;
    #[cfg(windows)]
    let job = match crate::windows::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("probe_failed");
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("probe_failed");
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(4097).read_to_end(&mut bytes);
        let _ = tx.send(bytes);
    });
    let status = loop {
        if Instant::now() >= deadline || task.is_some_and(|t| t.stopped().is_some()) {
            #[cfg(windows)]
            job.stop();
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                std::thread::sleep(deadline.saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(40)))
            }
            _ => {
                #[cfg(windows)]
                job.stop();
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    #[cfg(windows)]
    job.stop();
    if status.is_none() {
        return Err("timeout");
    }
    let bytes = rx
        .recv_timeout(deadline.saturating_duration_since(Instant::now())
            .min(Duration::from_millis(250)))
        .unwrap_or_default();
    if Instant::now() >= deadline || task.is_some_and(|t| t.stopped().is_some()) {
        return Err("timeout");
    }
    if !status.is_some_and(|status| status.success()) || bytes.len() > 4096 {
        return Err("probe_failed");
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return Err("invalid_response");
    };
    if value.get("schema").and_then(Value::as_u64) != Some(1) {
        return Err("invalid_response");
    }
    if value.get("compatible").and_then(Value::as_bool) != Some(true) {
        return Err("missing_dependency");
    }
    Ok(())
}

fn select_runtime(
    mut probe: impl FnMut(&'static str) -> Result<(), &'static str>,
) -> Result<&'static str, &'static str> {
    let mut last_reason = "no_compatible_runtime";
    for candidate in ["python", "python3", "py"] {
        match probe(candidate) {
            Ok(()) => return Ok(candidate),
            Err(reason) => last_reason = reason,
        }
    }
    Err(last_reason)
}

fn terminal_result(status: OnlineStatus) -> OnlineQuotaResult {
    OnlineQuotaResult {
        status,
        ..OnlineQuotaResult::unavailable()
    }
}

fn execute<C: CollectorContext>(
    context: &C,
    script: &Path,
    app_data: &Path,
    home: &Path,
    request: &Value,
    task: Option<&QuotaTask>,
    epoch: u64,
) -> OnlineQuotaResult {
    execute_with_gate(script, app_data, home, request, task, |grant_wait| {
        context.grant(request, task, epoch, grant_wait)
    })
}

// The process protocol is independent of Tauri so synthetic helpers can prove
// the network/identity-door boundary without touching any real identity.
fn execute_with_gate<G>(
    script: &Path,
    app_data: &Path,
    home: &Path,
    request: &Value,
    task: Option<&QuotaTask>,
    mut acquire_grant: impl FnMut(Instant) -> Result<G, OnlineQuotaResult>,
) -> OnlineQuotaResult {
    // Runtime selection and network preparation consume the same budget. A
    // slow cold import must not reset the clock for every interpreter alias.
    let deadline = task.map(|t| t.deadline)
        .unwrap_or_else(|| Instant::now() + BATCH_BUDGET)
        .min(Instant::now() + PREPARATION_BUDGET);
    let probe_script = script.with_file_name("quota_runtime.py");
    let executable =
        match select_runtime(|executable| runtime_probe(executable, &probe_script, task, deadline)) {
            Ok(executable) => executable,
            Err(reason) => {
                return task
                    .and_then(QuotaTask::stopped)
                    .map(terminal_result)
                    .unwrap_or_else(|| OnlineQuotaResult::unavailable_at("probe", reason))
            }
        };
    if let Some(status) = task.and_then(QuotaTask::stopped) {
        return terminal_result(status);
    }
    let deadline_ms = now_ms()
        + deadline
            .saturating_duration_since(Instant::now())
            .as_millis() as u64;
    use ring::rand::{SecureRandom, SystemRandom};
    let mut random = [0u8; 16];
    if SystemRandom::new().fill(&mut random).is_err() {
        return OnlineQuotaResult::unavailable();
    }
    let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut request = request.clone();
    request["nonce"] = json!(nonce);
    request["deadline_at_ms"] = json!(deadline_ms);
    let Ok(mut input) = serde_json::to_vec(&request) else {
        return OnlineQuotaResult::unavailable();
    };
    if input.len() > 16 * 1024 - 1 {
        return OnlineQuotaResult::unavailable();
    }
    input.push(b'\n');
    let mut command = Command::new(executable);
    if executable == "py" {
        command.arg("-3");
    }
    command
        .arg("-E")
        .arg("-s")
        .arg(script)
        .arg("--two-phase")
        .arg("--app-data")
        .arg(app_data)
        .arg("--claude-home")
        .arg(home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return OnlineQuotaResult::unavailable_at("execute", "probe_failed"),
    };
    #[cfg(windows)]
    let job = match crate::windows::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return OnlineQuotaResult::unavailable();
        }
    };
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return OnlineQuotaResult::unavailable();
    };
    // Pipe writes may block if a broken helper stops reading. Keep them off
    // the task thread; Job cleanup closes the only child and releases the pipe.
    let (input_tx, input_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(1);
    std::thread::spawn(move || {
        for bytes in input_rx {
            if stdin.write_all(&bytes).and_then(|_| stdin.flush()).is_err() {
                break;
            }
        }
    });
    let (tx, rx) = std::sync::mpsc::sync_channel(3);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        // Exactly ready + result, or one early result. Never join this reader:
        // a hostile inherited pipe cannot block the native task indefinitely.
        for _ in 0..3 {
            let mut line = Vec::new();
            let read = reader
                .by_ref()
                .take(16 * 1024 + 1)
                .read_until(b'\n', &mut line);
            if read.is_err()
                || line.is_empty()
                || line.len() > 16 * 1024
                || line.last() != Some(&b'\n')
            {
                let _ = tx.send(None);
                break;
            }
            if tx.send(Some(line)).is_err() {
                break;
            }
        }
    });
    let mut result = OnlineQuotaResult::unavailable_at("execute", "invalid_response");
    let mut commit_guard: Option<G> = None;
    let mut commit_deadline: Option<Instant> = None;
    let mut commit_finished = false;
    if input_tx.try_send(input).is_ok() {
        loop {
            // After grant, give Python a bounded commit grace even on cancel.
            // This avoids interrupting its acknowledged atomic replacement.
            let stop = task.and_then(QuotaTask::stopped);
            if commit_deadline.is_none() && (stop.is_some() || Instant::now() >= deadline) {
                result = stop
                    .map(terminal_result)
                    .unwrap_or_else(|| OnlineQuotaResult::unavailable_at("execute", "timeout"));
                break;
            }
            if commit_deadline.is_some_and(|d| Instant::now() >= d) {
                result = OnlineQuotaResult::unavailable_at("execute", "timeout");
                break;
            }
            match rx.recv_timeout(Duration::from_millis(40)) {
                Ok(Some(line)) => {
                    let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                        break;
                    };
                    if message.get("type").and_then(Value::as_str) == Some("result")
                        && message.as_object().is_some_and(|o| o.len() == 2)
                    {
                        if let Some(value) = message
                            .get("result")
                            .and_then(|v| serde_json::to_vec(v).ok())
                            .and_then(|v| parse_result(&v))
                        {
                            // Observation writes require a grant; early auth/cache/error is allowed.
                            if commit_guard.is_some()
                                || !matches!(value.status, OnlineStatus::Updated)
                            {
                                result = value;
                            }
                            commit_finished = true;
                        }
                        break;
                    }
                    if message.get("type").and_then(Value::as_str) != Some("ready_to_commit")
                        || message.get("nonce").and_then(Value::as_str) != Some(nonce.as_str())
                        || !message.as_object().is_some_and(|o| o.len() == 2)
                        || commit_guard.is_some()
                    {
                        break;
                    }
                    let grant_wait = (Instant::now() + Duration::from_secs(8)).min(deadline);
                    commit_guard = match acquire_grant(grant_wait) {
                        Ok(guard) => Some(guard),
                        Err(denied) => {
                            result = denied;
                            break;
                        }
                    };
                    // Cancellation and issuing the grant share the snapshot
                    // mutex: a cancel accepted before this point forbids commit.
                    let grant_order = task.map(|t| t.snapshot.lock().unwrap());
                    if let Some(status) = task.and_then(QuotaTask::stopped) {
                        result = terminal_result(status);
                        break;
                    }
                    let grant = json!({"type":"grant", "nonce":nonce, "expires_at_ms":deadline_ms});
                    let mut grant = serde_json::to_vec(&grant).unwrap_or_default();
                    grant.push(b'\n');
                    // Even a failed pipe write can be partial: retain the door and
                    // give the acknowledged section its grace before cleanup.
                    commit_deadline = Some(Instant::now() + COMMIT_GRACE);
                    let _ = input_tx.try_send(grant);
                    drop(grant_order);
                }
                Ok(None) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }
    drop(input_tx);
    // A broken/oversized pipe after a grant is not proof that the writer has
    // finished. Keep the door until helper exit or the same bounded grace.
    if !commit_finished {
        if let Some(until) = commit_deadline {
            while Instant::now() < until {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
        }
    }
    // Completion is emitted only after Python's write section returns. On cancellation
    // before a grant no observation write is permitted. Job contains only this helper.
    #[cfg(windows)]
    job.stop();
    let _ = child.kill();
    let _ = child.wait();
    drop(commit_guard);
    result
}

fn collect_controlled(
    app: &tauri::AppHandle,
    request: Value,
    task: Option<&QuotaTask>,
    epoch: u64,
) -> Result<OnlineQuotaResult, String> {
    collect_controlled_in(&NativeCollector(app), request, task, epoch)
}

fn collect_controlled_in<C: CollectorContext>(
    context: &C,
    request: Value,
    task: Option<&QuotaTask>,
    epoch: u64,
) -> Result<OnlineQuotaResult, String> {
    let (script, app_data, home) = context.paths()?;
    let Some(script) = script else {
        return Ok(OnlineQuotaResult::unavailable_at(
            "probe",
            "missing_resource",
        ));
    };
    Ok(execute(
        context, &script, &app_data, &home, &request, task, epoch,
    ))
}

fn freeze_binding(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
) -> Result<u64, String> {
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter_quota()?;
    let _guard = CleanerGuard(app.clone());
    validate_request_binding(app, account_id, expected_identity)?;
    Ok(cleaner.identity_epoch())
}

fn collect(app: &tauri::AppHandle, request: Value) -> Result<OnlineQuotaResult, String> {
    collect_in(&NativeCollector(app), request)
}

fn collect_in<C: CollectorContext>(context: &C, request: Value) -> Result<OnlineQuotaResult, String> {
    let account = request
        .get("account_id")
        .and_then(Value::as_str)
        .ok_or("quotaOnline.unavailable")?;
    let identity = request
        .get("expected_identity")
        .and_then(Value::as_str)
        .ok_or("quotaOnline.unavailable")?;
    let epoch = context.freeze(account, identity)?;
    collect_controlled_in(context, request, None, epoch)
}

#[tauri::command]
pub async fn identities_refresh_quota(
    app: tauri::AppHandle,
    account_id: String,
    expected_identity: String,
) -> Result<OnlineQuotaResult, String> {
    if !valid_account(&account_id) {
        return Err("quotaOnline.unavailable".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        collect(
            &app,
            json!({"account_id":account_id,"expected_identity":expected_identity}),
        )
    })
    .await
    .map_err(|_| "quotaOnline.unavailable".to_string())?
}

#[derive(Clone)]
struct QuotaGroup {
    target: QuotaTarget,
    aliases: Vec<usize>,
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_batch_input(targets: &[QuotaTarget], request_id: &str) -> Result<(), String> {
    if targets.is_empty() || targets.len() > MAX_QUOTA_BATCH || !super::valid_id(request_id) {
        return Err("quotaOnline.unavailable".into());
    }
    let mut ids = std::collections::HashSet::with_capacity(targets.len());
    if targets.iter().any(|target| {
        !valid_account(&target.account_id)
            || !valid_fingerprint(&target.expected_identity)
            || !ids.insert(target.account_id.as_str())
    }) {
        return Err("quotaOnline.unavailable".into());
    }
    Ok(())
}

fn account_mismatch() -> OnlineQuotaResult {
    terminal_result(OnlineStatus::AccountMismatch)
}

fn successful_browser_quota(result: &OnlineQuotaResult) -> bool {
    result.status == OnlineStatus::Updated
        && result.source.as_deref() == Some("browser")
        && result.updated_windows.as_ref().is_some_and(|windows| {
            windows
                .iter()
                .any(|window| window == "5h" || window == "7d")
        })
}

fn quota_identity_for<'a>(state: &'a super::State, account_id: &str) -> Option<&'a str> {
    if account_id == "current" {
        state
            .current
            .present
            .then_some(state.current.quota_identity.as_deref())
            .flatten()
    } else if state.records.iter().any(|record| record.id == account_id) {
        state
            .summaries
            .get(account_id)
            .and_then(|summary| summary.quota_identity.as_deref())
    } else {
        None
    }
}

fn build_quota_groups(targets: &[QuotaTarget], valid: &[bool]) -> Vec<QuotaGroup> {
    let mut groups = Vec::<QuotaGroup>::new();
    let mut by_identity = HashMap::<&str, usize>::new();
    for (index, target) in targets.iter().enumerate() {
        if !valid[index] {
            continue;
        }
        if let Some(group_index) = by_identity.get(target.expected_identity.as_str()).copied() {
            let group = &mut groups[group_index];
            group.aliases.push(index);
            if target.account_id == "current" {
                group.target = target.clone();
            }
        } else {
            by_identity.insert(target.expected_identity.as_str(), groups.len());
            groups.push(QuotaGroup {
                target: target.clone(),
                aliases: vec![index],
            });
        }
    }
    groups
}

fn record_outcome(
    app: &tauri::AppHandle,
    task: &QuotaTask,
    target: &QuotaTarget,
    result: OnlineQuotaResult,
) {
    let mut snapshot = task.snapshot.lock().unwrap();
    if snapshot
        .results
        .iter()
        .any(|r| r.account_id == target.account_id)
    {
        return;
    }
    snapshot.results.push(QuotaAccountResult {
        account_id: target.account_id.clone(),
        expected_identity: target.expected_identity.clone(),
        result: result.clone(),
    });
    snapshot.completed = snapshot.results.len();
    let _ = app.emit(
        "quota-batch-progress",
        QuotaBatchProgress {
            request_id: snapshot.request_id.clone(),
            account_id: target.account_id.clone(),
            expected_identity: target.expected_identity.clone(),
            result,
            completed: snapshot.completed,
            total: snapshot.total,
            state: snapshot.state,
        },
    );
}

fn finalize_task(task: &QuotaTask) -> BatchQuotaResult {
    let mut snapshot = task.snapshot.lock().unwrap();
    if !snapshot.state.active() {
        return snapshot.clone();
    }
    let missing: Vec<_> = snapshot
        .targets
        .iter()
        .filter(|target| {
            !snapshot
                .results
                .iter()
                .any(|r| r.account_id == target.account_id)
        })
        .cloned()
        .collect();
    for target in missing {
        snapshot.results.push(QuotaAccountResult {
            account_id: target.account_id,
            expected_identity: target.expected_identity,
            result: terminal_result(OnlineStatus::NotRun),
        });
    }
    let positions: HashMap<_, _> = snapshot
        .targets
        .iter()
        .enumerate()
        .map(|(i, t)| (t.account_id.clone(), i))
        .collect();
    snapshot.results.sort_by_key(|r| positions[&r.account_id]);
    snapshot.completed = snapshot.results.len();
    snapshot.state = if task.cancel.load(Ordering::SeqCst) {
        QuotaTaskState::Cancelled
    } else if Instant::now() >= task.deadline {
        QuotaTaskState::DeadlineExceeded
    } else {
        QuotaTaskState::Completed
    };
    snapshot.clone()
}

struct TaskFinalizer(Arc<QuotaTask>);
impl Drop for TaskFinalizer {
    fn drop(&mut self) {
        finalize_task(&self.0);
    }
}

fn browser_fallback_allowed(result: &OnlineQuotaResult) -> bool {
    matches!(
        result.status,
        OnlineStatus::AuthRequired | OnlineStatus::Unavailable | OnlineStatus::NetworkError
    ) || result.status == OnlineStatus::Cooldown
        && result.retry_scope.as_deref() == Some("oauth")
        && result.reason.as_deref() == Some("auth_required")
}

#[tauri::command]
pub async fn identities_refresh_all_quotas(
    app: tauri::AppHandle,
    targets: Vec<QuotaTarget>,
    request_id: String,
    allow_browser_fallback: Option<bool>,
) -> Result<BatchQuotaResult, String> {
    validate_batch_input(&targets, &request_id)?;
    // Brief door only: recovery and identity generation are frozen before any
    // runtime probe/network. Every later write requires a fresh short grant.
    let (valid, epoch) = {
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        cleaner.enter_quota().map_err(|_| "quotaOnline.busy")?;
        let _guard = CleanerGuard(app.clone());
        let state = super::state(&app).map_err(|_| "quotaOnline.unavailable")?;
        if state.recovery.is_some() {
            return Err("quotaOnline.busy".into());
        }
        (
            targets
                .iter()
                .map(|t| {
                    matches_identity(
                        &t.expected_identity,
                        quota_identity_for(&state, &t.account_id),
                    )
                })
                .collect::<Vec<_>>(),
            cleaner.identity_epoch(),
        )
    };
    let task = {
        let mut registry = tasks().lock().map_err(|_| "quotaOnline.unavailable")?;
        if registry
            .recent
            .iter()
            .any(|t| t.snapshot.lock().unwrap().state.active())
        {
            return Err("quotaOnline.busy".into());
        }
        // Request IDs are immutable within the retained history; retry uses a new ID.
        if registry
            .recent
            .iter()
            .any(|t| t.snapshot.lock().unwrap().request_id == request_id)
        {
            return Err("quotaOnline.busy".into());
        }
        let started = now_ms();
        let task = Arc::new(QuotaTask {
            snapshot: Mutex::new(BatchQuotaResult {
                request_id: request_id.clone(),
                results: Vec::new(),
                completed: 0,
                total: targets.len(),
                state: QuotaTaskState::Queued,
                targets: targets.clone(),
                started_at_ms: started,
                deadline_at_ms: started + BATCH_BUDGET.as_millis() as u64,
            }),
            cancel: AtomicBool::new(false),
            deadline: Instant::now() + BATCH_BUDGET,
        });
        // Eight bounded snapshots (at most 256 outcomes each), never raw usage.
        if registry.recent.len() >= 8 {
            registry.recent.remove(0);
        }
        registry.recent.push(task.clone());
        task
    };
    let finalizer = TaskFinalizer(task.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _finalizer = finalizer;
        { let mut snapshot = task.snapshot.lock().unwrap();
          if !task.cancel.load(Ordering::SeqCst) { snapshot.state = QuotaTaskState::Running; } }
        let groups = build_quota_groups(&targets, &valid);
        for (index, target) in targets.iter().enumerate() {
            if !valid[index] { record_outcome(&app, &task, target, account_mismatch()); }
        }
        let queue = Mutex::new(groups.into_iter().rev().collect::<Vec<_>>());
        std::thread::scope(|scope| {
            for _ in 0..2 {
                let queue = &queue; let targets = &targets; let app = &app; let task = &task;
                scope.spawn(move || loop {
                    let group = { let mut queue = queue.lock().unwrap();
                        if task.stopped().is_some() { None } else { queue.pop() } };
                    let Some(group) = group else { break; };
                    let target = &group.target;
                    let mut result = collect_controlled(app, json!({"account_id":target.account_id,"expected_identity":target.expected_identity}), Some(task), epoch)
                        .unwrap_or_else(|_| OnlineQuotaResult::unavailable());
                    if allow_browser_fallback.unwrap_or(false) && browser_fallback_allowed(&result) && task.stopped().is_none() {
                        if let Ok(snapshot) = crate::browser::quota_bridge::query_existing_profile(
                            app, &target.account_id, &target.expected_identity, task.deadline,
                            &|| task.stopped().is_some(),
                        ) {
                            if task.stopped().is_none() {
                                if let Ok(browser_result) = collect_controlled(app, json!({"account_id":target.account_id,"expected_identity":target.expected_identity,"browser_snapshot":snapshot}), Some(task), epoch) {
                                    if successful_browser_quota(&browser_result) { result = browser_result; }
                                }
                            }
                        }
                    }
                    if let Some(stopped) = task.stopped() { result = terminal_result(stopped); }
                    for index in group.aliases { record_outcome(app, task, &targets[index], result.clone()); }
                });
            }
        });
        let result = finalize_task(&task);
        let _ = app.emit("quota-batch-state", &result);
        Ok(result)
    }).await.map_err(|_| "quotaOnline.unavailable".to_string())?
}

pub(crate) fn import_browser_snapshot(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    snapshot: Value,
) -> Result<Value, String> {
    if !valid_account(account_id) {
        return Err("quotaOnline.unavailable".into());
    }
    let result = (|| {
        let (current_id, current_identity) = current_browser_binding(app)?;
        if account_id != current_id || !matches_identity(expected_identity, Some(&current_identity))
        {
            return Err("quotaOnline.accountMismatch".into());
        }
        let result = collect(
            app,
            json!({"account_id": account_id, "expected_identity": expected_identity, "browser_snapshot": snapshot}),
        )?;
        serde_json::to_value(result).map_err(|_| "quotaOnline.unavailable".into())
    })();
    result
}

pub(crate) fn current_browser_binding(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let state = super::state(app)?;
    if state.recovery.is_some() || !state.current.present {
        return Err("quotaOnline.unavailable".into());
    }
    let identity = state
        .current
        .quota_identity
        .ok_or("quotaOnline.unavailable")?;
    Ok((state.active, identity))
}

fn metadata_entry(root: &Value, identity: &str, now_ms: u64) -> Option<WebMetadata> {
    if root.get("version")?.as_u64()? != 1 || identity.len() != 64 {
        return None;
    }
    let mut data: WebMetadata =
        serde_json::from_value(root.get("accounts")?.get(identity)?.clone()).ok()?;
    let valid_time =
        |time: Option<u64>| time.is_some_and(|t| t > 0 && t <= now_ms.saturating_add(300_000));
    let billing_time = data.billing_observed_at_ms.or(data.metadata_observed_at_ms);
    let reset_time = data
        .manual_resets_observed_at_ms
        .or(data.metadata_observed_at_ms);
    let now_sec = now_ms / 1000;
    let valid_reset_expiry = data.manual_resets_valid_until.is_some_and(|expiry| {
        expiry > 0 && expiry <= now_sec.saturating_add(24 * 60 * 60 + 300)
    });
    if !valid_time(billing_time)
        || !matches!(
            data.billing_date_kind.as_deref(),
            Some("next_renewal" | "access_until")
        )
        || !data
            .billing_date
            .is_some_and(|date| date > 0 && date <= 253402300799)
    {
        data.billing_date = None;
        data.billing_date_kind = None;
        data.billing_observed_at_ms = None;
    } else {
        data.billing_observed_at_ms = billing_time;
    }
    if !valid_time(reset_time) || data.manual_resets_remaining.is_none() || !valid_reset_expiry {
        data.manual_resets_remaining = None;
        data.manual_resets_valid_until = None;
        data.manual_resets_observed_at_ms = None;
    } else if data.manual_resets_remaining.is_some() {
        data.manual_resets_observed_at_ms = reset_time;
    }
    data.metadata_observed_at_ms = data
        .billing_observed_at_ms
        .max(data.manual_resets_observed_at_ms);
    Some(data)
}

pub(super) fn apply_metadata(vault: &Path, identity: Option<&str>, output: &mut WebMetadata) {
    // Cached summary fields are not proof of their identity. Always reconstruct
    // this view from the exact fingerprint-qualified metadata entry.
    *output = WebMetadata::default();
    let Some(identity) = identity else { return };
    let path = vault.join("quota_web_metadata.json");
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return;
    };
    if !metadata.is_file()
        || crate::cleaner::linked(&metadata)
        || metadata.len() > 1024 * 1024
        || super::private::safe(&path).is_err()
    {
        return;
    }
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let mut bytes = Vec::new();
    if file.take(1024 * 1024 + 1).read_to_end(&mut bytes).is_err() || bytes.len() > 1024 * 1024 {
        return;
    }
    let Ok(root) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis() as u64)
        .unwrap_or(0);
    if let Some(data) = metadata_entry(&root, identity, now) {
        *output = data;
    }
}

#[cfg(test)]
#[path = "online_native_chain_tests.rs"]
mod native_chain_tests;

#[cfg(test)]
#[path = "online_passive_revision_tests.rs"]
mod passive_revision_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_task(targets: Vec<QuotaTarget>, budget: Duration) -> Arc<QuotaTask> {
        Arc::new(QuotaTask {
            snapshot: Mutex::new(BatchQuotaResult {
                request_id: "a".repeat(32),
                total: targets.len(),
                targets,
                results: Vec::new(),
                completed: 0,
                state: QuotaTaskState::Running,
                started_at_ms: now_ms(),
                deadline_at_ms: now_ms() + budget.as_millis() as u64,
            }),
            cancel: AtomicBool::new(false),
            deadline: Instant::now() + budget,
        })
    }

    #[test]
    fn task_finalization_covers_unexecuted_targets_and_retains_completed_observations() {
        for cancelled in [false, true] {
            let a = target("current", &"a".repeat(64));
            let b = target(&"b".repeat(32), &"b".repeat(64));
            let task = synthetic_task(vec![a.clone(), b], Duration::from_secs(120));
            task.snapshot
                .lock()
                .unwrap()
                .results
                .push(QuotaAccountResult {
                    account_id: a.account_id,
                    expected_identity: a.expected_identity,
                    result: terminal_result(OnlineStatus::Updated),
                });
            task.cancel.store(cancelled, Ordering::SeqCst);
            let finished = finalize_task(&task);
            assert_eq!(
                finished.state,
                if cancelled {
                    QuotaTaskState::Cancelled
                } else {
                    QuotaTaskState::Completed
                }
            );
            assert_eq!(finished.completed, 2);
            assert_eq!(finished.results[0].result.status, OnlineStatus::Updated);
            assert_eq!(finished.results[1].result.status, OnlineStatus::NotRun);
            assert_eq!(finalize_task(&task).results.len(), 2);
        }
        let task = synthetic_task(vec![target("current", &"a".repeat(64))], Duration::ZERO);
        assert_eq!(task.stopped(), Some(OnlineStatus::DeadlineExceeded));
        assert_eq!(finalize_task(&task).state, QuotaTaskState::DeadlineExceeded);
    }

    #[test]
    fn read_doors_preserve_generation_and_explicit_identity_mutation_invalidates() {
        let cleaner = crate::cleaner::Cleaner::default();
        let epoch = cleaner.identity_epoch();
        cleaner.enter().unwrap();
        assert!(cleaner.enter_quota().is_err());
        cleaner.leave();
        cleaner.enter_quota().unwrap();
        cleaner.leave();
        assert_eq!(cleaner.identity_epoch(), epoch);
        cleaner.enter().unwrap();
        cleaner.begin_identity_change();
        cleaner.leave();
        assert_ne!(cleaner.identity_epoch(), epoch);
    }

    #[test]
    fn auth_cooldown_can_try_browser_but_route_mismatch_invalid_and_server_cooldown_cannot() {
        let auth = parse_result(
            br#"{"status":"cooldown","reason":"auth_required","retry_scope":"oauth"}"#,
        )
        .unwrap();
        assert!(browser_fallback_allowed(&auth));
        for bytes in [
            br#"{"status":"cooldown","reason":"rate_limited","retry_scope":"all"}"#.as_slice(),
            br#"{"status":"route_unavailable","reason":"unsupported_proxy","stage":"route","route_mode":"account_proxy"}"#,
            br#"{"status":"account_mismatch"}"#,
            br#"{"status":"invalid_response"}"#,
        ] { assert!(!browser_fallback_allowed(&parse_result(bytes).unwrap())); }
        assert!(parse_result(br#"{"status":"updated","reason":"raw-route"}"#).is_none());
        assert!(parse_result(br#"{"status":"updated","stage":"unknown"}"#).is_none());
    }

    struct ProtocolFixture(PathBuf);
    impl ProtocolFixture {
        fn new(script: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "claude-local-quota-protocol-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            fs::write(
                path.join("quota_runtime.py"),
                "print('{\"schema\":1,\"compatible\":true}')",
            )
            .unwrap();
            fs::write(path.join("helper.py"), script).unwrap();
            Self(path)
        }
    }
    impl Drop for ProtocolFixture {
        fn drop(&mut self) {
            // Only the exact synthetic fixture files; no recursive cleanup.
            for name in [
                "quota_runtime.py",
                "helper.py",
                "network_waiting",
                "release",
                "committed",
            ] {
                let _ = fs::remove_file(self.0.join(name));
            }
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn blocked_helper_network_does_not_hold_identity_door_and_changed_epoch_denies_commit() {
        let fixture = ProtocolFixture::new(
            r#"
import sys,json,time,pathlib
root=pathlib.Path(__file__).parent
r=json.loads(sys.stdin.readline())
(root/'network_waiting').write_text('1')
while not (root/'release').exists(): time.sleep(.01)
print(json.dumps({'type':'ready_to_commit','nonce':r['nonce']}),flush=True)
grant=sys.stdin.readline()
if grant:
 (root/'committed').write_text('1')
 print(json.dumps({'type':'result','result':{'status':'updated'}}),flush=True)
"#,
        );
        let cleaner = Arc::new(crate::cleaner::Cleaner::default());
        let epoch = cleaner.identity_epoch();
        std::thread::scope(|scope| {
            let path = &fixture.0;
            let cleaner = &cleaner;
            let worker = scope.spawn(move || {
                execute_with_gate(
                    &path.join("helper.py"),
                    path,
                    path,
                    &json!({"account_id":"current","expected_identity":"a".repeat(64)}),
                    None,
                    |_| -> Result<(), OnlineQuotaResult> {
                        cleaner.enter_quota().unwrap();
                        let changed = cleaner.identity_epoch() != epoch;
                        cleaner.leave();
                        assert!(changed);
                        Err(account_mismatch())
                    },
                )
            });
            let until = Instant::now() + Duration::from_secs(5);
            while !path.join("network_waiting").exists() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(10));
            }
            assert!(path.join("network_waiting").exists());
            // This is the real identity door while a real child is blocked.
            cleaner.enter().unwrap();
            cleaner.begin_identity_change();
            cleaner.leave();
            fs::write(path.join("release"), "1").unwrap();
            assert_eq!(worker.join().unwrap().status, OnlineStatus::AccountMismatch);
        });
        assert!(!fixture.0.join("committed").exists());
    }

    #[test]
    fn native_protocol_rejects_oversized_output_and_wrong_nonce_without_grant() {
        for script in [
            "print('x'*17000,flush=True)",
            "import json; print(json.dumps({'type':'ready_to_commit','nonce':'wrong'}),flush=True)",
            "import sys; sys.exit(0)",
        ] {
            let fixture = ProtocolFixture::new(script);
            let mut grants = 0;
            let result = execute_with_gate(
                &fixture.0.join("helper.py"),
                &fixture.0,
                &fixture.0,
                &json!({}),
                None,
                |_| {
                    grants += 1;
                    Ok(())
                },
            );
            assert_eq!(grants, 0);
            assert_eq!(result.status, OnlineStatus::Unavailable);
        }
    }

    #[test]
    fn cancellation_after_grant_preserves_acknowledged_commit_and_holds_door_until_result() {
        let fixture = ProtocolFixture::new(
            r#"
import sys,json,time,pathlib
root=pathlib.Path(__file__).parent
r=json.loads(sys.stdin.readline())
print(json.dumps({'type':'ready_to_commit','nonce':r['nonce']}),flush=True)
g=json.loads(sys.stdin.readline())
assert g['nonce']==r['nonce'] and g['type']=='grant'
(root/'committed').write_text('1')
while not (root/'release').exists(): time.sleep(.01)
print(json.dumps({'type':'result','result':{'status':'updated','source':'oauth'}}),flush=True)
"#,
        );
        struct TestGuard(Arc<crate::cleaner::Cleaner>);
        impl Drop for TestGuard {
            fn drop(&mut self) {
                self.0.leave();
            }
        }
        let cleaner = Arc::new(crate::cleaner::Cleaner::default());
        let task = synthetic_task(
            vec![target("current", &"a".repeat(64))],
            Duration::from_secs(120),
        );
        std::thread::scope(|scope| {
            let path = &fixture.0;
            let cleaner = &cleaner;
            let task = &task;
            let worker = scope.spawn(move || {
                execute_with_gate(
                    &path.join("helper.py"),
                    path,
                    path,
                    &json!({}),
                    Some(task),
                    |_| {
                        cleaner.enter_quota().unwrap();
                        Ok(TestGuard(cleaner.clone()))
                    },
                )
            });
            let until = Instant::now() + Duration::from_secs(5);
            while !path.join("committed").exists() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(10));
            }
            assert!(path.join("committed").exists());
            task.cancel.store(true, Ordering::SeqCst);
            assert!(cleaner.enter().is_err());
            fs::write(path.join("release"), "1").unwrap();
            assert_eq!(worker.join().unwrap().status, OnlineStatus::Updated);
            cleaner.enter().unwrap();
            cleaner.leave();
            assert_eq!(finalize_task(task).state, QuotaTaskState::Cancelled);
        });
    }

    #[test]
    fn runtime_selection_skips_incompatible_candidate_and_stops_at_first_compatible() {
        let mut attempted = Vec::new();
        let selected = select_runtime(|candidate| {
            attempted.push(candidate);
            if candidate == "python3" {
                Ok(())
            } else {
                Err("missing_dependency")
            }
        });
        assert_eq!(selected, Ok("python3"));
        assert_eq!(attempted, vec!["python", "python3"]);

        let mut attempted = Vec::new();
        let selected = select_runtime(|candidate| {
            attempted.push(candidate);
            Err("probe_failed")
        });
        assert_eq!(selected, Err("probe_failed"));
        assert_eq!(attempted, vec!["python", "python3", "py"]);
    }

    #[test]
    fn result_boundary_rejects_extra_fields_and_unknown_windows() {
        assert!(parse_result(br#"{"status":"updated","updated_windows":["5h","7d"]}"#).is_some());
        assert!(parse_result(br#"{"status":"updated","source":"browser"}"#).is_some());
        assert!(parse_result(
            br#"{"status":"cooldown","last_observed_at_ms":123,"source":"oauth"}"#
        )
        .is_some());
        assert!(parse_result(br#"{"status":"updated","source":"other"}"#).is_none());
        assert!(parse_result(br#"{"status":"updated","accessToken":"synthetic"}"#).is_none());
        assert!(parse_result(br#"{"status":"updated","updated_windows":["other"]}"#).is_none());
        assert!(!valid_account("../other"));
    }

    #[test]
    fn browser_fallback_requires_a_fresh_quota_window_update() {
        let metadata_only = parse_result(
            br#"{"status":"updated","source":"browser","updated_windows":[],"metadata_updated":true}"#,
        )
        .unwrap();
        let cached =
            parse_result(br#"{"status":"cached","source":"browser","updated_windows":["5h"]}"#)
                .unwrap();
        let quota_update =
            parse_result(br#"{"status":"updated","source":"browser","updated_windows":["7d"]}"#)
                .unwrap();

        assert!(!successful_browser_quota(&metadata_only));
        assert!(!successful_browser_quota(&cached));
        assert!(successful_browser_quota(&quota_update));
    }

    #[test]
    fn frozen_identity_never_falls_back_to_another_or_missing_account() {
        let account_a = "a".repeat(64);
        let account_b = "b".repeat(64);
        assert!(matches_identity(&account_a, Some(&account_a)));
        assert!(!matches_identity(&account_a, Some(&account_b)));
        assert!(!matches_identity(&account_a, None));
        assert!(!matches_identity("", None));
        assert!(!matches_identity(&"A".repeat(64), Some(&"A".repeat(64))));
    }

    #[test]
    fn metadata_requires_matching_identity_and_preserves_zero() {
        let key = "a".repeat(64);
        let mut root = json!({"version":1,"accounts":{}});
        root["accounts"][&key] = json!({"billing_date_kind":"next_renewal","billing_date":2000000000u64,
            "manual_resets_remaining":0,"manual_resets_valid_until":2000,
            "billing_observed_at_ms":1000,"manual_resets_observed_at_ms":500});
        let value = metadata_entry(&root, &key, 2000).unwrap();
        assert_eq!(value.manual_resets_remaining, Some(0));
        assert_eq!(value.manual_resets_valid_until, Some(2000));
        assert_eq!(value.billing_observed_at_ms, Some(1000));
        assert_eq!(value.manual_resets_observed_at_ms, Some(500));
        assert!(metadata_entry(&root, &"b".repeat(64), 2000).is_none());
        root["accounts"][&key]["billing_date_kind"] = json!("credential_expiry");
        assert_eq!(
            metadata_entry(&root, &key, 2000).unwrap().billing_date,
            None
        );
    }

    #[test]
    fn reset_expiry_projection_rejects_missing_nonpositive_and_implausibly_future_values() {
        let key = "a".repeat(64);
        let make = |expiry: Option<u64>| {
            let mut root = json!({"version":1,"accounts":{}});
            root["accounts"][&key] = json!({
                "manual_resets_remaining": 1,
                "manual_resets_observed_at_ms": 1_000,
                "manual_resets_valid_until": expiry
            });
            metadata_entry(&root, &key, 2_000).unwrap()
        };
        for invalid in [None, Some(0), Some(100_000)] {
            let value = make(invalid);
            assert_eq!(value.manual_resets_remaining, None);
            assert_eq!(value.manual_resets_valid_until, None);
            assert_eq!(value.manual_resets_observed_at_ms, None);
        }
        let expired_but_well_formed = make(Some(1));
        assert_eq!(expired_but_well_formed.manual_resets_remaining, Some(1));
        assert_eq!(expired_but_well_formed.manual_resets_valid_until, Some(1));
    }

    fn target(account_id: &str, fingerprint: &str) -> QuotaTarget {
        QuotaTarget {
            account_id: account_id.into(),
            expected_identity: fingerprint.into(),
        }
    }

    #[test]
    fn batch_input_requires_bounded_unique_ids_and_frozen_fingerprints() {
        let fingerprint = "a".repeat(64);
        assert!(validate_batch_input(&[target("current", &fingerprint)], &"b".repeat(32)).is_ok());
        assert!(
            validate_batch_input(&[target(&"c".repeat(32), &fingerprint)], &"b".repeat(32)).is_ok()
        );
        assert!(validate_batch_input(&[], &"b".repeat(32)).is_err());
        assert!(validate_batch_input(
            &[
                target("current", &fingerprint),
                target("current", &fingerprint)
            ],
            &"b".repeat(32)
        )
        .is_err());
        assert!(
            validate_batch_input(&[target("current", &"A".repeat(64))], &"b".repeat(32)).is_err()
        );
        assert!(validate_batch_input(
            &vec![target("current", &fingerprint); MAX_QUOTA_BATCH + 1],
            &"b".repeat(32)
        )
        .is_err());
    }

    #[test]
    fn batch_groups_same_fingerprint_once_and_prefers_current() {
        let fingerprint = "a".repeat(64);
        let targets = vec![
            target(&"c".repeat(32), &fingerprint),
            target("current", &fingerprint),
            target(&"d".repeat(32), &"e".repeat(64)),
        ];
        let groups = build_quota_groups(&targets, &[true, true, true]);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].target.account_id, "current");
        assert_eq!(groups[0].aliases, vec![0, 1]);
        assert_eq!(groups[1].aliases, vec![2]);
    }
}
