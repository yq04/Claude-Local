// [INPUT]: 本机指纹引擎（优先 /Applications/Claude-Local Browser.app，回退 ~/Applications）、本地版浏览器包标识、配置/资料边界、真实浏览器观测、宿主界面语言与共享操作日志。
// [OUTPUT]: 有界 CLI/养号绑定上下文、只读所选资料窗口状态、严格无环偏序 `Cleaner < SlotGate(字典序) < Browser::gate < LeafMutexes` 闭锁原语（`with_slot_then_gate` / `with_slots_then_gate` / `with_active_slot_gate`）、含 `enable_quota_bridge` 的 LaunchedSlotSnapshot（launch.snapshot.json）、`LaunchPurpose::Verification` 写参、无阻塞 launch/quit/open_usage 编排、按槽位与配置绑定的核验结果记忆、伴生浏览器异常断流急停状态、冻结CLI归属的返回/用量页及转正/恢复编排。
// [POS]: 独立浏览器模块的唯一编排入口；改变资料前必须退出浏览器；不自行改系统默认浏览器，只发起系统确认。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) mod config;
pub(crate) mod kill_switch;
mod launch;
pub(crate) mod lifecycle;
pub(crate) mod network;
#[cfg(target_os = "windows")]
mod oauth_route;
mod profile;
mod workspaces;
use launch::{launch_locked, launch_with_urls_locked};
pub(crate) use workspaces::bound_slot_browser_proxies;
pub(crate) use workspaces::delete_saved;
pub(crate) use workspaces::detach_warming_browser;
pub(crate) use workspaces::identity_action;
pub(crate) use workspaces::promote_warming_identity;
pub(crate) use workspaces::switch_identity;
pub(crate) use workspaces::switch_warming_browser;
pub(crate) fn sync_identity_browser_proxy(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<Browser>();
    let browser_root = root(app)?;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "应用目录不可用。".to_string())?;
    let claude_home = crate::cleaner::identity::root()?;
    let sync_locked = || -> Result<(), String> {
        let (slot, changed, is_active) = workspaces::sync_identity_browser_proxy_in(
            &browser_root,
            &app_dir,
            &claude_home,
            id,
            &profile::running,
        )?;
        if changed {
            state.last_observations.lock().unwrap().remove(&slot);
        }
        if is_active && (changed || !browser_root.join("launch.args").is_file()) {
            refresh_launch_args(app)?;
            renew_session(app);
        }
        Ok(())
    };
    let existing_slot = {
        let _guard = state.gate.lock().unwrap();
        workspaces::database(&browser_root)?.browser_for(id)?
    };
    if existing_slot.is_some() {
        return state.with_slot_then_gate(
            || {
                workspaces::database(&browser_root)?
                    .browser_for(id)?
                    .ok_or_else(|| "浏览器身份绑定状态已变化，请重试。".to_string())
            },
            |_| sync_locked(),
        );
    }
    let guard = state.gate.lock().unwrap();
    if workspaces::database(&browser_root)?.browser_for(id)?.is_some() {
        drop(guard);
        return state.with_slot_then_gate(
            || {
                workspaces::database(&browser_root)?
                    .browser_for(id)?
                    .ok_or_else(|| "浏览器身份绑定状态已变化，请重试。".to_string())
            },
            |_| sync_locked(),
        );
    }
    sync_locked()
}
pub(crate) fn configure_identity(
    app: &tauri::AppHandle,
    reporter: &Reporter,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    workspaces::transition(app, reporter, true, false, action)
}
pub(crate) fn sync_current_launch_args(app: &tauri::AppHandle) {
    let state = app.state::<Browser>();
    let _guard = state.gate.lock().unwrap();
    let _ = refresh_launch_args(app);
}
#[cfg(target_os = "linux")]
include!("linux.rs");
#[cfg(target_os = "windows")]
include!("windows.rs");
pub(crate) mod quota_bridge;
pub(crate) mod quota_connection;
mod quota_existing;
#[cfg(test)]
pub(crate) use quota_existing::receive_for_test;
pub(crate) mod server;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod workspace_tests;
#[cfg(target_os = "linux")]
use crate::linux::*;
#[cfg(target_os = "windows")]
use crate::windows::*;
use crate::{
    native::decode,
    progress::{Progress, Reporter},
};
use config::{Config, Machine};
use network::{Check, Exit, Report};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::ffi::{c_char, CString};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
use tauri::{ipc::Channel, Manager};
#[cfg(target_os = "macos")]
extern "C" {
    fn rf_browser_register(path: *const c_char) -> *mut c_char;
    fn rf_browser_default_read(bundle: *const c_char) -> *mut c_char;
    fn rf_browser_set_default(bundle: *const c_char) -> *mut c_char;
    fn rf_system_region(language: *const c_char, locale: *const c_char) -> *mut c_char;
    fn rf_system_timezone(zone: *const c_char) -> *mut c_char;
    fn rf_system_location() -> *mut c_char;
}
#[derive(Clone)]
pub(crate) struct CachedObservation {
    pub config: Config,
    pub report: Report,
    pub received_at: u64,
}
#[derive(Default)]
pub(crate) struct SlotGate {
    inner: Mutex<()>,
}

impl SlotGate {
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LaunchRuntimeSnapshot {
    pub proxy: String,
    pub effective_proxy: String,
    pub region_id: String,
    pub language: String,
    pub timezone: String,
    pub seed: u32,
    pub native_graphics: bool,
    #[serde(default)]
    pub enable_quota_bridge: bool,
}

impl LaunchRuntimeSnapshot {
    #[allow(dead_code)]
    pub(crate) fn from_config(config: &Config, machine: &Machine) -> Self {
        Self::from_config_with_options(config, machine, config::LaunchOptions::legacy_default())
    }

