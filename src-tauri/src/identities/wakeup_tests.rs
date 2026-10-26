// [INPUT]: Synthetic summaries, fixed clock values, fake collector outcomes and private temporary files.
// [OUTPUT]: Disabled local readiness, scheduler scope, durable admission, preparation failure and recovery regressions.
// [POS]: No live identity, Python process, HTTP request or system mutation.
use super::*;
fn item() -> Candidate {
    Candidate {
        account_id: "current".into(),
        identity: "a".repeat(64),
        reset: Some(100),
        inferred: true,
        trusted_observed_at_ms: None,
        used: 0,
        weekly: Some(30),
        running: false,
        capability: "http_connect".into(),
    }
}
fn enabled() -> Snapshot {
    let mut s = Snapshot::default();
    s.migrated = true;
    s.config.enabled = true;
    s.config.use_time_window = false;
    s.targets = vec!["a".repeat(64)];
    s
}

#[test]
fn one_owner_journals_before_transport_and_shares_manual_auto_budget() {
    let dir = std::env::temp_dir().join(format!(
        "claude-local-wakeup-owner-{}",
        super::super::new_id().unwrap()
    ));
    super::super::private::directory(&dir).unwrap();
    let owner = WakeupOwner {
        path: dir.join("scheduler.json"),
        inner: Arc::new((
            Mutex::new(Inner {
                snapshot: enabled(),
                active: false,
                stopped: false,
                writable: true,
            }),
            Condvar::new(),
        )),
    };
    let c = item();
    let mut fake_transport_calls = 0;
    owner
        .prepare_dispatch(&c, &[c.clone()], false, c.reset, 200_000, 0, 0)
        .unwrap();
    // The fake transport sees a durable running/unknown journal before dispatch.
    assert!(read_disk(&owner.path).unwrap().accounts[&c.identity].unknown);
    fake_transport_calls += 1;
    assert!(owner
        .prepare_dispatch(&c, &[c.clone()], false, c.reset, 200_001, 0, 0)
        .is_err());
    {
        let mut guard = owner.inner.0.lock().unwrap();
        guard.active = false;
        finish(
            &mut guard.snapshot,
            &c.identity,
            c.reset,
            200_002,
            &result(serde_json::json!({"status":"rate_limited","retry_at_ms":4_000_000})),
        );
        owner.save_locked(&mut guard).unwrap();
        let a = guard.snapshot.accounts.get_mut(&c.identity).unwrap();
        a.scheduled_at_ms = Some(200_000);
        a.scheduled_for_reset_sec = c.reset;
    }
    assert!(owner
        .prepare_dispatch(&c, &[c.clone()], true, c.reset, 300_000, 0, 7)
        .is_err());
    assert_eq!(fake_transport_calls, 1);
    owner.stop();
    assert!(owner
        .prepare_dispatch(&c, &[c.clone()], false, c.reset, 5_000_000, 0, 7)
        .is_err());
    drop(owner);
    std::fs::remove_file(dir.join("scheduler.json")).unwrap();
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn storage_failure_and_disabled_schedule_never_dispatch() {
    let dir = std::env::temp_dir().join(format!(
        "claude-local-wakeup-denied-{}",
        super::super::new_id().unwrap()
    ));
    let owner = WakeupOwner {
        path: dir.join("missing-parent/scheduler.json"),
        inner: Arc::new((
            Mutex::new(Inner {
                snapshot: enabled(),
                active: false,
                stopped: false,
                writable: true,
            }),
            Condvar::new(),
        )),
    };
    let c = item();
    assert!(owner
        .prepare_dispatch(&c, &[c.clone()], false, c.reset, 200_000, 0, 0)
        .is_err());
    let guard = owner.inner.0.lock().unwrap();
    assert!(!guard.active);
    assert!(!guard.writable);
    assert_eq!(guard.snapshot.status, "storage_error");
    drop(guard);
    let mut s = enabled();
    s.config.enabled = false;
    let owner = WakeupOwner {
        path: dir.join("scheduler.json"),
        inner: Arc::new((
            Mutex::new(Inner {
                snapshot: s,
                active: false,
                stopped: false,
                writable: true,
            }),
            Condvar::new(),
        )),
    };
    assert!(owner
        .prepare_dispatch(&c, &[c.clone()], true, c.reset, 200_000, 0, 0)
        .is_err());
    assert!(!owner.path.exists());
}
#[test]
fn disabled_owner_refreshes_local_readiness_without_authorizing_dispatch() {
    let mut state = Snapshot::default();
    let mut c = item();
    assert!(plan(&mut state, &[c.clone()], Some(80), 200_000, 0, 0).is_none());
    assert_eq!(state.status, "disabled");
    assert_eq!(state.accounts[&c.identity].capability, "http_connect");
    assert_eq!(state.accounts[&c.identity].decision, "scheduled");
    assert_eq!(state.accounts[&c.identity].scheduled_at_ms, None);
    assert_eq!(state.accounts[&c.identity].last_attempt_at_ms, None);
    assert!(state.targets.is_empty()); // Local discovery never opts in a scope.
    c.capability = "auth_required".into();
    plan(&mut state, &[c.clone()], Some(80), 200_001, 0, 0);
    assert_eq!(state.accounts[&c.identity].decision, "auth_blocked");
    grant_recovery(state.accounts.get_mut(&c.identity).unwrap()).unwrap();
    plan(&mut state, &[c.clone()], Some(80), 200_002, 0, 0);
    assert!(state.accounts[&c.identity].recovery_allowed);
    assert_eq!(state.accounts[&c.identity].decision, "scheduled");
    assert!(dispatch_blocker(&state, &c, &[c.clone()], true, c.reset, 200_002, 0).is_some());
    assert!(state.accounts[&c.identity].recovery_allowed);
    assert_eq!(state.next_global_at_ms, 0);
}

#[test]
fn local_resynchronization_keeps_auth_history_and_other_account_guards() {
    let mut state = Snapshot::default();
    let c = item();
    let mut other = c.clone();
    other.identity = "b".repeat(64);
    let blocked = Account {
        auth_blocked: true,
        last_status: Some("auth_required".into()),
        backoff_until_ms: Some(9_000_000),
        ..Account::default()
    };
    state.accounts.insert(c.identity.clone(), blocked.clone());
    state.accounts.insert(
        other.identity.clone(),
        Account {
            auth_blocked: true,
            last_status: Some("rate_limited".into()),
            backoff_until_ms: Some(8_000_000),
            ..Account::default()
        },
    );
    state.next_global_at_ms = 7_000_000;
    plan(&mut state, &[c.clone(), other.clone()], None, 200_000, 0, 0);
    assert_eq!(state.accounts[&c.identity].last_status, blocked.last_status);
    assert_eq!(
        state.accounts[&c.identity].backoff_until_ms,
        blocked.backoff_until_ms
    );
    grant_recovery(state.accounts.get_mut(&c.identity).unwrap()).unwrap();
    assert_eq!(state.accounts[&c.identity].backoff_until_ms, None);
    assert!(!state.accounts[&other.identity].recovery_allowed);
    assert_eq!(
        state.accounts[&other.identity].backoff_until_ms,
        Some(8_000_000)
    );
    assert_eq!(state.next_global_at_ms, 7_000_000);
}

#[test]
fn preparation_evidence_does_not_confuse_auth_validation_or_uncertain_transport() {
    let probe = result(serde_json::json!({"status":"unavailable","runtime_stage":"probe","runtime_reason":"missing_dependency"})).unwrap();
    assert!(local_preparation_failed(&probe));
    let denied = result(serde_json::json!({"status":"auth_required","stage":"profile"})).unwrap();
    assert!(!local_preparation_failed(&denied));
    let ambiguous = result(
        serde_json::json!({"status":"unavailable","runtime_stage":"execute","runtime_reason":"timeout"}),
    );
    assert!(!local_preparation_failed(ambiguous.as_ref().unwrap()));
    let mut state = enabled();
    let c = item();
    finish(&mut state, &c.identity, c.reset, 200_000, &ambiguous);
    assert!(state.accounts[&c.identity].unknown);
    assert!(grant_recovery(state.accounts.get_mut(&c.identity).unwrap()).is_err());
}
fn result(value: serde_json::Value) -> Result<OnlineQuotaResult, String> {
    Ok(serde_json::from_value(value).unwrap())
}

#[test]
fn manual_admission_reports_the_gate_and_shared_retry_without_dispatch() {
    let mut s = enabled();
    let mut c = item();
    let mut a = Account::default();
    a.auth_blocked = true;
    a.backoff_until_ms = Some(700_000);
    s.next_global_at_ms = 800_000;
    s.accounts.insert(c.identity.clone(), a);
    let blocked = dispatch_blocker(&s, &c, &[c.clone()], false, c.reset, 200_000, 0).unwrap();
    assert_eq!(blocked.status, OnlineStatus::AuthRequired);
    assert_eq!(blocked.stage.as_deref(), Some("scheduler"));
    assert_eq!(blocked.reason.as_deref(), Some("auth_required"));
    assert_eq!(blocked.retry_at_ms, Some(800_000));
    assert_eq!(blocked.wakeup_effect, None); // No POST was attempted.
    s.accounts.get_mut(&c.identity).unwrap().recovery_allowed = true;
    c.capability = "auth_required".into();
    let waiting = dispatch_blocker(&s, &c, &[c.clone()], false, c.reset, 200_000, 0).unwrap();
    assert_eq!(waiting.status, OnlineStatus::Cooldown);
    assert_eq!(waiting.reason.as_deref(), Some("backoff_cooldown"));
    assert_eq!(waiting.retry_at_ms, Some(800_000));
    assert!(dispatch_blocker(&s, &c, &[c.clone()], false, c.reset, 800_000, 0).is_none());
    s.accounts.get_mut(&c.identity).unwrap().unknown = true;
    let unknown = dispatch_blocker(&s, &c, &[c.clone()], false, c.reset, 900_000, 0).unwrap();
    assert_eq!(unknown.reason.as_deref(), Some("outcome_unknown"));
    assert_eq!(unknown.wakeup_effect, None);
    c.running = true;
    assert_eq!(dispatch_blocker(&s, &c, &[c.clone()], false, c.reset, 900_000, 0).unwrap().reason.as_deref(), Some("cli_active"));
}

#[test]
fn plan_is_stable_across_ticks_and_page_unmount_has_no_input() {
    let mut s = enabled();
    let c = item();
    assert!(plan(&mut s, &[c.clone()], Some(80), 200_000, 0, 123).is_none());
    let at = s.accounts[&c.identity].scheduled_at_ms.unwrap();
    assert!(plan(&mut s, &[c.clone()], Some(80), 210_000, 0, 400_000).is_none());
    assert_eq!(s.accounts[&c.identity].scheduled_at_ms, Some(at));
    // There is no page/visibility/mount input; one plan remains ready once.
    assert!(plan(&mut s, &[c], Some(80), at, 0, 7).is_some());
    s.config.enabled = false;
    assert!(plan(&mut s, &[item()], Some(80), at + 1, 0, 7).is_none());
}
#[test]
fn time_windows_include_cross_midnight() {
    let mut c = Config::default();
    c.start_minute = 1260;
    c.end_minute = 120;
    assert!(c.within(1300));
    assert!(c.within(119));
    assert!(!c.within(120));
    assert!(!c.within(900));
    c.start_minute = 120;
    assert!(c.within(900));
}
#[test]
fn scope_change_pauses_but_current_slot_change_keeps_authorization() {
    let mut s = enabled();
    let mut c = item();
    c.account_id = "b".repeat(32);
    plan(&mut s, &[c.clone()], Some(80), 200_000, 0, 0);
    assert_eq!(s.status, "waiting");
    c.identity = "b".repeat(64);
    assert!(plan(&mut s, &[c], Some(80), 400_000, 0, 0).is_none());
    assert_eq!(s.status, "scope_changed");
}
#[test]
fn running_cli_weekly_gate_exclusion_and_unsupported_transport_hold() {
    let mut s = enabled();
    let mut c = item();
    c.running = true;
    plan(&mut s, &[c.clone()], Some(30), 200_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "cli_active");
    c.running = false;
    c.weekly = Some(95);
    plan(&mut s, &[c.clone()], Some(30), 200_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "low_7d_quota");
    c.weekly = Some(20);
    c.capability = "transport_unsupported".into();
    plan(&mut s, &[c.clone()], Some(30), 200_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "capability_blocked");
    s.config.excluded_identities = vec![c.identity.clone()];
    plan(&mut s, &[c.clone()], Some(30), 200_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "disabled_by_user");
}
#[test]
fn idle_settlement_is_once_and_waits_for_main_account() {
    let mut s = enabled();
    let c = item();
    let mut a = Account::default();
    a.unused_streak = 1;
    a.woken_window_reset_sec = c.reset;
    s.accounts.insert(c.identity.clone(), a);
    assert!(plan(&mut s, &[c.clone()], Some(80), 200_000, 0, 0).is_none());
    assert_eq!(s.accounts[&c.identity].unused_streak, 2);
    assert_eq!(s.accounts[&c.identity].decision, "standby_idle");
    plan(&mut s, &[c.clone()], Some(30), 200_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].scheduled_at_ms, Some(290_000));
    plan(&mut s, &[c.clone()], Some(30), 205_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].unused_streak, 2);
}
#[test]
fn auth_stays_blocked_until_explicit_one_attempt_recovery() {
    let mut s = enabled();
    let mut c = item();
    finish(
        &mut s,
        &c.identity,
        c.reset,
        200_000,
        &result(serde_json::json!({"status":"auth_required"})),
    );
    plan(&mut s, &[c.clone()], Some(30), 500_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "auth_blocked");
    s.config.enabled = false;
    s.config.enabled = true;
    plan(&mut s, &[c.clone()], Some(30), 500_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "auth_blocked");
    grant_recovery(s.accounts.get_mut(&c.identity).unwrap()).unwrap();
    assert_eq!(s.accounts[&c.identity].backoff_until_ms, None);
    c.capability = "auth_required".into(); // stale local expiry is not a network verdict
    plan(&mut s, &[c.clone()], Some(30), 500_000, 0, 0);
    assert_eq!(s.accounts[&c.identity].decision, "scheduled");
    // Failed controlled recovery consumes its one-attempt grant and blocks again.
    let a = s.accounts.get_mut(&c.identity).unwrap();
    a.recovery_allowed = false;
    finish(
        &mut s,
        &c.identity,
        c.reset,
        510_000,
        &result(serde_json::json!({"status":"auth_required"})),
    );
    assert!(s.accounts[&c.identity].auth_blocked);
    assert!(!s.accounts[&c.identity].recovery_allowed);

    // Recovery cannot erase an ambiguous/429 delay or the shared dispatch gap.
    s.next_global_at_ms = 4_000_000;
    let a = s.accounts.get_mut(&c.identity).unwrap();
    a.last_status = Some("rate_limited".into());
    a.backoff_until_ms = Some(4_000_000);
    grant_recovery(a).unwrap();
    assert_eq!(a.backoff_until_ms, Some(4_000_000));
    assert_eq!(s.next_global_at_ms, 4_000_000);
    let a = s.accounts.get_mut(&c.identity).unwrap();
    a.recovery_allowed = false;
    a.unknown = true;
    assert_eq!(grant_recovery(a).unwrap_err(), "wakeup.outcomeUnknown");
    assert!(!a.recovery_allowed);
}

