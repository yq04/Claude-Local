// [INPUT]: .claude.json oauthAccount/cachedUsageUtilization、只读 quota_ledger.json（最多 8 MiB）与本地 ExtractedQuota 证据。
// [OUTPUT]: quota_identity SHA-256 指纹派生、账号/组织锚点匹配、内存 server_anchor 合并、逐窗来源与 reset_inferred 推定、Ultra/Fable 扩展字段合并、套餐降级防误锁与 Summary 账本同步。
// [POS]: identities/profile 子模块：账本与服务端锚点只读合并层，不写入 quota_ledger.json 或 .claude.json。
// [PROTOCOL]: 变更时更新此头部，然后检查 profile/CLAUDE.md
use super::local_usage::{parse_reset_value, ExtractedQuota};
use super::{
    normalize_epoch_sec, read_bounded_json, Current, QuotaSource, Summary, CURRENT_QUOTA_VERSION,
};
use crate::quota_core::{aggregate_source, max_observation, merge_window, WindowState};
use serde_json::Value;
use std::path::Path;

pub(crate) fn quota_identity(cj: &Value) -> Option<String> {
    let account = cj.get("oauthAccount")?;
    let field = |name| {
        account
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
    };
    let uuid = field("accountUuid");
    let email = field("emailAddress").to_ascii_lowercase();
    let org = if field("organizationUuid").is_empty() {
        field("organizationName")
    } else {
        field("organizationUuid")
    };
    if uuid.is_empty() && email.is_empty() {
        return None;
    }
    let raw = serde_json::to_vec(&[uuid, &email, org]).ok()?;
    Some(
        ring::digest::digest(&ring::digest::SHA256, &raw)
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}
fn ledger_identity(entry: &Value, email: &str) -> Option<String> {
    if let Some(id) = entry.get("quota_identity").and_then(Value::as_str) {
        return Some(id.to_string());
    }
    quota_identity(&serde_json::json!({"oauthAccount": {
        "accountUuid": entry.get("account_uuid").or_else(|| entry.pointer("/server_anchor/accountUuid")),
        "emailAddress": email,
        "organizationUuid": entry.get("organization_uuid"),
        "organizationName": entry.get("organization")
    }}))
}
fn legacy_live_anchor_matches(cj: &Value, entry: &Value) -> bool {
    if entry.get("quota_identity").is_some() {
        return false;
    }
    let live = &cj["oauthAccount"];
    let anchor_uuid = entry
        .pointer("/server_anchor/accountUuid")
        .or_else(|| entry.get("account_uuid"))
        .and_then(Value::as_str);
    let live_uuid = live.get("accountUuid").and_then(Value::as_str);
    let live_org = live.get("organizationName").and_then(Value::as_str);
    let entry_org = entry
        .get("organization")
        .or_else(|| entry.get("organization_name"))
        .and_then(Value::as_str);
    let live_org_uuid = live.get("organizationUuid").and_then(Value::as_str);
    let entry_org_uuid = entry.get("organization_uuid").and_then(Value::as_str);
    anchor_uuid.is_some_and(|uuid| live_uuid == Some(uuid))
        && live_org.is_some_and(|org| !org.trim().is_empty() && entry_org == Some(org))
        && (entry_org_uuid.is_none() || live_org_uuid.is_none() || entry_org_uuid == live_org_uuid)
}
pub(super) fn ledger_account<'a>(ledger: &'a Value, email: &str, identity: Option<&str>) -> Option<&'a Value> {
    let accounts = ledger.get("accounts")?;
    let primary = accounts.get(email);
    let qualified = identity.and_then(|id| accounts.get(format!("{email}#{id}")));
    let primary_matches =
        primary.is_some_and(|entry| ledger_identity(entry, email).as_deref() == identity);
    let qualified_matches =
        qualified.is_some_and(|entry| ledger_identity(entry, email).as_deref() == identity);
    if primary_matches && qualified_matches {
        let p_ms = primary
            .and_then(|e| e.get("quota_observed_at_ms"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let q_ms = qualified
            .and_then(|e| e.get("quota_observed_at_ms"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        return if q_ms > p_ms { qualified } else { primary };
    }
    if primary_matches {
        return primary;
    }
    qualified.or(primary)
}
pub(super) fn quota_window_observed_at(cj: &Value, window: &str) -> Option<u64> {
    let cache = cj.get("cachedUsageUtilization")?;
    let active = cj
        .pointer("/oauthAccount/accountUuid")
        .and_then(Value::as_str);
    if active.is_some() && active != cache.get("accountUuid").and_then(Value::as_str) {
        return None;
    }
    cache
        .pointer(&format!("/utilization/{window}/fetchedAtMs"))
        .and_then(Value::as_u64)
        .or_else(|| cache.get("fetchedAtMs").and_then(Value::as_u64))
        .filter(|value| *value > 0)
}
pub(super) fn window_source(
    cj: &Value,
    window: &str,
    used: Option<u8>,
    reset_at: Option<u64>,
    local_evidence: bool,
    now_sec: u64,
) -> Option<QuotaSource> {
    if used.is_none() || reset_at.is_some_and(|reset| now_sec >= reset) {
        return Some(QuotaSource::Unknown);
    }
    let cache_window = cj
        .pointer("/cachedUsageUtilization/utilization")
        .and_then(|utilization| utilization.get(window));
    let has_server_value = cache_window
        .and_then(|value| value.get("utilization"))
        .and_then(Value::as_f64)
        .and_then(crate::quota_core::observed_percentage)
        .is_some();
    let server_reset_is_current = cache_window
        .and_then(|value| value.get("resets_at"))
        .and_then(parse_reset_value)
        .is_some_and(|reset| now_sec < reset);
    if local_evidence {
        Some(QuotaSource::LocalEstimate)
    } else if has_server_value
        && server_reset_is_current
        && quota_window_observed_at(cj, window).is_some()
    {
        Some(QuotaSource::ServerAnchor)
    } else {
        Some(QuotaSource::Unknown)
    }
}
pub(super) fn set_quota_evidence(cj: &Value, result: &ExtractedQuota, now_sec: u64, current: &mut Current) {
    current.quota_5h_source = window_source(
        cj,
        "five_hour",
        result.used_5h,
        result.reset_5h,
        result.local_5h_evidence,
        now_sec,
    );
    current.quota_7d_source = window_source(
        cj,
        "seven_day",
        result.used_7d,
        result.reset_7d,
        result.local_7d_evidence,
        now_sec,
    );
    current.quota_5h_observed_at_ms = max_observation(
        quota_window_observed_at(cj, "five_hour"),
        result.local_5h_observed_at_ms,
    );
    current.quota_7d_observed_at_ms = max_observation(
        quota_window_observed_at(cj, "seven_day"),
        result.local_7d_observed_at_ms,
    );
    if !result
        .used_5h
        .is_some_and(|_| result.reset_5h.is_some_and(|r| r > now_sec))
    {
        if let Some((reset, observed)) = cached_reset_inference(cj, "five_hour", now_sec) {
            current.quota_5h_used = Some(0);
            current.quota_5h_reset_at = Some(reset);
            current.quota_5h_source = Some(QuotaSource::ResetInferred);
            current.quota_5h_observed_at_ms = Some(observed);
        }
    }
    if !result
        .used_7d
        .is_some_and(|_| result.reset_7d.is_some_and(|r| r > now_sec))
    {
        if let Some((reset, observed)) = cached_reset_inference(cj, "seven_day", now_sec) {
            current.quota_7d_used = Some(0);
            current.quota_7d_reset_at = Some(reset);
            current.quota_7d_source = Some(QuotaSource::ResetInferred);
            current.quota_7d_observed_at_ms = Some(observed);
        }
    }
    if current.quota_7d_source == Some(QuotaSource::ServerAnchor)
        && current.quota_5h_used.is_none()
        && !cj
            .pointer("/cachedUsageUtilization/utilization/five_hour")
            .is_some_and(|v| !v.is_null())
    {
        current.quota_5h_rested = true;
    }
    current.quota_source = aggregate_source(current.quota_5h_source, current.quota_7d_source);
    current.quota_observed_at_ms = max_observation(
        current.quota_5h_observed_at_ms,
        current.quota_7d_observed_at_ms,
    );
}
pub(super) fn set_summary_quota_evidence(
    cj: &Value,
    result: &ExtractedQuota,
    now_sec: u64,
    summary: &mut Summary,
) {
    summary.quota_5h_source = window_source(
        cj,
        "five_hour",
        result.used_5h,
        result.reset_5h,
        result.local_5h_evidence,
        now_sec,
    );
    summary.quota_7d_source = window_source(
        cj,
        "seven_day",
        result.used_7d,
        result.reset_7d,
        result.local_7d_evidence,
        now_sec,
    );
    summary.quota_5h_observed_at_ms = max_observation(
        quota_window_observed_at(cj, "five_hour"),
        result.local_5h_observed_at_ms,
    );
    summary.quota_7d_observed_at_ms = max_observation(
        quota_window_observed_at(cj, "seven_day"),
        result.local_7d_observed_at_ms,
    );
    if !result
        .used_5h
        .is_some_and(|_| result.reset_5h.is_some_and(|r| r > now_sec))
    {
        if let Some((reset, observed)) = cached_reset_inference(cj, "five_hour", now_sec) {
            summary.quota_5h_used = Some(0);
            summary.quota_5h_reset_at = Some(reset);
            summary.quota_5h_source = Some(QuotaSource::ResetInferred);
            summary.quota_5h_observed_at_ms = Some(observed);
        }
    }
    if !result
        .used_7d
        .is_some_and(|_| result.reset_7d.is_some_and(|r| r > now_sec))
    {
        if let Some((reset, observed)) = cached_reset_inference(cj, "seven_day", now_sec) {
            summary.quota_7d_used = Some(0);
            summary.quota_7d_reset_at = Some(reset);
            summary.quota_7d_source = Some(QuotaSource::ResetInferred);
            summary.quota_7d_observed_at_ms = Some(observed);
        }
    }
    if summary.quota_7d_source == Some(QuotaSource::ServerAnchor)
        && summary.quota_5h_used.is_none()
        && !cj
            .pointer("/cachedUsageUtilization/utilization/five_hour")
            .is_some_and(|v| !v.is_null())
    {
        summary.quota_5h_rested = true;
    }
    summary.quota_source = aggregate_source(summary.quota_5h_source, summary.quota_7d_source);
    summary.quota_observed_at_ms = max_observation(
        summary.quota_5h_observed_at_ms,
        summary.quota_7d_observed_at_ms,
    );
}

fn cached_reset_inference(cj: &Value, window: &str, now_sec: u64) -> Option<(u64, u64)> {
    let account_uuid = cj
        .pointer("/oauthAccount/accountUuid")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())?;
    let cache = cj.get("cachedUsageUtilization")?;
    if cache.get("accountUuid").and_then(Value::as_str) != Some(account_uuid) {
        return None;
    }
    let window_value = cache.pointer(&format!("/utilization/{window}"))?;
    let used = window_value.get("utilization").and_then(Value::as_f64)?;
    if !used.is_finite() || !(0.0..=100.0).contains(&used) {
        return None;
    }
    let reset = window_value.get("resets_at").and_then(parse_reset_value)?;
    let observed = window_value
        .get("fetchedAtMs")
        .and_then(Value::as_u64)
        .or_else(|| cache.get("fetchedAtMs").and_then(Value::as_u64))
        .filter(|value| *value > 0)?;
    (reset <= now_sec && observed / 1000 < reset).then_some((reset, observed))
}
// The statusLine collector is the sole ledger writer. UI reads must never replace
// a newer server anchor with an estimate derived from an older official cache.
pub(super) fn merge_server_anchor(claude_json: &mut Value, ledger: &Value) {
    let Some(email) = claude_json
        .pointer("/oauthAccount/emailAddress")
        .and_then(Value::as_str)
    else {
        return;
    };
    let key = email.trim().to_ascii_lowercase();
    let identity = quota_identity(claude_json);
    let Some(entry) = ledger_account(ledger, &key, identity.as_deref()) else {
        return;
    };
    if quota_identity(claude_json) != ledger_identity(entry, &key)
        && !legacy_live_anchor_matches(claude_json, entry)
    {
        return;
    }
    let Some(anchor) = entry.get("server_anchor") else {
        return;
    };
    let active_uuid = claude_json
        .pointer("/oauthAccount/accountUuid")
        .and_then(Value::as_str);
    let anchor_uuid = anchor.get("accountUuid").and_then(Value::as_str);
    if active_uuid.is_some() && active_uuid != anchor_uuid {
        return;
    }
    let Some(anchor_utilization) = anchor.get("utilization").and_then(Value::as_object) else {
        return;
    };
    let cached_matches = claude_json
        .pointer("/cachedUsageUtilization/accountUuid")
        .and_then(Value::as_str)
        .is_none_or(|id| active_uuid.is_none_or(|active| active == id));
    let cached_time = |window: &str| {
        if !cached_matches {
            return 0;
        }
        claude_json
            .pointer(&format!(
                "/cachedUsageUtilization/utilization/{window}/fetchedAtMs"
            ))
            .and_then(Value::as_u64)
            .or_else(|| {
                claude_json
                    .pointer("/cachedUsageUtilization/fetchedAtMs")
                    .and_then(Value::as_u64)
            })
            .unwrap_or(0)
    };
    let mut merged = claude_json
        .get("cachedUsageUtilization")
        .filter(|_| cached_matches)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({"accountUuid": active_uuid, "utilization": {}}));
    let original_cache_time = merged
        .get("fetchedAtMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    for window in ["five_hour", "seven_day"] {
        if merged
            .pointer(&format!("/utilization/{window}"))
            .is_some_and(Value::is_object)
            && merged
                .pointer(&format!("/utilization/{window}/fetchedAtMs"))
                .and_then(Value::as_u64)
                .is_none()
            && original_cache_time > 0
        {
            merged["utilization"][window]["fetchedAtMs"] = Value::from(original_cache_time);
        }
    }
    let mut changed = false;
    for window in ["five_hour", "seven_day"] {
        let Some(anchor_window) = anchor_utilization.get(window) else {
            continue;
        };
        let anchor_time = ledger_window_observed_at(entry, window).unwrap_or(0);
        if anchor_time > cached_time(window) {
            changed = true;
            merged["utilization"][window] = anchor_window.clone();
            if let Some(observed) = merged
                .pointer_mut(&format!("/utilization/{window}"))
                .and_then(Value::as_object_mut)
            {
                observed.insert("fetchedAtMs".into(), Value::from(anchor_time));
            }
            let latest = merged
                .get("fetchedAtMs")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            merged["fetchedAtMs"] = Value::from(latest.max(anchor_time));
        }
    }
    if changed
        && merged
            .get("utilization")
            .and_then(Value::as_object)
            .is_some_and(|u| !u.is_empty())
    {
        merged["accountUuid"] = Value::String(anchor_uuid.unwrap_or_default().to_string());
        claude_json["cachedUsageUtilization"] = merged;
    }
}

fn ledger_window_observed_at(entry: &Value, window: &str) -> Option<u64> {
    let suffix = if window == "five_hour" { "5h" } else { "7d" };
    entry
        .get(format!("quota_{suffix}_observed_at_ms"))
        .and_then(Value::as_u64)
        .filter(|v| *v > 0)
        .or_else(|| {
            let observed_windows = entry
                .get("server_anchor_observed_windows")
                .and_then(Value::as_array);
            let explicitly_excluded = observed_windows
                .is_some_and(|items| !items.iter().any(|item| item.as_str() == Some(window)));
            let window_ms = entry
                .pointer(&format!("/server_anchor/utilization/{window}/fetchedAtMs"))
                .and_then(Value::as_u64)
                .filter(|v| *v > 0);
            let anchor_ms = if explicitly_excluded {
                None
            } else {
                entry
                    .pointer("/server_anchor/fetchedAtMs")
                    .and_then(Value::as_u64)
                    .filter(|v| *v > 0)
            };
            let sibling = if window == "five_hour" {
                "seven_day"
            } else {
                "five_hour"
            };
            let sibling_ms = entry
                .pointer(&format!("/server_anchor/utilization/{sibling}/fetchedAtMs"))
                .and_then(Value::as_u64)
                .filter(|v| *v > 0);
            match (window_ms, anchor_ms) {
                (Some(w_ms), Some(a_ms)) if a_ms > w_ms && sibling_ms == Some(w_ms) => Some(a_ms),
                (Some(w_ms), _) => Some(w_ms),
                (None, Some(a_ms)) => Some(a_ms),
                (None, None) => None,
            }
        })
}

pub(super) fn ledger_window_value(
    entry: &Value,
    window: &str,
    now_sec: u64,
) -> Option<(u8, u64, u64, QuotaSource)> {
    let suffix = if window == "five_hour" { "5h" } else { "7d" };
    let anchor_window = entry.pointer(&format!("/server_anchor/utilization/{window}"));
    let explicit_source = entry
        .get(format!("quota_{suffix}_source"))
        .and_then(Value::as_str);
    if explicit_source == Some("unknown") {
        return None;
    }
    let global_source = entry.get("quota_source").and_then(Value::as_str);
    let source = match explicit_source {
        Some("server_anchor") => QuotaSource::ServerAnchor,
        Some("local_estimate") => QuotaSource::LocalEstimate,
        Some("reset_inferred") => QuotaSource::ResetInferred,
        Some(_) => QuotaSource::Unknown,
        None if global_source == Some("local_estimate") => QuotaSource::LocalEstimate,
        None if anchor_window.is_some() => QuotaSource::ServerAnchor,
        None if global_source == Some("server_anchor") => QuotaSource::ServerAnchor,
        _ => QuotaSource::Unknown,
    };
    if source == QuotaSource::Unknown {
        return None;
    }
    let (used, reset) = if source == QuotaSource::ServerAnchor && anchor_window.is_some() {
        let window = anchor_window?;
        let used = window
            .get("utilization")
            .and_then(Value::as_f64)
            .and_then(crate::quota_core::observed_percentage)?
            .round() as u64;
        let reset = window.get("resets_at").and_then(parse_reset_value)?;
        (used, reset)
    } else {
        let used = entry
            .get(format!("quota_{suffix}_used"))
            .and_then(Value::as_u64)?;
        let reset = entry
            .get(format!("quota_{suffix}_reset_at"))
            .and_then(Value::as_u64)?;
        (used, reset)
    };
    let observed = ledger_window_observed_at(entry, window)?;
    if source == QuotaSource::ResetInferred {
        let raw_anchor = ledger_reset_inferred_value(entry, window, now_sec)?;
        if used != 0
            || reset > now_sec
            || observed / 1000 >= reset
            || raw_anchor.1 != reset
            || raw_anchor.2 != observed
        {
            return None;
        }
    } else if reset <= now_sec {
        return None;
    }
    let used = crate::quota_core::observed_percentage(used as f64)?.round() as u8;
    Some((used, reset, observed, source))
}

pub(super) fn ledger_reset_inferred_value(
    entry: &Value,
    window: &str,
    now_sec: u64,
) -> Option<(u8, u64, u64, QuotaSource)> {
    let suffix = if window == "five_hour" { "5h" } else { "7d" };
    let explicit_source = entry
        .get(format!("quota_{suffix}_source"))
        .and_then(Value::as_str);
    if explicit_source == Some("local_estimate") {
        return None;
    }
    if explicit_source.is_none()
        && entry.get("quota_source").and_then(Value::as_str) == Some("local_estimate")
    {
        return None;
    }
    let anchor = entry.get("server_anchor")?;
    let anchor_uuid = anchor.get("accountUuid").and_then(Value::as_str)?;
    if let Some(account_uuid) = entry.get("account_uuid").and_then(Value::as_str) {
        if account_uuid != anchor_uuid {
            return None;
        }
    }
    let anchor_window = anchor.pointer(&format!("/utilization/{window}"))?;
    let _used = anchor_window
        .get("utilization")
        .and_then(Value::as_f64)
        .and_then(crate::quota_core::observed_percentage)?;
    let reset = anchor_window.get("resets_at").and_then(parse_reset_value)?;
    let observed = anchor_window
        .get("fetchedAtMs")
        .and_then(Value::as_u64)
        .or_else(|| {
            let observed_windows = entry
                .get("server_anchor_observed_windows")
                .and_then(Value::as_array);
            let explicitly_included = observed_windows
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(window)));
            if observed_windows.is_some() && !explicitly_included {
                return None;
            }
            anchor.get("fetchedAtMs").and_then(Value::as_u64)
        })
        .filter(|value| *value > 0)?;
    if reset > now_sec || observed / 1000 >= reset {
        return None;
    }
    Some((0, reset, observed, QuotaSource::ResetInferred))
}

