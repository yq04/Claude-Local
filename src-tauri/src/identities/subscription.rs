// [INPUT]: 私有 manual_subscriptions.json、账号 HMAC 指纹或归档/养号卡 ID、ASCII YYYY-MM-DD 充值/到期日历与 Cleaner 短事务门。
// [OUTPUT]: 独立于 SQLite user_version=3 与 Python quota_ledger 的手动订阅到期/充值日原子存储、按 +1 自然月安全推算到期日、UTC 正午跨时区无偏移时间戳及自动网页账单较新优先合并。
// [POS]: 身份卡片订阅到期（MM/DD）的本地补充层；绝不终止运行中的 claude.exe，绝不修改 .claude.json 或抢占 Python 账本锁。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use chrono::{NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Read, path::Path};
use tauri::{Emitter, Manager};

pub const FILE_NAME: &str = "manual_subscriptions.json";
const MAX_STORE_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualSubscriptionEntry {
    pub expiry_ymd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recharge_ymd: Option<String>,
    pub expiry_epoch_sec: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ManualSubscriptionsFile {
    pub version: u32,
    pub by_identity: BTreeMap<String, ManualSubscriptionEntry>,
    pub by_record: BTreeMap<String, ManualSubscriptionEntry>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

pub fn parse_ymd(raw: &str) -> Result<(i32, u32, u32), String> {
    let trimmed = raw.trim();
    if trimmed.len() != 10 || !trimmed.is_ascii() {
        return Err("identityCard.invalidSubscriptionDate".into());
    }
    let bytes = trimmed.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return Err("identityCard.invalidSubscriptionDate".into());
    }
    let year: i32 = trimmed[0..4]
        .parse()
        .map_err(|_| "identityCard.invalidSubscriptionDate".to_string())?;
    let month: u32 = trimmed[5..7]
        .parse()
        .map_err(|_| "identityCard.invalidSubscriptionDate".to_string())?;
    let day: u32 = trimmed[8..10]
        .parse()
        .map_err(|_| "identityCard.invalidSubscriptionDate".to_string())?;
    if !(2020..=2100).contains(&year) || !(1..=12).contains(&month) {
        return Err("identityCard.invalidSubscriptionDate".into());
    }
    let max_day = days_in_month(year, month);
    if day < 1 || day > max_day || NaiveDate::from_ymd_opt(year, month, day).is_none() {
        return Err("identityCard.invalidSubscriptionDate".into());
    }
    Ok((year, month, day))
}

pub fn normalize_ymd(raw: &str) -> Result<String, String> {
    let (y, m, d) = parse_ymd(raw)?;
    Ok(format!("{y:04}-{m:02}-{d:02}"))
}

pub fn add_one_month_ymd(raw: &str) -> Result<String, String> {
    let (y, m, d) = parse_ymd(raw)?;
    let (next_y, next_m) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    if next_y > 2100 {
        return Err("identityCard.invalidSubscriptionDate".into());
    }
    let next_d = d.min(days_in_month(next_y, next_m));
    Ok(format!("{next_y:04}-{next_m:02}-{next_d:02}"))
}

/// Anchor calendar dates at 12:00:00 UTC so Beijing (UTC+8), UTC, New York (UTC-5/-4)
/// and Los Angeles (UTC-8/-7) all resolve to the exact same calendar YYYY-MM-DD.
pub fn ymd_to_utc_noon_sec(raw: &str) -> Result<u64, String> {
    let (y, m, d) = parse_ymd(raw)?;
    let dt = Utc
        .with_ymd_and_hms(y, m, d, 12, 0, 0)
        .single()
        .ok_or_else(|| "identityCard.invalidSubscriptionDate".to_string())?;
    u64::try_from(dt.timestamp()).map_err(|_| "identityCard.invalidSubscriptionDate".into())
}

fn sanitize_entry(mut entry: ManualSubscriptionEntry) -> Option<ManualSubscriptionEntry> {
    let expiry_ymd = normalize_ymd(&entry.expiry_ymd).ok()?;
    let expiry_epoch_sec = ymd_to_utc_noon_sec(&expiry_ymd).ok()?;
    let recharge_ymd = match entry.recharge_ymd.take() {
        Some(raw) if !raw.trim().is_empty() => Some(normalize_ymd(&raw).ok()?),
        _ => None,
    };
    if entry.updated_at_ms == 0 {
        return None;
    }
    Some(ManualSubscriptionEntry {
        expiry_ymd,
        recharge_ymd,
        expiry_epoch_sec,
        updated_at_ms: entry.updated_at_ms,
    })
}

pub fn read_store(vault: &Path) -> ManualSubscriptionsFile {
    let path = vault.join(FILE_NAME);
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    };
    if !meta.is_file()
        || crate::cleaner::linked(&meta)
        || meta.len() > MAX_STORE_BYTES
        || super::private::safe(&path).is_err()
    {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    }
    let Ok(file) = fs::File::open(&path) else {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    };
    let mut bytes = Vec::new();
    if file
        .take(MAX_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_STORE_BYTES
    {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    }
    let Ok(parsed) = serde_json::from_slice::<ManualSubscriptionsFile>(&bytes) else {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    };
    if parsed.version != 1 {
        return ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
    }
    let mut clean = ManualSubscriptionsFile {
        version: 1,
        by_identity: BTreeMap::new(),
        by_record: BTreeMap::new(),
    };
    for (k, v) in parsed.by_identity {
        if valid_fingerprint(&k) {
            if let Some(entry) = sanitize_entry(v) {
                clean.by_identity.insert(k, entry);
            }
        }
    }
    for (k, v) in parsed.by_record {
        if super::valid_id(&k) {
            if let Some(entry) = sanitize_entry(v) {
                clean.by_record.insert(k, entry);
            }
        }
    }
    clean
}

pub fn write_store(vault: &Path, store: &ManualSubscriptionsFile) -> Result<(), String> {
    super::private::directory(vault)?;
    let mut normalized = store.clone();
    normalized.version = 1;
    let mut bytes =
        serde_json::to_vec_pretty(&normalized).map_err(|_| "无法保存订阅到期设置。".to_string())?;
    bytes.push(b'\n');
    super::private::write(&vault.join(FILE_NAME), &bytes)
}

/// Mutations must not turn an unreadable/corrupt file into an empty store.
/// Passive projections retain the existing tolerant read_store behavior.
pub(crate) fn read_store_checked(vault: &Path) -> Result<ManualSubscriptionsFile, String> {
    let path = vault.join(FILE_NAME);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ManualSubscriptionsFile {
                version: 1,
                ..Default::default()
            })
        }
        Err(_) => return Err("无法读取订阅到期设置。".into()),
        Ok(meta) if !meta.is_file() || meta.len() > MAX_STORE_BYTES => {
            return Err("订阅到期设置无效。".into())
        }
        Ok(_) => (),
    }
    super::private::safe(&path)?;
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|_| "无法读取订阅到期设置。")?
        .take(MAX_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取订阅到期设置。")?;
    if bytes.len() as u64 > MAX_STORE_BYTES {
        return Err("订阅到期设置无效。".into());
    }
    let store: ManualSubscriptionsFile =
        serde_json::from_slice(&bytes).map_err(|_| "订阅到期设置无效。")?;
    if store.version != 1
        || store.by_identity.iter().any(|(id, entry)| {
            !valid_fingerprint(id) || sanitize_entry(entry.clone()).as_ref() != Some(entry)
        })
        || store.by_record.iter().any(|(id, entry)| {
            !super::valid_id(id) || sanitize_entry(entry.clone()).as_ref() != Some(entry)
        })
    {
        return Err("订阅到期设置无效。".into());
    }
    Ok(store)
}

