// [INPUT]: 受管伴侣浏览器全部运行中资料目录（legacy/profile 与 contexts/*/profile）、各槽位独立 config.json 有效代理/预期国家、本机 TUN/DNS 快照及用户解警/开关动作。
// [OUTPUT]: per-slot 独立追踪与探活的伴侣浏览器强熔断守护（消除跨槽位 120s 降级、消除第 0 秒/初始 !tun_active 盲窗并遍历所有待复核 TUN 槽位、首次基线 IP 与运行中 IP 跳变统一执行 `is_hosting_exit` + 国家复核且未核验通过前不置 `baseline_ip_verified`）；触发时按 `SlotGate(字典序) < Browser::gate` 关闭全部受管资料并在 `WM_CLOSE` 超时后升级至 5 重校验 `terminate_browser_profile_tree` 强杀兜底、禁止未确认全退出前调用 `tracker.reset()` 且维持 `triggered=true` 与 `failed_slots` 并在 `failed_slots` 非空时严格保持 3s 重杀；告警态重开经 `ensure_launch_route_healthy_when_triggered` 无条件核验 TUN 与真实出口健康（对齐 `evaluate_dismiss_probe` 含 `is_hosting_exit` 与 `expected_country`），健康探针绑定 `clear_alert()` 与 `browser_kill_switch_dismiss`（核验未通过返回 `triggered=true` 兼容前端契约）及全启动入口 `notify_browser_activity()`。
// [POS]: 伴侣浏览器运行期强熔断守护；无受管浏览器运行时 60s 空闲退避并由活动信号即时唤醒，绝不触碰 claude.exe 或系统其他 Chrome。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct KillSwitchState {
    pub enabled: bool,
    pub triggered: bool,
    pub reason_code: Option<String>, // "tun_dropped" | "country_drift" | "exit_datacenter"
    pub expected_country: Option<String>,
    pub observed_country: Option<String>,
    pub triggered_at: Option<u64>,
    pub closed_slots: Vec<String>,
    #[serde(default)]
    pub failed_slots: Vec<String>,
}

impl Default for KillSwitchState {
    fn default() -> Self {
        Self {
            enabled: true,
            triggered: false,
            reason_code: None,
            expected_country: None,
            observed_country: None,
            triggered_at: None,
            closed_slots: Vec::new(),
            failed_slots: Vec::new(),
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
pub fn apply_trigger(
    state: &mut KillSwitchState,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
    closed_slots: Vec<String>,
    timestamp: u64,
) {
    apply_trigger_with_failures(
        state,
        reason_code,
        expected_country,
        observed_country,
        closed_slots,
        Vec::new(),
        timestamp,
    );
}

pub fn apply_trigger_with_failures(
    state: &mut KillSwitchState,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
    closed_slots: Vec<String>,
    failed_slots: Vec<String>,
    timestamp: u64,
) {
    state.triggered = true;
    state.reason_code = Some(reason_code.to_string());
    state.expected_country = expected_country;
    state.observed_country = observed_country;
    state.triggered_at = Some(timestamp.max(1));
    state.closed_slots = closed_slots;
    state.failed_slots = failed_slots;
}

pub fn apply_clear_alert(state: &mut KillSwitchState) -> bool {
    if !state.triggered {
        return false;
    }
    state.triggered = false;
    state.reason_code = None;
    state.expected_country = None;
    state.observed_country = None;
    state.triggered_at = None;
    state.closed_slots.clear();
    state.failed_slots.clear();
    true
}

pub fn tint_rgba_alert_red(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        if px[3] > 32 {
            px[0] = 220;
            px[1] = 38;
            px[2] = 38;
        }
    }
}

pub(crate) fn update_tray_alert(app: &tauri::AppHandle, alert: bool) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    if alert {
        if let Some(icon) = app.default_window_icon() {
            let mut rgba = icon.rgba().to_vec();
            tint_rgba_alert_red(&mut rgba);
            let _ = tray.set_icon(Some(tauri::image::Image::new_owned(
                rgba,
                icon.width(),
                icon.height(),
            )));
        }
        let _ = tray.set_tooltip(Some("Claude-Local - 伴侣浏览器断线保护已触发"));
    } else {
        let _ = tray.set_icon(app.default_window_icon().cloned());
        let _ = tray.set_tooltip(Some("Claude-Local"));
    }
}

pub(crate) fn is_triggered(app: &tauri::AppHandle) -> bool {
    app.try_state::<super::Browser>()
        .map(|s| s.kill_switch.lock().unwrap().triggered)
        .unwrap_or(false)
}

pub(crate) fn clear_alert(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<super::Browser>() else {
        return;
    };
    let snapshot = {
        let mut ks = state.kill_switch.lock().unwrap();
        if !apply_clear_alert(&mut ks) {
            return;
        }
        ks.clone()
    };
    update_tray_alert(app, false);
    let _ = app.emit("kill-switch-state", &snapshot);
}

pub(crate) fn on_managed_browser_spawned(app: &tauri::AppHandle, route_healthy: bool) {
    notify_browser_activity();
    if route_healthy {
        clear_alert(app);
    }
}

pub(crate) fn slot_expected_country(
    root: Option<&Path>,
    slot: Option<&str>,
    config: &super::config::Config,
    machine: &super::config::Machine,
) -> Option<String> {
    let registered = root
        .zip(slot)
        .and_then(|(r, s)| resolve_slot_registered_country(r, s));
    let fallback = if config.follow_machine {
        config
            .region(machine)
            .map(|r| r.country.to_string())
            .or_else(|| crate::regions::timezone_country(&machine.timezone).map(str::to_string))
            .filter(|cc| !crate::regions::is_unsupported_exit_country(cc))
    } else {
        config
            .region(machine)
            .map(|r| r.country.to_string())
            .or_else(|| crate::regions::timezone_country(&config.timezone).map(str::to_string))
            .filter(|cc| !crate::regions::is_unsupported_exit_country(cc))
    };
    registered.or(fallback)
}

pub(crate) fn evaluate_triggered_launch_route(
    has_residual_failed_profiles: bool,
    config: &super::config::Config,
    tun_active: bool,
    exit_probe: Option<&super::network::Exit>,
    expected_country: Option<&str>,
) -> Result<(), String> {
    if has_residual_failed_profiles {
        return Err("断线保护处于告警状态，仍有受管浏览器进程未关闭，已阻止启动。".into());
    }
    let tun_mode = config.proxy.trim().is_empty();
    if tun_mode && !tun_active {
        return Err("断线保护处于告警状态，当前未检测到活跃 TUN 通道，已阻止启动。".into());
    }
    if !evaluate_dismiss_probe(false, tun_mode && !tun_active, exit_probe, expected_country) {
        if let Some(exit) = exit_probe {
            if super::network::is_hosting_exit(exit) {
                return Err(
                    "断线保护处于告警状态，当前出口仍为机房/数据中心网络，已阻止启动。".into(),
                );
            }
            let obs = exit.country.trim();
            if crate::regions::is_unsupported_exit_country(obs) {
                return Err("browser.error.unsupportedExitCountry".into());
            }
            if let Some(exp) = expected_country.map(str::trim).filter(|s| !s.is_empty()) {
                if !obs.eq_ignore_ascii_case(exp) {
                    return Err(
                        "断线保护处于告警状态，当前出口国家与预期地区不一致，已阻止启动。".into(),
                    );
                }
            }
        }
        return Err("断线保护处于告警状态，出口健康复核未通过，已阻止启动。".into());
    }
    Ok(())
}

pub(crate) fn ensure_launch_route_healthy_when_triggered(
    app: &tauri::AppHandle,
    slot: Option<&str>,
    config: &super::config::Config,
    machine: &super::config::Machine,
) -> Result<(), String> {
    if !is_triggered(app) {
        return Ok(());
    }
    super::config::invalidate_exit_country_cache(None);
    let root = super::root(app).ok();
    let had_failed = app
        .try_state::<super::Browser>()
        .is_some_and(|s| !s.kill_switch.lock().unwrap().failed_slots.is_empty());
    let has_residual_failed =
        had_failed && root.as_deref().is_some_and(|r| !running_managed_profiles(r).is_empty());
    if has_residual_failed {
        return Err("断线保护处于告警状态，仍有受管浏览器进程未关闭，已阻止启动。".into());
    }
    let tun_mode = config.proxy.trim().is_empty();
    let tun_active = if tun_mode {
        crate::risk_check::system_tun_and_dns_status().0
    } else {
        super::config::preflight_loopback_proxy(&config.proxy)?;
        true
    };
    if tun_mode && !tun_active {
        return Err("断线保护处于告警状态，当前未检测到活跃 TUN 通道，已阻止启动。".into());
    }
    let expected_country = slot_expected_country(root.as_deref(), slot, config, machine);
    let probe_proxy = config.proxy.trim().to_string();
    let exit_probe = super::config::block_on_exit_probe(async move {
        super::network::probe(&probe_proxy).await
    })
    .and_then(Result::ok);
    evaluate_triggered_launch_route(
        has_residual_failed,
        config,
        tun_active,
        exit_probe.as_ref(),
        expected_country.as_deref(),
    )?;
    super::config::preflight_browser_launch_policy(config, machine, true)
}

pub(crate) fn running_managed_profiles(root: &Path) -> Vec<(String, PathBuf)> {
    let mut candidates = Vec::new();
    let legacy = root.join("profile");
    if super::profile::check_path(root, &legacy).is_ok() && legacy.is_dir() {
        candidates.push(("legacy".to_string(), legacy));
    }
    let contexts = root.join("contexts");
    if let Ok(entries) = fs::read_dir(&contexts) {
        for item in entries.flatten() {
            let Some(slot) = item.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !crate::identities::browser_link::valid_slot(&slot) || slot == "legacy" {
                continue;
            }
            let profile_dir = item.path().join("profile");
            if super::profile::check_path(root, &profile_dir).is_ok() && profile_dir.is_dir() {
                candidates.push((slot, profile_dir));
            }
        }
    }
    let mut running = filter_running_profiles(candidates);
    running.sort_by(|a, b| a.0.cmp(&b.0));
    running
}

/// Windows: one batched Toolhelp snapshot for every candidate profile (cached Chrome probes).
#[cfg(windows)]
fn filter_running_profiles(candidates: Vec<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    if candidates.is_empty() {
        return candidates;
    }
    let paths: Vec<PathBuf> = candidates.iter().map(|(_, p)| p.clone()).collect();
    let Ok(flags) = crate::windows::running_chrome_profiles(&paths) else {
        return Vec::new();
    };
    candidates
        .into_iter()
        .zip(flags)
        .filter_map(|(item, running)| running.then_some(item))
        .collect()
}

#[cfg(not(windows))]
fn filter_running_profiles(candidates: Vec<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    candidates
        .into_iter()
        .filter(|(_, p)| super::profile::running(p).unwrap_or(false))
        .collect()
}

// ----- 受管浏览器启动唤醒：空闲 60s 退避期间也能立即进入 15s 守护节奏 -----
static BROWSER_ACTIVITY: std::sync::OnceLock<std::sync::Arc<tokio::sync::Notify>> =
    std::sync::OnceLock::new();

fn browser_activity() -> std::sync::Arc<tokio::sync::Notify> {
    BROWSER_ACTIVITY
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Notify::new()))
        .clone()
}

