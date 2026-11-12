// [INPUT]: 受管伴侣浏览器全部运行中资料目录（legacy/profile 与 contexts/*/profile）、各槽位独立 config.json 有效代理/预期国家、本机 TUN/DNS 快照及用户解警/开关动作。
// [OUTPUT]: 按需激活的多槽位伴侣浏览器断线保护（任一运行槽位为空代理即启用 TUN 监控，逐槽位核验出口国家漂移）、全槽位浏览器关闭、红色告警托盘图标与零后续阻断恢复。
// [POS]: 伴侣浏览器运行期非阻断守护；无受管浏览器运行时零 ipconfig/HTTP 探测，绝不触碰 claude.exe，重开浏览器自动解警。
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
    pub reason_code: Option<String>, // "tun_dropped" | "country_drift"
    pub expected_country: Option<String>,
    pub observed_country: Option<String>,
    pub triggered_at: Option<u64>,
    pub closed_slots: Vec<String>,
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
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn apply_trigger(
    state: &mut KillSwitchState,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
    closed_slots: Vec<String>,
    timestamp: u64,
) {
    state.triggered = true;
    state.reason_code = Some(reason_code.to_string());
    state.expected_country = expected_country;
    state.observed_country = observed_country;
    state.triggered_at = Some(timestamp.max(1));
    state.closed_slots = closed_slots;
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

pub(crate) fn running_managed_profiles(root: &Path) -> Vec<(String, PathBuf)> {
    let mut running = Vec::new();
    let legacy = root.join("profile");
    if super::profile::check_path(root, &legacy).is_ok()
        && legacy.is_dir()
        && super::profile::running(&legacy).unwrap_or(false)
    {
        running.push(("legacy".to_string(), legacy));
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
            if super::profile::check_path(root, &profile_dir).is_ok()
                && profile_dir.is_dir()
                && super::profile::running(&profile_dir).unwrap_or(false)
            {
                running.push((slot, profile_dir));
            }
        }
    }
    running.sort_by(|a, b| a.0.cmp(&b.0));
    running
}

