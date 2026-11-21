// [INPUT]: Explicit versioned settings, restricted local quota summaries and the shared audited collector.
// [OUTPUT]: Independent local readiness synchronization, one process-owned scheduler (condvar-parked with zero wakeups when disabled/busy/unwritable; single-pass route projection without browser scans during candidate enumeration), private durable plans and precise no-dispatch results.
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
    let trimmed = proxy.trim();
    if trimmed.is_empty() {
        return if std::env::var("CLAUDE_LOCAL_ALLOW_DIRECT")
            .ok()
            .as_deref()
            == Some("1")
        {
            "http_connect"
        } else {
            "route_required"
        };
    }
    if trimmed.len() > 2048 || trimmed.bytes().any(|b| b <= 32) {
        return "transport_unsupported";
    }
    let normalized = if inherited && !trimmed.contains("://") {
        format!("http://{trimmed}")
    } else {
        trimmed.to_string()
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

fn preflight_wakeup_http_proxy(proxy_raw: &str, inherited: bool) -> Result<(), String> {
    if cfg!(test)
        || std::env::var("CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT")
            .ok()
            .as_deref()
            == Some("1")
    {
        return Ok(());
    }
    let trimmed = proxy_raw.trim();
    if trimmed.is_empty() {
        return if std::env::var("CLAUDE_LOCAL_ALLOW_DIRECT")
            .ok()
            .as_deref()
            == Some("1")
        {
            Ok(())
        } else {
            Err("route_required".into())
        };
    }
    let normalized = if inherited && !trimmed.contains("://") {
        format!("http://{trimmed}")
    } else {
        trimmed.to_string()
    };
    let Ok(url) = reqwest::Url::parse(&normalized) else {
        return Err("transport_unsupported".into());
    };
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    let Some(port) = url.port_or_known_default() else {
        return Err("transport_unsupported".into());
    };
    let timeout = Duration::from_millis(300);
    let reachable = if host == "127.0.0.1" {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            timeout,
        )
        .is_ok()
    } else if host == "::1" {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
            timeout,
        )
        .is_ok()
    } else if host.eq_ignore_ascii_case("localhost") {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(200),
        )
        .is_ok()
            || std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
                Duration::from_millis(150),
            )
            .is_ok()
    } else {
        true
    };
    if reachable {
        Ok(())
    } else {
        Err("proxy_unreachable".into())
    }
}

