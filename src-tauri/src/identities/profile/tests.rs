// [INPUT]: 内存合成 .claude.json、.credentials.json 与模拟 quota_ledger.json。
// [OUTPUT]: 单次解析投影、新鲜双窗跳过、账本账号隔离、OAuth 与订阅到期隔离、ISO/delta 标定与套餐降级清零单元测试回归。
// [POS]: identities/profile 单元测试子模块；不访问真实用户目录或网络。
// [PROTOCOL]: 变更时更新此头部，然后检查 profile/CLAUDE.md
use super::*;
#[test]
fn fresh_ledger_anchors_for_both_windows_skip_project_scan_only_when_current() {
    let now_ms = 1_800_000_000_000u64;
    let now_sec = now_ms / 1000;
    let anchors = |five_ms: u64, seven_ms: u64, five_reset: u64, account: &str| {
        serde_json::json!({
            "oauthAccount": {"accountUuid": "u1"},
            "cachedUsageUtilization": {"accountUuid": account, "utilization": {
                "five_hour": {"utilization": 20, "resets_at": five_reset, "fetchedAtMs": five_ms},
                "seven_day": {"utilization": 30, "resets_at": now_sec + 86_400, "fetchedAtMs": seven_ms}
            }}
        })
    };
    let fresh = now_ms - 30_000;
    assert!(fresh_server_anchors_cover_both_windows(
        &anchors(fresh, fresh, now_sec + 3_600, "u1"),
        now_ms
    ));
    // A stale 7d observation keeps the local scan.
    assert!(!fresh_server_anchors_cover_both_windows(
        &anchors(fresh, now_ms - FRESH_ANCHOR_SKIP_MS - 1, now_sec + 3_600, "u1"),
        now_ms
    ));
    // An elapsed 5h reset is not a current anchor.
    assert!(!fresh_server_anchors_cover_both_windows(
        &anchors(fresh, fresh, now_sec - 1, "u1"),
        now_ms
    ));
    // Another account's cache never proves freshness.
    assert!(!fresh_server_anchors_cover_both_windows(
        &anchors(fresh, fresh, now_sec + 3_600, "u2"),
        now_ms
    ));
    // Implausible future observations are rejected.
    assert!(!fresh_server_anchors_cover_both_windows(
        &anchors(now_ms + 60_000, fresh, now_sec + 3_600, "u1"),
        now_ms
    ));
    // Missing 7d window keeps the scan.
    let mut only_5h = anchors(fresh, fresh, now_sec + 3_600, "u1");
    only_5h["cachedUsageUtilization"]["utilization"]
        .as_object_mut()
        .unwrap()
        .remove("seven_day");
    assert!(!fresh_server_anchors_cover_both_windows(&only_5h, now_ms));
}
#[test]
fn single_parse_live_read_keeps_display_billing_and_api_key_projection() {
    let home = std::env::temp_dir().join(format!(
        "claude-local-profile-single-parse-{}-{}",
        std::process::id(),
        now_epoch_sec()
    ));
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    std::fs::write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"accountUuid":"fixture-user","emailAddress":"single@example.invalid","displayName":"Single","organizationName":"Team","billingType":"stripe_subscription"},"primaryApiKey":"private"}"#,
    )
    .unwrap();
    let current = read(&home);
    assert!(current.present);
    assert!(!current.unavailable);
    assert_eq!(current.display_name.as_deref(), Some("Single"));
    assert_eq!(current.email.as_deref(), Some("single@example.invalid"));
    assert_eq!(current.organization.as_deref(), Some("Team"));
    assert_eq!(current.auth_status.as_deref(), Some("api_key"));
    assert!(current.quota_identity.is_some());
    assert!(!serde_json::to_string(&current).unwrap().contains("private"));
    // Malformed JSON stays unavailable (single parse failure path).
    std::fs::write(home.join(".claude.json"), b"{not json").unwrap();
    let broken = read(&home);
    assert!(broken.unavailable);
    let _ = std::fs::remove_dir_all(&home);
}
#[test]
fn latest_server_anchor_is_account_bound_and_only_merged_in_memory() {
    let official = serde_json::json!({
        "oauthAccount": {"accountUuid": "u1", "emailAddress": "Fixture@Example.invalid"},
        "cachedUsageUtilization": {"accountUuid": "u1", "fetchedAtMs": 100,
            "utilization": {"five_hour": {"utilization": 10}}}
    });
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "server_anchor": {"accountUuid": "u1", "fetchedAtMs": 200,
            "utilization": {"five_hour": {"utilization": 40}}}
    }}});
    let mut effective = official.clone();
    merge_server_anchor(&mut effective, &ledger);
    assert_eq!(
        effective["cachedUsageUtilization"]["utilization"]["five_hour"]["utilization"],
        40
    );
    assert_eq!(official["cachedUsageUtilization"]["fetchedAtMs"], 100);
    let mut foreign = ledger.clone();
    foreign["accounts"]["fixture@example.invalid"]["server_anchor"]["accountUuid"] =
        serde_json::json!("u2");
    let mut unchanged = official.clone();
    merge_server_anchor(&mut unchanged, &foreign);
    assert_eq!(unchanged, official);
    let mut older = ledger.clone();
    older["accounts"]["fixture@example.invalid"]["server_anchor"]["fetchedAtMs"] =
        serde_json::json!(99);
    merge_server_anchor(&mut unchanged, &older);
    assert_eq!(unchanged, official);
    let mut missing_uuid = ledger;
    missing_uuid["accounts"]["fixture@example.invalid"]["server_anchor"]
        .as_object_mut()
        .unwrap()
        .remove("accountUuid");
    merge_server_anchor(&mut unchanged, &missing_uuid);
    assert_eq!(unchanged, official);
}
#[test]
fn only_explicit_display_fields_reach_the_card() {
    let current=parse(br#"{"oauthAccount":{"displayName":" Person ","emailAddress":"fixture@example.invalid","organizationName":"Team","accessToken":"private"},"primaryApiKey":"private"}"#).unwrap();
    let output = serde_json::to_string(&current).unwrap();
    assert!(current.present);
    assert_eq!(current.display_name.as_deref(), Some("Person"));
    assert!(!output.contains("private"));
    assert!(!output.contains("Token"));
    assert!(parse(br#"{"primaryApiKey":"private"}"#).unwrap().present);
    assert!(!parse(b"{}").unwrap().present);
    assert!(!parse(br#"{"oauthAccount":null}"#).unwrap().present);
    assert!(display(Some("unsafe\nvalue".into()), 80).is_none());
    assert_eq!(
        format_plan(Some("max"), Some("default_claude_max_5x"), None).as_deref(),
        Some("Max 5x")
    );
    assert_eq!(
        sanitize_proxy("http://user:secret_pass@127.0.0.1:7897").as_deref(),
        Some("http://127.0.0.1:7897")
    );
}
#[test]
fn oauth_expiry_is_never_subscription_expiry_and_old_summaries_still_load() {
    let credentials = serde_json::json!({
        "claudeAiOauth": {
            "accessToken": "synthetic-access",
            "refreshToken": "synthetic-refresh",
            "expiresAt": 1_900_000_000_000i64
        }
    });
    let (_, _, _, oauth_expires_at, _) = extract_credentials_meta(&credentials);
    assert_eq!(oauth_expires_at, Some(1_900_000_000_000));

    let mut current = parse(br#"{"oauthAccount":{"displayName":"Fixture"}}"#).unwrap();
    current.auth_status = Some("valid".into());
    current.auth_expires_at = oauth_expires_at;
    current.auth_has_refresh = Some(true);
    assert_eq!(current.subscription_expires_at, None);
    let summary = Summary::from_current(&current);
    assert_eq!(summary.auth_expires_at, oauth_expires_at);
    assert_eq!(summary.auth_has_refresh, Some(true));
    assert_eq!(summary.subscription_expires_at, None);

    let legacy: Summary = serde_json::from_value(serde_json::json!({
        "auth_expires_at": 1_900_000_000_000i64
    }))
    .unwrap();
    assert_eq!(legacy.auth_expires_at, Some(1_900_000_000_000));
    assert_eq!(legacy.subscription_expires_at, None);
}
#[test]
fn iso_timestamp_and_delta_quota_calibration_are_accurate() {
    assert_eq!(
        parse_iso_epoch_sec("2026-10-17T06:59:59.697586+00:00"),
        Some(1792220399)
    );
    assert_eq!(
        parse_iso_epoch_sec("2026-10-17T02:59:59-04:00"),
        Some(1792220399)
    );
    let cj = serde_json::json!({
        "oauthAccount": {"accountUuid": "u1"},
        "cachedUsageUtilization": {
            "fetchedAtMs": 1792200000000u64,
            "accountUuid": "u1",
            "utilization": {
                "five_hour": {"utilization": 40, "resets_at": "2026-10-17T06:59:59Z"},
                "seven_day": {"utilization": 50, "resets_at": "2026-10-18T07:59:59Z"}
            }
        }
    });
    let before = extract_quota(&cj, None, Some("Pro"), 1792201000, 0);
    assert_eq!(before.used_5h, Some(40));
    assert_eq!(before.reset_5h, Some(1792220399));
    assert_eq!(before.used_7d, Some(50));
    assert_eq!(before.reset_7d, Some(1792310399));
    // Expired saved snapshots cannot claim an empty quota window without local evidence.
    let after = extract_quota(&cj, None, Some("Pro"), 1792320000, 0);
    assert_eq!(after.used_5h, None);
    assert_eq!(after.used_7d, None);
}
#[test]
fn plan_downgrade_gates_max_tier_suffix_and_clears_ultra_unlimited_5h() {
    assert_eq!(
        format_plan(Some("pro"), Some("default_claude_max_5x"), None).as_deref(),
        Some("Pro")
    );
    assert_eq!(
        format_plan(Some("free"), Some("default_claude_max_20x"), None).as_deref(),
        Some("Free")
    );
    let mut plan = Some("Pro".to_string());
    let web_ultra = super::super::online::WebMetadata {
        plan_tier: Some("Ultra".into()),
        ..Default::default()
    };
    apply_web_plan_tier(&mut plan, &web_ultra);
    assert_eq!(plan.as_deref(), Some("Pro"));

    let mut max_plan = Some("Pro / Max".to_string());
    apply_web_plan_tier(&mut max_plan, &web_ultra);
    assert_eq!(max_plan.as_deref(), Some("Ultra"));

    let mut no_5h = true;
    enforce_plan_quota_limits(Some("Pro"), &mut no_5h);
    assert!(!no_5h);
    let mut ultra_5h = true;
    enforce_plan_quota_limits(Some("Ultra"), &mut ultra_5h);
    assert!(ultra_5h);
}
