// [INPUT]: vault（records/summaries/web_metadata/manual_subscriptions）、SmartRelayConfig、cli-slots 实时会话与当前时间锚点。
// [OUTPUT]: 与前端 src/smart-relay-model.ts 1:1 对齐的 6 策略评估器（Magpie 3-Tier 含 0% 余量 Tier 2 spent + WeekLow 提拔 + 10% pace 分带 + 24h SoonReset + Strategy A1 Reset-Card 计数 + 阈值感知 awaiting_manual_reset + 单向防回跳锁 + current_spent 优先于 preferred_recovered 且含 inferred_5h/inferred_7d 首选滞回守卫 + affinity_mode 守卫 + background_only/child_shells 状态投影）及单次评估共享上下文的 HUD 轻量遥测快照（monitor_relay_snapshot_with_context）。
// [POS]: orchestrator 纯计算与状态投影层；只读聚合身份与配额状态，不修改归档或槽位凭据。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{
    config::{
        load_config, normalize_proxy_to_http, read_claude_dir_http_proxy, validate_http_proxy,
        SmartRelayConfig, CLI_SLOTS_DIR, GRANT_EXPIRING_SOON_SEC, SLOT_DRIFTED_FILE,
        SMART_RELAY_FILE, SMART_RELAY_MAX_BYTES, VALID_SPENT_THRESHOLDS, VALID_STRATEGIES,
    },
    slots::{scan_active_slots, slot_sessions_by_record},
};
use crate::{
    cleaner::{self, ClaudeProcess},
    identities::{catalog, database, online, private, profile, subscription},
    quota_core::QuotaSource,
};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
};

