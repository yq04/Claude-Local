// [INPUT]: 身份 SQLite 绑定、smart_relay_v1.json 槽位代理、独立浏览器根目录、受限配置和用户确认后的切换事务。
// [OUTPUT]: 强制 32-hex `contexts/<slot_id>` 隔离资料（`isolated_slot_path` 拒认 `"legacy"` 且保留既有老资料不回写）与非零随机种子兜底、经 `Cleaner < SlotGate(字典序) < Browser::gate` 协调的两阶段 `transition`/`switch_warming_browser`/`detach_warming_browser`/`delete_saved`（取消启动前过早清除 Kill-Switch 告警）、按需具化并自愈槽位、只读槽位代理快照与同步，以及单/双重故障恢复阻断。
// [POS]: 身份与浏览器的协调边界；资料不压缩、不复制、不合并 Cookie，失败状态如实返回。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use crate::identities::{browser_link, database::Database, private};

pub(super) fn database(root: &Path) -> Result<Database, String> {
    Database::open(
        &root
            .parent()
            .ok_or("应用目录不可用。")?
            .join("identity-vault"),
    )
}
pub(super) fn slot_path(root: &Path, slot: &str) -> Result<PathBuf, String> {
    if !browser_link::valid_slot(slot) {
        return Err("浏览器资料选择无效。".into());
    }
    let path = if slot == "legacy" {
        root.to_path_buf()
    } else {
        root.join("contexts").join(slot)
    };
    profile::check_path(root, &path)?;
    Ok(path)
}

pub(super) fn isolated_slot_path(root: &Path, slot: &str) -> Result<PathBuf, String> {
    if !crate::identities::valid_id(slot) {
        return Err("浏览器资料选择无效。".into());
    }
    let path = root.join("contexts").join(slot);
    profile::check_path(root, &path)?;
    Ok(path)
}
pub(super) fn scope(root: &Path) -> Result<PathBuf, String> {
    slot_path(root, &database(root)?.browser_slot()?)
}
/// Runtime sampling must not call Database::open: it initializes schemas and
/// ACLs. Read the two selection fields from one read-only SQLite snapshot.
pub(super) fn selected_slot_readonly(root: &Path) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    let vault = root
        .parent()
        .ok_or("应用目录不可用。")?
        .join("identity-vault");
    let path = vault.join("identities.sqlite");
    private::parents(&vault)?;
    private::safe(&path)?;
    let mut connection = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法读取浏览器选择。")?;
    connection
        .busy_timeout(std::time::Duration::from_millis(100))
        .map_err(|_| "无法读取浏览器选择。")?;
    let tx = connection
        .transaction()
        .map_err(|_| "无法读取浏览器选择。")?;
    let read = |key: &str| {
        tx.query_row("SELECT value FROM state WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "无法读取浏览器选择。".to_string())
    };
    let slot = read("browser.active")?.ok_or("浏览器资料选择无效。")?;
    if !browser_link::valid_slot(&slot) {
        return Err("浏览器资料选择无效。".into());
    }
    Ok(slot)
}
/// Existing-profile return/rollback changes only the selection, never enabled,
/// draft, promotion, CLI active, bindings or seeds. Compare the old pointer in
/// the same transaction so a later native selection is not overwritten.
pub(super) fn select_existing_slot(root: &Path, expected: &str, next: &str) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    if !browser_link::valid_slot(expected) || !browser_link::valid_slot(next) {
        return Err("浏览器资料选择无效。".into());
    }
    let vault = root
        .parent()
        .ok_or("应用目录不可用。")?
        .join("identity-vault");
    let path = vault.join("identities.sqlite");
    private::parents(&vault)?;
    private::safe(&path)?;
    let mut connection = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法更新浏览器选择。")?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "无法更新浏览器选择。")?;
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| "无法更新浏览器选择。")?;
    let read = |key: &str| {
        tx.query_row("SELECT value FROM state WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "无法更新浏览器选择。".to_string())
    };
    if read("recovery")?.is_some()
        || read("browser.promotion")?.is_some()
        || read("browser.enabled")?.as_deref() != Some("1")
        || read("browser.active")?.as_deref() != Some(expected)
    {
        return Err("浏览器资料选择已变化，请刷新后重试。".into());
    }
    tx.execute(
        "UPDATE state SET value=?1 WHERE key='browser.active'",
        [next],
    )
    .map_err(|_| "无法更新浏览器选择。")?;
    tx.commit().map_err(|_| "无法更新浏览器选择。".into())
}
pub(super) fn ready(root: &Path) -> Result<(), String> {
    if database(root)?.get("recovery")?.is_some() {
        return Err("浏览器保持关闭，请先恢复身份切换。".into());
    }
    Ok(())
}
pub(super) fn ensure(root: &Path) -> Result<PathBuf, String> {
    let db = database(root)?;
    if db.get("recovery")?.is_some() {
        return Err("浏览器保持关闭，请先恢复身份切换。".into());
    }
    let slot = db.browser_slot()?;
    ensure_slot(root, &db, &slot)
}
fn convert_loopback_http_to_socks5(http_proxy: &str) -> Option<String> {
    let url = reqwest::Url::parse(http_proxy.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host_raw = url.host_str()?;
    let host_clean = host_raw.trim_matches(['[', ']']);
    if !(host_clean == "127.0.0.1"
        || host_clean == "::1"
        || host_clean.eq_ignore_ascii_case("localhost"))
    {
        return None;
    }
    let port = url.port_or_known_default()?;
    if port == 0 {
        return None;
    }
    let candidate = format!("socks5://127.0.0.1:{port}");
    config::proxy(&candidate).ok().flatten().map(|_| candidate)
}

fn find_consensus_context_donor(root: &Path, skip_slot: &str) -> Option<config::Config> {
    let contexts = root.join("contexts");
    let entries = fs::read_dir(&contexts).ok()?;
    let mut donor: Option<config::Config> = None;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(slot_name) = name.to_str() else {
            continue;
        };
        if slot_name == skip_slot || !browser_link::valid_slot(slot_name) {
            continue;
        }
        let cfg_path = entry.path().join("config.json");
        if !cfg_path.is_file() {
            continue;
        }
        let Ok(cfg) = config::load(&entry.path()) else {
            continue;
        };
        if cfg.proxy.trim().is_empty() {
            continue;
        }
        match &donor {
            None => donor = Some(cfg),
            Some(prev) if prev.proxy.trim() == cfg.proxy.trim() => {}
            Some(_) => return None,
        }
    }
    donor
}

