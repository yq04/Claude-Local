// [INPUT]: 默认 .claude.json cachedUsageUtilization、active_since 时间界与 .claude/projects/*.jsonl 会话文件（单文件 2 MiB / 总扫 256 MiB 有界限制）。
// [OUTPUT]: ISO/epoch 时间解析（parse_iso_epoch_sec / parse_reset_value）、Claude Code qHr 模型计费估算、(len, mtime_nanos) 增量文件缓存、全局 (message.id, requestId) 去重、自适应窗口标定与本地 5h/7d 用量切片提取（extract_quota）。
// [POS]: identities/profile 子模块：纯本地会话 JSONL 扫描与用量估算层，零依赖其他 profile 子模块。
// [PROTOCOL]: 变更时更新此头部，然后检查 profile/CLAUDE.md
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};

pub(super) fn now_epoch_sec() -> u64 {
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
pub(super) fn parse_reset_value(val: &Value) -> Option<u64> {
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
    } else if m.contains("mythos-preview") {
        (25.00, 125.00, 31.25, 50.00, 2.50)
    } else if m.contains("fable-5-2")
        || m.contains("fable-5.2")
        || m.contains("mythos-5-2")
        || m.contains("mythos-5.2")
    {
        (8.00, 40.00, 10.00, 16.00, 0.20)
    } else if m.contains("fable-5-1")
        || m.contains("fable-5.1")
        || m.contains("mythos-5-1")
        || m.contains("mythos-5.1")
    {
        (10.00, 50.00, 12.50, 20.00, 0.25)
    } else if m.contains("fable") || m.contains("mythos") {
        (10.00, 50.00, 12.50, 20.00, 1.00)
    } else {
        (3.00, 15.00, 3.75, 6.00, 0.30)
    };
    let mut cost =
        (in_tok * p_in + out_tok * p_out + cw_5m * p_cw5 + cw_1h * p_cw1h + cr_tok * p_cr)
            / 1_000_000.0;
    if let Some(speed) = usage.get("speed").and_then(Value::as_str) {
        let sp = speed.trim().to_ascii_lowercase();
        if sp == "ultrafast" && (m.contains("fable-5-2") || m.contains("fable-5.2")) {
            cost *= 4.0;
        } else if sp == "fast" {
            if m.contains("fable-5-2")
                || m.contains("fable-5.2")
                || m.contains("opus-4-8")
                || m.contains("opus-4.8")
                || m.contains("opus-5")
            {
                cost *= 2.0;
            } else if m.contains("opus-4-6")
                || m.contains("opus-4.6")
                || m.contains("opus-4-7")
                || m.contains("opus-4.7")
            {
                cost *= 6.0;
            }
        }
    }
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
#[derive(Clone)]
struct CachedProjectSlices {
    len: u64,
    mtime_nanos: u128,
    turns: Vec<((String, String), u64, f64)>,
    cs_slices: Vec<(u64, f64)>,
    saw_assistant_usage: bool,
}

static PROJECT_SLICE_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, CachedProjectSlices>>,
> = std::sync::OnceLock::new();

fn project_slice_cache(
) -> &'static std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, CachedProjectSlices>> {
    PROJECT_SLICE_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

const MAX_JSONL_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSONL_SCAN_BYTES: u64 = 256 * 1024 * 1024;

fn read_bounded_jsonl_line(
    reader: &mut impl std::io::BufRead,
    buf: &mut Vec<u8>,
    remaining_budget: &mut u64,
) -> std::io::Result<Option<bool>> {
    buf.clear();
    let mut oversized = false;
    loop {
        if *remaining_budget == 0 {
            return Ok(None);
        }
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if buf.is_empty() && !oversized {
                Ok(None)
            } else {
                Ok(Some(!oversized))
            };
        }
        if let Some(pos) = available.iter().position(|&b| b == b'\n') {
            let take_len = pos + 1;
            let consumed = (take_len as u64).min(*remaining_budget) as usize;
            *remaining_budget = remaining_budget.saturating_sub(consumed as u64);
            if !oversized {
                if buf.len().saturating_add(consumed) > MAX_JSONL_LINE_BYTES {
                    oversized = true;
                    buf.clear();
                } else {
                    buf.extend_from_slice(&available[..consumed]);
                }
            }
            reader.consume(consumed);
            if consumed < take_len {
                return Ok(None);
            }
            return Ok(Some(!oversized));
        }
        let take_len = available.len();
        let consumed = (take_len as u64).min(*remaining_budget) as usize;
        *remaining_budget = remaining_budget.saturating_sub(consumed as u64);
        if !oversized {
            if buf.len().saturating_add(consumed) > MAX_JSONL_LINE_BYTES {
                oversized = true;
                buf.clear();
            } else {
                buf.extend_from_slice(&available[..consumed]);
            }
        }
        reader.consume(consumed);
        if consumed < take_len {
            return Ok(None);
        }
    }
}