/// Shared route inputs loaded once per candidate pass (relay config + `~/.claude` proxy).
struct ProxyContext {
    app_data_dir: Option<PathBuf>,
    relay_cfg: super::orchestrator::config::SmartRelayConfig,
    claude_dir_proxy: Option<String>,
}
impl ProxyContext {
    fn load(app: &tauri::AppHandle) -> Self {
        let app_data_dir = app.path().app_data_dir().ok();
        let home = crate::cleaner::identity::root().ok();
        let relay_cfg = app_data_dir
            .as_deref()
            .map(super::orchestrator::config::load_config)
            .unwrap_or_default();
        let claude_dir_proxy = home.as_deref().and_then(|h| {
            super::orchestrator::config::read_claude_dir_http_proxy(&h.join(".claude"))
        });
        Self {
            app_data_dir,
            relay_cfg,
            claude_dir_proxy,
        }
    }
}
/// Minimal session view needed for same-exit counting; built from `State` without cloning sessions.
struct RouteView<'a> {
    cli_running: bool,
    current_proxy: Option<&'a str>,
    busy_slots: Vec<(&'a str, Option<&'a str>)>,
}
impl<'a> RouteView<'a> {
    fn from_state(state: &'a super::State) -> Self {
        Self {
            cli_running: state.cli_running,
            current_proxy: state.current.proxy.as_deref(),
            busy_slots: state
                .slot_sessions
                .iter()
                .filter(|(_, sessions)| !sessions.is_empty())
                .map(|(id, _)| {
                    (
                        id.as_str(),
                        state.summaries.get(id).and_then(|s| s.proxy.as_deref()),
                    )
                })
                .collect(),
        }
    }
}
/// Pure route projection: slot proxy > summary proxy > `~/.claude` proxy. Never scans processes.
fn effective_route(
    ctx: &ProxyContext,
    active: &str,
    account_id: &str,
    summary_proxy: Option<&str>,
) -> (String, bool) {
    let slot_proxy_id = if account_id == "current" {
        (active != "current").then_some(active)
    } else {
        Some(account_id)
    };
    let slot_proxy = slot_proxy_id
        .and_then(|id| ctx.relay_cfg.slot_proxies.get(id))
        .map(String::as_str)
        .filter(|s| !s.trim().is_empty());
    if let Some(p) = slot_proxy {
        (p.trim().to_string(), false)
    } else if let Some(p) = summary_proxy.filter(|v| !v.trim().is_empty()) {
        (p.trim().to_string(), false)
    } else if let Some(ref p) = ctx.claude_dir_proxy {
        (p.trim().to_string(), false)
    } else {
        (String::new(), false)
    }
}
/// Same-exit concurrency cap; the managed-browser process scan runs at most once per call.
fn exit_capped(
    ctx: &ProxyContext,
    view: &RouteView<'_>,
    effective_proxy: &str,
    scan_browsers: &mut dyn FnMut(&Path) -> Vec<(String, PathBuf)>,
) -> bool {
    let target_exit = super::orchestrator::config::exit_key(
        (!effective_proxy.trim().is_empty()).then_some(effective_proxy),
    );
    let mut active_on_exit = 0usize;
    if view.cli_running {
        let main_proxy = view.current_proxy.or(ctx.claude_dir_proxy.as_deref());
        if super::orchestrator::config::exit_key(main_proxy) == target_exit {
            active_on_exit += 1;
        }
    }
    for (rec_id, summary_proxy) in &view.busy_slots {
        let sp = ctx
            .relay_cfg
            .slot_proxies
            .get(*rec_id)
            .map(String::as_str)
            .or(*summary_proxy)
            .or(ctx.claude_dir_proxy.as_deref());
        if super::orchestrator::config::exit_key(sp) == target_exit {
            active_on_exit += 1;
        }
    }
    if let Some(ref app_dir) = ctx.app_data_dir {
        let browser_root = app_dir.join("browser");
        if browser_root.is_dir() {
            for (_slot, profile_dir) in scan_browsers(&browser_root) {
                let b_proxy = profile_dir
                    .parent()
                    .and_then(|scope| crate::browser::config::load(scope).ok())
                    .map(|cfg| cfg.proxy)
                    .filter(|p| !p.trim().is_empty());
                if super::orchestrator::config::exit_key(b_proxy.as_deref()) == target_exit {
                    active_on_exit += 1;
                }
            }
        }
    }
    active_on_exit >= ctx.relay_cfg.max_same_exit_concurrency as usize
}

