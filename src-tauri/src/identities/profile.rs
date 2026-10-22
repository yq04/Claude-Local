// [INPUT]: 默认 .claude.json 的 oauthAccount 显示字段与 cachedUsageUtilization 快照、本地 .credentials.json 的 OAuth 凭据元数据（expiresAt 仅作为 OAuth 凭据有效期）、.claude/projects 会话账单增量、本地 settings.json 代理环境变量、只读外部账本服务端锚点、活动会话 PID 元数据及白名单桌面工作区元数据；当前无可信订阅到期来源。
// [OUTPUT]: 当前本地身份与已保存身份的脱敏摘要（用户名/邮箱/组织/套餐档位/OAuth有效状态/可选订阅到期/专属代理/逐窗离线5h与7d额度、含 reset_inferred 来源、真实观测时间及重置时间戳）及有界活动会话列表；百分比锚点先验证，不输出令牌、不联网验证账号。
// [POS]: 身份卡片的只读展示边界；账号匹配与旧格式适配留在此处，逐窗合并/过期/推定恢复/聚合复用 quota_core；归档时间不代表额度新鲜度，账本只读且不匹配项不污染摘要。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fs, io::Read, path::Path};
pub use crate::quota_core::QuotaSource;
use crate::quota_core::{aggregate_source, expire_window, max_observation, merge_window, WindowState};
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
    pub proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_used: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_5h_reset_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_used: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_7d_reset_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_expires_at: Option<u64>,
}
pub const CURRENT_QUOTA_VERSION: u8 = 7;
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_checked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_version: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_expires_at: Option<i64>,
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
        expire_window(&mut self.quota_7d_used, &mut self.quota_7d_reset_at,
            &mut self.quota_7d_source, self.quota_7d_observed_at_ms, now_sec);
        expire_window(&mut self.quota_5h_used, &mut self.quota_5h_reset_at,
            &mut self.quota_5h_source, self.quota_5h_observed_at_ms, now_sec);
        if self.quota_5h_source.is_some() || self.quota_7d_source.is_some() {
            self.quota_source = aggregate_source(self.quota_5h_source, self.quota_7d_source);
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
            quota_checked: Some(true),
            quota_version: Some(CURRENT_QUOTA_VERSION),
            auth_expires_at: None,
            subscription_expires_at: cur.subscription_expires_at,
            auth_has_refresh: None,
        }
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveSession {
    pub pid: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub entrypoint: String,
}
fn now_epoch_sec() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}
pub(crate) fn parse_iso_epoch_sec(raw: &str) -> Option<u64> {
    let s = raw.trim();
    if let Ok(epoch) = s.parse::<u64>() {
        return (epoch > 1_000_000_000).then_some(epoch);
    }
    if s.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let min: i64 = s.get(14..16)?.parse().ok()?;
    let sec: i64 = s.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || min > 59 || sec > 60 {
        return None;
    }
    let base_sec = days_from_civil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec;
    let tail = &s[19..];
    let offset_sec: i64 = if let Some(pos) = tail.rfind(['+', '-']) {
        let sign = if &tail[pos..pos + 1] == "+" { 1 } else { -1 };
        let tz = &tail[pos + 1..];
        let tz_h: i64 = tz.get(0..2)?.parse().ok()?;
        let tz_m: i64 = if tz.len() >= 5 && &tz[2..3] == ":" {
            tz.get(3..5)?.parse().ok()?
        } else if tz.len() >= 4 {
            tz.get(2..4)?.parse().ok()?
        } else {
            0
        };
        sign * (tz_h * 3600 + tz_m * 60)
    } else {
        0
    };
    let utc = base_sec - offset_sec;
    (utc >= 0).then_some(utc as u64)
}
fn parse_reset_value(val: &Value) -> Option<u64> {
    if let Some(s) = val.as_str() {
        return parse_iso_epoch_sec(s);
    }
    if let Some(n) = val.as_u64() {
        return (n > 1_000_000_000).then_some(n);
    }
    if let Some(f) = val.as_f64() {
        let n = f.round() as u64;
        return (n > 1_000_000_000).then_some(n);
    }
    None
}
fn estimate_turn_cost_usd(model: &str, usage: &Value) -> f64 {
    let m = model.to_ascii_lowercase();
    let in_tok = usage
        .get("input_tokens")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let out_tok = usage
        .get("output_tokens")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let cr_tok = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let (cw_1h, mut cw_5m) = if let Some(cc) = usage.get("cache_creation") {
        (
            cc.get("ephemeral_1h_input_tokens")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            cc.get("ephemeral_5m_input_tokens")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        )
    } else {
        (0.0, 0.0)
    };
    let cw_tot = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if cw_1h + cw_5m == 0.0 && cw_tot > 0.0 {
        cw_5m = cw_tot;
    }
    let total_in = in_tok + cr_tok + cw_1h + cw_5m;
    let (p_in, p_out, p_cw5, p_cw1h, p_cr) = if m.contains("haiku-5-5") || m.contains("haiku-5.5") {
        if total_in > 100_000.0 {
            (0.50, 2.50, 0.625, 1.00, 0.05)
        } else {
            (0.10, 0.50, 0.125, 0.20, 0.01)
        }
    } else if m.contains("3-5-haiku") || m.contains("3.5-haiku") {
        (0.80, 4.00, 1.00, 1.60, 0.08)
    } else if m.contains("haiku") {
        (1.00, 5.00, 1.25, 2.00, 0.10)
    } else if m.contains("opus-5-5") || m.contains("opus-5.5") {
        (4.00, 20.00, 5.00, 8.00, 0.20)
    } else if m.contains("opus-4-5")
        || m.contains("opus-4-6")
        || m.contains("opus-4-7")
        || m.contains("opus-4-8")
        || m.contains("opus-5")
        || m.contains("opus-4.5")
        || m.contains("opus-4.6")
        || m.contains("opus-4.7")
        || m.contains("opus-4.8")
    {
        (5.00, 25.00, 6.25, 10.00, 0.50)
    } else if m.contains("opus") {
        (15.00, 75.00, 18.75, 30.00, 1.50)
    } else if m.contains("sonnet-5-5") || m.contains("sonnet-5.5") {
        (2.00, 10.00, 2.50, 4.00, 0.10)
    } else if m.contains("sonnet-5") {
        (2.00, 10.00, 2.50, 4.00, 0.20)
    } else if m.contains("fable") {
        (10.00, 50.00, 12.50, 20.00, 1.00)
    } else {
        (3.00, 15.00, 3.75, 6.00, 0.30)
    };
    let mut cost =
        (in_tok * p_in + out_tok * p_out + cw_5m * p_cw5 + cw_1h * p_cw1h + cr_tok * p_cr)
            / 1_000_000.0;
    if usage
        .get("inference_geo")
        .and_then(Value::as_str)
        .is_some_and(|g| g.eq_ignore_ascii_case("us"))
    {
        cost *= 1.1;
    }
    if let Some(reqs) = usage
        .pointer("/server_tool_use/web_search_requests")
        .and_then(Value::as_f64)
    {
        if reqs > 0.0 {
            cost += reqs * 0.01;
        }
    }
    cost
}
fn parse_jsonl_file_into(
    path: &Path,
    min_epoch_sec: u64,
    global_turns: &mut BTreeMap<(String, String), (u64, f64)>,
    fallback_slices: &mut Vec<(u64, f64)>,
) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > 32 * 1024 * 1024 {
        return;
    }
    if let Ok(mtime) = meta.modified() {
        if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
            if dur.as_secs().saturating_add(60) < min_epoch_sec {
                return;
            }
        }
    }
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let mut file_cs_slices = Vec::new();
    let mut saw_assistant_usage = false;
    let mut current_ts: Option<u64> = None;
    let mut prev_cumulative_cost = 0.0f64;
    let path_tag = path.to_string_lossy();
    for (line_idx, line) in text.lines().enumerate() {
        if !line.contains("\"timestamp\"") && !line.contains("\"cost-state\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(ts_str) = obj.get("timestamp").and_then(Value::as_str) {
            if let Some(parsed) = parse_iso_epoch_sec(ts_str) {
                current_ts = Some(parsed);
            }
        }
        match obj.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                if let Some(ts) = current_ts {
                    if let Some(msg) = obj.get("message") {
                        if let Some(usage) = msg.get("usage") {
                            let model = msg.get("model").and_then(Value::as_str).unwrap_or("");
                            let cost = estimate_turn_cost_usd(model, usage);
                            if cost > 0.0 {
                                saw_assistant_usage = true;
                                if ts >= min_epoch_sec {
                                    let msg_id = msg
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string();
                                    let req_id = obj
                                        .get("requestId")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string();
                                    let key = if msg_id.is_empty() && req_id.is_empty() {
                                        (format!("{path_tag}#{ts}"), line_idx.to_string())
                                    } else {
                                        (msg_id, req_id)
                                    };
                                    global_turns.insert(key, (ts, cost));
                                }
                            }
                        }
                    }
                }
            }
            Some("cost-state") => {
                let total_cost = obj
                    .get("totalCostUSD")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let eff_ts = current_ts.or_else(|| {
                    let start_ms = obj.get("startTime").and_then(Value::as_u64)?;
                    let dur_ms = obj
                        .get("totalDuration")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    Some((start_ms + dur_ms) / 1000)
                });
                if let Some(ts) = eff_ts {
                    if total_cost > prev_cumulative_cost {
                        let delta = total_cost - prev_cumulative_cost;
                        prev_cumulative_cost = total_cost;
                        if ts >= min_epoch_sec && delta > 0.0 {
                            file_cs_slices.push((ts, delta));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if !saw_assistant_usage {
        fallback_slices.extend(file_cs_slices);
    }
}
fn collect_project_slices_rec(
    dir: &Path,
    min_epoch_sec: u64,
    depth: usize,
    global_turns: &mut BTreeMap<(String, String), (u64, f64)>,
    fallback_slices: &mut Vec<(u64, f64)>,
) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            parse_jsonl_file_into(&path, min_epoch_sec, global_turns, fallback_slices);
        } else if meta.is_dir() {
            collect_project_slices_rec(
                &path,
                min_epoch_sec,
                depth + 1,
                global_turns,
                fallback_slices,
            );
        }
    }
}
fn collect_project_slices(projects_dir: &Path, min_epoch_sec: u64) -> Vec<(u64, f64)> {
    let mut global_turns = BTreeMap::new();
    let mut fallback_slices = Vec::new();
    collect_project_slices_rec(
        projects_dir,
        min_epoch_sec,
        0,
        &mut global_turns,
        &mut fallback_slices,
    );
    let mut out: Vec<(u64, f64)> = global_turns.into_values().collect();
    out.extend(fallback_slices);
    out
}
fn walk_5h_blocks(slices: &[(u64, f64)], after_sec: u64, now_sec: u64) -> (f64, Option<u64>) {
    let mut ordered: Vec<(u64, f64)> = slices
        .iter()
        .copied()
        .filter(|(ts, c)| *ts >= after_sec && *c > 0.0)
        .collect();
    ordered.sort_by_key(|(ts, _)| *ts);
    let mut block_end: Option<u64> = None;
    let mut block_cost = 0.0;
    for (ts, cost) in ordered {
        if block_end.is_none_or(|end| ts >= end) {
            let hour_floor = ts - (ts % 3600);
            let mut cand_end = hour_floor + 5 * 3600;
            if cand_end <= ts {
                cand_end = ts + 5 * 3600;
            }
            block_end = Some(cand_end);
            block_cost = cost;
        } else {
            block_cost += cost;
        }
    }
    if let Some(end) = block_end {
        if now_sec < end {
            return (block_cost, Some(end));
        }
    }
    (0.0, None)
}
#[derive(Default)]
struct ExtractedQuota {
    used_5h: Option<u8>,
    reset_5h: Option<u64>,
    used_7d: Option<u8>,
    reset_7d: Option<u64>,
    local_5h_evidence: bool,
    local_7d_evidence: bool,
}
fn extract_quota(
    claude_json: &Value,
    projects_dir: Option<&Path>,
    plan: Option<&str>,
    now_sec: u64,
    active_since: u64,
) -> ExtractedQuota {
    let plan_lower = plan.unwrap_or("pro").to_ascii_lowercase();
    let mult = if plan_lower.contains("20x") {
        20.0
    } else if plan_lower.contains("5x") || plan_lower.contains("max") {
        5.0
    } else {
        1.0
    };
    let default_usd_per_pct_7d = 2.425 * mult;
    let default_usd_per_pct_5h = 0.320 * mult;

    let active_uuid = claude_json
        .pointer("/oauthAccount/accountUuid")
        .and_then(Value::as_str)
        .unwrap_or("");
    let valid_cu = claude_json.get("cachedUsageUtilization").filter(|cu| {
        let snap_uuid = cu.get("accountUuid").and_then(Value::as_str).unwrap_or("");
        active_uuid.is_empty() || snap_uuid.is_empty() || active_uuid == snap_uuid
    });

    let snap_sec = valid_cu
        .and_then(|cu| cu.get("fetchedAtMs"))
        .and_then(Value::as_u64)
        .map(|ms| ms / 1000)
        .unwrap_or(0);
    let util = valid_cu
        .and_then(|cu| cu.get("utilization"))
        .unwrap_or(&Value::Null);
    let w5 = util.get("five_hour");
    let w7 = util.get("seven_day");

    let raw_7d = w7
        .and_then(|w| w.get("utilization"))
        .and_then(Value::as_f64)
        .and_then(crate::quota_core::observed_percentage);
    let reset_7d = w7
        .and_then(|w| w.get("resets_at"))
        .and_then(parse_reset_value);

    let raw_5h = w5
        .and_then(|w| w.get("utilization"))
        .and_then(Value::as_f64)
        .and_then(crate::quota_core::observed_percentage);
    let reset_5h = w5
        .and_then(|w| w.get("resets_at"))
        .and_then(parse_reset_value);

    let fallback_7d_start = now_sec.saturating_sub(7 * 86400);
    let win_start_7d = reset_7d.unwrap_or(now_sec).saturating_sub(7 * 86400);
    let min_scan_sec = if snap_sec > 0 {
        snap_sec.min(win_start_7d).min(fallback_7d_start)
    } else {
        fallback_7d_start
    };
    let slices = projects_dir
        .map(|dir| collect_project_slices(dir, min_scan_sec))
        .unwrap_or_default();

    if w5.is_none() && w7.is_none() && slices.is_empty() {
        return ExtractedQuota::default();
    }

    // Adaptive per-account window rate calibration from official snapshot + pre-snapshot slices
    let mut usd_per_pct_7d = default_usd_per_pct_7d;
    if let (Some(raw), Some(r7)) = (raw_7d, reset_7d) {
        if snap_sec > 0 && raw >= 15.0 {
            let snap_w7_start = r7.saturating_sub(7 * 86400);
            let cost_before_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts >= snap_w7_start && *ts <= snap_sec.saturating_add(5))
                .map(|(_, c)| *c)
                .sum();
            if cost_before_snap >= 5.0 * mult {
                let emp = cost_before_snap / raw;
                if emp >= 0.70 * default_usd_per_pct_7d && emp <= 1.40 * default_usd_per_pct_7d {
                    usd_per_pct_7d = emp;
                }
            }
        }
    }

    let mut usd_per_pct_5h = default_usd_per_pct_5h;
    if let (Some(raw), Some(r5)) = (raw_5h, reset_5h) {
        if snap_sec > 0 && raw >= 15.0 {
            let snap_w5_start = r5.saturating_sub(5 * 3600);
            let cost_before_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts >= snap_w5_start && *ts <= snap_sec.saturating_add(5))
                .map(|(_, c)| *c)
                .sum();
            if cost_before_snap >= 1.5 * mult {
                let emp = cost_before_snap / raw;
                if emp >= 0.70 * default_usd_per_pct_5h && emp <= 1.40 * default_usd_per_pct_5h {
                    usd_per_pct_5h = emp;
                }
            }
        }
    }

    let mut eff_reset_7d = reset_7d;
    let used_7d = if let Some(raw) = raw_7d {
        if let Some(mut r) = reset_7d {
            if now_sec >= r {
                while now_sec >= r {
                    r += 7 * 86400;
                }
                eff_reset_7d = Some(r);
                let cycle_start = r.saturating_sub(7 * 86400).max(active_since);
                let cost_in_cycle: f64 = slices
                    .iter()
                    .filter(|(ts, _)| *ts >= cycle_start)
                    .map(|(_, c)| *c)
                    .sum();
                if cost_in_cycle > 0.0 {
                    Some(((cost_in_cycle / usd_per_pct_7d).round() as i64).clamp(0, 100) as u8)
                } else {
                    None
                }
            } else {
                let floor_7d = win_start_7d.max(active_since);
                let cost_after_snap: f64 = slices
                    .iter()
                    .filter(|(ts, _)| *ts > snap_sec.saturating_add(5) && *ts >= floor_7d)
                    .map(|(_, c)| *c)
                    .sum();
                let extra_pct = cost_after_snap / usd_per_pct_7d;
                Some(((raw + extra_pct).round() as i64).clamp(0, 100) as u8)
            }
        } else {
            let floor_7d = fallback_7d_start.max(active_since);
            let cost_after_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts > snap_sec.saturating_add(5) && *ts >= floor_7d)
                .map(|(_, c)| *c)
                .sum();
            let extra_pct = cost_after_snap / usd_per_pct_7d;
            Some(((raw + extra_pct).round() as i64).clamp(0, 100) as u8)
        }
    } else {
        let floor_7d = fallback_7d_start.max(active_since);
        let cost_7d: f64 = slices
            .iter()
            .filter(|(ts, _)| *ts >= floor_7d)
            .map(|(_, c)| *c)
            .sum();
        (cost_7d > 0.0)
            .then(|| ((cost_7d / usd_per_pct_7d).round() as i64).clamp(0, 100) as u8)
    };

    let mut eff_reset_5h = reset_5h;
    let used_5h = if let Some(raw) = raw_5h {
        if reset_5h.is_none_or(|r| now_sec >= r) {
            let after_sec = reset_5h.unwrap_or(fallback_7d_start).max(active_since);
            let (block_cost, active_end) = walk_5h_blocks(&slices, after_sec, now_sec);
            eff_reset_5h = active_end;
            active_end.map(|_| ((block_cost / usd_per_pct_5h).round() as i64).clamp(0, 100) as u8)
        } else {
            let win_start_5h = reset_5h.unwrap_or(now_sec).saturating_sub(5 * 3600);
            let floor_ts = snap_sec.saturating_add(5).max(win_start_5h);
            let cost_after_snap_5h: f64 = slices
                .iter()
                .filter(|(ts, _)| {
                    *ts > floor_ts && *ts >= active_since && now_sec.saturating_sub(*ts) <= 5 * 3600
                })
                .map(|(_, c)| *c)
                .sum();
            let extra_pct = cost_after_snap_5h / usd_per_pct_5h;
            Some(((raw + extra_pct).round() as i64).clamp(0, 100) as u8)
        }
    } else {
        let (block_cost, active_end) =
            walk_5h_blocks(&slices, fallback_7d_start.max(active_since), now_sec);
        eff_reset_5h = active_end;
        active_end.map(|_| ((block_cost / usd_per_pct_5h).round() as i64).clamp(0, 100) as u8)
    };

    let local_5h_evidence = projects_dir.is_some()
        && active_since > 0
        && slices.iter().any(|(ts, cost)| {
            *cost > 0.0
                && *ts >= active_since.max(now_sec.saturating_sub(5 * 3600))
                && *ts <= now_sec
        });
    let local_7d_evidence = projects_dir.is_some()
        && active_since > 0
        && slices.iter().any(|(ts, cost)| {
            *cost > 0.0
                && *ts >= active_since.max(now_sec.saturating_sub(7 * 86400))
                && *ts <= now_sec
        });

    ExtractedQuota {
        used_5h,
        reset_5h: eff_reset_5h,
        used_7d,
        reset_7d: eff_reset_7d,
        local_5h_evidence,
        local_7d_evidence,
    }
}
fn quota_identity(cj: &Value) -> Option<String> {
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
fn ledger_account<'a>(ledger: &'a Value, email: &str, identity: Option<&str>) -> Option<&'a Value> {
    let accounts = ledger.get("accounts")?;
    let primary = accounts.get(email);
    if primary.is_some_and(|entry| ledger_identity(entry, email).as_deref() == identity) {
        return primary;
    }
    identity
        .and_then(|id| accounts.get(format!("{email}#{id}")))
        .or(primary)
}
fn quota_window_observed_at(cj: &Value, window: &str) -> Option<u64> {
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
fn window_source(
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
fn set_quota_evidence(cj: &Value, result: &ExtractedQuota, now_sec: u64, current: &mut Current) {
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
    current.quota_5h_observed_at_ms = quota_window_observed_at(cj, "five_hour");
    current.quota_7d_observed_at_ms = quota_window_observed_at(cj, "seven_day");
    if !result.used_5h.is_some_and(|_| result.reset_5h.is_some_and(|r| r > now_sec)) {
        if let Some((reset, observed)) = cached_reset_inference(cj, "five_hour", now_sec) {
            current.quota_5h_used = Some(0);
            current.quota_5h_reset_at = Some(reset);
            current.quota_5h_source = Some(QuotaSource::ResetInferred);
            current.quota_5h_observed_at_ms = Some(observed);
        }
    }
    if !result.used_7d.is_some_and(|_| result.reset_7d.is_some_and(|r| r > now_sec)) {
        if let Some((reset, observed)) = cached_reset_inference(cj, "seven_day", now_sec) {
            current.quota_7d_used = Some(0);
            current.quota_7d_reset_at = Some(reset);
            current.quota_7d_source = Some(QuotaSource::ResetInferred);
            current.quota_7d_observed_at_ms = Some(observed);
        }
    }
    current.quota_source = aggregate_source(current.quota_5h_source, current.quota_7d_source);
    current.quota_observed_at_ms = max_observation(
        current.quota_5h_observed_at_ms,
        current.quota_7d_observed_at_ms,
    );
}
fn set_summary_quota_evidence(
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
    summary.quota_5h_observed_at_ms = quota_window_observed_at(cj, "five_hour");
    summary.quota_7d_observed_at_ms = quota_window_observed_at(cj, "seven_day");
    if !result.used_5h.is_some_and(|_| result.reset_5h.is_some_and(|r| r > now_sec)) {
        if let Some((reset, observed)) = cached_reset_inference(cj, "five_hour", now_sec) {
            summary.quota_5h_used = Some(0);
            summary.quota_5h_reset_at = Some(reset);
            summary.quota_5h_source = Some(QuotaSource::ResetInferred);
            summary.quota_5h_observed_at_ms = Some(observed);
        }
    }
    if !result.used_7d.is_some_and(|_| result.reset_7d.is_some_and(|r| r > now_sec)) {
        if let Some((reset, observed)) = cached_reset_inference(cj, "seven_day", now_sec) {
            summary.quota_7d_used = Some(0);
            summary.quota_7d_reset_at = Some(reset);
            summary.quota_7d_source = Some(QuotaSource::ResetInferred);
            summary.quota_7d_observed_at_ms = Some(observed);
        }
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
fn merge_server_anchor(claude_json: &mut Value, ledger: &Value) {
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
            entry
                .pointer(&format!("/server_anchor/utilization/{window}/fetchedAtMs"))
                .and_then(Value::as_u64)
                .filter(|v| *v > 0)
        })
        .or_else(|| {
            let observed_windows = entry
                .get("server_anchor_observed_windows")
                .and_then(Value::as_array);
            let explicitly_included = observed_windows
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(window)));
            if observed_windows.is_some() && !explicitly_included {
                return None;
            }
            entry
                .pointer("/server_anchor/fetchedAtMs")
                .and_then(Value::as_u64)
                .filter(|v| *v > 0)
        })
}

