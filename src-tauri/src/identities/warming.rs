// [INPUT]: Bounded private warming_cards.json, browser bindings, manual subscriptions, exit probe results and explicit user actions.
// [OUTPUT]: Four-stage browser-only cards with registered/probe country & timezone consistency, sanitized views, CRUD/probe commands and explicitly coordinated CLI promotion.
// [POS]: Free account metadata is independent of CLI identity; only explicit promotion enters Store::switch, and probe failure never blocks browser launch.
// [PROTOCOL]: Update this header and CLAUDE.md when changing this module.
use super::{database::Database, private, subscription, Policy, State};
use crate::progress::{Progress, Reporter};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Read, path::Path};
use tauri::{ipc::Channel, Manager};

pub const FILE_NAME: &str = "warming_cards.json";
const MAX_BYTES: u64 = 128 * 1024;
const MAX_CARDS: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarmingStage {
    Unregistered,
    KycPassed,
    WarmingFree,
    ProReady,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarmingCardRecord {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub note: Option<String>,
    pub stage: WarmingStage,
    pub created_ymd: String,
    pub last_warmed_ymd: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub registered_country: Option<String>,
    #[serde(default)]
    pub registered_timezone: Option<String>,
    #[serde(default)]
    pub last_probe_country: Option<String>,
    #[serde(default)]
    pub last_probe_timezone: Option<String>,
    #[serde(default)]
    pub last_probe_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WarmingCardView {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub note: Option<String>,
    pub stage: WarmingStage,
    pub created_ymd: String,
    pub last_warmed_ymd: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub registered_country: Option<String>,
    pub registered_timezone: Option<String>,
    pub last_probe_country: Option<String>,
    pub last_probe_timezone: Option<String>,
    pub last_probe_at: Option<u64>,
    pub slot: String,
    pub seed: u32,
    pub browser_active: bool,
    pub region_summary: Option<String>,
    pub has_custom_proxy: bool,
    pub subscription_expiry_ymd: Option<String>,
    pub subscription_recharge_ymd: Option<String>,
    pub subscription_date_source: Option<String>,
    pub subscription_expires_at: Option<u64>,
}

#[derive(Serialize)]
pub struct WarmingProbeCheckResult {
    pub status: String, // "matched" | "locked_initial" | "mismatch" | "probe_skipped"
    pub registered_country: Option<String>,
    pub registered_timezone: Option<String>,
    pub current_country: Option<String>,
    pub current_timezone: Option<String>,
    pub message: Option<String>,
    pub state: State,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CardsFile {
    version: u32,
    cards: Vec<WarmingCardRecord>,
}

fn problem() -> String {
    "养号卡资料无效或无法读写；请保留原文件并重试。".into()
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn optional_text(value: Option<String>, limit: usize) -> Result<Option<String>, String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.chars().count() > limit || s.chars().any(char::is_control) {
                Err(problem())
            } else {
                Ok(s)
            }
        })
        .transpose()
}

fn normalize_country(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim().to_ascii_uppercase();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() == 2 && trimmed.bytes().all(|b| b.is_ascii_uppercase()) {
        Ok(Some(trimmed))
    } else {
        Err(problem())
    }
}

fn normalize_timezone(value: Option<String>) -> Result<Option<String>, String> {
    let tz = optional_text(value, 64)?;
    if tz.as_ref().is_some_and(|s| s.chars().any(char::is_whitespace)) {
        return Err(problem());
    }
    Ok(tz)
}

fn normalize(mut card: WarmingCardRecord) -> Result<WarmingCardRecord, String> {
    if !super::valid_id(&card.id) || card.created_at == 0 || card.updated_at < card.created_at {
        return Err(problem());
    }
    card.name = super::name(&card.name)?;
    card.email = optional_text(card.email, 254)?;
    if card
        .email
        .as_ref()
        .is_some_and(|s| s.chars().any(char::is_whitespace) || !s.contains('@'))
    {
        return Err(problem());
    }
    card.note = optional_text(card.note, 80)?;
    card.created_ymd = subscription::normalize_ymd(&card.created_ymd)?;
    card.last_warmed_ymd = card
        .last_warmed_ymd
        .as_deref()
        .map(subscription::normalize_ymd)
        .transpose()?;
    card.registered_country = normalize_country(card.registered_country)?;
    card.registered_timezone = normalize_timezone(card.registered_timezone)?;
    card.last_probe_country = normalize_country(card.last_probe_country)?;
    card.last_probe_timezone = normalize_timezone(card.last_probe_timezone)?;
    Ok(card)
}

pub(crate) fn read_cards(vault: &Path) -> Result<Vec<WarmingCardRecord>, String> {
    let path = vault.join(FILE_NAME);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(problem()),
        Ok(meta) if !meta.is_file() || meta.len() > MAX_BYTES => return Err(problem()),
        Ok(_) => (),
    }
    private::safe(&path)?;
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|_| problem())?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| problem())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(problem());
    }
    let parsed: CardsFile = serde_json::from_slice(&bytes).map_err(|_| problem())?;
    if parsed.version != 1 || parsed.cards.len() > MAX_CARDS {
        return Err(problem());
    }
    let mut seen = HashSet::new();
    parsed
        .cards
        .into_iter()
        .map(|card| {
            let card = normalize(card)?;
            if !seen.insert(card.id.clone()) {
                return Err(problem());
            }
            Ok(card)
        })
        .collect()
}