fn cli_http_proxy_to_browser_socks5(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return None;
    }
    let host_raw = url.host_str()?.trim_matches(['[', ']']);
    if host_raw.is_empty() {
        return None;
    }
    let host = if host_raw.eq_ignore_ascii_case("localhost") || host_raw == "::1" {
        "127.0.0.1".to_string()
    } else if host_raw.contains(':') {
        format!("[{host_raw}]")
    } else {
        host_raw.to_ascii_lowercase()
    };
    let port = url.port_or_known_default()?;
    if port == 0 {
        return None;
    }
    let candidate = format!("socks5://{host}:{port}");
    config::proxy(&candidate).ok().flatten().map(|_| candidate)
}

fn sanitize_browser_proxy(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Ok(url) = reqwest::Url::parse(trimmed) else {
        return String::new();
    };
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") {
        return String::new();
    }
    let Some(host_raw) = url.host_str() else {
        return String::new();
    };
    let clean_host = host_raw.trim_matches(['[', ']']);
    let host = if clean_host.eq_ignore_ascii_case("localhost") || clean_host == "::1" {
        "127.0.0.1".to_string()
    } else if clean_host.contains(':') {
        format!("[{clean_host}]")
    } else {
        clean_host.to_ascii_lowercase()
    };
    let Some(port) = url.port_or_known_default() else {
        return String::new();
    };
    if port == 0 {
        return String::new();
    }
    format!("{}://{host}:{port}", url.scheme())
}

pub(super) fn to_browser_proxy_from_raw(raw: &str) -> Option<String> {
    if let Some(socks) = convert_loopback_http_to_socks5(raw) {
        return Some(socks);
    }
    if let Some(socks) = cli_http_proxy_to_browser_socks5(raw) {
        return Some(socks);
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = if let Some(rest) = config::strip_prefix_ascii_ci(trimmed, "socks5h://") {
        format!("socks5://{rest}")
    } else {
        trimmed.to_string()
    };
    config::proxy(&normalized)
        .ok()
        .flatten()
        .map(|_| normalized)
}

fn is_loopback_browser_proxy(raw: &str) -> bool {
    let Some(url) = config::proxy(raw.trim()).ok().flatten() else {
        return false;
    };
    let Some(host_raw) = url.host_str() else {
        return false;
    };
    let host = host_raw.trim_matches(['[', ']']);
    host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")
}

fn resolve_slot_owner_id(root: &Path, slot: &str) -> Option<String> {
    let vault = root.parent()?.join("identity-vault");
    let db_path = vault.join("identities.sqlite");
    private::safe(&db_path).ok()?;
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(100));
    conn.query_row(
        "SELECT identity FROM browser_bindings WHERE slot=?1 LIMIT 1",
        [slot],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|id| crate::identities::valid_id(id))
}

