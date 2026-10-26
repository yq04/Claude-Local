// [INPUT]: 用户显式触发的隔离 Chromium、带本地 quota_identity 指纹的短期票据与绑定身份快照。
// [OUTPUT]: 运行时指纹唯一匹配后的白名单订阅/重置元数据与有界权益有效期，或白名单桥接失败；Python仍唯一写入额度账本。
// [POS]: Claude.ai 到身份账本的短期单次桥；不读取 Cookie，不将本地端口/指纹带到远端，不后台轮询。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) use super::quota_existing::query_existing_profile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::Manager;

pub(super) const TICKET_TTL: Duration = Duration::from_secs(90);
const MAX_GRANTS: usize = 100;
const ZERO_VALIDITY_SECS: i64 = 6 * 60 * 60;

pub(super) struct Ticket {
    pub nonce: String,
    pub session_token: String,
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

fn resets(usage: Option<&Value>, observed_ms: u64) -> (Option<u64>, Option<i64>) {
    let Some(cedar) = usage.and_then(|value| value.get("cedar_ember")) else {
        return (None, None);
    };
    if cedar.get("eligible").and_then(Value::as_bool) == Some(false) {
        return (None, None);
    }
    if cedar.get("eligible").and_then(Value::as_bool) != Some(true) {
        return (None, None);
    }
    let Ok(observed) = i64::try_from(observed_ms / 1000) else {
        return (None, None);
    };
    let Some(grants) = cedar.get("grants").and_then(Value::as_array) else {
        return (Some(0), Some(observed.saturating_add(ZERO_VALIDITY_SECS)));
    };
    if grants.len() > MAX_GRANTS {
        return (None, None);
    }
    let mut total = 0u64;
    let mut active_ends = Vec::new();
    for grant in grants {
        let Some(count) = grant.get("resets_left").and_then(Value::as_u64) else {
            return (None, None);
        };
        if count == 0
            && (grant.get("paused").is_none()
                || grant.get("starts_at").is_none()
                || grant.get("ends_at").is_none())
        {
            continue;
        }
        let Some(paused) = grant.get("paused").and_then(Value::as_bool) else {
            return (None, None);
        };
        let Some(starts) = grant.get("starts_at").and_then(parse_timestamp) else {
            return (None, None);
        };
        let Some(ends) = grant.get("ends_at").and_then(parse_timestamp) else {
            return (None, None);
        };
        if starts >= ends {
            return (None, None);
        }
        if !paused && starts <= observed && observed < ends {
            total = match total.checked_add(count) {
                Some(value) => value,
                None => return (None, None),
            };
            active_ends.push(ends);
        }
    }
    let validity_bound = observed.saturating_add(24 * 60 * 60);
    let valid_until = active_ends
        .into_iter()
        .min()
        .map_or(observed.saturating_add(ZERO_VALIDITY_SECS), |ends| {
            ends.min(validity_bound)
        });
    (Some(total), Some(valid_until))
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
    let (manual_resets_remaining, manual_resets_valid_until) =
        resets(incoming.usage.as_ref(), observed_ms);
    let usage = quota_windows(incoming.usage.as_ref());
    Ok(Snapshot {
        account_uuid: account_uuid.to_string(),
        organization_uuid: organization_uuid.to_string(),
        billing_date_kind,
        billing_date,
        manual_resets_remaining,
        manual_resets_valid_until,
        metadata_observed_at_ms: observed_ms,
        usage,
    })
}

fn quota_windows(usage: Option<&Value>) -> Option<Value> {
    let usage = usage?.as_object()?;
    let mut windows = serde_json::Map::new();
    for name in ["five_hour", "seven_day"] {
        if let Some(window) = usage.get(name).and_then(Value::as_object) {
            if let (Some(used), Some(reset)) = (window.get("utilization"), window.get("resets_at"))
            {
                windows.insert(
                    name.into(),
                    serde_json::json!({"utilization":used,"resets_at":reset}),
                );
            }
        }
    }
    (!windows.is_empty()).then_some(Value::Object(windows))
}

#[tauri::command]
pub async fn identities_sync_subscription(
    app: tauri::AppHandle,
    expected_identity: String,
) -> Result<(), String> {
    // Resolve the identity before taking browser locks; identity state itself reads browser warning state.
    let (account_id, quota_identity) = crate::identities::online::current_browser_binding(&app)?;
    if quota_identity != expected_identity
        || expected_identity.len() != 64
        || !expected_identity
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("quotaOnline.accountMismatch".into());
    }
    tauri::async_runtime::spawn_blocking(move || sync(&app, account_id, quota_identity))
        .await
        .map_err(|_| "quotaOnline.unavailable".to_string())?
}