/// Call after launching any managed/companion browser so the idle monitor wakes immediately.
pub(crate) fn notify_browser_activity() {
    browser_activity().notify_one();
}

const ACTIVE_POLL: Duration = Duration::from_secs(15);
const IDLE_POLL: Duration = Duration::from_secs(60);

/// 15s while any managed browser runs; 60s backoff when none run.
pub fn monitor_poll_interval(running_managed: usize) -> Duration {
    if running_managed == 0 {
        IDLE_POLL
    } else {
        ACTIVE_POLL
    }
}

/// Sleep for `interval`, returning early when a browser launch is signalled.
async fn wait_for_next_tick(interval: Duration) {
    let notify = browser_activity();
    let _ = tokio::time::timeout(interval, notify.notified()).await;
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct QuitManagedOutcome {
    pub closed_slots: Vec<String>,
    pub failed_slots: Vec<String>,
}

fn force_quit_with_hooks(
    graceful: impl FnOnce() -> Result<(), String>,
    is_running: impl Fn() -> Result<bool, String>,
    force_kill: impl FnOnce() -> Result<bool, String>,
) -> Result<(), String> {
    let graceful_res = graceful();
    if graceful_res.is_ok() && matches!(is_running(), Ok(false)) {
        return Ok(());
    }
    let _ = force_kill()?;
    match is_running() {
        Ok(false) => Ok(()),
        Ok(true) => Err("受管浏览器资料在强制终止后仍在运行。".into()),
        Err(e) => Err(e),
    }
}

#[cfg(unix)]
fn unix_terminate_profile(profile_dir: &Path) -> Result<bool, String> {
    let lock_path = profile_dir.join("SingletonLock");
    let mut killed = false;
    if let Ok(target) = fs::read_link(&lock_path) {
        if let Some(pid_str) = target
            .to_string_lossy()
            .rsplit('-')
            .next()
            .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid > 1 && pid != std::process::id() {
                    let _ = std::process::Command::new("kill")
                        .args(["-KILL", &pid.to_string()])
                        .status();
                    killed = true;
                }
            }
        }
    }
    for _ in 0..30 {
        if !super::profile::running_uncached(profile_dir)? {
            return Ok(killed);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if super::profile::running_uncached(profile_dir)? {
        return Err("无法强制终止 Unix 浏览器进程。".into());
    }
    Ok(killed)
}

fn force_quit_managed_profile(app: &tauri::AppHandle, profile_dir: &Path) -> Result<(), String> {
    let expected_exe = {
        #[cfg(windows)]
        {
            super::engine(app).ok().map(|e| super::binary(&e))
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            None::<PathBuf>
        }
    };
    force_quit_with_hooks(
        || super::profile::quit(profile_dir),
        || super::profile::running_uncached(profile_dir),
        || {
            #[cfg(windows)]
            {
                crate::windows::terminate_browser_profile_tree(
                    profile_dir,
                    expected_exe.as_deref(),
                )
            }
            #[cfg(not(windows))]
            {
                let _ = expected_exe;
                unix_terminate_profile(profile_dir)
            }
        },
    )
}

pub(crate) fn quit_all_managed_profiles(app: &tauri::AppHandle) -> QuitManagedOutcome {
    let state = app.state::<super::Browser>();
    let Ok(root) = super::root(app) else {
        return QuitManagedOutcome::default();
    };
    let perform_quit = || -> Result<QuitManagedOutcome, String> {
        let profiles = running_managed_profiles(&root);
        let mut outcome = QuitManagedOutcome {
            closed_slots: Vec::with_capacity(profiles.len()),
            failed_slots: Vec::new(),
        };
        for (slot, profile_dir) in profiles {
            if force_quit_managed_profile(app, &profile_dir).is_ok() {
                let scope = profile_dir.parent().unwrap_or(&root);
                state.last_observations.lock().unwrap().remove(&slot);
                state.clear_launched_config(scope, &slot);
                outcome.closed_slots.push(slot);
            } else {
                outcome.failed_slots.push(slot);
            }
        }
        if outcome.failed_slots.is_empty() {
            *state.host.lock().unwrap() = None;
            super::renew_session(app);
        }
        Ok(outcome)
    };

    match state.with_slots_then_gate(
        || {
            Ok(running_managed_profiles(&root)
                .into_iter()
                .map(|(s, _)| s)
                .collect())
        },
        perform_quit,
    ) {
        Ok(outcome) => outcome,
        Err(_) => {
            // Fallback preserving SlotGate(lex) < Browser::gate even during rapid slot switches.
            let mut slots: Vec<String> = running_managed_profiles(&root)
                .into_iter()
                .map(|(s, _)| s)
                .collect();
            slots.sort();
            slots.dedup();
            let gates: Vec<_> = slots.iter().map(|s| state.slot_gate(s)).collect();
            let _slot_guards: Vec<_> = gates.iter().map(|g| g.lock()).collect();
            let _guard = state.gate.lock().unwrap();
            perform_quit().unwrap_or_default()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunningSlotRoute {
    pub slot: String,
    pub effective_proxy: String,
    pub expected_country: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SlotMonitorState {
    pub tick_count: u64,
    pub last_route: Option<(bool, bool, String)>,
    pub tun_baseline_active: bool,
    pub tun_drop_streak: u32,
    pub drift_streak: u32,
    pub baseline_ip: Option<String>,
    pub baseline_ip_verified: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SlotsTickPlan {
    pub trigger_tun_dropped: Option<Option<String>>,
    pub recheck_tun_slots: Vec<String>,
    pub startup_tun_verify_slots: Vec<String>,
    pub probe_exit_slots: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IpObservation {
    Unchanged,
    InitialBaseline(String),
    Changed(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MonitorTracker {
    pub slot_states: std::collections::BTreeMap<String, SlotMonitorState>,
    pub tun_baseline_active: bool,
    pub tun_drop_streak: u32,
    pub country_drift_streak: u32,
    pub slot_drift_streaks: std::collections::BTreeMap<String, u32>,
    pub slot_baseline_ips: std::collections::BTreeMap<String, String>,
    pub tick_count: u64,
    pub last_local_net: Option<(bool, bool, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExitProbeAction {
    Healthy,
    IgnoredTransientError,
    RecheckExitAfterDelay { observed_country: String },
    TriggerCountryDrift {
        expected_country: String,
        observed_country: String,
    },
}

impl MonitorTracker {
    pub fn reset(&mut self) {
        self.slot_states.clear();
        self.tun_baseline_active = false;
        self.tun_drop_streak = 0;
        self.country_drift_streak = 0;
        self.slot_drift_streaks.clear();
        self.slot_baseline_ips.clear();
        self.tick_count = 0;
        self.last_local_net = None;
    }

    /// Per-slot 独立追踪：
    /// - 显式代理槽位永远保持第 0 秒基线 + 每 2 tick（30s）独立探测，绝不被同机运行的 TUN 槽位降级为 120s；
    /// - TUN 槽位保持第 0 秒基线 + 每 8 tick（120s）独立探测；
    /// - 若 TUN 槽位启动首轮即处于 `!tun_active`，将其纳入 `startup_tun_verify_slots` 与 `probe_exit_slots` 消除初始盲窗。
    pub fn on_slots_tick(
        &mut self,
        enabled: bool,
        routes: &[RunningSlotRoute],
        tun_active: bool,
        secondary_dns_active: bool,
    ) -> SlotsTickPlan {
        if !enabled || routes.is_empty() {
            self.reset();
            return SlotsTickPlan::default();
        }
        let active_slots: std::collections::BTreeSet<&str> =
            routes.iter().map(|r| r.slot.as_str()).collect();
        self.slot_states
            .retain(|slot, _| active_slots.contains(slot.as_str()));
        self.slot_drift_streaks
            .retain(|slot, _| active_slots.contains(slot.as_str()));
        self.slot_baseline_ips
            .retain(|slot, _| active_slots.contains(slot.as_str()));

        let mut plan = SlotsTickPlan::default();
        for route in routes {
            let st = self.slot_states.entry(route.slot.clone()).or_default();
            st.tick_count = st.tick_count.saturating_add(1);
            let proxy = route.effective_proxy.trim().to_string();
            let current_route = (tun_active, secondary_dns_active, proxy.clone());
            let route_changed = st
                .last_route
                .as_ref()
                .is_some_and(|prev| prev != &current_route);
            st.last_route = Some(current_route);

            let mut force_exit_probe = false;
            if !proxy.is_empty() {
                st.tun_baseline_active = false;
                st.tun_drop_streak = 0;
            } else if tun_active {
                st.tun_baseline_active = true;
                st.tun_drop_streak = 0;
            } else if st.tun_baseline_active {
                st.tun_drop_streak = st.tun_drop_streak.saturating_add(1);
                if st.tun_drop_streak >= 2 && plan.trigger_tun_dropped.is_none() {
                    plan.trigger_tun_dropped = Some(route.expected_country.clone());
                } else {
                    plan.recheck_tun_slots.push(route.slot.clone());
                }
            } else if st.tick_count == 1 {
                plan.startup_tun_verify_slots.push(route.slot.clone());
                force_exit_probe = true;
            }

            let exit_probe_mod = if proxy.is_empty() { 8 } else { 2 };
            if force_exit_probe
                || st.tick_count == 1
                || st.tick_count % exit_probe_mod == 0
                || route_changed
            {
                plan.probe_exit_slots.push(route.slot.clone());
            }
        }
        plan
    }

    pub fn on_slots_tun_recheck(
        &mut self,
        enabled: bool,
        routes: &[RunningSlotRoute],
        recheck_slots: &[String],
        tun_active: bool,
    ) -> Option<Option<String>> {
        if !enabled || routes.is_empty() {
            self.reset();
            return None;
        }
        for slot in recheck_slots {
            let Some(route) = routes.iter().find(|r| &r.slot == slot) else {
                continue;
            };
            let Some(st) = self.slot_states.get_mut(slot) else {
                continue;
            };
            if !route.effective_proxy.trim().is_empty() || tun_active {
                if tun_active && route.effective_proxy.trim().is_empty() {
                    st.tun_baseline_active = true;
                }
                st.tun_drop_streak = 0;
            } else if st.tun_baseline_active {
                st.tun_drop_streak = st.tun_drop_streak.saturating_add(1);
                if st.tun_drop_streak >= 2 {
                    return Some(route.expected_country.clone());
                }
            }
        }
        None
    }

    /// 首次观测或未核验通过的基线 IP 返回 `InitialBaseline`，变更返回 `Changed`（且在核验前保持未核验状态）。
    pub fn observe_slot_ip_status(&mut self, slot: &str, observed_ip: Option<&str>) -> IpObservation {
        let Some(ip) = observed_ip.map(str::trim).filter(|s| !s.is_empty()) else {
            return IpObservation::Unchanged;
        };
        let st = self.slot_states.entry(slot.to_string()).or_default();
        match st.baseline_ip.as_deref() {
            None => IpObservation::InitialBaseline(ip.to_string()),
            Some(_) if !st.baseline_ip_verified => IpObservation::InitialBaseline(ip.to_string()),
            Some(prev) if prev == ip => IpObservation::Unchanged,
            Some(_) => {
                st.baseline_ip_verified = false;
                IpObservation::Changed(ip.to_string())
            }
        }
    }

    pub fn accept_slot_ip_verified(&mut self, slot: &str, ip: &str) {
        let trimmed = ip.trim();
        if !trimmed.is_empty() {
            let st = self.slot_states.entry(slot.to_string()).or_default();
            st.baseline_ip = Some(trimmed.to_string());
            st.baseline_ip_verified = true;
            self.slot_baseline_ips
                .insert(slot.to_string(), trimmed.to_string());
        }
    }

    #[cfg(test)]
    pub fn on_exit_probe(
        &mut self,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        Self::evaluate_exit_probe(
            &mut self.country_drift_streak,
            expected_country,
            probe_result,
            is_recheck,
        )
    }

    pub fn on_slot_exit_probe(
        &mut self,
        slot: &str,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let st = self.slot_states.entry(slot.to_string()).or_default();
        let action = Self::evaluate_exit_probe(
            &mut st.drift_streak,
            expected_country,
            probe_result,
            is_recheck,
        );
        self.slot_drift_streaks
            .insert(slot.to_string(), st.drift_streak);
        self.country_drift_streak = self.slot_drift_streaks.values().copied().max().unwrap_or(0);
        action
    }

    fn evaluate_exit_probe(
        streak: &mut u32,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let expected_clean = expected_country
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_ascii_uppercase);
        match probe_result {
            Err(_) => {
                if is_recheck {
                    *streak = 0;
                }
                ExitProbeAction::IgnoredTransientError
            }
            Ok(observed) => {
                let obs = observed.trim().to_ascii_uppercase();
                if crate::regions::is_unsupported_exit_country(&obs) {
                    *streak = 2;
                    return ExitProbeAction::TriggerCountryDrift {
                        expected_country: expected_clean.unwrap_or_else(|| "US".into()),
                        observed_country: obs,
                    };
                }
                let Some(exp) = expected_clean else {
                    *streak = 0;
                    return ExitProbeAction::Healthy;
                };
                if !obs.is_empty() && obs != exp {
                    *streak = streak.saturating_add(1);
                    if *streak >= 2 {
                        ExitProbeAction::TriggerCountryDrift {
                            expected_country: exp,
                            observed_country: obs,
                        }
                    } else {
                        ExitProbeAction::RecheckExitAfterDelay {
                            observed_country: obs,
                        }
                    }
                } else {
                    *streak = 0;
                    ExitProbeAction::Healthy
                }
            }
        }
    }
}

fn resolve_slot_registered_country(root: &Path, slot: &str) -> Option<String> {
    let vault = root.parent()?.join("identity-vault");
    let cards = crate::identities::warming::read_cards(&vault).ok()?;
    let db_path = vault.join("identities.sqlite");
    crate::identities::private::safe(&db_path).ok()?;
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let _ = conn.busy_timeout(Duration::from_millis(100));
    for card in cards {
        let card_slot: Option<String> = conn
            .query_row(
                "SELECT slot FROM browser_bindings WHERE identity=?1",
                [&card.id],
                |row| row.get(0),
            )
            .ok();
        if card_slot.as_deref() == Some(slot) {
            if let Some(cc) = card
                .registered_country
                .filter(|c| !c.trim().is_empty() && !crate::regions::is_unsupported_exit_country(c))
            {
                return Some(cc);
            }
        }
    }
    None
}

pub(crate) fn inspect_slot_routes_for_profiles(
    root: &Path,
    profiles: &[(String, PathBuf)],
    machine: Option<&super::config::Machine>,
) -> Vec<RunningSlotRoute> {
    let system_proxy = machine
        .map(|m| m.system_proxy.trim().to_string())
        .unwrap_or_default();
    let mut routes = Vec::with_capacity(profiles.len());
    for (slot, profile_dir) in profiles {
        let scope = profile_dir.parent().unwrap_or(root);
        let (effective_proxy, fallback_country) = match super::config::load(scope) {
            Ok(cfg) => {
                let configured = cfg.proxy.trim();
                let effective = if !configured.is_empty() {
                    configured.to_string()
                } else {
                    system_proxy.clone()
                };
                let fallback = if cfg.follow_machine {
                    machine
                        .and_then(|m| cfg.region(m))
                        .map(|r| r.country.to_string())
                        .or_else(|| {
                            machine.and_then(|m| {
                                crate::regions::timezone_country(&m.timezone).map(str::to_string)
                            })
                        })
                        .filter(|cc| !crate::regions::is_unsupported_exit_country(cc))
                } else {
                    machine
                        .and_then(|m| cfg.region(m))
                        .map(|r| r.country.to_string())
                        .or_else(|| crate::regions::timezone_country(&cfg.timezone).map(str::to_string))
                        .filter(|cc| !crate::regions::is_unsupported_exit_country(cc))
                };
                (effective, fallback)
            }
            Err(_) => (system_proxy.clone(), None),
        };
        let expected_country = resolve_slot_registered_country(root, slot).or(fallback_country);
        routes.push(RunningSlotRoute {
            slot: slot.clone(),
            effective_proxy,
            expected_country,
        });
    }
    routes
}

fn trigger_kill_switch(
    app: &tauri::AppHandle,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
) -> bool {
    let outcome = quit_all_managed_profiles(app);
    let all_closed = outcome.failed_slots.is_empty();
    let snapshot = {
        let state = app.state::<super::Browser>();
        let mut ks = state.kill_switch.lock().unwrap();
        apply_trigger_with_failures(
            &mut ks,
            reason_code,
            expected_country,
            observed_country,
            outcome.closed_slots,
            outcome.failed_slots,
            now(),
        );
        ks.clone()
    };
    update_tray_alert(app, true);
    let _ = app.emit("kill-switch-state", &snapshot);
    let _ = app.emit("kill-switch-triggered", &snapshot);
    all_closed
}

async fn execute_trigger(
    app: &tauri::AppHandle,
    tracker: &mut MonitorTracker,
    next_interval: &mut Duration,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
) {
    let trig_app = app.clone();
    let reason = reason_code.to_string();
    let all_closed = tauri::async_runtime::spawn_blocking(move || {
        trigger_kill_switch(&trig_app, &reason, expected_country, observed_country)
    })
    .await
    .unwrap_or(false);
    if all_closed {
        tracker.reset();
    } else {
        // 未确认全部受管浏览器退出前绝不 reset()，3 秒后继续重杀。
        *next_interval = Duration::from_secs(3);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RetryKillSpec {
    pub reason_code: String,
    pub expected_country: Option<String>,
    pub observed_country: Option<String>,
}

pub(crate) fn pending_failed_slot_rekill(
    ks: &KillSwitchState,
    running_managed: usize,
) -> Option<RetryKillSpec> {
    if !ks.enabled || !ks.triggered || ks.failed_slots.is_empty() || running_managed == 0 {
        return None;
    }
    Some(RetryKillSpec {
        reason_code: ks
            .reason_code
            .clone()
            .unwrap_or_else(|| "tun_dropped".to_string()),
        expected_country: ks.expected_country.clone(),
        observed_country: ks.observed_country.clone(),
    })
}

pub(crate) fn select_startup_tun_verify_route(
    routes: &[RunningSlotRoute],
    startup_tun_verify_slots: &[String],
    host_restricted: bool,
) -> Option<RunningSlotRoute> {
    routes
        .iter()
        .find(|r| {
            startup_tun_verify_slots.contains(&r.slot)
                && (host_restricted || r.expected_country.is_some())
        })
        .cloned()
}

pub fn spawn_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tracker = MonitorTracker::default();
        // First tick keeps the historical 15s cadence; afterwards idle (0 managed browsers) backs off to 60s.
        let mut next_interval = ACTIVE_POLL;
        loop {
            wait_for_next_tick(next_interval).await;
            next_interval = IDLE_POLL;

            let enabled = app
                .try_state::<super::Browser>()
                .map(|s| s.kill_switch.lock().unwrap().enabled)
                .unwrap_or(false);
            if !enabled {
                tracker.reset();
                continue;
            }

            let snap_app = app.clone();
            let Some((tun_active, secondary_dns, routes, running_count, host_restricted)) =
                tauri::async_runtime::spawn_blocking(move || {
                    let Ok(root) = super::root(&snap_app) else {
                        return (false, false, Vec::new(), 0, false);
                    };
                    let profiles = running_managed_profiles(&root);
                    if profiles.is_empty() {
                        return (false, false, Vec::new(), 0, false);
                    }
                    let (tun_active, secondary_dns) =
                        crate::risk_check::system_tun_and_dns_status();
                    let machine = super::config::machine().ok();
                    let restricted = machine
                        .as_ref()
                        .is_some_and(super::config::machine_is_restricted_region);
                    let routes =
                        inspect_slot_routes_for_profiles(&root, &profiles, machine.as_ref());
                    (tun_active, secondary_dns, routes, profiles.len(), restricted)
                })
                .await
                .ok()
            else {
                continue;
            };
            next_interval = monitor_poll_interval(running_count);

            if routes.is_empty() {
                tracker.reset();
                continue;
            }

            let pending_rekill = app.try_state::<super::Browser>().and_then(|s| {
                pending_failed_slot_rekill(&s.kill_switch.lock().unwrap(), running_count)
            });
            if let Some(spec) = pending_rekill {
                execute_trigger(
                    &app,
                    &mut tracker,
                    &mut next_interval,
                    &spec.reason_code,
                    spec.expected_country,
                    spec.observed_country,
                )
                .await;
                continue;
            }

            let plan = tracker.on_slots_tick(enabled, &routes, tun_active, secondary_dns);

            if let Some(exp) = plan.trigger_tun_dropped {
                execute_trigger(&app, &mut tracker, &mut next_interval, "tun_dropped", exp, None)
                    .await;
                continue;
            }

            if !plan.recheck_tun_slots.is_empty() {
                tokio::time::sleep(Duration::from_secs(3)).await;
                let re_app = app.clone();
                let Some((still_enabled, tun2, routes2)) =
                    tauri::async_runtime::spawn_blocking(move || {
                        let en = re_app
                            .try_state::<super::Browser>()
                            .map(|s| s.kill_switch.lock().unwrap().enabled)
                            .unwrap_or(false);
                        if !en {
                            return (false, false, Vec::new());
                        }
                        let Ok(root) = super::root(&re_app) else {
                            return (en, false, Vec::new());
                        };
                        let profiles = running_managed_profiles(&root);
                        if profiles.is_empty() {
                            return (en, false, Vec::new());
                        }
                        let (tun2, _) = crate::risk_check::system_tun_and_dns_status();
                        let machine = super::config::machine().ok();
                        let routes2 = inspect_slot_routes_for_profiles(
                            &root,
                            &profiles,
                            machine.as_ref(),
                        );
                        (en, tun2, routes2)
                    })
                    .await
                    .ok()
                else {
                    continue;
                };
                if let Some(exp) = tracker.on_slots_tun_recheck(
                    still_enabled,
                    &routes2,
                    &plan.recheck_tun_slots,
                    tun2,
                ) {
                    execute_trigger(
                        &app,
                        &mut tracker,
                        &mut next_interval,
                        "tun_dropped",
                        exp,
                        None,
                    )
                    .await;
                    continue;
                }
            }

            if !plan.probe_exit_slots.is_empty() {
                let probe_set: std::collections::BTreeSet<&str> =
                    plan.probe_exit_slots.iter().map(String::as_str).collect();
                let mut probe_cache: std::collections::BTreeMap<
                    String,
                    Result<super::network::ExitTrace, String>,
                > = std::collections::BTreeMap::new();
                for route in routes.iter().filter(|r| probe_set.contains(r.slot.as_str())) {
                    let key = route.effective_proxy.trim().to_string();
                    if !probe_cache.contains_key(&key) {
                        let res = super::network::probe_exit_trace(&key).await;
                        probe_cache.insert(key, res);
                    }
                }

                // 消除启动时 !tun_active 盲窗：首轮无 TUN 信号且 trace 不可达时经 3s 二次复核熔断。
                if !plan.startup_tun_verify_slots.is_empty()
                    && probe_cache.get("").is_some_and(Result::is_err)
                {
                    if let Some(vr) = select_startup_tun_verify_route(
                        &routes,
                        &plan.startup_tun_verify_slots,
                        host_restricted,
                    ) {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        let tun2 = tauri::async_runtime::spawn_blocking(|| {
                            crate::risk_check::system_tun_and_dns_status().0
                        })
                        .await
                        .unwrap_or(false);
                        let trace2 = super::network::probe_exit_trace("").await;
                        if !tun2 && trace2.is_err() {
                            execute_trigger(
                                &app,
                                &mut tracker,
                                &mut next_interval,
                                "tun_dropped",
                                vr.expected_country,
                                None,
                            )
                            .await;
                            continue;
                        }
                        if trace2.is_ok() {
                            probe_cache.insert(String::new(), trace2);
                        }
                    }
                }

                let mut immediate_drift: Option<(String, String)> = None;
                let mut recheck_slots: Vec<String> = Vec::new();
                let mut ip_verify_slots: Vec<(String, String, Option<String>, String)> = Vec::new();
                for route in routes.iter().filter(|r| probe_set.contains(r.slot.as_str())) {
                    let key = route.effective_proxy.trim();
                    let Some(res) = probe_cache.get(key) else {
                        continue;
                    };
                    let res_ref = res
                        .as_ref()
                        .map(|t| t.country.as_str())
                        .map_err(|e| e.as_str());
                    match tracker.on_slot_exit_probe(
                        &route.slot,
                        route.expected_country.as_deref(),
                        res_ref,
                        false,
                    ) {
                        ExitProbeAction::TriggerCountryDrift {
                            expected_country: exp,
                            observed_country: obs,
                        } => {
                            immediate_drift = Some((exp, obs));
                            break;
                        }
                        ExitProbeAction::RecheckExitAfterDelay { .. } => {
                            recheck_slots.push(route.slot.clone());
                        }
                        ExitProbeAction::Healthy => {
                            if let Ok(trace) = res {
                                match tracker
                                    .observe_slot_ip_status(&route.slot, trace.ip.as_deref())
                                {
                                    IpObservation::InitialBaseline(ip)
                                    | IpObservation::Changed(ip) => {
                                        ip_verify_slots.push((
                                            route.slot.clone(),
                                            key.to_string(),
                                            route.expected_country.clone(),
                                            ip,
                                        ));
                                    }
                                    IpObservation::Unchanged => {}
                                }
                            }
                        }
                        ExitProbeAction::IgnoredTransientError => {}
                    }
                }

                if let Some((exp, obs)) = immediate_drift {
                    execute_trigger(
                        &app,
                        &mut tracker,
                        &mut next_interval,
                        "country_drift",
                        Some(exp),
                        Some(obs),
                    )
                    .await;
                    continue;
                }

                if !recheck_slots.is_empty() {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let re_app = app.clone();
                    let Some((still_enabled, routes2)) =
                        tauri::async_runtime::spawn_blocking(move || {
                            let en = re_app
                                .try_state::<super::Browser>()
                                .map(|s| s.kill_switch.lock().unwrap().enabled)
                                .unwrap_or(false);
                            if !en {
                                return (false, Vec::new());
                            }
                            let Ok(root) = super::root(&re_app) else {
                                return (en, Vec::new());
                            };
                            let profiles = running_managed_profiles(&root);
                            if profiles.is_empty() {
                                return (en, Vec::new());
                            }
                            let machine = super::config::machine().ok();
                            let routes2 = inspect_slot_routes_for_profiles(
                                &root,
                                &profiles,
                                machine.as_ref(),
                            );
                            (en, routes2)
                        })
                        .await
                        .ok()
                    else {
                        continue;
                    };
                    if !still_enabled || routes2.is_empty() {
                        tracker.reset();
                        continue;
                    }
                    let mut reprobe_cache: std::collections::BTreeMap<
                        String,
                        Result<super::network::ExitTrace, String>,
                    > = std::collections::BTreeMap::new();
                    let mut confirmed_drift: Option<(String, String)> = None;
                    for slot_name in &recheck_slots {
                        let Some(route2) = routes2.iter().find(|r| &r.slot == slot_name) else {
                            continue;
                        };
                        let Some(ref exp_country) = route2.expected_country else {
                            continue;
                        };
                        let key = route2.effective_proxy.trim().to_string();
                        if !reprobe_cache.contains_key(&key) {
                            let res = super::network::probe_exit_trace(&key).await;
                            reprobe_cache.insert(key.clone(), res);
                        }
                        let res_ref = reprobe_cache[&key]
                            .as_ref()
                            .map(|t| t.country.as_str())
                            .map_err(|e| e.as_str());
                        if let ExitProbeAction::TriggerCountryDrift {
                            expected_country: exp,
                            observed_country: obs,
                        } = tracker.on_slot_exit_probe(
                            &route2.slot,
                            Some(exp_country.as_str()),
                            res_ref,
                            true,
                        ) {
                            confirmed_drift = Some((exp, obs));
                            break;
                        }
                    }
                    if let Some((exp, obs)) = confirmed_drift {
                        execute_trigger(
                            &app,
                            &mut tracker,
                            &mut next_interval,
                            "country_drift",
                            Some(exp),
                            Some(obs),
                        )
                        .await;
                        continue;
                    }
                }

                // 首次基线 IP 与运行中 IP 跳变统一执行 `network::is_hosting_exit` 与国家复核；未核验通过前绝不置 `baseline_ip_verified = true`。
                if !ip_verify_slots.is_empty() {
                    let mut hosting_cache: std::collections::BTreeMap<
                        String,
                        Result<super::network::Exit, String>,
                    > = std::collections::BTreeMap::new();
                    for (_, key, _, _) in &ip_verify_slots {
                        if !hosting_cache.contains_key(key) {
                            hosting_cache.insert(key.clone(), super::network::probe(key).await);
                        }
                    }
                    let mut immediate_country_drift: Option<(Option<String>, String)> = None;
                    let mut suspect_datacenter_slots: Vec<(String, Option<String>, String)> =
                        Vec::new();
                    let mut suspect_country_slots: Vec<(String, String, String)> = Vec::new();

                    for (slot, key, exp, observed_ip) in &ip_verify_slots {
                        match hosting_cache.get(key) {
                            Some(Ok(exit)) => {
                                let obs_cc = exit.country.trim().to_ascii_uppercase();
                                if crate::regions::is_unsupported_exit_country(&obs_cc) {
                                    immediate_country_drift = Some((exp.clone(), obs_cc));
                                    break;
                                }
                                if let Some(expected_cc) =
                                    exp.as_deref().map(str::trim).filter(|s| !s.is_empty())
                                {
                                    if !obs_cc.is_empty()
                                        && !obs_cc.eq_ignore_ascii_case(expected_cc)
                                    {
                                        suspect_country_slots.push((
                                            slot.clone(),
                                            expected_cc.to_ascii_uppercase(),
                                            observed_ip.clone(),
                                        ));
                                        continue;
                                    }
                                }
                                if super::network::is_hosting_exit(exit) {
                                    suspect_datacenter_slots.push((
                                        slot.clone(),
                                        exp.clone(),
                                        observed_ip.clone(),
                                    ));
                                } else {
                                    tracker.accept_slot_ip_verified(slot, observed_ip);
                                }
                            }
                            Some(Err(_)) | None => {
                                // 429/瞬态失败时不标记 baseline_ip_verified = true，留待下轮继续核验。
                            }
                        }
                    }

                    if let Some((exp, obs)) = immediate_country_drift {
                        execute_trigger(
                            &app,
                            &mut tracker,
                            &mut next_interval,
                            "country_drift",
                            Some(exp.unwrap_or_else(|| "US".into())),
                            Some(obs),
                        )
                        .await;
                        continue;
                    }

                    if !suspect_country_slots.is_empty() || !suspect_datacenter_slots.is_empty() {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        let re_app = app.clone();
                        let Some((still_enabled, routes2)) =
                            tauri::async_runtime::spawn_blocking(move || {
                                let en = re_app
                                    .try_state::<super::Browser>()
                                    .map(|s| s.kill_switch.lock().unwrap().enabled)
                                    .unwrap_or(false);
                                if !en {
                                    return (false, Vec::new());
                                }
                                let Ok(root) = super::root(&re_app) else {
                                    return (en, Vec::new());
                                };
                                let profiles = running_managed_profiles(&root);
                                if profiles.is_empty() {
                                    return (en, Vec::new());
                                }
                                let machine = super::config::machine().ok();
                                let routes2 = inspect_slot_routes_for_profiles(
                                    &root,
                                    &profiles,
                                    machine.as_ref(),
                                );
                                (en, routes2)
                            })
                            .await
                            .ok()
                        else {
                            continue;
                        };
                        if !still_enabled || routes2.is_empty() {
                            tracker.reset();
                            continue;
                        }
                        let mut rehosting_cache: std::collections::BTreeMap<
                            String,
                            Result<super::network::Exit, String>,
                        > = std::collections::BTreeMap::new();

                        let mut confirmed_country: Option<(String, String)> = None;
                        for (slot_name, expected_cc, observed_ip) in &suspect_country_slots {
                            let Some(route2) = routes2.iter().find(|r| &r.slot == slot_name)
                            else {
                                continue;
                            };
                            let key = route2.effective_proxy.trim().to_string();
                            if !rehosting_cache.contains_key(&key) {
                                rehosting_cache
                                    .insert(key.clone(), super::network::probe(&key).await);
                            }
                            if let Some(Ok(exit2)) = rehosting_cache.get(&key) {
                                let obs2 = exit2.country.trim().to_ascii_uppercase();
                                if crate::regions::is_unsupported_exit_country(&obs2)
                                    || (!obs2.is_empty() && !obs2.eq_ignore_ascii_case(expected_cc))
                                {
                                    confirmed_country = Some((expected_cc.clone(), obs2));
                                    break;
                                }
                                if !super::network::is_hosting_exit(exit2) {
                                    tracker.accept_slot_ip_verified(slot_name, observed_ip);
                                }
                            }
                        }
                        if let Some((exp, obs)) = confirmed_country {
                            execute_trigger(
                                &app,
                                &mut tracker,
                                &mut next_interval,
                                "country_drift",
                                Some(exp),
                                Some(obs),
                            )
                            .await;
                            continue;
                        }

                        let mut confirmed_datacenter: Option<(Option<String>, String)> = None;
                        for (slot_name, exp, new_ip) in &suspect_datacenter_slots {
                            let Some(route2) = routes2.iter().find(|r| &r.slot == slot_name)
                            else {
                                continue;
                            };
                            let key = route2.effective_proxy.trim().to_string();
                            if !rehosting_cache.contains_key(&key) {
                                rehosting_cache
                                    .insert(key.clone(), super::network::probe(&key).await);
                            }
                            if let Some(Ok(exit2)) = rehosting_cache.get(&key) {
                                if super::network::is_hosting_exit(exit2) {
                                    confirmed_datacenter = Some((
                                        exp.clone().or_else(|| route2.expected_country.clone()),
                                        exit2.country.clone(),
                                    ));
                                    break;
                                } else {
                                    tracker.accept_slot_ip_verified(slot_name, new_ip);
                                }
                            }
                        }
                        if let Some((exp, obs_country)) = confirmed_datacenter {
                            execute_trigger(
                                &app,
                                &mut tracker,
                                &mut next_interval,
                                "exit_datacenter",
                                exp,
                                Some(obs_country),
                            )
                            .await;
                            continue;
                        }
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub fn browser_kill_switch_state(app: tauri::AppHandle) -> KillSwitchState {
    app.state::<super::Browser>()
        .kill_switch
        .lock()
        .unwrap()
        .clone()
}

pub(crate) fn evaluate_dismiss_probe(
    has_residual_failed_profiles: bool,
    tun_required_and_down: bool,
    exit_probe: Option<&super::network::Exit>,
    expected_country: Option<&str>,
) -> bool {
    if has_residual_failed_profiles || tun_required_and_down {
        return false;
    }
    let Some(exit) = exit_probe else {
        return false;
    };
    let obs = exit.country.trim();
    if obs.is_empty() || crate::regions::is_unsupported_exit_country(obs) {
        return false;
    }
    if let Some(exp) = expected_country.map(str::trim).filter(|s| !s.is_empty()) {
        if !obs.eq_ignore_ascii_case(exp) {
            return false;
        }
    }
    if super::network::is_hosting_exit(exit) {
        return false;
    }
    true
}

#[tauri::command]
pub async fn browser_kill_switch_dismiss(app: tauri::AppHandle) -> KillSwitchState {
    let was_triggered = {
        let state = app.state::<super::Browser>();
        let ks = state.kill_switch.lock().unwrap();
        ks.triggered
    };
    if !was_triggered {
        return app
            .state::<super::Browser>()
            .kill_switch
            .lock()
            .unwrap()
            .clone();
    }

    let check_app = app.clone();
    let prep = tauri::async_runtime::spawn_blocking(move || {
        let Ok(root) = super::root(&check_app) else {
            return (true, false, String::new(), None);
        };
        let had_failed = !check_app
            .state::<super::Browser>()
            .kill_switch
            .lock()
            .unwrap()
            .failed_slots
            .is_empty();
        let mut residual = !running_managed_profiles(&root).is_empty() && had_failed;
        if residual {
            let outcome = quit_all_managed_profiles(&check_app);
            residual =
                !outcome.failed_slots.is_empty() || !running_managed_profiles(&root).is_empty();
            if residual {
                let browser_state = check_app.state::<super::Browser>();
                let mut ks = browser_state.kill_switch.lock().unwrap();
                ks.failed_slots = outcome.failed_slots;
                ks.closed_slots = outcome.closed_slots;
            }
        }
        let slot = super::workspaces::selected_slot_readonly(&root).ok();
        let machine = super::config::machine().ok();
        let route = slot.and_then(|s| {
            let scope = super::workspaces::slot_path(&root, &s).ok()?;
            let routes = inspect_slot_routes_for_profiles(
                &root,
                &[(s, scope.join("profile"))],
                machine.as_ref(),
            );
            routes.into_iter().next()
        });
        let effective_proxy = route
            .as_ref()
            .map(|r| r.effective_proxy.clone())
            .unwrap_or_else(|| {
                machine
                    .as_ref()
                    .map(|m| m.system_proxy.trim().to_string())
                    .unwrap_or_default()
            });
        let expected_country = route.and_then(|r| r.expected_country);
        let tun_required_and_down =
            effective_proxy.is_empty() && !crate::risk_check::system_tun_and_dns_status().0;
        (
            residual,
            tun_required_and_down,
            effective_proxy,
            expected_country,
        )
    })
    .await
    .unwrap_or((true, false, String::new(), None));

    let (residual, tun_required_and_down, effective_proxy, expected_country) = prep;
    let probe_res = if residual || tun_required_and_down {
        None
    } else {
        super::network::probe(&effective_proxy).await.ok()
    };

    if evaluate_dismiss_probe(
        residual,
        tun_required_and_down,
        probe_res.as_ref(),
        expected_country.as_deref(),
    ) {
        clear_alert(&app);
    } else {
        let snapshot = app
            .state::<super::Browser>()
            .kill_switch
            .lock()
            .unwrap()
            .clone();
        let _ = app.emit("kill-switch-state", &snapshot);
        return snapshot;
    }
    app.state::<super::Browser>()
        .kill_switch
        .lock()
        .unwrap()
        .clone()
}

#[tauri::command]
pub fn browser_kill_switch_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> KillSwitchState {
    if !enabled {
        clear_alert(&app);
    }
    let snapshot = {
        let state = app.state::<super::Browser>();
        let mut ks = state.kill_switch.lock().unwrap();
        ks.enabled = enabled;
        ks.clone()
    };
    let _ = app.emit("kill-switch-state", &snapshot);
    if enabled {
        notify_browser_activity();
    }
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_monitor_backs_off_and_browser_launch_wakes_it_immediately() {
        assert_eq!(monitor_poll_interval(0), Duration::from_secs(60));
        assert_eq!(monitor_poll_interval(1), Duration::from_secs(15));
        assert_eq!(monitor_poll_interval(4), Duration::from_secs(15));
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        rt.block_on(async {
            // A launch signalled before the wait stores a permit: the 60s idle wait returns at once.
            notify_browser_activity();
            let started = std::time::Instant::now();
            wait_for_next_tick(IDLE_POLL).await;
            assert!(started.elapsed() < Duration::from_secs(5));
            // Without a signal the wait honours its interval.
            let started = std::time::Instant::now();
            wait_for_next_tick(Duration::from_millis(120)).await;
            assert!(started.elapsed() >= Duration::from_millis(100));
        });
    }

    #[test]
    fn managed_profile_scan_without_profiles_is_empty() {
        let root = std::env::temp_dir().join(format!(
            "claude-local-kill-switch-empty-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&root);
        assert!(running_managed_profiles(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn state_trigger_dismiss_and_auto_clear_never_block_relaunch() {
        let mut state = KillSwitchState::default();
        assert!(state.enabled);
        assert!(!state.triggered);
        assert!(!apply_clear_alert(&mut state));

        apply_trigger(
            &mut state,
            "tun_dropped",
            Some("US".into()),
            None,
            vec!["slot-a".into(), "slot-b".into()],
            1_700_000_000,
        );
        assert!(state.triggered);
        assert_eq!(state.reason_code.as_deref(), Some("tun_dropped"));
        assert_eq!(state.expected_country.as_deref(), Some("US"));
        assert_eq!(state.closed_slots, vec!["slot-a", "slot-b"]);

        assert!(apply_clear_alert(&mut state));
        assert!(!state.triggered);
        assert_eq!(state.reason_code, None);
        assert_eq!(state.expected_country, None);
        assert_eq!(state.observed_country, None);
        assert_eq!(state.triggered_at, None);
        assert!(state.closed_slots.is_empty());
        assert!(state.enabled);
    }

    #[test]
    fn tun_drop_requires_baseline_and_two_consecutive_confirmations() {
        let mut tracker = MonitorTracker::default();
        let tun_route = vec![RunningSlotRoute {
            slot: "slot-tun".into(),
            effective_proxy: String::new(),
            expected_country: Some("US".into()),
        }];

        // No browser running -> zero action, baseline stays false.
        let empty = tracker.on_slots_tick(true, &[], false, false);
        assert!(empty.trigger_tun_dropped.is_none());
        assert!(empty.recheck_tun_slots.is_empty());
        assert!(empty.probe_exit_slots.is_empty());

        // Tick 1 with TUN initially off -> eliminates 120s blind window via startup_tun_verify_slots + 0s exit probe!
        let init_off = tracker.on_slots_tick(true, &tun_route, false, false);
        assert!(init_off.trigger_tun_dropped.is_none());
        assert_eq!(init_off.startup_tun_verify_slots, vec!["slot-tun"]);
        assert_eq!(init_off.probe_exit_slots, vec!["slot-tun"]);

        // TUN observed active -> establishes per-slot baseline.
        let active_plan = tracker.on_slots_tick(true, &tun_route, true, false);
        assert!(active_plan.trigger_tun_dropped.is_none());
        assert!(tracker.slot_states["slot-tun"].tun_baseline_active);

        // First TUN drop -> requests 3s recheck, does not trigger immediately.
        let drop1 = tracker.on_slots_tick(true, &tun_route, false, true);
        assert!(drop1.trigger_tun_dropped.is_none());
        assert_eq!(drop1.recheck_tun_slots, vec!["slot-tun"]);
        assert_eq!(tracker.slot_states["slot-tun"].tun_drop_streak, 1);

        // Transient recovery on 3s recheck -> resets streak, no trigger.
        assert!(tracker
            .on_slots_tun_recheck(true, &tun_route, &drop1.recheck_tun_slots, true)
            .is_none());
        assert_eq!(tracker.slot_states["slot-tun"].tun_drop_streak, 0);

        // Another TUN drop followed by confirmed drop on recheck -> triggers Kill-Switch.
        let drop2 = tracker.on_slots_tick(true, &tun_route, false, true);
        assert_eq!(drop2.recheck_tun_slots, vec!["slot-tun"]);
        assert_eq!(
            tracker.on_slots_tun_recheck(true, &tun_route, &drop2.recheck_tun_slots, false),
            Some(Some("US".into()))
        );
    }

    #[test]
    fn explicit_proxy_bypasses_tun_drop_and_429_or_timeouts_never_trigger_drift() {
        let mut tracker = MonitorTracker::default();
        let proxy_route = vec![RunningSlotRoute {
            slot: "slot-proxy".into(),
            effective_proxy: "socks5://127.0.0.1:7899".into(),
            expected_country: Some("US".into()),
        }];

        // Explicit SOCKS5/HTTP proxy does not rely on TUN adapter and probes at 0s (tick 1) + every 2 ticks (30s).
        let p1 = tracker.on_slots_tick(true, &proxy_route, true, false);
        assert!(p1.trigger_tun_dropped.is_none());
        assert!(!tracker.slot_states["slot-proxy"].tun_baseline_active);
        assert_eq!(p1.probe_exit_slots, vec!["slot-proxy"]);

        let p2 = tracker.on_slots_tick(true, &proxy_route, false, false);
        assert!(p2.trigger_tun_dropped.is_none());
        assert_eq!(p2.probe_exit_slots, vec!["slot-proxy"]);

        // Transient errors (timeout, DNS failure, HTTP 429 rate_limited) never increment drift streak.
        for err in ["timeout", "network_error", "HTTP 429", "rate_limited"] {
            assert_eq!(
                tracker.on_exit_probe(Some("US"), Err(err), false),
                ExitProbeAction::IgnoredTransientError
            );
            assert_eq!(tracker.country_drift_streak, 0);
        }

        // First country mismatch -> requests recheck after 3s.
        assert_eq!(
            tracker.on_exit_probe(Some("US"), Ok("JP"), false),
            ExitProbeAction::RecheckExitAfterDelay {
                observed_country: "JP".into()
            }
        );
        assert_eq!(tracker.country_drift_streak, 1);

        // If recheck hits HTTP 429 / timeout -> resets streak instead of false triggering.
        assert_eq!(
            tracker.on_exit_probe(Some("US"), Err("rate_limited"), true),
            ExitProbeAction::IgnoredTransientError
        );
        assert_eq!(tracker.country_drift_streak, 0);

        // Two consecutive confirmed country mismatches -> triggers country_drift.
        assert_eq!(
            tracker.on_exit_probe(Some("US"), Ok("DE"), false),
            ExitProbeAction::RecheckExitAfterDelay {
                observed_country: "DE".into()
            }
        );
        assert_eq!(
            tracker.on_exit_probe(Some("US"), Ok("DE"), true),
            ExitProbeAction::TriggerCountryDrift {
                expected_country: "US".into(),
                observed_country: "DE".into(),
            }
        );

        // Unsupported exit countries (CN/HK/MO/RU/etc.) trigger immediately on first hit even when expected_country is None!
        for unsupported in ["CN", "HK", "RU"] {
            assert_eq!(
                tracker.on_exit_probe(None, Ok(unsupported), false),
                ExitProbeAction::TriggerCountryDrift {
                    expected_country: "US".into(),
                    observed_country: unsupported.into(),
                }
            );
        }
        // Supported US exit with expected_country == None (e.g. unaligned CN host with follow_machine=true) stays Healthy.
        assert_eq!(
            tracker.on_exit_probe(None, Ok("US"), false),
            ExitProbeAction::Healthy
        );
    }

    #[test]
    fn tray_icon_tinting_colors_opaque_pixels_and_preserves_transparent_background() {
        let mut rgba = vec![
            10, 20, 30, 0,   // transparent
            50, 60, 70, 32,  // threshold alpha (<= 32 untouched)
            80, 90, 100, 255 // opaque pixel -> tinted alert red
        ];
        tint_rgba_alert_red(&mut rgba);
        assert_eq!(&rgba[0..4], &[10, 20, 30, 0]);
        assert_eq!(&rgba[4..8], &[50, 60, 70, 32]);
        assert_eq!(&rgba[8..12], &[220, 38, 38, 255]);
    }

    #[test]
    fn per_slot_explicit_proxy_keeps_30s_cadence_alongside_tun_slot() {
        let dir = std::env::temp_dir().join(format!(
            "claude-local-ks-slots-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = dir.join("browser");
        let slot_a = "10000000000000000000000000000001";
        let slot_b = "10000000000000000000000000000002";
        let scope_a = root.join("contexts").join(slot_a);
        let scope_b = root.join("contexts").join(slot_b);
        fs::create_dir_all(scope_a.join("profile")).unwrap();
        fs::create_dir_all(scope_b.join("profile")).unwrap();
        fs::create_dir_all(root.join("profile")).unwrap();

        let mut cfg_a = super::super::config::Config::default();
        cfg_a.proxy = "socks5://127.0.0.1:7899".into();
        cfg_a.follow_machine = false;
        cfg_a.language = "en-US".into();
        cfg_a.timezone = "America/New_York".into();
        super::super::config::save(&scope_a, &cfg_a).unwrap();

        let mut cfg_b = super::super::config::Config::default();
        cfg_b.proxy = String::new(); // TUN-dependent slot
        cfg_b.follow_machine = false;
        cfg_b.language = "ja".into();
        cfg_b.timezone = "Asia/Tokyo".into();
        super::super::config::save(&scope_b, &cfg_b).unwrap();

        let mut cfg_legacy = super::super::config::Config::default();
        cfg_legacy.proxy = "http://127.0.0.1:7897".into();
        super::super::config::save(&root, &cfg_legacy).unwrap();

        let machine = super::super::config::Machine {
            platform: "windows".into(),
            version: "10.0.22631".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en-US".into(),
            locale_country: "US".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into(), "Asia/Tokyo".into()],
            system_proxy: String::new(),
        };

        let profiles = vec![
            ("legacy".to_string(), root.join("profile")),
            (slot_a.to_string(), scope_a.join("profile")),
            (slot_b.to_string(), scope_b.join("profile")),
        ];
        let routes = inspect_slot_routes_for_profiles(&root, &profiles, Some(&machine));
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(routes.len(), 3);
        assert_eq!(routes[0].effective_proxy, "http://127.0.0.1:7897");
        assert_eq!(routes[1].effective_proxy, "socks5://127.0.0.1:7899");
        assert_eq!(routes[1].expected_country.as_deref(), Some("US"));
        assert_eq!(routes[2].effective_proxy, "");
        assert_eq!(routes[2].expected_country.as_deref(), Some("JP"));

        let mut tracker = MonitorTracker::default();
        // Tick 1 (0s): all 3 slots probe immediately (zero blind window).
        let t1 = tracker.on_slots_tick(true, &routes, true, false);
        assert_eq!(t1.probe_exit_slots, vec!["legacy", slot_a, slot_b]);
        // Tick 2 (30s): explicit proxy slots keep 30s cadence even while slot_b uses TUN!
        let t2 = tracker.on_slots_tick(true, &routes, true, false);
        assert_eq!(t2.probe_exit_slots, vec!["legacy", slot_a]);
        // Tick 3: none. Tick 4: explicit proxy slots only.
        let t3 = tracker.on_slots_tick(true, &routes, true, false);
        assert!(t3.probe_exit_slots.is_empty());
        let t4 = tracker.on_slots_tick(true, &routes, true, false);
        assert_eq!(t4.probe_exit_slots, vec!["legacy", slot_a]);
        // Ticks 5..=7: slot_b (TUN) does not probe until tick 8 (120s).
        let _ = tracker.on_slots_tick(true, &routes, true, false);
        let _ = tracker.on_slots_tick(true, &routes, true, false);
        let _ = tracker.on_slots_tick(true, &routes, true, false);
        let t8 = tracker.on_slots_tick(true, &routes, true, false);
        assert_eq!(t8.probe_exit_slots, vec!["legacy", slot_a, slot_b]);

        // Only slot_b (TUN) requests TUN recheck when tun_active drops; slot_a stays unaffected.
        let drop1 = tracker.on_slots_tick(true, &routes, false, false);
        assert_eq!(drop1.recheck_tun_slots, vec![slot_b]);
        assert_eq!(
            tracker.on_slots_tun_recheck(true, &routes, &drop1.recheck_tun_slots, false),
            Some(Some("JP".into()))
        );
    }

    #[test]
    fn initial_baseline_ip_and_dismiss_probe_verify_hosting_and_beforeunload_escalation() {
        let mut tracker = MonitorTracker::default();
        // First baseline IP must be verified before baseline_ip_verified becomes true.
        assert_eq!(
            tracker.observe_slot_ip_status("slot-a", Some("198.51.100.10")),
            IpObservation::InitialBaseline("198.51.100.10".into())
        );
        // Transient probe failure does NOT mark verified -> next tick retries verification!
        assert_eq!(
            tracker.observe_slot_ip_status("slot-a", Some("198.51.100.10")),
            IpObservation::InitialBaseline("198.51.100.10".into())
        );
        tracker.accept_slot_ip_verified("slot-a", "198.51.100.10");
        assert_eq!(
            tracker.observe_slot_ip_status("slot-a", Some("198.51.100.10")),
            IpObservation::Unchanged
        );
        assert_eq!(
            tracker.observe_slot_ip_status("slot-a", Some("198.51.100.20")),
            IpObservation::Changed("198.51.100.20".into())
        );

        // Simulated beforeunload blocking WM_CLOSE -> force_kill escalation closes process.
        let mut killed = false;
        let running = std::cell::Cell::new(true);
        force_quit_with_hooks(
            || Err("beforeunload timeout".into()),
            || Ok(running.get()),
            || {
                killed = true;
                running.set(false);
                Ok(true)
            },
        )
        .unwrap();
        assert!(killed);

        // If force_kill fails to clear running process, force_quit_with_hooks returns Err (no silent reset!).
        assert!(force_quit_with_hooks(
            || Ok(()),
            || Ok(true),
            || Ok(false),
        )
        .is_err());

        let mut ks = KillSwitchState::default();
        apply_trigger_with_failures(
            &mut ks,
            "exit_datacenter",
            Some("US".into()),
            Some("US".into()),
            vec![],
            vec!["slot-a".into()],
            1_700_000_001,
        );
        assert!(ks.triggered);
        assert_eq!(ks.failed_slots, vec!["slot-a"]);

        // Dismiss probe checks: hosting ISP (even with hosting: None) or TUN down or residual failed slots refuses dismiss.
        let dc_exit = super::super::network::Exit {
            ip: "104.18.0.1".into(),
            country: "US".into(),
            city: "Los Angeles".into(),
            timezone: "America/Los_Angeles".into(),
            isp: "DigitalOcean LLC".into(),
            asn: Some("AS14061".into()),
            hosting: None,
            hosting_source: None,
            hosting_error: None,
        };
        assert!(!evaluate_dismiss_probe(false, false, Some(&dc_exit), Some("US")));
        let res_exit = super::super::network::Exit {
            ip: "73.1.2.3".into(),
            country: "US".into(),
            city: "San Jose".into(),
            timezone: "America/Los_Angeles".into(),
            isp: "Comcast Cable".into(),
            asn: Some("AS7922".into()),
            hosting: Some(false),
            hosting_source: Some("ipquery".into()),
            hosting_error: None,
        };
        assert!(!evaluate_dismiss_probe(true, false, Some(&res_exit), Some("US")));
        assert!(!evaluate_dismiss_probe(false, true, Some(&res_exit), Some("US")));
        assert!(!evaluate_dismiss_probe(false, false, Some(&res_exit), Some("JP")));
        assert!(!evaluate_dismiss_probe(false, false, None, Some("US")));
        assert!(evaluate_dismiss_probe(false, false, Some(&res_exit), Some("US")));

        assert!(apply_clear_alert(&mut ks));
        assert!(!ks.triggered);
        assert!(ks.failed_slots.is_empty());
    }

    #[test]
    fn triggered_relaunch_blocks_aligned_tun_down_datacenter_drift_and_allows_healthy_recovery() {
        let mut tun_cfg = super::super::config::Config::default();
        tun_cfg.proxy = String::new();
        tun_cfg.follow_machine = true;

        let mut proxy_cfg = super::super::config::Config::default();
        proxy_cfg.proxy = "socks5://127.0.0.1:7899".into();
        proxy_cfg.follow_machine = false;
        proxy_cfg.language = "en-US".into();
        proxy_cfg.timezone = "America/New_York".into();

        let aligned_machine = super::super::config::Machine {
            platform: "Win32".into(),
            version: "10.0.26100".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en-US".into(),
            locale_country: "US".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into()],
            system_proxy: "http://127.0.0.1:7897".into(),
        };
        assert!(!super::super::config::machine_is_restricted_region(&aligned_machine));

        let res_us = super::super::network::Exit {
            ip: "73.1.2.3".into(),
            country: "US".into(),
            city: "New York".into(),
            timezone: "America/New_York".into(),
            isp: "Comcast Cable".into(),
            asn: Some("AS7922".into()),
            hosting: Some(false),
            hosting_source: Some("ipquery".into()),
            hosting_error: None,
        };
        let dc_us = super::super::network::Exit {
            ip: "198.51.100.99".into(),
            country: "US".into(),
            city: "Los Angeles".into(),
            timezone: "America/Los_Angeles".into(),
            isp: "Google Cloud".into(),
            asn: Some("AS15169".into()),
            hosting: Some(true),
            hosting_source: Some("ipquery".into()),
            hosting_error: None,
        };
        let res_jp = super::super::network::Exit {
            country: "JP".into(),
            ..res_us.clone()
        };

        let expected = slot_expected_country(None, None, &tun_cfg, &aligned_machine);
        assert_eq!(expected.as_deref(), Some("US"));

        // G1-A: Aligned host (!machine_is_restricted_region) with non-empty system_proxy MUST STILL block TUN launch when !tun_active.
        assert!(evaluate_triggered_launch_route(
            false,
            &tun_cfg,
            false,
            Some(&res_us),
            expected.as_deref(),
        )
        .is_err());

        // G1-B: Datacenter exit, country drift, missing probe, or residual failed slots MUST block relaunch.
        assert!(evaluate_triggered_launch_route(
            false,
            &proxy_cfg,
            true,
            Some(&dc_us),
            Some("US"),
        )
        .is_err());
        assert!(evaluate_triggered_launch_route(
            false,
            &proxy_cfg,
            true,
            Some(&res_jp),
            Some("US"),
        )
        .is_err());
        assert!(evaluate_triggered_launch_route(false, &proxy_cfg, true, None, Some("US")).is_err());
        assert!(evaluate_triggered_launch_route(
            true,
            &proxy_cfg,
            true,
            Some(&res_us),
            Some("US"),
        )
        .is_err());

        // Healthy residential exit matching expected country passes for both TUN (tun_active=true) and explicit proxy.
        assert!(evaluate_triggered_launch_route(
            false,
            &tun_cfg,
            true,
            Some(&res_us),
            expected.as_deref(),
        )
        .is_ok());
        assert!(evaluate_triggered_launch_route(
            false,
            &proxy_cfg,
            false,
            Some(&res_us),
            Some("US"),
        )
        .is_ok());
    }

    #[test]
    fn failed_slots_rekill_spec_fires_independently_of_tick_parity_and_dual_tun_finds_later_expected_slot() {
        // G3: Any triggered state with non-empty failed_slots and running_managed > 0 triggers immediate 3s rekill spec.
        let mut ks = KillSwitchState::default();
        assert!(pending_failed_slot_rekill(&ks, 1).is_none());

        apply_trigger_with_failures(
            &mut ks,
            "exit_datacenter",
            Some("US".into()),
            Some("US".into()),
            vec![],
            vec!["slot-stuck".into()],
            1_700_000_010,
        );
        let spec = pending_failed_slot_rekill(&ks, 1).expect("expected immediate rekill spec");
        assert_eq!(spec.reason_code, "exit_datacenter");
        assert_eq!(spec.expected_country.as_deref(), Some("US"));

        // When 0 managed browsers remain or kill switch disabled, rekill does not fire.
        assert!(pending_failed_slot_rekill(&ks, 0).is_none());
        ks.enabled = false;
        assert!(pending_failed_slot_rekill(&ks, 1).is_none());
        ks.enabled = true;
        ks.failed_slots.clear();
        assert!(pending_failed_slot_rekill(&ks, 1).is_none());

        // G4: !host_restricted with dual TUN slots where first slot has expected_country=None and second has Some("US").
        let routes = vec![
            RunningSlotRoute {
                slot: "aaa-no-country".into(),
                effective_proxy: String::new(),
                expected_country: None,
            },
            RunningSlotRoute {
                slot: "bbb-us".into(),
                effective_proxy: String::new(),
                expected_country: Some("US".into()),
            },
        ];
        let mut tracker = MonitorTracker::default();
        let plan = tracker.on_slots_tick(true, &routes, false, false);
        assert_eq!(
            plan.startup_tun_verify_slots,
            vec!["aaa-no-country", "bbb-us"]
        );
        let selected = select_startup_tun_verify_route(&routes, &plan.startup_tun_verify_slots, false)
            .expect("second TUN slot with expected_country must be selected when !host_restricted");
        assert_eq!(selected.slot, "bbb-us");
        assert_eq!(selected.expected_country.as_deref(), Some("US"));

        // When no TUN slot has expected_country and !host_restricted, selection returns None.
        let routes_none = vec![RunningSlotRoute {
            slot: "aaa-no-country".into(),
            effective_proxy: String::new(),
            expected_country: None,
        }];
        assert!(select_startup_tun_verify_route(
            &routes_none,
            &["aaa-no-country".into()],
            false
        )
        .is_none());
        assert!(select_startup_tun_verify_route(
            &routes_none,
            &["aaa-no-country".into()],
            true
        )
        .is_some());
    }
}