    pub(crate) fn from_config_with_options(
        config: &Config,
        machine: &Machine,
        options: config::LaunchOptions,
    ) -> Self {
        let effective_proxy = if config.proxy.trim().is_empty() {
            machine.system_proxy.trim().to_string()
        } else {
            config.proxy.trim().to_string()
        };
        let region_id = config
            .region(machine)
            .map(|r| r.id.to_string())
            .unwrap_or_default();
        Self {
            proxy: config.proxy.trim().to_string(),
            effective_proxy,
            region_id,
            language: config.language(machine),
            timezone: config.timezone(machine),
            seed: config.seed,
            native_graphics: config.native_graphics,
            enable_quota_bridge: options.enable_quota_bridge,
        }
    }
}

#[derive(Default)]
pub struct Browser {
    gate: Mutex<()>,
    pub(crate) slot_gates: Mutex<std::collections::HashMap<String, std::sync::Arc<SlotGate>>>,
    pub(crate) launched_configs: Mutex<std::collections::HashMap<String, LaunchRuntimeSnapshot>>,
    pub(crate) warning: Mutex<Option<String>>,
    session: Mutex<Option<Session>>,
    pub(crate) last_observations: Mutex<std::collections::HashMap<String, CachedObservation>>,
    host: Mutex<Option<Exit>>,
    pub(crate) kill_switch: Mutex<kill_switch::KillSwitchState>,
}

impl Browser {
    pub(crate) fn slot_gate(&self, slot: &str) -> std::sync::Arc<SlotGate> {
        let mut gates = self.slot_gates.lock().unwrap_or_else(|e| e.into_inner());
        gates
            .entry(slot.to_string())
            .or_insert_with(|| std::sync::Arc::new(SlotGate::default()))
            .clone()
    }

    const SLOT_GATE_RETRIES: usize = 12;

    fn slot_gate_backoff(attempt: usize) {
        match attempt {
            0 => {}
            1..=3 => std::thread::yield_now(),
            _ => std::thread::sleep(std::time::Duration::from_millis(1)),
        }
    }

    pub(crate) fn with_slot_then_gate<T>(
        &self,
        mut resolve_slot: impl FnMut() -> Result<String, String>,
        action: impl FnOnce(&str) -> Result<T, String>,
    ) -> Result<T, String> {
        for attempt in 0..Self::SLOT_GATE_RETRIES {
            Self::slot_gate_backoff(attempt);
            let slot = {
                let _gate = self.gate.lock().unwrap();
                resolve_slot()?
            };
            let slot_gate = self.slot_gate(&slot);
            let _slot_guard = slot_gate.lock();
            let _gate = self.gate.lock().unwrap();
            if resolve_slot()? == slot {
                return action(&slot);
            }
        }
        Err("浏览器身份仍在切换，请重试。".into())
    }

    pub(crate) fn with_slots_then_gate<T>(
        &self,
        mut resolve_slots: impl FnMut() -> Result<Vec<String>, String>,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        fn normalize(mut slots: Vec<String>) -> Vec<String> {
            slots.sort();
            slots.dedup();
            slots
        }
        for attempt in 0..Self::SLOT_GATE_RETRIES {
            Self::slot_gate_backoff(attempt);
            let slots = {
                let _gate = self.gate.lock().unwrap();
                normalize(resolve_slots()?)
            };
            let gates: Vec<_> = slots.iter().map(|s| self.slot_gate(s)).collect();
            let _slot_guards: Vec<_> = gates.iter().map(|g| g.lock()).collect();
            let _gate = self.gate.lock().unwrap();
            if normalize(resolve_slots()?) == slots {
                return action();
            }
        }
        Err("浏览器身份仍在切换，请重试。".into())
    }

    pub(crate) fn with_active_slot_gate<T>(
        &self,
        mut resolve_slot: impl FnMut() -> Result<String, String>,
        mut action: impl FnMut(&str, &Mutex<()>) -> Result<(bool, T), String>,
    ) -> Result<T, String> {
        for attempt in 0..Self::SLOT_GATE_RETRIES {
            Self::slot_gate_backoff(attempt);
            let slot = {
                let _gate = self.gate.lock().unwrap();
                resolve_slot()?
            };
            let slot_gate = self.slot_gate(&slot);
            let _slot_guard = slot_gate.lock();
            match action(&slot, &self.gate)? {
                (true, value) => return Ok(value),
                (false, _) => continue,
            }
        }
        Err("浏览器身份仍在切换，请重试。".into())
    }

    pub(crate) fn record_launched_config(
        &self,
        scope: &Path,
        slot: &str,
        snapshot: &LaunchRuntimeSnapshot,
    ) {
        self.launched_configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(slot.to_string(), snapshot.clone());
        let path = scope.join("launch.snapshot.json");
        if profile::check_path(scope, &path).is_ok() {
            if let Ok(bytes) = serde_json::to_vec(snapshot) {
                let _ = crate::identities::private::write(&path, &bytes);
            }
        }
    }

    pub(crate) fn clear_launched_config(&self, scope: &Path, slot: &str) {
        self.launched_configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(slot);
        let path = scope.join("launch.snapshot.json");
        if profile::check_path(scope, &path).is_ok() {
            let _ = fs::remove_file(path);
        }
    }