fn read_smart_relay_slot_proxy(root: &Path, owner_id: &str) -> Option<String> {
    let relay_path = root.parent()?.join("smart_relay_v1.json");
    let meta = fs::symlink_metadata(&relay_path).ok()?;
    if crate::cleaner::linked(&meta) || !meta.is_file() || meta.len() > 128 * 1024 {
        return None;
    }
    let bytes = fs::read(&relay_path).ok()?;
    let val: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let raw = val
        .get("slotProxies")
        .or_else(|| val.get("slot_proxies"))
        .and_then(|m| m.get(owner_id))
        .and_then(|v| v.as_str())?;
    to_browser_proxy_from_raw(raw)
}

fn find_active_or_consensus_donor(
    root: &Path,
    db: &Database,
    slot: &str,
) -> Option<config::Config> {
    db.browser_slot()
        .ok()
        .filter(|active| active != slot && active != "legacy")
        .and_then(|active| slot_path(root, &active).ok())
        .filter(|scope| scope.join("config.json").is_file())
        .and_then(|scope| config::load(&scope).ok())
        .filter(|cfg| !cfg.proxy.trim().is_empty())
        .or_else(|| find_consensus_context_donor(root, slot))
}

fn sanitize_non_restricted_locale(cfg: &mut config::Config) {
    let lang_low = cfg.language.trim().to_ascii_lowercase();
    if lang_low.is_empty() || lang_low.starts_with("zh") || lang_low.starts_with("ru") {
        cfg.language = "en-US".into();
    }
    let tz_restricted = cfg.timezone.trim().is_empty()
        || crate::regions::timezone_country(&cfg.timezone)
            .is_some_and(crate::regions::is_unsupported_exit_country);
    if tz_restricted {
        cfg.timezone = "America/New_York".into();
    }
}

pub(super) fn ensure_slot_with_home(
    root: &Path,
    db: &Database,
    slot: &str,
    claude_home: Option<&Path>,
) -> Result<PathBuf, String> {
    let host_restricted = config::machine()
        .ok()
        .is_some_and(|m| config::machine_is_restricted_region(&m));
    ensure_slot_with_home_and_policy(root, db, slot, claude_home, host_restricted)
}

pub(super) fn ensure_slot_with_home_and_policy(
    root: &Path,
    db: &Database,
    slot: &str,
    claude_home: Option<&Path>,
    host_restricted: bool,
) -> Result<PathBuf, String> {
    let path = slot_path(root, slot)?;
    private::directory(&path)?;
    let seed = match db.browser_seed(slot)? {
        Some(seed) => seed,
        None => browser_link::seed(&db.browser_draft()?.unwrap_or_else(|| slot.to_string()), 0).max(1),
    };
    let stamp = path.join("seed.owner");
    profile::check_path(root, &stamp)?;
    let bound = db.browser_link()?.enabled;
    let first = !path.join("config.json").exists();
    if first || (bound && fs::read_to_string(&stamp).ok().as_deref() != Some(&seed.to_string())) {
        let mut config = if first && slot != "legacy" {
            let root_cfg = config::load(root)?;
            let mut base = root_cfg.clone();
            let donor = find_active_or_consensus_donor(root, db, slot);
            let slot_proxy = resolve_slot_owner_id(root, slot)
                .and_then(|owner| read_smart_relay_slot_proxy(root, &owner));
            if let Some(ref active_cfg) = donor {
                base.follow_machine = active_cfg.follow_machine;
                base.language = active_cfg.language.clone();
                base.timezone = active_cfg.timezone.clone();
                base.native_graphics = active_cfg.native_graphics;
            }
            let claude_socks = claude_home
                .and_then(|home| crate::identities::read_claude_dir_http_proxy(&home.join(".claude")))
                .and_then(|http_proxy| cli_http_proxy_to_browser_socks5(&http_proxy));
            if let Some(sp) = slot_proxy {
                base.proxy = sp;
            } else if let Some(cs) = claude_socks {
                base.proxy = cs;
            } else if !root_cfg.proxy.trim().is_empty() {
                base.proxy = root_cfg.proxy;
            } else if let Some(active_cfg) = donor {
                base.proxy = active_cfg.proxy;
            }
            if host_restricted && base.follow_machine {
                base.follow_machine = false;
                sanitize_non_restricted_locale(&mut base);
            }
            base
        } else {
            config::load(&path)?
        };
        if bound {
            config.seed = seed;
        } else if config.seed == 0 {
            config.seed = config::random_seed()?;
        }
        config::save(&path, &config)?;
        if bound {
            private::write(&stamp, seed.to_string().as_bytes())?;
        }
    } else if slot != "legacy" && !profile::running(&path.join("profile")).unwrap_or(false) {
        if let Ok(mut existing) = config::load(&path) {
            let mut dirty = false;
            if existing.seed == 0 {
                existing.seed = if bound {
                    seed
                } else {
                    config::random_seed()?
                };
                dirty = true;
            }
            let donor = find_active_or_consensus_donor(root, db, slot);
            let slot_proxy = resolve_slot_owner_id(root, slot)
                .and_then(|owner| read_smart_relay_slot_proxy(root, &owner));
            if let Some(sp) = slot_proxy {
                if existing.proxy != sp {
                    existing.proxy = sp;
                    dirty = true;
                }
            } else if existing.proxy.trim().is_empty() {
                let candidate = claude_home
                    .and_then(|home| {
                        crate::identities::read_claude_dir_http_proxy(&home.join(".claude"))
                    })
                    .and_then(|hp| cli_http_proxy_to_browser_socks5(&hp))
                    .or_else(|| {
                        donor
                            .as_ref()
                            .map(|d| d.proxy.clone())
                            .filter(|p| is_loopback_browser_proxy(p))
                    })
                    .or_else(|| {
                        config::load(root)
                            .ok()
                            .map(|r| r.proxy)
                            .filter(|p| is_loopback_browser_proxy(p))
                    });
                if let Some(healed_proxy) = candidate {
                    existing.proxy = healed_proxy;
                    dirty = true;
                }
            }
            if existing.follow_machine && host_restricted {
                if let Some(ref d) = donor {
                    if !d.follow_machine {
                        existing.follow_machine = false;
                        existing.language = d.language.clone();
                        existing.timezone = d.timezone.clone();
                        dirty = true;
                    }
                }
                if existing.follow_machine {
                    existing.follow_machine = false;
                    sanitize_non_restricted_locale(&mut existing);
                    dirty = true;
                }
            }
            if dirty {
                config::save(&path, &existing)?;
            }
        }
    }
    private::directory(&path.join("profile"))?;
    Ok(path)
}

