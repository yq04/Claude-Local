// [INPUT]: 用户显式触发的隔离 Chromium、带本地 quota_identity 指纹的短期票据与当前或已保存账号的绑定身份快照。
// [OUTPUT]: 独立短期回环监听与多票据目标绑定复核后的白名单订阅/重置元数据、实时 5h/7d（含 Ultra five_hour=null 与周级模型池回退）额度窗口与有界权益有效期（24h新鲜度边界 + 可选未截断真实 grant 结束时间），或白名单桥接失败；Python仍唯一写入额度账本。
// [POS]: Claude.ai 到身份账本的多账号并发短期单次桥；支持 current 与任意已保存 account_id 并行同步，不串号、不抢占全局会话、不读取 Cookie，不后台轮询。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) use super::quota_existing::query_existing_profile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    net::TcpListener,
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

pub(super) const TICKET_TTL: Duration = Duration::from_secs(90);
const SYNC_WAIT: Duration = Duration::from_secs(45);
const MAX_PENDING_TICKETS: usize = 16;
const MAX_GRANTS: usize = 100;
const ZERO_VALIDITY_SECS: i64 = 6 * 60 * 60;

struct CleanerGuard(tauri::AppHandle);

impl Drop for CleanerGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}

pub(super) struct Ticket {
    pub nonce: String,
    pub session_token: String,
    pub requested_account_id: Option<String>,
    pub slot_owner_id: String,
    pub account_id: String,
    pub quota_identity: String,
    pub expires_at: Instant,
    pub reply: mpsc::Sender<Result<(), String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Incoming {
    pub nonce: String,
    pub account_uuid: Option<String>,
    pub organization_uuid: Option<String>,
    pub subscription_details: Option<Value>,
    pub usage: Option<Value>,
    pub failure: Option<String>,
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
    /// Earliest `ends_at` of the active grants, uncapped. `manual_resets_valid_until`
    /// stays bounded to 24h as a freshness window; this keeps the real expiry so the UI
    /// can tell "re-verify" apart from "resets actually ended".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_resets_grant_ends_at: Option<i64>,
    pub metadata_observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
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

fn billing_date(details: Option<&Value>) -> Option<i64> {
    let details = details?;
    // The pinned public implementation identifies next_charge_date as the
    // subscription date. It is a renewal date, never an access-end date.
    parse_timestamp(details.get("next_charge_date")?)
}

/// (remaining, 24h-bounded freshness expiry, uncapped earliest active grant end).
fn resets_with_grant_end(
    usage: Option<&Value>,
    observed_ms: u64,
) -> (Option<u64>, Option<i64>, Option<i64>) {
    let Some(cedar) = usage.and_then(|value| value.get("cedar_ember")) else {
        return (None, None, None);
    };
    if cedar.get("eligible").and_then(Value::as_bool) == Some(false) {
        return (None, None, None);
    }
    if cedar.get("eligible").and_then(Value::as_bool) != Some(true) {
        return (None, None, None);
    }
    let Ok(observed) = i64::try_from(observed_ms / 1000) else {
        return (None, None, None);
    };
    let Some(grants) = cedar.get("grants").and_then(Value::as_array) else {
        return (Some(0), Some(observed.saturating_add(ZERO_VALIDITY_SECS)), None);
    };
    if grants.len() > MAX_GRANTS {
        return (None, None, None);
    }
    let mut total = 0u64;
    let mut active_ends = Vec::new();
    for grant in grants {
        let Some(count) = grant.get("resets_left").and_then(Value::as_u64) else {
            return (None, None, None);
        };
        if count == 0
            && (grant.get("paused").is_none()
                || grant.get("starts_at").is_none()
                || grant.get("ends_at").is_none())
        {
            continue;
        }
        let Some(paused) = grant.get("paused").and_then(Value::as_bool) else {
            return (None, None, None);
        };
        let Some(starts) = grant.get("starts_at").and_then(parse_timestamp) else {
            return (None, None, None);
        };
        let Some(ends) = grant.get("ends_at").and_then(parse_timestamp) else {
            return (None, None, None);
        };
        if starts >= ends {
            return (None, None, None);
        }
        if !paused && starts <= observed && observed < ends {
            total = match total.checked_add(count) {
                Some(value) => value,
                None => return (None, None, None),
            };
            active_ends.push(ends);
        }
    }
    let validity_bound = observed.saturating_add(24 * 60 * 60);
    let grant_end = active_ends.into_iter().min();
    let valid_until = grant_end.map_or(observed.saturating_add(ZERO_VALIDITY_SECS), |ends| {
        ends.min(validity_bound)
    });
    // Only a positive count has a meaningful grant end; bound it to a sane calendar range.
    let grant_end = grant_end.filter(|ends| total > 0 && *ends > observed && *ends <= 253402300799);
    (Some(total), Some(valid_until), grant_end)
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
    let billing_date = billing_date(incoming.subscription_details.as_ref());
    let billing_date_kind = if billing_date.is_some() {
        "next_renewal"
    } else {
        "unknown"
    };
    let (manual_resets_remaining, manual_resets_valid_until, manual_resets_grant_ends_at) =
        resets_with_grant_end(incoming.usage.as_ref(), observed_ms);
    let usage = quota_windows(incoming.usage.as_ref());
    Ok(Snapshot {
        account_uuid: account_uuid.to_string(),
        organization_uuid: organization_uuid.to_string(),
        billing_date_kind,
        billing_date,
        manual_resets_remaining,
        manual_resets_valid_until,
        manual_resets_grant_ends_at,
        metadata_observed_at_ms: observed_ms,
        usage,
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

pub(super) fn commit_browser_snapshot(
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

    // Acquire Cleaner -> Browser in strict order to launch the isolated profile safely,
    // then drop both guards immediately so UI and concurrent account browsers never block.
    {
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        cleaner.enter_quota().map_err(|_| "quotaOnline.busy")?;
        let _cleaner_guard = CleanerGuard(app.clone());

        let browser = app.state::<super::Browser>();
        let _browser_guard = browser.gate.lock().unwrap();

        let root = super::root(app)?;
        super::workspaces::ready(&root)?;
        let db = super::workspaces::database(&root)?;
        if !db.browser_link()?.enabled {
            return Err("quotaOnline.unavailable".into());
        }

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
            if db.current_browser_is_warming()? {
                return Err("quotaOnline.unavailable".into());
            }
            let scope = super::workspaces::ensure(&root)?;
            super::quota_connection::launch_scope_url_locked(app, &scope, &target, recheck_binding)?;
        } else {
            super::quota_connection::materialize_identity_profile_locked(
                app,
                &collector_account_id,
                &quota_identity,
            )?;
            recheck_binding()?;
            super::quota_connection::launch_bound_profile_url_locked(
                app,
                &collector_account_id,
                &quota_identity,
                &target,
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
pub(super) fn push_ticket(pending: &mut Vec<Ticket>, ticket: Ticket, now: Instant) {
    pending.retain(|item| item.expires_at > now && item.account_id != ticket.account_id);
    if pending.len() >= MAX_PENDING_TICKETS {
        pending.remove(0);
    }
    pending.push(ticket);
}

pub(super) fn take_ticket(
    pending: &mut Vec<Ticket>,
    session_token: &str,
    nonce: &str,
    now: Instant,
) -> Option<Ticket> {
    pending.retain(|ticket| ticket.expires_at > now);
    let idx = pending
        .iter()
        .position(|ticket| ticket.session_token == session_token && ticket.nonce == nonce)?;
    Some(pending.swap_remove(idx))
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
    fn ticket_requires_matching_session_and_nonce_and_supports_concurrent_accounts() {
        let (reply_a, _rx_a) = mpsc::channel();
        let (reply_b, _rx_b) = mpsc::channel();
        let now = Instant::now();
        let nonce_b = "fedcba9876543210fedcba9876543210fedcba9876543210";
        let mut pending = Vec::new();
        push_ticket(
            &mut pending,
            Ticket {
                nonce: NONCE.into(),
                session_token: "session-a".into(),
                requested_account_id: None,
                slot_owner_id: "active-32-hex".into(),
                account_id: "current".into(),
                quota_identity: "a".repeat(64),
                expires_at: now + TICKET_TTL,
                reply: reply_a,
            },
            now,
        );
        push_ticket(
            &mut pending,
            Ticket {
                nonce: nonce_b.into(),
                session_token: "session-a".into(),
                requested_account_id: Some("saved-card-id".into()),
                slot_owner_id: "saved-card-id".into(),
                account_id: "saved-card-id".into(),
                quota_identity: "b".repeat(64),
                expires_at: now + TICKET_TTL,
                reply: reply_b,
            },
            now,
        );
        assert_eq!(pending.len(), 2);
        assert!(take_ticket(&mut pending, "session-b", NONCE, now).is_none());
        assert_eq!(pending.len(), 2);
        assert!(take_ticket(&mut pending, "session-a", "bad-nonce", now).is_none());
        let taken_b = take_ticket(&mut pending, "session-a", nonce_b, now).unwrap();
        assert_eq!(taken_b.account_id, "saved-card-id");
        assert_eq!(pending.len(), 1);
        let taken_a = take_ticket(&mut pending, "session-a", NONCE, now).unwrap();
        assert_eq!(taken_a.account_id, "current");
        assert!(take_ticket(&mut pending, "session-a", NONCE, now).is_none());
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
}
