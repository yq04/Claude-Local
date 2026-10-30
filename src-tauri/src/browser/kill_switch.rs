// [INPUT]: 受管伴侣浏览器资料目录状态、本机 TUN/DNS 快照、当前槽位有效代理/预期国家及用户解警/开关动作。
// [OUTPUT]: 按需激活的伴侣浏览器断线保护（Kill-Switch）、全槽位浏览器关闭、红色告警托盘图标与零后续阻断恢复。
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
    *state.quota_sync.lock().unwrap() = None;
    super::renew_session(app);
    closed
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MonitorTracker {
    pub tun_baseline_active: bool,
    pub tun_drop_streak: u32,
    pub country_drift_streak: u32,
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

    pub fn on_exit_probe(
        &mut self,
        expected_country: Option<&str>,
        probe_result: Result<&str, &str>,
        is_recheck: bool,
    ) -> ExitProbeAction {
        let Some(expected) = expected_country.map(str::trim).filter(|s| !s.is_empty()) else {
            self.country_drift_streak = 0;
            return ExitProbeAction::Healthy;
        };
        match probe_result {
            Err(_) => {
                if is_recheck {
                    self.country_drift_streak = 0;
                }
                ExitProbeAction::IgnoredTransientError
            }
            Ok(observed) => {
                let obs = observed.trim().to_ascii_uppercase();
                let exp = expected.to_ascii_uppercase();
                if !obs.is_empty() && obs != exp {
                    self.country_drift_streak = self.country_drift_streak.saturating_add(1);
                    if self.country_drift_streak >= 2 {
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
                    self.country_drift_streak = 0;
                    ExitProbeAction::Healthy
                }
            }
        }
    }
}

fn resolve_expected_country(
    app: &tauri::AppHandle,
    fallback: Option<String>,
) -> Option<String> {
    let registered = (|| -> Option<String> {
        let root = super::root(app).ok()?;
        let slot = super::workspaces::selected_slot_readonly(&root).ok()?;
        let vault = root.parent()?.join("identity-vault");
        let cards = crate::identities::warming::read_cards(&vault).ok()?;
        let db_path = vault.join("identities.sqlite");
        crate::identities::private::safe(&db_path).ok()?;
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
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
            if card_slot.as_deref() == Some(slot.as_str()) && card.registered_country.is_some() {
                return card.registered_country;
            }
        }
        None
    })();
    registered.or(fallback)
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

            let check_app = app.clone();
            let has_running = tauri::async_runtime::spawn_blocking(move || {
                super::root(&check_app)
                    .map(|r| !running_managed_profiles(&r).is_empty())
                    .unwrap_or(false)
            })
            .await
            .unwrap_or(false);

            if !has_running {
                tracker.reset();
                continue;
            }

            let snap_app = app.clone();
            let Some((tun_active, secondary_dns, ctx, expected_country)) =
                tauri::async_runtime::spawn_blocking(move || {
                    let (tun_active, secondary_dns) =
                        crate::risk_check::system_tun_and_dns_status();
                    let ctx = super::current_risk_browser_context(&snap_app);
                    let expected =
                        resolve_expected_country(&snap_app, ctx.target_country.clone());
                    (tun_active, secondary_dns, ctx, expected)
                })
                .await
                .ok()
            else {
                continue;
            };

            let local_action = tracker.on_local_tick(
                enabled,
                true,
                &ctx.effective_proxy,
                tun_active,
                secondary_dns,
            );

            match local_action {
                LocalCheckAction::TriggerTunDropped => {
                    let trig_app = app.clone();
                    let exp = expected_country.clone();
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
                    let Some((still_enabled, still_running, tun2, ctx2)) =
                        tauri::async_runtime::spawn_blocking(move || {
                            let en = re_app
                                .try_state::<super::Browser>()
                                .map(|s| s.kill_switch.lock().unwrap().enabled)
                                .unwrap_or(false);
                            let run = super::root(&re_app)
                                .map(|r| !running_managed_profiles(&r).is_empty())
                                .unwrap_or(false);
                            if !en || !run {
                                return (en, run, false, super::RiskBrowserContext::default());
                            }
                            let (tun2, _) = crate::risk_check::system_tun_and_dns_status();
                            let ctx2 = super::current_risk_browser_context(&re_app);
                            (en, run, tun2, ctx2)
                        })
                        .await
                        .ok()
                    else {
                        continue;
                    };
                    if tracker.on_tun_recheck(
                        still_enabled,
                        still_running,
                        &ctx2.effective_proxy,
                        tun2,
                    ) == LocalCheckAction::TriggerTunDropped
                    {
                        let trig_app = app.clone();
                        let exp = expected_country.clone();
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            trigger_kill_switch(&trig_app, "tun_dropped", exp, None);
                        })
                        .await;
                        tracker.reset();
                        continue;
                    }
                }
                LocalCheckAction::Healthy { should_probe_exit } => {
                    if should_probe_exit && expected_country.is_some() {
                        let first_probe =
                            super::network::probe(&ctx.effective_proxy).await;
                        let first_res = first_probe
                            .as_ref()
                            .map(|e| e.country.as_str())
                            .map_err(|e| e.as_str());
                        match tracker.on_exit_probe(
                            expected_country.as_deref(),
                            first_res,
                            false,
                        ) {
                            ExitProbeAction::RecheckExitAfterDelay { .. } => {
                                tokio::time::sleep(Duration::from_secs(3)).await;
                                let re_app = app.clone();
                                let still_active =
                                    tauri::async_runtime::spawn_blocking(move || {
                                        let en = re_app
                                            .try_state::<super::Browser>()
                                            .map(|s| s.kill_switch.lock().unwrap().enabled)
                                            .unwrap_or(false);
                                        let run = super::root(&re_app)
                                            .map(|r| !running_managed_profiles(&r).is_empty())
                                            .unwrap_or(false);
                                        en && run
                                    })
                                    .await
                                    .unwrap_or(false);
                                if !still_active {
                                    tracker.reset();
                                    continue;
                                }
                                let second_probe =
                                    super::network::probe(&ctx.effective_proxy).await;
                                let second_res = second_probe
                                    .as_ref()
                                    .map(|e| e.country.as_str())
                                    .map_err(|e| e.as_str());
                                if let ExitProbeAction::TriggerCountryDrift {
                                    expected_country: exp,
                                    observed_country: obs,
                                } = tracker.on_exit_probe(
                                    expected_country.as_deref(),
                                    second_res,
                                    true,
                                ) {
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
                            ExitProbeAction::TriggerCountryDrift {
                                expected_country: exp,
                                observed_country: obs,
                            } => {
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
                            ExitProbeAction::Healthy | ExitProbeAction::IgnoredTransientError => {}
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
}