pub(super) fn ensure_slot(root: &Path, db: &Database, slot: &str) -> Result<PathBuf, String> {
    let claude_home = if cfg!(test) {
        None
    } else {
        crate::cleaner::identity::root().ok()
    };
    ensure_slot_with_home(root, db, slot, claude_home.as_deref())
}
pub(crate) fn bound_slot_browser_proxies(
    browser_root: &Path,
    db: &Database,
    records: &[crate::identities::database::Record],
) -> std::collections::BTreeMap<String, crate::identities::SlotBrowserProxy> {
    let mut out = std::collections::BTreeMap::new();
    if !browser_root.is_dir() {
        return out;
    }
    let mut running_slots: Option<std::collections::HashSet<String>> = None;
    for rec in records {
        if rec.empty {
            continue;
        }
        let Ok(Some(slot)) = db.browser_for(&rec.id) else {
            continue;
        };
        let Ok(scope) = slot_path(browser_root, &slot) else {
            continue;
        };
        if !scope.join("config.json").is_file() {
            continue;
        }
        let Ok(cfg) = config::load(&scope) else {
            continue;
        };
        let running_set = running_slots.get_or_insert_with(|| {
            super::kill_switch::running_managed_profiles(browser_root)
                .into_iter()
                .map(|(s, _)| s)
                .collect()
        });
        out.insert(
            rec.id.clone(),
            crate::identities::SlotBrowserProxy {
                proxy: sanitize_browser_proxy(&cfg.proxy),
                running: running_set.contains(&slot),
            },
        );
    }
    out
}