pub(crate) fn quit_all_managed_profiles(app: &tauri::AppHandle) -> Vec<String> {
    let state = app.state::<super::Browser>();
    let _guard = state.gate.lock().unwrap();
    let Ok(root) = super::root(app) else {
        return Vec::new();
    };
    let profiles = running_managed_profiles(&root);
    let mut closed = Vec::with_capacity(profiles.len());
    for (slot, profile_dir) in profiles {
        let _ = super::profile::quit(&profile_dir);
        closed.push(slot);
    }
    state.quota_sync.lock().unwrap().clear();
    state.last_observations.lock().unwrap().clear();
    *state.host.lock().unwrap() = None;
    super::renew_session(app);
    closed
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunningSlotRoute {
    pub slot: String,
    pub effective_proxy: String,
    pub expected_country: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MonitorTracker {
    pub tun_baseline_active: bool,
    pub tun_drop_streak: u32,
    pub country_drift_streak: u32,
    pub slot_drift_streaks: std::collections::BTreeMap<String, u32>,
    pub tick_count: u64,
    pub last_local_net: Option<(bool, bool, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalCheckAction {
    Healthy { should_probe_exit: bool },
    RecheckTunAfterDelay,
    TriggerTunDropped,
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
        self.tun_baseline_active = false;
        self.tun_drop_streak = 0;
        self.country_drift_streak = 0;
        self.slot_drift_streaks.clear();
        self.tick_count = 0;
        self.last_local_net = None;
    }

    pub fn on_local_tick(
        &mut self,
        enabled: bool,
        has_running_browsers: bool,
        effective_proxy: &str,
        tun_active: bool,
        secondary_dns_active: bool,
    ) -> LocalCheckAction {
        if !enabled || !has_running_browsers {
            self.reset();
            return LocalCheckAction::Healthy {
                should_probe_exit: false,
            };
        }
        self.tick_count = self.tick_count.saturating_add(1);
        let current_net = (
            tun_active,
            secondary_dns_active,
            effective_proxy.trim().to_string(),
        );
        let net_changed = self
            .last_local_net
            .as_ref()
            .is_some_and(|prev| prev != &current_net);
        self.last_local_net = Some(current_net);

        if !effective_proxy.trim().is_empty() {
            self.tun_baseline_active = false;
            self.tun_drop_streak = 0;
        } else if tun_active {
            self.tun_baseline_active = true;
            self.tun_drop_streak = 0;
        } else if self.tun_baseline_active {
            self.tun_drop_streak = self.tun_drop_streak.saturating_add(1);
            if self.tun_drop_streak >= 2 {
                return LocalCheckAction::TriggerTunDropped;
            }
            return LocalCheckAction::RecheckTunAfterDelay;
        }

        let should_probe_exit = self.tick_count % 8 == 0 || net_changed;
        LocalCheckAction::Healthy { should_probe_exit }
    }

    pub fn on_tun_recheck(
        &mut self,
        enabled: bool,
        has_running_browsers: bool,
        effective_proxy: &str,
        tun_active: bool,
    ) -> LocalCheckAction {
        if !enabled || !has_running_browsers {
            self.reset();
            return LocalCheckAction::Healthy {
                should_probe_exit: false,
            };
        }
        if !effective_proxy.trim().is_empty() || tun_active {
            if tun_active && effective_proxy.trim().is_empty() {
                self.tun_baseline_active = true;
            }
            self.tun_drop_streak = 0;
            return LocalCheckAction::Healthy {
                should_probe_exit: false,
            };
        }
        if self.tun_baseline_active {
            self.tun_drop_streak = self.tun_drop_streak.saturating_add(1);
            if self.tun_drop_streak >= 2 {
                return LocalCheckAction::TriggerTunDropped;
            }
            return LocalCheckAction::RecheckTunAfterDelay;
        }
        LocalCheckAction::Healthy {
            should_probe_exit: false,
        }
    }

    #[cfg(test)]
    pub fn on_exit_probe(
        &mut self,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let action = Self::evaluate_exit_probe(
            &mut self.country_drift_streak,
            expected_country,
            probe_result,
            is_recheck,
        );
        action
    }

    pub fn on_slot_exit_probe(
        &mut self,
        slot: &str,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let streak = self.slot_drift_streaks.entry(slot.to_string()).or_insert(0);
        let action = Self::evaluate_exit_probe(streak, expected_country, probe_result, is_recheck);
        self.country_drift_streak = self.slot_drift_streaks.values().copied().max().unwrap_or(0);
        action
    }

    fn evaluate_exit_probe(
        streak: &mut u32,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let Some(expected) = expected_country.map(str::trim).filter(|s| !s.is_empty()) else {
            *streak = 0;
            return ExitProbeAction::Healthy;
        };
        match probe_result {
            Err(_) => {
                if is_recheck {
                    *streak = 0;
                }
                ExitProbeAction::IgnoredTransientError
            }
            Ok(observed) => {
                let obs = observed.trim().to_ascii_uppercase();
                let exp = expected.to_ascii_uppercase();
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
        if card_slot.as_deref() == Some(slot) && card.registered_country.is_some() {
            return card.registered_country;
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
                let fallback = machine
                    .and_then(|m| cfg.region(m))
                    .map(|r| r.country.to_string());
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

pub fn aggregate_tun_proxy(routes: &[RunningSlotRoute]) -> &str {
    if routes.is_empty() || routes.iter().any(|r| r.effective_proxy.trim().is_empty()) {
        ""
    } else {
        routes[0].effective_proxy.trim()
    }
}

pub fn tun_alert_expected_country(routes: &[RunningSlotRoute]) -> Option<String> {
    routes
        .iter()
        .filter(|r| r.effective_proxy.trim().is_empty())
        .find_map(|r| r.expected_country.clone())
        .or_else(|| routes.iter().find_map(|r| r.expected_country.clone()))
}

fn trigger_kill_switch(
    app: &tauri::AppHandle,
    reason_code: &str,
    expected_country: Option<String>,
    observed_country: Option<String>,
) {
    let closed_slots = quit_all_managed_profiles(app);
    let snapshot = {
        let state = app.state::<super::Browser>();
        let mut ks = state.kill_switch.lock().unwrap();
        apply_trigger(
            &mut ks,
            reason_code,
            expected_country,
            observed_country,
            closed_slots,
            now(),
        );
        ks.clone()
    };
    update_tray_alert(app, true);
    let _ = app.emit("kill-switch-state", &snapshot);
    let _ = app.emit("kill-switch-triggered", &snapshot);
}

pub fn spawn_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tracker = MonitorTracker::default();
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;

            let enabled = app
                .try_state::<super::Browser>()
                .map(|s| s.kill_switch.lock().unwrap().enabled)
                .unwrap_or(false);
            if !enabled {
                tracker.reset();
                continue;
            }

            let snap_app = app.clone();
            let Some((tun_active, secondary_dns, routes)) =
                tauri::async_runtime::spawn_blocking(move || {
                    let Ok(root) = super::root(&snap_app) else {
                        return (false, false, Vec::new());
                    };
                    let profiles = running_managed_profiles(&root);
                    if profiles.is_empty() {
                        return (false, false, Vec::new());
                    }
                    let (tun_active, secondary_dns) =
                        crate::risk_check::system_tun_and_dns_status();
                    let machine = super::config::machine().ok();
                    let routes =
                        inspect_slot_routes_for_profiles(&root, &profiles, machine.as_ref());
                    (tun_active, secondary_dns, routes)
                })
                .await
                .ok()
            else {
                continue;
            };

            if routes.is_empty() {
                tracker.reset();
                continue;
            }

            let active_slots: std::collections::BTreeSet<&str> =
                routes.iter().map(|r| r.slot.as_str()).collect();
            tracker
                .slot_drift_streaks
                .retain(|slot, _| active_slots.contains(slot.as_str()));

            let tun_proxy = aggregate_tun_proxy(&routes).to_string();
            let tun_expected = tun_alert_expected_country(&routes);

            let local_action = tracker.on_local_tick(
                enabled,
                true,
                &tun_proxy,
                tun_active,
                secondary_dns,
            );

            match local_action {
                LocalCheckAction::TriggerTunDropped => {
                    let trig_app = app.clone();
                    let exp = tun_expected.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        trigger_kill_switch(&trig_app, "tun_dropped", exp, None);
                    })
                    .await;
                    tracker.reset();
                    continue;
                }
                LocalCheckAction::RecheckTunAfterDelay => {
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
                    let still_running = !routes2.is_empty();
                    let tun_proxy2 = aggregate_tun_proxy(&routes2);
                    if tracker.on_tun_recheck(still_enabled, still_running, tun_proxy2, tun2)
                        == LocalCheckAction::TriggerTunDropped
                    {
                        let trig_app = app.clone();
                        let exp =
                            tun_alert_expected_country(&routes2).or_else(|| tun_expected.clone());
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            trigger_kill_switch(&trig_app, "tun_dropped", exp, None);
                        })
                        .await;
                        tracker.reset();
                        continue;
                    }
                }
                LocalCheckAction::Healthy { should_probe_exit } => {
                    if should_probe_exit
                        && routes.iter().any(|r| r.expected_country.is_some())
                    {
                        let mut probe_cache: std::collections::BTreeMap<
                            String,
                            Result<String, String>,
                        > = std::collections::BTreeMap::new();
                        for route in &routes {
                            if route.expected_country.is_none() {
                                continue;
                            }
                            let key = route.effective_proxy.trim().to_string();
                            if !probe_cache.contains_key(&key) {
                                let res = super::network::probe(&key)
                                    .await
                                    .map(|e| e.country);
                                probe_cache.insert(key, res);
                            }
                        }

                        let mut immediate_drift: Option<(String, String)> = None;
                        let mut recheck_slots: Vec<String> = Vec::new();
                        for route in &routes {
                            let Some(ref exp_country) = route.expected_country else {
                                continue;
                            };
                            let key = route.effective_proxy.trim();
                            let Some(res) = probe_cache.get(key) else {
                                continue;
                            };
                            let res_ref = res.as_deref().map_err(|e| e.as_str());
                            match tracker.on_slot_exit_probe(
                                &route.slot,
                                Some(exp_country.as_str()),
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
                                ExitProbeAction::Healthy
                                | ExitProbeAction::IgnoredTransientError => {}
                            }
                        }

                        if let Some((exp, obs)) = immediate_drift {
                            let trig_app = app.clone();
                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                trigger_kill_switch(
                                    &trig_app,
                                    "country_drift",
                                    Some(exp),
                                    Some(obs),
                                );
                            })
                            .await;
                            tracker.reset();
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
                                Result<String, String>,
                            > = std::collections::BTreeMap::new();
                            let mut confirmed_drift: Option<(String, String)> = None;
                            for slot_name in &recheck_slots {
                                let Some(route2) =
                                    routes2.iter().find(|r| &r.slot == slot_name)
                                else {
                                    continue;
                                };
                                let Some(ref exp_country) = route2.expected_country else {
                                    continue;
                                };
                                let key = route2.effective_proxy.trim().to_string();
                                if !reprobe_cache.contains_key(&key) {
                                    let res = super::network::probe(&key)
                                        .await
                                        .map(|e| e.country);
                                    reprobe_cache.insert(key.clone(), res);
                                }
                                let res_ref = reprobe_cache[&key]
                                    .as_deref()
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
                                let trig_app = app.clone();
                                let _ = tauri::async_runtime::spawn_blocking(move || {
                                    trigger_kill_switch(
                                        &trig_app,
                                        "country_drift",
                                        Some(exp),
                                        Some(obs),
                                    );
                                })
                                .await;
                                tracker.reset();
                                continue;
                            }
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

#[tauri::command]
pub fn browser_kill_switch_dismiss(app: tauri::AppHandle) -> KillSwitchState {
    clear_alert(&app);
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
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;

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

        // No browser running -> zero action, baseline stays false.
        assert_eq!(
            tracker.on_local_tick(true, false, "", false, false),
            LocalCheckAction::Healthy {
                should_probe_exit: false
            }
        );
        assert!(!tracker.tun_baseline_active);

        // Browser running with TUN initially off -> does not false-trigger without prior TUN baseline.
        assert_eq!(
            tracker.on_local_tick(true, true, "", false, false),
            LocalCheckAction::Healthy {
                should_probe_exit: false
            }
        );

        // TUN observed active -> establishes baseline.
        assert_eq!(
            tracker.on_local_tick(true, true, "", true, false),
            LocalCheckAction::Healthy {
                should_probe_exit: true
            }
        );
        assert!(tracker.tun_baseline_active);

        // First TUN drop -> requests 3s recheck, does not trigger immediately.
        assert_eq!(
            tracker.on_local_tick(true, true, "", false, true),
            LocalCheckAction::RecheckTunAfterDelay
        );
        assert_eq!(tracker.tun_drop_streak, 1);

        // Transient recovery on 3s recheck -> resets streak, no trigger.
        assert_eq!(
            tracker.on_tun_recheck(true, true, "", true),
            LocalCheckAction::Healthy {
                should_probe_exit: false
            }
        );
        assert_eq!(tracker.tun_drop_streak, 0);

        // Another TUN drop followed by confirmed drop on recheck -> triggers Kill-Switch.
        assert_eq!(
            tracker.on_local_tick(true, true, "", false, true),
            LocalCheckAction::RecheckTunAfterDelay
        );
        assert_eq!(
            tracker.on_tun_recheck(true, true, "", false),
            LocalCheckAction::TriggerTunDropped
        );
    }

    #[test]
    fn explicit_proxy_bypasses_tun_drop_and_429_or_timeouts_never_trigger_drift() {
        let mut tracker = MonitorTracker::default();

        // Explicit SOCKS5/HTTP proxy does not rely on TUN adapter.
        assert_eq!(
            tracker.on_local_tick(true, true, "socks5://127.0.0.1:7899", true, false),
            LocalCheckAction::Healthy {
                should_probe_exit: false
            }
        );
        assert!(!tracker.tun_baseline_active);
        assert_eq!(
            tracker.on_local_tick(true, true, "socks5://127.0.0.1:7899", false, false),
            LocalCheckAction::Healthy {
                should_probe_exit: true
            }
        );

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
    fn multi_slot_routes_enable_tun_guard_when_any_running_slot_lacks_proxy() {
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

        // Even though slot_a and legacy have explicit proxies, slot_b has an empty proxy so TUN monitoring stays active!
        assert_eq!(aggregate_tun_proxy(&routes), "");
        assert_eq!(tun_alert_expected_country(&routes).as_deref(), Some("JP"));

        let mut tracker = MonitorTracker::default();
        assert_eq!(
            tracker.on_local_tick(true, true, aggregate_tun_proxy(&routes), true, false),
            LocalCheckAction::Healthy {
                should_probe_exit: false
            }
        );
        assert!(tracker.tun_baseline_active);
        assert_eq!(
            tracker.on_local_tick(true, true, aggregate_tun_proxy(&routes), false, false),
            LocalCheckAction::RecheckTunAfterDelay
        );
        assert_eq!(
            tracker.on_tun_recheck(true, true, aggregate_tun_proxy(&routes), false),
            LocalCheckAction::TriggerTunDropped
        );
    }
}
