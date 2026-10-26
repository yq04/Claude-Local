// [INPUT]: Explicit versioned settings, restricted local quota summaries and the shared audited collector.
// [OUTPUT]: One process-owned scheduler, private durable plans and bounded status-only events.
// [POS]: No HTTP or quota-ledger writer; survives page unmount, stops with the application.
// [PROTOCOL]: Keep identities/CLAUDE.md and frontend IPC types aligned.
use super::online::{OnlineQuotaResult, OnlineStatus, WakeupEffect};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

const MAX_ACCOUNTS: usize = 256;
const SPACING_MS: u64 = 13 * 60_000; // An assigned proxy does not prove an independent exit.
const MAX_TIME: u64 = 8_640_000_000_000;
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn identity_valid(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn route_capability(proxy: &str, inherited: bool) -> &'static str {
    if proxy.is_empty() {
        return "http_connect";
    }
    if proxy.len() > 2048 || proxy.bytes().any(|b| b <= 32) {
        return "transport_unsupported";
    }
    let normalized = if inherited && !proxy.contains("://") {
        format!("http://{proxy}")
    } else {
        proxy.to_string()
    };
    match reqwest::Url::parse(&normalized) {
        Ok(url)
            if url.scheme() == "http"
                && url.host_str().is_some()
                && url.port() != Some(0)
                && url.username().is_empty()
                && url.password().is_none()
                && matches!(url.path(), "" | "/")
                && url.query().is_none()
                && url.fragment().is_none() =>
        {
            "http_connect"
        }
        _ => "transport_unsupported",
    }
}
fn host_proxy() -> String {
    if let Some(value) = [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .iter()
    .filter_map(|key| std::env::var(key).ok())
    .find(|v| !v.is_empty())
    {
        return value;
    }
    #[cfg(windows)]
    {
        crate::windows::system_proxy()
    }
    #[cfg(not(windows))]
    {
        String::new()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub use_time_window: bool,
    pub start_minute: u16,
    pub end_minute: u16,
    pub prewarm_threshold_pct: u8,
    pub excluded_identities: Vec<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            use_time_window: true,
            start_minute: 480,
            end_minute: 1380,
            prewarm_threshold_pct: 40,
            excluded_identities: vec![],
        }
    }
}
impl Config {
    fn valid(&self) -> bool {
        self.start_minute < 1440
            && self.end_minute < 1440
            && (10..=80).contains(&self.prewarm_threshold_pct)
            && self.excluded_identities.len() <= MAX_ACCOUNTS
            && self.excluded_identities.iter().all(|s| identity_valid(s))
    }
    fn within(&self, minute: u16) -> bool {
        if self.use_time_window && minute >= 1440 {
            return false;
        }
        !self.use_time_window
            || self.start_minute == self.end_minute
            || if self.start_minute < self.end_minute {
                minute >= self.start_minute && minute < self.end_minute
            } else {
                minute >= self.start_minute || minute < self.end_minute
            }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Account {
    pub unused_streak: u8,
    pub last_woken_for_reset_sec: Option<u64>,
    pub last_woken_at_ms: Option<u64>,
    pub last_attempt_at_ms: Option<u64>,
    pub woken_window_reset_sec: Option<u64>,
    pub used_during_woken_window: bool,
    pub scheduled_for_reset_sec: Option<u64>,
    pub scheduled_at_ms: Option<u64>,
    pub last_status: Option<String>,
    pub backoff_until_ms: Option<u64>,
    pub decision: String,
    pub capability: String,
    pub unknown: bool,
    pub auth_blocked: bool,
    pub recovery_allowed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub schema: u8,
    pub migrated: bool,
    pub config: Config,
    pub targets: Vec<String>,
    pub last_global_wakeup_at_ms: u64,
    pub next_global_at_ms: u64,
    pub accounts: BTreeMap<String, Account>,
    pub status: String,
    pub runtime: String,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            schema: 1,
            migrated: false,
            config: Config::default(),
            targets: vec![],
            last_global_wakeup_at_ms: 0,
            next_global_at_ms: 0,
            accounts: BTreeMap::new(),
            status: "disabled".into(),
            runtime: "unknown".into(),
        }
    }
}
impl Snapshot {
    fn valid(&self) -> bool {
        self.schema == 1
            && self.config.valid()
            && self.targets.len() <= MAX_ACCOUNTS
            && self.targets.iter().all(|s| identity_valid(s))
            && self.accounts.len() <= MAX_ACCOUNTS
            && self.last_global_wakeup_at_ms <= MAX_TIME
            && self.next_global_at_ms <= MAX_TIME
            && self.accounts.iter().all(|(id, a)| {
                identity_valid(id)
                    && a.unused_streak <= 10
                    && [
                        a.last_attempt_at_ms,
                        a.last_woken_at_ms,
                        a.scheduled_at_ms,
                        a.backoff_until_ms,
                    ]
                    .iter()
                    .flatten()
                    .all(|t| *t <= MAX_TIME)
                    && [
                        a.last_woken_for_reset_sec,
                        a.woken_window_reset_sec,
                        a.scheduled_for_reset_sec,
                    ]
                    .iter()
                    .flatten()
                    .all(|t| *t > 0 && *t <= MAX_TIME / 1000)
                    && a.last_status.as_ref().is_none_or(|s| {
                        matches!(
                            s.as_str(),
                            "updated"
                                | "auth_required"
                                | "rate_limited"
                                | "cooldown"
                                | "error"
                                | "outcome_unknown"
                                | "cached"
                                | "unavailable"
                                | "network_error"
                                | "invalid_response"
                                | "account_mismatch"
                                | "route_unavailable"
                                | "cancelled"
                                | "not_run"
                                | "deadline_exceeded"
                        )
                    })
                    && matches!(
                        a.decision.as_str(),
                        "" | "running"
                            | "active_window_running"
                            | "disabled_by_user"
                            | "cli_active"
                            | "low_7d_quota"
                            | "outcome_unknown"
                            | "auth_blocked"
                            | "capability_blocked"
                            | "not_expired"
                            | "already_woken"
                            | "backoff_cooldown"
                            | "scheduled"
                            | "standby_idle"
                    )
                    && matches!(
                        a.capability.as_str(),
                        "" | "http_connect" | "auth_required" | "transport_unsupported"
                    )
            })
            && matches!(
                self.status.as_str(),
                "disabled" | "storage_error" | "scope_changed" | "outside_window" | "waiting"
            )
            && matches!(self.runtime.as_str(), "unknown" | "available")
    }
}
fn read_disk(path: &Path) -> Result<Snapshot, String> {
    if !path.exists() {
        return Ok(Snapshot::default());
    }
    super::private::safe(path)?;
    if std::fs::metadata(path)
        .map_err(|_| "wakeup.stateSaveFailed")?
        .len()
        > 262_144
    {
        return Err("wakeup.stateSaveFailed".into());
    }
    let mut state: Snapshot =
        serde_json::from_slice(&std::fs::read(path).map_err(|_| "wakeup.stateSaveFailed")?)
            .map_err(|_| "wakeup.stateSaveFailed")?;
    if !state.valid() {
        return Err("wakeup.stateSaveFailed".into());
    }
    // Dispatch is journaled before the collector runs. A crash never replays it.
    for account in state.accounts.values_mut() {
        if account.decision == "running" {
            account.unknown = true;
            account.last_status = Some("outcome_unknown".into());
            account.decision = "outcome_unknown".into();
        }
    }
    Ok(state)
}
fn persist(path: &Path, state: &Snapshot) -> Result<(), String> {
    if !state.valid() {
        return Err("wakeup.stateSaveFailed".into());
    }
    super::private::write(
        path,
        &serde_json::to_vec(state).map_err(|_| "wakeup.stateSaveFailed")?,
    )
    .map_err(|_| "wakeup.stateSaveFailed".into())
}
#[derive(Clone, Debug)]
struct Candidate {
    account_id: String,
    identity: String,
    reset: Option<u64>,
    inferred: bool,
    trusted_observed_at_ms: Option<u64>,
    used: u8,
    weekly: Option<u8>,
    running: bool,
    capability: String,
}
fn candidates(app: &tauri::AppHandle) -> Result<(Vec<Candidate>, Option<u8>), String> {
    let state = super::state_for(app, false)?;
    let active_rem = state
        .current
        .quota_5h_used
        .filter(|_| {
            state
                .current
                .quota_5h_reset_at
                .is_some_and(|r| r > now_ms() / 1000)
        })
        .map(|used| 100 - used);
    let mut result = Vec::new();
    let host_proxy = host_proxy();
    let mut add = |account_id: String, summary: super::profile::Summary, running| {
        if let Some(id) = summary.quota_identity.filter(|id| identity_valid(id)) {
            if result.iter().any(|c: &Candidate| c.identity == id) {
                return;
            }
            let capability = if summary.auth_status.as_deref() == Some("expired") {
                "auth_required"
            } else if let Some(proxy) = summary.proxy.as_deref().filter(|v| !v.trim().is_empty()) {
                route_capability(proxy, false)
            } else {
                route_capability(&host_proxy, true)
            };
            result.push(Candidate {
                account_id,
                identity: id,
                reset: summary.quota_5h_reset_at,
                inferred: summary.quota_5h_source
                    == Some(super::profile::QuotaSource::ResetInferred),
                trusted_observed_at_ms: if summary.quota_5h_source
                    == Some(super::profile::QuotaSource::ServerAnchor)
                {
                    summary.quota_5h_observed_at_ms
                } else {
                    None
                },
                used: summary.quota_5h_used.unwrap_or(0),
                weekly: summary.quota_7d_used.filter(|_| {
                    summary
                        .quota_7d_reset_at
                        .is_some_and(|r| r > now_ms() / 1000)
                }),
                running,
                capability: capability.into(),
            });
        }
    };
    if state.current.present {
        add(
            "current".into(),
            super::profile::Summary::from_current(&state.current),
            state.running,
        );
    }
    for record in state.records {
        if record.id != state.active {
            if let Some(summary) = state.summaries.get(&record.id) {
                add(record.id, summary.clone(), false);
            }
        }
    }
    Ok((result, active_rem))
}
fn target_set(candidates: &[Candidate]) -> Vec<String> {
    let mut ids: Vec<_> = candidates.iter().map(|c| c.identity.clone()).collect();
    ids.sort();
    ids.dedup();
    ids
}
fn delay(streak: u8, random: u64) -> u64 {
    let (base, range) = if streak == 0 {
        (180_000, 420_000)
    } else if streak == 1 {
        (1_500_000, 2_100_000)
    } else {
        (90_000, 150_000)
    };
    base + random % (range + 1)
}
fn random() -> u64 {
    super::codec::random::<8>()
        .map(u64::from_le_bytes)
        .unwrap_or(0)
}
fn plan(
    state: &mut Snapshot,
    items: &[Candidate],
    active: Option<u8>,
    now: u64,
    minute: u16,
    jitter: u64,
) -> Option<Candidate> {
    // Reconcile an uncertain POST only from independently committed, fresh local
    // server evidence. This sends no GET and never clears messages authorization.
    for item in items {
        if let Some(a) = state.accounts.get_mut(&item.identity) {
            if a.unknown
                && item.trusted_observed_at_ms.is_some_and(|observed| {
                    observed <= now.saturating_add(5_000)
                        && a.last_attempt_at_ms
                            .is_some_and(|attempt| observed >= attempt)
                })
                && item.reset.is_some_and(|reset| {
                    reset > now / 1000 && a.scheduled_for_reset_sec.is_some_and(|old| reset > old)
                })
            {
                a.unknown = false;
                a.last_status = Some("updated".into());
                a.last_woken_for_reset_sec = a.scheduled_for_reset_sec;
                a.last_woken_at_ms = item.trusted_observed_at_ms;
                a.woken_window_reset_sec = item.reset;
                a.used_during_woken_window = item.used > 1;
                a.backoff_until_ms = None;
                a.decision = if a.auth_blocked {
                    "auth_blocked"
                } else {
                    "active_window_running"
                }
                .into();
            }
        }
    }
    if !state.config.enabled {
        state.status = "disabled".into();
        return None;
    }
    if state.targets != target_set(items) {
        state.status = "scope_changed".into();
        return None;
    }
    if !state.config.within(minute) {
        state.status = "outside_window".into();
        return None;
    }
    state.status = "waiting".into();
    for item in items {
        let a = state.accounts.entry(item.identity.clone()).or_default();
        a.capability = item.capability.clone();
        a.auth_blocked |= item.capability == "auth_required";
        if item.reset.is_some_and(|r| r > now / 1000) {
            if item.used > 1 {
                a.unused_streak = 0;
                a.used_during_woken_window = true;
            }
            a.scheduled_at_ms = None;
            if !a.unknown {
                a.scheduled_for_reset_sec = None;
            }
            a.decision = if a.unknown {
                "outcome_unknown"
            } else {
                "active_window_running"
            }
            .into();
            continue;
        }
        a.decision = if state.config.excluded_identities.contains(&item.identity) {
            "disabled_by_user"
        } else if item.running {
            "cli_active"
        } else if item.weekly.is_some_and(|u| u >= 95) {
            "low_7d_quota"
        } else if a.unknown {
            "outcome_unknown"
        } else if a.auth_blocked && !a.recovery_allowed {
            "auth_blocked"
        } else if item.capability != "http_connect"
            && !(item.capability == "auth_required" && a.recovery_allowed)
        {
            "capability_blocked"
        } else if !item.inferred || item.reset.is_none() {
            "not_expired"
        } else if a.last_woken_for_reset_sec == item.reset {
            "already_woken"
        } else if a.backoff_until_ms.is_some_and(|t| t > now) || state.next_global_at_ms > now {
            "backoff_cooldown"
        } else {
            "scheduled"
        }
        .into();
        if a.decision != "scheduled" {
            continue;
        }
        if a.woken_window_reset_sec == item.reset {
            a.unused_streak = if a.used_during_woken_window || item.used > 1 {
                0
            } else {
                (a.unused_streak + 1).min(10)
            };
            a.woken_window_reset_sec = None;
            a.used_during_woken_window = false;
        }
        if a.unused_streak >= 2 && !active.is_some_and(|r| r <= state.config.prewarm_threshold_pct)
        {
            a.decision = "standby_idle".into();
            continue;
        }
        if a.scheduled_for_reset_sec != item.reset || a.scheduled_at_ms.is_none() {
            a.scheduled_for_reset_sec = item.reset;
            a.scheduled_at_ms = Some(now + delay(a.unused_streak, jitter));
        }
        if a.scheduled_at_ms.is_some_and(|t| t <= now) {
            return Some(item.clone());
        }
    }
    None
}
struct Inner {
    snapshot: Snapshot,
    active: bool,
    stopped: bool,
    writable: bool,
}
pub struct WakeupOwner {
    inner: Arc<(Mutex<Inner>, Condvar)>,
    path: PathBuf,
}
impl WakeupOwner {
    pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
        if app.try_state::<Self>().is_some() {
            return Ok(());
        }
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| "wakeup.stateSaveFailed")?;
        let path = directory.join("wakeup_scheduler_v1.json");
        let loaded = super::private::directory(&directory).and_then(|_| read_disk(&path));
        let writable = loaded.is_ok();
        let mut snapshot = loaded.unwrap_or_default();
        if !writable {
            snapshot.status = "storage_error".into();
            snapshot.migrated = true;
        }
        let inner = Arc::new((
            Mutex::new(Inner {
                snapshot,
                active: false,
                stopped: false,
                writable,
            }),
            Condvar::new(),
        ));
        if !app.manage(Self {
            inner: inner.clone(),
            path,
        }) {
            return Ok(());
        }
        let app = app.clone();
        std::thread::Builder::new()
            .name("quota-wakeup-owner".into())
            .spawn(move || {
                let mut cache = None;
                let mut cache_at = 0;
                loop {
                    let (lock, cv) = &*inner;
                    let guard = lock.lock().unwrap();
                    if guard.stopped {
                        break;
                    }
                    let (guard, _) = cv.wait_timeout(guard, Duration::from_secs(15)).unwrap();
                    if guard.stopped {
                        break;
                    }
                    let enabled = (guard.snapshot.config.enabled
                        || guard.snapshot.accounts.values().any(|a| a.unknown))
                        && guard.writable
                        && !guard.active;
                    drop(guard);
                    if !enabled {
                        continue;
                    }
                    let now = now_ms();
                    if cache.is_none() || now.saturating_sub(cache_at) >= 60_000 {
                        cache = candidates(&app).ok();
                        cache_at = now;
                    }
                    if let Some((items, active)) = &cache {
                        let owner = app.state::<Self>();
                        let mut guard = lock.lock().unwrap();
                        if guard.active || guard.stopped || !guard.writable {
                            continue;
                        }
                        let before = serde_json::to_vec(&guard.snapshot).ok();
                        let chosen = plan(
                            &mut guard.snapshot,
                            items,
                            *active,
                            now,
                            local_minute(now),
                            random(),
                        );
                        if before != serde_json::to_vec(&guard.snapshot).ok()
                            && owner.save_locked(&mut guard).is_err()
                        {
                            drop(guard);
                            owner.emit(&app);
                            continue;
                        }
                        drop(guard);
                        owner.emit(&app);
                        if let Some(item) = chosen {
                            let _ = owner.attempt(
                                &app,
                                &item.account_id,
                                &item.identity,
                                true,
                                item.reset,
                            );
                            cache = None;
                        }
                    }
                }
            })
            .map_err(|_| "wakeup.stateSaveFailed")?;
        Ok(())
    }
    pub fn stop(&self) {
        let (lock, cv) = &*self.inner;
        if let Ok(mut inner) = lock.lock() {
            inner.stopped = true;
            cv.notify_all();
        }
    }
    fn save_locked(&self, inner: &mut Inner) -> Result<(), String> {
        if !inner.writable || persist(&self.path, &inner.snapshot).is_err() {
            inner.snapshot.config.enabled = false;
            inner.snapshot.status = "storage_error".into();
            inner.writable = false;
            return Err("wakeup.stateSaveFailed".into());
        }
        Ok(())
    }
    fn emit(&self, app: &tauri::AppHandle) {
        if let Ok(inner) = self.inner.0.lock() {
            let _ = app.emit("wakeup-scheduler-state", inner.snapshot.clone());
        }
    }
    fn prepare_dispatch(
        &self,
        candidate: &Candidate,
        items: &[Candidate],
        automatic: bool,
        expired: Option<u64>,
        now: u64,
        minute: u16,
        jitter: u64,
    ) -> Result<(), String> {
        let identity = candidate.identity.as_str();
        let mut guard = self.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
        if guard.stopped || guard.active || !guard.writable || !guard.snapshot.migrated {
            return Err("wakeup.notReady".into());
        }
        if automatic
            && (!guard.snapshot.config.enabled
                || !guard.snapshot.config.within(minute)
                || guard.snapshot.targets != target_set(items))
        {
            return Err("wakeup.notReady".into());
        }
        if candidate.running
            || candidate.weekly.is_some_and(|used| used >= 95)
            || (candidate.capability != "http_connect"
                && !(candidate.capability == "auth_required"
                    && guard
                        .snapshot
                        .accounts
                        .get(identity)
                        .is_some_and(|a| a.recovery_allowed)))
            || guard
                .snapshot
                .config
                .excluded_identities
                .contains(&identity.to_string())
        {
            return Err("wakeup.notReady".into());
        }
        let retry = guard.snapshot.next_global_at_ms;
        let a = guard.snapshot.accounts.entry(identity.into()).or_default();
        if a.unknown
            || (a.auth_blocked && !a.recovery_allowed)
            || a.backoff_until_ms.is_some_and(|t| t > now)
            || retry > now
            || candidate.reset != expired
            || !candidate.inferred
            || expired.is_none()
            || a.last_woken_for_reset_sec == expired
            || (automatic
                && (a.scheduled_for_reset_sec != expired
                    || a.scheduled_at_ms.is_none_or(|at| at > now)))
        {
            return Err("wakeup.notReady".into());
        }
        a.recovery_allowed = false;
        a.unknown = true;
        a.last_attempt_at_ms = Some(now);
        a.decision = "running".into();
        a.scheduled_for_reset_sec = expired;
        guard.snapshot.last_global_wakeup_at_ms = now;
        guard.snapshot.next_global_at_ms = now + 360_000 + jitter % 420_001;
        if let Err(error) = self.save_locked(&mut guard) {
            drop(guard);
            return Err(error);
        }
        guard.active = true;
        drop(guard);
        Ok(())
    }
    fn attempt(
        &self,
        app: &tauri::AppHandle,
        account_id: &str,
        identity: &str,
        automatic: bool,
        expired: Option<u64>,
    ) -> Result<OnlineQuotaResult, String> {
        // Recheck local summary immediately before dispatch, outside the identity door.
        let (items, _) = candidates(app)?;
        let candidate = items
            .iter()
            .find(|i| i.account_id == account_id && i.identity == identity)
            .ok_or("quotaOnline.accountMismatch")?;
        let admission = self.prepare_dispatch(
            candidate,
            &items,
            automatic,
            expired,
            now_ms(),
            local_minute(now_ms()),
            random(),
        );
        self.emit(app);
        admission?;
        let result = super::online::collect_wakeup_audited(
            app,
            account_id.to_owned(),
            identity.to_owned(),
            if automatic { "auto" } else { "manual" },
            expired,
        );
        let mut guard = self.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
        guard.active = false;
        finish(&mut guard.snapshot, identity, expired, now_ms(), &result);
        if let Err(error) = self.save_locked(&mut guard) {
            drop(guard);
            self.emit(app);
            return Err(error);
        }
        drop(guard);
        self.emit(app);
        result
    }
}
fn finish(
    state: &mut Snapshot,
    identity: &str,
    expired: Option<u64>,
    now: u64,
    result: &Result<OnlineQuotaResult, String>,
) {
    let a = state.accounts.entry(identity.into()).or_default();
    a.decision = "backoff_cooldown".into();
    match result {
        Ok(r) => {
            a.last_status = Some(
                serde_json::to_value(&r.status)
                    .ok()
                    .and_then(|s| s.as_str().map(str::to_string))
                    .unwrap_or_else(|| "error".into()),
            );
            a.unknown = r.wakeup_effect == Some(WakeupEffect::OutcomeUnknown);
            a.auth_blocked |= r.status == OnlineStatus::AuthRequired;
            a.backoff_until_ms = Some(r.retry_at_ms.unwrap_or(0).max(
                now + if r.status == OnlineStatus::RateLimited {
                    30 * 60_000
                } else {
                    15 * 60_000
                },
            ));
            state.next_global_at_ms = state.next_global_at_ms.max(r.retry_at_ms.unwrap_or(0));
            if r.status == OnlineStatus::Updated
                && r.wakeup_effect == Some(WakeupEffect::New5hConfirmed)
                && r.updated_windows
                    .as_ref()
                    .is_some_and(|w| w.iter().any(|s| s == "5h"))
                && r.wakeup_5h_reset_at.is_some_and(|reset| {
                    reset > now / 1000 && expired.is_some_and(|old| reset > old)
                })
            {
                a.last_woken_for_reset_sec = expired;
                a.last_woken_at_ms = Some(now);
                a.woken_window_reset_sec = r.wakeup_5h_reset_at;
                a.used_during_woken_window = false;
                a.unknown = false;
                a.auth_blocked = false;
                a.backoff_until_ms = None;
                a.scheduled_at_ms = None;
                a.decision = "already_woken".into();
            } else if a.auth_blocked {
                a.decision = "auth_blocked".into();
            } else if a.unknown {
                a.decision = "outcome_unknown".into();
            }
        }
        Err(_) => {
            a.unknown = true;
            a.last_status = Some("outcome_unknown".into());
            a.decision = "outcome_unknown".into();
        }
    }
}
#[cfg(windows)]
fn local_minute(now: u64) -> u16 {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    let mut zone: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
    let kind = unsafe { GetTimeZoneInformation(&mut zone) };
    if kind == u32::MAX {
        return 1440;
    }
    let bias = zone.Bias
        + if kind == 2 {
            zone.DaylightBias
        } else {
            zone.StandardBias
        };
    ((now as i64 / 60_000 - bias as i64).rem_euclid(1440)) as u16
}
#[cfg(not(windows))]
fn local_minute(_now: u64) -> u16 {
    // This product's native schedule is supported on Windows. Fail closed for
    // local time windows on other platforms rather than pretending UTC is local.
    1440
}