    pub(crate) fn read_launched_config(
        &self,
        scope: &Path,
        slot: &str,
    ) -> Option<LaunchRuntimeSnapshot> {
        if let Some(found) = self
            .launched_configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(slot)
            .cloned()
        {
            return Some(found);
        }
        let path = scope.join("launch.snapshot.json");
        profile::check_path(scope, &path).ok()?;
        let bytes = fs::read(&path).ok()?;
        let parsed: LaunchRuntimeSnapshot = serde_json::from_slice(&bytes).ok()?;
        self.launched_configs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(slot.to_string(), parsed.clone());
        Some(parsed)
    }
}

pub(crate) fn slot_name_for_scope(scope: &Path) -> String {
    let name = scope
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if name == "browser" || name.is_empty() {
        "legacy".to_string()
    } else {
        name.to_string()
    }
}

pub(crate) fn load_config_ensured_seed(
    root: &Path,
    scope: &Path,
    slot: Option<&str>,
) -> Result<Config, String> {
    let mut config = config::load(scope)?;
    if config.seed == 0 {
        let db_seed = workspaces::database(root).ok().and_then(|db| {
            let resolved_slot = slot
                .map(str::to_string)
                .or_else(|| db.browser_slot().ok())?;
            db.browser_seed(&resolved_slot).ok().flatten()
        });
        config::ensure_persisted_seed(scope, db_seed, &mut config)?;
    }
    Ok(config)
}
struct Session {
    token: String,
    slot: String,
    config: Config,
    received_at: Option<u64>,
    report: Option<Report>,
}
#[derive(Clone, Serialize)]
pub struct Context {
    identity: crate::identities::browser_link::BrowserIdentity,
    ui_language: String,
    exit_services: &'static [&'static str],
    exit_classification_service: Option<&'static str>,
    region: Option<&'static crate::regions::Region>,
    config: Config,
    machine: Machine,
    engine_version: String,
}
impl Context {
    fn update_machine(&mut self, machine: Machine) {
        self.region = self.config.region(&machine);
        self.machine = machine;
    }
}
#[derive(Serialize)]
pub struct Snapshot {
    ui_language: String,
    exit_services: &'static [&'static str],
    exit_classification_service: Option<&'static str>,
    region: Option<&'static crate::regions::Region>,
    config: Config,
    machine: Machine,
    engine_version: String,
    engine_ready: bool,
    running: bool,
    profile: String,
    active_browser_slot: String,
    identity_linked: bool,
    identity: Option<crate::identities::browser_link::BrowserIdentity>,
    cli_identity: Option<crate::identities::browser_link::BrowserIdentity>,
    cli_expected_identity: Option<String>,
    cache: Vec<profile::CacheItem>,
    cache_error: String,
    report: Option<Report>,
    report_received_at: Option<u64>,
    machine_exit: Option<Exit>,
    checks: Vec<Check>,
}
fn identity_context(
    app: &tauri::AppHandle,
) -> Result<crate::identities::browser_link::BrowserIdentity, String> {
    let root = root(app)?;
    let vault = root
        .parent()
        .ok_or("应用目录不可用。")?
        .join("identity-vault");
    workspaces::database(&root)?.browser_identity(&vault, &crate::cleaner::identity::root()?)
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "应用目录不可用。")?
        .join("browser"))
}
pub(crate) fn configured_or_system_proxy(app: &tauri::AppHandle) -> String {
    let configured = root(app)
        .and_then(|r| workspaces::scope(&r))
        .and_then(|s| config::load(&s))
        .ok()
        .map(|c| c.proxy)
        .filter(|p| !p.is_empty());
    configured.unwrap_or_else(|| {
        config::machine()
            .map(|m| m.system_proxy)
            .unwrap_or_default()
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RiskBrowserContext {
    pub context_id: Option<String>,
    pub configured_proxy: String,
    pub effective_proxy: String,
    pub target_country: Option<String>,
    pub target_timezone: String,
    pub target_language: String,
}

pub(crate) fn current_risk_browser_context(app: &tauri::AppHandle) -> RiskBrowserContext {
    let machine = config::machine().ok();
    let settings = root(app).and_then(|r| risk_browser_settings(&r)).ok();
    risk_browser_context(settings, machine)
}

/// Manual audit only: attach ownership to the same frozen selected browser
/// context. No desktop CLI fingerprint is added to the loopback Context.
pub(crate) fn risk_browser_identity(
    app: &tauri::AppHandle,
    expected_context_id: &Option<String>,
) -> Option<crate::identities::browser_link::BrowserIdentity> {
    expected_context_id.as_ref()?;
    let browser = app.state::<Browser>();
    let _guard = browser.gate.try_lock().ok()?;
    if current_risk_browser_context(app).context_id != *expected_context_id {
        return None;
    }
    let mut identity = identity_context(app).ok()?;
    identity.cli_proxy = None;
    if current_risk_browser_context(app).context_id != *expected_context_id {
        return None;
    }
    Some(mask_browser_identity(
        identity,
        crate::ui_privacy::effective_privacy_mask(app),
    ))
}

/// One slot/config read; metadata must remain stable across the config read.
/// The revision contains no personal path or account/authorization identifier.
fn risk_browser_settings(root: &Path) -> Result<(Config, String), String> {
    let db = workspaces::database(root)?;
    let slot = db.browser_slot()?;
    let scope = workspaces::slot_path(root, &slot)?;
    let path = scope.join("config.json");
    profile::check_path(root, &path)?;
    let revision = || -> Result<(u64, u128), String> {
        let meta = fs::metadata(&path).map_err(|_| "浏览器配置修订不可用。")?;
        if !meta.is_file() {
            return Err("浏览器配置修订不可用。".into());
        }
        let modified = meta
            .modified()
            .map_err(|_| "浏览器配置修订不可用。")?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "浏览器配置修订不可用。")?
            .as_nanos();
        Ok((meta.len(), modified))
    };
    let before = revision()?;
    let cfg = config::load(&scope)?;
    if before != revision()? {
        return Err("浏览器配置已变化，请重新检查。".into());
    }
    let bytes = serde_json::to_vec(&("Claude-Local/risk-browser-revision/v1", slot, before, &cfg))
        .map_err(|_| "浏览器配置修订不可用。")?;
    Ok((cfg, risk_context_hash(&bytes)))
}

fn risk_context_hash(bytes: &[u8]) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    let mut id = String::from("brc1-");
    for byte in &digest.as_ref()[..12] {
        use std::fmt::Write;
        let _ = write!(id, "{byte:02x}");
    }
    id
}

fn risk_browser_context(
    settings: Option<(Config, String)>,
    machine: Option<Machine>,
) -> RiskBrowserContext {
    let cfg = settings.as_ref().map(|(cfg, _)| cfg);
    let configured_proxy = cfg
        .map(|c| c.proxy.clone())
        .filter(|p| !p.is_empty())
        .unwrap_or_default();
    let effective_proxy = if configured_proxy.is_empty() {
        machine
            .as_ref()
            .map(|m| m.system_proxy.clone())
            .unwrap_or_default()
    } else {
        configured_proxy.clone()
    };
    let (target_country, target_timezone, target_language) = match (cfg, &machine) {
        (Some(c), Some(m)) => (
            c.region(m).map(|r| r.country.to_string()).or_else(|| {
                (!c.follow_machine)
                    .then(|| crate::regions::timezone_country(&c.timezone).map(str::to_string))
                    .flatten()
            }),
            c.timezone(m),
            c.language(m),
        ),
        (Some(c), None) => (
            (!c.follow_machine)
                .then(|| crate::regions::timezone_country(&c.timezone).map(str::to_string))
                .flatten(),
            c.timezone.clone(),
            c.language.clone(),
        ),
        (None, Some(m)) => (
            crate::regions::matching_country(&m.locale_country, &m.timezone)
                .map(|r| r.country.to_string()),
            m.timezone.clone(),
            m.languages
                .first()
                .cloned()
                .unwrap_or_else(|| "en-US".to_string()),
        ),
        (None, None) => (None, "America/New_York".into(), "en-US".into()),
    };
    // With no machine snapshot an empty configured route is unknown, not proof
    // of direct connectivity. Native probes require an actual frozen route.
    let route_known = !configured_proxy.is_empty() || machine.is_some();
    let context_id = settings.filter(|_| route_known).and_then(|(_, revision)| {
        serde_json::to_vec(&(
            "Claude-Local/risk-browser-context/v1",
            revision,
            &effective_proxy,
            &target_country,
            &target_timezone,
            &target_language,
        ))
        .ok()
        .map(|bytes| risk_context_hash(&bytes))
    });
    RiskBrowserContext {
        context_id,
        configured_proxy,
        effective_proxy,
        target_country,
        target_timezone,
        target_language,
    }
}
#[cfg(target_os = "macos")]
pub const BROWSER_ID: &str = "ai.local.claude-local.browser";
#[cfg(target_os = "macos")]
const BROWSER_APP: &str = "Claude-Local Browser.app";
#[cfg(target_os = "macos")]
const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
/// install-apps.sh 安装的 Claude-Local Browser：优先 /Applications，回退 ~/Applications；存在时作为唯一引擎，避免同一包标识出现两份注册。
#[cfg(target_os = "macos")]
fn installed() -> Option<PathBuf> {
    let mut places = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        places.push(PathBuf::from(home).join("Applications"));
    }
    places
        .into_iter()
        .map(|dir| dir.join(BROWSER_APP))
        .find(|app| app.join("Contents/MacOS/Chromium").is_file())
}
#[cfg(target_os = "macos")]
fn register(engine: &Path) -> Result<(), String> {
    let path = CString::new(engine.to_string_lossy().as_bytes()).map_err(|_| "引擎路径无效。")?;
    let _: serde_json::Value = decode(unsafe { rf_browser_register(path.as_ptr()) })?;
    Ok(())
}
#[cfg(target_os = "macos")]
fn bundle_id() -> CString {
    CString::new(BROWSER_ID).unwrap()
}
/// Claude-Local Browser 入口（launcher/CCBrowser.c）读取的参数：与实测启动相同，只去掉起始页。
fn write_launch_args(
    root: &Path,
    config: &Config,
    machine: &Machine,
    profile: &Path,
    version: &str,
) -> Result<(), String> {
    let mut args = config::arguments_with_options(
        config,
        machine,
        profile,
        "",
        version,
        config::LaunchOptions::for_purpose(config::LaunchPurpose::Verification),
    );
    args.pop();
    crate::identities::private::directory(root)?;
    crate::identities::private::write(
        &root.join("launch.args"),
        (args.join("\n") + "\n").as_bytes(),
    )?;
    workspaces::unblock(root)
}
fn refresh_launch_args(app: &tauri::AppHandle) -> Result<(), String> {
    let root = root(app)?;
    workspaces::ensure(&root)?;
    let settings = workspaces::scope(&root)?;
    let profile = settings.join("profile");
    profile::check_path(&root, &profile)?;
    let config = load_config_ensured_seed(&root, &settings, None)?;
    let machine = config::machine()?;
    config.validate(&machine)?;
    let engine = engine(app)?;
    write_launch_args(
        &root,
        &config,
        &machine,
        &profile,
        &packaged_version(app, &engine),
    )?;
    workspaces::unblock(&root)
}
/// 新建起始页会话：随机令牌回环服务 + 写入 browser/start.url（0600），供 CCBrowser 入口在每次全新启动时作为首个标签打开。
fn open_session(
    app: &tauri::AppHandle,
    config: &Config,
    machine: &Machine,
    engine_version: String,
) -> Result<String, String> {
    let state = app.state::<Browser>();
    let listener = server::bind()?;
    let port = listener
        .local_addr()
        .map_err(|_| "本地端口不可用。")?
        .port();
    let token = server::nonce()?;
    let page = format!("http://127.0.0.1:{port}/{token}/browser.html");
    let mask = crate::ui_privacy::effective_privacy_mask(app);
    let context = Context {
        identity: mask_browser_identity(identity_context(app)?, mask),
        ui_language: crate::ui_language::ui_language_read(app.clone()),
        exit_services: &network::SERVICES,
        exit_classification_service: Some(network::CLASSIFICATION_SERVICE),
        region: config.region(machine),
        config: config.clone(),
        machine: machine.clone(),
        engine_version,
    };
    let web = web(app)?;
    let root = root(app)?;
    let slot = workspaces::database(&root)?.browser_slot()?;
    *state.session.lock().unwrap() = Some(Session {
        token: token.clone(),
        slot,
        config: config.clone(),
        report: None,
        received_at: None,
    });
    server::start(app.clone(), listener, token, web, context);
    crate::identities::private::directory(&root)?;
    crate::identities::private::write(&root.join("start.url"), format!("{page}\n").as_bytes())?;
    Ok(page)
}

