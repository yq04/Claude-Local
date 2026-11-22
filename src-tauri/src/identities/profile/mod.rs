// [INPUT]: 默认 .claude.json 的 oauthAccount 显示字段与 cachedUsageUtilization 快照、本地 .credentials.json 的 OAuth 凭据元数据（expiresAt/refreshTokenExpiresAt 仅作为 OAuth 凭据有效期）、.claude/projects 会话流式账单增量、本地 settings.json 代理环境变量、只读有界外部账本服务端锚点、活动会话 PID/角色/子 Shell 元数据、`.claude/jobs/<short>` 后台待接管作业目录及白名单桌面工作区元数据。
// [OUTPUT]: 当前/保存身份的脱敏摘要（单次解析 .claude.json，且双窗均持新鲜账本 ServerAnchor 时跳过递归 .claude/projects 扫描）与一致的 OAuth 有效期/refreshToken 过期时间投影、逐窗额度（含 Ultra 无 5h 限制标记与 Fable 周池）、有界活动会话（区分后台守护进程与交互式子 Shell）与有界后台待接管作业 ID；共享纯账号指纹派生供浏览器绑定复核，不输出令牌、不联网验证账号。
// [POS]: 身份卡片的只读展示门面；保持 `crate::identities::profile::*` 公开 API 与 `quota_regression_tests` 挂接不变，逐窗合并/过期/推定恢复/聚合复用 quota_core；归档时间不代表额度新鲜度，账本单次安全有界读取且不匹配项不污染摘要。
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md 与 ./CLAUDE.md
pub use crate::quota_core::QuotaSource;
use crate::quota_core::{aggregate_source, expire_window, max_observation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Read, path::Path};

mod adopt_sessions;
mod ledger;
mod local_usage;
#[cfg(test)]
#[path = "../quota_regression_tests.rs"]
mod quota_regression_tests;
#[cfg(test)]
mod tests;

pub(crate) use adopt_sessions::{
    active_adopt_jobs, active_sessions_from_processes, job_dir_has_live_adopt,
    live_adopt_referenced_paths,
};
pub(crate) use ledger::{apply_web_plan_tier, enforce_plan_quota_limits, quota_identity};
pub(super) use ledger::{apply_parsed_ledger_to_summary, read_ledger_root};
pub(crate) use local_usage::parse_iso_epoch_sec;