fn merge_summary_window(
    used: &mut Option<u8>,
    reset: &mut Option<u64>,
    source: &mut Option<QuotaSource>,
    observed: &mut Option<u64>,
    candidate: Option<(u8, u64, u64, QuotaSource)>,
    now_sec: u64,
) -> bool {
    // Legacy summaries without a source retain their existing observation-order
    // protection; an explicit Unknown still means no usable evidence.
    let current = WindowState {
        used: *used,
        reset_at: *reset,
        source: source.unwrap_or(QuotaSource::ServerAnchor),
        observed_at_ms: *observed,
    };
    let candidate = candidate.map(|(used, reset, observed, source)| WindowState {
        used: Some(used),
        reset_at: Some(reset),
        source,
        observed_at_ms: Some(observed),
    });
    let result = merge_window(current, candidate, now_sec);
    let changed = result != current;
    *used = result.used;
    *reset = result.reset_at;
    if source.is_some() || changed {
        *source = Some(result.source);
    }
    *observed = result.observed_at_ms;
    changed
}

pub(in crate::identities) fn read_ledger_root(vault_dir: &Path) -> Option<Value> {
    let parent = vault_dir.parent()?;
    read_bounded_json(&parent.join("quota_ledger.json"), 8 * 1024 * 1024)
}