#[test]
fn route_projection_rejects_unsupported_protocol_auth_and_url_parts() {
    assert_eq!(
        route_capability("http://127.0.0.1:8080", false),
        "http_connect"
    );
    assert_eq!(route_capability("127.0.0.1:8080", true), "http_connect");
    for proxy in [
        "https://127.0.0.1:8080",
        "socks5://127.0.0.1:8080",
        "http://user:pass@localhost:8080",
        "http://localhost:0",
        "http://localhost/path",
        "http://localhost/?route=1",
    ] {
        assert_eq!(route_capability(proxy, false), "transport_unsupported");
    }
}
#[test]
fn unknown_outcome_never_automatically_replays_and_rate_limit_sets_global_budget() {
    let mut s = enabled();
    let c = item();
    finish(
        &mut s,
        &c.identity,
        c.reset,
        200_000,
        &Err("fake interrupted transport".into()),
    );
    assert!(plan(&mut s, &[c.clone()], Some(30), 9_000_000, 0, 0).is_none());
    assert_eq!(s.accounts[&c.identity].decision, "outcome_unknown");
    s.accounts.clear();
    finish(
        &mut s,
        &c.identity,
        c.reset,
        200_000,
        &result(serde_json::json!({"status":"rate_limited","retry_at_ms":4_000_000})),
    );
    assert_eq!(s.next_global_at_ms, 4_000_000);
    assert_eq!(s.accounts[&c.identity].backoff_until_ms, Some(4_000_000));
}