pub(super) fn sync_identity_browser_proxy_in(
    browser_root: &Path,
    app_data_dir: &Path,
    claude_home: &Path,
    id: &str,
    is_running: &dyn Fn(&Path) -> Result<bool, String>,
) -> Result<(String, bool, bool), String> {
    if !crate::identities::valid_id(id) {
        return Err("身份编号无效。".into());
    }
    let mut db = database(browser_root)?;
    if db.get("recovery")?.is_some() {
        return Err("请先恢复未完成的身份切换。".into());
    }
    let exists = db.records()?.into_iter().any(|r| !r.empty && r.id == id);
    if !exists {
        return Err("未找到目标身份记录。".into());
    }
    let slot = match db.browser_for(id)? {
        Some(s) => s,
        None if db.browser_link()?.enabled => db.ensure_identity_binding(id)?.0,
        None => return Err("未开启独立浏览器资料联动。".into()),
    };
    let scope = slot_path(browser_root, &slot)?;
    let profile_dir = scope.join("profile");
    profile::check_path(browser_root, &profile_dir)?;
    if is_running(&profile_dir)? {
        return Err("该身份绑定的浏览器正在运行，请先退出浏览器后再同步代理。".into());
    }
    ensure_slot_with_home(browser_root, &db, &slot, Some(claude_home))?;
    let relay_cfg = crate::identities::orchestrator::load_config(app_data_dir);
    let effective_http = relay_cfg
        .slot_proxies
        .get(id)
        .and_then(|raw| crate::identities::orchestrator::config::normalize_proxy_to_http(raw))
        .or_else(|| crate::identities::read_claude_dir_http_proxy(&claude_home.join(".claude")));
    let target_proxy = match effective_http {
        Some(ref http) => cli_http_proxy_to_browser_socks5(http)
            .ok_or_else(|| "CLI 代理地址格式无效，无法同步到浏览器。".to_string())?,
        None => String::new(),
    };
    let mut cfg = config::load(&scope)?;
    let changed = cfg.proxy != target_proxy;
    if changed {
        cfg.proxy = target_proxy;
        config::save(&scope, &cfg)?;
    }
    let is_active = db.browser_slot()? == slot;
    Ok((slot, changed, is_active))
}