pub(super) fn apply_anchor_scoped_extras(
    anchor: Option<&Value>,
    entry: Option<&Value>,
    now_sec: u64,
    has_5h: bool,
    no_5h_limit: &mut bool,
    rested_5h: &mut bool,
    fable_used: &mut Option<f64>,
    fable_reset: &mut Option<i64>,
) -> bool {
    let before = (*no_5h_limit, *rested_5h, *fable_used, *fable_reset);
    if has_5h
        || anchor
            .and_then(|a| a.pointer("/utilization/five_hour"))
            .is_some_and(Value::is_object)
    {
        *no_5h_limit = false;
        *rested_5h = false;
    } else if anchor
        .and_then(|a| a.get("no_five_hour"))
        .and_then(Value::as_bool)
        == Some(true)
        || entry
            .and_then(|e| e.get("quota_no_5h_limit"))
            .and_then(Value::as_bool)
            == Some(true)
        || entry
            .and_then(|e| e.get("quota_5h_rested"))
            .and_then(Value::as_bool)
            == Some(true)
    {
        *no_5h_limit = true;
        *rested_5h = true;
    }
    let anchor_sf = anchor.and_then(|a| a.get("scoped_fable_7d"));
    let parsed_sf = anchor_sf
        .and_then(|sf| {
            let pct = sf
                .get("pct")
                .and_then(Value::as_f64)
                .and_then(crate::quota_core::observed_percentage)?;
            let reset = sf.get("resetsAt").and_then(Value::as_i64)?;
            (reset > now_sec as i64).then_some((pct, reset))
        })
        .or_else(|| {
            let e = entry?;
            let pct = e
                .get("quota_7d_fable_used")
                .and_then(Value::as_f64)
                .and_then(crate::quota_core::observed_percentage)?;
            let reset = e.get("quota_7d_fable_reset_at").and_then(Value::as_i64)?;
            (reset > now_sec as i64).then_some((pct, reset))
        });
    if let Some((pct, reset)) = parsed_sf {
        *fable_used = Some(pct);
        *fable_reset = Some(reset);
    } else if fable_reset.is_some_and(|r| r <= now_sec as i64) {
        *fable_used = None;
        *fable_reset = None;
    }
    (*no_5h_limit, *rested_5h, *fable_used, *fable_reset) != before
}