pub fn remove_record_entry(vault: &Path, record_id: &str) {
    if !super::valid_id(record_id) || !vault.join(FILE_NAME).exists() {
        return;
    }
    let mut store = read_store(vault);
    if store.by_record.remove(record_id).is_some() {
        let _ = write_store(vault, &store);
    }
}

pub fn apply_manual(
    store: &ManualSubscriptionsFile,
    quota_identity: Option<&str>,
    record_id: Option<&str>,
    web: &mut super::online::WebMetadata,
    subscription_expires_at: &mut Option<u64>,
) {
    let by_qi = quota_identity
        .filter(|qi| valid_fingerprint(qi))
        .and_then(|qi| store.by_identity.get(qi));
    let by_rec = record_id
        .filter(|id| super::valid_id(id))
        .and_then(|id| store.by_record.get(id));
    let manual = match (by_qi, by_rec) {
        (Some(a), Some(b)) => {
            if a.updated_at_ms >= b.updated_at_ms {
                Some(a)
            } else {
                Some(b)
            }
        }
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };

    let browser_ms = web.billing_date.and_then(|_| web.billing_observed_at_ms);
    match manual {
        Some(entry) if browser_ms.is_none_or(|b_ms| entry.updated_at_ms >= b_ms) => {
            web.billing_date = Some(entry.expiry_epoch_sec);
            web.billing_date_kind = Some("next_renewal".into());
            web.billing_observed_at_ms = Some(entry.updated_at_ms);
            web.metadata_observed_at_ms = web
                .billing_observed_at_ms
                .max(web.manual_resets_observed_at_ms);
            web.subscription_expiry_ymd = Some(entry.expiry_ymd.clone());
            web.subscription_recharge_ymd = entry.recharge_ymd.clone();
            web.subscription_date_source = Some("manual".into());
            *subscription_expires_at = Some(entry.expiry_epoch_sec);
        }
        _ => {
            if let Some(browser_date) = web.billing_date {
                web.subscription_expiry_ymd = None;
                web.subscription_recharge_ymd = None;
                web.subscription_date_source = Some("browser".into());
                *subscription_expires_at = Some(browser_date);
            } else {
                web.subscription_expiry_ymd = None;
                web.subscription_recharge_ymd = None;
                web.subscription_date_source = None;
            }
        }
    }
}

