// [INPUT]: macOS/Linux/Windows 平台边界、Tauri 生命周期、发布构建 custom-protocol 与清理、CLI 安装管理、浏览器、地区、系统及系统修改记录/恢复命令、固定网络资源导航与风控 DNS/跨域名只读核验、独立界面语言与本地 Token 统计命令；独立本地版不加载上游更新或重启插件，浏览器仅显式启动。
// [OUTPUT]: Claude-Local 独立窗口及尺寸记忆、托盘、SQLite 身份暂存/恢复、浏览器养号与出口一致性探针/只读运行状态/断流急停守护与冻结CLI归属返回、有界在线额度、脱敏 Token 聚合、文件残留清理、CLI 管理、系统恢复与风控核验；--quota-core 在 GUI 初始化前合并纯 JSON 额度。
// [POS]: 应用编排层；setup注册唯一进程级唤醒owner与伴生浏览器断流急停监控，实际Exit停止；CloseRequested仅隐藏托盘。不读取翻译设置或API密钥。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
// ----- 发布包必须内嵌前端资源，禁止依赖开发服务 -----
#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("发布构建需要 custom-protocol；使用 tauri build 或 cargo build --release --features custom-protocol。");
mod browser;
mod claude_cli;
mod cleaner;
mod identities;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(test)]
mod local_edition_tests;
mod local_runtime;
mod monitor_window;
mod native;
mod network_links;
mod progress;
mod quota_core;
mod quota_setup;
mod regions;
mod risk_check;
mod system;
mod system_changes;
mod ui_appearance;
mod ui_language;
mod ui_privacy;
mod window_state;
mod window_state_model;
#[cfg(target_os = "windows")]
mod windows;
use tauri::{tray::TrayIconBuilder, Manager};
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
#[tauri::command]
async fn open_permissions(app: tauri::AppHandle) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(native::permissions());
    })
    .map_err(|_| "无法打开系统权限设置。")?;
    receive.await.map_err(|_| "无法打开系统权限设置。")?
}
#[tauri::command]
async fn unlock_keychain() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(native::unlock_keychain)
        .await
        .map_err(|_| "钥匙串授权被中断。".to_string())?
}
#[tauri::command]
async fn copy_result(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(native::copy(&text));
    })
    .map_err(|_| "复制失败。")?;
    receive.await.map_err(|_| "复制失败。")?
}
#[tauri::command]
fn runtime_platform() -> &'static str {
    std::env::consts::OS
}
pub(crate) fn startup_trace(stage: &str) {
    #[cfg(windows)]
    if std::env::var("GITHUB_ACTIONS").as_deref() == Ok("true") {
        // CI 只记录固定启动阶段，不读取文件正文、参数或凭据。
        let path = std::env::temp_dir().join("claude-local-ci-startup.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(file, "{stage}");
        }
    }
    let _ = stage;
}
fn main() {
    if let Some(code) = quota_core::headless(&std::env::args().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    startup_trace("host entry");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            #[cfg(target_os = "linux")]
            if args.iter().any(|arg| arg == "--browser") {
                browser::open_urls(app.clone(), args);
                return;
            }
            #[cfg(target_os = "windows")]
            if args.iter().any(|arg| arg == "--browser") {
                browser::open_urls(app.clone(), args);
                return;
            }
            let _ = args;
            show(app)
        }))
        .setup(|app| {
            startup_trace("host setup");
            app.manage(ui_language::UiLanguage::load(app.handle()));
            app.manage(ui_privacy::UiPrivacy::load(app.handle()));
            app.manage(ui_appearance::UiAppearanceState::load(app.handle()));
            app.manage(monitor_window::ManagedMonitorState::default());
            app.manage(cleaner::Cleaner::default());
            app.manage(browser::Browser::default());
            identities::wakeup::WakeupOwner::start(app.handle())?;
            window_state::setup(app.handle());
            #[cfg(target_os = "macos")]
            if local_runtime::wants_browser(&std::env::args().collect::<Vec<_>>()) {
                browser::companion(app.handle().clone());
            }
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if local_runtime::wants_browser(&std::env::args().collect::<Vec<_>>()) {
                browser::open_urls(app.handle().clone(), std::env::args().collect());
            }
            let menu = ui_language::menu(
                app.handle(),
                &ui_language::ui_language_read(app.handle().clone()),
            )?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Claude-Local")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "quit" => {
                        window_state::flush(app);
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;
            browser::kill_switch::spawn_monitor(app.handle().clone());
            startup_trace("host ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            window_state::on_window_event(window, event);
            monitor_window::on_window_event(window, event);
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            ui_language::ui_language_read,
            ui_language::ui_language_write,
            ui_privacy::ui_privacy_read,
            ui_privacy::ui_privacy_write,
            ui_appearance::ui_appearance_read,
            ui_appearance::ui_appearance_write,
            ui_appearance::ui_wallpaper_read,
            ui_appearance::ui_wallpaper_write,
            ui_appearance::ui_wallpaper_clear,
            monitor_window::monitor_window_state,
            monitor_window::monitor_window_set_open,
            monitor_window::monitor_window_set_always_on_top,
            monitor_window::monitor_window_set_compact,
            monitor_window::monitor_window_set_locked,
            monitor_window::monitor_window_set_auto_hide,
            monitor_window::monitor_window_set_collapsed,
            monitor_window::monitor_window_snap_edge,
            monitor_window::monitor_window_start_drag,
            monitor_window::monitor_live_telemetry,
            quota_setup::quota_setup_status,
            runtime_platform,
            open_permissions,
            unlock_keychain,
            copy_result,
            cleaner::cleaner_scan,
            cleaner::cleaner_stop,
            cleaner::cleaner_processes,
            cleaner::residue::claude_residue_scan,
            cleaner::residue::claude_residue_clean,
            identities::identities_read,
            identities::warming::identities_warming_create,
            identities::warming::identities_warming_update,
            identities::warming::identities_warming_open,
            identities::warming::identities_warming_promote,
            identities::warming::identities_warming_delete,
            identities::warming::identities_warming_probe_check,
            identities::online::identities_refresh_quota,
            identities::online::identities_wakeup_quota_window,
            identities::wakeup::identities_wakeup_state,
            identities::wakeup::identities_wakeup_configure,
            identities::wakeup::identities_wakeup_migrate,
            identities::wakeup::identities_wakeup_resume,
            identities::online::identities_refresh_all_quotas,
            identities::online::identities_quota_revision,
            identities::online::identities_quota_batch_state,
            identities::online::identities_cancel_quota_batch,
            identities::subscription::identities_set_subscription_expiry,
            browser::quota_bridge::identities_sync_subscription,
            identities::usage::usage_statistics_read,
            identities::usage::usage_attribution_read,
            identities::usage::usage_attribution_set,
            identities::usage::usage_attribution_clear,
            identities::backup::identities_backup_location,
            identities::backup::identities_backup_open_location,
            identities::backup::identities_backup_preview,
            identities::backup::identities_backup_export,
            identities::backup::identities_backup_inspect,
            identities::backup::identities_backup_restore_new,
            identities::identities_browser,
            browser::quota_connection::browser_open_identity_profile,
            identities::identities_stop,
            identities::identities_save,
            identities::identities_switch,
            identities::identities_rename,
            identities::identities_delete,
            claude_cli::claude_cli_read,
            claude_cli::claude_cli_check,
            claude_cli::claude_cli_manage,
            regions::get_regions,
            system::system_read,
            system::system_set_timezone,
            system::system_set_language,
            system::system_disable_location,
            system::system_open_settings,
            system::system_set_region,
            system::system_change_history,
            system::system_change_restore_plan,
            system::system_change_restore,
            browser::browser_read,
            browser::lifecycle::browser_runtime_read,
            browser::lifecycle::browser_return_to_cli,
            browser::browser_save,
            browser::browser_launch,
            browser::browser_quit,
            browser::browser_clear,
            browser::browser_check,
            browser::browser_align,
            browser::browser_default_read,
            browser::browser_set_default,
            browser::browser_open_usage,
            browser::kill_switch::browser_kill_switch_state,
            browser::kill_switch::browser_kill_switch_dismiss,
            browser::kill_switch::browser_kill_switch_set_enabled,
            network_links::network_diagnose_domains,
            risk_check::risk_inspect_local_env,
            risk_check::risk_probe_consistency
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 Claude-Local")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show(app),
            tauri::RunEvent::Exit => {
                if let Some(owner) = app.try_state::<identities::wakeup::WakeupOwner>() {
                    owner.stop();
                }
                window_state::flush(app);
                browser::forget_start_url(app)
            }
            _ => {}
        });
}