pub(crate) fn enforce_plan_quota_limits(plan: Option<&str>, quota_no_5h_limit: &mut bool) {
    if let Some(raw) = plan.map(str::trim).filter(|p| !p.is_empty()) {
        let lower = raw.to_ascii_lowercase();
        if lower == "free"
            || lower == "pro"
            || lower.starts_with("max")
            || lower == "team"
            || lower == "enterprise"
        {
            *quota_no_5h_limit = false;
        }
    }
}

pub(crate) fn apply_web_plan_tier(plan: &mut Option<String>, web: &super::super::online::WebMetadata) {
    match web.plan_tier.as_deref() {
        Some("Ultra")
            if plan
                .as_deref()
                .is_none_or(|p| !matches!(p, "Free" | "Pro" | "Team" | "Enterprise")) =>
        {
            *plan = Some("Ultra".into());
        }
        Some(tier @ ("Team" | "Enterprise"))
            if plan.as_deref().is_none_or(|p| p == "Pro / Max") =>
        {
            *plan = Some(tier.into());
        }
        _ => {}
    }
}

pub(super) fn apply_ledger_to_summary(
    vault_dir: &Path,
    summary: &mut Summary,
    saved_at_ms: u64,
    now_sec: u64,
) {
    let root = read_ledger_root(vault_dir);
    apply_parsed_ledger_to_summary(root.as_ref(), summary, saved_at_ms, now_sec);
}

