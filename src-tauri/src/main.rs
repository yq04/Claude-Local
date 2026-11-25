// [INPUT]: macOS/Linux/Windows 平台边界、Tauri 生命周期、发布构建 custom-protocol 与清理、CLI 安装管理、浏览器、地区、系统及系统修改记录/恢复命令、固定网络资源导航与风控 DNS/跨域名只读核验、独立界面语言与本地 Token 统计命令；独立本地版不加载上游更新或重启插件，浏览器仅显式启动。
// [OUTPUT]: Claude-Local 独立窗口及尺寸记忆、有界 Tokio 运行时与 Windows 托盘隐藏 WebView2 深睡（不可见/低内存目标/空闲 TrySuspend/修剪工作集，恢复时 Resume+正常内存目标）、托盘、SQLite 身份暂存/一键无残留恢复与轻量实时会话查询（identities_live_sessions）、交接检查点查询/关闭（identities_latest_handoff / identities_dismiss_handoff）、原生 SmartRelay 接力配置/包装器与子代理模板部署/一键接力终端拉起与多路子代理隔离槽位命令、浏览器养号与出口一致性探针/只读运行状态/断流急停守护与冻结CLI归属返回、有界在线额度、脱敏 Token 聚合、文件残留清理、CLI 管理、系统恢复与风控核验；--quota-core 与 --orchestrate 在 GUI 初始化前处理纯 JSON 协议。
// [POS]: 应用编排层；setup注册唯一进程级唤醒owner、主窗状态恢复、monitor偏好恢复（create:false 按需创建、关闭即销毁）与伴生浏览器断流急停监控，实际Exit停止；主窗 CloseRequested 深睡隐藏托盘，monitor CloseRequested 直接销毁。不读取翻译设置或API密钥。
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
// ----- 托盘隐藏深睡：仅在无清理/额度批次/续杯进行时挂起主窗 WebView2 -----
fn background_work_active(app: &tauri::AppHandle) -> bool {
    let cleaner_busy = app
        .try_state::<cleaner::Cleaner>()
        .is_some_and(|cleaner| cleaner.is_busy());
    let quota_batch_active = identities::online::identities_quota_batch_state(app.clone(), None)
        .ok()
        .flatten()
        .is_some_and(|batch| {
            matches!(
                batch.state,
                identities::online::QuotaTaskState::Queued
                    | identities::online::QuotaTaskState::Running
                    | identities::online::QuotaTaskState::Cancelling
            )
        });
    let wakeup_active = app
        .try_state::<identities::wakeup::WakeupOwner>()
        .is_some_and(|owner| owner.is_busy());
    cleaner_busy || quota_batch_active || wakeup_active
}
#[cfg(windows)]
mod webview_sleep {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    // 托盘隐藏：WebView 不可见 + 低内存目标；空闲时 TrySuspend，最后修剪宿主工作集。
    pub(crate) fn sleep(window: &tauri::WebviewWindow, allow_suspend: bool) {
        let _ = window.with_webview(move |webview| unsafe {
            let controller = webview.controller();
            let _ = controller.SetIsVisible(false);
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ = core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
                }
                if allow_suspend {
                    if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                        let handler = webview2_com::TrySuspendCompletedHandler::create(Box::new(
                            |_result, _suspended| Ok(()),
                        ));
                        let _ = core3.TrySuspend(&handler);
                    }
                }
            }
            use windows_sys::Win32::System::Threading::{
                GetCurrentProcess, SetProcessWorkingSetSize,
            };
            let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
        });
    }
    // 托盘恢复：先 Resume 与恢复正常内存目标，再让控制器可见。
    pub(crate) fn wake(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|webview| unsafe {
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                    let _ = core3.Resume();
                }
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ =
                        core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
                }
            }
            let _ = controller.SetIsVisible(true);
        });
    }
}
fn hide_main_to_tray(window: &tauri::WebviewWindow) {
    let _ = window.eval("document.documentElement.dataset.windowHidden='true'");
    let _ = window.hide();
    #[cfg(windows)]
    webview_sleep::sleep(window, !background_work_active(window.app_handle()));
    #[cfg(not(windows))]
    let _ = background_work_active;
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(windows)]
        webview_sleep::wake(&window);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("delete document.documentElement.dataset.windowHidden");
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
    if let Some(code) = identities::orchestrator::headless(&std::env::args().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    startup_trace("host entry");
    // 有界 Tokio 运行时：2 个工作线程、最多 8 个阻塞线程，空闲 5 秒回收；须在 Builder 前注册并在 main 内存活。
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(8)
        .thread_keep_alive(std::time::Duration::from_secs(5))
        .thread_name("claude-local-rt")
        .enable_all()
        .build()
        .expect("无法启动 Claude-Local 运行时");
    tauri::async_runtime::set(runtime.handle().clone());
    let _runtime = runtime;
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
            monitor_window::setup(app.handle());
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
                    "monitor" => monitor_window::toggle_open_from_tray(app),
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
                // 仅主窗隐藏到托盘；monitor 关闭即销毁，不保留 WebView2。
                if window.label() == "main" {
                    api.prevent_close();
                    if let Some(main) = window.app_handle().get_webview_window("main") {
                        hide_main_to_tray(&main);
                    } else {
                        let _ = window.hide();
                    }
                }
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
            monitor_window::monitor_window_set_click_through,
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
            identities::identities_live_sessions,
            identities::handoff::identities_latest_handoff,
            identities::handoff::identities_dismiss_handoff,
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
            identities::orchestrator::identities_orchestrator_state,
            identities::orchestrator::identities_orchestrator_configure,
            identities::orchestrator::identities_orchestrator_clear_cooldown,
            identities::orchestrator::identities_install_cli_wrappers,
            identities::orchestrator::identities_release_cli_slot,
            identities::orchestrator::identities_launch_relay_cli,
            identities::identities_sync_browser_proxy,
            browser::quota_bridge::identities_sync_subscription,
            identities::usage::usage_statistics_read,
            identities::usage::logs::usage_request_logs_read,
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