fn resolve_candidate_proxy_and_exit_cap(
    app: &tauri::AppHandle,
    state: &super::State,
    account_id: &str,
    summary_proxy: Option<&str>,
    check_exit_cap: bool,
) -> (String, bool, bool) {
    let ctx = ProxyContext::load(app);
    let (effective_proxy, inherited) =
        effective_route(&ctx, &state.active, account_id, summary_proxy);
    let capped = check_exit_cap
        && exit_capped(
            &ctx,
            &RouteView::from_state(state),
            &effective_proxy,
            &mut crate::browser::kill_switch::running_managed_profiles,
        );
    (effective_proxy, inherited, capped)
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
                        "" | "http_connect"
                            | "auth_required"
                            | "transport_unsupported"
                            | "route_required"
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
    // Route inputs load once per pass; readiness never scans browsers (exit cap is a dispatch-time check).
    let route_ctx = ProxyContext::load(app);
    let app_data_dir = route_ctx.app_data_dir.clone();
    let mut add = |account_id: String, summary: super::profile::Summary, running| {
        if let Some(id) = summary.quota_identity.clone().filter(|id| identity_valid(id)) {
            if result.iter().any(|c: &Candidate| c.identity == id) {
                return;
            }
            let (effective_proxy, inherited) = effective_route(
                &route_ctx,
                &state.active,
                &account_id,
                summary.proxy.as_deref(),
            );
            let capability = if matches!(
                summary.auth_status.as_deref(),
                Some("expired" | "refresh_needed")
            ) {
                "auth_required"
            } else {
                route_capability(&effective_proxy, inherited)
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
        let active_slot_running = state.active != "current"
            && state
                .slot_sessions
                .get(&state.active)
                .is_some_and(|s| !s.is_empty());
        add(
            "current".into(),
            super::profile::Summary::from_current(&state.current),
            state.running || active_slot_running,
        );
    }
    for record in &state.records {
        if record.id != state.active {
            if let Some(summary) = state.summaries.get(&record.id) {
                let slot_busy = state
                    .slot_sessions
                    .get(&record.id)
                    .is_some_and(|s| !s.is_empty())
                    || app_data_dir.as_deref().is_some_and(|dir| {
                        super::orchestrator::slots::slot_lease_fresh_by_mtime(
                            &dir.join("cli-slots").join(&record.id),
                        )
                    });
                add(record.id.clone(), summary.clone(), slot_busy);
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
    // Readiness is local metadata, independent of automatic-dispatch consent.
    // In particular, disabled owners must still expose newly saved identities.
    let automatic =
        state.config.enabled && state.targets == target_set(items) && state.config.within(minute);
    state.status = if !state.config.enabled {
        "disabled"
    } else if state.targets != target_set(items) {
        "scope_changed"
    } else if !state.config.within(minute) {
        "outside_window"
    } else {
        "waiting"
    }
    .into();
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
            } else if a.auth_blocked && !a.recovery_allowed {
                "auth_blocked"
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
        if a.decision != "scheduled" || !automatic {
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
/// The same admission gates serve manual and scheduled work. A blocked click
/// returns a bounded explanation without consuming a recovery grant or writing
/// an unknown-POST journal.
fn dispatch_blocker(
    state: &Snapshot,
    candidate: &Candidate,
    items: &[Candidate],
    automatic: bool,
    expired: Option<u64>,
    now: u64,
    minute: u16,
) -> Option<OnlineQuotaResult> {
    let a = state.accounts.get(&candidate.identity).cloned().unwrap_or_default();
    let retry = state.next_global_at_ms.max(a.backoff_until_ms.unwrap_or(0));
    let retry = (retry > now).then_some(retry);
    let reason = if automatic && (!state.config.enabled
        || !state.config.within(minute) || state.targets != target_set(items)) {
        "scheduler_unavailable"
    } else if candidate.running {
        "cli_active"
    } else if candidate.weekly.is_some_and(|used| used >= 95) {
        "low_7d_quota"
    } else if state.config.excluded_identities.contains(&candidate.identity) {
        "disabled_by_user"
    } else if a.unknown {
        "outcome_unknown"
    } else if (a.auth_blocked || candidate.capability == "auth_required") && !a.recovery_allowed {
        "auth_required"
    } else if candidate.capability == "route_required" {
        "route_required"
    } else if candidate.capability != "http_connect"
        && !(candidate.capability == "auth_required" && a.recovery_allowed) {
        "capability_blocked"
    } else if retry.is_some() {
        "backoff_cooldown"
    } else if candidate.reset != expired || !candidate.inferred || expired.is_none() {
        "not_expired"
    } else if a.last_woken_for_reset_sec == expired {
        "already_woken"
    } else if automatic && (a.scheduled_for_reset_sec != expired
        || a.scheduled_at_ms.is_none_or(|at| at > now)) {
        "scheduler_unavailable"
    } else {
        return None;
    };
    Some(OnlineQuotaResult::scheduler_blocked(
        match reason {
            "auth_required" => OnlineStatus::AuthRequired,
            "backoff_cooldown" => OnlineStatus::Cooldown,
            "route_required" => OnlineStatus::RouteUnavailable,
            _ => OnlineStatus::Unavailable,
        },
        reason,
        retry,
    ))
}

struct Inner {
    snapshot: Snapshot,
    active: bool,
    stopped: bool,
    writable: bool,
}
/// The automatic scheduler only ticks while enabled, writable and not mid-dispatch.
fn worker_runnable(inner: &Inner) -> bool {
    inner.snapshot.config.enabled && inner.writable && !inner.active
}
/// Blocks on the condvar (no timeout) until the owner is runnable or stopped.
/// `configure` / `resume` / `attempt` completion / `stop` all `notify_all`.
/// Returns the guard plus how many condvar wakeups were consumed while parked.
fn park_until_runnable<'a>(
    cv: &Condvar,
    mut guard: std::sync::MutexGuard<'a, Inner>,
) -> (std::sync::MutexGuard<'a, Inner>, usize) {
    let mut wakeups = 0usize;
    while !guard.stopped && !worker_runnable(&guard) {
        guard = cv.wait(guard).unwrap_or_else(|poisoned| poisoned.into_inner());
        wakeups += 1;
    }
    (guard, wakeups)
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
                    // Disabled / unwritable / busy owner parks with zero periodic wakeups.
                    let (guard, parked) = park_until_runnable(cv, guard);
                    if parked > 0 {
                        cache = None;
                    }
                    if guard.stopped {
                        break;
                    }
                    let (guard, _) = cv.wait_timeout(guard, Duration::from_secs(15)).unwrap();
                    if guard.stopped {
                        break;
                    }
                    let enabled = worker_runnable(&guard);
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
                        let changed = before != serde_json::to_vec(&guard.snapshot).ok();
                        if changed && owner.save_locked(&mut guard).is_err()
                        {
                            drop(guard);
                            owner.emit(&app);
                            continue;
                        }
                        drop(guard);
                        if changed {
                            owner.emit(&app);
                        }
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
    /// True while a wakeup dispatch is in flight (tray deep-sleep gate).
    pub(crate) fn is_busy(&self) -> bool {
        self.inner.0.lock().map(|inner| inner.active).unwrap_or(true)
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
    fn refresh_local(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let (items, active) = candidates(app)?;
        let mut guard = self.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
        if !guard.writable || guard.active || guard.stopped {
            return Ok(());
        }
        let before = serde_json::to_vec(&guard.snapshot).ok();
        let now = now_ms();
        let _ = plan(
            &mut guard.snapshot,
            &items,
            active,
            now,
            local_minute(now),
            random(),
        );
        if before != serde_json::to_vec(&guard.snapshot).ok() {
            self.save_locked(&mut guard)?;
        }
        Ok(())
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
    ) -> Result<bool, OnlineQuotaResult> {
        let identity = candidate.identity.as_str();
        let mut guard = self.inner.0.lock().map_err(|_| {
            OnlineQuotaResult::scheduler_blocked(
                OnlineStatus::Unavailable,
                "scheduler_unavailable",
                None,
            )
        })?;
        if guard.stopped || guard.active || !guard.writable || !guard.snapshot.migrated {
            return Err(OnlineQuotaResult::scheduler_blocked(
                OnlineStatus::Unavailable,
                if guard.active { "scheduler_busy" } else { "scheduler_unavailable" }, None));
        }
        if let Some(blocked) = dispatch_blocker(&guard.snapshot, candidate, items, automatic, expired, now, minute) {
            return Err(blocked);
        }
        let a = guard.snapshot.accounts.entry(identity.into()).or_default();
        let recovery_used = a.recovery_allowed;
        a.recovery_allowed = false;
        a.unknown = true;
        a.last_attempt_at_ms = Some(now);
        a.decision = "running".into();
        a.scheduled_for_reset_sec = expired;
        guard.snapshot.last_global_wakeup_at_ms = now;
        guard.snapshot.next_global_at_ms = now + 360_000 + jitter % 420_001;
        if self.save_locked(&mut guard).is_err() {
            drop(guard);
            return Err(OnlineQuotaResult::scheduler_blocked(
                OnlineStatus::Unavailable, "scheduler_unavailable", None));
        }
        guard.active = true;
        drop(guard);
        Ok(recovery_used)
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
        let state_snap = super::state_for(app, false)?;
        let summary_proxy = if account_id == "current" {
            state_snap.current.proxy.clone()
        } else {
            state_snap
                .summaries
                .get(account_id)
                .and_then(|s| s.proxy.clone())
        };
        let (effective_proxy, inherited, exit_capped) = resolve_candidate_proxy_and_exit_cap(
            app,
            &state_snap,
            account_id,
            summary_proxy.as_deref(),
            true,
        );
        if automatic && exit_capped {
            let defer_until = now_ms() + 120_000;
            if let Ok(mut guard) = self.inner.0.lock() {
                guard.snapshot.next_global_at_ms =
                    guard.snapshot.next_global_at_ms.max(defer_until);
                let _ = self.save_locked(&mut guard);
            }
            self.emit(app);
            return Ok(OnlineQuotaResult::scheduler_blocked(
                OnlineStatus::Cooldown,
                "backoff_cooldown",
                Some(defer_until),
            ));
        }
        let (items, _) = candidates(app)?;
        let candidate = items
            .iter()
            .find(|i| i.account_id == account_id && i.identity == identity)
            .ok_or("quotaOnline.accountMismatch")?;
        if let Err(route_err) = preflight_wakeup_http_proxy(&effective_proxy, inherited) {
            let reason = if route_err == "route_required" {
                "route_required"
            } else {
                "capability_blocked"
            };
            return Ok(OnlineQuotaResult::scheduler_blocked(
                OnlineStatus::RouteUnavailable,
                reason,
                None,
            ));
        }
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
        let recovery_used = match admission {
            Ok(recovery_used) => recovery_used,
            Err(blocked) => return Ok(blocked),
        };
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
        // A missing helper/runtime or unsupported local proxy never started
        // authorization verification. Keep its explicit permit, retaining all
        // attempt spacing/backoff. Profile 401/429 consumes the permit normally.
        if recovery_used && result.as_ref().is_ok_and(local_preparation_failed) {
            guard
                .snapshot
                .accounts
                .entry(identity.into())
                .or_default()
                .recovery_allowed = true;
        }
        if let Err(error) = self.save_locked(&mut guard) {
            drop(guard);
            self.inner.1.notify_all();
            self.emit(app);
            return Err(error);
        }
        drop(guard);
        // Wake a parked owner now that `active` cleared.
        self.inner.1.notify_all();
        self.emit(app);
        result
    }
}
fn local_preparation_failed(result: &OnlineQuotaResult) -> bool {
    result.wakeup_effect.is_none()
        && (result.runtime_stage.as_deref() == Some("probe")
            || (result.runtime_stage.as_deref() == Some("execute")
                && result.runtime_reason.as_deref() == Some("probe_failed"))
            || (result.status == OnlineStatus::RouteUnavailable
                && result.stage.as_deref() == Some("route")))
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
            a.unknown = r.wakeup_effect == Some(WakeupEffect::OutcomeUnknown)
                || (r.runtime_stage.as_deref() == Some("execute") && !local_preparation_failed(r));
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
            } else if r.status == OnlineStatus::RouteUnavailable {
                a.capability = "route_required".into();
                a.decision = "capability_blocked".into();
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
pub async fn identities_wakeup_state(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<WakeupOwner>().refresh_local(&app)?;
        let result = app
            .state::<WakeupOwner>()
            .inner
            .0
            .lock()
            .map_err(|_| "wakeup.stateSaveFailed")?
            .snapshot
            .clone();
        Ok(result)
    })
    .await
    .map_err(|_| "wakeup.stateSaveFailed".to_string())?
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
        let (items, active) = candidates(&app)?;
        let already_verified_runtime = app
            .state::<WakeupOwner>()
            .inner
            .0
            .lock()
            .ok()
            .is_some_and(|guard| {
                guard.snapshot.config.enabled && guard.snapshot.runtime == "available"
            });
        // The probe imports Python/cryptography only and never selects an account.
        let runtime = if config.enabled && !already_verified_runtime {
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
        if guard.snapshot.config.enabled {
            guard.snapshot.targets = target_set(&items);
        }
        guard.snapshot.migrated = true;
        if guard.snapshot.config.enabled {
            guard.snapshot.runtime = "available".into();
        }
        let now = now_ms();
        let _ = plan(
            &mut guard.snapshot,
            &items,
            active,
            now,
            local_minute(now),
            random(),
        );
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
    let existing = identities_wakeup_state(app.clone()).await?;
    if existing.migrated {
        return Ok(existing);
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
pub async fn identities_wakeup_resume(
    app: tauri::AppHandle,
    expected_identity: String,
) -> Result<Snapshot, String> {
    if !identity_valid(&expected_identity) {
        return Err("wakeup.notReady".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let owner = app.state::<WakeupOwner>();
        // Re-read bound local targets rather than relying on an enabled owner having
        // happened to create the account. Never grant recovery to a stale identity.
        let (items, active) = candidates(&app)?;
        if !items.iter().any(|item| item.identity == expected_identity) {
            return Err("wakeup.notReady".into());
        }
        let mut guard = owner.inner.0.lock().map_err(|_| "wakeup.stateSaveFailed")?;
        if guard.active || guard.stopped || !guard.writable {
            return Err("wakeup.notReady".into());
        }
        let now = now_ms();
        let _ = plan(
            &mut guard.snapshot,
            &items,
            active,
            now,
            local_minute(now),
            random(),
        );
        let a = guard
            .snapshot
            .accounts
            .get_mut(&expected_identity)
            .ok_or("wakeup.notReady")?;
        grant_recovery(a)?;
        let _ = plan(
            &mut guard.snapshot,
            &items,
            active,
            now,
            local_minute(now),
            random(),
        );
        owner.save_locked(&mut guard)?;
        let result = guard.snapshot.clone();
        drop(guard);
        owner.inner.1.notify_all();
        owner.emit(&app);
        Ok(result)
    })
    .await
    .map_err(|_| "wakeup.stateSaveFailed".to_string())?
}

fn grant_recovery(account: &mut Account) -> Result<(), String> {
    // Explicit recovery permits one attempt. Only a proven authorization-only
    // account delay may be released; shared spacing and unknown/429 gates hold.
    if account.unknown {
        return Err("wakeup.outcomeUnknown".into());
    }
    if account.auth_blocked && account.last_status.as_deref() == Some("auth_required") {
        account.backoff_until_ms = None;
    }
    account.recovery_allowed = true;
    Ok(())
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