fn parse_jsonl_file_into(
    path: &Path,
    min_epoch_sec: u64,
    remaining_budget: &mut u64,
    global_turns: &mut BTreeMap<(String, String), (u64, f64)>,
    fallback_slices: &mut Vec<(u64, f64)>,
) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    let len = meta.len();
    if !meta.is_file() || crate::cleaner::linked(&meta) || len == 0 {
        return;
    }
    let mut mtime_nanos = 0u128;
    if let Ok(mtime) = meta.modified() {
        if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
            if dur.as_secs().saturating_add(60) < min_epoch_sec {
                return;
            }
            mtime_nanos = dur.as_nanos();
        }
    }
    if mtime_nanos > 0 {
        if let Ok(guard) = project_slice_cache().lock() {
            if let Some(hit) = guard
                .get(path)
                .filter(|c| c.len == len && c.mtime_nanos == mtime_nanos)
            {
                for (key, ts, cost) in &hit.turns {
                    if *ts >= min_epoch_sec {
                        global_turns.insert(key.clone(), (*ts, *cost));
                    }
                }
                if !hit.saw_assistant_usage {
                    for (ts, delta) in &hit.cs_slices {
                        if *ts >= min_epoch_sec {
                            fallback_slices.push((*ts, *delta));
                        }
                    }
                }
                return;
            }
        }
    }
    if *remaining_budget == 0 || super::super::private::safe(path).is_err() {
        return;
    }
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut line_buf = Vec::with_capacity(4096);
    let mut file_turns: Vec<((String, String), u64, f64)> = Vec::new();
    let mut file_cs_slices = Vec::new();
    let mut saw_assistant_usage = false;
    let mut current_ts: Option<u64> = None;
    let mut prev_cumulative_cost = 0.0f64;
    let path_tag = path.to_string_lossy();
    let mut line_idx = 0usize;
    let mut completed_file = false;
    loop {
        match read_bounded_jsonl_line(&mut reader, &mut line_buf, remaining_budget) {
            Ok(Some(true)) => {}
            Ok(Some(false)) => {
                line_idx += 1;
                continue;
            }
            Ok(None) => {
                completed_file = *remaining_budget > 0;
                break;
            }
            Err(_) => break,
        }
        let cur_idx = line_idx;
        line_idx += 1;
        let line = String::from_utf8_lossy(&line_buf);
        if !line.contains("\"timestamp\"") && !line.contains("\"cost-state\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line.as_ref()) else {
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
                                    (format!("{path_tag}#{ts}"), cur_idx.to_string())
                                } else {
                                    (msg_id, req_id)
                                };
                                file_turns.push((key.clone(), ts, cost));
                                if ts >= min_epoch_sec {
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
                        if delta > 0.0 {
                            file_cs_slices.push((ts, delta));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if !saw_assistant_usage {
        for (ts, delta) in &file_cs_slices {
            if *ts >= min_epoch_sec {
                fallback_slices.push((*ts, *delta));
            }
        }
    }
    if mtime_nanos > 0 && completed_file {
        if let Ok(mut guard) = project_slice_cache().lock() {
            if guard.len() > 512 {
                guard.clear();
            }
            guard.insert(
                path.to_path_buf(),
                CachedProjectSlices {
                    len,
                    mtime_nanos,
                    turns: file_turns,
                    cs_slices: file_cs_slices,
                    saw_assistant_usage,
                },
            );
        }
    }
}
fn collect_project_slices_rec(
    dir: &Path,
    min_epoch_sec: u64,
    depth: usize,
    remaining_budget: &mut u64,
    global_turns: &mut BTreeMap<(String, String), (u64, f64)>,
    fallback_slices: &mut Vec<(u64, f64)>,
) {
    if depth > 4 || *remaining_budget == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *remaining_budget == 0 {
            break;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            parse_jsonl_file_into(
                &path,
                min_epoch_sec,
                remaining_budget,
                global_turns,
                fallback_slices,
            );
        } else if meta.is_dir() && !crate::cleaner::linked(&meta) {
            collect_project_slices_rec(
                &path,
                min_epoch_sec,
                depth + 1,
                remaining_budget,
                global_turns,
                fallback_slices,
            );
        }
    }
}
fn collect_project_slices(projects_dir: &Path, min_epoch_sec: u64) -> Vec<(u64, f64)> {
    let mut global_turns = BTreeMap::new();
    let mut fallback_slices = Vec::new();
    let mut remaining_budget = MAX_JSONL_SCAN_BYTES;
    collect_project_slices_rec(
        projects_dir,
        min_epoch_sec,
        0,
        &mut remaining_budget,
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
pub(super) struct ExtractedQuota {
    pub(super) used_5h: Option<u8>,
    pub(super) reset_5h: Option<u64>,
    pub(super) used_7d: Option<u8>,
    pub(super) reset_7d: Option<u64>,
    pub(super) local_5h_evidence: bool,
    pub(super) local_7d_evidence: bool,
    pub(super) local_5h_observed_at_ms: Option<u64>,
    pub(super) local_7d_observed_at_ms: Option<u64>,
}
pub(super) fn extract_quota(
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

    let snap_sec_5h = w5
        .and_then(|w| w.get("fetchedAtMs"))
        .and_then(Value::as_u64)
        .map(|ms| ms / 1000)
        .filter(|s| *s > 0)
        .unwrap_or(snap_sec);
    let snap_sec_7d = w7
        .and_then(|w| w.get("fetchedAtMs"))
        .and_then(Value::as_u64)
        .map(|ms| ms / 1000)
        .filter(|s| *s > 0)
        .unwrap_or(snap_sec);

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
    let min_snap_sec = match (snap_sec_5h > 0, snap_sec_7d > 0) {
        (true, true) => snap_sec_5h.min(snap_sec_7d),
        (true, false) => snap_sec_5h,
        (false, true) => snap_sec_7d,
        (false, false) => snap_sec,
    };
    let min_scan_sec = if min_snap_sec > 0 {
        min_snap_sec.min(win_start_7d).min(fallback_7d_start)
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
        if snap_sec_7d > 0 && raw >= 15.0 {
            let snap_w7_start = r7.saturating_sub(7 * 86400).max(active_since);
            let cost_before_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts >= snap_w7_start && *ts <= snap_sec_7d.saturating_add(5))
                .map(|(_, c)| *c)
                .sum();
            if cost_before_snap >= 5.0 * mult {
                let emp = cost_before_snap / raw;
                if emp >= 0.70 * default_usd_per_pct_7d && emp <= 3.50 * default_usd_per_pct_7d {
                    usd_per_pct_7d = emp;
                }
            }
        }
    }

    let mut usd_per_pct_5h = default_usd_per_pct_5h;
    if let (Some(raw), Some(r5)) = (raw_5h, reset_5h) {
        if snap_sec_5h > 0 && raw >= 15.0 {
            let snap_w5_start = r5.saturating_sub(5 * 3600).max(active_since);
            let cost_before_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts >= snap_w5_start && *ts <= snap_sec_5h.saturating_add(5))
                .map(|(_, c)| *c)
                .sum();
            if cost_before_snap >= 1.5 * mult {
                let emp = cost_before_snap / raw;
                if emp >= 0.70 * default_usd_per_pct_5h && emp <= 3.50 * default_usd_per_pct_5h {
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
                    .filter(|(ts, _)| *ts > snap_sec_7d.saturating_add(5) && *ts >= floor_7d)
                    .map(|(_, c)| *c)
                    .sum();
                let extra_pct = cost_after_snap / usd_per_pct_7d;
                Some(((raw + extra_pct).round() as i64).clamp(0, 100) as u8)
            }
        } else {
            let floor_7d = fallback_7d_start.max(active_since);
            let cost_after_snap: f64 = slices
                .iter()
                .filter(|(ts, _)| *ts > snap_sec_7d.saturating_add(5) && *ts >= floor_7d)
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
        (cost_7d > 0.0).then(|| ((cost_7d / usd_per_pct_7d).round() as i64).clamp(0, 100) as u8)
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
            let floor_ts = snap_sec_5h.saturating_add(5).max(win_start_5h);
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

    let min_local_5h_ts = if raw_5h.is_some() && reset_5h.is_some_and(|r| now_sec < r) {
        snap_sec_5h.saturating_add(6)
    } else {
        reset_5h.unwrap_or(0).max(now_sec.saturating_sub(5 * 3600))
    }
    .max(active_since);
    let local_5h_observed_at_ms = if projects_dir.is_some() && active_since > 0 {
        slices
            .iter()
            .filter(|(ts, cost)| *cost > 0.0 && *ts >= min_local_5h_ts && *ts <= now_sec)
            .map(|(ts, _)| ts.saturating_mul(1000))
            .max()
    } else {
        None
    };
    let min_local_7d_ts = if raw_7d.is_some() && reset_7d.is_some_and(|r| now_sec < r) {
        snap_sec_7d.saturating_add(6)
    } else {
        reset_7d.unwrap_or(0).max(now_sec.saturating_sub(7 * 86400))
    }
    .max(active_since);
    let local_7d_observed_at_ms = if projects_dir.is_some() && active_since > 0 {
        slices
            .iter()
            .filter(|(ts, cost)| *cost > 0.0 && *ts >= min_local_7d_ts && *ts <= now_sec)
            .map(|(ts, _)| ts.saturating_mul(1000))
            .max()
    } else {
        None
    };

    ExtractedQuota {
        used_5h,
        reset_5h: eff_reset_5h,
        used_7d,
        reset_7d: eff_reset_7d,
        local_5h_evidence: local_5h_observed_at_ms.is_some(),
        local_7d_evidence: local_7d_observed_at_ms.is_some(),
        local_5h_observed_at_ms,
        local_7d_observed_at_ms,
    }
}
