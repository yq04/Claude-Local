// [INPUT]: identities::orchestrator、identities::{catalog,database,online,private,profile,store,usage,Policy} 与 cleaner_identity 隔离辅助的合成测试夹具。
// [OUTPUT]: 覆盖 smart_relay_v1 校验（含 80/85 阈值与默认并发 1、兼容 1..=5）与 128KiB 限制、6 策略 1:1 评估器（Strategy A1 Reset-Card / 阈值感知 awaiting_manual_reset / WeekLow / 10% pace 分带 / 首选滞回返回 / affinity_mode）、Windows FILETIME 防 PID 复用、exclude_record_ids 多路故障转移、settings.local.json + skills/synced 干净物化、单调 expiresAt 回灌与释放后凭据擦除、429 冷却入狱、纯后台守护态自动优雅挂起与跨切号 `adopt.json`/`daemon*` 保护、cr.cmd + pro-pool-worker.md 原子无 BOM LF 安装与 --orchestrate 全分支的纯合成单元测试。
// [POS]: orchestrator 子包单元测试边界；仅使用临时目录与合成夹具，绝不触碰真实系统进程、全局 ~/.claude 或注册表。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use crate::{
    cleaner::{identity, ClaudeProcess},
    identities::{catalog, database, online, private, profile, store::Store, Policy},
    progress::Reporter,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct TempFixture {
    root: PathBuf,
    app_data: PathBuf,
    vault: PathBuf,
    home: PathBuf,
}

impl TempFixture {
    fn new(tag: &str) -> Self {
        let base = dunce::canonicalize(std::env::temp_dir()).expect("canonicalize temp_dir");
        let unique = format!(
            "cl-orch-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let root = base.join(unique);
        let app_data = root.join("app_data");
        let vault = app_data.join("identity-vault");
        let home = root.join("home");
        private::directory(&app_data).unwrap();
        private::directory(&vault).unwrap();
        private::directory(&home.join(".claude")).unwrap();
        Self {
            root,
            app_data,
            vault,
            home,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn write_live_identity(
        &self,
        uuid: &str,
        email: &str,
        display_name: &str,
        access_tok: &str,
        refresh_tok: &str,
        extra_cred: Option<(&str, Value)>,
        user_id: Option<&str>,
        mcp_servers: Option<Value>,
    ) {
        let mut cred_obj = serde_json::Map::new();
        cred_obj.insert(
            "claudeAiOauth".into(),
            json!({
                "accessToken": access_tok,
                "refreshToken": refresh_tok,
                "expiresAt": 4_000_000_000_000i64,
            }),
        );
        if let Some((k, v)) = extra_cred {
            cred_obj.insert(k.into(), v);
        }
        fs::write(
            self.home.join(".claude/.credentials.json"),
            serde_json::to_vec_pretty(&Value::Object(cred_obj)).unwrap(),
        )
        .unwrap();

        let mut claude_obj = serde_json::Map::new();
        claude_obj.insert(
            "oauthAccount".into(),
            json!({
                "accountUuid": uuid,
                "emailAddress": email,
                "displayName": display_name,
            }),
        );
        if let Some(uid) = user_id {
            claude_obj.insert("userID".into(), json!(uid));
        }
        if let Some(mcp) = mcp_servers {
            claude_obj.insert("mcpServers".into(), mcp);
        }
        claude_obj.insert(
            "cachedUsageUtilization".into(),
            json!({
                "accountUuid": uuid,
                "fetchedAtMs": 1_700_000_000_000u64,
                "utilization": {
                    "five_hour": { "utilization": 10 },
                    "seven_day": { "utilization": 20 }
                }
            }),
        );
        fs::write(
            self.home.join(".claude.json"),
            serde_json::to_vec_pretty(&Value::Object(claude_obj)).unwrap(),
        )
        .unwrap();
    }

    fn seed_saved_account(
        &self,
        name: &str,
        uuid: &str,
        email: &str,
        access_tok: &str,
        refresh_tok: &str,
    ) -> database::Record {
        self.write_live_identity(
            uuid,
            email,
            name,
            access_tok,
            refresh_tok,
            Some((
                "mcpOAuth",
                json!({ "srv|hash": { "accessToken": "mcp-keep" } }),
            )),
            Some("s13-shared-user-id"),
            Some(json!({ "local-mcp": { "command": "node" } })),
        );
        let mut store = Store::open(&self.vault, &self.home).unwrap();
        store
            .save_current(name, &Policy::all(), &Reporter::channel(None))
            .unwrap();
        store
            .records()
            .into_iter()
            .find(|r| r.name == name)
            .expect("saved record")
    }
}

impl Drop for TempFixture {
    fn drop(&mut self) {
        let slots = self.app_data.join("cli-slots");
        if slots.exists() {
            if let Ok(entries) = fs::read_dir(&slots) {
                for entry in entries.flatten() {
                    for sub in ["skills", "commands", "agents", "rules", "hooks"] {
                        let p = entry.path().join(sub);
                        if let Ok(m) = fs::symlink_metadata(&p) {
                            if crate::cleaner::linked(&m) {
                                let _ = fs::remove_dir(&p).or_else(|_| fs::remove_file(&p));
                            }
                        }
                    }
                }
            }
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn synthetic_proc(pid: i32) -> ClaudeProcess {
    ClaudeProcess {
        pid,
        name: "claude.exe".into(),
        executable: String::new(),
        #[cfg(windows)]
        created: 0,
        #[cfg(windows)]
        role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
        #[cfg(windows)]
        child_shells: Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
fn summary_with_quota(
    used_5h: Option<u8>,
    reset_5h: Option<u64>,
    used_7d: Option<u8>,
    reset_7d: Option<u64>,
    no_5h: bool,
    resets_rem: Option<u32>,
    grants: Option<Vec<online::ManualResetGrant>>,
    proxy: Option<&str>,
) -> profile::Summary {
    let mut s = profile::Summary::default();
    s.quota_5h_used = used_5h;
    s.quota_5h_reset_at = reset_5h;
    s.quota_7d_used = used_7d;
    s.quota_7d_reset_at = reset_7d;
    s.quota_no_5h_limit = no_5h;
    s.quota_checked = Some(true);
    s.quota_version = Some(profile::CURRENT_QUOTA_VERSION);
    s.proxy = proxy.map(str::to_string);
    s.web.manual_resets_remaining = resets_rem;
    s.web.manual_resets_grants = grants;
    s
}

fn set_summary_quota(
    db: &database::Database,
    id: &str,
    used_5h: Option<u8>,
    reset_5h: Option<u64>,
    used_7d: Option<u8>,
    reset_7d: Option<u64>,
    proxy: Option<&str>,
) -> Option<String> {
    let mut s = db.summaries().unwrap().remove(id).unwrap_or_default();
    let qid = s.quota_identity.clone();
    s.quota_5h_used = used_5h;
    s.quota_5h_reset_at = reset_5h;
    s.quota_7d_used = used_7d;
    s.quota_7d_reset_at = reset_7d;
    s.quota_checked = Some(true);
    s.quota_version = Some(profile::CURRENT_QUOTA_VERSION);
    s.proxy = proxy.map(str::to_string);
    db.set_summary(id, &s).unwrap();
    qid
}

#[test]
fn smart_relay_config_roundtrip_and_strict_validation() {
    let fx = TempFixture::new("cfg");

    let pre_state =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, 1_800_000_000, &[]).unwrap();
    assert!(!pre_state.config_persisted);
    assert_eq!(pre_state.config.spent_threshold_pct, 98);
    assert_eq!(pre_state.config.preferred_return_threshold_pct, 90);
    assert_eq!(pre_state.config.max_same_exit_concurrency, 1);
    assert!(pre_state.config.sunk_order.is_empty());
    assert!(pre_state.config.rotation_tick.is_empty());

    let ts_empty_maps_json = json!({
        "enabled": false,
        "strategy": "smart",
        "rateLimitMode": "keep_position",
        "affinityMode": "auto",
        "spentThresholdPct": 98,
        "returnToPreferred": true,
        "preferredReturnThresholdPct": 90,
        "autoSwitchWhenIdle": false,
        "autoContinueOnRelay": false,
        "maxSameExitConcurrency": 1,
        "preferredAccountId": null,
        "excludedAccountIds": [],
        "slotProxies": {},
        "sunkOrder": {},
        "rotationTick": {},
        "cooldownUntilSec": {},
        "noReturnAccountId": null,
        "noReturnUntilSec": 0
    });
    let parsed_empty: SmartRelayConfig = serde_json::from_value(ts_empty_maps_json).unwrap();
    let validated_empty = validate_config_strict(parsed_empty).unwrap();
    assert_eq!(validated_empty, SmartRelayConfig::default());

    let frontend_json = json!({
        "enabled": true,
        "strategy": "reset_harvest",
        "rateLimitMode": "sink_to_end",
        "affinityMode": "session",
        "spentThresholdPct": 98,
        "returnToPreferred": true,
        "preferredReturnThresholdPct": 90,
        "autoSwitchWhenIdle": true,
        "autoContinueOnRelay": false,
        "maxSameExitConcurrency": 3,
        "preferredAccountId": "0123456789abcdef0123456789abcdef",
        "excludedAccountIds": ["fedcba9876543210fedcba9876543210"],
        "slotProxies": {
            "0123456789abcdef0123456789abcdef": "HTTP://127.0.0.1:7897/",
            "fedcba9876543210fedcba9876543210": "   "
        },
        "sunkOrder": {
            "fedcba9876543210fedcba9876543210": 2
        },
        "rotationTick": {
            "0123456789abcdef0123456789abcdef": 5
        },
        "cooldownUntilSec": {
            "fedcba9876543210fedcba9876543210": 1800000600
        },
        "noReturnAccountId": "fedcba9876543210fedcba9876543210",
        "noReturnUntilSec": 1800000300
    });
    let parsed: SmartRelayConfig = serde_json::from_value(frontend_json).unwrap();
    let validated = validate_config_strict(parsed).unwrap();
    assert_eq!(validated.schema, 1);
    assert_eq!(validated.strategy, "reset_harvest");
    assert!(!validated.auto_continue_on_relay);
    assert_eq!(validated.max_same_exit_concurrency, 3);
    assert_eq!(
        validated.sunk_order.get("fedcba9876543210fedcba9876543210"),
        Some(&2)
    );
    assert_eq!(
        validated
            .rotation_tick
            .get("0123456789abcdef0123456789abcdef"),
        Some(&5)
    );
    assert_eq!(
        validated
            .slot_proxies
            .get("0123456789abcdef0123456789abcdef")
            .map(String::as_str),
        Some("http://127.0.0.1:7897")
    );
    assert!(!validated
        .slot_proxies
        .contains_key("fedcba9876543210fedcba9876543210"));

    save_config(&fx.app_data, &validated).unwrap();
    let reloaded = load_config(&fx.app_data);
    assert_eq!(reloaded, validated);

    let serialized_val = serde_json::to_value(&reloaded).unwrap();
    assert!(serialized_val["sunkOrder"].is_object());
    assert!(serialized_val["rotationTick"].is_object());
    assert_eq!(
        serialized_val["sunkOrder"]["fedcba9876543210fedcba9876543210"],
        2
    );
    assert_eq!(
        serialized_val["rotationTick"]["0123456789abcdef0123456789abcdef"],
        5
    );

    let post_state =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, 1_800_000_000, &[]).unwrap();
    assert!(post_state.config_persisted);

    let legacy_json = json!({
        "schema": 1,
        "sunkOrder": ["0123456789abcdef0123456789abcdef"],
        "rotationTick": 4
    });
    let parsed_legacy: SmartRelayConfig = serde_json::from_value(legacy_json).unwrap();
    assert_eq!(
        parsed_legacy
            .sunk_order
            .get("0123456789abcdef0123456789abcdef"),
        Some(&1)
    );
    assert!(parsed_legacy.rotation_tick.is_empty());

    for bad_proxy in [
        "socks5://127.0.0.1:7897",
        "socks5h://127.0.0.1:7897",
        "https://127.0.0.1:7897",
        "127.0.0.1:7897",
        "http://127.0.0.1",
        "http://127.0.0.1:0",
        "http://127.0.0.1:7897\nINJECT=1",
        "http://127.0.0.1:7897\0",
    ] {
        let mut cfg = SmartRelayConfig::default();
        cfg.slot_proxies
            .insert("0123456789abcdef0123456789abcdef".into(), bad_proxy.into());
        assert_eq!(
            validate_config_strict(cfg).unwrap_err(),
            "relay.error.invalidSlotProxy",
            "expected rejection for {bad_proxy:?}"
        );
    }

    let mut huge = SmartRelayConfig::default();
    for i in 0..4500 {
        huge.excluded_account_ids.push(format!("acct_{i:027}"));
    }
    assert_eq!(
        save_config(&fx.app_data, &huge).unwrap_err(),
        "relay.error.configTooLarge"
    );
}

#[test]
fn evaluator_reset_harvest_awaiting_reset_and_72h_tiebreak() {
    let fx = TempFixture::new("eval");
    let now_sec = now_epoch_sec();

    let rec_a = fx.seed_saved_account("Active A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Awaiting B", "u-b", "b@example.invalid", "tb", "rb");
    let rec_c = fx.seed_saved_account("Expiring C", "u-c", "c@example.invalid", "tc", "rc");
    let rec_d = fx.seed_saved_account("Fresh D", "u-d", "d@example.invalid", "td", "rd");

    // Strategy A1 invariant: manual_resets_valid_until expired (>24h old) MUST NOT zero out manual_resets_remaining!
    let mut stale_cache_web = online::WebMetadata::default();
    stale_cache_web.manual_resets_remaining = Some(2);
    stale_cache_web.manual_resets_valid_until = Some(now_sec.saturating_sub(10_000));
    stale_cache_web.manual_resets_grant_ends_at = Some(now_sec + 10 * 86400);
    assert_eq!(
        active_reset_cards(&stale_cache_web, now_sec),
        (2, Some(now_sec + 10 * 86400))
    );

    // Strategy A1 invariant #1: legacy pre-2.15 manual_resets_grant_ends_at <= now_sec MUST NOT zero positive manual_resets_remaining!
    let mut legacy_past_grant_web = online::WebMetadata::default();
    legacy_past_grant_web.manual_resets_remaining = Some(3);
    legacy_past_grant_web.manual_resets_grant_ends_at = Some(now_sec.saturating_sub(3600));
    assert_eq!(
        active_reset_cards(&legacy_past_grant_web, now_sec),
        (3, None)
    );

    // Strategy A1 invariant #2: all-expired manual_resets_grants slices MUST NOT zero positive manual_resets_remaining on local clock!
    let mut all_past_slices_web = online::WebMetadata::default();
    all_past_slices_web.manual_resets_remaining = Some(2);
    all_past_slices_web.manual_resets_grants = Some(vec![online::ManualResetGrant {
        resets_left: 2,
        ends_at: Some(now_sec.saturating_sub(60)),
    }]);
    assert_eq!(
        active_reset_cards(&all_past_slices_web, now_sec),
        (2, None)
    );

    // Strategy A1 invariant #3: mixed expired + future slices cap count at future_sum (not raw_rem = 3)!
    let mut mixed_slices_web = online::WebMetadata::default();
    mixed_slices_web.manual_resets_remaining = Some(3);
    mixed_slices_web.manual_resets_grants = Some(vec![
        online::ManualResetGrant {
            resets_left: 1,
            ends_at: Some(now_sec.saturating_sub(300)),
        },
        online::ManualResetGrant {
            resets_left: 2,
            ends_at: Some(now_sec + 7200),
        },
    ]);
    assert_eq!(
        active_reset_cards(&mixed_slices_web, now_sec),
        (2, Some(now_sec + 7200))
    );

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Active A",
            &Policy::default(),
            &Reporter::channel(None),
        )
        .unwrap();
    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-a", "emailAddress": "a@example.invalid" },
            "cachedUsageUtilization": {
                "accountUuid": "u-a",
                "fetchedAtMs": now_sec * 1000,
                "utilization": {
                    "five_hour": { "utilization": 97, "resets_at": now_sec + 3600 },
                    "seven_day": { "utilization": 40, "resets_at": now_sec + 86400 }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let db = database::Database::open(&fx.vault).unwrap();
    let _qid_a = set_summary_quota(
        &db,
        &rec_a.id,
        Some(97),
        Some(now_sec + 3600),
        Some(40),
        Some(now_sec + 86400),
        None,
    );
    let qid_b = set_summary_quota(
        &db,
        &rec_b.id,
        Some(10),
        Some(now_sec + 3600),
        Some(100),
        Some(now_sec + 4 * 86400),
        None,
    )
    .unwrap();
    let qid_c = set_summary_quota(
        &db,
        &rec_c.id,
        Some(25),
        Some(now_sec + 3600),
        Some(30),
        Some(now_sec + 5 * 86400),
        None,
    )
    .unwrap();
    let _qid_d = set_summary_quota(
        &db,
        &rec_d.id,
        Some(10),
        Some(now_sec + 3600),
        Some(10),
        Some(now_sec + 6 * 86400),
        None,
    );

    let mut accounts_meta = serde_json::Map::new();
    accounts_meta.insert(
        qid_b,
        json!({
            "metadata_observed_at_ms": now_sec * 1000,
            "manual_resets_observed_at_ms": now_sec * 1000,
            "manual_resets_remaining": 2,
            "manual_resets_valid_until": now_sec.saturating_sub(7200),
            "manual_resets_grants": [
                { "resets_left": 2, "ends_at": now_sec + 24 * 3600 }
            ]
        }),
    );
    accounts_meta.insert(
        qid_c,
        json!({
            "metadata_observed_at_ms": now_sec * 1000,
            "manual_resets_observed_at_ms": now_sec * 1000,
            "manual_resets_remaining": 1,
            "manual_resets_valid_until": now_sec.saturating_sub(7200),
            "manual_resets_grants": [
                { "resets_left": 1, "ends_at": now_sec + 48 * 3600 }
            ]
        }),
    );
    private::write(
        &fx.vault.join("quota_web_metadata.json"),
        serde_json::to_vec_pretty(&json!({
            "version": 1,
            "accounts": Value::Object(accounts_meta)
        }))
        .unwrap()
        .as_slice(),
    )
    .unwrap();

    // Even at 100% 7d usage AND spentThresholdPct=100, B stays awaiting_manual_reset with tier == "awaiting_reset"
    let mut cfg = SmartRelayConfig {
        enabled: true,
        strategy: "smart".into(),
        spent_threshold_pct: 100,
        ..SmartRelayConfig::default()
    };
    save_config(&fx.app_data, &cfg).unwrap();

    let state_smart =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert_eq!(state_smart.awaiting_reset_accounts.len(), 1);
    assert_eq!(state_smart.awaiting_reset_accounts[0].id, rec_b.id);
    assert_eq!(state_smart.pool.awaiting_reset_count, 1);

    let acct_b = state_smart
        .accounts
        .iter()
        .find(|a| a.id == rec_b.id)
        .unwrap();
    assert!(acct_b.awaiting_manual_reset);
    assert_eq!(acct_b.tier, "awaiting_reset");

    // 5h=100% with low 7d (30%) on C MUST NOT trigger awaiting_manual_reset!
    set_summary_quota(
        &db,
        &rec_c.id,
        Some(100),
        Some(now_sec + 3600),
        Some(30),
        Some(now_sec + 5 * 86400),
        None,
    );
    let state_5h_only =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    let acct_c_5h = state_5h_only
        .accounts
        .iter()
        .find(|a| a.id == rec_c.id)
        .unwrap();
    assert!(!acct_c_5h.awaiting_manual_reset);
    set_summary_quota(
        &db,
        &rec_c.id,
        Some(25),
        Some(now_sec + 3600),
        Some(30),
        Some(now_sec + 5 * 86400),
        None,
    );

    // In smart strategy, 72h expiring grant tie-break chooses C over D (and never B!).
    let sw_smart = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some("smart"),
        Some(95),
        None,
        Some(&rec_a.id),
        now_sec,
        &[],
    );
    assert!(sw_smart.switched);
    assert_eq!(sw_smart.target_id.as_deref(), Some(rec_c.id.as_str()));

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Active A",
            &Policy::default(),
            &Reporter::channel(None),
        )
        .unwrap();
    set_summary_quota(
        &db,
        &rec_c.id,
        Some(25),
        Some(now_sec + 3600),
        Some(30),
        Some(now_sec + 5 * 86400),
        None,
    );
    cfg.strategy = "reset_harvest".into();
    cfg.spent_threshold_pct = 95;
    save_config(&fx.app_data, &cfg).unwrap();

    let sw_harvest = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some("reset_harvest"),
        None,
        None,
        Some(&rec_a.id),
        now_sec,
        &[],
    );
    assert!(sw_harvest.switched);
    assert_eq!(sw_harvest.target_id.as_deref(), Some(rec_c.id.as_str()));

    // Verify no_return_account_id locks A until A's 5h reset (now_sec + 3600), then unlocks!
    set_summary_quota(
        &db,
        &rec_c.id,
        Some(25),
        Some(now_sec + 18000),
        Some(30),
        Some(now_sec + 5 * 86400),
        None,
    );
    set_summary_quota(
        &db,
        &rec_a.id,
        Some(25),
        Some(now_sec + 18000),
        Some(25),
        Some(now_sec + 6 * 86400),
        None,
    );
    let mut cfg_pref = load_config(&fx.app_data);
    assert_eq!(cfg_pref.no_return_account_id.as_deref(), Some(rec_a.id.as_str()));
    cfg_pref.preferred_account_id = Some(rec_a.id.clone());
    cfg_pref.return_to_preferred = true;
    cfg_pref.preferred_return_threshold_pct = 90;
    save_config(&fx.app_data, &cfg_pref).unwrap();

    // Before A's 5h reset (now_sec + 100 < now_sec + 3600), A is locked against immediate bounce-back
    let st_locked =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec + 100, &[]).unwrap();
    assert!(!st_locked.should_relay_now);

    // After A's 5h reset (now_sec + 3601), A has 25% used (< 90% preferredReturnThresholdPct!) -> preferred_recovered!
    let st_pref =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec + 3601, &[]).unwrap();
    assert!(st_pref.should_relay_now);
    assert_eq!(
        st_pref.relay_trigger_kind.as_deref(),
        Some("preferred_recovered")
    );

    // In affinityMode == "manual", relay_trigger_kind is reported for inspection, while should_relay_now is false
    cfg_pref.affinity_mode = "manual".into();
    save_config(&fx.app_data, &cfg_pref).unwrap();
    let st_manual =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec + 3601, &[]).unwrap();
    assert!(!st_manual.should_relay_now);
    assert_eq!(
        st_manual.relay_trigger_kind.as_deref(),
        Some("preferred_recovered")
    );
}

#[test]
fn slot_pids_discovery_and_non_slot_process_isolation() {
    let fx = TempFixture::new("pids");
    let rec_id = "0123456789abcdef0123456789abcdef";
    let sess_dir = fx.app_data.join("cli-slots").join(rec_id).join("sessions");
    private::directory(&sess_dir).unwrap();
    private::write(
        &sess_dir.join("42001.json"),
        serde_json::to_vec(&json!({
            "cwd": "D:/work/subagent-repo",
            "entrypoint": "cli",
            "startedAt": 1_800_000_000_000u64
        }))
        .unwrap()
        .as_slice(),
    )
    .unwrap();
    // Recycled PID file: startedAt is 1_800_000_000_000ms, while recycled Win32 process started 60s later!
    private::write(
        &sess_dir.join("42003.json"),
        serde_json::to_vec(&json!({
            "cwd": "D:/recycled",
            "entrypoint": "cli",
            "startedAt": 1_800_000_000_000u64
        }))
        .unwrap()
        .as_slice(),
    )
    .unwrap();
    private::write(
        &sess_dir.join("49999.json"),
        br#"{"cwd":"D:/dead","entrypoint":"cli"}"#,
    )
    .unwrap();
    private::directory(&fx.app_data.join("cli-slots/not-a-valid-hex/sessions")).unwrap();
    private::write(
        &fx.app_data.join("cli-slots/not-a-valid-hex/sessions/42002.json"),
        br#"{"cwd":"D:/bad","entrypoint":"cli"}"#,
    )
    .unwrap();

    #[cfg(windows)]
    let recycled_proc = ClaudeProcess {
        pid: 42003,
        name: "claude.exe".into(),
        executable: String::new(),
        created: (1_800_000_060_000u64 + 11_644_473_600_000u64) * 10_000,
        role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
        child_shells: Vec::new(),
    };
    #[cfg(not(windows))]
    let recycled_proc = synthetic_proc(42003);

    let running = vec![synthetic_proc(42001), synthetic_proc(42002), recycled_proc];
    let by_rec = slot_pids_by_record(&fx.app_data, &running);
    #[cfg(windows)]
    assert_eq!(by_rec.get(rec_id), Some(&vec![42001]));
    assert!(!by_rec.contains_key("not-a-valid-hex"));

    let sessions_map = slot_sessions_by_record(&fx.app_data, &running);
    assert_eq!(
        sessions_map[rec_id][0].workspace.as_deref(),
        Some("subagent-repo")
    );
    assert_eq!(sessions_map[rec_id][0].entrypoint, "CLI");

    let filtered = identity::filter_non_slot_processes(Some(&fx.app_data), running);
    assert!(filtered.iter().any(|p| p.pid == 42002));
    assert!(!filtered.iter().any(|p| p.pid == 42001));
}

#[test]
fn slot_acquire_proxy_precedence_and_same_exit_concurrency_guard() {
    let fx = TempFixture::new("conc");
    let now_sec = 1_800_000_000u64;

    let rec_a = fx.seed_saved_account("Active A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Secondary B", "u-b", "b@example.invalid", "tb", "rb");
    let rec_c = fx.seed_saved_account("Secondary C", "u-c", "c@example.invalid", "tc", "rc");

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Active A",
            &Policy::default(),
            &Reporter::channel(None),
        )
        .unwrap();