fn write_cards(vault: &Path, cards: &[WarmingCardRecord]) -> Result<(), String> {
    if cards.len() > MAX_CARDS {
        return Err("最多可创建 128 张养号卡。".into());
    }
    let mut seen = HashSet::new();
    let cards = cards
        .iter()
        .cloned()
        .map(|c| {
            let c = normalize(c)?;
            if !seen.insert(c.id.clone()) {
                return Err(problem());
            }
            Ok(c)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let bytes =
        serde_json::to_vec_pretty(&CardsFile { version: 1, cards }).map_err(|_| problem())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("养号卡资料超过 128 KiB 上限。".into());
    }
    private::directory(vault)?;
    private::write(&vault.join(FILE_NAME), &bytes)
}

pub(crate) fn contains(vault: &Path, id: &str) -> Result<bool, String> {
    Ok(read_cards(vault)?.iter().any(|c| c.id == id))
}

pub(crate) fn remove_card(vault: &Path, id: &str) -> Result<(), String> {
    let mut cards = read_cards(vault)?;
    let count = cards.len();
    cards.retain(|c| c.id != id);
    if cards.len() != count {
        write_cards(vault, &cards)?;
    }
    Ok(())
}

/// Called only while the Cleaner short gate is held. An interrupted post-commit
/// cleanup is repaired without deleting browser bindings or inherited subscription dates.
pub(crate) fn cleanup_promoted(vault: &Path, db: &mut Database) -> Result<(), String> {
    let ids: HashSet<_> = db
        .records()?
        .into_iter()
        .filter(|r| !r.empty)
        .map(|r| r.id)
        .collect();
    let mut cards = read_cards(vault)?;
    let count = cards.len();
    cards.retain(|c| !ids.contains(&c.id));
    if count != cards.len() {
        write_cards(vault, &cards)?;
    }
    if let Some(id) = db.get("browser.promotion")?.filter(|id| ids.contains(id)) {
        db.clear_warming_promotion(&id)?;
    }
    Ok(())
}

pub(crate) fn views(vault: &Path, db: &Database) -> Result<Vec<WarmingCardView>, String> {
    let active = db.browser_slot()?;
    let archived: HashSet<_> = db
        .records()?
        .into_iter()
        .filter(|r| !r.empty)
        .map(|r| r.id)
        .collect();
    let subscriptions = subscription::read_store(vault);
    read_cards(vault)?
        .into_iter()
        .filter(|c| !archived.contains(&c.id))
        .map(|c| {
            let slot = db.browser_for(&c.id)?.ok_or_else(problem)?;
            if !super::browser_link::valid_slot(&slot) {
                return Err(problem());
            }
            let seed = db.browser_seed(&slot)?.ok_or_else(problem)?;
            let root = vault.parent().ok_or_else(problem)?.join("browser");
            let scope = if slot == "legacy" {
                root
            } else {
                root.join("contexts").join(&slot)
            };
            private::parents(&scope)?;
            let config = crate::browser::config::load(&scope).ok();
            let region_summary = config.as_ref().and_then(|cfg| {
                if cfg.follow_machine {
                    let machine = crate::browser::config::machine().ok()?;
                    cfg.region(&machine)
                        .map(|r| format!("{} · {}", r.country, cfg.timezone(&machine)))
                } else {
                    crate::regions::matching(&cfg.language, &cfg.timezone)
                        .map(|r| format!("{} · {}", r.country, cfg.timezone))
                }
            });
            let sub = subscriptions.by_record.get(&c.id);
            Ok(WarmingCardView {
                browser_active: slot == active,
                slot,
                seed,
                region_summary,
                has_custom_proxy: config
                    .as_ref()
                    .is_some_and(|cfg| !cfg.proxy.trim().is_empty()),
                subscription_expiry_ymd: sub.map(|s| s.expiry_ymd.clone()),
                subscription_recharge_ymd: sub.and_then(|s| s.recharge_ymd.clone()),
                subscription_date_source: sub.map(|_| "manual".into()),
                subscription_expires_at: sub.map(|s| s.expiry_epoch_sec),
                id: c.id,
                name: c.name,
                email: c.email,
                note: c.note,
                stage: c.stage,
                created_ymd: c.created_ymd,
                last_warmed_ymd: c.last_warmed_ymd,
                created_at: c.created_at,
                updated_at: c.updated_at,
                registered_country: c.registered_country,
                registered_timezone: c.registered_timezone,
                last_probe_country: c.last_probe_country,
                last_probe_timezone: c.last_probe_timezone,
                last_probe_at: c.last_probe_at,
            })
        })
        .collect()
}

fn open_mode(mode: &str) -> Result<(), String> {
    if ["claude_ai", "verify", "switch_only"].contains(&mode) {
        Ok(())
    } else {
        Err("浏览器打开方式无效。".into())
    }
}

fn available(vault: &Path, db: &Database, id: &str) -> Result<WarmingCardRecord, String> {
    if !super::valid_id(id) {
        return Err("身份编号无效。".into());
    }
    if db.get("recovery")?.is_some() {
        return Err("请先恢复未完成的身份切换。".into());
    }
    if db.records()?.iter().any(|r| r.id == id && !r.empty) {
        return Err("养号卡已转正，请使用 CLI 身份卡。".into());
    }
    read_cards(vault)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or("养号卡不存在。".into())
}

async fn run(
    app: tauri::AppHandle,
    change: bool,
    action: impl FnOnce(&tauri::AppHandle) -> Result<(), String> + Send + 'static,
) -> Result<State, String> {
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    if change {
        cleaner.begin_identity_change();
    }
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        action(&worker)?;
        super::state(&worker)
    })
    .await
    .map_err(|_| "养号卡操作中断，请刷新检查。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}

#[tauri::command]
pub async fn identities_warming_create(
    app: tauri::AppHandle,
    name: String,
    email: Option<String>,
    note: Option<String>,
    stage: WarmingStage,
    created_ymd: String,
    open_mode: String,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    self::open_mode(&open_mode)?;
    let time = now().max(1);
    let card = normalize(WarmingCardRecord {
        id: super::new_id()?,
        name,
        email,
        note,
        stage,
        created_ymd,
        last_warmed_ymd: None,
        created_at: time,
        updated_at: time,
        registered_country: None,
        registered_timezone: None,
        last_probe_country: None,
        last_probe_timezone: None,
        last_probe_at: None,
    })?;
    run(app, false, move |app| {
        let reporter = Reporter::channel(Some(on_progress));
        let vault = super::vault(app)?;
        let mut db = Database::open(&vault)?;
        if db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        cleanup_promoted(&vault, &mut db)?;
        let mut cards = read_cards(&vault)?;
        if cards.len() >= MAX_CARDS {
            return Err("最多可创建 128 张养号卡。".into());
        }
        let (slot, _) = db.bind_warming(&card.id)?;
        cards.push(card.clone());
        if let Err(error) = write_cards(&vault, &cards) {
            return match db.remove_warming_binding(&card.id) {
                Ok(()) => Err(error),
                Err(_) => Err(format!("{error} 浏览器预留绑定未能回收，请刷新。")),
            };
        }
        // A browser launch failure leaves the durable card available for retry.
        crate::browser::switch_warming_browser(app, &reporter, &slot, &open_mode)?;
        mark_opened(&vault, &card.id, &open_mode)
    })
    .await
}

fn mark_opened(vault: &Path, id: &str, mode: &str) -> Result<(), String> {
    if mode == "switch_only" {
        return Ok(());
    }
    let mut cards = read_cards(vault)?;
    let card = cards.iter_mut().find(|c| c.id == id).ok_or_else(problem)?;
    card.last_warmed_ymd = Some(today());
    card.updated_at = now().max(card.updated_at);
    write_cards(vault, &cards)
}

fn apply_card_update(
    previous: WarmingCardRecord,
    name: String,
    email: Option<String>,
    note: Option<String>,
    stage: WarmingStage,
    created_ymd: String,
    registered_country: Option<String>,
    registered_timezone: Option<String>,
    updated_at: u64,
) -> Result<WarmingCardRecord, String> {
    let registered_country = match registered_country {
        None => previous.registered_country.clone(),
        Some(s) if s.trim().is_empty() => None,
        Some(s) => Some(s),
    };
    let registered_timezone = match registered_timezone {
        None => previous.registered_timezone.clone(),
        Some(s) if s.trim().is_empty() => None,
        Some(s) => Some(s),
    };
    normalize(WarmingCardRecord {
        name,
        email,
        note,
        stage,
        created_ymd,
        registered_country,
        registered_timezone,
        updated_at: updated_at.max(previous.updated_at),
        ..previous
    })
}

fn apply_probe_outcome(
    mut card: WarmingCardRecord,
    exit_country: &str,
    exit_timezone: &str,
    lock_current: bool,
    probe_at: u64,
) -> Result<(WarmingCardRecord, &'static str), String> {
    card.last_probe_country = Some(exit_country.to_string());
    card.last_probe_timezone = if exit_timezone.trim().is_empty() {
        None
    } else {
        Some(exit_timezone.trim().to_string())
    };
    card.last_probe_at = Some(probe_at.max(1));
    let status = if card.registered_country.is_none() || lock_current {
        card.registered_country = Some(exit_country.to_string());
        card.registered_timezone = card.last_probe_timezone.clone();
        "locked_initial"
    } else if card.registered_country.as_deref() != Some(exit_country)
        || (card.registered_timezone.is_some()
            && card.last_probe_timezone.is_some()
            && card.registered_timezone != card.last_probe_timezone)
    {
        "mismatch"
    } else {
        "matched"
    };
    let card = normalize(card)?;
    Ok((card, status))
}

#[tauri::command]
pub async fn identities_warming_update(
    app: tauri::AppHandle,
    id: String,
    name: String,
    email: Option<String>,
    note: Option<String>,
    stage: WarmingStage,
    created_ymd: String,
    registered_country: Option<String>,
    registered_timezone: Option<String>,
) -> Result<State, String> {
    run(app, false, move |app| {
        let vault = super::vault(app)?;
        let db = Database::open(&vault)?;
        let previous = available(&vault, &db, &id)?;
        let card = apply_card_update(
            previous,
            name,
            email,
            note,
            stage,
            created_ymd,
            registered_country,
            registered_timezone,
            now(),
        )?;
        let mut cards = read_cards(&vault)?;
        *cards.iter_mut().find(|c| c.id == id).ok_or_else(problem)? = card;
        write_cards(&vault, &cards)
    })
    .await
}

#[tauri::command]
pub async fn identities_warming_probe_check(
    app: tauri::AppHandle,
    id: String,
    lock_current: Option<bool>,
) -> Result<WarmingProbeCheckResult, String> {
    let prep_app = app.clone();
    let prep_id = id.clone();
    let (initial_card, effective_proxy) = tauri::async_runtime::spawn_blocking(
        move || -> Result<(WarmingCardRecord, String), String> {
            let vault = super::vault(&prep_app)?;
            let db = Database::open(&vault)?;
            let card = available(&vault, &db, &prep_id)?;
            let slot = db.browser_for(&prep_id)?.ok_or_else(problem)?;
            if !super::browser_link::valid_slot(&slot) {
                return Err(problem());
            }
            let root = vault.parent().ok_or_else(problem)?.join("browser");
            let scope = if slot == "legacy" {
                root
            } else {
                root.join("contexts").join(&slot)
            };
            private::parents(&scope)?;
            let configured = crate::browser::config::load(&scope)
                .ok()
                .map(|c| c.proxy)
                .filter(|p| !p.trim().is_empty());
            let effective_proxy = configured.unwrap_or_else(|| {
                crate::browser::config::machine()
                    .ok()
                    .map(|m| m.system_proxy)
                    .unwrap_or_default()
            });
            Ok((card, effective_proxy))
        },
    )
    .await
    .map_err(|_| "养号卡操作中断，请刷新检查。".to_string())??;

    match crate::browser::network::probe(&effective_proxy).await {
        Err(err) => {
            let state_app = app.clone();
            let state = tauri::async_runtime::spawn_blocking(move || super::state(&state_app))
                .await
                .map_err(|_| "养号卡操作中断，请刷新检查。".to_string())??;
            Ok(WarmingProbeCheckResult {
                status: "probe_skipped".into(),
                registered_country: initial_card.registered_country,
                registered_timezone: initial_card.registered_timezone,
                current_country: None,
                current_timezone: None,
                message: Some(err),
                state,
            })
        }
        Ok(exit) => {
            let cleaner = app.state::<crate::cleaner::Cleaner>();
            cleaner.enter()?;
            let worker = app.clone();
            let lock = lock_current == Some(true);
            let result = tauri::async_runtime::spawn_blocking(move || {
                let vault = super::vault(&worker)?;
                let db = Database::open(&vault)?;
                let card = available(&vault, &db, &id)?;
                let (updated, status) = apply_probe_outcome(
                    card,
                    &exit.country,
                    &exit.timezone,
                    lock,
                    now().max(1),
                )?;
                let mut cards = read_cards(&vault)?;
                *cards.iter_mut().find(|c| c.id == id).ok_or_else(problem)? = updated.clone();
                write_cards(&vault, &cards)?;
                let state = super::state(&worker)?;
                Ok(WarmingProbeCheckResult {
                    status: status.into(),
                    registered_country: updated.registered_country,
                    registered_timezone: updated.registered_timezone,
                    current_country: updated.last_probe_country,
                    current_timezone: updated.last_probe_timezone,
                    message: None,
                    state,
                })
            })
            .await
            .map_err(|_| "养号卡操作中断，请刷新检查。".to_string())
            .and_then(|r| r);
            cleaner.leave();
            result
        }
    }
}

#[tauri::command]
pub async fn identities_warming_open(
    app: tauri::AppHandle,
    id: String,
    open_mode: String,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    self::open_mode(&open_mode)?;
    run(app, false, move |app| {
        let vault = super::vault(app)?;
        let db = Database::open(&vault)?;
        available(&vault, &db, &id)?;
        let slot = db.browser_for(&id)?.ok_or_else(problem)?;
        crate::browser::switch_warming_browser(
            app,
            &Reporter::channel(Some(on_progress)),
            &slot,
            &open_mode,
        )?;
        mark_opened(&vault, &id, &open_mode)
    })
    .await
}

#[tauri::command]
pub async fn identities_warming_promote(
    app: tauri::AppHandle,
    id: String,
    current_name: String,
    policy: Policy,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    let current_name = super::name(&current_name)?;
    run(app, true, move |app| {
        let vault = super::vault(app)?;
        let mut db = Database::open(&vault)?;
        let card = available(&vault, &db, &id)?;
        if card.stage != WarmingStage::ProReady {
            return Err("请先将养号卡设为已充 Pro 待转正。".into());
        }
        let slot = db.browser_for(&id)?.ok_or_else(problem)?;
        let reporter = Reporter::channel(Some(on_progress));
        // Stop is an explicit frontend-confirmed action; this path only verifies it.
        crate::cleaner::identity::ensure_stopped()?;
        let result = crate::browser::promote_warming_identity(app, &reporter, || {
            db.prepare_warming_promotion(&id, &slot)?;
            let mut store = super::store::Store::open(&vault, &crate::cleaner::identity::root()?)?;
            store.suppress_browser_draft = true;
            store.switch("empty", &current_name, &policy, &reporter)
        });
        if let Err(error) = result {
            if db.rollback_warming_promotion(&id).is_err() {
                return Err(format!("{error} 转正预留未能撤销，请先恢复身份切换。"));
            }
            crate::browser::sync_current_launch_args(app);
            return Err(error);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn identities_warming_delete(
    app: tauri::AppHandle,
    id: String,
    delete_browser: bool,
) -> Result<State, String> {
    run(app, false, move |app| {
        let vault = super::vault(app)?;
        let mut db = Database::open(&vault)?;
        available(&vault, &db, &id)?;
        let slot = db.browser_for(&id)?.ok_or_else(problem)?;
        if slot == db.browser_slot()? {
            // Leave the active profile through the same browser-only path, allowing
            // deletion of the sole warming card without interrupting a running CLI.
            crate::browser::detach_warming_browser(app, &Reporter::channel(None))?;
        }
        crate::browser::delete_saved(app, &id, delete_browser, || {
            let cards = read_cards(&vault)?;
            let old_subs = subscription::read_store_checked(&vault)?;
            let mut subs = old_subs.clone();
            if subs.by_record.remove(&id).is_some() {
                subscription::write_store(&vault, &subs)?;
            }
            if let Err(error) = remove_card(&vault, &id) {
                if subscription::write_store(&vault, &old_subs).is_err() {
                    return Err(format!("{error} 订阅日期回滚失败，请刷新检查。"));
                }
                return Err(error);
            }
            if let Err(error) = db.remove_warming_binding(&id) {
                let card_restore = write_cards(&vault, &cards);
                let sub_restore = subscription::write_store(&vault, &old_subs);
                if card_restore.is_err() || sub_restore.is_err() {
                    return Err(format!("{error} 养号卡删除回滚未完成，请刷新检查。"));
                }
                return Err(error);
            }
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: std::path::PathBuf,
        vault: std::path::PathBuf,
        home: std::path::PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            #[cfg(windows)]
            let temp = dunce::canonicalize(std::env::temp_dir()).unwrap();
            #[cfg(not(windows))]
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            let root = temp.join(format!(
                "claude-warming-{}",
                super::super::new_id().unwrap()
            ));
            let home = root.join("home");
            private::directory(&home.join(".claude")).unwrap();
            Self {
                vault: root.join("identity-vault"),
                root,
                home,
            }
        }
        fn login(&self, account: &str) {
            let bytes = serde_json::to_vec(&serde_json::json!({"oauthAccount": {"accountUuid": account, "organizationUuid": "warming-test-org", "emailAddress": format!("{account}@example.invalid")}})).unwrap();
            private::write(&self.home.join(".claude.json"), &bytes).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn card() -> WarmingCardRecord {
        WarmingCardRecord {
            id: super::super::new_id().unwrap(),
            name: " Free sample ".into(),
            email: Some("warming@example.invalid".into()),
            note: Some(" synthetic ".into()),
            stage: WarmingStage::ProReady,
            created_ymd: "2026-10-29".into(),
            last_warmed_ymd: None,
            created_at: 1,
            updated_at: 1,
            registered_country: None,
            registered_timezone: None,
            last_probe_country: None,
            last_probe_timezone: None,
            last_probe_at: None,
        }
    }
    #[test]
    fn stages_roundtrip_metadata_limits_and_invalid_utf8_calendar_are_rejected() {
        let f = Fixture::new();
        for stage in [
            WarmingStage::Unregistered,
            WarmingStage::KycPassed,
            WarmingStage::WarmingFree,
            WarmingStage::ProReady,
        ] {
            let mut c = card();
            c.stage = stage;
            write_cards(&f.vault, &[c.clone()]).unwrap();
            let stored = read_cards(&f.vault).unwrap();
            assert_eq!(stored[0].stage, stage);
            assert_eq!(stored[0].name, "Free sample");
            assert_eq!(stored[0].note.as_deref(), Some("synthetic"));
            assert!(contains(&f.vault, &c.id).unwrap());
        }
        let mut c = card();
        c.note = Some("n".repeat(81));
        assert!(write_cards(&f.vault, &[c]).is_err());
        let c = card();
        assert!(write_cards(&f.vault, &[c.clone(), c]).is_err());
        assert!(write_cards(&f.vault, &(0..129).map(|_| card()).collect::<Vec<_>>()).is_err());
        assert!(subscription::parse_ymd("a中-01-01").is_err());
        assert!(subscription::parse_ymd("2026-02-30").is_err());
        private::write(
            &f.vault.join(FILE_NAME),
            &vec![b' '; MAX_BYTES as usize + 1],
        )
        .unwrap();
        assert!(read_cards(&f.vault).is_err());
        private::write(&f.vault.join(FILE_NAME), b"{invalid").unwrap();
        assert!(read_cards(&f.vault).is_err());
        assert_eq!(fs::read(&f.vault.join(FILE_NAME)).unwrap(), b"{invalid");
    }
    #[test]
    fn browser_only_metadata_and_subscription_projection_leave_cli_pointer_and_files_unchanged() {
        let f = Fixture::new();
        let mut db = Database::open(&f.vault).unwrap();
        f.login("live-pro");
        let before = fs::read(f.home.join(".claude.json")).unwrap();
        let cli_active = db.get("active").unwrap();
        let c = card();
        let (slot, seed) = db.bind_warming(&c.id).unwrap();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        db.switch_browser_slot_only(&slot).unwrap();
        mark_opened(&f.vault, &c.id, "switch_only").unwrap();
        assert!(read_cards(&f.vault).unwrap()[0].last_warmed_ymd.is_none());
        mark_opened(&f.vault, &c.id, "claude_ai").unwrap();
        let view = views(&f.vault, &db).unwrap().remove(0);
        assert_eq!(
            (view.slot, view.seed, view.browser_active),
            (slot, seed, true)
        );
        assert_eq!(view.last_warmed_ymd, Some(today()));
        assert_eq!(db.get("active").unwrap(), cli_active);
        assert_eq!(fs::read(f.home.join(".claude.json")).unwrap(), before);
        assert!(db.records().unwrap().is_empty());
    }
    #[test]
    fn cli_store_switch_save_rollback_recovery_and_delete_preserve_warming_profile() {
        let f = Fixture::new();
        let reporter = Reporter::channel(None);
        let policy = Policy::default();
        let mut store = super::super::store::Store::open(&f.vault, &f.home).unwrap();
        f.login("cli-a");
        store.save_current("CLI A", &policy, &reporter).unwrap();
        let a = store.db.get("active").unwrap().unwrap();
        f.login("cli-b");
        store.save_current("CLI B", &policy, &reporter).unwrap();
        let b = store.db.get("active").unwrap().unwrap();
        let c = card();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        let (slot, seed) = store.db.bind_warming(&c.id).unwrap();
        store.db.switch_browser_slot_only(&slot).unwrap();
        let scope = f.root.join("browser/contexts").join(&slot);
        let cookie = scope.join("profile/Default/Cookies");
        private::directory(cookie.parent().unwrap()).unwrap();
        private::write(&cookie, b"synthetic warming login").unwrap();
        let mut config = crate::browser::config::Config::default();
        config.seed = seed;
        crate::browser::config::save(&scope, &config).unwrap();
        let config_before = fs::read(scope.join("config.json")).unwrap();
        let browser_unchanged = |store: &super::super::store::Store| {
            assert_eq!(store.db.browser_slot().unwrap(), slot);
            assert_eq!(store.db.browser_for(&c.id).unwrap(), Some(slot.clone()));
            assert_eq!(store.db.browser_seed(&slot).unwrap(), Some(seed));
            assert_eq!(fs::read(&cookie).unwrap(), b"synthetic warming login");
            assert_eq!(fs::read(scope.join("config.json")).unwrap(), config_before);
            assert!(store.db.get("browser.promotion").unwrap().is_none());
        };
        // Saving a previously unknown CLI login must allocate its own binding.
        f.login("cli-new");
        store.save_current("CLI New", &policy, &reporter).unwrap();
        let new_cli = store.db.get("active").unwrap().unwrap();
        assert_ne!(new_cli, c.id);
        assert_ne!(store.db.browser_for(&new_cli).unwrap(), Some(slot.clone()));
        browser_unchanged(&store);
        store.switch(&a, "CLI New", &policy, &reporter).unwrap();
        assert_eq!(store.db.get("active").unwrap(), Some(a.clone()));
        assert_eq!(
            super::super::profile::read(&f.home).email.as_deref(),
            Some("cli-a@example.invalid")
        );
        browser_unchanged(&store);
        store
            .save_current("CLI A saved", &policy, &reporter)
            .unwrap();
        browser_unchanged(&store);
        store.fail_after_clear = true;
        let failed = Reporter::channel(None);
        assert!(store.switch(&b, "CLI A saved", &policy, &failed).is_err());
        assert!(failed
            .events()
            .iter()
            .any(|event| event.stage() == "rollback" && event.status() == "ok"));
        assert_eq!(store.db.get("active").unwrap(), Some(a.clone()));
        assert!(store.db.get("recovery").unwrap().is_none());
        assert_eq!(
            super::super::profile::read(&f.home).email.as_deref(),
            Some("cli-a@example.invalid")
        );
        browser_unchanged(&store);
        store.fail_after_clear = false;
        // Reopen a real interrupted CLI checkpoint, then run Store::recover.
        let outgoing = store
            .db
            .records()
            .unwrap()
            .into_iter()
            .find(|record| record.id == a)
            .unwrap();
        store.db.pending(&outgoing, &b).unwrap();
        drop(store);
        let mut store = super::super::store::Store::open(&f.vault, &f.home).unwrap();
        store.recover("Recovered CLI", &reporter).unwrap();
        assert!(store.db.get("recovery").unwrap().is_none());
        browser_unchanged(&store);
        store.switch("empty", "CLI A", &policy, &reporter).unwrap();
        assert_eq!(store.db.get("active").unwrap().as_deref(), Some("empty"));
        browser_unchanged(&store);
        f.login("cli-after-empty");
        store
            .save_current("CLI after empty", &policy, &reporter)
            .unwrap();
        browser_unchanged(&store);
        store.delete("current", &policy, &reporter).unwrap();
        browser_unchanged(&store);
        store.delete(&b, &policy, &reporter).unwrap();
        browser_unchanged(&store);
        assert!(contains(&f.vault, &c.id).unwrap());
    }
    #[test]
    fn promotion_preserves_seed_and_subscription_and_cannot_capture_outgoing_unsaved_pro() {
        let f = Fixture::new();
        let reporter = Reporter::channel(None);
        let policy = Policy::default();
        let mut store = super::super::store::Store::open(&f.vault, &f.home).unwrap();
        f.login("saved-pro");
        store.save_current("Saved Pro", &policy, &reporter).unwrap();
        let c = card();
        let (slot, seed) = store.db.bind_warming(&c.id).unwrap();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        let mut subs = subscription::ManualSubscriptionsFile {
            version: 1,
            ..Default::default()
        };
        subs.by_record.insert(
            c.id.clone(),
            subscription::ManualSubscriptionEntry {
                expiry_ymd: "2026-11-29".into(),
                recharge_ymd: Some("2026-10-29".into()),
                expiry_epoch_sec: subscription::ymd_to_utc_noon_sec("2026-11-29").unwrap(),
                updated_at_ms: 1,
            },
        );
        subscription::write_store(&f.vault, &subs).unwrap();
        f.login("unsaved-outgoing-pro");
        store.db.prepare_warming_promotion(&c.id, &slot).unwrap();
        assert!(store.db.browser_draft().unwrap().is_none());
        store
            .switch("empty", "Outgoing Pro", &policy, &reporter)
            .unwrap();
        assert!(store.db.records().unwrap().iter().all(|r| r.id != c.id));
        assert!(contains(&f.vault, &c.id).unwrap());
        assert_eq!(store.db.browser_draft().unwrap(), Some(c.id.clone()));
        assert_eq!(store.db.browser_slot().unwrap(), slot);
        f.login("promoted-free");
        store.save_current("Promoted", &policy, &reporter).unwrap();
        assert!(store
            .db
            .records()
            .unwrap()
            .iter()
            .any(|r| r.id == c.id && !r.empty));
        assert!(!contains(&f.vault, &c.id).unwrap());
        assert_eq!(store.db.browser_for(&c.id).unwrap(), Some(slot.clone()));
        assert_eq!(store.db.browser_seed(&slot).unwrap(), Some(seed));
        assert_eq!(subscription::read_store_checked(&f.vault).unwrap(), subs);
        assert!(store.db.get("browser.draft").unwrap().is_none());
        assert!(store.db.get("browser.promotion").unwrap().is_none());
    }
    #[test]
    fn promotion_rollback_retains_card_and_rejects_future_draft_consumption() {
        let f = Fixture::new();
        let mut store = super::super::store::Store::open(&f.vault, &f.home).unwrap();
        let reporter = Reporter::channel(None);
        f.login("pro-before-failure");
        store
            .save_current("Pro", &Policy::default(), &reporter)
            .unwrap();
        let c = card();
        let (slot, seed) = store.db.bind_warming(&c.id).unwrap();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        let prior_slot = store.db.browser_slot().unwrap();
        let prior_active = store.db.get("active").unwrap();
        store.db.prepare_warming_promotion(&c.id, &slot).unwrap();
        store.fail_after_clear = true;
        assert!(store
            .switch("empty", "Pro", &Policy::default(), &reporter)
            .is_err());
        store.db.rollback_warming_promotion(&c.id).unwrap();
        assert_eq!(store.db.get("active").unwrap(), prior_active);
        assert_eq!(store.db.browser_slot().unwrap(), prior_slot);
        assert_eq!(store.db.browser_seed(&slot).unwrap(), Some(seed));
        assert!(contains(&f.vault, &c.id).unwrap());
        assert!(store.db.get("browser.draft").unwrap().is_none());
        assert!(store.db.get("browser.promotion").unwrap().is_none());
    }
    #[test]
    fn interrupted_cleanup_hides_duplicate_then_prunes_it_without_losing_subscription() {
        let f = Fixture::new();
        let mut db = Database::open(&f.vault).unwrap();
        let c = card();
        db.bind_warming(&c.id).unwrap();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        db.remember(&super::super::database::Record {
            id: c.id.clone(),
            name: c.name.clone(),
            archive: format!("{}.baga", super::super::new_id().unwrap()),
            saved_at: 1,
            bytes: 1,
            policy: Policy::default(),
            empty: false,
            account_key: None,
        })
        .unwrap();
        assert!(views(&f.vault, &db).unwrap().is_empty());
        cleanup_promoted(&f.vault, &mut db).unwrap();
        assert!(!contains(&f.vault, &c.id).unwrap());
        assert!(db.browser_for(&c.id).unwrap().is_some());
    }
    #[test]
    fn active_card_deletion_switches_to_fresh_browser_slot_and_preserves_cli() {
        let f = Fixture::new();
        let mut db = Database::open(&f.vault).unwrap();
        let c = card();
        let (slot, _) = db.bind_warming(&c.id).unwrap();
        write_cards(&f.vault, &[c.clone()]).unwrap();
        let cli_before = db.get("active").unwrap();
        db.switch_browser_slot_only(&slot).unwrap();
        assert!(db.remove_warming_binding(&c.id).is_err());
        let fresh = super::super::new_id().unwrap();
        db.switch_browser_slot_only(&fresh).unwrap();
        remove_card(&f.vault, &c.id).unwrap();
        db.remove_warming_binding(&c.id).unwrap();
        assert_eq!(db.browser_slot().unwrap(), fresh);
        assert_eq!(db.get("active").unwrap(), cli_before);
        assert!(db.browser_for(&c.id).unwrap().is_none());
        assert!(read_cards(&f.vault).unwrap().is_empty());
    }
    #[test]
    fn country_timezone_normalization_backward_schema_and_probe_outcomes_work() {
        let f = Fixture::new();
        let legacy_id = super::super::new_id().unwrap();
        let legacy_json = serde_json::json!({
            "version": 1,
            "cards": [{
                "id": legacy_id,
                "name": "Legacy card",
                "email": "legacy@example.invalid",
                "note": "schema1 without country fields",
                "stage": "warming_free",
                "created_ymd": "2026-10-20",
                "last_warmed_ymd": null,
                "created_at": 100,
                "updated_at": 100
            }]
        });
        private::directory(&f.vault).unwrap();
        private::write(
            &f.vault.join(FILE_NAME),
            &serde_json::to_vec_pretty(&legacy_json).unwrap(),
        )
        .unwrap();
        let loaded = read_cards(&f.vault).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].registered_country, None);
        assert_eq!(loaded[0].registered_timezone, None);
        assert_eq!(loaded[0].last_probe_country, None);
        assert_eq!(loaded[0].last_probe_timezone, None);
        assert_eq!(loaded[0].last_probe_at, None);

        // First probe auto-locks country and timezone.
        let (locked, status) = apply_probe_outcome(
            loaded[0].clone(),
            "us",
            "America/Los_Angeles",
            false,
            1_700_000_000,
        )
        .unwrap();
        assert_eq!(status, "locked_initial");
        assert_eq!(locked.registered_country.as_deref(), Some("US"));
        assert_eq!(
            locked.registered_timezone.as_deref(),
            Some("America/Los_Angeles")
        );
        assert_eq!(locked.last_probe_country.as_deref(), Some("US"));
        assert_eq!(
            locked.last_probe_timezone.as_deref(),
            Some("America/Los_Angeles")
        );
        assert_eq!(locked.last_probe_at, Some(1_700_000_000));

        // Subsequent matching probe returns "matched".
        let (matched, status) = apply_probe_outcome(
            locked.clone(),
            "US",
            "America/Los_Angeles",
            false,
            1_700_000_060,
        )
        .unwrap();
        assert_eq!(status, "matched");
        assert_eq!(matched.registered_country.as_deref(), Some("US"));

        // Country drift returns "mismatch" without overwriting registered_country.
        let (drifted, status) = apply_probe_outcome(
            matched.clone(),
            "JP",
            "Asia/Tokyo",
            false,
            1_700_000_120,
        )
        .unwrap();
        assert_eq!(status, "mismatch");
        assert_eq!(drifted.registered_country.as_deref(), Some("US"));
        assert_eq!(drifted.last_probe_country.as_deref(), Some("JP"));

        // Explicit lock_current=true updates registered_country/timezone to current exit.
        let (relocked, status) = apply_probe_outcome(
            drifted,
            "JP",
            "Asia/Tokyo",
            true,
            1_700_000_180,
        )
        .unwrap();
        assert_eq!(status, "locked_initial");
        assert_eq!(relocked.registered_country.as_deref(), Some("JP"));
        assert_eq!(relocked.registered_timezone.as_deref(), Some("Asia/Tokyo"));

        // Update semantics: None preserves, Some(non-empty) updates, Some("") clears.
        let preserved = apply_card_update(
            relocked.clone(),
            "Updated Name".into(),
            relocked.email.clone(),
            relocked.note.clone(),
            WarmingStage::ProReady,
            relocked.created_ymd.clone(),
            None,
            None,
            200,
        )
        .unwrap();
        assert_eq!(preserved.registered_country.as_deref(), Some("JP"));
        assert_eq!(preserved.registered_timezone.as_deref(), Some("Asia/Tokyo"));

        let updated = apply_card_update(
            preserved,
            "Updated Name".into(),
            None,
            None,
            WarmingStage::ProReady,
            "2026-10-20".into(),
            Some(" gb ".into()),
            Some(" Europe/London ".into()),
            201,
        )
        .unwrap();
        assert_eq!(updated.registered_country.as_deref(), Some("GB"));
        assert_eq!(updated.registered_timezone.as_deref(), Some("Europe/London"));

        let cleared = apply_card_update(
            updated,
            "Updated Name".into(),
            None,
            None,
            WarmingStage::ProReady,
            "2026-10-20".into(),
            Some("   ".into()),
            Some("".into()),
            202,
        )
        .unwrap();
        assert_eq!(cleared.registered_country, None);
        assert_eq!(cleared.registered_timezone, None);

        // Invalid country or timezone values are rejected.
        for bad_country in ["USA", "1", "U1", "中国"] {
            let mut bad = card();
            bad.registered_country = Some(bad_country.into());
            assert!(normalize(bad).is_err());
        }
        for bad_tz in ["America/New York", &"a".repeat(65)] {
            let mut bad = card();
            bad.registered_timezone = Some(bad_tz.into());
            assert!(normalize(bad).is_err());
        }
    }
}
