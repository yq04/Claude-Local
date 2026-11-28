// [INPUT]: 用户显式触发的隔离 Chromium（`LaunchPurpose::QuotaSync`）、带本地 quota_identity 指纹的单次受控回环提交与当前或已保存账号的绑定身份快照。
// [OUTPUT]: 经 `Cleaner < SlotGate < Browser::gate` 协调且不跨启动/退出占锁的短期回环监听与未挂载扩展实例自动切换重开、目标绑定复核后的白名单订阅/重置元数据（区分 next_renewal 与 access_until）、实时 5h/7d 额度窗口、有界权益有效期与逐份 active grant 明细及脱敏 kyc_status/kyc_check_kind，或白名单桥接失败；Python仍唯一写入额度账本。
// [POS]: Claude.ai 到身份账本的多账号并发短期单次桥；支持 current 与任意已保存 account_id 并行同步，不串号、不抢占全局会话、不读取 Cookie，不后台轮询。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) use super::quota_existing::query_existing_profile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{net::TcpListener, time::Duration};
use tauri::{Emitter, Manager};

const SYNC_WAIT: Duration = Duration::from_secs(45);
const MAX_GRANTS: usize = 100;
const ZERO_VALIDITY_SECS: i64 = 6 * 60 * 60;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Incoming {
    pub nonce: String,
    pub account_uuid: Option<String>,
    pub organization_uuid: Option<String>,
    pub subscription_details: Option<Value>,
    pub usage: Option<Value>,
    pub kyc_status: Option<Value>,
    pub failure: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct ResetGrant {
    pub resets_left: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct Snapshot {
    pub account_uuid: String,
    pub organization_uuid: String,
    pub billing_date_kind: &'static str,
    pub billing_date: Option<i64>,
    pub manual_resets_remaining: Option<u64>,
    pub manual_resets_valid_until: Option<i64>,
    /// Latest finite `ends_at` across active positive grants, uncapped. `None` when
    /// balance is zero or any active positive grant has `ends_at: null`.
    /// `manual_resets_valid_until` stays bounded to 24h as a freshness window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_grant_ends_at: Option<i64>,
    /// Per-grant breakdown for active positive grants sorted earliest-first
    /// (`ends_at: None` last); depleted, paused, and out-of-window grants are excluded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_grants: Option<Vec<ResetGrant>>,
    pub metadata_observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kyc_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kyc_check_kind: Option<String>,
}

/// Extracts allowlisted `(kyc_status, kyc_check_kind)` while ignoring vendor inquiry metadata.
fn parse_kyc_status(raw: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(obj) = raw.and_then(Value::as_object) else {
        return (None, None);
    };
    let Some(status) = obj
        .get("status")
        .and_then(Value::as_str)
        .and_then(crate::identities::online::normalize_kyc_status)
    else {
        return (None, None);
    };
    let check_kind = obj
        .get("check_kind")
        .and_then(Value::as_str)
        .and_then(crate::identities::online::normalize_kyc_check_kind);
    (Some(status), check_kind)
}

fn valid_uuid(value: &str) -> bool {
    let mut parts = value.split('-');
    let sizes = [8, 4, 4, 4, 12];
    sizes.iter().all(|size| {
        parts
            .next()
            .is_some_and(|part| part.len() == *size && part.bytes().all(|b| b.is_ascii_hexdigit()))
    }) && parts.next().is_none()
}

fn parse_timestamp(value: &Value) -> Option<i64> {
    let text = value.as_str()?;
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|date| date.timestamp())
}

fn billing_info(details: Option<&Value>) -> (Option<i64>, &'static str) {
    let Some(details) = details else {
        return (None, "unknown");
    };
    let cancel_at_end = details
        .get("cancel_at_period_end")
        .and_then(Value::as_bool)
        == Some(true)
        || details.get("canceled_at").is_some_and(|v| !v.is_null())
        || details.get("cancelled_at").is_some_and(|v| !v.is_null());
    let next_charge = details.get("next_charge_date").and_then(parse_timestamp);
    if !cancel_at_end {
        if let Some(ts) = next_charge {
            return (Some(ts), "next_renewal");
        }
    }
    for key in ["ends_at", "cancel_at", "current_period_end", "access_until"] {
        if let Some(ts) = details.get(key).and_then(parse_timestamp) {
            return (Some(ts), "access_until");
        }
    }
    if let Some(ts) = next_charge {
        return (Some(ts), "access_until");
    }
    (None, "unknown")
}

fn parse_optional_timestamp(grant: &Value, key: &str) -> Result<Option<i64>, ()> {
    let Some(raw) = grant.get(key) else {
        return Err(());
    };
    if raw.is_null() {
        return Ok(None);
    }
    parse_timestamp(raw).map(Some).ok_or(())
}

/// (remaining, 24h-bounded freshness expiry, uncapped latest finite grant end, per-grant slices).
fn resets_with_grant_end(
    usage: Option<&Value>,
    observed_ms: u64,
) -> (Option<u64>, Option<i64>, Option<i64>, Option<Vec<ResetGrant>>) {
    let Some(cedar) = usage.and_then(|value| value.get("cedar_ember")) else {
        return (None, None, None, None);
    };
    if cedar.get("eligible").and_then(Value::as_bool) != Some(true) {
        return (None, None, None, None);
    }
    let Ok(observed) = i64::try_from(observed_ms / 1000) else {
        return (None, None, None, None);
    };
    let Some(grants) = cedar.get("grants").and_then(Value::as_array) else {
        return (Some(0), Some(observed.saturating_add(ZERO_VALIDITY_SECS)), None, None);
    };
    if grants.len() > MAX_GRANTS {
        return (None, None, None, None);
    }
    let mut total = 0u64;
    let mut active_grants: Vec<ResetGrant> = Vec::new();
    for grant in grants {
        let Some(count) = grant.get("resets_left").and_then(Value::as_u64) else {
            return (None, None, None, None);
        };
        if count == 0
            && (grant.get("paused").is_none()
                || grant.get("starts_at").is_none()
                || grant.get("ends_at").is_none())
        {
            continue;
        }
        let Some(paused) = grant.get("paused").and_then(Value::as_bool) else {
            return (None, None, None, None);
        };
        let Ok(starts) = parse_optional_timestamp(grant, "starts_at") else {
            return (None, None, None, None);
        };
        let Ok(ends) = parse_optional_timestamp(grant, "ends_at") else {
            return (None, None, None, None);
        };
        // Depleted grants never contribute counts or constrain later positive grants' expiry.
        if count == 0 {
            continue;
        }
        if let (Some(s), Some(e)) = (starts, ends) {
            if s >= e {
                return (None, None, None, None);
            }
        }
        let Ok(count_u32) = u32::try_from(count) else {
            return (None, None, None, None);
        };
        if !paused
            && starts.is_none_or(|s| s <= observed)
            && ends.is_none_or(|e| observed < e)
        {
            total = match total.checked_add(count) {
                Some(value) => value,
                None => return (None, None, None, None),
            };
            let bounded_end = ends.filter(|e| *e <= 253402300799);
            if let Some(existing) = active_grants.iter_mut().find(|g| g.ends_at == bounded_end) {
                existing.resets_left = match existing.resets_left.checked_add(count_u32) {
                    Some(sum) => sum,
                    None => return (None, None, None, None),
                };
            } else {
                active_grants.push(ResetGrant {
                    resets_left: count_u32,
                    ends_at: bounded_end,
                });
            }
        }
    }
    active_grants.sort_by_key(|g| (g.ends_at.is_none(), g.ends_at));
    let validity_bound = observed.saturating_add(24 * 60 * 60);
    let earliest_finite = active_grants.iter().filter_map(|g| g.ends_at).min();
    let latest_finite = active_grants.iter().filter_map(|g| g.ends_at).max();
    let has_unbounded = active_grants.iter().any(|g| g.ends_at.is_none());
    let valid_until = if total == 0 {
        observed.saturating_add(ZERO_VALIDITY_SECS)
    } else {
        earliest_finite.map_or(validity_bound, |ends| ends.min(validity_bound))
    };
    // Only a positive balance with no unbounded grant has a definite finite overall end.
    let grant_end = if total > 0 && !has_unbounded {
        latest_finite.filter(|ends| *ends > observed && *ends <= 253402300799)
    } else {
        None
    };
    let grant_slices = (total > 0).then_some(active_grants);
    (Some(total), Some(valid_until), grant_end, grant_slices)
}

pub(super) fn snapshot(incoming: Incoming, observed_ms: u64) -> Result<Snapshot, String> {
    if let Some(failure) = incoming.failure.as_deref() {
        return Err(match failure {
            "identity_unavailable" => "quotaOnline.bridgeIdentityUnavailable",
            "identity_changed" => "quotaOnline.accountMismatch",
            "usage_unavailable" => "quotaOnline.browserUsageUnavailable",
            "web_auth_required" => "quotaOnline.browserWebAuthRequired",
            "web_access_denied" => "quotaOnline.browserWebAccessDenied",
            "request_timeout" => "quotaOnline.browserRequestTimeout",
            "invalid_response" => "quotaOnline.invalidResponse",
            _ => "quotaOnline.unavailable",
        }.into());
    }
    let account_uuid = incoming.account_uuid.as_deref().unwrap_or("");
    let organization_uuid = incoming.organization_uuid.as_deref().unwrap_or("");
    if !valid_uuid(account_uuid) || !valid_uuid(organization_uuid) {
        return Err("quotaOnline.bridgeIdentityUnavailable".into());
    }
    if incoming.nonce.len() != 48 || !incoming.nonce.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("quotaOnline.bridgeTicketInvalid".into());
    }
    let (billing_date, billing_date_kind) = billing_info(incoming.subscription_details.as_ref());
    let (
        manual_resets_remaining,
        manual_resets_valid_until,
        manual_resets_grant_ends_at,
        manual_resets_grants,
    ) = resets_with_grant_end(incoming.usage.as_ref(), observed_ms);
    let usage = quota_windows(incoming.usage.as_ref());
    let (kyc_status, kyc_check_kind) = parse_kyc_status(incoming.kyc_status.as_ref());
    Ok(Snapshot {
        account_uuid: account_uuid.to_string(),
        organization_uuid: organization_uuid.to_string(),
        billing_date_kind,
        billing_date,
        manual_resets_remaining,
        manual_resets_valid_until,
        manual_resets_grant_ends_at,
        manual_resets_grants,
        metadata_observed_at_ms: observed_ms,
        usage,
        kyc_status,
        kyc_check_kind,
    })
}