#[test]
fn unknown_requires_a_fresh_trusted_future_window_even_when_disabled() {
    let mut s = enabled();
    let mut c = item();
    let mut a = Account::default();
    a.unknown = true;
    a.auth_blocked = true;
    a.last_attempt_at_ms = Some(200_000);
    a.scheduled_for_reset_sec = Some(100);
    a.last_status = Some("outcome_unknown".into());
    s.accounts.insert(c.identity.clone(), a);
    c.reset = Some(19_000);
    c.inferred = false;
    // A future local estimate and an old server observation both keep the guard.
    plan(&mut s, &[c.clone()], Some(30), 210_000, 0, 0);
    assert!(s.accounts[&c.identity].unknown);
    assert_eq!(s.accounts[&c.identity].scheduled_for_reset_sec, Some(100));
    c.trusted_observed_at_ms = Some(199_999);
    plan(&mut s, &[c.clone()], Some(30), 210_000, 0, 0);
    assert!(s.accounts[&c.identity].unknown);
    c.trusted_observed_at_ms = Some(200_001);
    s.config.enabled = false;
    assert!(plan(&mut s, &[c.clone()], Some(30), 210_000, 0, 0).is_none());
    let a = &s.accounts[&c.identity];
    assert!(!a.unknown);
    assert_eq!(a.last_woken_for_reset_sec, Some(100));
    assert_eq!(a.woken_window_reset_sec, Some(19_000));
    assert!(a.auth_blocked); // Ordinary server GET/passive evidence cannot authorize messages.
}
#[test]
fn confirmed_window_is_idempotent_and_seven_day_only_is_not_confirmation() {
    let mut s = enabled();
    let c = item();
    finish(
        &mut s,
        &c.identity,
        c.reset,
        200_000,
        &result(
            serde_json::json!({"status":"updated","updated_windows":["7d"],"wakeup_effect":"quota_observed"}),
        ),
    );
    assert_eq!(s.accounts[&c.identity].last_woken_for_reset_sec, None);
    finish(
        &mut s,
        &c.identity,
        c.reset,
        200_000,
        &result(
            serde_json::json!({"status":"updated","updated_windows":["5h"],"wakeup_effect":"new_5h_confirmed","wakeup_5h_reset_at":19000}),
        ),
    );
    assert_eq!(s.accounts[&c.identity].last_woken_for_reset_sec, c.reset);
    assert!(plan(&mut s, &[c.clone()], Some(30), 300_000, 0, 0).is_none());
    assert_eq!(s.accounts[&c.identity].decision, "already_woken");
}
#[test]
fn durable_dispatch_recovers_unknown_and_corruption_never_enables_defaults() {
    let dir = std::env::temp_dir().join(format!(
        "claude-local-wakeup-{}",
        super::super::new_id().unwrap()
    ));
    super::super::private::directory(&dir).unwrap();
    let path = dir.join("scheduler.json");
    let mut s = enabled();
    let mut a = Account::default();
    a.decision = "running".into();
    a.unknown = true;
    a.last_attempt_at_ms = Some(200_000);
    s.accounts.insert("a".repeat(64), a);
    persist(&path, &s).unwrap();
    let restarted = read_disk(&path).unwrap();
    assert!(restarted.accounts[&"a".repeat(64)].unknown);
    assert_eq!(
        restarted.accounts[&"a".repeat(64)].last_status.as_deref(),
        Some("outcome_unknown")
    );
    super::super::private::write(&path, br#"{"schema":1,"enabled":true}"#).unwrap();
    assert!(read_disk(&path).is_err());
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
#[test]
fn schema_rejects_invalid_scope_config_and_unbounded_migration() {
    let mut s = enabled();
    assert!(s.valid());
    s.config.start_minute = 1500;
    assert!(!s.valid());
    s.config.start_minute = 480;
    s.targets = vec!["not-an-identity".into()];
    assert!(!s.valid());
    assert!(serde_json::from_value::<Migration>(serde_json::json!({"schema":1,"config":Config::default(),"state":{"lastGlobalWakeupAtMs":0,"accounts":{}},"url":"https://invalid.example"})).is_err());
}