use ledger::{
    apply_anchor_scoped_extras, apply_ledger_to_summary, merge_server_anchor,
    quota_window_observed_at, set_quota_evidence, set_summary_quota_evidence,
};
#[cfg(test)]
use ledger::{
    ledger_account, ledger_reset_inferred_value, ledger_window_value, window_source,
};
use local_usage::{extract_quota, now_epoch_sec, parse_reset_value};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    display_name: Option<String>,
    email_address: Option<String>,
    organization_name: Option<String>,
    billing_type: Option<String>,
}
#[derive(Default, Deserialize)]
struct Config {
    #[serde(rename = "oauthAccount")]
    account: Option<Account>,
    #[serde(rename = "primaryApiKey")]
    api_key: Option<serde::de::IgnoredAny>,
}
#[derive(Clone, Default, Serialize)]
pub struct Current {
    #[serde(flatten)]
    pub web: super::online::WebMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_observed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_source: Option<QuotaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_source: Option<QuotaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_source: Option<QuotaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_observed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_observed_at_ms: Option<u64>,
    pub present: bool,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub organization: Option<String>,
    pub unavailable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token_expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_has_refresh: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_used: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_reset_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_used: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_reset_at: Option<u64>,
    #[serde(default)]
    pub quota_no_5h_limit: bool,
    #[serde(default)]
    pub quota_5h_rested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_fable_used: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_fable_reset_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_expires_at: Option<u64>,
}
pub const CURRENT_QUOTA_VERSION: u8 = 7;
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    #[serde(default, flatten)]
    pub web: super::online::WebMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_observed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_source: Option<QuotaSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_5h_source: Option<QuotaSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_source: Option<QuotaSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_5h_observed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_observed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_5h_used: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_5h_reset_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_used: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_reset_at: Option<u64>,
    #[serde(default)]
    pub quota_no_5h_limit: bool,
    #[serde(default)]
    pub quota_5h_rested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_fable_used: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_7d_fable_reset_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_checked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_version: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_expires_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_has_refresh: Option<bool>,
}
impl Summary {
    pub fn has_quota_check(&self) -> bool {
        self.quota_checked == Some(true) && self.quota_version == Some(CURRENT_QUOTA_VERSION)
    }
    pub fn refresh_for_now(&mut self, now_sec: u64) {
        let legacy_source = self.quota_source.unwrap_or(QuotaSource::Unknown);
        if self.quota_5h_source.is_none() && self.quota_5h_used.is_some() {
            self.quota_5h_source = Some(legacy_source);
            self.quota_5h_observed_at_ms =
                self.quota_5h_observed_at_ms.or(self.quota_observed_at_ms);
        }
        if self.quota_7d_source.is_none() && self.quota_7d_used.is_some() {
            self.quota_7d_source = Some(legacy_source);
            self.quota_7d_observed_at_ms =
                self.quota_7d_observed_at_ms.or(self.quota_observed_at_ms);
        }
        expire_window(
            &mut self.quota_7d_used,
            &mut self.quota_7d_reset_at,
            &mut self.quota_7d_source,
            self.quota_7d_observed_at_ms,
            now_sec,
        );
        expire_window(
            &mut self.quota_5h_used,
            &mut self.quota_5h_reset_at,
            &mut self.quota_5h_source,
            self.quota_5h_observed_at_ms,
            now_sec,
        );
        if self.quota_5h_used.is_some() {
            self.quota_no_5h_limit = false;
            self.quota_5h_rested = false;
        }
        if self
            .quota_7d_fable_reset_at
            .is_some_and(|reset_at| reset_at <= now_sec as i64)
        {
            self.quota_7d_fable_used = None;
            self.quota_7d_fable_reset_at = None;
        }
        if self.quota_5h_source.is_some() || self.quota_7d_source.is_some() {
            self.quota_source = aggregate_source(self.quota_5h_source, self.quota_7d_source);
            if self.quota_no_5h_limit
                && self.quota_5h_used.is_none()
                && matches!(self.quota_7d_source, Some(s) if s != QuotaSource::Unknown)
            {
                self.quota_source = self.quota_7d_source;
            }
        }
        if self.quota_5h_observed_at_ms.is_some() || self.quota_7d_observed_at_ms.is_some() {
            self.quota_observed_at_ms =
                max_observation(self.quota_5h_observed_at_ms, self.quota_7d_observed_at_ms);
        }
        if self.auth_status.as_deref() == Some("valid") {
            if let Some(exp_ms) = self.auth_expires_at {
                if exp_ms > 0 && (now_sec as i64).saturating_mul(1000) >= exp_ms {
                    self.auth_status = Some(if self.auth_has_refresh == Some(true) {
                        "refresh_needed".into()
                    } else {
                        "expired".into()
                    });
                }
            }
        }
    }
    pub fn from_current(cur: &Current) -> Self {
        Self {
            web: cur.web.clone(),
            quota_identity: cur.quota_identity.clone(),
            quota_observed_at_ms: cur.quota_observed_at_ms,
            quota_source: cur.quota_source,
            quota_5h_source: cur.quota_5h_source,
            quota_7d_source: cur.quota_7d_source,
            quota_5h_observed_at_ms: cur.quota_5h_observed_at_ms,
            quota_7d_observed_at_ms: cur.quota_7d_observed_at_ms,
            display_name: cur.display_name.clone(),
            email: cur.email.clone(),
            organization: cur.organization.clone(),
            plan: cur.plan.clone(),
            auth_status: cur.auth_status.clone(),
            proxy: cur.proxy.clone(),
            quota_5h_used: cur.quota_5h_used,
            quota_5h_reset_at: cur.quota_5h_reset_at,
            quota_7d_used: cur.quota_7d_used,
            quota_7d_reset_at: cur.quota_7d_reset_at,
            quota_no_5h_limit: cur.quota_no_5h_limit,
            quota_5h_rested: cur.quota_5h_rested,
            quota_7d_fable_used: cur.quota_7d_fable_used,
            quota_7d_fable_reset_at: cur.quota_7d_fable_reset_at,
            quota_checked: Some(true),
            quota_version: Some(CURRENT_QUOTA_VERSION),
            auth_expires_at: cur.auth_expires_at,
            refresh_token_expires_at: cur.refresh_token_expires_at,
            subscription_expires_at: cur.subscription_expires_at,
            auth_has_refresh: cur.auth_has_refresh,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveSession {
    pub pid: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub entrypoint: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveSession {
    pub pid: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub entrypoint: String,
    #[serde(default)]
    pub background: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub child_shells: Vec<String>,
}
pub(super) fn display(value: Option<String>, limit: usize) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && !v.chars().any(char::is_control))
        .map(|v| v.chars().take(limit).collect())
}
fn format_plan(sub: Option<&str>, tier: Option<&str>, billing: Option<&str>) -> Option<String> {
    let sub_norm = sub
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let tier_lower = tier.unwrap_or("").to_ascii_lowercase();
    if sub_norm.as_deref().is_none_or(|s| s == "max") {
        if tier_lower.contains("20x") {
            return Some("Max 20x".into());
        }
        if tier_lower.contains("5x") {
            return Some("Max 5x".into());
        }
    }
    match sub_norm.as_deref() {
        Some("max") => Some("Max".into()),
        Some("pro") => Some("Pro".into()),
        Some("team") => Some("Team".into()),
        Some("enterprise") => Some("Enterprise".into()),
        Some("free") => Some("Free".into()),
        Some(other) if !other.chars().any(char::is_control) => {
            display(Some(other.to_uppercase()), 24)
        }
        _ => match billing.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("stripe_subscription") => Some("Pro / Max".into()),
            _ => None,
        },
    }
}
fn sanitize_proxy(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    let cleaned = if let Some((scheme, rest)) = trimmed.split_once("://") {
        let host_part = rest.rsplit_once('@').map(|(_, h)| h).unwrap_or(rest);
        format!("{scheme}://{host_part}")
    } else {
        trimmed
            .rsplit_once('@')
            .map(|(_, h)| h.to_string())
            .unwrap_or_else(|| trimmed.to_string())
    };
    display(Some(cleaned), 64)
}
pub(super) fn read_bounded_json(path: &Path, max_bytes: u64) -> Option<Value> {
    let meta = fs::symlink_metadata(path).ok()?;
    super::private::parents(path.parent()?).ok()?;
    super::private::safe(path).ok()?;
    if !meta.is_file() || meta.len() > max_bytes {
        return None;
    }
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    fs::File::open(path)
        .ok()?
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > max_bytes {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}
pub(super) fn normalize_epoch_sec(raw: i64) -> i64 {
    if raw >= 100_000_000_000 {
        raw / 1000
    } else {
        raw
    }
}
fn extract_refresh_token_expires_at(value: &Value) -> Option<i64> {
    let oauth = value.get("claudeAiOauth").unwrap_or(value);
    oauth
        .get("refreshTokenExpiresAt")
        .and_then(|v| {
            v.as_i64().or_else(|| {
                v.as_f64()
                    .filter(|f| f.is_finite() && *f > 0.0)
                    .map(|f| f as i64)
            })
        })
        .filter(|&v| v > 0)
        .map(normalize_epoch_sec)
}
fn extract_credentials_meta(
    value: &Value,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<bool>,
) {
    let oauth = value.get("claudeAiOauth").unwrap_or(value);
    let sub = oauth.get("subscriptionType").and_then(Value::as_str);
    let tier = oauth.get("rateLimitTier").and_then(Value::as_str);
    let has_access = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    let has_refresh = oauth
        .get("refreshToken")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    let expires_at = oauth.get("expiresAt").and_then(Value::as_i64);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let status = if has_access {
        match expires_at {
            Some(exp) if exp > 0 && exp <= now_ms => {
                if has_refresh {
                    Some("refresh_needed".into())
                } else {
                    Some("expired".into())
                }
            }
            _ => Some("valid".into()),
        }
    } else {
        None
    };
    (
        sub.map(str::to_string),
        tier.map(str::to_string),
        status,
        expires_at.filter(|&e| e > 0),
        has_access.then_some(has_refresh),
    )
}
fn extract_settings_meta(value: &Value) -> (Option<String>, bool) {
    let mut proxy = None;
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "GRPC_PROXY",
        "grpc_proxy",
    ] {
        let candidate = value
            .pointer(&format!("/env/{key}"))
            .or_else(|| value.get(&format!("env.{key}")))
            .and_then(Value::as_str)
            .and_then(sanitize_proxy);
        if candidate.is_some() {
            proxy = candidate;
            break;
        }
    }
    let has_api_auth = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ]
    .iter()
    .any(|k| {
        value
            .pointer(&format!("/env/{k}"))
            .or_else(|| value.get(&format!("env.{k}")))
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    }) || value
        .get("apiKeyHelper")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    (proxy, has_api_auth)
}
#[cfg(test)]
fn parse(bytes: &[u8]) -> Result<Current, serde_json::Error> {
    let config: Config = serde_json::from_slice(bytes)?;
    Ok(current_from_config(config))
}
/// Shared projection for `parse` and the single-parse live read (`Config` taken from one `Value`).
fn current_from_config(config: Config) -> Current {
    match config.account {
        Some(account) => Current {
            web: super::online::WebMetadata::default(),
            quota_identity: None,
            quota_observed_at_ms: None,
            quota_source: None,
            quota_5h_source: None,
            quota_7d_source: None,
            quota_5h_observed_at_ms: None,
            quota_7d_observed_at_ms: None,
            present: true,
            display_name: display(account.display_name, 80),
            email: display(account.email_address, 254),
            organization: display(account.organization_name, 120),
            unavailable: false,
            plan: format_plan(None, None, account.billing_type.as_deref()),
            auth_status: None,
            auth_expires_at: None,
            refresh_token_expires_at: None,
            auth_has_refresh: None,
            proxy: None,
            quota_5h_used: None,
            quota_5h_reset_at: None,
            quota_7d_used: None,
            quota_7d_reset_at: None,
            quota_no_5h_limit: false,
            quota_5h_rested: false,
            quota_7d_fable_used: None,
            quota_7d_fable_reset_at: None,
            subscription_expires_at: None,
        },
        None => Current {
            present: config.api_key.is_some(),
            ..Current::default()
        },
    }
}
/// Freshness bound for skipping the local `~/.claude/projects` scan: within this many ms of a
/// server observation, post-anchor local turns are negligible and the next anchor supersedes them.
const FRESH_ANCHOR_SKIP_MS: u64 = 90_000;
/// True when BOTH 5h and 7d windows in the (ledger-merged) `cachedUsageUtilization` are account-bound,
/// current (reset in the future) server observations no older than `FRESH_ANCHOR_SKIP_MS`.
fn fresh_server_anchors_cover_both_windows(cj: &Value, now_ms: u64) -> bool {
    let now_sec = now_ms / 1000;
    ["five_hour", "seven_day"].iter().all(|window| {
        let observed = cj
            .pointer("/cachedUsageUtilization/utilization")
            .and_then(|u| u.get(*window));
        let has_value = observed
            .and_then(|w| w.get("utilization"))
            .and_then(Value::as_f64)
            .and_then(crate::quota_core::observed_percentage)
            .is_some();
        let reset_current = observed
            .and_then(|w| w.get("resets_at"))
            .and_then(parse_reset_value)
            .is_some_and(|reset| now_sec < reset);
        let fresh = quota_window_observed_at(cj, window).is_some_and(|ms| {
            ms <= now_ms.saturating_add(5_000) && now_ms.saturating_sub(ms) <= FRESH_ANCHOR_SKIP_MS
        });
        has_value && reset_current && fresh
    })
}
pub fn read(home: &Path) -> Current {
    read_with_ledger(home, None, None)
}
pub(crate) fn read_live(home: &Path, vault_dir: &Path) -> Current {
    let ledger = read_ledger_root(vault_dir);
    read_with_ledger(home, vault_dir.parent(), ledger.as_ref())
}
pub(crate) fn read_live_with_ledger(
    home: &Path,
    vault_dir: &Path,
    ledger_root: Option<&Value>,
) -> Current {
    read_with_ledger(home, vault_dir.parent(), ledger_root)
}
fn read_live_active_since(app_dir: &Path) -> u64 {
    let db_path = app_dir.join("identity-vault/identities.sqlite");
    if !db_path.is_file() {
        return 0;
    }
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return 0;
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(2500));
    conn.query_row(
        "SELECT value FROM state WHERE key='active_since'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|raw| raw.parse::<u64>().ok())
    .unwrap_or(0)
}
fn read_with_ledger(
    home: &Path,
    app_dir: Option<&Path>,
    preloaded_ledger: Option<&Value>,
) -> Current {
    let path = home.join(".claude.json");
    let mut billing_type = None;
    let mut has_primary_api_key = false;
    let mut claude_val: Option<Value> = None;
    let result = (|| {
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Current::default()),
            Err(_) => return Err(()),
        };
        super::private::parents(home).map_err(|_| ())?;
        super::private::safe(&path).map_err(|_| ())?;
        if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
            return Err(());
        }
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        fs::File::open(&path)
            .map_err(|_| ())?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(());
        }
        // `.claude.json` is parsed exactly once; `Config` is projected from the same `Value`.
        let value = serde_json::from_slice::<Value>(&bytes).map_err(|_| ())?;
        let cfg = Config::deserialize(&value).map_err(|_| ())?;
        billing_type = cfg.account.as_ref().and_then(|a| a.billing_type.clone());
        has_primary_api_key = cfg.api_key.is_some();
        claude_val = Some(value);
        Ok(current_from_config(cfg))
    })();
    let mut current = result.unwrap_or_else(|_| Current {
        present: true,
        unavailable: true,
        ..Current::default()
    });
    if !current.unavailable {
        let mut sub = None;
        let mut tier = None;
        if let Some(cred) = read_bounded_json(&home.join(".claude/.credentials.json"), 1024 * 1024)
        {
            let (s, t, status, expires_at, has_refresh) = extract_credentials_meta(&cred);
            sub = s;
            tier = t;
            current.refresh_token_expires_at = extract_refresh_token_expires_at(&cred);
            if status.is_some() {
                current.auth_status = status;
                current.auth_expires_at = expires_at;
                current.auth_has_refresh = has_refresh;
                current.present = true;
            }
        }
        if let Some(resolved_plan) =
            format_plan(sub.as_deref(), tier.as_deref(), billing_type.as_deref())
        {
            current.plan = Some(resolved_plan);
        }
        let mut active_since = 0u64;
        let ledger_ref = preloaded_ledger;
        if let Some(app_dir) = app_dir {
            if let (Some(cj), Some(ledger)) = (claude_val.as_mut(), ledger_ref) {
                merge_server_anchor(cj, ledger);
            }
            active_since = read_live_active_since(app_dir);
        }
        if let Some(ref cj) = claude_val {
            let now_sec = now_epoch_sec();
            let proj_dir = home.join(".claude/projects");
            // Both windows already carry fresh ledger-merged server anchors: skip the recursive scan.
            let skip_projects = app_dir.is_some()
                && ledger_ref.is_some()
                && fresh_server_anchors_cover_both_windows(cj, now_sec.saturating_mul(1000));
            let extracted = extract_quota(
                cj,
                (!skip_projects && proj_dir.is_dir()).then_some(proj_dir.as_path()),
                current.plan.as_deref(),
                now_sec,
                active_since,
            );
            current.quota_5h_used = extracted.used_5h;
            current.quota_5h_reset_at = extracted.reset_5h;
            current.quota_7d_used = extracted.used_7d;
            current.quota_7d_reset_at = extracted.reset_7d;
            current.quota_identity = quota_identity(cj);
            set_quota_evidence(cj, &extracted, now_sec, &mut current);
            apply_anchor_scoped_extras(
                cj.get("cachedUsageUtilization"),
                None,
                now_sec,
                current.quota_5h_used.is_some(),
                &mut current.quota_no_5h_limit,
                &mut current.quota_5h_rested,
                &mut current.quota_7d_fable_used,
                &mut current.quota_7d_fable_reset_at,
            );
            if app_dir.is_some() {
                let mut effective = Summary::from_current(&current);
                apply_parsed_ledger_to_summary(ledger_ref, &mut effective, 0, now_sec);
                current.plan = effective.plan;
                current.quota_5h_used = effective.quota_5h_used;
                current.quota_5h_reset_at = effective.quota_5h_reset_at;
                current.quota_7d_used = effective.quota_7d_used;
                current.quota_7d_reset_at = effective.quota_7d_reset_at;
                current.quota_no_5h_limit = effective.quota_no_5h_limit;
                current.quota_5h_rested = effective.quota_5h_rested;
                current.quota_7d_fable_used = effective.quota_7d_fable_used;
                current.quota_7d_fable_reset_at = effective.quota_7d_fable_reset_at;
                current.refresh_token_expires_at = effective.refresh_token_expires_at;
                current.quota_observed_at_ms = effective.quota_observed_at_ms;
                current.quota_source = effective.quota_source;
                current.quota_5h_source = effective.quota_5h_source;
                current.quota_7d_source = effective.quota_7d_source;
                current.quota_5h_observed_at_ms = effective.quota_5h_observed_at_ms;
                current.quota_7d_observed_at_ms = effective.quota_7d_observed_at_ms;
            }
        }
        let mut has_settings_api = false;
        for name in ["settings.json", "settings.local.json"] {
            if let Some(val) = read_bounded_json(&home.join(".claude").join(name), 2 * 1024 * 1024)
            {
                let (p, api) = extract_settings_meta(&val);
                if p.is_some() {
                    current.proxy = p;
                }
                has_settings_api |= api;
            }
        }
        if current.auth_status.is_none() && (has_primary_api_key || has_settings_api) {
            current.auth_status = Some("api_key".into());
            current.present = true;
        }
    }
    current.present |= crate::cleaner::identity::desktop_present(home);
    current
}
pub(super) fn summarize_stage(stage: &super::archive::Stage) -> Summary {
    let mut summary = Summary {
        quota_checked: Some(true),
        quota_version: Some(CURRENT_QUOTA_VERSION),
        ..Summary::default()
    };
    let mut billing_type = None;
    let mut sub = None;
    let mut tier = None;
    let mut has_api_key = false;
    let mut claude_val: Option<Value> = None;
    let home = &stage.manifest.home;
    for (n, source) in stage.manifest.sources.iter().enumerate() {
        let data_path = stage.path.join(format!("data/{n}"));
        if source.path == home.join(".claude/projects") && data_path.is_dir() {
            // Shared historical sessions do not prove which account paid for a turn.
            continue;
        }
        let Some(val) = read_bounded_json(&data_path, 8 * 1024 * 1024) else {
            continue;
        };
        if source.path == home.join(".claude.json") {
            if let Ok(cfg) = serde_json::from_value::<Config>(val.clone()) {
                has_api_key |= cfg.api_key.is_some();
                if let Some(acct) = cfg.account {
                    summary.display_name = display(acct.display_name, 80);
                    summary.email = display(acct.email_address, 254);
                    summary.organization = display(acct.organization_name, 120);
                    billing_type = acct.billing_type;
                }
            }
            claude_val = Some(val);
        } else if source.path == home.join(".claude/.credentials.json") {
            let (s, t, status, exp_at, has_ref) = extract_credentials_meta(&val);
            sub = s;
            tier = t;
            if status.is_some() {
                summary.auth_status = status;
            }
            if exp_at.is_some() {
                summary.auth_expires_at = exp_at;
            }
            if let Some(rt_exp) = extract_refresh_token_expires_at(&val) {
                summary.refresh_token_expires_at = Some(rt_exp);
            }
            if has_ref.is_some() {
                summary.auth_has_refresh = has_ref;
            }
        } else if source.path == home.join(".claude/settings.json")
            || source.path == home.join(".claude/settings.local.json")
        {
            let (p, api) = extract_settings_meta(&val);
            if p.is_some() {
                summary.proxy = p;
            }
            has_api_key |= api;
        }
    }
    for item in &stage.manifest.credentials {
        if item.get("service").and_then(Value::as_str) == Some("Claude Code-credentials") {
            if let Some(encoded) = item.get("data").and_then(Value::as_str) {
                if let Ok(bytes) =
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                {
                    if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                        let (s, t, status, exp_at, has_ref) = extract_credentials_meta(&val);
                        if sub.is_none() {
                            sub = s;
                        }
                        if tier.is_none() {
                            tier = t;
                        }
                        if summary.auth_status.is_none() {
                            summary.auth_status = status;
                        }
                        if summary.auth_expires_at.is_none() {
                            summary.auth_expires_at = exp_at;
                        }
                        if summary.refresh_token_expires_at.is_none() {
                            summary.refresh_token_expires_at =
                                extract_refresh_token_expires_at(&val);
                        }
                        if summary.auth_has_refresh.is_none() {
                            summary.auth_has_refresh = has_ref;
                        }
                    }
                }
            }
        }
    }
    summary.plan = format_plan(sub.as_deref(), tier.as_deref(), billing_type.as_deref());
    if summary.auth_status.is_none() && has_api_key {
        summary.auth_status = Some("api_key".into());
    }
    if let Some(ref cj) = claude_val {
        let now_sec = now_epoch_sec();
        let extracted = extract_quota(cj, None, summary.plan.as_deref(), now_sec, 0);
        summary.quota_5h_used = extracted.used_5h;
        summary.quota_5h_reset_at = extracted.reset_5h;
        summary.quota_7d_used = extracted.used_7d;
        summary.quota_7d_reset_at = extracted.reset_7d;
        summary.quota_identity = quota_identity(cj);
        set_summary_quota_evidence(cj, &extracted, now_sec, &mut summary);
        apply_anchor_scoped_extras(
            cj.get("cachedUsageUtilization"),
            None,
            now_sec,
            summary.quota_5h_used.is_some(),
            &mut summary.quota_no_5h_limit,
            &mut summary.quota_5h_rested,
            &mut summary.quota_7d_fable_used,
            &mut summary.quota_7d_fable_reset_at,
        );
    }
    summary
}
pub(super) fn summarize_stage_with_ledger(
    stage: &super::archive::Stage,
    vault_dir: &Path,
) -> Summary {
    let mut summary = summarize_stage(stage);
    apply_ledger_to_summary(vault_dir, &mut summary, 0, now_epoch_sec());
    summary
}