#[tauri::command]
pub fn identities_wakeup_state(app: tauri::AppHandle) -> Result<Snapshot, String> {
    Ok(app
        .state::<WakeupOwner>()
        .inner
        .0
        .lock()
        .map_err(|_| "wakeup.stateSaveFailed")?
        .snapshot
        .clone())
}
#[tauri::command]
pub async fn identities_wakeup_configure(
    app: tauri::AppHandle,
    config: Config,
) -> Result<Snapshot, String> {
    if !config.valid() {
        return Err("wakeup.configSaveFailed".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let items = if config.enabled {
            Some(candidates(&app)?.0)
        } else {
            None
        };
        // The probe imports Python/cryptography only and never selects an account.
        let runtime = if config.enabled {
            super::online::wakeup_runtime_capability(&app)
        } else {
            Ok(())
        };
        runtime.map_err(|_| "wakeup.runtimeUnavailable")?;
        let owner = app.state::<WakeupOwner>();
        let mut guard = owner
            .inner
            .0
            .lock()
            .map_err(|_| "wakeup.configSaveFailed")?;
        let before = guard.snapshot.clone();
        guard.snapshot.config = config;
        guard.snapshot.status = if guard.snapshot.config.enabled {
            "waiting"
        } else {
            "disabled"
        }
        .into();
        if let Some(items) = &items {
            guard.snapshot.targets = target_set(items);
        }
        guard.snapshot.migrated = true;
        if guard.snapshot.config.enabled {
            guard.snapshot.runtime = "available".into();
        }
        for item in items.into_iter().flatten() {
            let account = guard.snapshot.accounts.entry(item.identity).or_default();
            account.auth_blocked |= item.capability == "auth_required";
            account.capability = item.capability;
        }
        if let Err(e) = owner.save_locked(&mut guard) {
            guard.snapshot = before;
            guard.snapshot.status = "storage_error".into();
            drop(guard);
            owner.emit(&app);
            return Err(e);
        }
        let result = guard.snapshot.clone();
        drop(guard);
        owner.inner.1.notify_all();
        owner.emit(&app);
        Ok(result)
    })
    .await
    .map_err(|_| "wakeup.configSaveFailed".to_string())?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Migration {
    schema: u8,
    config: Config,
    state: LegacyState,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyState {
    last_global_wakeup_at_ms: u64,
    accounts: BTreeMap<String, LegacyAccount>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyAccount {
    last_attempt_at_ms: Option<u64>,
    backoff_until_ms: Option<u64>,
    last_status: Option<String>,
}
#[tauri::command]
pub async fn identities_wakeup_migrate(
    app: tauri::AppHandle,
    migration: Migration,
) -> Result<Snapshot, String> {
    if migration.schema != 1
        || !migration.config.valid()
        || migration.state.accounts.len() > MAX_ACCOUNTS
        || migration.state.last_global_wakeup_at_ms > MAX_TIME
    {
        return Err("wakeup.configSaveFailed".into());
    }
    if identities_wakeup_state(app.clone())?.migrated {
        return identities_wakeup_state(app);
    }
    // Ignore historical success/idle counters: old code could seal the wrong reset.
    {
        let owner = app.state::<WakeupOwner>();
        let mut guard = owner.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
        for (id, old) in migration.state.accounts {
            if !identity_valid(&id)
                || old
                    .last_status
                    .as_ref()
                    .is_some_and(|s| !matches!(s.as_str(), "auth_required" | "outcome_unknown"))
                || [old.last_attempt_at_ms, old.backoff_until_ms]
                    .iter()
                    .flatten()
                    .any(|t| *t > MAX_TIME)
            {
                return Err("wakeup.stateSaveFailed".into());
            }
            let a = guard.snapshot.accounts.entry(id).or_default();
            if old.last_status.as_deref() == Some("auth_required") {
                a.auth_blocked = true;
                a.last_status = Some("auth_required".into());
            }
            if old.last_status.as_deref() == Some("outcome_unknown") {
                a.unknown = true;
                a.last_status = Some("outcome_unknown".into());
            }
            a.last_attempt_at_ms = old.last_attempt_at_ms;
            a.backoff_until_ms = old.backoff_until_ms;
        }
        guard.snapshot.last_global_wakeup_at_ms = migration.state.last_global_wakeup_at_ms;
        guard.snapshot.next_global_at_ms = migration
            .state
            .last_global_wakeup_at_ms
            .saturating_add(SPACING_MS);
        owner.save_locked(&mut guard)?;
    }
    identities_wakeup_configure(app, migration.config).await
}
#[tauri::command]
pub fn identities_wakeup_resume(
    app: tauri::AppHandle,
    expected_identity: String,
) -> Result<Snapshot, String> {
    if !identity_valid(&expected_identity) {
        return Err("wakeup.notReady".into());
    }
    let owner = app.state::<WakeupOwner>();
    let mut guard = owner.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
    let a = guard
        .snapshot
        .accounts
        .get_mut(&expected_identity)
        .ok_or("wakeup.notReady")?;
    // Explicit recovery grants one attempt; it does not clear an uncertain POST.
    if a.unknown {
        return Err("wakeup.outcomeUnknown".into());
    }
    a.recovery_allowed = true;
    owner.save_locked(&mut guard)?;
    let result = guard.snapshot.clone();
    drop(guard);
    owner.inner.1.notify_all();
    owner.emit(&app);
    Ok(result)
}
pub fn request(
    app: &tauri::AppHandle,
    account_id: &str,
    identity: &str,
    automatic: bool,
    expired: Option<u64>,
) -> Result<OnlineQuotaResult, String> {
    app.state::<WakeupOwner>()
        .attempt(app, account_id, identity, automatic, expired)
}

#[cfg(test)]
#[path = "wakeup_tests.rs"]
mod tests;