pub(in crate::identities) fn apply_parsed_ledger_to_summary(
    root: Option<&Value>,
    summary: &mut Summary,
    _saved_at_ms: u64,
    now_sec: u64,
) {
    let Some(root) = root else {
        return;
    };
    let Some(email) = summary
        .email
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    else {
        return;
    };
    let key = email.to_ascii_lowercase();
    let Some(entry) = ledger_account(root, &key, summary.quota_identity.as_deref()) else {
        return;
    };
    let legacy_org_match = entry.get("quota_identity").is_none()
        && entry.get("organization_uuid").is_none()
        && entry
            .pointer("/server_anchor/accountUuid")
            .or_else(|| entry.get("account_uuid"))
            .and_then(Value::as_str)
            .is_some_and(|u| !u.trim().is_empty())
        && summary.organization.as_deref().is_some_and(|org| {
            !org.trim().is_empty()
                && entry
                    .get("organization")
                    .or_else(|| entry.get("organization_name"))
                    .and_then(Value::as_str)
                    == Some(org)
        });
    if summary.quota_identity.is_none()
        || (summary.quota_identity != ledger_identity(entry, &key) && !legacy_org_match)
    {
        return;
    }
    if summary.quota_5h_source.is_none() && summary.quota_5h_used.is_some() {
        summary.quota_5h_observed_at_ms = summary.quota_observed_at_ms;
        summary.quota_5h_source = summary.quota_source;
    }
    if summary.quota_7d_source.is_none() && summary.quota_7d_used.is_some() {
        summary.quota_7d_observed_at_ms = summary.quota_observed_at_ms;
        summary.quota_7d_source = summary.quota_source;
    }

    let explicit_no_5h = entry
        .pointer("/server_anchor/no_five_hour")
        .and_then(Value::as_bool)
        == Some(true)
        && !entry
            .pointer("/server_anchor/utilization/five_hour")
            .is_some_and(Value::is_object);
    if explicit_no_5h {
        let anchor_ms = entry
            .pointer("/server_anchor/fetchedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if anchor_ms >= summary.quota_5h_observed_at_ms.unwrap_or(0) {
            summary.quota_5h_used = None;
            summary.quota_5h_reset_at = None;
            summary.quota_5h_source = Some(QuotaSource::Unknown);
        }
    }

    let merged_5h = merge_summary_window(
        &mut summary.quota_5h_used,
        &mut summary.quota_5h_reset_at,
        &mut summary.quota_5h_source,
        &mut summary.quota_5h_observed_at_ms,
        ledger_window_value(entry, "five_hour", now_sec)
            .or_else(|| ledger_reset_inferred_value(entry, "five_hour", now_sec)),
        now_sec,
    );
    let merged_7d = merge_summary_window(
        &mut summary.quota_7d_used,
        &mut summary.quota_7d_reset_at,
        &mut summary.quota_7d_source,
        &mut summary.quota_7d_observed_at_ms,
        ledger_window_value(entry, "seven_day", now_sec)
            .or_else(|| ledger_reset_inferred_value(entry, "seven_day", now_sec)),
        now_sec,
    );
    let merged_extras = apply_anchor_scoped_extras(
        entry.get("server_anchor"),
        Some(entry),
        now_sec,
        summary.quota_5h_used.is_some(),
        &mut summary.quota_no_5h_limit,
        &mut summary.quota_5h_rested,
        &mut summary.quota_7d_fable_used,
        &mut summary.quota_7d_fable_reset_at,
    );
    if summary.refresh_token_expires_at.is_none() {
        summary.refresh_token_expires_at = entry
            .get("refresh_token_expires_at")
            .and_then(Value::as_i64)
            .filter(|&v| v > 0)
            .map(normalize_epoch_sec);
    }
    if entry.get("plan").and_then(Value::as_str) == Some("Ultra")
        && summary
            .plan
            .as_deref()
            .is_none_or(|p| matches!(p, "Max" | "Max 5x" | "Max 20x" | "Pro / Max" | "Ultra"))
    {
        summary.plan = Some("Ultra".into());
    }
    enforce_plan_quota_limits(summary.plan.as_deref(), &mut summary.quota_no_5h_limit);
    if merged_5h || merged_7d || merged_extras {
        summary.quota_checked = Some(true);
        summary.quota_version = Some(CURRENT_QUOTA_VERSION);
    }
    summary.quota_source = aggregate_source(summary.quota_5h_source, summary.quota_7d_source);
    if summary.quota_no_5h_limit
        && summary.quota_5h_used.is_none()
        && matches!(summary.quota_7d_source, Some(s) if s != QuotaSource::Unknown)
    {
        summary.quota_source = summary.quota_7d_source;
    }
    summary.quota_observed_at_ms = max_observation(
        summary.quota_5h_observed_at_ms,
        summary.quota_7d_observed_at_ms,
    );
    summary.refresh_for_now(now_sec);
}