    fs::write(
        fx.home.join(".claude/settings.json"),
        serde_json::to_vec_pretty(&json!({
            "env": { "HTTPS_PROXY": "http://127.0.0.1:7897" }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::create_dir_all(fx.home.join(".claude/sessions")).unwrap();
    fs::write(
        fx.home.join(".claude/sessions/71000.json"),
        br#"{"cwd":"D:/main","entrypoint":"cli"}"#,
    )
    .unwrap();
    let procs = vec![synthetic_proc(71000)];

    let db = database::Database::open(&fx.vault).unwrap();
    db.set_summary(
        &rec_a.id,
        &summary_with_quota(
            Some(20),
            Some(now_sec + 3600),
            Some(20),
            Some(now_sec + 86400),
            false,
            None,
            None,
            None,
        ),
    )
    .unwrap();
    db.set_summary(
        &rec_b.id,
        &summary_with_quota(
            Some(10),
            Some(now_sec + 3600),
            Some(10),
            Some(now_sec + 86400),
            false,
            None,
            None,
            None,
        ),
    )
    .unwrap();
    db.set_summary(
        &rec_c.id,
        &summary_with_quota(
            Some(20),
            Some(now_sec + 3600),
            Some(20),
            Some(now_sec + 86400),
            false,
            None,
            None,
            Some("socks5://127.0.0.1:7901"),
        ),
    )
    .unwrap();

    // Explicit acquire of active `~/.claude` account A must be rejected as targetSlotBusy
    let res_active_guard = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_a.id),
        None,
        None,
        None,
        now_sec,
        &procs,
    );
    assert!(!res_active_guard.ok);
    assert_eq!(
        res_active_guard.reason.as_deref(),
        Some("relay.error.targetSlotBusy")
    );

    let mut cfg = SmartRelayConfig {
        enabled: true,
        strategy: "least_used".into(),
        max_same_exit_concurrency: 1,
        ..SmartRelayConfig::default()
    };
    cfg.slot_proxies
        .insert(rec_b.id.clone(), "http://127.0.0.1:7897".into());
    save_config(&fx.app_data, &cfg).unwrap();

    // Auto-pick skips B (exit 7897 already 1/1 due to live CLI 71000) and picks C on alternate port 7901!
    let res1 = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        Some("worker-c"),
        None,
        None,
        now_sec,
        &procs,
    );
    assert!(res1.ok, "unexpected failure: {:?}", res1.error);
    assert_eq!(res1.status, "acquired");
    assert_eq!(res1.record_id.as_deref(), Some(rec_c.id.as_str()));
    assert_eq!(res1.proxy.as_deref(), Some("http://127.0.0.1:7901"));
    assert!(res1.jitter_ms.unwrap() <= 250);

    // Explicit re-acquire of C while C's startup lease (<60s) is active must return targetSlotBusy!
    let res_c_busy = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_c.id),
        None,
        None,
        None,
        now_sec + 2,
        &procs,
    );
    assert!(!res_c_busy.ok);
    assert_eq!(
        res_c_busy.reason.as_deref(),
        Some("relay.error.targetSlotBusy")
    );

    // Next auto-pick: B capped (7897 1/1), C already has active lease (<60s), so returns concurrency_capped!
    let res2 = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        Some("worker-b"),
        None,
        None,
        now_sec + 1,
        &procs,
    );
    assert!(!res2.ok);
    assert_eq!(res2.status, "concurrency_capped");
    assert_eq!(res2.retry_after_ms, Some(5000));
    assert_eq!(
        res2.reason.as_deref(),
        Some("relay.error.slotConcurrencyCapped")
    );

    // Raise max_same_exit_concurrency to 2 and test exclude_record_ids skipping B when C is released
    slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_c.id,
        None,
        None,
        None,
        now_sec + 2,
        &procs,
    )
    .unwrap();
    cfg.max_same_exit_concurrency = 2;
    save_config(&fx.app_data, &cfg).unwrap();

    let excluded = vec![rec_b.id.clone()];
    let res_excl = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        None,
        None,
        Some(&excluded),
        now_sec + 3,
        &procs,
    );
    assert!(res_excl.ok);
    assert_eq!(res_excl.record_id.as_deref(), Some(rec_c.id.as_str()));

    let res_b = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        None,
        None,
        None,
        now_sec + 3,
        &procs,
    );
    assert!(res_b.ok);
    assert_eq!(res_b.proxy.as_deref(), Some("http://127.0.0.1:7897"));
    let j = res_b.jitter_ms.unwrap();
    assert!((800..=2200).contains(&j), "unexpected shared jitter: {j}");

    let res_bad_proxy = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        None,
        Some("socks5://127.0.0.1:9050"),
        None,
        now_sec + 4,
        &procs,
    );
    assert!(!res_bad_proxy.ok);
    assert_eq!(
        res_bad_proxy.reason.as_deref(),
        Some("relay.error.invalidSlotProxy")
    );
}