fn ledger_window_value(
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

fn ledger_reset_inferred_value(
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
        used: Some(used), reset_at: Some(reset), source, observed_at_ms: Some(observed),
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

pub(super) fn apply_ledger_to_summary(
    vault_dir: &Path,
    summary: &mut Summary,
    _saved_at_ms: u64,
    now_sec: u64,
) {
    let Some(email) = summary
        .email
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    else {
        return;
    };
    let Some(parent) = vault_dir.parent() else {
        return;
    };
    let ledger_path = parent.join("quota_ledger.json");
    let Ok(raw) = fs::read_to_string(&ledger_path) else {
        return;
    };
    let Ok(root) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let key = email.to_ascii_lowercase();
    let Some(entry) = ledger_account(&root, &key, summary.quota_identity.as_deref()) else {
        return;
    };
    if summary.quota_identity.is_none() || summary.quota_identity != ledger_identity(entry, &key) {
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
    if merged_5h || merged_7d {
        summary.quota_checked = Some(true);
        summary.quota_version = Some(CURRENT_QUOTA_VERSION);
    }
    summary.quota_source = aggregate_source(summary.quota_5h_source, summary.quota_7d_source);
    summary.quota_observed_at_ms = max_observation(
        summary.quota_5h_observed_at_ms,
        summary.quota_7d_observed_at_ms,
    );
    summary.refresh_for_now(now_sec);
}
fn display(value: Option<String>, limit: usize) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && !v.chars().any(char::is_control))
        .map(|v| v.chars().take(limit).collect())
}
fn format_plan(sub: Option<&str>, tier: Option<&str>, billing: Option<&str>) -> Option<String> {
    let tier_lower = tier.unwrap_or("").to_ascii_lowercase();
    if tier_lower.contains("20x") {
        return Some("Max 20x".into());
    }
    if tier_lower.contains("5x") {
        return Some("Max 5x".into());
    }
    match sub.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("max") => Some("Max".into()),
        Some("pro") => Some("Pro".into()),
        Some("team") => Some("Team".into()),
        Some("enterprise") => Some("Enterprise".into()),
        Some("free") => Some("Free".into()),
        Some(other) if !other.is_empty() && !other.chars().any(char::is_control) => {
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
fn read_bounded_json(path: &Path, max_bytes: u64) -> Option<Value> {
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
fn parse(bytes: &[u8]) -> Result<Current, serde_json::Error> {
    let config: Config = serde_json::from_slice(bytes)?;
    Ok(match config.account {
        Some(account) => Current {
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
            proxy: None,
            quota_5h_used: None,
            quota_5h_reset_at: None,
            quota_7d_used: None,
            quota_7d_reset_at: None,
            subscription_expires_at: None,
        },
        None => Current {
            present: config.api_key.is_some(),
            ..Current::default()
        },
    })
}
pub fn read(home: &Path) -> Current {
    read_with_ledger(home, None)
}
pub(super) fn read_live(home: &Path, vault_dir: &Path) -> Current {
    read_with_ledger(home, vault_dir.parent())
}
fn read_with_ledger(home: &Path, app_dir: Option<&Path>) -> Current {
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
        if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
            billing_type = cfg.account.and_then(|a| a.billing_type);
            has_primary_api_key = cfg.api_key.is_some();
        }
        claude_val = serde_json::from_slice::<Value>(&bytes).ok();
        parse(&bytes).map_err(|_| ())
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
            let (s, t, status, _, _) = extract_credentials_meta(&cred);
            sub = s;
            tier = t;
            if status.is_some() {
                current.auth_status = status;
                current.present = true;
            }
        }
        if let Some(resolved_plan) =
            format_plan(sub.as_deref(), tier.as_deref(), billing_type.as_deref())
        {
            current.plan = Some(resolved_plan);
        }
        let mut active_since = 0u64;
        if let Some(app_dir) = app_dir {
            if let Some(cj) = claude_val.as_mut() {
                if let Some(ledger) =
                    read_bounded_json(&app_dir.join("quota_ledger.json"), 8 * 1024 * 1024)
                {
                    merge_server_anchor(cj, &ledger);
                }
            }
            let db_path = app_dir.join("identity-vault/identities.sqlite");
            if db_path.is_file() {
                if let Ok(conn) = rusqlite::Connection::open_with_flags(
                    &db_path,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
                ) {
                    if let Ok(raw) = conn.query_row(
                        "SELECT value FROM state WHERE key='active_since'",
                        [],
                        |row| row.get::<_, String>(0),
                    ) {
                        active_since = raw.parse::<u64>().unwrap_or(0);
                    }
                }
            }
        }
        if let Some(ref cj) = claude_val {
            let proj_dir = home.join(".claude/projects");
            let extracted = extract_quota(
                cj,
                proj_dir.is_dir().then_some(proj_dir.as_path()),
                current.plan.as_deref(),
                now_epoch_sec(),
                active_since,
            );
            current.quota_5h_used = extracted.used_5h;
            current.quota_5h_reset_at = extracted.reset_5h;
            current.quota_7d_used = extracted.used_7d;
            current.quota_7d_reset_at = extracted.reset_7d;
            current.quota_identity = quota_identity(cj);
            set_quota_evidence(cj, &extracted, now_epoch_sec(), &mut current);
            if let Some(app_dir) = app_dir {
                let mut effective = Summary::from_current(&current);
                apply_ledger_to_summary(
                    &app_dir.join("identity-vault"),
                    &mut effective,
                    0,
                    now_epoch_sec(),
                );
                current.quota_5h_used = effective.quota_5h_used;
                current.quota_5h_reset_at = effective.quota_5h_reset_at;
                current.quota_7d_used = effective.quota_7d_used;
                current.quota_7d_reset_at = effective.quota_7d_reset_at;
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
        let extracted = extract_quota(cj, None, summary.plan.as_deref(), now_epoch_sec(), 0);
        summary.quota_5h_used = extracted.used_5h;
        summary.quota_5h_reset_at = extracted.reset_5h;
        summary.quota_7d_used = extracted.used_7d;
        summary.quota_7d_reset_at = extracted.reset_7d;
        summary.quota_identity = quota_identity(cj);
        set_summary_quota_evidence(cj, &extracted, now_epoch_sec(), &mut summary);
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
pub fn active_sessions(home: &Path) -> Vec<ActiveSession> {
    let running = crate::cleaner::identity::running_processes();
    if running.is_empty() {
        return Vec::new();
    }
    let sessions_dir = home.join(".claude/sessions");
    let mut out = Vec::with_capacity(running.len());
    for proc in running {
        let mut workspace = None;
        let mut entrypoint = proc.name.clone();
        let session_file = sessions_dir.join(format!("{}.json", proc.pid));
        if let Some(val) = read_bounded_json(&session_file, 64 * 1024) {
            if let Some(cwd) = val.get("cwd").and_then(Value::as_str) {
                let folder = Path::new(cwd)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::to_string)
                    .or_else(|| Some(cwd.to_string()));
                workspace = display(folder, 48);
            }
            if let Some(ep) = val.get("entrypoint").and_then(Value::as_str) {
                entrypoint = match ep {
                    "cli" => "CLI".into(),
                    "claude-vscode" => "VS Code".into(),
                    "claude-desktop" => "Claude Desktop".into(),
                    "sdk-cli" => "SDK".into(),
                    "mcp" => "MCP".into(),
                    other => display(Some(other.to_string()), 24).unwrap_or(entrypoint),
                };
            }
        }
        out.push(ActiveSession {
            pid: proc.pid,
            workspace,
            entrypoint,
        });
    }
    out
}
#[cfg(test)]
#[path = "quota_regression_tests.rs"]
mod quota_regression_tests;
#[cfg(test)]
mod tests {
    use super::*;
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

        let current = parse(br#"{"oauthAccount":{"displayName":"Fixture"}}"#).unwrap();
        assert_eq!(current.subscription_expires_at, None);
        let summary = Summary::from_current(&current);
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
}
