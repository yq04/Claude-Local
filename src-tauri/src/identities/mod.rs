// [INPUT]: SQLite 身份目录、加密压缩保险库、Cleaner 全局事务门与显式身份写入代次、Tauri 进度通道。
// [OUTPUT]: 有界归档加载、身份/网页摘要与管理命令、轻量usage身份观察登记、跳过活动session扫描的原生调度摘要入口及唯一进程级唤醒owner。
// [POS]: GUI 身份管理的原生入口；在线子模块仅允许固定额度端点和白名单回执，不提供凭据读取或任意文件/网络接口。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
mod archive;
mod archive_limits;
pub mod backup;
pub(crate) mod browser_link;
#[cfg(test)]
mod browser_link_tests;
pub(crate) mod catalog;
mod codec;
mod compression;
mod credentials;
pub(crate) mod database;
#[cfg(test)]
mod database_tests;
pub(crate) mod online;
pub(crate) mod wakeup;
#[cfg(test)]
mod optimization_tests;
pub(crate) mod private;
pub(crate) mod profile;
mod store;
#[cfg(test)]
mod tests;
pub(crate) mod usage;
#[cfg(test)]
mod usage_tests;
use crate::progress::{Progress, Reporter};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, Manager};
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Policy {
    pub skills: bool,
    pub plugins: bool,
    pub mcp: bool,
    pub settings: bool,
    pub projects: bool,
    pub history: bool,
    pub cache: bool,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            skills: true,
            plugins: true,
            mcp: true,
            settings: true,
            projects: true,
            history: true,
            cache: false,
        }
    }
}
impl Policy {
    pub fn all() -> Self {
        Self {
            skills: false,
            plugins: false,
            mcp: false,
            settings: false,
            projects: false,
            history: false,
            cache: false,
        }
    }
    pub fn keeps(&self, category: &str) -> bool {
        match category {
            "skills" => self.skills,
            "plugins" => self.plugins,
            "mcp" => self.mcp,
            "settings" => self.settings,
            "history" => self.history,
            "cache" => self.cache,
            _ => false,
        }
    }
}
#[derive(Serialize)]
pub struct State {
    pub browser: browser_link::BrowserLink,
    pub browser_warning: Option<String>,
    pub records: Vec<database::Record>,
    pub summaries: std::collections::BTreeMap<String, profile::Summary>,
    pub sessions: Vec<profile::ActiveSession>,
    pub active: String,
    pub recovery: Option<String>,
    pub running: bool,
    pub current: profile::Current,
}
pub(crate) fn new_id() -> Result<String, String> {
    Ok(codec::random::<16>()?
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn name(value: &str) -> Result<String, String> {
    let n = value.trim();
    if n.is_empty() || n.chars().count() > 64 || n.chars().any(char::is_control) {
        Err("身份名称需要 1–64 个字符。".into())
    } else {
        Ok(n.into())
    }
}
fn vault(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "身份保险库无法定位。")?
        .join("identity-vault"))
}
fn state(app: &tauri::AppHandle) -> Result<State, String> {
    state_for(app, true)
}
fn state_for(app: &tauri::AppHandle, include_sessions: bool) -> Result<State, String> {
    let vault_path = vault(app)?;
    let root_path = crate::cleaner::identity::root()?;
    let db = database::Database::open(&vault_path)?;
    let _ = db.prune_orphan_summaries();
    let mut records: Vec<_> = db.records()?.into_iter().filter(|r| !r.empty).collect();
    let mut summaries = db.summaries()?;
    if records.iter().any(|r| {
        r.account_key.is_none()
            || !summaries
                .get(&r.id)
                .is_some_and(profile::Summary::has_quota_check)
    }) {
        let cleaner = app.state::<crate::cleaner::Cleaner>();
        if cleaner.enter().is_ok() {
            let _ = store::Store::open(&vault_path, &root_path);
            cleaner.leave();
            let _ = db.prune_orphan_summaries();
            if let Ok(updated) = db.records() {
                records = updated.into_iter().filter(|r| !r.empty).collect();
            }
            if let Ok(updated) = db.summaries() {
                summaries = updated;
            }
        }
    }
    let now_sec = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let active =
        catalog::current_id(&vault_path, &root_path, &db)?.unwrap_or_else(|| "current".into());
    let mut current = profile::read_live(&root_path, &vault_path);
    usage::observe_current(&vault_path, &root_path);
    online::apply_metadata(
        &vault_path,
        current.quota_identity.as_deref(),
        &mut current.web,
    );
    if current.present {
        if active != "current" && records.iter().any(|r| r.id == active) {
            let live_sum = profile::Summary::from_current(&current);
            if summaries.get(&active) != Some(&live_sum) {
                let _ = db.set_summary(&active, &live_sum);
                summaries.insert(active.clone(), live_sum);
            }
        }
    }
    let saved_map: std::collections::HashMap<String, u64> =
        records.iter().map(|r| (r.id.clone(), r.saved_at)).collect();
    for (id, summary) in summaries.iter_mut() {
        let saved_at = saved_map.get(id).copied().unwrap_or(0);
        profile::apply_ledger_to_summary(&vault_path, summary, saved_at, now_sec);
        summary.refresh_for_now(now_sec);
        online::apply_metadata(
            &vault_path,
            summary.quota_identity.as_deref(),
            &mut summary.web,
        );
    }
    Ok(State {
        browser: db.browser_link()?,
        browser_warning: app
            .state::<crate::browser::Browser>()
            .warning
            .lock()
            .unwrap()
            .clone(),
        records,
        summaries,
        sessions: if include_sessions { profile::active_sessions(&root_path) } else { Vec::new() },
        active,
        recovery: db.get("recovery")?,
        running: crate::cleaner::identity::processes_running()?,
        current,
    })
}
#[tauri::command]
pub async fn identities_read(app: tauri::AppHandle) -> Result<State, String> {
    tauri::async_runtime::spawn_blocking(move || state(&app))
        .await
        .map_err(|_| "身份列表读取被中断。".to_string())?
}
#[tauri::command]
pub async fn identities_stop(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    on_progress: Option<tauri::ipc::JavaScriptChannelId>,
) -> Result<(), String> {
    // Channel 本身不实现 Deserialize；官方可反序列化 ID 在当前 WebView 上绑定后可兼容无通道旧调用。
    let on_progress = on_progress.map(|id| id.channel_on(webview));
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(on_progress);
        reporter.log("stop", "running", "正在结束已识别的 Claude 进程。", 0, None);
        let result = crate::cleaner::stop_processes();
        match &result {
            Ok(count) => reporter.log("stop", "ok", "Claude 进程已结束。", *count, Some(*count)),
            Err(error) => reporter.log("stop", "error", error, 0, None),
        }
        result
    })
    .await
    .map_err(|_| "结束进程被中断，请刷新。".to_string())
    .and_then(|r| r)
    .map(|_| ());
    cleaner.leave();
    result
}
#[tauri::command]
pub async fn identities_save(
    app: tauri::AppHandle,
    current_name: String,
    policy: Policy,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    let current_name = name(&current_name)?;
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    cleaner.begin_identity_change();
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let result = (|| {
            let mut store =
                store::Store::open(&vault(&worker)?, &crate::cleaner::identity::root()?)?;
            store.save_current(&current_name, &policy, &reporter)?;
            crate::browser::sync_current_launch_args(&worker);
            state(&worker)
        })();
        if let Err(e) = &result {
            reporter.fail(e);
        }
        result
    })
    .await
    .map_err(|_| "身份备份中断，请重试。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}
#[tauri::command]
pub async fn identities_switch(
    app: tauri::AppHandle,
    target_id: String,
    current_name: String,
    policy: Policy,
    recover: bool,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    let current_name = name(&current_name)?;
    if target_id != "empty" && !valid_id(&target_id) {
        return Err("身份编号无效。".into());
    }
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    cleaner.begin_identity_change();
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let result = crate::browser::switch_identity(&worker, &reporter, || {
            let mut store =
                store::Store::open(&vault(&worker)?, &crate::cleaner::identity::root()?)?;
            if recover {
                store.recover(&current_name, &reporter)?;
            } else {
                store.switch(&target_id, &current_name, &policy, &reporter)?;
            }
            Ok(())
        })
        .and_then(|_| state(&worker));
        if let Err(e) = &result {
            reporter.fail(e);
        }
        result
    })
    .await
    .map_err(|_| "身份切换中断；请使用恢复操作。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}
#[tauri::command]
pub async fn identities_rename(
    app: tauri::AppHandle,
    id: String,
    value: String,
) -> Result<State, String> {
    if !valid_id(&id) {
        return Err("身份编号无效。".into());
    }
    let value = name(&value)?;
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    cleaner.begin_identity_change();
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let db = database::Database::open(&vault(&worker)?)?;
        if db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        db.rename(&id, &value)?;
        state(&worker)
    })
    .await
    .map_err(|_| "身份名称保存被中断。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}

#[tauri::command]
pub async fn identities_delete(
    app: tauri::AppHandle,
    id: String,
    policy: Policy,
    delete_browser: Option<bool>,
    on_progress: Channel<Progress>,
) -> Result<State, String> {
    if id != "current" && !valid_id(&id) {
        return Err("身份编号无效。".into());
    }
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    cleaner.begin_identity_change();
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        let action = || {
            let mut store =
                store::Store::open(&vault(&worker)?, &crate::cleaner::identity::root()?)?;
            store.delete(&id, &policy, &reporter)?;
            Ok(())
        };
        let result = if id == "current" {
            crate::browser::identity_action(&worker, &reporter, action)
        } else {
            crate::browser::delete_saved(&worker, &id, delete_browser.unwrap_or(false), action)
        }
        .and_then(|_| state(&worker));
        if let Err(e) = &result {
            reporter.fail(e);
        }
        result
    })
    .await
    .map_err(|_| "直接删除中断；请刷新检查剩余数据。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}

#[tauri::command]
pub async fn identities_browser(
    app: tauri::AppHandle,
    enabled: bool,
    use_existing: bool,
) -> Result<State, String> {
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    cleaner.begin_identity_change();
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(None);
        crate::browser::configure_identity(&worker, &reporter, || {
            let mut db = database::Database::open(&vault(&worker)?)?;
            let current =
                catalog::current_id(&vault(&worker)?, &crate::cleaner::identity::root()?, &db)?;
            db.configure_browser(enabled, use_existing, current.as_deref())
        })?;
        state(&worker)
    })
    .await
    .map_err(|_| "浏览器联动设置被中断，请刷新。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}