/// 资料或配置变化使旧会话失效后，立即换新会话，保证 start.url 始终指向存活的起始页服务。
fn renew_session(app: &tauri::AppHandle) {
    let result = (|| -> Result<(), String> {
        let root = root(app)?;
        let scope = workspaces::scope(&root)?;
        let config = load_config_ensured_seed(&root, &scope, None)?;
        let machine = config::machine()?;
        config.validate(&machine)?;
        let engine = engine(app)?;
        open_session(app, &config, &machine, packaged_version(app, &engine))?;
        Ok(())
    })();
    if let Err(error) = result {
        *app.state::<Browser>().session.lock().unwrap() = None;
        forget_start_url(app);
        eprintln!("起始页会话未更新：{error}");
    }
}
/// 宿主退出时删除 start.url，避免 CCBrowser 入口读到失效令牌。
pub fn forget_start_url(app: &tauri::AppHandle) {
    if let Ok(root) = root(app) {
        let _ = fs::remove_file(root.join("start.url"));
    }
}
/// 宿主启动时建立起始页会话并带起 Claude-Local Browser（已在运行则不动），不抢焦点。
#[cfg(target_os = "macos")]
pub fn companion(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = start_companion(&app) {
            eprintln!("Claude-Local Browser未随宿主启动：{error}");
        }
    });
}
#[cfg(target_os = "macos")]
fn start_companion(app: &tauri::AppHandle) -> Result<(), String> {
    let browser = installed().ok_or("未安装 /Applications/Claude-Local Browser.app。")?;
    let state = app.state::<Browser>();
    state.with_slot_then_gate(
        || workspaces::database(&root(app)?)?.browser_slot(),
        |_slot| {
            let root = root(app)?;
            workspaces::ensure(&root)?;
            let settings = workspaces::scope(&root)?;
            let profile = settings.join("profile");
            profile::check_path(&root, &profile)?;
            let config = load_config_ensured_seed(&root, &settings, None)?;
            let machine = config::machine()?;
            config.validate(&machine)?;
            // 先刷新参数：浏览器已由 Claude-Local Browser 入口先行启动时，下一次启动也能沿用指纹参数。
            write_launch_args(&root, &config, &machine, &profile, &version(&browser))?;
            let page = open_session(app, &config, &machine, version(&browser))?;
            if profile::running(&profile)? {
                // 宿主重装/重启后端口与令牌变化：给运行中的浏览器打开新的实测页，避免旧标签失联。
                let mut child = Command::new(browser.join("Contents/MacOS/Chromium"))
                    .arg(format!("--user-data-dir={}", profile.display()))
                    .args(["--profile-directory=Default", &page])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| "无法重新连接运行中的 Claude-Local Browser。")?;
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(());
            }
            profile::preferences(&profile, &config, &machine)?;
            register(&browser)?;
            let status = Command::new("/usr/bin/open")
                .args(["-g", "-a"])
                .arg(&browser)
                .status()
                .map_err(|_| "无法打开 Claude-Local Browser。")?;
            if !status.success() {
                return Err("LaunchServices 拒绝打开 Claude-Local Browser。".into());
            }
            Ok(())
        },
    )
}
#[derive(Serialize, Deserialize)]
pub struct DefaultBrowser {
    is_default: bool,
    http: String,
    https: String,
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    app: String,
}
#[cfg(target_os = "macos")]
fn default_read() -> Result<DefaultBrowser, String> {
    let id = bundle_id();
    let mut value: DefaultBrowser = decode(unsafe { rf_browser_default_read(id.as_ptr()) })?;
    let browser = installed();
    value.installed = browser.is_some();
    value.app = browser
        .map(|x| x.to_string_lossy().into())
        .unwrap_or_default();
    Ok(value)
}
#[tauri::command]
pub async fn browser_default_read() -> Result<DefaultBrowser, String> {
    run(default_read).await
}
/// 一键设为默认浏览器：重新注册已安装的 Claude-Local Browser，注销应用数据中的旧引擎副本，再请求系统切换；macOS 会弹出确认框。
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_set_default(app: tauri::AppHandle) -> Result<DefaultBrowser, String> {
    run(move || {
        let browser = installed().ok_or(
            "未找到 /Applications/Claude-Local Browser.app，请先运行 bun run install:apps。",
        )?;
        let copy = root(&app)?.join("engine/Browser.app");
        if copy.exists() {
            let _ = Command::new(LSREGISTER).arg("-u").arg(&copy).status();
        }
        let _ = Command::new(LSREGISTER).arg("-f").arg(&browser).status();
        register(&browser)?;
        let id = bundle_id();
        let _: serde_json::Value = decode(unsafe { rf_browser_set_default(id.as_ptr()) })?;
        default_read()
    })
    .await
}
#[cfg(target_os = "macos")]
fn engine(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(browser) = installed() {
        return Ok(browser);
    }
    let installed = root(app)?.join("engine/Browser.app");
    if installed.exists() {
        return Ok(installed);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/Browser.app"));
    }
    Ok(installed)
}
#[cfg(target_os = "macos")]
fn prepare_engine(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let engine = engine(app)?;
    if binary(&engine).is_file() {
        return Ok(engine);
    }
    let parent = engine.parent().ok_or("引擎目录无效。")?;
    profile::check_path(&root(app)?, parent)?;
    fs::create_dir_all(parent).map_err(|_| "无法安装内置引擎。")?;
    let archive = app
        .path()
        .resource_dir()
        .map_err(|_| "资源目录不可用。")?
        .join("browser-runtime/Browser.zip");
    let status = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(archive)
        .arg(parent)
        .status()
        .map_err(|_| "无法解压内置引擎。")?;
    if !status.success() || !binary(&engine).is_file() {
        return Err("内置引擎安装失败。".into());
    }
    Ok(engine)
}
fn packaged_version(app: &tauri::AppHandle, engine: &Path) -> String {
    if engine.exists() {
        return version(engine);
    }
    app.path()
        .resource_dir()
        .ok()
        .and_then(|p| fs::read_to_string(p.join("browser-runtime/version.txt")).ok())
        .unwrap_or_default()
        .trim()
        .into()
}
fn web(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|_| "资源目录不可用。")?
        .join("browser-ui");
    if packaged.join("browser.html").exists() {
        return Ok(packaged);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    }
    Err("浏览器起始页缺失。".into())
}
#[cfg(target_os = "macos")]
fn version(engine: &Path) -> String {
    let out = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
        .arg(engine.join("Contents/Info.plist"))
        .output();
    out.ok()
        .filter(|x| x.status.success())
        .map(|x| String::from_utf8_lossy(&x.stdout).trim().to_string())
        .unwrap_or_default()
}
fn snapshot(app: &tauri::AppHandle) -> Result<Snapshot, String> {
    let root = root(app)?;
    let settings = workspaces::scope(&root)?;
    let profile = settings.join("profile");
    profile::check_path(&root, &profile)?;
    let machine = config::machine()?;
    let config = load_config_ensured_seed(&root, &settings, None)?;
    config.validate(&machine)?;
    let engine = engine(app)?;
    let engine_version = packaged_version(app, &engine);
    let running = profile::running(&profile)?;
    let active_browser_slot = workspaces::database(&root)?.browser_slot()?;
    let (mut report, mut report_received_at) = app
        .state::<Browser>()
        .session
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.slot == active_browser_slot && s.config == config)
        .and_then(|x| x.report.clone().map(|r| (Some(r), x.received_at)))
        .unwrap_or((None, None));
    if report.is_none() {
        if let Some(cached) = app
            .state::<Browser>()
            .last_observations
            .lock()
            .unwrap()
            .get(&active_browser_slot)
            .filter(|c| c.config == config)
        {
            report = Some(cached.report.clone());
            report_received_at = Some(cached.received_at);
        }
    }
    let host = app.state::<Browser>().host.lock().unwrap().clone();
    let checks = network::checks(
        &machine,
        &config,
        report.as_ref(),
        host.as_ref(),
        &engine_version,
    );
    let (cache, cache_error) = match profile::scan(&profile) {
        Ok(items) => (items, String::new()),
        Err(error) => (Vec::new(), error),
    };
    let identity = identity_context(app)
        .ok()
        .map(|id| mask_browser_identity(id, crate::ui_privacy::effective_privacy_mask(app)));
    let (cli_identity, cli_expected_identity) = lifecycle::snapshot_cli(app);
    Ok(Snapshot {
        ui_language: crate::ui_language::ui_language_read(app.clone()),
        exit_services: &network::SERVICES,
        exit_classification_service: Some(network::CLASSIFICATION_SERVICE),
        region: config.region(&machine),
        config,
        machine,
        engine_ready: !engine_version.is_empty(),
        engine_version,
        running,
        profile: profile.to_string_lossy().into(),
        active_browser_slot,
        identity_linked: workspaces::database(&root)?.browser_link()?.enabled,
        identity,
        cli_identity,
        cli_expected_identity,
        cache,
        cache_error,
        report,
        report_received_at,
        machine_exit: host,
        checks,
    })
}
async fn run<T: Send + 'static>(
    action: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|_| "浏览器操作被中断。".to_string())?
}
#[tauri::command]
pub async fn browser_read(app: tauri::AppHandle) -> Result<Snapshot, String> {
    run(move || {
        let state = app.state::<Browser>();
        let _guard = state.gate.lock().unwrap();
        snapshot(&app)
    })
    .await
}
#[tauri::command]
pub async fn browser_save(app: tauri::AppHandle, config: Config) -> Result<Snapshot, String> {
    run(move || {
        let state = app.state::<Browser>();
        state.with_slot_then_gate(
            || workspaces::database(&root(&app)?)?.browser_slot(),
            |slot| {
                let root = root(&app)?;
                workspaces::ready(&root)?;
                if profile::running(&workspaces::scope(&root)?.join("profile"))? {
                    return Err("先退出浏览器，再保存指纹设置。".into());
                }
                config.validate(&config::machine()?)?;
                config::save(&workspaces::scope(&root)?, &config)?;
                config::invalidate_exit_country_cache(None);
                state.last_observations.lock().unwrap().remove(slot);
                refresh_launch_args(&app)?;
                renew_session(&app);
                snapshot(&app)
            },
        )
    })
    .await
}
#[tauri::command]
pub async fn browser_launch(
    app: tauri::AppHandle,
    on_progress: Channel<Progress>,
) -> Result<Snapshot, String> {
    run(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let state = app.state::<Browser>();
        state
            .with_active_slot_gate(
                || workspaces::database(&root(&app)?)?.browser_slot(),
                |slot, gate| {
                    let pending = {
                        let _guard = gate.lock().unwrap();
                        if workspaces::database(&root(&app)?)?.browser_slot()? != slot {
                            return Ok((false, None));
                        }
                        launch::spawn_with_urls_locked(&app, &reporter, &[])?
                    };
                    let snap = match pending {
                        launch::SpawnOutcome::AlreadyReady(snap) => snap,
                        launch::SpawnOutcome::WaitRunning(wait) => {
                            launch::wait_launched_holding_slot_gate(&app, wait, &reporter)?
                        }
                    };
                    Ok((true, Some(snap)))
                },
            )?
            .ok_or_else(|| "浏览器身份仍在切换，请重试。".to_string())
    })
    .await
}
#[tauri::command]
pub async fn browser_quit(app: tauri::AppHandle) -> Result<Snapshot, String> {
    run(move || {
        let (slot, scope, profile) = {
            let state = app.state::<Browser>();
            let _guard = state.gate.lock().unwrap();
            let root = root(&app)?;
            let scope = workspaces::scope(&root)?;
            let slot = workspaces::database(&root)?.browser_slot()?;
            let profile = scope.join("profile");
            profile::check_path(&root, &profile)?;
            (slot, scope, profile)
        };
        {
            let state = app.state::<Browser>();
            let slot_gate = state.slot_gate(&slot);
            let _slot_guard = slot_gate.lock();
            profile::quit(&profile)?;
            state.clear_launched_config(&scope, &slot);
        }
        let state = app.state::<Browser>();
        let _guard = state.gate.lock().unwrap();
        renew_session(&app);
        snapshot(&app)
    })
    .await
}
#[tauri::command]
pub async fn browser_clear(
    app: tauri::AppHandle,
    include_site_data: bool,
    reset_profile: Option<bool>,
    on_progress: Channel<Progress>,
) -> Result<Snapshot, String> {
    let reset = reset_profile.unwrap_or(false);
    if reset && !include_site_data {
        return Err("完整重置需要明确确认全部浏览器资料。".into());
    }
    run(move || {
        let state = app.state::<Browser>();
        state.with_slot_then_gate(
            || workspaces::database(&root(&app)?)?.browser_slot(),
            |slot| {
                let root_dir = root(&app)?;
                workspaces::ready(&root_dir)?;
                let profile = workspaces::scope(&root_dir)?.join("profile");
                let log = Reporter::channel(Some(on_progress));
                log.log(
                    "browser",
                    "running",
                    if reset {
                        "正在核验当前浏览器的完整资料。"
                    } else {
                        "核验浏览器已退出；只处理独立资料内的固定项目。"
                    },
                    0,
                    None,
                );
                if profile::running(&profile)? {
                    return Err("浏览器正在使用资料，退出后再清理。".into());
                }
                let mut count = 0;
                let mut total = 0;
                let mut reported_at: Option<std::time::Instant> = None;
                let result = if reset {
                    profile::reset(
                        &profile,
                        || {
                            if profile::running(&profile)? {
                                Err("浏览器正在使用资料，退出后再清理。".into())
                            } else {
                                Ok(())
                            }
                        },
                        |name, done, completed, planned| {
                            count = completed;
                            total = planned;
                            if completed == planned
                                || reported_at.is_none_or(|last| {
                                    last.elapsed() >= std::time::Duration::from_millis(50)
                                })
                            {
                                log.log(
                                    "browser",
                                    "running",
                                    &format!("{}：{name}", if done { "已删除" } else { "正在删除" }),
                                    completed,
                                    Some(planned),
                                );
                                reported_at = Some(std::time::Instant::now());
                            }
                        },
                    )
                } else {
                    total = profile::scan(&profile)?
                        .iter()
                        .filter(|x| include_site_data || !x.login)
                        .count();
                    profile::clear(&profile, include_site_data, |name, done| {
                        if done {
                            count += 1;
                        }
                        log.log(
                            "browser",
                            if done { "ok" } else { "running" },
                            &format!("{}：{name}", if done { "已删除" } else { "正在删除" }),
                            count,
                            Some(total),
                        );
                    })
                };
                if let Err(error) = result {
                    if reset {
                        state.last_observations.lock().unwrap().remove(slot);
                        renew_session(&app);
                        log.log(
                            "browser",
                            "error",
                            &error,
                            count,
                            (total > 0).then_some(total),
                        );
                    } else {
                        log.fail(&error);
                    }
                    return Err(error);
                }
                if reset {
                    state.last_observations.lock().unwrap().remove(slot);
                }
                renew_session(&app);
                log.log(
                    "browser",
                    "ok",
                    &format!("直接清理 {count} 个项目，不保留副本。"),
                    count,
                    Some(total),
                );
                snapshot(&app)
            },
        )
    })
    .await
}
#[tauri::command]
pub async fn browser_check(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let machine = config::machine()?;
    let host = network::probe(&machine.system_proxy).await;
    let state = app.state::<Browser>();
    *state.host.lock().unwrap() = host.as_ref().ok().cloned();
    let value = run(move || snapshot(&app)).await?;
    match host {
        Ok(_) => Ok(value),
        Err(error) => Err(error),
    }
}
#[tauri::command]
pub async fn browser_align(
    app: tauri::AppHandle,
    on_progress: Channel<Progress>,
) -> Result<Snapshot, String> {
    let settings = workspaces::scope(&root(&app)?)?;
    let proxy = config::load(&settings)?.proxy;
    let exit = network::probe(&proxy).await?;
    if exit.country != "US" {
        return Err("实际代理出口不是美国，未修改机器。".into());
    }
    let app_align = app.clone();
    crate::system::run_change(app.clone(), "align", move || {
        let state = app_align.state::<Browser>();
        state.with_slot_then_gate(
            || workspaces::database(&root(&app_align)?)?.browser_slot(),
            |slot| {
                let root_align = root(&app_align)?;
                workspaces::ready(&root_align)?;
                let log = Reporter::channel(Some(on_progress));
                if workspaces::scope(&root_align)? != settings {
                    return Err("浏览器身份已变化，请重试。".into());
                }
                if profile::running(&settings.join("profile"))? {
                    return Err("先退出浏览器，再对齐机器。".into());
                }
                let machine = config::machine()?;
                if !machine.timezones.contains(&exit.timezone) {
                    return Err("出口未返回可用时区，未修改机器。".into());
                }
                #[cfg(target_os = "linux")]
                {
                    if machine.location_enabled.is_none() {
                        return Err("Linux location state is unknown on this desktop; full machine alignment cannot be verified. No system settings were changed.".into());
                    }
                    let _: serde_json::Value = decode(unsafe {
                        rf_system_region(b"en-US\0".as_ptr().cast(), b"en_US\0".as_ptr().cast())
                    })?;
                }
                log.log(
                    "browser",
                    "running",
                    "设置实际美国出口对应的时区，请完成系统管理员授权。",
                    0,
                    None,
                );
                let zone =
                    std::ffi::CString::new(exit.timezone.clone()).map_err(|_| "出口时区无效。")?;
                let _: serde_json::Value = decode(unsafe { rf_system_timezone(zone.as_ptr()) })?;
                log.log("browser", "ok", "系统时区已核验。", 1, Some(3));
                let _: serde_json::Value = decode(unsafe {
                    rf_system_region(b"en-US\0".as_ptr().cast(), b"en_US\0".as_ptr().cast())
                })?;
                log.log("browser", "ok", "美国英语与 en_US 区域已保存。", 2, Some(3));
                if config::machine()?.location_enabled != Some(false) {
                    let _: serde_json::Value = decode(unsafe { rf_system_location() })?;
                }
                let fresh = config::machine()?;
                if fresh.location_enabled != Some(false)
                    || !crate::regions::timezones_match(&fresh.timezone, &exit.timezone)
                    || !fresh.locale.starts_with("en_US")
                    || fresh.languages.first().map(String::as_str) != Some("en-US")
                {
                    return Err("部分系统设置未能核验，请查看电脑设置。".into());
                }
                workspaces::ensure(&root_align)?;
                let mut config = load_config_ensured_seed(&root_align, &settings, Some(slot))?;
                config.follow_machine = true;
                config.language = "en-US".into();
                config.timezone = exit.timezone;
                config::save(&settings, &config)?;
                state.last_observations.lock().unwrap().clear();
                refresh_launch_args(&app_align)?;
                renew_session(&app_align);
                log.log(
                    "browser",
                    "ok",
                    "机器与实际美国出口对齐完成；重新打开浏览器核验。",
                    3,
                    Some(3),
                );
                Ok(serde_json::json!({ "message": "完成" }))
            },
        )
    })
    .await?;
    run(move || {
        let state = app.state::<Browser>();
        let _guard = state.gate.lock().unwrap();
        snapshot(&app)
    })
    .await
}

