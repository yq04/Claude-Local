// [INPUT]: Private SQLite usage ledger (`usage.sqlite`), read-only identity catalog (`identities.sqlite`), and validated filter/sort/pagination parameters.
// [OUTPUT]: Paginated per-request telemetry (`usage_request_logs_read`) with millisecond timestamps, end-to-end duration, effective output TPS, exact API-equivalent USD cost & cache savings, filtered aggregate KPIs (weighted TPS, avg/P95 duration) and dynamic filter option lists.
// [POS]: Read-only per-request log query child of identities::usage; never exposes raw prompts, paths, request IDs or credentials.
// [PROTOCOL]: Update this header and identities/CLAUDE.md when query parameters or response fields change.
use super::{
    attribution, identity_db_readonly, ingest_projects, live_account_key, named_end, named_start,
    now, offset_end, offset_start, open_ledger, parse_timezone, UsageAccount, USAGE_LOCK,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{
    cmp::Ordering,
    collections::{BTreeSet, HashMap},
    path::Path,
};
use tauri::Manager;

const MAX_SEARCH_CHARS: usize = 64;
const MIN_PAGE_SIZE: u32 = 10;
const MAX_PAGE_SIZE: u32 = 100;
const DEFAULT_PAGE_SIZE: u32 = 25;

#[derive(Clone, Debug, Serialize)]
pub struct RequestLogEntry {
    pub id: String,
    pub event_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub ts: u64,
    pub ts_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_plan: Option<String>,
    pub account_current: bool,
    pub model: String,
    pub effort: String,
    pub speed: String,
    pub stop_reason: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u64>,
    pub estimated_cost_usd: f64,
    pub cache_savings_usd: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_hit_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tps: Option<f64>,
    pub tool_count: u32,
    pub sidechain: bool,
    pub source_kind: String,
    pub weak: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct RequestLogsSummary {
    pub total_requests: u64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_cost_usd: f64,
    pub total_cache_savings_usd: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_tokens: Option<f64>,
    pub timed_requests: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p95_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_tps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_tps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overall_cache_hit_rate: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RequestLogsAccountOption {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    pub current: bool,
    pub requests: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct RequestLogsSnapshot {
    pub generated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub summary: RequestLogsSummary,
    pub items: Vec<RequestLogEntry>,
    pub available_accounts: Vec<RequestLogsAccountOption>,
    pub available_models: Vec<String>,
    pub available_efforts: Vec<String>,
    pub has_unattributed: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub(in crate::identities) struct RequestLogsQuery<'a> {
    pub period: &'a str,
    pub account_id: Option<&'a str>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub source_filter: Option<&'a str>,
    pub session_key: Option<&'a str>,
    pub search: Option<&'a str>,
    pub sort_by: &'a str,
    pub sort_desc: bool,
    pub page: u32,
    pub page_size: u32,
    pub offset_minutes: i32,
    pub timezone: Option<&'a str>,
}

/// Official Anthropic API per-1M-token USD pricing aligned with `usage-model.ts` and `profile/local_usage.rs`.
pub(super) fn resolve_model_pricing(model: &str) -> (f64, f64, f64, f64) {
    let lower = model.to_ascii_lowercase();
    if lower.contains("haiku") {
        if lower.contains("haiku-5-5") || lower.contains("haiku-5.5") {
            return (0.10, 0.50, 0.125, 0.01);
        }
        if lower.contains("3-5-haiku") || lower.contains("3.5-haiku") {
            return (0.80, 4.00, 1.00, 0.08);
        }
        return (1.00, 5.00, 1.25, 0.10);
    }
    if lower.contains("opus") {
        if lower.contains("opus-5-5") || lower.contains("opus-5.5") {
            return (4.00, 20.00, 5.00, 0.20);
        }
        if lower.contains("opus-4-5")
            || lower.contains("opus-4.5")
            || lower.contains("opus-4-6")
            || lower.contains("opus-4.6")
            || lower.contains("opus-4-7")
            || lower.contains("opus-4.7")
            || lower.contains("opus-4-8")
            || lower.contains("opus-4.8")
            || lower.contains("opus-5")
        {
            return (5.00, 25.00, 6.25, 0.50);
        }
        return (15.00, 75.00, 18.75, 1.50);
    }
    if lower.contains("fable") || lower.contains("mythos") {
        if lower.contains("mythos-preview") {
            return (25.00, 125.00, 31.25, 2.50);
        }
        if lower.contains("fable-5-2")
            || lower.contains("fable-5.2")
            || lower.contains("mythos-5-2")
            || lower.contains("mythos-5.2")
        {
            return (8.00, 40.00, 10.00, 0.20);
        }
        if lower.contains("fable-5-1")
            || lower.contains("fable-5.1")
            || lower.contains("mythos-5-1")
            || lower.contains("mythos-5.1")
        {
            return (10.00, 50.00, 12.50, 0.25);
        }
        return (10.00, 50.00, 12.50, 1.00);
    }
    if lower.contains("sonnet-5-5") || lower.contains("sonnet-5.5") {
        return (2.00, 10.00, 2.50, 0.10);
    }
    if lower.contains("sonnet-5") {
        return (2.00, 10.00, 2.50, 0.20);
    }
    (3.00, 15.00, 3.75, 0.30)
}

pub(super) fn speed_cost_multiplier(model: &str, speed: &str) -> f64 {
    let m = model.to_ascii_lowercase();
    match speed {
        "ultrafast" if m.contains("fable-5-2") || m.contains("fable-5.2") => 4.0,
        "fast"
            if m.contains("fable-5-2")
                || m.contains("fable-5.2")
                || m.contains("opus-4-8")
                || m.contains("opus-4.8")
                || m.contains("opus-5") =>
        {
            2.0
        }
        "fast"
            if m.contains("opus-4-6")
                || m.contains("opus-4.6")
                || m.contains("opus-4-7")
                || m.contains("opus-4.7") =>
        {
            6.0
        }
        _ => 1.0,
    }
}

pub(super) fn estimate_request_cost(
    model: &str,
    input: u64,
    output: u64,
    creation: u64,
    cache_read: u64,
    speed: &str,
) -> (f64, f64) {
    let (p_in, p_out, p_write, p_read) = resolve_model_pricing(model);
    let mult = speed_cost_multiplier(model, speed);
    let cost = ((input as f64 * p_in
        + output as f64 * p_out
        + creation as f64 * p_write
        + cache_read as f64 * p_read)
        / 1_000_000.0)
        * mult;
    let savings = ((cache_read as f64 * (p_in - p_read).max(0.0)) / 1_000_000.0) * mult;
    (cost, savings)
}

fn compute_tps(output_tokens: u64, duration_ms: Option<u64>) -> Option<f64> {
    let ms = duration_ms?;
    if output_tokens == 0 || ms < 100 {
        return None;
    }
    let val = output_tokens as f64 / (ms as f64 / 1000.0);
    val.is_finite().then(|| (val * 10.0).round() / 10.0)
}

fn compute_cache_hit(input: u64, creation: u64, cache_read: u64) -> Option<f64> {
    let denom = input.saturating_add(creation).saturating_add(cache_read);
    if denom == 0 {
        None
    } else {
        Some(cache_read as f64 / denom as f64)
    }
}

fn cmp_opt_f64_nulls_last(a: Option<f64>, b: Option<f64>, desc: bool) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => {
            let ord = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
            if desc { ord.reverse() } else { ord }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn cmp_opt_u64_nulls_last(a: Option<u64>, b: Option<u64>, desc: bool) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => {
            let ord = x.cmp(&y);
            if desc { ord.reverse() } else { ord }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

struct AccountMeta {
    by_id: HashMap<String, (UsageAccount, Option<String>)>,
    key_to_id: HashMap<String, String>,
    fallback_id: Option<String>,
    fallback_before: Option<u64>,
}

fn resolve_account_meta(
    conn: &Connection,
    vault: &Path,
    home: &Path,
    snapshot_now: u64,
) -> AccountMeta {
    let db = identity_db_readonly(vault).ok();
    let active = db.as_ref().and_then(|d| {
        d.query_row("SELECT value FROM state WHERE key='active'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
    });
    let live = live_account_key(vault, home);
    let current = db
        .as_ref()
        .and_then(|d| {
            live.as_ref().and_then(|key| {
                d.query_row(
                    "SELECT id FROM identities WHERE account_key=?1 AND empty=0",
                    [key],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
            })
        })
        .filter(|id| active.as_deref() == Some(id));

    let mut account_map: HashMap<String, UsageAccount> = HashMap::new();
    let mut key_to_id: HashMap<String, String> = HashMap::new();
    let mut summaries: HashMap<String, Value> = HashMap::new();

    if let Some(db) = db.as_ref() {
        if let Ok(mut q) = db.prepare("SELECT id,summary FROM identity_summaries") {
            if let Ok(rows) =
                q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for row in rows.flatten() {
                    if let Ok(v) = serde_json::from_str::<Value>(&row.1) {
                        summaries.insert(row.0, v);
                    }
                }
            }
        }
        if let Ok(mut q) = db.prepare(
            "SELECT id,name,account_key FROM identities WHERE empty=0 ORDER BY saved_at DESC,id",
        ) {
            if let Ok(rows) = q.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            }) {
                for (id, name, key) in rows.flatten() {
                    let email = summaries
                        .get(&id)
                        .and_then(|v| v.get("email"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let account = UsageAccount {
                        id: id.clone(),
                        name,
                        email,
                        current: current.as_deref() == Some(&id),
                        totals: Default::default(),
                    };
                    if let Some(key) = key.filter(|k| !k.is_empty()) {
                        key_to_id.entry(key.clone()).or_insert(id);
                        account_map.entry(key).or_insert(account);
                    }
                }
            }
        }
    }
    attribution::append_registry(conn, live.as_deref(), &mut account_map, &mut key_to_id);

    let manual_subs = crate::identities::subscription::read_store(vault);
    let ledger_root = crate::identities::profile::read_ledger_root(vault);
    let web_metadata_root = crate::identities::online::read_metadata_root(vault);

    let mut by_id: HashMap<String, (UsageAccount, Option<String>)> = HashMap::new();
    for acc in account_map.into_values() {
        let plan = summaries.get(&acc.id).and_then(|val| {
            let mut sum: crate::identities::profile::Summary =
                serde_json::from_value(val.clone()).ok()?;
            crate::identities::profile::apply_parsed_ledger_to_summary(
                ledger_root.as_ref(),
                &mut sum,
                0,
                snapshot_now,
            );
            crate::identities::online::apply_parsed_metadata(
                web_metadata_root.as_ref(),
                sum.quota_identity.as_deref(),
                &mut sum.web,
            );
            crate::identities::profile::apply_web_plan_tier(&mut sum.plan, &sum.web);
            crate::identities::profile::enforce_plan_quota_limits(
                sum.plan.as_deref(),
                &mut sum.quota_no_5h_limit,
            );
            let mut dummy_exp = None;
            crate::identities::subscription::apply_manual_with_plan(
                &manual_subs,
                sum.quota_identity.as_deref(),
                Some(acc.id.as_str()),
                &mut sum.plan,
                &mut sum.quota_no_5h_limit,
                &mut sum.web,
                &mut dummy_exp,
            );
            sum.plan
        });
        by_id.insert(acc.id.clone(), (acc, plan));
    }

    let saved_fallback: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='fallback_account_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
        .filter(|id| by_id.contains_key(id));
    let fallback_before =
        attribution::fallback_before(conn, saved_fallback.is_some()).unwrap_or(None);

    AccountMeta {
        by_id,
        key_to_id,
        fallback_id: saved_fallback,
        fallback_before,
    }
}

pub(in crate::identities) fn read_request_logs_at(
    vault: &Path,
    home: &Path,
    query: &RequestLogsQuery<'_>,
    snapshot_now: u64,
) -> Result<RequestLogsSnapshot, String> {
    let tz = parse_timezone(query.timezone)?;
    offset_start(query.period, snapshot_now, query.offset_minutes)?;
    let start = match tz {
        Some(timezone) => named_start(query.period, snapshot_now, timezone)?,
        None => offset_start(query.period, snapshot_now, query.offset_minutes)?,
    };
    let end = match tz {
        Some(timezone) => named_end(query.period, snapshot_now, timezone)?,
        None => offset_end(query.period, snapshot_now, query.offset_minutes),
    };

    let ledger_path = vault.join("usage.sqlite");
    let mut warnings = Vec::new();
    let conn = open_ledger(&ledger_path)?;
    ingest_projects(&conn, vault, home, snapshot_now, &mut warnings);

    let AccountMeta {
        by_id: accounts_by_id,
        key_to_id,
        fallback_id,
        fallback_before,
    } = resolve_account_meta(&conn, vault, home, snapshot_now);

    let ts_from = start.unwrap_or(0).min(i64::MAX as u64) as i64;
    let ts_to = end
        .map(|e| e.saturating_sub(1))
        .unwrap_or(snapshot_now)
        .min(snapshot_now)
        .min(i64::MAX as u64) as i64;

    let mut stmt = conn
        .prepare(
            "SELECT event_key, session_key, ts, ts_ms, model, COALESCE(effort,''), \
             input, output, creation, cache_read, reasoning, COALESCE(account_key,''), \
             weak, sidechain, duration_ms, COALESCE(stop_reason,''), COALESCE(tool_count,0), \
             COALESCE(speed,''), COALESCE(source_kind,'main') \
             FROM events WHERE ts>=?1 AND ts<=?2 ORDER BY ts DESC, COALESCE(ts_ms, ts*1000) DESC, event_key DESC",
        )
        .map_err(|_| "usage ledger unavailable")?;

    let rows = stmt
        .query_map(params![ts_from, ts_to], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?.max(0) as u64,
                r.get::<_, Option<i64>>(3)?.map(|v| v.max(0) as u64),
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?.max(0) as u64,
                r.get::<_, i64>(7)?.max(0) as u64,
                r.get::<_, i64>(8)?.max(0) as u64,
                r.get::<_, i64>(9)?.max(0) as u64,
                r.get::<_, Option<i64>>(10)?.map(|v| v.max(0) as u64),
                r.get::<_, String>(11)?,
                r.get::<_, i64>(12)? != 0,
                r.get::<_, i64>(13)? != 0,
                r.get::<_, Option<i64>>(14)?.map(|v| v.max(0) as u64),
                r.get::<_, String>(15)?,
                r.get::<_, i64>(16)?.max(0) as u32,
                r.get::<_, String>(17)?,
                r.get::<_, String>(18)?,
            ))
        })
        .map_err(|_| "usage ledger unavailable")?;

    let mut available_models = BTreeSet::new();
    let mut available_efforts = BTreeSet::new();
    let mut account_counts: HashMap<String, u64> = HashMap::new();
    let mut has_unattributed = false;
    let mut has_weak = false;

    let search_needle = query
        .search
        .map(|s| s.trim().trim_start_matches('#').to_lowercase())
        .filter(|s| !s.is_empty());
    let session_prefix = query
        .session_key
        .map(|s| s.trim().trim_start_matches('#').to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let model_filter = query
        .model
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty() && s != "all");
    let effort_filter = query
        .effort
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty() && s != "all");
    let source_filter = query
        .source_filter
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty() && s != "all");

    let mut matched: Vec<RequestLogEntry> = Vec::new();
    let mut summary = RequestLogsSummary::default();
    let mut durations: Vec<u64> = Vec::new();
    let mut timed_output_sum: u64 = 0;
    let mut timed_duration_sum_ms: u64 = 0;

    for row in rows.flatten() {
        let (
            event_key,
            session_key,
            ts,
            ts_ms_opt,
            model,
            effort,
            input,
            output,
            creation,
            cache_read,
            reasoning,
            owner,
            weak,
            sidechain,
            duration_ms,
            stop_reason,
            tool_count,
            speed,
            source_kind,
        ) = row;

        if start.is_some_and(|s| ts < s) || end.is_some_and(|e| ts >= e) || ts > snapshot_now {
            continue;
        }
        if weak {
            has_weak = true;
        }

        let resolved_id = key_to_id.get(&owner).cloned().or_else(|| {
            fallback_before
                .filter(|before| ts <= *before)
                .and_then(|_| fallback_id.clone())
        });

        available_models.insert(model.clone());
        if !effort.is_empty() {
            available_efforts.insert(effort.clone());
        }
        if let Some(ref aid) = resolved_id {
            *account_counts.entry(aid.clone()).or_insert(0) += 1;
        } else {
            has_unattributed = true;
        }

        // Apply filters
        if let Some(filter_acc) = query.account_id {
            let ok = match filter_acc {
                "unattributed" => resolved_id.is_none(),
                target => resolved_id.as_deref() == Some(target),
            };
            if !ok {
                continue;
            }
        }
        if let Some(ref mf) = model_filter {
            if model.to_ascii_lowercase() != *mf {
                continue;
            }
        }
        if let Some(ref ef) = effort_filter {
            let ok = if ef == "none" {
                effort.is_empty()
            } else {
                effort.to_ascii_lowercase() == *ef
            };
            if !ok {
                continue;
            }
        }
        if let Some(ref sf) = source_filter {
            let ok = match sf.as_str() {
                "main" => !sidechain && source_kind != "slot",
                "subagent" => sidechain,
                "slot" => source_kind == "slot",
                _ => true,
            };
            if !ok {
                continue;
            }
        }
        if let Some(ref sp) = session_prefix {
            let ok = session_key
                .as_deref()
                .is_some_and(|sk| sk.to_ascii_lowercase().starts_with(sp));
            if !ok {
                continue;
            }
        }

        let acc_meta = resolved_id
            .as_deref()
            .and_then(|id| accounts_by_id.get(id));

        if let Some(ref needle) = search_needle {
            let hit = event_key.to_ascii_lowercase().starts_with(needle)
                || session_key
                    .as_deref()
                    .is_some_and(|s| s.to_ascii_lowercase().starts_with(needle))
                || model.to_ascii_lowercase().contains(needle)
                || effort.to_ascii_lowercase().contains(needle)
                || stop_reason.to_ascii_lowercase().contains(needle)
                || speed.to_ascii_lowercase().contains(needle)
                || acc_meta.is_some_and(|(a, _)| a.name.to_lowercase().contains(needle));
            if !hit {
                continue;
            }
        }

        let total_tokens = input
            .saturating_add(output)
            .saturating_add(creation)
            .saturating_add(cache_read);
        let (estimated_cost_usd, cache_savings_usd) =
            estimate_request_cost(&model, input, output, creation, cache_read, &speed);
        let cache_hit_rate = compute_cache_hit(input, creation, cache_read);
        let tps = compute_tps(output, duration_ms);
        let ts_ms = ts_ms_opt.unwrap_or_else(|| ts.saturating_mul(1000));
        let short_id = event_key.chars().take(12).collect::<String>();

        summary.total_requests = summary.total_requests.saturating_add(1);
        summary.total_tokens = summary.total_tokens.saturating_add(total_tokens);
        summary.input_tokens = summary.input_tokens.saturating_add(input);
        summary.output_tokens = summary.output_tokens.saturating_add(output);
        summary.cache_creation_tokens = summary.cache_creation_tokens.saturating_add(creation);
        summary.cache_read_tokens = summary.cache_read_tokens.saturating_add(cache_read);
        summary.total_cost_usd += estimated_cost_usd;
        summary.total_cache_savings_usd += cache_savings_usd;

        if let Some(ms) = duration_ms {
            summary.timed_requests = summary.timed_requests.saturating_add(1);
            durations.push(ms);
            if output > 0 && ms >= 100 {
                timed_output_sum = timed_output_sum.saturating_add(output);
                timed_duration_sum_ms = timed_duration_sum_ms.saturating_add(ms);
            }
        }
        if let Some(t) = tps {
            summary.peak_tps = Some(match summary.peak_tps {
                Some(prev) => prev.max(t),
                None => t,
            });
        }

        matched.push(RequestLogEntry {
            id: short_id,
            event_key,
            session_key,
            ts,
            ts_ms,
            account_id: resolved_id,
            account_name: acc_meta.map(|(a, _)| a.name.clone()),
            account_email: acc_meta.and_then(|(a, _)| a.email.clone()),
            account_plan: acc_meta.and_then(|(_, p)| p.clone()),
            account_current: acc_meta.is_some_and(|(a, _)| a.current),
            model,
            effort,
            speed,
            stop_reason,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: creation,
            cache_read_tokens: cache_read,
            total_tokens,
            reasoning_tokens: reasoning,
            estimated_cost_usd,
            cache_savings_usd,
            cache_hit_rate,
            duration_ms,
            tps,
            tool_count,
            sidechain,
            source_kind,
            weak,
        });
    }

    if summary.total_requests > 0 {
        summary.avg_cost_usd = Some(summary.total_cost_usd / summary.total_requests as f64);
        summary.avg_tokens = Some(summary.total_tokens as f64 / summary.total_requests as f64);
    }
    summary.overall_cache_hit_rate = compute_cache_hit(
        summary.input_tokens,
        summary.cache_creation_tokens,
        summary.cache_read_tokens,
    );
    if !durations.is_empty() {
        let sum_ms: u128 = durations.iter().map(|&d| d as u128).sum();
        summary.avg_duration_ms = Some((sum_ms / durations.len() as u128) as u64);
        durations.sort_unstable();
        let p95_idx = ((durations.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(durations.len() - 1);
        summary.p95_duration_ms = Some(durations[p95_idx]);
    }
    if timed_output_sum > 0 && timed_duration_sum_ms >= 100 {
        let weighted = timed_output_sum as f64 / (timed_duration_sum_ms as f64 / 1000.0);
        if weighted.is_finite() {
            summary.avg_tps = Some((weighted * 10.0).round() / 10.0);
        }
    }

    matched.sort_by(|a, b| {
        let ordered = match query.sort_by {
            "tokens" => {
                let ord = a.total_tokens.cmp(&b.total_tokens);
                if query.sort_desc { ord.reverse() } else { ord }
            }
            "output" => {
                let ord = a.output_tokens.cmp(&b.output_tokens);
                if query.sort_desc { ord.reverse() } else { ord }
            }
            "cost" => {
                let ord = a
                    .estimated_cost_usd
                    .partial_cmp(&b.estimated_cost_usd)
                    .unwrap_or(Ordering::Equal);
                if query.sort_desc { ord.reverse() } else { ord }
            }
            "tps" => cmp_opt_f64_nulls_last(a.tps, b.tps, query.sort_desc),
            "duration" => cmp_opt_u64_nulls_last(a.duration_ms, b.duration_ms, query.sort_desc),
            "cache_hit" => {
                cmp_opt_f64_nulls_last(a.cache_hit_rate, b.cache_hit_rate, query.sort_desc)
            }
            _ => {
                let ord = a.ts_ms.cmp(&b.ts_ms);
                if query.sort_desc { ord.reverse() } else { ord }
            }
        };
        ordered
            .then_with(|| b.ts_ms.cmp(&a.ts_ms))
            .then_with(|| b.event_key.cmp(&a.event_key))
    });

    let total_count = matched.len() as u64;
    let page_size = query.page_size.clamp(MIN_PAGE_SIZE, MAX_PAGE_SIZE);
    let total_pages = total_count.div_ceil(page_size as u64).max(1) as u32;
    let page = query.page.clamp(1, total_pages);
    let start_idx = ((page - 1) as usize).saturating_mul(page_size as usize);
    let end_idx = start_idx.saturating_add(page_size as usize).min(matched.len());
    let items = if start_idx < matched.len() {
        matched[start_idx..end_idx].to_vec()
    } else {
        Vec::new()
    };

    let mut available_accounts: Vec<RequestLogsAccountOption> = accounts_by_id
        .into_values()
        .map(|(acc, plan)| RequestLogsAccountOption {
            requests: account_counts.get(&acc.id).copied().unwrap_or(0),
            id: acc.id,
            name: acc.name,
            email: acc.email,
            plan,
            current: acc.current,
        })
        .collect();
    available_accounts.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then_with(|| b.requests.cmp(&a.requests))
            .then_with(|| a.name.cmp(&b.name))
    });

    if has_weak {
        warnings.push("weak_ids".into());
    }
    if !warnings.is_empty() {
        warnings.sort();
        warnings.dedup();
    }

    Ok(RequestLogsSnapshot {
        generated_at: snapshot_now,
        timezone: tz.map(|t| t.name().to_string()),
        total_count,
        page,
        page_size,
        summary,
        items,
        available_accounts,
        available_models: available_models.into_iter().collect(),
        available_efforts: available_efforts.into_iter().collect(),
        has_unattributed,
        warnings,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn usage_request_logs_read(
    app: tauri::AppHandle,
    period: String,
    account_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    source_filter: Option<String>,
    session_key: Option<String>,
    search: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    offset_minutes: i32,
    timezone: Option<String>,
) -> Result<RequestLogsSnapshot, String> {
    parse_timezone(timezone.as_deref())?;
    if !(-840..=840).contains(&offset_minutes) {
        return Err("offset_minutes must be within ±840".into());
    }
    if !matches!(
        period.as_str(),
        "all" | "today" | "yesterday" | "week" | "month"
    ) {
        return Err("period must be all/today/yesterday/week/month".into());
    }
    if let Some(id) = account_id.as_deref() {
        if id != "unattributed" && !crate::identities::valid_id(id) {
            return Err("account_id is invalid".into());
        }
    }
    if let Some(sf) = source_filter.as_deref() {
        if !matches!(sf, "all" | "main" | "subagent" | "slot") {
            return Err("source_filter is invalid".into());
        }
    }
    if let Some(sk) = session_key.as_deref() {
        let trimmed = sk.trim().trim_start_matches('#');
        if !trimmed.is_empty()
            && (trimmed.len() > 64 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("session_key is invalid".into());
        }
    }
    let clean_search = search.map(|s| s.chars().take(MAX_SEARCH_CHARS).collect::<String>());
    let sort_field = match sort_by.as_deref().unwrap_or("time") {
        s @ ("time" | "tokens" | "output" | "cost" | "tps" | "duration" | "cache_hit") => {
            s.to_string()
        }
        _ => return Err("sort_by is invalid".into()),
    };
    let sort_desc = !matches!(sort_dir.as_deref(), Some("asc"));
    let page_num = page.unwrap_or(1).max(1);
    let size_num = page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(MIN_PAGE_SIZE, MAX_PAGE_SIZE);

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = USAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "usage ledger unavailable")?
            .join("identity-vault");
        let home = crate::cleaner::identity::root()?;
        let query = RequestLogsQuery {
            period: &period,
            account_id: account_id.as_deref(),
            model: model.as_deref(),
            effort: effort.as_deref(),
            source_filter: source_filter.as_deref(),
            session_key: session_key.as_deref(),
            search: clean_search.as_deref(),
            sort_by: &sort_field,
            sort_desc,
            page: page_num,
            page_size: size_num,
            offset_minutes,
            timezone: timezone.as_deref(),
        };
        read_request_logs_at(&vault, &home, &query, now())
    })
    .await
    .map_err(|_| "usage request logs worker interrupted".to_string())?
}