pub(crate) fn ensure_identity_slot(root: &Path, owner_id: &str) -> Result<PathBuf, String> {
    let mut db = database(root)?;
    if db.get("recovery")?.is_some() {
        return Err("quotaOnline.busy".into());
    }
    if !db.browser_link()?.enabled {
        return Err("quotaOnline.unavailable".into());
    }
    let (slot, _) = db.ensure_identity_binding(owner_id)?;
    isolated_slot_path(root, &slot)?;
    ensure_slot(root, &db, &slot)
}
pub(super) fn block(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    private::directory(root)?;
    private::write(&root.join("identity-switch.pending"), b"1")?;
    *app.state::<Browser>().session.lock().unwrap() = None;
    *app.state::<Browser>().host.lock().unwrap() = None;
    forget_start_url(app);
    Ok(())
}
pub(super) fn unblock(root: &Path) -> Result<(), String> {
    let path = root.join("identity-switch.pending");
    profile::check_path(root, &path)?;
    match fs::remove_file(&path) {
        Ok(()) => {
            private::sync_parent(&path);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法更新浏览器启动状态。".into()),
    }
}
pub(crate) fn identity_action(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, false, false, action)
}
pub(crate) fn switch_identity(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, false, true, action)
}
/// Promotion deliberately transfers the warming browser into the CLI workflow.
/// Force coordination before prepare_warming_promotion installs its marker.
pub(crate) fn promote_warming_identity(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    transition(app, reporter, true, true, action)
}
/// Caller holds Cleaner short gate; lock order is always Cleaner < SlotGate(字典序) < Browser::gate.
pub(crate) fn switch_warming_browser(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    slot: &str,
    open_mode: &str,
) -> Result<(), String> {
    validate_warming_open_mode(open_mode)?;
    if !crate::identities::valid_id(slot) {
        return Err("浏览器资料选择无效。".into());
    }
    let browser = app.state::<Browser>();
    let root = root(app)?;
    let target_slot = slot.to_string();
    browser.with_slots_then_gate(
        || {
            let previous = database(&root)?.browser_slot()?;
            Ok(vec![previous, target_slot.clone()])
        },
        || switch_browser_locked(app, reporter, &target_slot, open_mode, false),
    )
}
/// Detach a selected warming card before deletion, retaining its data until the
/// separately confirmed delete_saved action. Caller owns Cleaner short gate.
pub(crate) fn detach_warming_browser(
    app: &tauri::AppHandle,
    reporter: &Reporter,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let root = root(app)?;
    {
        let _guard = browser.gate.lock().unwrap();
        ready(&root)?;
    }
    let fresh_slot = {
        let _guard = browser.gate.lock().unwrap();
        let db = database(&root)?;
        fresh_browser_slot(&root, &db)?
    };
    browser.with_slots_then_gate(
        || {
            let previous = database(&root)?.browser_slot()?;
            Ok(vec![previous, fresh_slot.clone()])
        },
        || switch_browser_locked(app, reporter, &fresh_slot, "switch_only", true),
    )
}
pub(super) fn fresh_browser_slot(root: &Path, db: &Database) -> Result<String, String> {
    if db.get("recovery")?.is_some() {
        return Err("请先恢复未完成的身份切换。".into());
    }
    for _ in 0..128 {
        let slot = crate::identities::new_id()?;
        if slot == db.browser_slot()? || db.browser_seed(&slot)?.is_some() {
            continue;
        }
        match fs::symlink_metadata(slot_path(root, &slot)?) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(slot),
            Ok(_) => continue,
            Err(_) => return Err("无法检查新浏览器资料目录。".into()),
        }
    }
    Err("无法分配新的空浏览器资料。".into())
}
/// Browser gate is already held; both paths perform identical process/session
/// transitions. Fresh detach slots must be unbound and absent before old quit.
fn switch_browser_locked(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    slot: &str,
    open_mode: &str,
    fresh: bool,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let root = root(app)?;
    ready(&root)?;
    let mut db = database(&root)?;
    // Refuse an unbound scope before stopping the existing browser.
    if fresh {
        if !crate::identities::valid_id(slot) || db.browser_seed(slot)?.is_some() {
            return Err("新浏览器资料选择无效。".into());
        }
        match fs::symlink_metadata(slot_path(&root, slot)?) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => return Err("新浏览器资料目录已存在或无法检查。".into()),
        }
    } else if db.browser_seed(slot)?.is_none() {
        return Err("养号浏览器绑定不存在。".into());
    }
    let previous = db.browser_slot()?;
    if previous != slot {
        let old_profile = slot_path(&root, &previous)?.join("profile");
        block(app, &root)?;
        reporter.log("browser", "running", "正在正常退出旧浏览器资料。", 0, None);
        if let Err(error) = profile::quit(&old_profile) {
            let _ = refresh_launch_args(app);
            return Err(error);
        }
        reporter.log("browser", "ok", "旧浏览器资料已退出。", 1, Some(1));
    }
    if let Err(error) = db.switch_browser_slot_only(slot) {
        let _ = refresh_launch_args(app);
        return Err(error);
    }
    *browser.warning.lock().unwrap() = None;
    ensure(&root)?;
    refresh_launch_args(app)?;
    match open_mode {
        "claude_ai" => {
            launch_with_urls_locked(app, reporter, &["https://claude.ai/new"])?;
        }
        "verify" => {
            launch_locked(app, reporter)?;
        }
        "switch_only" => {
            renew_session(app);
        }
        _ => unreachable!(),
    }
    reporter.log(
        "browser",
        "ok",
        "养号浏览器资料已同步，CLI 身份保持不变。",
        1,
        Some(1),
    );
    Ok(())
}
pub(super) fn validate_warming_open_mode(open_mode: &str) -> Result<(), String> {
    match open_mode {
        "claude_ai" | "verify" | "switch_only" => Ok(()),
        _ => Err("养号浏览器打开方式无效。".into()),
    }
}
pub(crate) fn delete_saved(
    app: &tauri::AppHandle,
    id: &str,
    remove_profile: bool,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let root = root(app)?;
    let existing_slot = {
        let _guard = browser.gate.lock().unwrap();
        database(&root)?.browser_for(id)?
    };
    let run_delete = || -> Result<(), String> {
        let db = database(&root)?;
        let slot = db.browser_for(id)?;
        if remove_profile {
            if let Some(slot) = slot.as_deref() {
                if slot == db.browser_slot()? {
                    return Err("关联浏览器资料正在使用，不能删除。".into());
                }
                let path = slot_path(&root, slot)?.join("profile");
                if profile::running(&path)? {
                    return Err("关联浏览器资料正在使用，不能删除。".into());
                }
            }
        }
        action()?;
        if remove_profile {
            if let Some(slot) = slot {
                let scope = slot_path(&root, &slot)?;
                let target = if slot == "legacy" {
                    scope.join("profile")
                } else {
                    scope
                };
                profile::check_path(&root, &target)?;
                if target.exists() {
                    private::safe(&target)?;
                    fs::remove_dir_all(&target)
                        .map_err(|_| "身份已删除，关联浏览器资料未完全删除，请检查。")?;
                }
            }
        }
        Ok(())
    };
    if existing_slot.is_some() {
        browser.with_slot_then_gate(
            || {
                database(&root)?
                    .browser_for(id)?
                    .ok_or_else(|| "浏览器身份绑定状态已变化，请重试。".to_string())
            },
            |_| run_delete(),
        )
    } else {
        let mut guard = Some(browser.gate.lock().unwrap());
        if database(&root)?.browser_for(id)?.is_some() {
            drop(guard.take());
            return browser.with_slot_then_gate(
                || {
                    database(&root)?
                        .browser_for(id)?
                        .ok_or_else(|| "浏览器身份绑定状态已变化，请重试。".to_string())
                },
                |_| run_delete(),
            );
        }
        let _guard = guard;
        run_delete()
    }
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TransitionMode {
    Unlinked,
    PreserveWarming,
    Coordinate,
}
/// This is the production decision, also exercised with synthetic databases.
/// Recovery and explicit promotion/configuration never bypass browser safety.
pub(super) fn transition_mode(db: &Database, force: bool) -> Result<TransitionMode, String> {
    if force || db.get("recovery")?.is_some() || db.get("browser.promotion")?.is_some() {
        return Ok(TransitionMode::Coordinate);
    }
    if !db.browser_link()?.enabled {
        return Ok(TransitionMode::Unlinked);
    }
    if db.current_browser_is_warming()? {
        return Ok(TransitionMode::PreserveWarming);
    }
    Ok(TransitionMode::Coordinate)
}
fn quit_if_running(
    profile: &Path,
    was_running: bool,
    reporter: &Reporter,
) -> Result<(), String> {
    if was_running {
        reporter.log("browser", "running", "正在正常退出关联浏览器。", 0, None);
        profile::quit(profile)?;
        reporter.log("browser", "ok", "关联浏览器已退出。", 1, Some(1));
    } else {
        reporter.log(
            "browser",
            "ok",
            "关联浏览器未运行，跳过退出并保持关闭。",
            1,
            Some(1),
        );
    }
    Ok(())
}
pub(super) fn transition(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    force: bool,
    launch_on_linked: bool,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let browser = app.state::<Browser>();
    let root = root(app)?;
    let mut action = Some(action);
    enum PhaseOne {
        Done(Result<(), String>),
        Coordinate {
            was_running: bool,
            result: Result<(), String>,
        },
    }
    let phase_one = browser.with_active_slot_gate(
        || database(&root)?.browser_slot(),
        |expected_slot, gate| {
            let _guard = gate.lock().unwrap();
            if database(&root)?.browser_slot()? != expected_slot {
                return Ok((false, PhaseOne::Done(Ok(()))));
            }
            let run_action = action
                .take()
                .ok_or_else(|| "浏览器状态切换事务重复执行。".to_string())?;
            match transition_mode(&database(&root)?, force)? {
                TransitionMode::Unlinked => return Ok((true, PhaseOne::Done(run_action()))),
                TransitionMode::PreserveWarming => {
                    let selected = scope(&root)?;
                    let result = run_action();
                    // Successful CLI work leaves the browser session, launch.args and
                    // live profile untouched. An unresolved failure still quarantines
                    // the browser until the existing recovery transaction is resolved.
                    let safety: Result<(), String> = (|| {
                        if database(&root)?.get("recovery")?.is_some() {
                            block(app, &root)?;
                            *browser.warning.lock().unwrap() =
                                Some("浏览器保持关闭，请先恢复身份切换。".into());
                            let prof = selected.join("profile");
                            if profile::running(&prof)? {
                                reporter.log(
                                    "browser",
                                    "running",
                                    "正在正常退出关联浏览器。",
                                    0,
                                    None,
                                );
                                profile::quit(&prof)?;
                            }
                        }
                        Ok(())
                    })();
                    if let Err(error) = &safety {
                        reporter.log("browser", "error", error, 0, None);
                    }
                    return Ok((true, PhaseOne::Done(result.and(safety))));
                }
                TransitionMode::Coordinate => (),
            }
            *browser.warning.lock().unwrap() = None;
            let profile = scope(&root)?.join("profile");
            let was_running = profile::running(&profile)?;
            block(app, &root)?;
            if let Err(error) = quit_if_running(&profile, was_running, reporter) {
                let _ = refresh_launch_args(app);
                return Err(error);
            }
            let result = run_action();
            Ok((
                true,
                PhaseOne::Coordinate {
                    was_running,
                    result,
                },
            ))
        },
    )?;
    let (was_running, result) = match phase_one {
        PhaseOne::Done(res) => return res,
        PhaseOne::Coordinate {
            was_running,
            result,
        } => (was_running, result),
    };
    let finish = browser.with_active_slot_gate(
        || database(&root)?.browser_slot(),
        |expected_slot, gate| {
            let _guard = gate.lock().unwrap();
            if database(&root)?.browser_slot()? != expected_slot {
                return Ok((false, ()));
            }
            reporter.log("browser", "running", "正在同步关联浏览器资料。", 0, None);
            refresh_launch_args(app)?;
            let db = database(&root)?;
            let should_reopen = if result.is_ok() {
                was_running || launch_on_linked
            } else {
                was_running && db.get("recovery")?.is_none()
            };
            if should_reopen && db.browser_link()?.enabled {
                launch_locked(app, reporter)?;
            }
            Ok((true, ()))
        },
    );
    if let Err(error) = finish {
        let in_recovery = {
            let _guard = browser.gate.lock().unwrap();
            database(&root)?.get("recovery")?.is_some()
        };
        let warning = if in_recovery {
            "浏览器保持关闭，请先恢复身份切换。"
        } else {
            "身份状态已保存，浏览器未能重开；请重试打开浏览器。"
        };
        *browser.warning.lock().unwrap() = Some(warning.into());
        if in_recovery || result.is_err() {
            reporter.log("browser", "error", &error, 0, None);
        } else {
            reporter.log("browser", "warning", warning, 0, None);
        }
    } else {
        reporter.log("browser", "ok", "浏览器资料已与身份同步。", 1, Some(1));
    }
    result
}

#[cfg(test)]
mod slot_inheritance_tests {
    use super::*;

    #[test]
    fn secondary_slot_inherits_active_proxy_and_region_while_keeping_distinct_seed() {
        let fixture = super::super::tests::sample();
        let root = fixture.join("browser");
        private::directory(&root).unwrap();
        let mut db = database(&root).unwrap();
        let id_a = crate::identities::new_id().unwrap();
        let id_b = crate::identities::new_id().unwrap();
        for (id, name) in [(&id_a, "Acct A"), (&id_b, "Acct B")] {
            let rec = crate::identities::database::Record {
                id: id.clone(),
                name: name.into(),
                archive: format!("{id}.baga"),
                saved_at: 1,
                bytes: 1,
                policy: crate::identities::Policy::default(),
                empty: false,
                account_key: None,
            };
            db.pending(&rec, "empty").unwrap();
            db.complete(&rec.id).unwrap();
        }
        db.configure_browser(true, false, Some(&id_a)).unwrap();
        let scope_a = ensure(&root).unwrap();
        let seed_a = config::load(&scope_a).unwrap().seed;
        let mut aligned = config::load(&scope_a).unwrap();
        aligned.proxy = "socks5://127.0.0.1:7899".into();
        aligned.follow_machine = false;
        aligned.language = "en-US".into();
        aligned.timezone = "America/Los_Angeles".into();
        aligned.native_graphics = false;
        config::save(&scope_a, &aligned).unwrap();

        // Case 1: Materializing B via ensure_identity_slot while A remains active
        let scope_b = ensure_identity_slot(&root, &id_b).unwrap();
        let cfg_b = config::load(&scope_b).unwrap();
        assert_eq!(cfg_b.proxy, "socks5://127.0.0.1:7899");
        assert!(!cfg_b.follow_machine);
        assert_eq!(cfg_b.language, "en-US");
        assert_eq!(cfg_b.timezone, "America/Los_Angeles");
        assert!(!cfg_b.native_graphics);
        assert_ne!(cfg_b.seed, seed_a);

        // Case 2: Fallback from ~/.claude/settings.json loopback HTTP proxy -> socks5://
        let fixture2 = super::super::tests::sample();
        let root2 = fixture2.join("browser");
        let home2 = fixture2.join("home");
        private::directory(&root2).unwrap();
        private::directory(&home2.join(".claude")).unwrap();
        fs::write(
            home2.join(".claude/settings.json"),
            br#"{"env":{"HTTPS_PROXY":"http://127.0.0.1:7899"}}"#,
        )
        .unwrap();
        let mut db2 = database(&root2).unwrap();
        let id_c = crate::identities::new_id().unwrap();
        db2.configure_browser(true, false, Some(&id_c)).unwrap();
        let slot_c = db2.browser_slot().unwrap();
        let scope_c = ensure_slot_with_home(&root2, &db2, &slot_c, Some(&home2)).unwrap();
        assert_eq!(config::load(&scope_c).unwrap().proxy, "socks5://127.0.0.1:7899");

        drop(db);
        drop(db2);
        let _ = fs::remove_dir_all(fixture);
        let _ = fs::remove_dir_all(fixture2);
    }

    #[test]
    fn transition_skips_quit_when_browser_is_not_running() {
        let fixture = super::super::tests::sample();
        let prof = fixture.join("profile");
        private::directory(&prof).unwrap();
        let reporter = Reporter::channel(None);
        quit_if_running(&prof, false, &reporter).unwrap();
        let events = reporter.events();
        assert!(events
            .iter()
            .any(|e| e.stage() == "browser"
                && e.status() == "ok"
                && e.message() == "关联浏览器未运行，跳过退出并保持关闭。"));
        assert!(!events
            .iter()
            .any(|e| e.message().contains("正在正常退出关联浏览器")
                || e.message().contains("关联浏览器已退出")));
        let _ = fs::remove_dir_all(fixture);
    }
}