pub fn mask_email(email: &str) -> String {
    if email.is_empty() {
        return String::new();
    }
    match email.find('@') {
        None => "***".to_string(),
        Some(0) => format!("***{email}"),
        Some(at) => {
            let (local, domain) = email.split_at(at);
            let char_count = local.chars().count();
            if char_count <= 1 {
                format!("*{domain}")
            } else {
                let keep = (char_count / 2).clamp(1, 3);
                let prefix: String = local.chars().take(keep).collect();
                format!("{prefix}***{domain}")
            }
        }
    }
}

pub fn mask_display_name(name: &str, email: Option<&str>) -> String {
    if name.is_empty() {
        return String::new();
    }
    if name.contains('@') {
        return mask_email(name);
    }
    if let Some(e) = email {
        let local = e.split('@').next().unwrap_or(e);
        if name.eq_ignore_ascii_case(local) {
            return mask_email(e);
        }
    }
    name.to_string()
}

pub fn mask_browser_identity(
    mut identity: crate::identities::browser_link::BrowserIdentity,
    mask: bool,
) -> crate::identities::browser_link::BrowserIdentity {
    if !mask {
        return identity;
    }
    let email_ref = identity.email.clone();
    identity.name = identity
        .name
        .map(|n| mask_display_name(&n, email_ref.as_deref()));
    identity.email = identity.email.map(|e| mask_email(&e));
    identity
}