fn sync(app: &tauri::AppHandle, account_id: String, quota_identity: String) -> Result<(), String> {
    let browser = app.state::<super::Browser>();
    let guard = browser.gate.lock().unwrap();
    let root = super::root(app)?;
    super::workspaces::ready(&root)?;
    let db = super::workspaces::database(&root)?;
    let slot = db.browser_for(&account_id)?;
    if !db.browser_link()?.enabled || slot.as_deref() != Some(db.browser_slot()?.as_str()) {
        return Err("quotaOnline.unavailable".into());
    }

    // This is the explicit user action: it may open the already-bound isolated browser.
    let reporter = crate::progress::Reporter::channel(None);
    super::launch_locked(app, &reporter)?;
    let (fresh_id, fresh_quota_identity) = crate::identities::online::current_browser_binding(app)?;
    if fresh_id != account_id || fresh_quota_identity != quota_identity {
        return Err("quotaOnline.accountMismatch".into());
    }
    let (session_token, port) = {
        let session = browser.session.lock().unwrap();
        let session = session.as_ref().ok_or("quotaOnline.unavailable")?;
        (session.token.clone(), session.port)
    };
    if port == 0 {
        return Err("quotaOnline.unavailable".into());
    }
    let nonce = super::server::nonce()?;
    if quota_identity.len() != 64 || !quota_identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("quotaOnline.bridgeUnavailable".into());
    }
    let (reply, result) = mpsc::channel();
    *browser.quota_sync.lock().unwrap() = Some(Ticket {
        nonce: nonce.clone(),
        session_token: session_token.clone(),
        account_id: account_id.clone(),
        quota_identity: quota_identity.clone(),
        expires_at: Instant::now() + TICKET_TTL,
        reply,
    });
    let target = format!("http://127.0.0.1:{port}/{session_token}/browser.html#quota-sync={nonce}&quota_identity={quota_identity}");
    if let Err(error) = super::launch_with_urls_locked(app, &reporter, &[target.as_str()]) {
        let mut pending = browser.quota_sync.lock().unwrap();
        if pending.as_ref().is_some_and(|ticket| ticket.nonce == nonce) {
            *pending = None;
        }
        return Err(error);
    }
    drop(guard);
    match result.recv_timeout(TICKET_TTL) {
        Ok(value) => value,
        Err(_) => {
            let mut pending = browser.quota_sync.lock().unwrap();
            if pending.as_ref().is_some_and(|ticket| ticket.nonce == nonce) {
                *pending = None;
            }
            Err("quotaOnline.unavailable".into())
        }
    }
}

pub(super) fn take_ticket(
    pending: &mut Option<Ticket>,
    session_token: &str,
    nonce: &str,
    now: Instant,
) -> Option<Ticket> {
    let valid = pending.as_ref().is_some_and(|ticket| {
        ticket.session_token == session_token && ticket.nonce == nonce && ticket.expires_at > now
    });
    if valid {
        pending.take()
    } else {
        None
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
    fn ticket_requires_matching_session_and_nonce_and_is_consumed_once() {
        let (reply, _receiver) = mpsc::channel();
        let now = Instant::now();
        let mut pending = Some(Ticket {
            nonce: NONCE.into(),
            session_token: "session-a".into(),
            account_id: "account-id".into(),
            quota_identity: "a".repeat(64),
            expires_at: now + TICKET_TTL,
            reply,
        });
        assert!(take_ticket(&mut pending, "session-b", NONCE, now).is_none());
        assert!(pending.is_some());
        assert!(take_ticket(&mut pending, "session-a", "bad-nonce", now).is_none());
        assert!(take_ticket(&mut pending, "session-a", NONCE, now).is_some());
        assert!(take_ticket(&mut pending, "session-a", NONCE, now).is_none());
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