#[tauri::command]
pub async fn identities_set_subscription_expiry(
    app: tauri::AppHandle,
    account_id: String,
    expected_identity: Option<String>,
    expiry_ymd: Option<String>,
    recharge_ymd: Option<String>,
) -> Result<super::State, String> {
    if account_id != "current" && !super::valid_id(&account_id) {
        return Err("身份编号无效。".into());
    }
    if let Some(ref exp) = expected_identity {
        if !exp.trim().is_empty() && !valid_fingerprint(exp.trim()) {
            return Err("quotaOnline.accountMismatch".into());
        }
    }

    let expiry_trimmed = expiry_ymd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let recharge_trimmed = recharge_ymd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let resolved_entry = match (&expiry_trimmed, &recharge_trimmed) {
        (None, None) => None,
        (Some(exp_raw), rec_opt) => {
            let exp = normalize_ymd(exp_raw)?;
            let rec = match rec_opt {
                Some(r) => Some(normalize_ymd(r)?),
                None => None,
            };
            let expiry_epoch_sec = ymd_to_utc_noon_sec(&exp)?;
            Some(ManualSubscriptionEntry {
                expiry_ymd: exp,
                recharge_ymd: rec,
                expiry_epoch_sec,
                updated_at_ms: now_ms().max(1),
            })
        }
        (None, Some(rec_raw)) => {
            let rec = normalize_ymd(rec_raw)?;
            let exp = add_one_month_ymd(&rec)?;
            let expiry_epoch_sec = ymd_to_utc_noon_sec(&exp)?;
            Some(ManualSubscriptionEntry {
                expiry_ymd: exp,
                recharge_ymd: Some(rec),
                expiry_epoch_sec,
                updated_at_ms: now_ms().max(1),
            })
        }
    };

    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let current_state = super::state(&worker)?;
        if current_state.recovery.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }

        let (actual_qi, target_record_id): (Option<String>, Option<String>) =
            if account_id == "current" {
                if !current_state.current.present {
                    return Err("quotaOnline.accountMismatch".into());
                }
                let active_rec = (current_state.active != "current"
                    && current_state
                        .records
                        .iter()
                        .any(|r| r.id == current_state.active))
                .then(|| current_state.active.clone());
                (current_state.current.quota_identity.clone(), active_rec)
            } else {
                if !current_state.records.iter().any(|r| r.id == account_id)
                    && !current_state
                        .warming_cards
                        .iter()
                        .any(|r| r.id == account_id)
                {
                    return Err("身份不存在。".into());
                }
                let qi = current_state
                    .summaries
                    .get(&account_id)
                    .and_then(|s| s.quota_identity.clone());
                (qi, Some(account_id.clone()))
            };

        if let Some(expected) = expected_identity
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if actual_qi.as_deref() != Some(expected) {
                return Err("quotaOnline.accountMismatch".into());
            }
        }

        let vault_path = super::vault(&worker)?;
        let mut store = read_store_checked(&vault_path)?;

        match resolved_entry {
            Some(entry) => {
                if let Some(ref qi) = actual_qi.as_ref().filter(|q| valid_fingerprint(q)) {
                    store.by_identity.insert((*qi).clone(), entry.clone());
                    if let Some(ref rid) = target_record_id {
                        store.by_record.remove(rid);
                    }
                } else if let Some(rid) = target_record_id {
                    store.by_record.insert(rid, entry);
                } else {
                    return Err("quotaOnline.accountMismatch".into());
                }
            }
            None => {
                if let Some(ref qi) = actual_qi {
                    store.by_identity.remove(qi);
                }
                if let Some(ref rid) = target_record_id {
                    store.by_record.remove(rid);
                }
            }
        }

        write_store(&vault_path, &store)?;
        let _ = worker.emit("quota-metadata-updated", ());
        super::state(&worker)
    })
    .await
    .map_err(|_| "无法保存订阅到期设置。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempVault(std::path::PathBuf);
    impl TempVault {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "claude-local-manual-sub-{}-{}",
                std::process::id(),
                now_ms()
            ));
            super::super::private::directory(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = fs::remove_file(self.0.join(FILE_NAME));
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn calendar_month_addition_clamps_month_end_and_leap_years() {
        assert_eq!(add_one_month_ymd("2026-10-12").unwrap(), "2026-11-12");
        assert_eq!(add_one_month_ymd("2026-10-29").unwrap(), "2026-11-29");
        assert_eq!(add_one_month_ymd("2026-01-31").unwrap(), "2026-02-28");
        assert_eq!(add_one_month_ymd("2028-01-31").unwrap(), "2028-02-29");
        assert_eq!(add_one_month_ymd("2026-12-15").unwrap(), "2027-01-15");
        assert!(parse_ymd("2026-02-29").is_err());
        assert!(parse_ymd("2026/10/12").is_err());
    }

    #[test]
    fn utc_noon_anchor_preserves_calendar_day_across_beijing_and_us_timezones() {
        let sec = ymd_to_utc_noon_sec("2026-11-12").unwrap() as i64;
        // UTC+8 (Beijing), UTC, UTC-5 (New York EST), UTC-8 (Los Angeles PST)
        for offset_hours in [8, 0, -5, -8] {
            let shifted = Utc
                .timestamp_opt(sec + offset_hours * 3600, 0)
                .single()
                .unwrap();
            assert_eq!(shifted.format("%m/%d").to_string(), "11/12");
        }
    }

    #[test]
    fn manual_store_roundtrip_and_newer_browser_precedence() {
        let vault = TempVault::new();
        let qi = "a".repeat(64);
        let mut store = read_store(&vault.0);
        let exp_sec = ymd_to_utc_noon_sec("2026-11-15").unwrap();
        store.by_identity.insert(
            qi.clone(),
            ManualSubscriptionEntry {
                expiry_ymd: "2026-11-15".into(),
                recharge_ymd: Some("2026-10-15".into()),
                expiry_epoch_sec: exp_sec,
                updated_at_ms: 5_000,
            },
        );
        write_store(&vault.0, &store).unwrap();
        let reloaded = read_store(&vault.0);
        assert_eq!(
            reloaded.by_identity.get(&qi).unwrap().expiry_ymd,
            "2026-11-15"
        );

        // Manual newer than browser (or no browser observation): manual wins
        let mut web = super::super::online::WebMetadata {
            billing_date_kind: Some("next_renewal".into()),
            billing_date: Some(1_700_000_000),
            billing_observed_at_ms: Some(4_000),
            ..Default::default()
        };
        let mut sub_exp = None;
        apply_manual(&reloaded, Some(&qi), None, &mut web, &mut sub_exp);
        assert_eq!(web.billing_date, Some(exp_sec));
        assert_eq!(web.subscription_expiry_ymd.as_deref(), Some("2026-11-15"));
        assert_eq!(web.subscription_recharge_ymd.as_deref(), Some("2026-10-15"));
        assert_eq!(web.subscription_date_source.as_deref(), Some("manual"));
        assert_eq!(sub_exp, Some(exp_sec));

        // Newer browser sync observation supersedes older manual override
        let mut newer_browser = super::super::online::WebMetadata {
            billing_date_kind: Some("next_renewal".into()),
            billing_date: Some(1_800_000_000),
            billing_observed_at_ms: Some(9_000),
            ..Default::default()
        };
        let mut sub_exp_browser = None;
        apply_manual(
            &reloaded,
            Some(&qi),
            None,
            &mut newer_browser,
            &mut sub_exp_browser,
        );
        assert_eq!(newer_browser.billing_date, Some(1_800_000_000));
        assert_eq!(newer_browser.subscription_expiry_ymd, None);
        assert_eq!(
            newer_browser.subscription_date_source.as_deref(),
            Some("browser")
        );
        assert_eq!(sub_exp_browser, Some(1_800_000_000));
    }
}