#[test]
fn slot_acquire_clean_materialization_and_boundaries() {
    let fx = TempFixture::new("mat");
    let now_sec = 1_800_000_000u64;

    let rec_a = fx.seed_saved_account("Acct A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct B", "u-b", "b@example.invalid", "tb", "rb");

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Acct A",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-a", "emailAddress": "a@example.invalid" },
            "userID": "s13-continuity-host",
            "mcpServers": { "ctx7": { "command": "npx" } },
            "cachedUsageUtilization": { "accountUuid": "u-a", "fetchedAtMs": 100 },
            "projects": { "secretHostProj": { "trust": true } }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        fx.home.join(".claude/settings.json"),
        serde_json::to_vec_pretty(&json!({
            "statusLine": { "type": "command", "command": "python claude_quota.py" },
            "hooks": { "Stop": [] },
            "env": {
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "ANTHROPIC_API_KEY": "sk-override-strip",
                "ANTHROPIC_AUTH_TOKEN": "tok-strip",
                "CLAUDECODE": "1",
                "HTTPS_PROXY": "http://127.0.0.1:9999",
                "CUSTOM_KEEP": "yes"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        fx.home.join(".claude/settings.local.json"),
        serde_json::to_vec_pretty(&json!({
            "env": {
                "LOCAL_EXTRA": "from_local",
                "CLAUDE_CODE_SIMPLE": "1"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(fx.home.join(".claude/CLAUDE.md"), "# User instructions\n").unwrap();
    fs::write(fx.home.join(".claude/keybindings.json"), "{\"keys\":[]}\n").unwrap();
    fs::write(fx.home.join(".claude/.mcp.json"), "{\"mcpServers\":{}}\n").unwrap();

    for (dir, file, content) in [
        ("skills/s1", "SKILL.md", "skill"),
        ("skills/synced/private-acct", "SKILL.md", "secret-synced"),
        ("commands", "c1.md", "cmd"),
        ("agents", "a1.md", "agent"),
        ("rules", "r1.md", "rule"),
        ("hooks", "h1.ps1", "hook"),
        ("projects/host-only", "old.jsonl", "{}"),
        ("telemetry", "t.json", "{}"),
        ("statsig", "s.json", "{}"),
        ("sessions", "555.json", "{}"),
        ("cache", "c.bin", "cache"),
    ] {
        let p = fx.home.join(".claude").join(dir);
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join(file), content).unwrap();
    }

    let res = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("mat-tag"),
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(res.ok, "slot_acquire failed: {:?}", res.error);
    let slot_dir = PathBuf::from(res.slot_dir.unwrap());

    let creds: Value =
        serde_json::from_slice(&fs::read(slot_dir.join(".credentials.json")).unwrap()).unwrap();
    assert_eq!(creds["claudeAiOauth"]["accessToken"], "tb");
    assert!(creds.get("mcpOAuth").is_none());

    let host_claude: Value =
        serde_json::from_slice(&fs::read(fx.home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(host_claude["userID"], "s13-continuity-host");

    let claude_json: Value =
        serde_json::from_slice(&fs::read(slot_dir.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(claude_json["oauthAccount"]["accountUuid"], "u-b");
    let slot_uid = claude_json["userID"].as_str().unwrap();
    assert_eq!(slot_uid.len(), 64);
    assert!(slot_uid.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_ne!(slot_uid, "s13-continuity-host");
    let slot_anon = claude_json["anonymousId"].as_str().unwrap();
    assert!(slot_anon.starts_with("claude-cli-v1-"));
    assert_eq!(claude_json["numStartups"].as_u64(), Some(1));
    assert!(claude_json["firstStartTime"].as_str().is_some());
    assert_eq!(claude_json["mcpServers"]["ctx7"]["command"], "npx");
    assert!(claude_json["profileFetchedAt"].as_u64().is_some());
    assert!(claude_json.get("cachedUsageUtilization").is_none());
    assert!(claude_json.get("projects").is_none());

    let settings: Value =
        serde_json::from_slice(&fs::read(slot_dir.join("settings.json")).unwrap()).unwrap();
    assert_eq!(settings["statusLine"]["type"], "command");
    assert!(settings["hooks"].get("Stop").is_some());
    let env = settings["env"].as_object().unwrap();
    assert_eq!(env.get("DISABLE_TELEMETRY").unwrap(), "1");
    assert_eq!(env.get("DISABLE_ERROR_REPORTING").unwrap(), "1");
    assert_eq!(env.get("DO_NOT_TRACK").unwrap(), "1");
    assert_eq!(env.get("CUSTOM_KEEP").unwrap(), "yes");
    assert_eq!(env.get("LOCAL_EXTRA").unwrap(), "from_local");
    assert!(!env.contains_key("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"));
    assert!(!env.contains_key("ANTHROPIC_API_KEY"));
    assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
    assert!(!env.contains_key("CLAUDECODE"));
    assert!(!env.contains_key("CLAUDE_CODE_SIMPLE"));
    for k in [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "GRPC_PROXY",
        "grpc_proxy",
    ] {
        assert_eq!(env.get(k).unwrap(), "http://127.0.0.1:7899");
    }
    assert_eq!(env.get("NO_PROXY").unwrap(), "localhost,127.0.0.1,::1");
    assert_eq!(env.get("no_proxy").unwrap(), "localhost,127.0.0.1,::1");

    assert!(slot_dir.join("CLAUDE.md").is_file());
    assert!(slot_dir.join("keybindings.json").is_file());
    assert!(slot_dir.join(".mcp.json").is_file());
    assert!(slot_dir.join("skills/s1/SKILL.md").exists());
    // Account-bound skills/synced MUST NOT cross-leak into secondary slots!
    assert!(!slot_dir.join("skills/synced").exists());
    assert!(slot_dir.join("commands/c1.md").exists());
    assert!(slot_dir.join("agents/a1.md").exists());
    assert!(slot_dir.join("rules/r1.md").exists());
    assert!(slot_dir.join("hooks/h1.ps1").exists());

    assert!(!slot_dir.join("telemetry").exists());
    assert!(!slot_dir.join("statsig").exists());
    assert!(!slot_dir.join("cache").exists());
    assert!(!slot_dir.join("projects/host-only").exists());
    assert!(!slot_dir.join("sessions/555.json").exists());

    let manifest: Value =
        serde_json::from_slice(&fs::read(slot_dir.join(".slot-manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["schema"], 1);
    assert_eq!(manifest["links"]["skills"].as_str(), Some("copy"));
    let lease: Value =
        serde_json::from_slice(&fs::read(slot_dir.join(".slot-lease.json")).unwrap()).unwrap();
    assert_eq!(lease["session_tag"], "mat-tag");
    assert_eq!(lease["proxy"], "http://127.0.0.1:7899");
}

#[test]
fn slot_credential_sync_drift_guard_usage_and_release() {
    let fx = TempFixture::new("sync");
    let now_sec = 1_800_000_000u64;

    let rec_a = fx.seed_saved_account("Acct A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct B", "u-b", "b@example.invalid", "tb-old", "rb-old");

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Acct A",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    let acq = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("sync-tag"),
        None,
        None,
        now_sec,
        &[],
    );
    assert!(acq.ok);
    let slot_dir = PathBuf::from(acq.slot_dir.unwrap());

    // Part A: Active slot PID or fresh .slot-lease.json refuses Store::switch with relay.error.targetSlotBusy
    assert_eq!(
        store
            .switch(
                &rec_b.id,
                "Acct A",
                &Policy::default(),
                &Reporter::channel(None)
            )
            .unwrap_err(),
        "relay.error.targetSlotBusy"
    );
    fs::write(
        slot_dir.join("sessions/987654.json"),
        br#"{"cwd":"D:/slot","entrypoint":"cli"}"#,
    )
    .unwrap();
    store.test_live_pids = vec![987654];
    assert_eq!(
        store
            .switch(
                &rec_b.id,
                "Acct A",
                &Policy::default(),
                &Reporter::channel(None)
            )
            .unwrap_err(),
        "relay.error.targetSlotBusy"
    );
    store.test_live_pids.clear();
    fs::remove_file(slot_dir.join("sessions/987654.json")).unwrap();

    // Part A2: Monotonic expiresAt guard — older expiresAt (3_900_000_000_000 < 4_000_000_000_000) MUST NOT clobber archive!
    fs::write(
        slot_dir.join(".credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": {
                "accessToken": "tb-stale",
                "refreshToken": "rb-stale",
                "expiresAt": 3_900_000_000_000i64
            }
        }))
        .unwrap(),
    )
    .unwrap();
    assert!(!store.sync_slot_credentials(&rec_b.id, &slot_dir).unwrap());

    // Part B: Rotate B's credentials in slot with newer expiresAt + emit usage JSONL, then call slot_release_in with rate_limited + retry_after_sec
    fs::write(
        slot_dir.join(".credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": {
                "accessToken": "tb-rotated",
                "refreshToken": "rb-rotated",
                "expiresAt": 4_100_000_000_000i64
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let slot_proj = slot_dir.join("projects/proj-demo");
    fs::create_dir_all(&slot_proj).unwrap();
    fs::write(
        slot_proj.join("sess-1.jsonl"),
        "{\"type\":\"assistant\",\"timestamp\":\"2026-11-17T06:00:00Z\",\"message\":{\"id\":\"msg_slot_1\",\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":120,\"output_tokens\":45,\"cache_read_input_tokens\":10,\"cache_creation_input_tokens\":5}}}\n",
    )
    .unwrap();

    let rel = slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        Some(true),
        None,
        Some(420),
        now_sec,
        &[],
    )
    .unwrap();
    assert!(rel.ok);
    assert!(rel.credentials_synced);
    assert!(rel.usage_ingested >= 1);
    assert_eq!(rel.cooldown_until_sec, Some(now_sec + 420));
    assert!(!slot_dir.join(".slot-lease.json").exists());
    // Released slot scrubs .credentials.json at rest!
    assert!(!slot_dir.join(".credentials.json").exists());
    assert_eq!(
        load_config(&fx.app_data).cooldown_until_sec.get(&rec_b.id),
        Some(&(now_sec + 420))
    );

    let conn = Connection::open(fx.vault.join("usage.sqlite")).unwrap();
    let (ev_count, acct_key): (i64, String) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(account_key), '') FROM events WHERE input = 120 AND output = 45",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ev_count, 1);
    assert_eq!(Some(acct_key.as_str()), rec_b.account_key.as_deref());

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_b.id,
            "Acct A",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();
    let live_cred: Value =
        serde_json::from_slice(&fs::read(fx.home.join(".claude/.credentials.json")).unwrap())
            .unwrap();
    assert_eq!(live_cred["claudeAiOauth"]["accessToken"], "tb-rotated");
    assert_eq!(live_cred["claudeAiOauth"]["refreshToken"], "rb-rotated");
    assert_eq!(live_cred["mcpOAuth"]["srv|hash"]["accessToken"], "mcp-keep");

    // Part C: Credential drift guard writes .slot-drifted and blocks reuse without overwriting B
    fs::write(
        slot_dir.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-a", "emailAddress": "a@example.invalid" }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        slot_dir.join(".credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": {
                "accessToken": "hijacked-tok",
                "refreshToken": "hijacked-ref",
                "expiresAt": 4_200_000_000_000i64
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    assert_eq!(
        store.sync_slot_credentials(&rec_b.id, &slot_dir).unwrap_err(),
        "relay.error.slotCredentialDrift"
    );
    assert!(slot_dir.join(".slot-drifted").exists());

    // Switch back to A so B is non-active, then verify explicit acquire on drifted B returns slotCredentialDrift
    store
        .switch(
            &rec_a.id,
            "Acct B",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();
    let acq_drifted = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        None,
        None,
        None,
        now_sec + 600,
        &[],
    );
    assert!(!acq_drifted.ok);
    assert_eq!(
        acq_drifted.reason.as_deref(),
        Some("relay.error.slotCredentialDrift")
    );
}

#[test]
fn install_wrappers_atomic_bom_lf_and_no_settings_touch() {
    let fx = TempFixture::new("wrappers");
    let settings_path = fx.home.join(".claude/settings.json");
    let sentinel = b"{\n  \"keepUserSettings\": true\n}\n";
    fs::write(&settings_path, sentinel).unwrap();

    let res = install_wrappers_in(&fx.home).unwrap();
    assert!(res.ok);
    assert!(res.installed);
    assert_eq!(res.files.len(), 6);
    assert!(res.agent_path.is_some());

    let bin = fx.home.join(".local/bin");
    for ps1 in ["claude-relay.ps1", "claude-subagent.ps1"] {
        let bytes = fs::read(bin.join(ps1)).unwrap();
        assert!(
            bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
            "{ps1} missing UTF-8 BOM"
        );
        assert!(!bytes.contains(&b'\r'), "{ps1} must be pure LF");
    }
    for (cmd, ps1) in [
        ("claude-relay.cmd", "claude-relay.ps1"),
        ("cr.cmd", "claude-relay.ps1"),
        ("claude-subagent.cmd", "claude-subagent.ps1"),
    ] {
        let content = fs::read_to_string(bin.join(cmd)).unwrap();
        assert!(content.contains(ps1));
        assert!(content.contains("exit /b %ERRORLEVEL%"));
    }

    // Verify ~/.claude/agents/pro-pool-worker.md is UTF-8 WITHOUT BOM + pure LF
    let agent_file = fx.home.join(".claude/agents/pro-pool-worker.md");
    let agent_bytes = fs::read(&agent_file).unwrap();
    assert!(
        !agent_bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
        "pro-pool-worker.md must NOT have UTF-8 BOM"
    );
    assert!(
        !agent_bytes.contains(&b'\r'),
        "pro-pool-worker.md must use pure LF"
    );
    let agent_str = std::str::from_utf8(&agent_bytes).unwrap();
    assert!(agent_str.starts_with("---\nname: pro-pool-worker\n"));
    assert!(agent_str.contains("claude-subagent.ps1"));

    // Verify ~/.claude/settings.json was NEVER touched
    assert_eq!(fs::read(&settings_path).unwrap(), sentinel);

    // Verify launch_relay_cli cwd validation
    assert!(validate_launch_cwd(&fx.home, None).is_ok());
    assert_eq!(
        validate_launch_cwd(&fx.home, Some("Z:/non-existent-dir-999999")).unwrap_err(),
        "relay.error.invalidLaunchCwd"
    );
    assert_eq!(
        validate_launch_cwd(&fx.home, Some(&settings_path.to_string_lossy())).unwrap_err(),
        "relay.error.invalidLaunchCwd"
    );
    assert_eq!(
        validate_launch_cwd(&fx.home, Some("C:/bad\0cwd")).unwrap_err(),
        "relay.error.invalidLaunchCwd"
    );
}

#[test]
fn headless_orchestrate_cli_protocol_and_relay_switch() {
    let fx = TempFixture::new("cli");
    let now_sec = now_epoch_sec();

    let rec_a = fx.seed_saved_account("Acct A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct B", "u-b", "b@example.invalid", "tb", "rb");
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Acct A",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-a", "emailAddress": "a@example.invalid" },
            "cachedUsageUtilization": {
                "accountUuid": "u-a",
                "fetchedAtMs": now_sec * 1000,
                "utilization": {
                    "five_hour": { "utilization": 98, "resets_at": now_sec + 3600 },
                    "seven_day": { "utilization": 50, "resets_at": now_sec + 86400 }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(
        &db,
        &rec_a.id,
        Some(98),
        Some(now_sec + 3600),
        Some(50),
        Some(now_sec + 86400),
        None,
    );
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(12),
        Some(now_sec + 18000),
        Some(15),
        Some(now_sec + 6 * 86400),
        Some("http://127.0.0.1:7898"),
    );

    let (c1, out1) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"status"}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c1, 0);
    let st: Value = serde_json::from_str(&out1).unwrap();
    assert_eq!(st["ok"], true);
    assert_eq!(st["active"], rec_a.id);
    assert_eq!(st["should_relay_now"], true);

    let (c2, out2) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"relay_switch","rate_limited":true}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c2, 0);
    let sw: Value = serde_json::from_str(&out2).unwrap();
    assert_eq!(sw["switched"], true);
    assert_eq!(sw["target_id"], rec_b.id);
    assert_eq!(
        catalog::current_id(&fx.vault, &fx.home, &db)
            .unwrap()
            .as_deref(),
        Some(rec_b.id.as_str())
    );
    let cfg_after = load_config(&fx.app_data);
    assert_eq!(cfg_after.rotation_tick.get(&rec_b.id), Some(&1));
    assert!(cfg_after
        .cooldown_until_sec
        .get(&rec_a.id)
        .is_some_and(|&t| t > now_sec));

    let (c_bad, _) = orchestrate_handle_json_in(
        b"{bad json",
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c_bad, 2);
    let (c_unk, _) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"bogus"}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c_unk, 2);
    let oversized = vec![b' '; 128 * 1024 + 5];
    let (c_big, out_big) = orchestrate_handle_json_in(
        &oversized,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c_big, 2);
    let err_big: Value = serde_json::from_str(&out_big).unwrap();
    assert_eq!(err_big["reason"], "relay.error.stdinTooLarge");
}

#[test]
fn evaluator_six_strategies_week_low_pace_bands_and_monitor_snapshot() {
    let fx = TempFixture::new("strat6");
    let now_sec = 1_800_000_000u64;

    let rec_act = fx.seed_saved_account("Active 0", "u-0", "0@example.invalid", "t0", "r0");
    let rec_1 = fx.seed_saved_account("WeekLow 1", "u-1", "1@example.invalid", "t1", "r1");
    let rec_2 = fx.seed_saved_account("HighRem 2", "u-2", "2@example.invalid", "t2", "r2");
    let rec_3 = fx.seed_saved_account("Missing7d 3", "u-3", "3@example.invalid", "t3", "r3");

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_act.id,
            "Active 0",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-0", "emailAddress": "0@example.invalid" },
            "cachedUsageUtilization": {
                "accountUuid": "u-0",
                "fetchedAtMs": now_sec * 1000,
                "utilization": {
                    "five_hour": { "utilization": 99, "resets_at": now_sec + 3600 },
                    "seven_day": { "utilization": 60, "resets_at": now_sec + 86400 }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(
        &db,
        &rec_act.id,
        Some(99),
        Some(now_sec + 3600),
        Some(60),
        Some(now_sec + 86400),
        None,
    );
    // rec_1: 5h=10% (<90%), 7d=92% (low band 90..97%), resets in 6h -> WeekLow promoted to Tier 0 in smart/pace!
    // Weekly pace = 8% / 6h = 1.33%/h
    set_summary_quota(
        &db,
        &rec_1.id,
        Some(10),
        Some(now_sec + 7200),
        Some(92),
        Some(now_sec + 6 * 3600),
        None,
    );
    // rec_2: 5h=10%, 7d=15%, resets in 120h -> effectiveRem=85% (best for least_used), pace = 85%/120h = 0.71%/h
    set_summary_quota(
        &db,
        &rec_2.id,
        Some(10),
        Some(now_sec + 7200),
        Some(15),
        Some(now_sec + 120 * 3600),
        None,
    );
    // rec_3: 5h=5%, 7d=None (unknown 7d!) -> MUST be unavailable (Tier 3)
    set_summary_quota(
        &db,
        &rec_3.id,
        Some(5),
        Some(now_sec + 7200),
        None,
        None,
        None,
    );

    let mut cfg = SmartRelayConfig {
        enabled: true,
        strategy: "smart".into(),
        spent_threshold_pct: 98,
        ..SmartRelayConfig::default()
    };
    cfg.rotation_tick.insert(rec_1.id.clone(), 5);
    cfg.rotation_tick.insert(rec_2.id.clone(), 1);
    save_config(&fx.app_data, &cfg).unwrap();

    // 1. smart: rec_1 is WeekLow-promoted to Tier 0 and renews 7d in 6h (< 120h) -> beats rec_2! rec_3 is unavailable.
    let st_smart =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    let acct_3 = st_smart.accounts.iter().find(|a| a.id == rec_3.id).unwrap();
    assert!(acct_3.unavailable);
    assert_eq!(acct_3.tier, "unavailable");
    let snap = monitor_relay_snapshot(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &online::WebMetadata::default(),
        now_sec,
        &[],
    );
    assert!(snap.relay_enabled);
    assert!(snap.should_relay_now);
    assert_eq!(snap.next_relay_name.as_deref(), Some("WeekLow 1"));

    // 2. pace: rec_1 pace (1.33%/h) is in Band 0 while rec_2 (0.71%/h < 1.33*0.9) is in Band 1 -> rec_1 wins!
    cfg.strategy = "pace".into();
    save_config(&fx.app_data, &cfg).unwrap();
    let snap_pace = monitor_relay_snapshot(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &online::WebMetadata::default(),
        now_sec,
        &[],
    );
    assert_eq!(snap_pace.next_relay_name.as_deref(), Some("WeekLow 1"));

    // 3. least_used: WeekLow is NOT promoted in least_used -> rec_2 (Tier 0, 85% rem) beats rec_1 (Tier 1, 8% rem)!
    cfg.strategy = "least_used".into();
    save_config(&fx.app_data, &cfg).unwrap();
    let snap_least = monitor_relay_snapshot(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &online::WebMetadata::default(),
        now_sec,
        &[],
    );
    assert_eq!(snap_least.next_relay_name.as_deref(), Some("HighRem 2"));

    // 4. ordered: WeekLow is NOT promoted in ordered -> rec_2 (Tier 0) beats rec_1 (Tier 1)!
    cfg.strategy = "ordered".into();
    save_config(&fx.app_data, &cfg).unwrap();
    let snap_ordered = monitor_relay_snapshot(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &online::WebMetadata::default(),
        now_sec,
        &[],
    );
    assert_eq!(snap_ordered.next_relay_name.as_deref(), Some("HighRem 2"));

    // 5. rotate: when both are Tier 0 (raise rec_1 7d to 30% used), rec_2 (tick=1) beats rec_1 (tick=5)!
    set_summary_quota(
        &db,
        &rec_1.id,
        Some(10),
        Some(now_sec + 7200),
        Some(30),
        Some(now_sec + 6 * 3600),
        None,
    );
    cfg.strategy = "rotate".into();
    save_config(&fx.app_data, &cfg).unwrap();
    let snap_rotate = monitor_relay_snapshot(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &online::WebMetadata::default(),
        now_sec,
        &[],
    );
    assert_eq!(snap_rotate.next_relay_name.as_deref(), Some("HighRem 2"));
}

#[test]
fn slot_hmac_userid_isolation_continuity_deadletter_scrub_and_exit_pacing() {
    let fx = TempFixture::new("pacing_uid");
    let now_sec = 1_820_000_000u64;

    let rec_a = fx.seed_saved_account("Acct A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct B", "u-b", "b@example.invalid", "tb", "rb");
    let rec_c = fx.seed_saved_account("Acct C", "u-c", "c@example.invalid", "tc", "rc");
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "Acct A",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    let db = database::Database::open(&fx.vault).unwrap();
    for id in [&rec_a.id, &rec_b.id, &rec_c.id] {
        set_summary_quota(
            &db,
            id,
            Some(10),
            Some(now_sec + 7200),
            Some(20),
            Some(now_sec + 86400),
            Some("http://127.0.0.1:7899"),
        );
    }

    let mut cfg = load_config(&fx.app_data);
    cfg.max_same_exit_concurrency = 3;
    save_config(&fx.app_data, &cfg).unwrap();

    // Acquire B and C back-to-back at the same timestamp on shared :7899 exit
    let acq_b1 = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("b1"),
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(acq_b1.ok);
    let jitter_b1 = acq_b1.jitter_ms.unwrap();
    assert!(jitter_b1 <= 250);

    let acq_c1 = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_c.id),
        Some("c1"),
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(acq_c1.ok);
    let jitter_c1 = acq_c1.jitter_ms.unwrap();
    assert!(
        jitter_c1 >= jitter_b1 + 1800 && jitter_c1 <= jitter_b1 + 3400,
        "expected monotonic 1800..=3400ms spacing, got b1={jitter_b1} c1={jitter_c1}"
    );
    assert!(fx.app_data.join("slot_pacing_v1.json").is_file());

    let slot_b = PathBuf::from(acq_b1.slot_dir.unwrap());
    let slot_c = PathBuf::from(acq_c1.slot_dir.unwrap());
    let cj_b1: Value = serde_json::from_slice(&fs::read(slot_b.join(".claude.json")).unwrap()).unwrap();
    let cj_c1: Value = serde_json::from_slice(&fs::read(slot_c.join(".claude.json")).unwrap()).unwrap();
    let uid_b1 = cj_b1["userID"].as_str().unwrap().to_string();
    let uid_c1 = cj_c1["userID"].as_str().unwrap().to_string();
    assert_ne!(uid_b1, uid_c1);
    assert_ne!(uid_b1, "s13-shared-user-id");
    assert_ne!(cj_b1["anonymousId"], cj_c1["anonymousId"]);
    let fst_b1 = cj_b1["firstStartTime"].as_str().unwrap().to_string();

    // Seed GrowthBook cache + 1p_failed_events dead-letter in slot B, release, and re-acquire
    let mut patched_b = cj_b1.as_object().unwrap().clone();
    patched_b.insert("cachedGrowthBookFeatures".into(), json!({"feat_a": true}));
    fs::write(
        slot_b.join(".claude.json"),
        serde_json::to_vec_pretty(&Value::Object(patched_b)).unwrap(),
    )
    .unwrap();
    fs::create_dir_all(slot_b.join("telemetry")).unwrap();
    fs::write(
        slot_b.join("telemetry/1p_failed_events.123.json"),
        b"[]",
    )
    .unwrap();

    slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        None,
        None,
        None,
        now_sec + 10,
        &[],
    )
    .unwrap();
    assert!(!slot_b.join("telemetry/1p_failed_events.123.json").exists());

    // Plant another dead-letter before re-acquire and acquire without proxy to check NO_PROXY + continuity
    fs::write(
        slot_b.join("telemetry/1p_failed_events.456.json"),
        b"[]",
    )
    .unwrap();
    let acq_b2 = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("b2"),
        None,
        None,
        now_sec + 600,
        &[],
    );
    assert!(acq_b2.ok);
    assert!(!slot_b.join("telemetry/1p_failed_events.456.json").exists());
    let cj_b2: Value = serde_json::from_slice(&fs::read(slot_b.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(cj_b2["userID"].as_str().unwrap(), uid_b1);
    assert_eq!(cj_b2["firstStartTime"].as_str().unwrap(), fst_b1);
    assert_eq!(cj_b2["numStartups"].as_u64(), Some(2));
    assert_eq!(cj_b2["cachedGrowthBookFeatures"]["feat_a"], true);
    let settings_b2: Value =
        serde_json::from_slice(&fs::read(slot_b.join("settings.json")).unwrap()).unwrap();
    assert_eq!(
        settings_b2["env"]["NO_PROXY"].as_str(),
        Some("localhost,127.0.0.1,::1")
    );
}

#[test]
fn auto_renewal_never_bricks_evaluator_while_cancelled_expiry_and_plan_downgrade_hold() {
    let fx = TempFixture::new("renewal_plan");
    let now_sec = now_epoch_sec();
    let rec_a = fx.seed_saved_account("AutoRenew Pro", "u-ar", "ar@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Cancelled Pro", "u-cx", "cx@example.invalid", "tb", "rb");
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(
            &rec_a.id,
            "AutoRenew Pro",
            &Policy::all(),
            &Reporter::channel(None),
        )
        .unwrap();

    let db = database::Database::open(&fx.vault).unwrap();
    let fp_a = "1".repeat(64);
    let fp_b = "2".repeat(64);
    let mut sum_a = summary_with_quota(
        Some(15),
        Some(now_sec + 3600),
        Some(25),
        Some(now_sec + 86400),
        true, // stale Ultra no_5h_limit before downgrade
        None,
        None,
        Some("http://127.0.0.1:7899"),
    );
    sum_a.quota_identity = Some(fp_a.clone());
    sum_a.plan = Some("Ultra".into());
    db.set_summary(&rec_a.id, &sum_a).unwrap();

    let mut sum_b = summary_with_quota(
        Some(10),
        Some(now_sec + 3600),
        Some(20),
        Some(now_sec + 86400),
        false,
        None,
        None,
        Some("http://127.0.0.1:7899"),
    );
    sum_b.quota_identity = Some(fp_b.clone());
    sum_b.plan = Some("Pro".into());
    db.set_summary(&rec_b.id, &sum_b).unwrap();

    // Write quota_web_metadata.json: rec_a has elapsed next_renewal (auto-renewing!), rec_b has elapsed access_until (cancelled!)
    private::write(
        &fx.vault.join("quota_web_metadata.json"),
        &serde_json::to_vec_pretty(&json!({
            "version": 1,
            "accounts": {
                fp_a.clone(): {
                    "billing_date_kind": "next_renewal",
                    "billing_date": now_sec - 3600,
                    "billing_observed_at_ms": (now_sec - 7200) * 1000
                },
                fp_b.clone(): {
                    "billing_date_kind": "access_until",
                    "billing_date": now_sec - 3600,
                    "billing_observed_at_ms": (now_sec - 7200) * 1000
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    // Also downgrade rec_a via manual_subscriptions.json plan_by_identity = "Pro"
    let mut manual = crate::identities::subscription::read_store(&fx.vault);
    manual.plan_by_identity.insert(
        fp_a.clone(),
        crate::identities::subscription::ManualPlanEntry {
            manual_plan: "Pro".into(),
            updated_at_ms: now_sec * 1000,
        },
    );
    crate::identities::subscription::write_store(&fx.vault, &manual).unwrap();

    let view = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    let acct_a = view.accounts.iter().find(|a| a.id == rec_a.id).unwrap();
    let acct_b = view.accounts.iter().find(|a| a.id == rec_b.id).unwrap();
    assert!(
        !acct_a.unavailable,
        "auto-renewing next_renewal must NOT become unavailable after charge date"
    );
    assert_eq!(acct_a.tier, "ready");
    assert!(
        !acct_a.no_5h_limit,
        "manual downgrade Ultra -> Pro must clear no_5h_limit"
    );
    assert!(
        acct_b.unavailable,
        "cancelled access_until past billing_date must be unavailable"
    );

    // Verify op == "status" supports non-persisting strategy + threshold_pct overrides
    let (c_ov, out_ov) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"status","strategy":"pace","threshold_pct":90}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c_ov, 0);
    let st_ov: Value = serde_json::from_str(&out_ov).unwrap();
    assert_eq!(st_ov["config"]["strategy"], "pace");
    assert_eq!(st_ov["config"]["spentThresholdPct"], 90);
    assert_eq!(load_config(&fx.app_data).spent_threshold_pct, 98);

    // Verify rested non-Ultra Pro account (quota_5h_rested=true with quota_5h_source=Unknown) stays Tier 0 ready,
    // while invalid/unknown 5h WITHOUT quota_5h_rested becomes unavailable!
    let rec_rested = fx.seed_saved_account("Rested Pro", "u-rp", "rp@example.invalid", "tr", "rr");
    let rec_unverified = fx.seed_saved_account("Unverified Pro", "u-up", "up@example.invalid", "tu", "ru");
    let mut sum_rested = summary_with_quota(
        None,
        None,
        Some(20),
        Some(now_sec + 86400),
        false,
        None,
        None,
        Some("http://127.0.0.1:7899"),
    );
    sum_rested.plan = Some("Pro".into());
    sum_rested.quota_5h_source = Some(crate::quota_core::QuotaSource::Unknown);
    sum_rested.quota_7d_source = Some(crate::quota_core::QuotaSource::ServerAnchor);
    sum_rested.quota_5h_rested = true;
    db.set_summary(&rec_rested.id, &sum_rested).unwrap();

    let mut sum_unverified = sum_rested.clone();
    sum_unverified.quota_5h_rested = false;
    db.set_summary(&rec_unverified.id, &sum_unverified).unwrap();

    let view2 = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    let v_rested = view2.accounts.iter().find(|a| a.id == rec_rested.id).unwrap();
    let v_unverified = view2.accounts.iter().find(|a| a.id == rec_unverified.id).unwrap();
    assert!(!v_rested.unavailable);
    assert_eq!(v_rested.tier, "ready");
    assert_eq!(v_rested.used_5h, Some(0));
    assert_eq!(v_rested.rem_5h, Some(100));
    assert!(v_unverified.unavailable);
    assert_eq!(v_unverified.tier, "unavailable");

    // Verify unsaved "current" triggers should_relay_now on cooldown / expired auth without refresh
    fx.write_live_identity(
        "u-unsaved",
        "unsaved@example.invalid",
        "Unsaved",
        "tok-u",
        "ref-u",
        None,
        None,
        None,
    );
    let mut cfg_cd = load_config(&fx.app_data);
    cfg_cd.cooldown_until_sec.insert("current".into(), now_sec + 600);
    save_config(&fx.app_data, &cfg_cd).unwrap();
    let view_unsaved = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert_eq!(view_unsaved.active, "current");
    assert!(view_unsaved.should_relay_now);
    assert_eq!(view_unsaved.relay_trigger_kind.as_deref(), Some("threshold_reached"));
}

#[test]
fn anti_ban_device_id_parity_proxy_preservation_baga_gc_unsaved_429_and_reset_harvest_finite() {
    let fx = TempFixture::new("hardening_s2");
    let now_sec = now_epoch_sec();

    // 1. Seed Account A (saved WITHOUT proxy in settings.json, carrying shared tainted userID/machineID)
    //    and Account B (saved WITH proxy). Verify Store::switch stamps deterministic per-account
    //    userID/anonymousId/machineID/firstStartTime matching cli-slots 1:1 AND preserves live settings.json proxy!
    let rec_a = fx.seed_saved_account("Acct A", "u-a", "a@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct B", "u-b", "b@example.invalid", "tb", "rb");

    fs::write(
        fx.home.join(".claude/settings.json"),
        serde_json::to_vec_pretty(&json!({
            "theme": "dark",
            "env": {
                "HTTPS_PROXY": "http://127.0.0.1:7899",
                "HTTP_PROXY": "http://127.0.0.1:7899"
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    let mut full_policy = Policy::default();
    full_policy.settings = false;
    store
        .switch(&rec_a.id, "Acct B", &full_policy, &Reporter::channel(None))
        .unwrap();

    let live_cj_a: Value =
        serde_json::from_slice(&fs::read(fx.home.join(".claude.json")).unwrap()).unwrap();
    let live_settings_a: Value =
        serde_json::from_slice(&fs::read(fx.home.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(
        live_settings_a["env"]["HTTPS_PROXY"].as_str(),
        Some("http://127.0.0.1:7899"),
        "Store::switch into archive lacking proxy must preserve live settings.json proxy"
    );

    let db = database::Database::open(&fx.vault).unwrap();
    for id in [&rec_a.id, &rec_b.id] {
        set_summary_quota(
            &db,
            id,
            Some(10),
            Some(now_sec + 7200),
            Some(20),
            Some(now_sec + 86400),
            Some("http://127.0.0.1:7899"),
        );
    }

    // Acquire slot for B and switch main workspace to B later to confirm 1:1 device ID parity
    let acq_b = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("parity"),
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(acq_b.ok);
    let slot_b_dir = PathBuf::from(acq_b.slot_dir.unwrap());
    let slot_cj_b: Value =
        serde_json::from_slice(&fs::read(slot_b_dir.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(slot_cj_b["machineID"].as_str().unwrap().len(), 64);
    assert_ne!(live_cj_a["userID"], slot_cj_b["userID"]);
    assert_ne!(live_cj_a["machineID"], slot_cj_b["machineID"]);
    assert_ne!(live_cj_a["anonymousId"], slot_cj_b["anonymousId"]);

    // 2. Test sync_slot_credentials (None, None) mtime branch when expiresAt is omitted!
    std::thread::sleep(std::time::Duration::from_millis(15));
    fs::write(
        slot_b_dir.join(".credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": {
                "accessToken": "tb-no-exp-rotated",
                "refreshToken": "rb-no-exp-rotated"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    // Strip expiresAt from B's archived credential first by releasing after seeding a no-expiresAt account C
    slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        None,
        None,
        None,
        now_sec + 5,
        &[],
    )
    .unwrap();

    fs::write(
        fx.home.join(".claude/.credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": { "accessToken": "tc-init", "refreshToken": "rc-init" }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-c-noexp", "emailAddress": "c@example.invalid" }
        }))
        .unwrap(),
    )
    .unwrap();
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .save_current("Acct C NoExp", &Policy::all(), &Reporter::channel(None))
        .unwrap();
    let rec_c = store
        .records()
        .into_iter()
        .find(|r| r.name == "Acct C NoExp")
        .unwrap();
    store
        .switch(&rec_b.id, "Acct C NoExp", &Policy::all(), &Reporter::channel(None))
        .unwrap();
    let live_cj_b: Value =
        serde_json::from_slice(&fs::read(fx.home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(live_cj_b["userID"], slot_cj_b["userID"]);
    assert_eq!(live_cj_b["machineID"], slot_cj_b["machineID"]);
    assert_eq!(live_cj_b["anonymousId"], slot_cj_b["anonymousId"]);
    assert_eq!(live_cj_b["firstStartTime"], slot_cj_b["firstStartTime"]);
    assert_eq!(
        derive_slot_first_start_time(&store.key, &rec_b.id, 1_700_000_000),
        derive_slot_first_start_time(&store.key, &rec_b.id, 1_900_000_000)
    );

    let acq_c = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_c.id),
        None,
        Some("http://127.0.0.1:7899"),
        None,
        now_sec + 10,
        &[],
    );
    assert!(acq_c.ok);
    let slot_c_dir = PathBuf::from(acq_c.slot_dir.unwrap());
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::write(
        slot_c_dir.join(".credentials.json"),
        serde_json::to_vec_pretty(&json!({
            "claudeAiOauth": { "accessToken": "tc-rotated", "refreshToken": "rc-rotated" }
        }))
        .unwrap(),
    )
    .unwrap();
    let rel_c = slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_c.id,
        None,
        None,
        None,
        now_sec + 15,
        &[],
    )
    .unwrap();
    assert!(
        rel_c.credentials_synced,
        "sync_slot_credentials (None, None) must sync when slot_mtime_ms >= record.saved_at"
    );

    // 3. Verify fresh (<120s) uncommitted <gen>.baga survives concurrent Store::open!
    let inflight_baga = fx.vault.join("deadbeefdeadbeefdeadbeefdeadbeef.baga");
    private::write(&inflight_baga, b"inflight").unwrap();
    let _concurrent_open = Store::open(&fx.vault, &fx.home).unwrap();
    assert!(
        inflight_baga.exists(),
        "Store::open must NOT unlink <120s uncommitted .baga archives"
    );
    fs::remove_file(&inflight_baga).unwrap();

    // 4. Unsaved "current" 429 relay_switch records cooldown, sunk_order, and no_return_account_id on newly archived record!
    let mut cfg_sink = SmartRelayConfig {
        enabled: true,
        strategy: "reset_harvest".into(),
        rate_limit_mode: "sink_to_end".into(),
        ..SmartRelayConfig::default()
    };
    cfg_sink.rotation_tick.insert(rec_a.id.clone(), 9);
    cfg_sink.cooldown_until_sec.insert(rec_c.id.clone(), now_sec + 900);
    save_config(&fx.app_data, &cfg_sink).unwrap();

    // Also verify merge_config_preserving_runtime keeps higher disk rotation_tick & active cooldown
    let stale_gui = SmartRelayConfig {
        enabled: true,
        strategy: "reset_harvest".into(),
        rate_limit_mode: "sink_to_end".into(),
        rotation_tick: [(rec_a.id.clone(), 2)].into_iter().collect(),
        cooldown_until_sec: [(rec_c.id.clone(), now_sec + 100)].into_iter().collect(),
        ..SmartRelayConfig::default()
    };
    let merged_cfg = super::merge_config_preserving_runtime(&cfg_sink, stale_gui, now_sec);
    assert_eq!(merged_cfg.rotation_tick.get(&rec_a.id), Some(&9));
    assert_eq!(merged_cfg.cooldown_until_sec.get(&rec_c.id), Some(&(now_sec + 900)));

    // Configure rec_a with unbounded reset grant (7d reset +12h) and rec_b with finite reset grant (+20h, 7d +6d)
    let qid_a = set_summary_quota(
        &db,
        &rec_a.id,
        Some(10),
        Some(now_sec + 7200),
        Some(20),
        Some(now_sec + 12 * 3600),
        Some("http://127.0.0.1:7899"),
    )
    .unwrap();
    let qid_b = set_summary_quota(
        &db,
        &rec_b.id,
        Some(10),
        Some(now_sec + 7200),
        Some(20),
        Some(now_sec + 6 * 86400),
        Some("http://127.0.0.1:7899"),
    )
    .unwrap();
    let mut accounts_meta = serde_json::Map::new();
    accounts_meta.insert(
        qid_a,
        json!({
            "metadata_observed_at_ms": now_sec * 1000,
            "manual_resets_observed_at_ms": now_sec * 1000,
            "manual_resets_remaining": 2,
            "manual_resets_valid_until": now_sec + 7200,
            "manual_resets_grants": [
                { "resets_left": 2 }
            ]
        }),
    );
    accounts_meta.insert(
        qid_b,
        json!({
            "metadata_observed_at_ms": now_sec * 1000,
            "manual_resets_observed_at_ms": now_sec * 1000,
            "manual_resets_remaining": 2,
            "manual_resets_valid_until": now_sec + 7200,
            "manual_resets_grant_ends_at": now_sec + 20 * 3600,
            "manual_resets_grants": [
                { "resets_left": 2, "ends_at": now_sec + 20 * 3600 }
            ]
        }),
    );
    private::write(
        &fx.vault.join("quota_web_metadata.json"),
        serde_json::to_vec_pretty(&json!({
            "version": 1,
            "accounts": Value::Object(accounts_meta)
        }))
        .unwrap()
        .as_slice(),
    )
    .unwrap();

    fx.write_live_identity(
        "u-unsaved-429",
        "unsaved429@example.invalid",
        "Unsaved 429",
        "tu429",
        "ru429",
        None,
        None,
        None,
    );
    let sw_unsaved = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some("reset_harvest"),
        None,
        Some(true),
        None,
        now_sec,
        &[],
    );
    assert!(sw_unsaved.switched);
    // Finite expiring grant (rec_b, +20h) MUST beat unbounded grant (rec_a, 7d +12h)!
    assert_eq!(sw_unsaved.target_id.as_deref(), Some(rec_b.id.as_str()));
    let archived_from = sw_unsaved.from_record_id.unwrap();
    assert!(crate::identities::valid_id(&archived_from));
    let post_cfg = load_config(&fx.app_data);
    assert!(post_cfg
        .cooldown_until_sec
        .get(&archived_from)
        .is_some_and(|&ts| ts > now_sec));
    assert!(post_cfg.sunk_order.contains_key(&archived_from));
    assert_eq!(
        post_cfg.no_return_account_id.as_deref(),
        Some(archived_from.as_str())
    );
}

#[test]
fn background_daemon_switch_preserves_adopt_jobs_and_daemon_runtime_files() {
    let fx = TempFixture::new("bg-adopt");
    let now_sec = 1_820_000_000u64;
    save_config(
        &fx.app_data,
        &SmartRelayConfig {
            enabled: true,
            ..SmartRelayConfig::default()
        },
    )
    .unwrap();

    // 1. Seed Account B with an older archived `.claude/jobs/old_b_01/state.json` under Policy::all() (history=false)
    let old_b_job = fx.home.join(".claude/jobs/old_b_01");
    fs::create_dir_all(&old_b_job).unwrap();
    private::write(&old_b_job.join("state.json"), br#"{"state":"completed"}"#).unwrap();
    let rec_b = fx.seed_saved_account(
        "Acct B Ready",
        "u-bg-b",
        "bgb@example.invalid",
        "tb-bg",
        "rb-bg",
    );
    {
        let mut store = Store::open(&fx.vault, &fx.home).unwrap();
        store
            .switch("empty", "Acct B Ready", &Policy::all(), &Reporter::channel(None))
            .unwrap();
    }

    // 2. Seed Account A as active spent account, with daemon runtime files + live `adopt.json`
    let rec_a = fx.seed_saved_account(
        "Acct A Exhausted",
        "u-bg-a",
        "bga@example.invalid",
        "ta-bg",
        "ra-bg",
    );
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(
        &db,
        &rec_a.id,
        Some(100),
        Some(now_sec + 3600),
        Some(98),
        Some(now_sec + 86_400),
        Some("http://127.0.0.1:7899"),
    );
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(10),
        Some(now_sec + 7200),
        Some(15),
        Some(now_sec + 5 * 86_400),
        Some("http://127.0.0.1:7899"),
    );
    {
        let mut store = Store::open(&fx.vault, &fx.home).unwrap();
        store
            .switch(&rec_a.id, "Empty", &Policy::default(), &Reporter::channel(None))
            .unwrap();
    }

    // Write daemon runtime files and jobs under `~/.claude`
    let claude_dir = fx.home.join(".claude");
    fs::create_dir_all(claude_dir.join("daemon")).unwrap();
    private::write(&claude_dir.join("daemon/worker.json"), b"{}").unwrap();
    private::write(&claude_dir.join("daemon.lock"), b"12345").unwrap();
    private::write(&claude_dir.join("daemon.log"), b"daemon alive\n").unwrap();
    private::write(&claude_dir.join("daemon.status.json"), br#"{"pid":12345}"#).unwrap();

    // Check `cleaner_identity::sources` excludes `.claude/daemon*` while `allowed` stays backward-compatible
    let src_all = identity::sources(&fx.home, &Policy::all()).unwrap();
    for rel in [
        ".claude/daemon",
        ".claude/daemon.lock",
        ".claude/daemon.log",
        ".claude/daemon.status.json",
    ] {
        let p = fx.home.join(rel);
        assert!(
            !src_all.iter().any(|s| s.path == p),
            "{rel} must not be archived/cleared on identity switch"
        );
        let legacy_src = identity::Source {
            path: p,
            category: "cache".into(),
            keys: Vec::new(),
        };
        assert!(identity::allowed(&fx.home, &legacy_src));
        assert!(identity::writable_source(&fx.home, &legacy_src).is_none());
    }
    let legacy_settings_src = identity::Source {
        path: fx.home.join(".claude").join("settings.json"),
        category: "settings".into(),
        keys: [
            "env.CLAUDE_CODE_OAUTH_TOKEN",
            "env.ANTHROPIC_API_KEY",
            "env.ANTHROPIC_AUTH_TOKEN",
            "env.HTTP_PROXY",
            "env.HTTPS_PROXY",
            "env.ALL_PROXY",
            "env.GRPC_PROXY",
            "env.NO_PROXY",
            "env.http_proxy",
            "env.https_proxy",
            "env.all_proxy",
            "env.grpc_proxy",
            "env.no_proxy",
            "apiKeyHelper",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
    };
    assert!(
        identity::allowed(&fx.home, &legacy_settings_src),
        "pre-2.20 .baga settings manifest with legacy proxy keys must pass identity::allowed"
    );
    let projected_settings = identity::writable_source(&fx.home, &legacy_settings_src)
        .expect("auth keys must remain writable after stripping legacy proxy keys");
    assert_eq!(
        projected_settings.keys,
        identity::SETTINGS_IDENTITY_KEYS
            .iter()
            .map(|k| (*k).to_string())
            .collect::<Vec<_>>()
    );
    let proxy_only_settings_src = identity::Source {
        path: fx.home.join(".claude").join("settings.json"),
        category: "settings".into(),
        keys: vec!["env.HTTP_PROXY".into(), "env.HTTPS_PROXY".into()],
    };
    assert!(identity::allowed(&fx.home, &proxy_only_settings_src));
    assert!(identity::writable_source(&fx.home, &proxy_only_settings_src).is_none());

    // Populate `.claude/jobs` with live `adopt.json`, state-only jobs, and invalid names
    let live_adopt_dir = claude_dir.join("jobs/a1b2c3d4");
    fs::create_dir_all(&live_adopt_dir).unwrap();
    private::write(
        &live_adopt_dir.join("adopt.json"),
        &serde_json::to_vec(&json!({
            "version": 1,
            "origin": "exit",
            "shells": [{"pid": std::process::id()}],
            "tasks": [{"taskId": "b_shell_1"}]
        }))
        .unwrap(),
    )
    .unwrap();
    for idx in 0..9 {
        let d = claude_dir.join(format!("jobs/st_job_{idx:02}"));
        fs::create_dir_all(&d).unwrap();
        private::write(&d.join("state.json"), br#"{"state":"running"}"#).unwrap();
    }
    let bad_dir = claude_dir.join("jobs/bad space!");
    fs::create_dir_all(&bad_dir).unwrap();
    private::write(&bad_dir.join("adopt.json"), b"{}").unwrap();

    let adopt_jobs = crate::identities::profile::active_adopt_jobs(&fx.home);
    assert_eq!(adopt_jobs.len(), 8);
    assert_eq!(adopt_jobs[0], "a1b2c3d4", "live adopt.json job must sort first");
    assert!(!adopt_jobs.iter().any(|j| j.contains(' ')));

    // 3. Verify `active_sessions_from_processes` maps roles & child_shells accurately
    #[cfg(windows)]
    {
        let bg_proc = ClaudeProcess {
            pid: 51001,
            name: "Claude Code".into(),
            executable: String::new(),
            created: 1,
            role: crate::cleaner::ClaudeProcessRole::BackgroundDaemon,
            child_shells: vec!["cmd.exe".into()],
        };
        let fg_proc = ClaudeProcess {
            pid: 51002,
            name: "Claude Code".into(),
            executable: String::new(),
            created: 2,
            role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
            child_shells: vec!["pwsh.exe".into(), "python.exe".into()],
        };
        let sessions =
            crate::identities::profile::active_sessions_from_processes(&fx.home, &[bg_proc.clone(), fg_proc.clone()]);
        assert_eq!(sessions.len(), 2);
        assert!(sessions[0].background);
        assert!(sessions[0].child_shells.is_empty());
        assert!(!sessions[1].background);
        assert_eq!(sessions[1].child_shells, vec!["pwsh.exe", "python.exe"]);

        // Foreground InteractiveCli blocks relay_switch_in
        let blocked = relay_switch_in(
            &fx.app_data,
            &fx.vault,
            &fx.home,
            Some("smart"),
            Some(95),
            Some(true),
            Some(&rec_a.id),
            now_sec,
            &[fg_proc],
        );
        assert!(!blocked.switched);
        assert_eq!(
            blocked.error.as_deref(),
            Some("请先结束 Claude 进程，再切换身份。")
        );

        // Background-only processes (daemon + pty-host + worker) auto-park and succeed in relay_switch_in!
        let pty_proc = ClaudeProcess {
            pid: 51003,
            name: "Claude Code".into(),
            executable: String::new(),
            created: 3,
            role: crate::cleaner::ClaudeProcessRole::BackgroundPtyHost,
            child_shells: Vec::new(),
        };
        let worker_proc = ClaudeProcess {
            pid: 51004,
            name: "Claude Code".into(),
            executable: String::new(),
            created: 4,
            role: crate::cleaner::ClaudeProcessRole::BackgroundWorker,
            child_shells: Vec::new(),
        };
        let allowed_bg = relay_switch_in(
            &fx.app_data,
            &fx.vault,
            &fx.home,
            Some("smart"),
            Some(95),
            Some(true),
            Some(&rec_a.id),
            now_sec,
            &[bg_proc, pty_proc, worker_proc],
        );
        assert!(allowed_bg.switched, "background-only processes must not block relay_switch_in: {:?}", allowed_bg.error);
        assert_eq!(allowed_bg.target_id.as_deref(), Some(rec_b.id.as_str()));
    }

    // 4. Direct Store::switch with Policy::all() (history=false!) MUST preserve `jobs/a1b2c3d4/adopt.json`
    //    AND merge Account B's archived `.claude/jobs/old_b_01` without failing "身份恢复位置已有数据"!
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(&rec_a.id, "Acct B Ready", &Policy::all(), &Reporter::channel(None))
        .unwrap();
    store
        .switch(&rec_b.id, "Acct A Exhausted", &Policy::all(), &Reporter::channel(None))
        .unwrap();
    assert!(
        live_adopt_dir.join("adopt.json").is_file(),
        "live adopt.json must survive Store::switch even when policy.history == false"
    );
    assert!(
        claude_dir.join("daemon.log").is_file(),
        "daemon.log must remain untouched across Store::switch"
    );
}

#[test]
fn smart_relay_config_validates_and_persists_default_cli_model_and_effort() {
    let fx = TempFixture::new("cli-model-effort");
    let cfg = SmartRelayConfig {
        enabled: true,
        default_cli_model: "  Claude-Opus-5-5 ".into(),
        default_cli_effort: " MAX ".into(),
        ..SmartRelayConfig::default()
    };
    let validated = validate_config_strict(cfg).expect("opus 5.5 + max must validate");
    assert_eq!(validated.default_cli_model, "claude-opus-5-5");
    assert_eq!(validated.default_cli_effort, "max");
    save_config(&fx.app_data, &validated).unwrap();

    let reloaded = load_config(&fx.app_data);
    assert_eq!(reloaded.default_cli_model, "claude-opus-5-5");
    assert_eq!(reloaded.default_cli_effort, "max");

    let bad_model = SmartRelayConfig {
        default_cli_model: "gpt-99".into(),
        ..SmartRelayConfig::default()
    };
    assert_eq!(
        validate_config_strict(bad_model).unwrap_err(),
        "relay.error.invalidCliModel"
    );

    let bad_effort = SmartRelayConfig {
        default_cli_effort: "extreme".into(),
        ..SmartRelayConfig::default()
    };
    assert_eq!(
        validate_config_strict(bad_effort).unwrap_err(),
        "relay.error.invalidCliEffort"
    );
}

#[test]
fn orchestrator_parity_background_inferred5h_current_spent_prefix_merge_and_adopt() {
    let fx = TempFixture::new("parity-v2");
    let now_sec = 1_800_000_000u64;

    // 1. Seed Preferred A (healthy) and Current B (spent / 0% rem), then test:
    //    - current_spent overrides preferred_recovered when current IS spent
    //    - inferred_5h blocks preferred_return_target
    //    - effective_rem == 0 (non-awaiting-100) classifies as magpie_tier 2 ("spent")
    //    - background_only & child_shells with cli_running == false
    let rec_a = fx.seed_saved_account("Pref A", "uuid-pref-a", "pref@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Curr B", "uuid-curr-b", "curr@example.invalid", "tb", "rb");
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(&rec_b.id, "Curr B", &Policy::default(), &Reporter::channel(None))
        .unwrap();

    let db = database::Database::open(&fx.vault).unwrap();
    // Make A healthy & non-inferred; make B 100% 5h used (0% remaining -> tier "spent")
    set_summary_quota(
        &db,
        &rec_a.id,
        Some(15),
        Some(now_sec + 18000),
        Some(20),
        Some(now_sec + 5 * 86400),
        None,
    );
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(100),
        Some(now_sec + 7200),
        Some(40),
        Some(now_sec + 5 * 86400),
        None,
    );
    let mut cfg = SmartRelayConfig {
        enabled: true,
        strategy: "smart".into(),
        preferred_account_id: Some(rec_a.id.clone()),
        return_to_preferred: true,
        preferred_return_threshold_pct: 90,
        spent_threshold_pct: 98,
        ..SmartRelayConfig::default()
    };
    save_config(&fx.app_data, &cfg).unwrap();

    let bg_only_procs = vec![ClaudeProcess {
        pid: 41001,
        name: "Claude Code".into(),
        executable: String::new(),
        created: 10,
        role: crate::cleaner::ClaudeProcessRole::BackgroundDaemon,
        child_shells: vec!["pwsh.exe".into()],
    }];
    let st_spent =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &bg_only_procs)
            .unwrap();
    assert!(st_spent.running);
    assert!(!st_spent.cli_running);
    assert!(st_spent.background_only);
    assert!(st_spent.child_shells.is_empty());

    let fg_child_procs = vec![ClaudeProcess {
        pid: 41002,
        name: "Claude Code".into(),
        executable: String::new(),
        created: 11,
        role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
        child_shells: vec!["pwsh.exe".into()],
    }];
    let st_fg =
        orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &fg_child_procs)
            .unwrap();
    assert!(st_fg.cli_running);
    assert!(!st_fg.background_only);
    assert_eq!(st_fg.child_shells, vec!["pwsh.exe".to_string()]);
    assert!(st_spent.should_relay_now);
    assert_eq!(
        st_spent.relay_trigger_kind.as_deref(),
        Some("threshold_reached"),
        "current spent must override preferred_recovered"
    );
    let view_b = st_spent.accounts.iter().find(|a| a.id == rec_b.id).unwrap();
    assert_eq!(view_b.tier, "spent");

    // When B becomes healthy and A's 5h window is ResetInferred (inferred_5h), A must NOT trigger preferred_recovered.
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(25),
        Some(now_sec + 18000),
        Some(25),
        Some(now_sec + 5 * 86400),
        None,
    );
    let mut sum_a = db.summaries().unwrap().remove(&rec_a.id).unwrap();
    sum_a.quota_5h_used = Some(0);
    sum_a.quota_5h_source = Some(crate::identities::profile::QuotaSource::ResetInferred);
    sum_a.quota_7d_used = Some(20);
    sum_a.quota_7d_reset_at = Some(now_sec + 5 * 86400);
    db.set_summary(&rec_a.id, &sum_a).unwrap();
    let st_inf5 = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert!(!st_inf5.should_relay_now);

    // 2. pro_pool_worker_markdown & launch_relay_cli_in -NoProfile & poll_until_non_slot_stopped
    let md = super::tooling::pro_pool_worker_markdown();
    assert!(md.contains("model: claude-haiku-5-5"));
    assert!(md.contains("effort: low"));
    assert!(md.contains("tools: PowerShell, Bash, Read, Grep, Glob"));
    assert!(md.contains("```bash\npwsh -NoProfile -ExecutionPolicy Bypass"));

    let mut calls = 0u8;
    let fake_proc = ClaudeProcess {
        pid: 42001,
        name: "claude.exe".into(),
        executable: String::new(),
        created: 1,
        role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
        child_shells: Vec::new(),
    };
    let cleared = super::tooling::poll_until_non_slot_stopped(
        &fx.app_data,
        vec![fake_proc.clone()],
        300,
        20,
        || {
            calls += 1;
            if calls >= 2 {
                Vec::new()
            } else {
                vec![fake_proc.clone()]
            }
        },
    );
    assert!(cleared);
    assert!(!super::tooling::poll_until_non_slot_stopped(
        &fx.app_data,
        vec![fake_proc.clone()],
        40,
        15,
        || vec![fake_proc.clone()],
    ));

    // Deferred cooldown persistence: when relay_switch_in is blocked by a running interactive CLI process,
    // cooldown_until_sec must NOT be persisted to disk!
    let mut clear_src_a = db.summaries().unwrap().remove(&rec_a.id).unwrap();
    clear_src_a.quota_5h_source = None;
    clear_src_a.quota_5h_used = Some(10);
    clear_src_a.quota_5h_reset_at = Some(now_sec + 18000);
    clear_src_a.quota_7d_used = Some(10);
    clear_src_a.quota_7d_reset_at = Some(now_sec + 5 * 86400);
    db.set_summary(&rec_a.id, &clear_src_a).unwrap();
    let fg_blocker = vec![fake_proc];
    let blocked_res = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        None,
        Some(true),
        Some(&rec_b.id),
        now_sec,
        &fg_blocker,
    );
    assert!(!blocked_res.ok && !blocked_res.switched);
    assert_eq!(
        blocked_res.error.as_deref(),
        Some("请先结束 Claude 进程，再切换身份。")
    );
    assert!(!load_config(&fx.app_data)
        .cooldown_until_sec
        .contains_key(&rec_b.id));

    // When store.switch succeeds with rate_limited == Some(true) even when targeting preferred A, reason is "rate_limited".
    let ok_rl = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        None,
        Some(true),
        Some(&rec_b.id),
        now_sec,
        &[],
    );
    assert!(ok_rl.ok && ok_rl.switched);
    assert_eq!(ok_rl.reason.as_deref(), Some("rate_limited"));
    assert!(load_config(&fx.app_data)
        .cooldown_until_sec
        .contains_key(&rec_b.id));

    // 3. merge_config_preserving_runtime: newer disk ticks preserve cooldown/no_return; equal ticks honor GUI clear.
    let mut disk = SmartRelayConfig::default();
    disk.rotation_tick.insert(rec_a.id.clone(), 5);
    disk.sunk_order.insert(rec_b.id.clone(), 2);
    disk.cooldown_until_sec
        .insert(rec_b.id.clone(), now_sec + 600);
    disk.no_return_account_id = Some(rec_b.id.clone());
    disk.no_return_until_sec = now_sec + 600;
    let mut incoming_stale = SmartRelayConfig::default();
    incoming_stale.rotation_tick.insert(rec_a.id.clone(), 4);
    let merged_stale = super::merge_config_preserving_runtime(&disk, incoming_stale, now_sec);
    assert_eq!(merged_stale.rotation_tick.get(&rec_a.id), Some(&5));
    assert_eq!(merged_stale.sunk_order.get(&rec_b.id), Some(&2));
    assert_eq!(
        merged_stale.cooldown_until_sec.get(&rec_b.id),
        Some(&(now_sec + 600))
    );
    assert_eq!(
        merged_stale.no_return_account_id.as_deref(),
        Some(rec_b.id.as_str())
    );
    let mut incoming_gui_clear = SmartRelayConfig::default();
    incoming_gui_clear.rotation_tick.insert(rec_a.id.clone(), 5);
    let merged_gui_clear =
        super::merge_config_preserving_runtime(&disk, incoming_gui_clear, now_sec);
    assert!(!merged_gui_clear.cooldown_until_sec.contains_key(&rec_b.id));

    // 4. slot_acquire_in 8+ hex prefix lookup (note rec_a is active so target rec_b via 8-char prefix!)
    cfg = load_config(&fx.app_data);
    cfg.cooldown_until_sec.clear();
    save_config(&fx.app_data, &cfg).unwrap();
    let short_bad = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id[..7]),
        None,
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(!short_bad.ok);
    let prefix_ok = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id[..8]),
        None,
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(prefix_ok.ok);
    assert_eq!(prefix_ok.record_id.as_deref(), Some(rec_b.id.as_str()));
    let _ = slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        None,
        None,
        None,
        now_sec,
        &[],
    );

    // 5. adopt.json dead/stopped filtering + active agent referenced session preservation under Policy::all() (history=false)
    let dead_job = fx.home.join(".claude/jobs/dead_job_1");
    fs::create_dir_all(&dead_job).unwrap();
    private::write(
        &dead_job.join("adopt.json"),
        br#"{"version":1,"shells":[{"pid":99999999}],"agents":[]}"#,
    )
    .unwrap();
    private::write(&dead_job.join("state.json"), br#"{"state":"stopped"}"#).unwrap();

    let live_agent_job = fx.home.join(".claude/jobs/live_agent_1");
    fs::create_dir_all(&live_agent_job).unwrap();
    fs::create_dir_all(fx.home.join(".claude/projects/proj_live")).unwrap();
    let ref_jsonl = fx
        .home
        .join(".claude/projects/proj_live/sess_ref_123.jsonl");
    let stale_jsonl = fx
        .home
        .join(".claude/projects/proj_live/sess_stale_999.jsonl");
    private::write(&ref_jsonl, b"{\"type\":\"user\"}\n").unwrap();
    private::write(&stale_jsonl, b"{\"type\":\"user\"}\n").unwrap();
    private::write(
        &live_agent_job.join("adopt.json"),
        br#"{"version":1,"agents":[{"sessionId":"sess_ref_123","status":"running"}]}"#,
    )
    .unwrap();

    let active_jobs = crate::identities::profile::active_adopt_jobs(&fx.home);
    assert!(active_jobs.contains(&"live_agent_1".to_string()));
    assert!(!active_jobs.contains(&"dead_job_1".to_string()));

    store
        .switch(&rec_b.id, "Pref A", &Policy::all(), &Reporter::channel(None))
        .unwrap();
    assert!(live_agent_job.join("adopt.json").is_file());
    assert!(
        ref_jsonl.is_file(),
        "referenced subagent/session jsonl must be preserved when policy.history == false"
    );
    assert!(
        !stale_jsonl.exists(),
        "unreferenced stale jsonl should still be cleared under policy.history == false"
    );
}

#[test]
fn relay_handoff_mode_config_slots_skills_copy_and_relay_switch_handoff_paths() {
    let fx = TempFixture::new("handoff-slots");

    // 1. SmartRelayConfig relayHandoffMode strict & lenient validation + alias
    let mut cfg = SmartRelayConfig::default();
    assert_eq!(cfg.relay_handoff_mode, "clean_handoff");
    cfg.relay_handoff_mode = "FORK_RESUME".into();
    let valid = validate_config_strict(cfg.clone()).unwrap();
    assert_eq!(valid.relay_handoff_mode, "fork_resume");
    cfg.relay_handoff_mode = "invalid_mode".into();
    assert!(validate_config_strict(cfg).is_err());

    let alias_json = json!({
        "enabled": true,
        "relay_handoff_mode": "fork_resume"
    });
    let parsed: SmartRelayConfig = serde_json::from_value(alias_json).unwrap();
    assert_eq!(parsed.relay_handoff_mode, "fork_resume");

    private::write(
        &fx.app_data.join(config::SMART_RELAY_FILE),
        br#"{"schema":1,"relayHandoffMode":"bogus_value"}"#,
    )
    .unwrap();
    assert_eq!(load_config(&fx.app_data).relay_handoff_mode, "clean_handoff");

    // 2. slots.rs: skills NEVER uses NTFS junction even without synced/, and same_owner=false if UUID missing
    let rec_a = fx.seed_saved_account(
        "Slot A",
        "uuid-slot-a",
        "slot-a@example.invalid",
        "tok-a",
        "ref-a",
    );
    let rec_b = fx.seed_saved_account(
        "Slot B",
        "uuid-slot-b",
        "slot-b@example.invalid",
        "tok-b",
        "ref-b",
    );
    // Switch active back to rec_a so rec_b is an idle secondary slot ready for slot_acquire_in.
    {
        let mut store = Store::open(&fx.vault, &fx.home).unwrap();
        store
            .switch(&rec_a.id, "Slot B", &Policy::default(), &Reporter::channel(None))
            .unwrap();
    }

    let skills_dir = fx.home.join(".claude/skills/plain-skill");
    private::directory(&skills_dir).unwrap();
    private::write(&skills_dir.join("SKILL.md"), b"plain skill").unwrap();

    let slot_dir_b = fx.app_data.join("cli-slots").join(&rec_b.id);
    let now_sec = 1_800_000_000;
    let acq = slot_acquire_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some(&rec_b.id),
        Some("tag"),
        Some("http://127.0.0.1:7899"),
        None,
        now_sec,
        &[],
    );
    assert!(acq.ok, "acq failed: {acq:?}");
    let manifest_text = fs::read_to_string(slot_dir_b.join(".slot-manifest.json")).unwrap();
    let manifest: Value = serde_json::from_str(&manifest_text).unwrap();
    assert_eq!(manifest["links"]["skills"].as_str(), Some("copy"));
    assert!(!crate::cleaner::linked(
        &fs::symlink_metadata(slot_dir_b.join("skills")).unwrap()
    ));
    let _ = slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        None,
        None,
        None,
        now_sec,
        &[],
    );

    // Pre-seed stale firstStartTime with missing oauthAccount -> same_owner must be false & overwritten deterministically.
    private::write(
        &slot_dir_b.join(".claude.json"),
        br#"{"firstStartTime":"1999-01-01T00:00:00.000Z","numStartups":99}"#,
    )
    .unwrap();
    {
        let store = Store::open(&fx.vault, &fx.home).unwrap();
        let rec_b_fresh = store.records().into_iter().find(|r| r.id == rec_b.id).unwrap();
        slots::materialize_slot_dir(
            &fx.app_data,
            &store,
            &rec_b_fresh,
            Some("http://127.0.0.1:7899"),
            None,
            0,
            now_sec,
        )
        .unwrap();
    }
    let slot_cj: Value =
        serde_json::from_slice(&fs::read(slot_dir_b.join(".claude.json")).unwrap()).unwrap();
    assert_ne!(
        slot_cj["firstStartTime"].as_str(),
        Some("1999-01-01T00:00:00.000Z")
    );
    assert_eq!(slot_cj["numStartups"].as_u64(), Some(1));
    let _ = slot_release_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        &rec_b.id,
        None,
        None,
        None,
        now_sec,
        &[],
    );

    // 3. relay_switch_in populates handoff_md_path and handoff_json_path on successful switch
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store
        .switch(&rec_a.id, "Slot B", &Policy::default(), &Reporter::channel(None))
        .unwrap();
    drop(store);
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(
        &db,
        &rec_a.id,
        Some(99),
        Some(now_sec + 3600),
        Some(20),
        Some(now_sec + 86400),
        None,
    );
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(10),
        Some(now_sec + 3600),
        Some(10),
        Some(now_sec + 86400),
        None,
    );
    drop(db);

    let pre_ev = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    let res = relay_switch_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        Some("smart"),
        Some(98),
        Some(true),
        Some(&rec_a.id),
        now_sec,
        &[],
    );
    assert!(
        res.ok && res.switched,
        "relay switch failed: {res:?}; accounts={:?}; ranked={:?}; active={:?}",
        pre_ev.accounts,
        pre_ev.ranked_auto_targets,
        pre_ev.active_slots
    );
    let md = res.handoff_md_path.expect("handoff_md_path");
    let json = res.handoff_json_path.expect("handoff_json_path");
    assert!(PathBuf::from(&md).is_file());
    assert!(PathBuf::from(&json).is_file());
}

#[test]
fn spent_thresholds_80_85_and_default_concurrency_one() {
    let fx = TempFixture::new("thresh-80-85-conc");
    let now_sec = now_epoch_sec();

    let defaults = SmartRelayConfig::default();
    assert_eq!(defaults.spent_threshold_pct, 98);
    assert_eq!(defaults.max_same_exit_concurrency, 1);

    // Strict & lenient validation for all VALID_SPENT_THRESHOLDS including 80 and 85
    for threshold in [80u8, 85, 90, 95, 98, 100] {
        let mut cfg = SmartRelayConfig::default();
        cfg.spent_threshold_pct = threshold;
        let validated = validate_config_strict(cfg).expect("valid threshold");
        assert_eq!(validated.spent_threshold_pct, threshold);
        save_config(&fx.app_data, &validated).unwrap();
        assert_eq!(load_config(&fx.app_data).spent_threshold_pct, threshold);
    }
    for bad_threshold in [75u8, 89, 101] {
        let mut cfg = SmartRelayConfig::default();
        cfg.spent_threshold_pct = bad_threshold;
        assert_eq!(
            validate_config_strict(cfg.clone()).unwrap_err(),
            "relay.error.invalidThreshold"
        );
        save_config(&fx.app_data, &cfg).unwrap();
        assert_eq!(load_config(&fx.app_data).spent_threshold_pct, 98);
    }

    // Strict & lenient validation for max_same_exit_concurrency in 1..=5
    for conc in 1u8..=5 {
        let mut cfg = SmartRelayConfig::default();
        cfg.max_same_exit_concurrency = conc;
        let validated = validate_config_strict(cfg).expect("valid concurrency");
        assert_eq!(validated.max_same_exit_concurrency, conc);
        save_config(&fx.app_data, &validated).unwrap();
        assert_eq!(load_config(&fx.app_data).max_same_exit_concurrency, conc);
    }
    for (bad_conc, expected_clamped) in [(0u8, 1u8), (6u8, 5u8)] {
        let mut cfg = SmartRelayConfig::default();
        cfg.max_same_exit_concurrency = bad_conc;
        assert_eq!(
            validate_config_strict(cfg.clone()).unwrap_err(),
            "relay.error.invalidConcurrency"
        );
        save_config(&fx.app_data, &cfg).unwrap();
        assert_eq!(
            load_config(&fx.app_data).max_same_exit_concurrency,
            expected_clamped
        );
    }

    // Evaluator threshold checks at 80% and 85%
    let rec_a = fx.seed_saved_account("Active A", "u-th-a", "tha@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Standby B", "u-th-b", "thb@example.invalid", "tb", "rb");
    {
        let mut store = Store::open(&fx.vault, &fx.home).unwrap();
        store
            .switch(&rec_a.id, "Active A", &Policy::default(), &Reporter::channel(None))
            .unwrap();
    }
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(
        &db,
        &rec_b.id,
        Some(10),
        Some(now_sec + 14_400),
        Some(15),
        Some(now_sec + 5 * 86_400),
        None,
    );

    let set_live_a_5h = |used_5h: u8| {
        fs::write(
            fx.home.join(".claude.json"),
            serde_json::to_vec_pretty(&json!({
                "oauthAccount": { "accountUuid": "u-th-a", "emailAddress": "tha@example.invalid" },
                "cachedUsageUtilization": {
                    "accountUuid": "u-th-a",
                    "fetchedAtMs": now_sec * 1000,
                    "utilization": {
                        "five_hour": { "utilization": used_5h, "resets_at": now_sec + 3600 },
                        "seven_day": { "utilization": 20, "resets_at": now_sec + 5 * 86_400 }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();
        set_summary_quota(
            &db,
            &rec_a.id,
            Some(used_5h),
            Some(now_sec + 3600),
            Some(20),
            Some(now_sec + 5 * 86_400),
            None,
        );
    };

    // Threshold 80%: 79% is ready; 80% is spent & triggers relay
    let mut cfg = SmartRelayConfig {
        enabled: true,
        strategy: "smart".into(),
        spent_threshold_pct: 80,
        ..SmartRelayConfig::default()
    };
    save_config(&fx.app_data, &cfg).unwrap();

    set_live_a_5h(79);
    let st_79 = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert!(!st_79.should_relay_now);
    let view_a_79 = st_79.accounts.iter().find(|a| a.id == rec_a.id).unwrap();
    assert!(!view_a_79.spent);
    assert_eq!(view_a_79.tier, "ready");

    set_live_a_5h(80);
    let st_80 = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert!(st_80.should_relay_now);
    assert_eq!(st_80.relay_trigger_kind.as_deref(), Some("threshold_reached"));
    let view_a_80 = st_80.accounts.iter().find(|a| a.id == rec_a.id).unwrap();
    assert!(view_a_80.spent);
    assert_eq!(view_a_80.tier, "spent");

    // Threshold 85%: 80% and 84% remain ready; 85% is spent & triggers relay
    cfg.spent_threshold_pct = 85;
    save_config(&fx.app_data, &cfg).unwrap();

    for pct in [80u8, 84] {
        set_live_a_5h(pct);
        let st = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
        assert!(!st.should_relay_now, "pct={pct} must stay below 85% threshold");
        let view_a = st.accounts.iter().find(|a| a.id == rec_a.id).unwrap();
        assert!(!view_a.spent);
        assert_eq!(view_a.tier, "ready");
    }

    set_live_a_5h(85);
    let st_85 = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert!(st_85.should_relay_now);
    assert_eq!(st_85.relay_trigger_kind.as_deref(), Some("threshold_reached"));
    let view_a_85 = st_85.accounts.iter().find(|a| a.id == rec_a.id).unwrap();
    assert!(view_a_85.spent);
    assert_eq!(view_a_85.tier, "spent");

    // Non-persisting status threshold_pct overrides accept 80 and 85
    cfg.spent_threshold_pct = 98;
    save_config(&fx.app_data, &cfg).unwrap();
    set_live_a_5h(80);
    let (c80, out80) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"status","threshold_pct":80}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c80, 0);
    let v80: Value = serde_json::from_str(&out80).unwrap();
    assert_eq!(v80["config"]["spentThresholdPct"], 80);
    assert_eq!(v80["should_relay_now"], true);

    set_live_a_5h(85);
    let (c85, out85) = orchestrate_handle_json_in(
        br#"{"schema":1,"op":"status","threshold_pct":85}"#,
        &fx.app_data,
        &fx.vault,
        &fx.home,
        now_sec,
        &[],
    );
    assert_eq!(c85, 0);
    let v85: Value = serde_json::from_str(&out85).unwrap();
    assert_eq!(v85["config"]["spentThresholdPct"], 85);
    assert_eq!(v85["should_relay_now"], true);
    assert_eq!(load_config(&fx.app_data).spent_threshold_pct, 98);
}

#[test]
fn cooldown_bumps_tick_survives_gui_save_and_clear_cooldown_converges() {
    let fx = TempFixture::new("cd-converge");
    let now_sec = now_epoch_sec();
    let rec_a = fx.seed_saved_account("Acct-A", "u-cd-a", "cda@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct-B", "u-cd-b", "cdb@example.invalid", "tb", "rb");
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(&db, &rec_a.id, Some(10), Some(now_sec + 3600), Some(10), Some(now_sec + 86400), None);
    set_summary_quota(&db, &rec_b.id, Some(15), Some(now_sec + 3600), Some(15), Some(now_sec + 86400), None);

    let mut cfg = SmartRelayConfig::default();
    cfg.cooldown_until_sec.insert("current".into(), now_sec + 120);
    cfg.rotation_tick.insert(rec_a.id.clone(), 4);
    save_config(&fx.app_data, &cfg).unwrap();

    // apply_slot_failure_cooldown bumps rotation_tick[rec_a] and removes stray "current".
    let cd = super::slots::apply_slot_failure_cooldown(
        &fx.app_data,
        &fx.vault,
        &rec_a.id,
        Some(true),
        None,
        Some(300),
        now_sec,
    );
    assert_eq!(cd, Some(now_sec + 300));
    let disk_after_cd = load_config(&fx.app_data);
    assert!(!disk_after_cd.cooldown_until_sec.contains_key("current"));
    assert_eq!(disk_after_cd.rotation_tick.get(&rec_a.id).copied(), Some(5));

    // Stale GUI save carrying old tick 4 must preserve rec_a cooldown.
    let mut stale_gui = SmartRelayConfig::default();
    stale_gui.rotation_tick.insert(rec_a.id.clone(), 4);
    let merged_stale = super::merge_config_preserving_runtime(&disk_after_cd, stale_gui, now_sec);
    assert_eq!(
        merged_stale.cooldown_until_sec.get(&rec_a.id).copied(),
        Some(now_sec + 300)
    );

    // clear_cooldown_in clears cooldown + matching no_return and bumps rotation_tick again.
    let mut with_no_return = disk_after_cd.clone();
    with_no_return.no_return_account_id = Some(rec_a.id.clone());
    with_no_return.no_return_until_sec = now_sec + 600;
    save_config(&fx.app_data, &with_no_return).unwrap();

    let view = clear_cooldown_in(&fx.app_data, &fx.vault, &fx.home, &rec_a.id, now_sec, &[])
        .expect("clear cooldown");
    assert!(!view.config.cooldown_until_sec.contains_key(&rec_a.id));
    assert!(view.config.no_return_account_id.is_none());
    assert_eq!(view.config.no_return_until_sec, 0);
    assert_eq!(view.config.rotation_tick.get(&rec_a.id).copied(), Some(6));
    assert!(clear_cooldown_in(&fx.app_data, &fx.vault, &fx.home, "current", now_sec, &[]).is_err());
}

#[test]
fn loopback_proxy_variants_unify_and_orchestrator_state_exposes_cli_default_proxy() {
    let fx = TempFixture::new("loopback-cli-def");
    let now_sec = now_epoch_sec();

    for raw in [
        "http://localhost:7899",
        "http://127.0.0.1:7899",
        "http://[::1]:7899",
        "http://::1:7899",
        "socks5h://[::1]:7899",
    ] {
        assert_eq!(
            super::config::exit_key(Some(raw)),
            "127.0.0.1:7899",
            "exit_key mismatch for {raw}"
        );
    }
    for http_raw in [
        "http://localhost:7899",
        "http://127.0.0.1:7899",
        "http://[::1]:7899",
        "http://::1:7899",
    ] {
        assert_eq!(
            super::config::normalize_proxy_to_http(http_raw).as_deref(),
            Some("http://127.0.0.1:7899"),
            "normalize_proxy_to_http mismatch for {http_raw}"
        );
    }

    fs::write(
        fx.home.join(".claude/settings.local.json"),
        br#"{"env":{"HTTPS_PROXY":"http://user:pw@[::1]:18080"}}"#,
    )
    .unwrap();
    let st_cred = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert!(st_cred.cli_default_proxy.is_none());

    fs::write(
        fx.home.join(".claude/settings.local.json"),
        br#"{"env":{"HTTPS_PROXY":"http://[::1]:18080"}}"#,
    )
    .unwrap();
    let st = orchestrator_state_in(&fx.app_data, &fx.vault, &fx.home, now_sec, &[]).unwrap();
    assert_eq!(st.cli_default_proxy.as_deref(), Some("http://127.0.0.1:18080"));
}

#[test]
fn relay_switch_with_reason_records_explicit_handoff_reason_and_pro_pool_md_uses_default_1() {
    let fx = TempFixture::new("handoff-reason");
    let now_sec = now_epoch_sec();
    let md = super::tooling::pro_pool_worker_markdown();
    assert!(md.contains("default 1"), "expected default 1 in markdown");
    assert!(!md.contains("default 2"), "stale default 2 must be updated");

    let rec_a = fx.seed_saved_account("Acct-A", "u-hr-a", "hra@example.invalid", "ta", "ra");
    let rec_b = fx.seed_saved_account("Acct-B", "u-hr-b", "hrb@example.invalid", "tb", "rb");

    // Put rec_a live + synthetic transcript so Store::switch captures and commits a handoff.
    let mut store = Store::open(&fx.vault, &fx.home).unwrap();
    store.switch(&rec_a.id, "Empty", &Policy::all(), &Reporter::channel(None)).unwrap();
    drop(store);
    let db = database::Database::open(&fx.vault).unwrap();
    set_summary_quota(&db, &rec_a.id, Some(90), Some(now_sec + 3600), Some(10), Some(now_sec + 86400), None);
    set_summary_quota(&db, &rec_b.id, Some(5), Some(now_sec + 3600), Some(5), Some(now_sec + 86400), None);
    drop(db);
    fs::write(
        fx.home.join(".claude.json"),
        serde_json::to_vec_pretty(&json!({
            "oauthAccount": { "accountUuid": "u-hr-a", "emailAddress": "hra@example.invalid" },
            "cachedUsageUtilization": {
                "accountUuid": "u-hr-a",
                "fetchedAtMs": now_sec * 1000,
                "utilization": {
                    "five_hour": { "utilization": 90, "resets_at": now_sec + 3600 },
                    "seven_day": { "utilization": 10, "resets_at": now_sec + 86400 }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let sess_dir = fx.home.join(".claude/projects/demo");
    fs::create_dir_all(&sess_dir).unwrap();
    fs::write(
        sess_dir.join("33333333-4444-4555-8666-777777777777.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"user","message":{"role":"user","content":"Test handoff"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Step done."}]}})
        ),
    )
    .unwrap();

    let res = super::tooling::relay_switch_with_reason_in(
        &fx.app_data,
        &fx.vault,
        &fx.home,
        None,
        None,
        Some(false),
        None,
        Some("external_worker_timeout"),
        now_sec,
        &[],
    );
    assert!(res.ok && res.switched, "switch result: {res:?}");
    let latest = crate::identities::handoff::latest_handoff_in(&fx.app_data, now_sec)
        .unwrap()
        .expect("latest handoff");
    assert_eq!(latest.handoff_reason.as_deref(), Some("external_worker_timeout"));
}