const USAGE_SETTINGS_URL: &str = "https://claude.ai/settings/usage";

#[tauri::command]
pub async fn browser_open_usage(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    expected_identity: String,
    on_progress: Option<tauri::ipc::JavaScriptChannelId>,
) -> Result<Snapshot, String> {
    let on_progress = on_progress.map(|id| id.channel_on(webview));
    run(move || {
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        let _account_guard = cleaner.enter_browser_account(&expected_identity)?;
        let _running_memo = profile::begin_running_memo();
        let mut proof_cache = lifecycle::CliProofCache::default();
        {
            let browser = app.state::<Browser>();
            let pre_slot = quota_connection::lookup_existing_bound_slot_with_cache(
                &app,
                "current",
                &expected_identity,
                &mut proof_cache,
            );
            let pre_gate = pre_slot.as_deref().map(|s| browser.slot_gate(s));
            let mut pre_guard = pre_gate.as_ref().map(|g| g.lock());
            quota_connection::materialize_identity_profile_with_cache(
                &app,
                "current",
                &expected_identity,
                &mut proof_cache,
            )?;
            let target = quota_connection::resolve_bound_profile_target_with_cache(
                &app,
                "current",
                &expected_identity,
                &mut proof_cache,
            )?;
            let _late_gate;
            let _late_guard;
            if pre_slot.as_deref() != Some(target.slot.as_str()) {
                drop(pre_guard.take());
                _late_gate = browser.slot_gate(&target.slot);
                _late_guard = Some(_late_gate.lock());
            }
            quota_connection::launch_bound_profile_target_with_options(
                &app,
                &target,
                config::LaunchOptions {
                    purpose: config::LaunchPurpose::QuotaSync,
                    enable_quota_bridge: true,
                },
                None,
            )?;
        }
        Reporter::channel(on_progress).log(
            "browser",
            "ok",
            "已请求在当前 CLI 的独立资料中打开官方用量页。",
            1,
            Some(1),
        );
        let state = app.state::<Browser>();
        let _guard = state.gate.lock().unwrap();
        snapshot(&app)
    })
    .await
}


#[cfg(target_os = "macos")]
fn binary(engine: &Path) -> PathBuf {
    engine.join("Contents/MacOS/Chromium")
}