const LOW_SHARE_PCT: u8 = 90;
const FRESH_WEEKLY_PACE: f64 = 100.0 / 168.0;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolSummary {
    pub ready_count: usize,
    pub low_count: usize,
    pub spent_count: usize,
    pub unavailable_count: usize,
    pub cooldown_count: usize,
    pub included_count: usize,
    #[serde(rename = "avg5hRemainingPct")]
    pub avg_5h_remaining_pct: u8,
    pub avg_rem_7d_pct: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soonest_reset_sec: Option<u64>,
    pub total_manual_resets_remaining: u32,
    pub awaiting_reset_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountView {
    pub id: String,
    pub record_id: String,
    pub name: String,
    pub is_current: bool,
    pub tier: String,
    pub no_5h_limit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_5h: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_7d: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rem_5h: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rem_7d: Option<u8>,
    pub effective_rem: u8,
    pub manual_resets_remaining: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub earliest_reset_grant_ends_at: Option<u64>,
    pub expiring_grant_soon: bool,
    pub awaiting_manual_reset: bool,
    pub spent: bool,
    pub unavailable: bool,
    pub excluded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_until_sec: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_reset_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_reset_at: Option<u64>,
    pub urgency_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    pub slot_pids: Vec<i32>,
    pub drifted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResetCardAccountView {
    pub id: String,
    pub record_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_used: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_reset_at: Option<u64>,
    pub manual_resets_remaining: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub earliest_reset_grant_ends_at: Option<u64>,
    pub awaiting_manual_reset: bool,
    pub tier: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSlotView {
    pub record_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquired_at_sec: Option<u64>,
    pub live_pids: Vec<i32>,
    pub lease_active: bool,
    pub drifted: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct OrchestratorStateView {
    pub schema: u8,
    pub ok: bool,
    pub config_persisted: bool,
    pub active: String,
    pub active_name: String,
    pub running: bool,
    pub cli_running: bool,
    pub background_only: bool,
    pub child_shells: Vec<String>,
    pub should_relay_now: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_trigger_kind: Option<String>,
    pub config: SmartRelayConfig,
    pub pool: PoolSummary,
    pub accounts: Vec<AccountView>,
    pub ranked_auto_targets: Vec<String>,
    pub slot_sessions: BTreeMap<String, Vec<profile::ActiveSession>>,
    pub awaiting_reset_accounts: Vec<ResetCardAccountView>,
    pub reset_card_accounts: Vec<ResetCardAccountView>,
    pub active_slots: Vec<ActiveSlotView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MonitorRelaySnapshot {
    pub active_slot_count: usize,
    pub manual_resets_remaining: u32,
    pub pool_manual_resets_remaining: u32,
    pub awaiting_reset_count: usize,
    pub relay_enabled: bool,
    pub relay_strategy: String,
    pub next_relay_name: Option<String>,
    pub next_relay_email: Option<String>,
    pub next_relay_rem_pct: Option<u8>,
    pub should_relay_now: bool,
}

pub(super) struct EvaluatedPool {
    pub active: String,
    pub active_name: String,
    pub should_relay_now: bool,
    pub relay_trigger_kind: Option<String>,
    pub config: SmartRelayConfig,
    pub pool: PoolSummary,
    pub accounts: Vec<AccountView>,
    pub awaiting_reset_accounts: Vec<ResetCardAccountView>,
    pub reset_card_accounts: Vec<ResetCardAccountView>,
    pub ranked_auto_targets: Vec<String>,
    pub ranked_slot_targets: Vec<String>,
    pub preferred_return_target: Option<String>,
    pub active_slots: Vec<ActiveSlotView>,
    pub slot_sessions: BTreeMap<String, Vec<profile::ActiveSession>>,
    pub running: bool,
    pub cli_running: bool,
    pub background_only: bool,
    pub child_shells: Vec<String>,
    pub recovery: Option<String>,
}

#[derive(Clone, Debug)]
struct CandidateMeta {
    list_index: usize,
    email: Option<String>,
    known_5h: bool,
    known_7d: bool,
    effective_used: u8,
    magpie_tier: u8,
    inferred_5h: bool,
    inferred_7d: bool,
    soon_reset_24h: bool,
    weekly_pace_pct_per_hour: f64,
    pace_band_index: usize,
    subscription_expires_hour: Option<u64>,
    reset_harvest_urgency: f64,
}

pub(crate) fn active_reset_cards(web: &online::WebMetadata, now_sec: u64) -> (u32, Option<u64>) {
    let raw_rem = web.manual_resets_remaining.unwrap_or(0);
    if let Some(grants) = web.manual_resets_grants.as_ref() {
        let mut has_positive_grant = false;
        let mut future_sum = 0u32;
        let mut earliest_future: Option<u64> = None;
        let mut had_expired_positive = false;
        for g in grants {
            if g.resets_left == 0 {
                continue;
            }
            has_positive_grant = true;
            match g.ends_at {
                Some(ends) if ends > now_sec => {
                    future_sum = future_sum.saturating_add(g.resets_left);
                    earliest_future = Some(match earliest_future {
                        Some(prev) => prev.min(ends),
                        None => ends,
                    });
                }
                None => {
                    future_sum = future_sum.saturating_add(g.resets_left);
                }
                Some(_) => {
                    had_expired_positive = true;
                }
            }
        }
        if has_positive_grant {
            if future_sum > 0 {
                let count = if had_expired_positive {
                    if raw_rem > 0 {
                        raw_rem.min(future_sum)
                    } else {
                        future_sum
                    }
                } else if raw_rem > 0 {
                    raw_rem
                } else {
                    future_sum
                };
                return (count, earliest_future);
            }
            // Strategy A1: never zero positive manual_resets_remaining on local clock;
            // only omit earliest_reset_grant_ends_at when all recorded slices are <= now_sec.
            return (raw_rem, None);
        }
    }
    if raw_rem == 0 {
        return (0, None);
    }
    // Strategy A1 parity with src/smart-relay-model.ts: never zero positive manual_resets_remaining
    // on local clock; only expose earliest_reset_grant_ends_at when strictly in the future.
    (
        raw_rem,
        web.manual_resets_grant_ends_at.filter(|&t| t > now_sec),
    )
}

pub(super) fn resolve_slot_proxy(
    id: &str,
    summary: &profile::Summary,
    config: &SmartRelayConfig,
    home: &Path,
    proxy_override: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(raw) = proxy_override.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(Some(validate_http_proxy(raw)?));
    }
    if let Some(configured) = config.slot_proxies.get(id) {
        return Ok(Some(validate_http_proxy(configured)?));
    }
    if let Some(from_summary) = summary.proxy.as_deref().and_then(normalize_proxy_to_http) {
        return Ok(Some(from_summary));
    }
    Ok(read_claude_dir_http_proxy(&home.join(".claude")))
}

fn hydrate_summaries(
    vault: &Path,
    home: &Path,
    db: &database::Database,
    records: &[database::Record],
    active: &str,
    now_sec: u64,
) -> Result<(BTreeMap<String, profile::Summary>, profile::Current), String> {
    let mut summaries = db.summaries()?;
    let manual_subs = subscription::read_store(vault);
    let ledger_root = profile::read_ledger_root(vault);
    let web_metadata_root = online::read_metadata_root(vault);
    let mut current = profile::read_live_with_ledger(home, vault, ledger_root.as_ref());
    online::apply_parsed_metadata(
        web_metadata_root.as_ref(),
        current.quota_identity.as_deref(),
        &mut current.web,
    );
    profile::apply_web_plan_tier(&mut current.plan, &current.web);
    profile::enforce_plan_quota_limits(current.plan.as_deref(), &mut current.quota_no_5h_limit);
    if current.present && active != "current" && records.iter().any(|r| r.id == active) {
        let mut live_sum = profile::Summary::from_current(&current);
        let live_has_verified_quota = (live_sum.quota_5h_used.is_some()
            && live_sum.quota_5h_source != Some(QuotaSource::Unknown))
            || (live_sum.quota_7d_used.is_some()
                && live_sum.quota_7d_source != Some(QuotaSource::Unknown))
            || live_sum.quota_no_5h_limit
            || live_sum.quota_5h_rested;
        let saved_has_quota = summaries.get(active).is_some_and(|s| {
            s.quota_5h_used.is_some() || s.quota_7d_used.is_some() || s.quota_no_5h_limit || s.quota_5h_rested
        });
        if live_has_verified_quota || !saved_has_quota {
            if let Some(prev) = summaries.get(active) {
                if live_sum.proxy.is_none() {
                    live_sum.proxy = prev.proxy.clone();
                }
            }
            summaries.insert(active.to_string(), live_sum);
        }
    }
    subscription::apply_manual_with_plan(
        &manual_subs,
        current.quota_identity.as_deref(),
        (active != "current").then_some(active),
        &mut current.plan,
        &mut current.quota_no_5h_limit,
        &mut current.web,
        &mut current.subscription_expires_at,
    );
    for rec in records {
        let entry = summaries.entry(rec.id.clone()).or_default();
        profile::apply_parsed_ledger_to_summary(ledger_root.as_ref(), entry, rec.saved_at, now_sec);
        entry.refresh_for_now(now_sec);
        online::apply_parsed_metadata(
            web_metadata_root.as_ref(),
            entry.quota_identity.as_deref(),
            &mut entry.web,
        );
        profile::apply_web_plan_tier(&mut entry.plan, &entry.web);
        profile::enforce_plan_quota_limits(entry.plan.as_deref(), &mut entry.quota_no_5h_limit);
        entry.subscription_expires_at = None;
        subscription::apply_manual_with_plan(
            &manual_subs,
            entry.quota_identity.as_deref(),
            Some(rec.id.as_str()),
            &mut entry.plan,
            &mut entry.quota_no_5h_limit,
            &mut entry.web,
            &mut entry.subscription_expires_at,
        );
    }
    Ok((summaries, current))
}

fn evaluate_window_inferred(
    source: Option<QuotaSource>,
    used: Option<u8>,
    reset_at: Option<u64>,
    observed_at_ms: Option<u64>,
    now_sec: u64,
) -> bool {
    match source {
        Some(QuotaSource::ResetInferred) => used == Some(0),
        Some(QuotaSource::ServerAnchor) => {
            used.is_some_and(|u| u <= 100)
                && reset_at.is_some_and(|r| r > 0 && r <= now_sec)
                && observed_at_ms.is_some_and(|obs| {
                    obs > 0 && reset_at.is_some_and(|r| obs < r.saturating_mul(1000))
                })
        }
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn compute_account_and_meta(
    list_index: usize,
    rec: &database::Record,
    summary: &profile::Summary,
    is_current: bool,
    config: &SmartRelayConfig,
    effective_strategy: &str,
    home: &Path,
    slot_dir: &Path,
    slot_pids: Vec<i32>,
    now_sec: u64,
) -> (AccountView, CandidateMeta) {
    let src_7d = summary.quota_7d_source.or(summary.quota_source);
    let obs_7d = if summary.quota_7d_source.is_some() {
        summary.quota_7d_observed_at_ms
    } else {
        summary.quota_observed_at_ms
    };
    let expired_7d = summary.quota_7d_reset_at.is_some_and(|r| now_sec >= r);
    let inferred_7d = evaluate_window_inferred(
        src_7d,
        summary.quota_7d_used,
        summary.quota_7d_reset_at,
        obs_7d,
        now_sec,
    );
    let known_7d = inferred_7d
        || (src_7d != Some(QuotaSource::ResetInferred)
            && summary.quota_7d_used.is_some()
            && !expired_7d);

    let is_ultra_no_5h = summary
        .plan
        .as_deref()
        .is_some_and(|p| p.trim().eq_ignore_ascii_case("ultra"))
        && summary.quota_5h_used.is_none()
        && known_7d;
    let no_5h_limit = summary.quota_no_5h_limit || is_ultra_no_5h;

    let src_5h = summary.quota_5h_source.or(summary.quota_source);
    let obs_5h = if summary.quota_5h_source.is_some() {
        summary.quota_5h_observed_at_ms
    } else {
        summary.quota_observed_at_ms
    };
    let expired_5h = summary.quota_5h_reset_at.is_some_and(|r| now_sec >= r);
    let inferred_5h = !no_5h_limit
        && evaluate_window_inferred(
            src_5h,
            summary.quota_5h_used,
            summary.quota_5h_reset_at,
            obs_5h,
            now_sec,
        );
    let rested_no_active_5h = !no_5h_limit
        && known_7d
        && src_7d != Some(QuotaSource::LocalEstimate)
        && summary.quota_5h_used.is_none()
        && summary.quota_5h_reset_at.is_none()
        && (summary.quota_5h_rested || summary.quota_5h_source != Some(QuotaSource::Unknown));
    let known_5h = no_5h_limit
        || inferred_5h
        || rested_no_active_5h
        || (src_5h != Some(QuotaSource::ResetInferred)
            && summary.quota_5h_used.is_some()
            && !expired_5h);

    let used_5h = if no_5h_limit {
        None
    } else if inferred_5h || rested_no_active_5h {
        Some(0)
    } else if known_5h {
        summary.quota_5h_used.map(|u| u.min(100))
    } else {
        None
    };
    let used_7d = if inferred_7d {
        Some(0)
    } else if known_7d {
        summary.quota_7d_used.map(|u| u.min(100))
    } else {
        None
    };

    let rem_5h = if no_5h_limit {
        Some(100)
    } else {
        used_5h.map(|u| 100u8.saturating_sub(u))
    };
    let rem_7d = used_7d.map(|u| 100u8.saturating_sub(u));

    let auth_bad = matches!(summary.auth_status.as_deref(), Some("missing"))
        || (summary.auth_status.as_deref() == Some("expired")
            && summary.auth_has_refresh != Some(true));
    let sub_expired = summary
        .subscription_expires_at
        .is_some_and(|exp| exp <= now_sec)
        && summary.web.billing_date_kind.as_deref() != Some("next_renewal");
    let unavailable = auth_bad || sub_expired || !(known_5h && known_7d);

    let used_5h_val = if no_5h_limit {
        0
    } else {
        used_5h.unwrap_or(0)
    };
    let used_7d_val = used_7d.unwrap_or(0);
    let rem_5h_val = rem_5h.unwrap_or(0);
    let rem_7d_val = rem_7d.unwrap_or(0);

    let effective_rem = if unavailable {
        0
    } else if no_5h_limit {
        rem_7d_val
    } else {
        rem_5h_val.min(rem_7d_val)
    };
    let effective_used = if unavailable {
        100
    } else {
        100u8.saturating_sub(effective_rem)
    };

    let (manual_resets_remaining, earliest_reset_grant_ends_at) =
        active_reset_cards(&summary.web, now_sec);
    let awaiting_reset_threshold = config.spent_threshold_pct.min(98);
    let awaiting_manual_reset = !auth_bad
        && !sub_expired
        && manual_resets_remaining > 0
        && known_7d
        && used_7d_val >= awaiting_reset_threshold;
    let expiring_grant_soon = manual_resets_remaining > 0
        && earliest_reset_grant_ends_at
            .is_some_and(|ends| ends > now_sec && ends - now_sec <= GRANT_EXPIRING_SOON_SEC);

    let excluded = config.excluded_account_ids.iter().any(|x| x == &rec.id);
    let cooldown_until = config
        .cooldown_until_sec
        .get(&rec.id)
        .copied()
        .filter(|&until| until > now_sec);
    let in_cooldown = cooldown_until.is_some();

    let low_threshold = LOW_SHARE_PCT.min(config.spent_threshold_pct);
    let is_week_low_promoted = matches!(effective_strategy, "smart" | "pace" | "reset_harvest")
        && used_5h_val < low_threshold
        && effective_used < config.spent_threshold_pct;

    let magpie_tier: u8 = if unavailable || in_cooldown {
        3
    } else if awaiting_manual_reset {
        if used_7d_val >= 100 { 3 } else { 2 }
    } else if effective_rem == 0 || rem_7d_val == 0 {
        2
    } else if effective_used >= config.spent_threshold_pct {
        2
    } else if effective_used >= low_threshold && !is_week_low_promoted {
        1
    } else {
        0
    };

    let spent = !unavailable && effective_used >= config.spent_threshold_pct;

    let tier = if excluded {
        "excluded"
    } else if unavailable {
        "unavailable"
    } else if in_cooldown {
        "cooldown"
    } else if awaiting_manual_reset {
        "awaiting_reset"
    } else if magpie_tier == 2 || spent {
        "spent"
    } else if magpie_tier == 1 {
        "low"
    } else {
        "ready"
    }
    .to_string();

    let reset_5h = if no_5h_limit {
        None
    } else {
        summary.quota_5h_reset_at.filter(|&t| t > now_sec)
    };
    let reset_7d = summary.quota_7d_reset_at.filter(|&t| t > now_sec);
    let deadline = earliest_reset_grant_ends_at.or(reset_7d);
    let hours_to_deadline = deadline
        .filter(|&d| d > now_sec)
        .map(|d| ((d - now_sec) as f64 / 3600.0).max(1.0))
        .unwrap_or(168.0);
    let effective_weekly_pool_rem = (rem_7d_val as f64) + (manual_resets_remaining as f64) * 100.0;
    let reset_harvest_urgency = if manual_resets_remaining > 0 {
        effective_weekly_pool_rem / hours_to_deadline
    } else {
        0.0
    };
    let urgency_score = effective_weekly_pool_rem / hours_to_deadline;

    let hours_left_7d = reset_7d
        .map(|r7| ((r7 - now_sec) as f64 / 3600.0).max(1.0))
        .unwrap_or(168.0);
    let weekly_pace_pct_per_hour = if !unavailable && rem_7d_val > 0 {
        (rem_7d_val as f64) / hours_left_7d
    } else {
        FRESH_WEEKLY_PACE
    };
    let soon_reset_24h = !unavailable
        && rem_7d_val >= 15
        && rem_5h_val > 10
        && reset_7d.is_some_and(|r7| r7 > now_sec && r7 - now_sec <= 86_400);
    let subscription_expires_hour = summary
        .subscription_expires_at
        .filter(|&exp| exp > now_sec)
        .map(|exp| exp / 3600);

    let proxy = resolve_slot_proxy(&rec.id, summary, config, home, None)
        .ok()
        .flatten();
    let drifted = slot_dir.join(SLOT_DRIFTED_FILE).exists();

    let view = AccountView {
        id: rec.id.clone(),
        record_id: rec.id.clone(),
        name: rec.name.clone(),
        is_current,
        tier,
        no_5h_limit,
        used_5h,
        used_7d,
        rem_5h,
        rem_7d,
        effective_rem,
        manual_resets_remaining,
        earliest_reset_grant_ends_at,
        expiring_grant_soon,
        awaiting_manual_reset,
        spent,
        unavailable,
        excluded,
        cooldown_until_sec: cooldown_until,
        quota_5h_reset_at: reset_5h,
        quota_7d_reset_at: reset_7d,
        urgency_score,
        proxy,
        slot_pids,
        drifted,
    };

    let meta = CandidateMeta {
        list_index,
        email: summary.email.clone(),
        known_5h,
        known_7d,
        effective_used,
        magpie_tier,
        inferred_5h,
        inferred_7d,
        soon_reset_24h,
        weekly_pace_pct_per_hour,
        pace_band_index: 999,
        subscription_expires_hour,
        reset_harvest_urgency,
    };

    (view, meta)
}

fn assign_pace_bands(metas: &mut [CandidateMeta]) {
    let mut indices: Vec<usize> = metas
        .iter()
        .enumerate()
        .filter(|(_, m)| m.magpie_tier <= 1)
        .map(|(i, _)| i)
        .collect();
    indices.sort_by(|&ia, &ib| {
        metas[ib]
            .weekly_pace_pct_per_hour
            .total_cmp(&metas[ia].weekly_pace_pct_per_hour)
    });
    let mut band_index = 0usize;
    let mut band_top = indices
        .first()
        .map(|&i| metas[i].weekly_pace_pct_per_hour)
        .unwrap_or(0.0);
    for idx in indices {
        let pace = metas[idx].weekly_pace_pct_per_hour;
        if band_top > 0.0 && pace < band_top * 0.9 {
            band_index += 1;
            band_top = pace;
        }
        metas[idx].pace_band_index = band_index;
    }
}

fn compare_hour_bucket(a_sec: Option<u64>, b_sec: Option<u64>, now_sec: u64) -> Ordering {
    let a_hour = a_sec.filter(|&s| s > now_sec).map(|s| s / 3600);
    let b_hour = b_sec.filter(|&s| s > now_sec).map(|s| s / 3600);
    match (a_hour, b_hour) {
        (Some(ah), Some(bh)) => ah.cmp(&bh),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn compare_smart_tier0(
    a: &AccountView,
    ma: &CandidateMeta,
    b: &AccountView,
    mb: &CandidateMeta,
    now_sec: u64,
) -> Ordering {
    if ma.soon_reset_24h != mb.soon_reset_24h {
        return if ma.soon_reset_24h {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    let a_urgent = a.expiring_grant_soon || a.manual_resets_remaining >= 2;
    let b_urgent = b.expiring_grant_soon || b.manual_resets_remaining >= 2;
    if a_urgent != b_urgent {
        return if a_urgent {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if a_urgent && b_urgent {
        let grant_cmp = compare_hour_bucket(
            a.earliest_reset_grant_ends_at,
            b.earliest_reset_grant_ends_at,
            now_sec,
        );
        if grant_cmp != Ordering::Equal {
            return grant_cmp;
        }
        if b.manual_resets_remaining != a.manual_resets_remaining {
            return b.manual_resets_remaining.cmp(&a.manual_resets_remaining);
        }
    }
    let r7_cmp = compare_hour_bucket(a.quota_7d_reset_at, b.quota_7d_reset_at, now_sec);
    if r7_cmp != Ordering::Equal {
        return r7_cmp;
    }
    let r5_cmp = compare_hour_bucket(a.quota_5h_reset_at, b.quota_5h_reset_at, now_sec);
    if r5_cmp != Ordering::Equal {
        return r5_cmp;
    }
    match (ma.subscription_expires_hour, mb.subscription_expires_hour) {
        (Some(sa), Some(sb)) if sa != sb => return sa.cmp(&sb),
        (Some(_), None) => return Ordering::Less,
        (None, Some(_)) => return Ordering::Greater,
        _ => {}
    }
    if b.effective_rem != a.effective_rem {
        return b.effective_rem.cmp(&a.effective_rem);
    }
    let a_has_reset = a.manual_resets_remaining > 0;
    let b_has_reset = b.manual_resets_remaining > 0;
    if a_has_reset != b_has_reset {
        return if a_has_reset {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if ma.inferred_7d != mb.inferred_7d {
        return ma.inferred_7d.cmp(&mb.inferred_7d);
    }
    ma.list_index.cmp(&mb.list_index)
}

#[allow(clippy::too_many_arguments)]
fn rank_candidates(
    accounts: &[AccountView],
    metas: &[CandidateMeta],
    active: &str,
    config: &SmartRelayConfig,
    strategy: &str,
    now_sec: u64,
    active_slots: &[ActiveSlotView],
    require_slot_safe: bool,
    session_lock_active: bool,
) -> (Vec<String>, Option<String>) {
    let active_slot_ids: HashSet<&str> = active_slots
        .iter()
        .filter(|s| s.lease_active)
        .map(|s| s.record_id.as_str())
        .collect();

    let is_no_return_locked = |a: &AccountView| -> bool {
        config.no_return_account_id.as_deref() == Some(a.id.as_str())
            && config.no_return_until_sec > now_sec
            && !a.is_current
    };

    let is_auto_eligible = |idx: usize| -> bool {
        let a = &accounts[idx];
        let m = &metas[idx];
        if a.id == active
            || a.excluded
            || a.unavailable
            || a.cooldown_until_sec.is_some()
            || a.awaiting_manual_reset
            || m.magpie_tier > 1
        {
            return false;
        }
        if require_slot_safe {
            if a.drifted || !a.slot_pids.is_empty() || active_slot_ids.contains(a.id.as_str()) {
                return false;
            }
        } else if !a.slot_pids.is_empty() || active_slot_ids.contains(a.id.as_str()) {
            return false;
        }
        true
    };

    let sink_seq = |id: &str| -> u64 {
        if config.rate_limit_mode == "sink_to_end" {
            config.sunk_order.get(id).copied().unwrap_or(0)
        } else {
            0
        }
    };
    let rotation_seq = |id: &str| -> u64 { config.rotation_tick.get(id).copied().unwrap_or(0) };

    let preferred_return_target = if !session_lock_active && config.return_to_preferred {
        config.preferred_account_id.as_deref().and_then(|pref_id| {
            if pref_id == active {
                return None;
            }
            accounts
                .iter()
                .enumerate()
                .find(|&(idx, a)| {
                    a.id == pref_id
                        && is_auto_eligible(idx)
                        && !is_no_return_locked(a)
                        && metas[idx].magpie_tier == 0
                        && !metas[idx].inferred_5h
                        && !metas[idx].inferred_7d
                        && metas[idx].effective_used < config.preferred_return_threshold_pct
                })
                .map(|(_, a)| a.id.clone())
        })
    } else {
        None
    };

    let mut eligible: Vec<usize> = (0..accounts.len())
        .filter(|&idx| is_auto_eligible(idx))
        .collect();

    eligible.sort_by(|&ia, &ib| {
        let a = &accounts[ia];
        let b = &accounts[ib];
        let ma = &metas[ia];
        let mb = &metas[ib];

        let tr = ma.magpie_tier.cmp(&mb.magpie_tier);
        if tr != Ordering::Equal {
            return tr;
        }
        let la = is_no_return_locked(a);
        let lb = is_no_return_locked(b);
        if la != lb {
            return la.cmp(&lb);
        }
        let sa = sink_seq(&a.id);
        let sb = sink_seq(&b.id);
        if sa != sb {
            return sa.cmp(&sb);
        }
        if ma.magpie_tier == 1 {
            return b
                .effective_rem
                .cmp(&a.effective_rem)
                .then_with(|| ma.inferred_7d.cmp(&mb.inferred_7d))
                .then_with(|| ma.list_index.cmp(&mb.list_index));
        }

        match strategy {
            "ordered" => ma.list_index.cmp(&mb.list_index),
            "rotate" => rotation_seq(&a.id)
                .cmp(&rotation_seq(&b.id))
                .then_with(|| mb.soon_reset_24h.cmp(&ma.soon_reset_24h))
                .then_with(|| b.effective_rem.cmp(&a.effective_rem))
                .then_with(|| ma.list_index.cmp(&mb.list_index)),
            "least_used" => b
                .effective_rem
                .cmp(&a.effective_rem)
                .then_with(|| mb.soon_reset_24h.cmp(&ma.soon_reset_24h))
                .then_with(|| ma.inferred_7d.cmp(&mb.inferred_7d))
                .then_with(|| rotation_seq(&a.id).cmp(&rotation_seq(&b.id)))
                .then_with(|| ma.list_index.cmp(&mb.list_index)),
            "reset_harvest" => {
                let a_has = a.manual_resets_remaining > 0;
                let b_has = b.manual_resets_remaining > 0;
                if a_has != b_has {
                    return b_has.cmp(&a_has);
                }
                if !a_has && !b_has {
                    return compare_smart_tier0(a, ma, b, mb, now_sec);
                }
                let a_finite = a.earliest_reset_grant_ends_at.is_some();
                let b_finite = b.earliest_reset_grant_ends_at.is_some();
                b_finite
                    .cmp(&a_finite)
                    .then_with(|| b.expiring_grant_soon.cmp(&a.expiring_grant_soon))
                    .then_with(|| {
                        compare_hour_bucket(
                            a.earliest_reset_grant_ends_at.or(a.quota_7d_reset_at),
                            b.earliest_reset_grant_ends_at.or(b.quota_7d_reset_at),
                            now_sec,
                        )
                    })
                    .then_with(|| mb.reset_harvest_urgency.total_cmp(&ma.reset_harvest_urgency))
                    .then_with(|| compare_hour_bucket(a.quota_5h_reset_at, b.quota_5h_reset_at, now_sec))
                    .then_with(|| b.effective_rem.cmp(&a.effective_rem))
                    .then_with(|| ma.inferred_7d.cmp(&mb.inferred_7d))
                    .then_with(|| ma.list_index.cmp(&mb.list_index))
            }
            "pace" => b
                .expiring_grant_soon
                .cmp(&a.expiring_grant_soon)
                .then_with(|| {
                    if a.expiring_grant_soon && b.expiring_grant_soon {
                        compare_hour_bucket(
                            a.earliest_reset_grant_ends_at,
                            b.earliest_reset_grant_ends_at,
                            now_sec,
                        )
                    } else {
                        Ordering::Equal
                    }
                })
                .then_with(|| ma.pace_band_index.cmp(&mb.pace_band_index))
                .then_with(|| mb.soon_reset_24h.cmp(&ma.soon_reset_24h))
                .then_with(|| b.effective_rem.cmp(&a.effective_rem))
                .then_with(|| {
                    (b.manual_resets_remaining > 0).cmp(&(a.manual_resets_remaining > 0))
                })
                .then_with(|| ma.inferred_7d.cmp(&mb.inferred_7d))
                .then_with(|| ma.list_index.cmp(&mb.list_index)),
            _ => compare_smart_tier0(a, ma, b, mb, now_sec),
        }
    });

    let has_unlocked = eligible.iter().any(|&i| !is_no_return_locked(&accounts[i]));
    if has_unlocked {
        eligible.retain(|&i| !is_no_return_locked(&accounts[i]));
    }

    let mut ranked: Vec<String> = eligible
        .into_iter()
        .map(|i| accounts[i].id.clone())
        .collect();
    if !require_slot_safe {
        if let Some(pref_id) = preferred_return_target.as_ref() {
            ranked.retain(|id| id != pref_id);
            ranked.insert(0, pref_id.clone());
        }
    }
    (ranked, preferred_return_target)
}

/// Inputs the evaluator already resolved once (SQLite/catalog/ledger/live sessions), handed to
/// the HUD so `monitor_live_telemetry` never re-opens the database or re-parses the ledger.
pub(crate) struct PoolContext {
    pub active_record_name: Option<String>,
    pub current: profile::Current,
    pub default_sessions: Vec<profile::LiveSession>,
    pub default_running: bool,
}

fn evaluate_pool_with_metas(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
    threshold_override: Option<u8>,
    strategy_override: Option<&str>,
) -> Result<(EvaluatedPool, Vec<CandidateMeta>), String> {
    evaluate_pool_with_context(
        app_data_dir,
        vault,
        home,
        now_sec,
        procs,
        threshold_override,
        strategy_override,
    )
    .map(|(eval, metas, _)| (eval, metas))
}

fn evaluate_pool_with_context(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
    threshold_override: Option<u8>,
    strategy_override: Option<&str>,
) -> Result<(EvaluatedPool, Vec<CandidateMeta>, PoolContext), String> {
    let mut config = load_config(app_data_dir);
    if let Some(t) = threshold_override.filter(|t| VALID_SPENT_THRESHOLDS.contains(t)) {
        config.spent_threshold_pct = t;
    }
    if let Some(s) = strategy_override.filter(|s| VALID_STRATEGIES.contains(s)) {
        config.strategy = s.to_string();
    }
    let effective_strategy = config.strategy.clone();

    let db = database::Database::open(vault)?;
    let records: Vec<database::Record> = db.records()?.into_iter().filter(|r| !r.empty).collect();
    let active = catalog::current_id(vault, home, &db)?.unwrap_or_else(|| "current".into());
    let recovery = db.get("recovery")?;
    let (summaries, current) = hydrate_summaries(vault, home, &db, &records, &active, now_sec)?;
    let active_record_name = records
        .iter()
        .find(|r| r.id == active)
        .map(|r| r.name.clone());

    let slot_sessions = slot_sessions_by_record(app_data_dir, procs);
    let slot_pids_map: BTreeMap<String, Vec<i32>> = slot_sessions
        .iter()
        .map(|(k, v)| (k.clone(), v.iter().map(|s| s.pid).collect()))
        .collect();
    let slot_pid_set: HashSet<i32> = slot_pids_map
        .values()
        .flat_map(|pids| pids.iter().copied())
        .collect();
    let default_procs: Vec<ClaudeProcess> = procs
        .iter()
        .filter(|p| !slot_pid_set.contains(&p.pid))
        .cloned()
        .collect();
    let default_sessions = profile::active_sessions_from_processes(home, &default_procs);
    let running = !default_procs.is_empty();
    let cli_running = default_sessions
        .iter()
        .any(|s| s.entrypoint != "Claude Desktop" && !s.background);
    let background_only =
        running && !default_sessions.is_empty() && default_sessions.iter().all(|s| s.background);
    let mut child_shells: Vec<String> = Vec::new();
    for s in &default_sessions {
        for shell in &s.child_shells {
            if !child_shells.contains(shell) {
                child_shells.push(shell.clone());
            }
        }
    }
    let active_slots = scan_active_slots(app_data_dir, &slot_pids_map, now_sec);

    let slots_root = app_data_dir.join(CLI_SLOTS_DIR);
    let mut accounts = Vec::with_capacity(records.len());
    let mut metas = Vec::with_capacity(records.len());
    for (idx, rec) in records.iter().enumerate() {
        let sum = summaries.get(&rec.id).cloned().unwrap_or_default();
        let pids = slot_pids_map.get(&rec.id).cloned().unwrap_or_default();
        let (view, meta) = compute_account_and_meta(
            idx,
            rec,
            &sum,
            rec.id == active,
            &config,
            &effective_strategy,
            home,
            &slots_root.join(&rec.id),
            pids,
            now_sec,
        );
        accounts.push(view);
        metas.push(meta);
    }
    assign_pace_bands(&mut metas);

    let active_name = accounts
        .iter()
        .find(|a| a.id == active)
        .map(|a| a.name.clone())
        .or_else(|| current.display_name.clone())
        .or_else(|| current.email.clone())
        .unwrap_or_else(|| active.clone());

    let mut pool = PoolSummary::default();
    let mut sum_5h = 0u64;
    let mut sum_7d = 0u64;
    let mut known_quota_count = 0u64;
    let mut soonest_reset_sec: Option<u64> = None;

    for (a, m) in accounts.iter().zip(&metas) {
        if a.excluded {
            continue;
        }
        pool.included_count += 1;
        if a.cooldown_until_sec.is_some() {
            pool.cooldown_count += 1;
        }
        pool.total_manual_resets_remaining = pool
            .total_manual_resets_remaining
            .saturating_add(a.manual_resets_remaining);
        if a.awaiting_manual_reset {
            pool.awaiting_reset_count += 1;
        }
        match m.magpie_tier {
            0 => pool.ready_count += 1,
            1 => pool.low_count += 1,
            2 => pool.spent_count += 1,
            _ => pool.unavailable_count += 1,
        }
        if m.magpie_tier <= 2 && m.known_5h && m.known_7d {
            sum_5h += a.rem_5h.unwrap_or(100) as u64;
            sum_7d += a.rem_7d.unwrap_or(0) as u64;
            known_quota_count += 1;
        }
        if matches!(m.magpie_tier, 1 | 2) || a.spent || a.cooldown_until_sec.is_some() {
            for ts in [a.quota_5h_reset_at, a.quota_7d_reset_at].into_iter().flatten() {
                if ts > now_sec {
                    let eta = ts - now_sec;
                    soonest_reset_sec = Some(match soonest_reset_sec {
                        Some(prev) => prev.min(eta),
                        None => eta,
                    });
                }
            }
        }
    }
    pool.avg_5h_remaining_pct = if known_quota_count > 0 {
        ((sum_5h as f64) / (known_quota_count as f64)).round() as u8
    } else {
        0
    };
    pool.avg_rem_7d_pct = if known_quota_count > 0 {
        ((sum_7d as f64) / (known_quota_count as f64)).round() as u8
    } else {
        0
    };
    pool.soonest_reset_sec = soonest_reset_sec;

    let mut awaiting_reset_accounts = Vec::new();
    let mut reset_card_accounts = Vec::new();
    for a in &accounts {
        if a.manual_resets_remaining > 0 || a.awaiting_manual_reset {
            let item = ResetCardAccountView {
                id: a.id.clone(),
                record_id: a.record_id.clone(),
                name: a.name.clone(),
                quota_7d_used: a.used_7d,
                quota_7d_reset_at: a.quota_7d_reset_at,
                manual_resets_remaining: a.manual_resets_remaining,
                earliest_reset_grant_ends_at: a.earliest_reset_grant_ends_at,
                awaiting_manual_reset: a.awaiting_manual_reset,
                tier: a.tier.clone(),
            };
            if a.awaiting_manual_reset && !a.excluded {
                awaiting_reset_accounts.push(item.clone());
            }
            if a.manual_resets_remaining > 0 && !a.excluded {
                reset_card_accounts.push(item);
            }
        }
    }

    let session_spent_threshold = if config.spent_threshold_pct >= 95 {
        100
    } else {
        config.spent_threshold_pct.max(95)
    };
    let active_pair = accounts
        .iter()
        .zip(&metas)
        .find(|(a, _)| a.id == active);
    let session_lock_active = config.affinity_mode == "session"
        && active_pair.is_some_and(|(cur, cm)| {
            !cur.awaiting_manual_reset
                && cm.magpie_tier < 3
                && cm.effective_used < session_spent_threshold
        });

    let (ranked_auto_targets, preferred_return_target) = rank_candidates(
        &accounts,
        &metas,
        &active,
        &config,
        &effective_strategy,
        now_sec,
        &active_slots,
        false,
        session_lock_active,
    );
    let (ranked_slot_targets, _) = rank_candidates(
        &accounts,
        &metas,
        &active,
        &config,
        &effective_strategy,
        now_sec,
        &active_slots,
        true,
        false,
    );

    let manual_affinity = config.affinity_mode == "manual";
    let (current_should_relay, current_trigger_kind) = if let Some((cur, cm)) = active_pair {
        let cur_spent_for_affinity = if config.affinity_mode == "session" {
            cm.effective_used >= session_spent_threshold
        } else {
            cm.magpie_tier >= 2 || cm.effective_used >= config.spent_threshold_pct
        };
        if cur.awaiting_manual_reset && !ranked_auto_targets.is_empty() {
            (true, Some("awaiting_manual_reset".to_string()))
        } else if (cur_spent_for_affinity || cm.magpie_tier >= 3 || cur.cooldown_until_sec.is_some())
            && !ranked_auto_targets.is_empty()
        {
            (true, Some("threshold_reached".to_string()))
        } else {
            (false, None)
        }
    } else if current.present && !ranked_auto_targets.is_empty() {
        let cur_auth_bad = matches!(current.auth_status.as_deref(), Some("missing"))
            || (current.auth_status.as_deref() == Some("expired")
                && current.auth_has_refresh != Some(true));
        let cur_sub_expired = current
            .subscription_expires_at
            .is_some_and(|exp| exp <= now_sec)
            && current.web.billing_date_kind.as_deref() != Some("next_renewal");
        let cur_in_cooldown = config
            .cooldown_until_sec
            .get("current")
            .is_some_and(|&until| until > now_sec);
        let (cur_resets_rem, _) = active_reset_cards(&current.web, now_sec);
        let cur_awaiting_reset = !cur_auth_bad
            && !cur_sub_expired
            && cur_resets_rem > 0
            && current
                .quota_7d_used
                .is_some_and(|u7| u7 >= config.spent_threshold_pct.min(98));
        let cur_5h = if current.quota_no_5h_limit {
            0
        } else {
            current.quota_5h_used.unwrap_or(0)
        };
        let cur_7d = current.quota_7d_used.unwrap_or(0);
        let cur_max = cur_5h.max(cur_7d);
        let thresh = if config.affinity_mode == "session" {
            session_spent_threshold
        } else {
            config.spent_threshold_pct
        };
        if cur_awaiting_reset {
            (true, Some("awaiting_manual_reset".to_string()))
        } else if cur_max >= thresh || cur_auth_bad || cur_sub_expired || cur_in_cooldown {
            (true, Some("threshold_reached".to_string()))
        } else {
            (false, None)
        }
    } else {
        (false, None)
    };
    let (raw_should_relay, relay_trigger_kind) = if current_should_relay {
        (true, current_trigger_kind)
    } else if preferred_return_target.is_some() {
        (true, Some("preferred_recovered".to_string()))
    } else {
        (false, None)
    };
    let should_relay_now = !manual_affinity && raw_should_relay;

    Ok((
        EvaluatedPool {
            active,
            active_name,
            should_relay_now,
            relay_trigger_kind,
            config,
            pool,
            accounts,
            awaiting_reset_accounts,
            reset_card_accounts,
            ranked_auto_targets,
            ranked_slot_targets,
            preferred_return_target,
            active_slots,
            slot_sessions,
            running,
            cli_running,
            background_only,
            child_shells,
            recovery,
        },
        metas,
        PoolContext {
            active_record_name,
            current,
            default_sessions,
            default_running: running,
        },
    ))
}

pub(super) fn evaluate_pool(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
    threshold_override: Option<u8>,
    strategy_override: Option<&str>,
) -> Result<EvaluatedPool, String> {
    evaluate_pool_with_metas(
        app_data_dir,
        vault,
        home,
        now_sec,
        procs,
        threshold_override,
        strategy_override,
    )
    .map(|(eval, _)| eval)
}

pub(crate) fn orchestrator_state_with_overrides_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
    threshold_override: Option<u8>,
    strategy_override: Option<&str>,
) -> Result<OrchestratorStateView, String> {
    let eval = evaluate_pool(
        app_data_dir,
        vault,
        home,
        now_sec,
        procs,
        threshold_override,
        strategy_override,
    )?;
    let cfg_path = app_data_dir.join(SMART_RELAY_FILE);
    let config_persisted = fs::symlink_metadata(&cfg_path).is_ok_and(|m| {
        !cleaner::linked(&m)
            && m.is_file()
            && m.len() <= SMART_RELAY_MAX_BYTES as u64
            && private::safe(&cfg_path).is_ok()
    });
    Ok(OrchestratorStateView {
        schema: 1,
        ok: true,
        config_persisted,
        active: eval.active,
        active_name: eval.active_name,
        running: eval.running,
        cli_running: eval.cli_running,
        background_only: eval.background_only,
        child_shells: eval.child_shells,
        should_relay_now: eval.should_relay_now,
        relay_trigger_kind: eval.relay_trigger_kind,
        config: eval.config,
        pool: eval.pool,
        accounts: eval.accounts,
        ranked_auto_targets: eval.ranked_auto_targets,
        slot_sessions: eval.slot_sessions,
        awaiting_reset_accounts: eval.awaiting_reset_accounts,
        reset_card_accounts: eval.reset_card_accounts,
        active_slots: eval.active_slots,
        recovery: eval.recovery,
    })
}

pub(crate) fn orchestrator_state_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> Result<OrchestratorStateView, String> {
    orchestrator_state_with_overrides_in(app_data_dir, vault, home, now_sec, procs, None, None)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn monitor_relay_snapshot(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    current_web: &online::WebMetadata,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> MonitorRelaySnapshot {
    let (cur_cards, _) = active_reset_cards(current_web, now_sec);
    match evaluate_pool_with_metas(app_data_dir, vault, home, now_sec, procs, None, None) {
        Ok((eval, metas)) => relay_snapshot_from_eval(&eval, &metas, cur_cards),
        Err(_) => relay_snapshot_fallback(app_data_dir, cur_cards),
    }
}

/// HUD telemetry in one pass: one SQLite open, one catalog lookup, one ledger/metadata parse,
/// one live `.claude.json` read and one session resolution over the caller's single process snapshot.
pub(crate) struct MonitorRelayContext {
    pub relay: MonitorRelaySnapshot,
    pub active_id: String,
    pub active_name: Option<String>,
    /// `None` when the pool could not be evaluated; caller falls back to its own live read.
    pub pool: Option<PoolContext>,
}

pub(crate) fn monitor_relay_snapshot_with_context(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> MonitorRelayContext {
    match evaluate_pool_with_context(app_data_dir, vault, home, now_sec, procs, None, None) {
        Ok((eval, metas, pool)) => {
            let (cur_cards, _) = active_reset_cards(&pool.current.web, now_sec);
            MonitorRelayContext {
                relay: relay_snapshot_from_eval(&eval, &metas, cur_cards),
                active_id: eval.active.clone(),
                active_name: pool.active_record_name.clone(),
                pool: Some(pool),
            }
        }
        Err(_) => MonitorRelayContext {
            relay: relay_snapshot_fallback(app_data_dir, 0),
            active_id: "current".into(),
            active_name: None,
            pool: None,
        },
    }
}

impl MonitorRelayContext {
    /// Fallback path only: derive Reset-Card counts from the caller's own live `current.web`.
    pub(crate) fn fill_fallback_cards(&mut self, current_web: &online::WebMetadata, now_sec: u64) {
        if self.pool.is_none() {
            let (cur_cards, _) = active_reset_cards(current_web, now_sec);
            self.relay.manual_resets_remaining = cur_cards;
            self.relay.pool_manual_resets_remaining = cur_cards;
        }
    }
}

fn relay_snapshot_fallback(app_data_dir: &Path, cur_cards: u32) -> MonitorRelaySnapshot {
    let cfg = load_config(app_data_dir);
    MonitorRelaySnapshot {
        manual_resets_remaining: cur_cards,
        pool_manual_resets_remaining: cur_cards,
        relay_enabled: cfg.enabled,
        relay_strategy: cfg.strategy,
        ..MonitorRelaySnapshot::default()
    }
}

fn relay_snapshot_from_eval(
    eval: &EvaluatedPool,
    metas: &[CandidateMeta],
    cur_cards: u32,
) -> MonitorRelaySnapshot {
    let active_slot_count = eval.active_slots.iter().filter(|s| s.lease_active).count();
    let active_cards = eval
        .accounts
        .iter()
        .find(|a| a.id == eval.active)
        .map(|a| a.manual_resets_remaining)
        .unwrap_or(cur_cards);
    let pool_cards = eval.pool.total_manual_resets_remaining.max(active_cards);

    let next_target = eval.ranked_auto_targets.first().and_then(|next_id| {
        eval.accounts
            .iter()
            .zip(metas)
            .find(|(a, _)| &a.id == next_id)
    });

    MonitorRelaySnapshot {
        active_slot_count,
        manual_resets_remaining: active_cards,
        pool_manual_resets_remaining: pool_cards,
        awaiting_reset_count: eval.pool.awaiting_reset_count,
        relay_enabled: eval.config.enabled,
        relay_strategy: eval.config.strategy.clone(),
        next_relay_name: next_target.map(|(a, _)| a.name.clone()),
        next_relay_email: next_target.and_then(|(_, m)| m.email.clone()),
        next_relay_rem_pct: next_target.map(|(a, _)| a.effective_rem),
        should_relay_now: eval.should_relay_now,
    }
}