fn project_window(value: &Value) -> Option<Value> {
    let window = value.as_object()?;
    let used = window.get("utilization")?;
    let reset = window.get("resets_at")?;
    Some(serde_json::json!({"utilization": used, "resets_at": reset}))
}

fn window_utilization_score(value: &Value) -> Option<f64> {
    let pct = value.get("utilization")?.as_f64()?;
    (pct.is_finite() && (0.0..=100.0).contains(&pct)).then_some(pct)
}

fn is_fable_scoped_limit(item: &Value) -> bool {
    let id = item
        .pointer("/scope/model/id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let display = item
        .pointer("/scope/model/display_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    id.to_ascii_lowercase().contains("fable") || display.to_ascii_lowercase().contains("fable")
}

fn quota_windows(usage: Option<&Value>) -> Option<Value> {
    let usage = usage?.as_object()?;
    let mut windows = serde_json::Map::new();
    for name in ["five_hour", "seven_day"] {
        if let Some(projected) = usage.get(name).and_then(project_window) {
            windows.insert(name.into(), projected);
        }
    }
    let mut best_scoped: Option<(f64, Value)> = None;
    let mut fable_scoped: Option<(f64, Value)> = None;
    for scoped_key in ["seven_day_fable", "seven_day_opus", "seven_day_sonnet"] {
        if let Some(projected) = usage.get(scoped_key).and_then(project_window) {
            if let Some(score) = window_utilization_score(&projected) {
                if best_scoped.as_ref().is_none_or(|(best, _)| score > *best) {
                    best_scoped = Some((score, projected.clone()));
                }
                if scoped_key == "seven_day_fable"
                    && fable_scoped.as_ref().is_none_or(|(best, _)| score > *best)
                {
                    fable_scoped = Some((score, projected));
                }
            }
        }
    }
    if let Some(limits) = usage.get("limits").and_then(Value::as_array) {
        for item in limits.iter().take(32) {
            if item.get("kind").and_then(Value::as_str) != Some("weekly_scoped") {
                continue;
            }
            if let Some(projected) = project_window(item) {
                if let Some(score) = window_utilization_score(&projected) {
                    if best_scoped.as_ref().is_none_or(|(best, _)| score > *best) {
                        best_scoped = Some((score, projected.clone()));
                    }
                    if is_fable_scoped_limit(item)
                        && fable_scoped.as_ref().is_none_or(|(best, _)| score > *best)
                    {
                        fable_scoped = Some((score, projected));
                    }
                }
            }
        }
    }
    if !windows.contains_key("seven_day") {
        if let Some((_, fallback_7d)) = best_scoped {
            windows.insert("seven_day".into(), fallback_7d);
        }
    }
    if let Some((_, fable_7d)) = fable_scoped {
        windows.insert("seven_day_fable".into(), fable_7d);
    }
    if usage.get("five_hour").is_some_and(Value::is_null) && windows.contains_key("seven_day") {
        windows.insert("five_hour".into(), Value::Null);
    }
    (!windows.is_empty()).then_some(Value::Object(windows))
}

#[tauri::command]
pub async fn identities_sync_subscription(
    app: tauri::AppHandle,
    expected_identity: String,
    account_id: Option<String>,
) -> Result<(), String> {
    // Resolve the identity before taking browser locks; identity state itself reads browser warning state.
    let (slot_owner_id, collector_account_id, quota_identity) =
        crate::identities::online::target_browser_binding(&app, account_id.as_deref())?;
    if quota_identity != expected_identity
        || expected_identity.len() != 64
        || !expected_identity
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("quotaOnline.accountMismatch".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        sync(
            &app,
            account_id,
            slot_owner_id,
            collector_account_id,
            quota_identity,
        )
    })
    .await
    .map_err(|_| "quotaOnline.unavailable".to_string())?
}

pub(crate) fn verify_ticket_binding(
    expected_slot_owner: &str,
    expected_collector_id: &str,
    expected_quota_identity: &str,
    fresh_slot_owner: &str,
    fresh_collector_id: &str,
    fresh_quota_identity: &str,
) -> Result<(), String> {
    if fresh_slot_owner != expected_slot_owner
        || fresh_collector_id != expected_collector_id
        || !fresh_quota_identity.eq_ignore_ascii_case(expected_quota_identity)
    {
        return Err("quotaOnline.accountMismatch".into());
    }
    Ok(())
}

fn commit_browser_snapshot(
    app: &tauri::AppHandle,
    requested_account_id: Option<&str>,
    slot_owner_id: &str,
    collector_account_id: &str,
    quota_identity: &str,
    snapshot: Snapshot,
) -> Result<(), String> {
    let (fresh_slot_owner, fresh_collector_id, fresh_quota_identity) =
        crate::identities::online::target_browser_binding(app, requested_account_id)?;
    verify_ticket_binding(
        slot_owner_id,
        collector_account_id,
        quota_identity,
        &fresh_slot_owner,
        &fresh_collector_id,
        &fresh_quota_identity,
    )?;
    if snapshot.billing_date.is_none()
        && snapshot.manual_resets_remaining.is_none()
        && snapshot.usage.is_none()
        && snapshot.kyc_status.is_none()
    {
        return Err("quotaOnline.bridgeUnavailable".into());
    }
    let value = crate::identities::online::import_browser_snapshot(
        app,
        collector_account_id,
        quota_identity,
        serde_json::to_value(snapshot).map_err(|_| "quotaOnline.unavailable")?,
    )?;
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !matches!(status, "updated" | "cached") {
        return Err(match status {
            "account_mismatch" => "quotaOnline.accountMismatch".into(),
            "auth_required" => "quotaOnline.authRequired".into(),
            _ => "quotaOnline.unavailable".into(),
        });
    }
    if value
        .get("metadata_updated")
        .and_then(Value::as_bool)
        == Some(true)
    {
        let _ = app.emit("quota-metadata-updated", ());
    }
    Ok(())
}

fn sync(
    app: &tauri::AppHandle,
    requested_account_id: Option<String>,
    slot_owner_id: String,
    collector_account_id: String,
    quota_identity: String,
) -> Result<(), String> {
    if quota_identity.len() != 64 || !quota_identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("quotaOnline.bridgeUnavailable".into());
    }

    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "quotaOnline.unavailable".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "quotaOnline.unavailable".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "quotaOnline.unavailable".to_string())?
        .port();
    if port == 0 {
        return Err("quotaOnline.unavailable".into());
    }
    let token = super::server::nonce()?;
    let nonce = super::server::nonce()?;
    let target = format!(
        "http://127.0.0.1:{port}/{token}/browser.html#quota-sync={nonce}&quota_identity={quota_identity}"
    );

    // Acquire Cleaner::enter_browser_account -> SlotGate -> short Browser::gate (only to read/recheck
    // slot selection, never held across launch/quit/preflight).
    {
        let root = super::root(app)?;
        super::workspaces::ready(&root)?;
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        let _account_guard = cleaner.enter_browser_account(&quota_identity)?;
        let _running_memo = super::profile::begin_running_memo();
        let browser = app.state::<super::Browser>();
        let options =
            super::config::LaunchOptions::for_purpose(super::config::LaunchPurpose::QuotaSync);

        let recheck_binding = || -> Result<(), String> {
            let (fresh_slot_owner, fresh_collector_id, fresh_quota_identity) =
                crate::identities::online::target_browser_binding(
                    app,
                    requested_account_id.as_deref(),
                )?;
            verify_ticket_binding(
                &slot_owner_id,
                &collector_account_id,
                &quota_identity,
                &fresh_slot_owner,
                &fresh_collector_id,
                &fresh_quota_identity,
            )
        };
        recheck_binding()?;

        if slot_owner_id == "current" {
            browser.with_active_slot_gate(
                || {
                    let db = super::workspaces::database(&root)?;
                    if !db.browser_link()?.enabled || db.current_browser_is_warming()? {
                        return Err("quotaOnline.unavailable".into());
                    }
                    db.browser_slot()
                },
                |slot, gate| {
                    let scope = {
                        let _guard = gate.lock().unwrap();
                        let db = super::workspaces::database(&root)?;
                        if !db.browser_link()?.enabled || db.current_browser_is_warming()? {
                            return Err("quotaOnline.unavailable".into());
                        }
                        if db.browser_slot()? != slot {
                            return Ok((false, ()));
                        }
                        recheck_binding()?;
                        super::workspaces::ensure(&root)?
                    };
                    super::quota_connection::launch_scope_url_with_options_locked(
                        app,
                        &scope,
                        &target,
                        options,
                        None,
                        recheck_binding,
                    )?;
                    Ok((true, ()))
                },
            )?;
        } else {
            let mut proof_cache = super::lifecycle::CliProofCache::default();
            let pre_slot = super::quota_connection::lookup_existing_bound_slot_with_cache(
                app,
                &collector_account_id,
                &quota_identity,
                &mut proof_cache,
            );
            let pre_gate = pre_slot.as_deref().map(|s| browser.slot_gate(s));
            let mut pre_guard = pre_gate.as_ref().map(|g| g.lock());

            super::quota_connection::materialize_identity_profile_with_cache(
                app,
                &collector_account_id,
                &quota_identity,
                &mut proof_cache,
            )?;
            let bound = super::quota_connection::resolve_bound_profile_target_with_cache(
                app,
                &collector_account_id,
                &quota_identity,
                &mut proof_cache,
            )?;
            let _late_gate;
            let _late_guard;
            if pre_slot.as_deref() != Some(bound.slot.as_str()) {
                drop(pre_guard.take());
                _late_gate = browser.slot_gate(&bound.slot);
                _late_guard = Some(_late_gate.lock());
            }
            recheck_binding()?;
            super::quota_connection::launch_scope_url_with_options_locked(
                app,
                &bound.scope,
                &target,
                options,
                None,
                || {
                    recheck_binding()?;
                    let fresh = super::quota_connection::resolve_bound_profile_target_uncached(
                        app,
                        &collector_account_id,
                        &quota_identity,
                    )?;
                    if fresh != bound {
                        return Err("quotaOnline.accountMismatch".into());
                    }
                    Ok(())
                },
            )?;
        }
    }

    match super::quota_existing::receive_subscription_sync(
        listener,
        &token,
        &nonce,
        SYNC_WAIT,
        |snapshot| {
            commit_browser_snapshot(
                app,
                requested_account_id.as_deref(),
                &slot_owner_id,
                &collector_account_id,
                &quota_identity,
                snapshot,
            )
        },
    ) {
        Ok(()) => Ok(()),
        Err(err) if err == "quotaOnline.deadlineExceeded" => {
            Err("quotaOnline.browserFallback.deadline_exceeded".into())
        }
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ACCOUNT: &str = "11111111-1111-4111-8111-111111111111";
    const ORG: &str = "22222222-2222-4222-8222-222222222222";
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
    const OBSERVED: u64 = 1_800_000_000_000;

    fn input(subscription_details: Option<Value>, usage: Option<Value>) -> Incoming {
        Incoming {
            nonce: NONCE.into(),
            account_uuid: Some(ACCOUNT.into()),
            organization_uuid: Some(ORG.into()),
            subscription_details,
            usage,
            kyc_status: None,
            failure: None,
        }
    }

    #[test]
    fn next_charge_date_is_renewal_and_valid_active_grants_are_summed() {
        let details = json!({"next_charge_date":"2027-01-01T00:00:00Z"});
        let usage = json!({"cedar_ember":{"eligible":true,"grants":[
            {"resets_left":2,"starts_at":"2026-01-01T00:00:00Z","ends_at":"2028-01-01T00:00:00Z","paused":false},
            {"resets_left":9,"starts_at":"2026-01-01T00:00:00Z","ends_at":"2028-01-01T00:00:00Z","paused":true},
            {"resets_left":5,"starts_at":"2029-01-01T00:00:00Z","ends_at":"2030-01-01T00:00:00Z","paused":false},
            {"resets_left":7,"starts_at":"2025-01-01T00:00:00Z","ends_at":"2026-01-01T00:00:00Z","paused":false}
        ]}});
        let result = snapshot(input(Some(details), Some(usage)), OBSERVED).unwrap();
        assert_eq!(result.billing_date_kind, "next_renewal");
        assert_eq!(result.billing_date, Some(1_798_761_600));
        assert_eq!(result.manual_resets_remaining, Some(2));
        assert_eq!(
            result.manual_resets_valid_until,
            Some(OBSERVED as i64 / 1000 + 24 * 60 * 60)
        );
        // The real grant end survives uncapped (2028-01-01) for stale-vs-ended display.
        assert_eq!(result.manual_resets_grant_ends_at, Some(1_830_297_600));
        let serialized = serde_json::to_value(&result).unwrap();
        assert_eq!(serialized["manual_resets_grant_ends_at"], json!(1_830_297_600));
    }

    #[test]
    fn missing_or_ineligible_data_is_unknown_and_never_zero() {
        let missing = snapshot(input(None, None), OBSERVED).unwrap();
        assert_eq!(missing.billing_date_kind, "unknown");
        assert_eq!(missing.billing_date, None);
        assert_eq!(missing.manual_resets_remaining, None);
        let ineligible = json!({"cedar_ember":{"eligible":false,"grants":[]}});
        assert_eq!(
            snapshot(input(None, Some(ineligible)), OBSERVED)
                .unwrap()
                .manual_resets_remaining,
            None
        );
        let eligible_empty = json!({"cedar_ember":{"eligible":true,"grants":[]}});
        assert_eq!(
            snapshot(input(None, Some(eligible_empty)), OBSERVED)
                .unwrap()
                .manual_resets_remaining,
            Some(0)
        );
    }

    #[test]
    fn zero_balance_with_omitted_active_fields_gets_bounded_validity() {
        let usage = json!({"cedar_ember":{"eligible":true,"grants":[{"resets_left":0}]}});
        let result = snapshot(input(None, Some(usage)), OBSERVED).unwrap();
        assert_eq!(result.manual_resets_remaining, Some(0));
        assert_eq!(result.manual_resets_valid_until, Some(1_800_021_600));
        assert_eq!(result.manual_resets_grant_ends_at, None, "a zero balance has no grant end");
        assert!(serde_json::to_value(&result)
            .unwrap()
            .get("manual_resets_grant_ends_at")
            .is_none());
        let positive_missing_validity =
            json!({"cedar_ember":{"eligible":true,"grants":[{"resets_left":1}]}});
        let result = snapshot(input(None, Some(positive_missing_validity)), OBSERVED).unwrap();
        assert_eq!(result.manual_resets_remaining, None);
        assert_eq!(result.manual_resets_valid_until, None);
    }

    #[test]
    fn invalid_grant_schema_and_bad_identity_fail_closed() {
        let bad_grant = json!({"cedar_ember":{"eligible":true,"grants":[
            {"resets_left":2,"starts_at":"2026-01-01T00:00:00Z","ends_at":"2028-01-01T00:00:00Z"}
        ]}});
        assert_eq!(
            snapshot(input(None, Some(bad_grant)), OBSERVED)
                .unwrap()
                .manual_resets_remaining,
            None
        );
        let mut invalid = input(None, None);
        invalid.organization_uuid = Some("not-an-org".into());
        assert!(snapshot(invalid, OBSERVED).is_err());
    }

    #[test]
    fn depleted_grant_with_earlier_end_does_not_poison_active_grants() {
        let obs_s = OBSERVED as i64 / 1000;
        let soon_end = "2027-01-16T00:00:00Z";
        let far_end = "2028-01-01T00:00:00Z";
        let usage = json!({"cedar_ember":{"eligible":true,"grants":[
            {"resets_left":0,"starts_at":"2026-01-01T00:00:00Z","ends_at":soon_end,"paused":false},
            {"resets_left":0,"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-06-01T00:00:00Z","paused":false},
            {"resets_left":4,"starts_at":"2026-01-01T00:00:00Z","ends_at":far_end,"paused":false}
        ]}});
        let result = snapshot(input(None, Some(usage)), OBSERVED).unwrap();
        assert_eq!(result.manual_resets_remaining, Some(4));
        assert_eq!(result.manual_resets_valid_until, Some(obs_s + 24 * 60 * 60));
        assert_eq!(result.manual_resets_grant_ends_at, Some(1_830_297_600));
        assert_eq!(
            result.manual_resets_grants,
            Some(vec![ResetGrant {
                resets_left: 4,
                ends_at: Some(1_830_297_600),
            }])
        );
    }

    #[test]
    fn multiple_positive_grants_keep_slices_and_latest_finite_end() {
        // OBSERVED = 1_800_000_000_000 -> 1_800_000_000s (2027-01-15T08:00:00Z)
        let soon_ts = 1_800_010_800; // +3h
        let far_ts = 1_830_297_600; // 2028-01-01T00:00:00Z
        let soon_iso = chrono::DateTime::from_timestamp(soon_ts, 0).unwrap().to_rfc3339();
        let far_iso = chrono::DateTime::from_timestamp(far_ts, 0).unwrap().to_rfc3339();
        let usage = json!({"cedar_ember":{"eligible":true,"grants":[
            {"resets_left":2,"starts_at":"2026-01-01T00:00:00Z","ends_at":far_iso,"paused":false},
            {"resets_left":1,"starts_at":"2026-01-01T00:00:00Z","ends_at":soon_iso,"paused":false},
            {"resets_left":1,"starts_at":"2026-01-01T00:00:00Z","ends_at":far_iso,"paused":false}
        ]}});
        let result = snapshot(input(None, Some(usage)), OBSERVED).unwrap();
        assert_eq!(result.manual_resets_remaining, Some(4));
        assert_eq!(result.manual_resets_valid_until, Some(soon_ts));
        assert_eq!(result.manual_resets_grant_ends_at, Some(far_ts));
        assert_eq!(
            result.manual_resets_grants,
            Some(vec![
                ResetGrant { resets_left: 1, ends_at: Some(soon_ts) },
                ResetGrant { resets_left: 3, ends_at: Some(far_ts) },
            ])
        );
    }

    #[test]
    fn unbounded_positive_grant_with_null_starts_and_ends_is_retained() {
        let obs_s = OBSERVED as i64 / 1000;
        let usage = json!({"cedar_ember":{"eligible":true,"grants":[
            {"resets_left":2,"starts_at":null,"ends_at":null,"paused":false}
        ]}});
        let result = snapshot(input(None, Some(usage)), OBSERVED).unwrap();
        assert_eq!(result.manual_resets_remaining, Some(2));
        assert_eq!(result.manual_resets_valid_until, Some(obs_s + 24 * 60 * 60));
        assert_eq!(result.manual_resets_grant_ends_at, None);
        assert_eq!(
            result.manual_resets_grants,
            Some(vec![ResetGrant {
                resets_left: 2,
                ends_at: None,
            }])
        );
    }

    #[test]
    fn verify_ticket_binding_accepts_saved_and_current_targets_without_cross_matching() {
        let active_id = "0123456789abcdef0123456789abcdef";
        let saved_id = "fedcba9876543210fedcba9876543210";
        let fp_active = "a".repeat(64);
        let fp_saved = "b".repeat(64);

        // Saved non-current card must validate against its own target binding, not active CLI.
        assert!(verify_ticket_binding(
            saved_id,
            saved_id,
            &fp_saved,
            saved_id,
            saved_id,
            &fp_saved.to_ascii_uppercase(),
        )
        .is_ok());

        // Active saved CLI card uses slot_owner = active_id and collector_id = "current".
        assert!(verify_ticket_binding(
            active_id,
            "current",
            &fp_active,
            active_id,
            "current",
            &fp_active,
        )
        .is_ok());

        // Mismatched fingerprint or switched slot owner must fail closed with accountMismatch.
        assert_eq!(
            verify_ticket_binding(saved_id, saved_id, &fp_saved, active_id, "current", &fp_active)
                .unwrap_err(),
            "quotaOnline.accountMismatch"
        );
        assert_eq!(
            verify_ticket_binding(saved_id, saved_id, &fp_saved, saved_id, saved_id, &fp_active)
                .unwrap_err(),
            "quotaOnline.accountMismatch"
        );
    }

    #[test]
    fn browser_collection_failure_cannot_become_a_success_snapshot() {
        for (reason, expected) in [
            ("identity_unavailable", "quotaOnline.bridgeIdentityUnavailable"),
            ("identity_changed", "quotaOnline.accountMismatch"),
            ("usage_unavailable", "quotaOnline.browserUsageUnavailable"),
            ("web_auth_required", "quotaOnline.browserWebAuthRequired"),
            ("web_access_denied", "quotaOnline.browserWebAccessDenied"),
            ("request_timeout", "quotaOnline.browserRequestTimeout"),
            ("invalid_response", "quotaOnline.invalidResponse"),
            ("raw-private-error", "quotaOnline.unavailable"),
        ] {
            let mut failure = input(None, None);
            failure.failure = Some(reason.into());
            assert_eq!(snapshot(failure, OBSERVED).err().as_deref(), Some(expected));
        }
    }

    #[test]
    fn cancelled_subscription_parses_period_end_as_access_until() {
        let active = input(
            Some(serde_json::json!({
                "next_charge_date": "2026-11-29T12:00:00Z",
                "cancel_at_period_end": false
            })),
            None,
        );
        let snap_active = snapshot(active, OBSERVED).unwrap();
        assert_eq!(snap_active.billing_date_kind, "next_renewal");
        assert!(snap_active.billing_date.is_some());

        let cancelled = input(
            Some(serde_json::json!({
                "next_charge_date": null,
                "cancel_at_period_end": true,
                "current_period_end": "2026-11-29T12:00:00Z"
            })),
            None,
        );
        let snap_cancelled = snapshot(cancelled, OBSERVED).unwrap();
        assert_eq!(snap_cancelled.billing_date_kind, "access_until");
        assert_eq!(snap_cancelled.billing_date, snap_active.billing_date);
    }

    #[test]
    fn kyc_status_parses_allowlist_and_strips_vendor_inquiry_fields() {
        let mut req = input(None, None);
        req.kyc_status = Some(json!({
            "status": "  Required ",
            "check_kind": " Identity_Check-2 ",
            "vendor_inquiry_id": "inq_secret_123",
            "vendor_inquiry_url": "https://withpersona.com/verify?inquiry=secret",
            "extra_private": "must-drop"
        }));
        let snap = snapshot(req, OBSERVED).unwrap();
        assert_eq!(snap.kyc_status.as_deref(), Some("required"));
        assert_eq!(snap.kyc_check_kind.as_deref(), Some("identity_check-2"));
        let serialized = serde_json::to_string(&snap).unwrap();
        assert!(!serialized.contains("vendor_inquiry_id"));
        assert!(!serialized.contains("vendor_inquiry_url"));
        assert!(!serialized.contains("inq_secret_123"));
        assert!(!serialized.contains("must-drop"));

        // Invalid check_kind is dropped while valid allowlisted status survives.
        for bad_kind in ["", "bad/kind", &"a".repeat(33)] {
            let mut req = input(None, None);
            req.kyc_status = Some(json!({
                "status": "pending",
                "check_kind": bad_kind
            }));
            let snap = snapshot(req, OBSERVED).unwrap();
            assert_eq!(snap.kyc_status.as_deref(), Some("pending"));
            assert_eq!(snap.kyc_check_kind, None);
        }

        // Unknown or missing status drops both status and check_kind.
        for bad_payload in [
            json!({"status": "unknown_status", "check_kind": "identity"}),
            json!({"status": "", "check_kind": "identity"}),
            json!({"check_kind": "identity"}),
            json!(["required"]),
        ] {
            let mut req = input(None, None);
            req.kyc_status = Some(bad_payload);
            let snap = snapshot(req, OBSERVED).unwrap();
            assert_eq!(snap.kyc_status, None);
            assert_eq!(snap.kyc_check_kind, None);
            let serialized = serde_json::to_value(&snap).unwrap();
            assert!(serialized.get("kyc_status").is_none());
            assert!(serialized.get("kyc_check_kind").is_none());
        }

        // Incoming deserialization accepts kyc_status and still denies unknown top-level fields.
        let valid_json = json!({
            "nonce": NONCE,
            "account_uuid": ACCOUNT,
            "organization_uuid": ORG,
            "kyc_status": {
                "status": "not_required",
                "check_kind": "identity",
                "vendor_inquiry_id": "secret-id",
                "vendor_inquiry_url": "https://secret.invalid/v"
            }
        });
        let parsed: Incoming = serde_json::from_value(valid_json).unwrap();
        let snap = snapshot(parsed, OBSERVED).unwrap();
        assert_eq!(snap.kyc_status.as_deref(), Some("not_required"));
        assert_eq!(snap.kyc_check_kind.as_deref(), Some("identity"));
    }
}
