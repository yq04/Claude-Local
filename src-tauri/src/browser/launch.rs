// [INPUT]: 当前身份的浏览器资料、配置、原生引擎与进度通道；`launch_locked`/`launch_with_urls_locked` 由已持 Browser gate（且外层已按偏序持有 SlotGate）的调用方复用，`browser_launch` 经 `with_active_slot_gate` 连续持有 `SlotGate(active)` 并仅在 Phase 1 与最终 snapshot 短取 `Browser::gate`。
// [OUTPUT]: 唯一启动过程（含非零种子持久化补全、回环代理 300ms TCP 预检、受限主机无代理直连拦截与 60s 缓存出口国家门禁、热态配置漂移受控重启与极简 3 参数热转发），验证实际进程和回环会话、在所有未确认退出/错误路径回收子进程句柄并清理 `session`/`launched_configs`/`launch.snapshot.json`，同时重置断流急停告警与唤醒断流监控。
// [POS]: 身份联动和手动启动共用的同步核心，避免重复锁、长轮询占锁和不同资料路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;

const LAUNCH_BACKOFF_MS: &[u64] = &[
    25, 25, 25, 25, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 100, 100, 100, 100, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
];

pub(super) struct PendingLaunch {
    slot: String,
    scope: PathBuf,
    profile: PathBuf,
    child: std::process::Child,
    urls: Vec<String>,
}

pub(super) enum SpawnOutcome {
    AlreadyReady(Snapshot),
    WaitRunning(PendingLaunch),
}

pub(super) fn prepare_slot_singleton_for_launch(root: &Path, profile: &Path) -> Result<(), String> {
    profile::check_path(root, profile)?;
    #[cfg(windows)]
    {
        for name in ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"] {
            let p = profile.join(name);
            let Ok(meta) = fs::symlink_metadata(&p) else {
                continue;
            };
            if crate::cleaner::linked(&meta) {
                return Err("检测到浏览器单例锁异常链接，已拒绝启动。".into());
            }
            if !crate::windows::owned(&p) {
                return Err("浏览器单例锁所有者不匹配，已拒绝启动。".into());
            }
            if name != "lockfile" && !profile::running_uncached(profile)? {
                let _ = fs::remove_file(&p);
            }
        }
    }
    #[cfg(unix)]
    {
        let running = profile::running_uncached(profile)?;
        for name in ["SingletonLock", "SingletonCookie", "SingletonSocket"] {
            let p = profile.join(name);
            let Ok(meta) = fs::symlink_metadata(&p) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                let target = fs::read_link(&p).map_err(|_| "无法读取浏览器单例锁。".to_string())?;
                if name == "SingletonLock" {
                    let s = target.to_string_lossy();
                    let valid_lock_shape = s
                        .rsplit_once('-')
                        .is_some_and(|(host, pid)| {
                            !host.is_empty() && !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit())
                        });
                    if !valid_lock_shape && target.exists() {
                        return Err("检测到浏览器单例锁异常链接，已拒绝启动。".into());
                    }
                } else {
                    let resolved = if target.is_absolute() {
                        target
                    } else {
                        profile.join(target)
                    };
                    if resolved.exists() && !resolved.starts_with(profile) {
                        return Err("检测到浏览器单例锁外部链接，已拒绝启动。".into());
                    }
                }
            }
            if !running {
                let _ = fs::remove_file(&p);
            }
        }
    }
    Ok(())
}

pub(super) fn wait_scope_launch_ready(
    profile: &Path,
    child: &mut std::process::Child,
) -> Result<(), String> {
    for &delay_ms in LAUNCH_BACKOFF_MS {
        if profile::running_uncached(profile)? {
            return Ok(());
        }
        match child.try_wait() {
            Ok(Some(_)) => return Err("浏览器启动后立即退出，请检查引擎完整性。".into()),
            Ok(None) => {}
            Err(_) => return Err("无法读取浏览器状态。".into()),
        }
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    }
    if profile::running_uncached(profile)? {
        return Ok(());
    }
    Err("浏览器仍在启动，请刷新状态。".into())
}

pub(super) fn launch_locked(app: &tauri::AppHandle, log: &Reporter) -> Result<Snapshot, String> {
    launch_with_urls_locked(app, log, &[])
}

pub(super) fn launch_with_urls_locked(
    app: &tauri::AppHandle,
    log: &Reporter,
    urls: &[&str],
) -> Result<Snapshot, String> {
    match spawn_with_urls_locked(app, log, urls)? {
        SpawnOutcome::AlreadyReady(snap) => Ok(snap),
        SpawnOutcome::WaitRunning(pending) => {
            wait_child_running_with_lock(app, pending, log, false)
        }
    }
}

pub(super) fn wait_launched_holding_slot_gate(
    app: &tauri::AppHandle,
    pending: PendingLaunch,
    log: &Reporter,
) -> Result<Snapshot, String> {
    wait_child_running_with_lock(app, pending, log, true)
}

fn cleanup_unverified_pending(
    state: &Browser,
    scope: &Path,
    slot: &str,
    mut child: std::process::Child,
    reap_in_background: bool,
) {
    let mut session = state.session.lock().unwrap();
    if session.as_ref().is_some_and(|s| s.slot == slot) {
        *session = None;
    }
    drop(session);
    state.clear_launched_config(scope, slot);
    if reap_in_background {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

fn wait_child_running_with_lock(
    app: &tauri::AppHandle,
    mut pending: PendingLaunch,
    log: &Reporter,
    acquire_gate_for_snapshot: bool,
) -> Result<Snapshot, String> {
    let state = app.state::<Browser>();
    for &delay_ms in LAUNCH_BACKOFF_MS {
        match profile::running_uncached(&pending.profile) {
            Ok(true) => {
                super::kill_switch::on_managed_browser_spawned(app, true);
                let ok_msg = if pending.urls.iter().any(|u| u == USAGE_SETTINGS_URL) {
                    "已请求打开官方用量页。"
                } else {
                    "浏览器已启动，等待起始页上报真实指纹与出口。"
                };
                log.log("browser", "ok", ok_msg, 0, None);
                let mut child = pending.child;
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return if acquire_gate_for_snapshot {
                    let _guard = state.gate.lock().unwrap();
                    snapshot(app)
                } else {
                    snapshot(app)
                };
            }
            Ok(false) => {}
            Err(err) => {
                cleanup_unverified_pending(&state, &pending.scope, &pending.slot, pending.child, true);
                return Err(err);
            }
        }
        match pending.child.try_wait() {
            Ok(Some(_)) => {
                cleanup_unverified_pending(
                    &state,
                    &pending.scope,
                    &pending.slot,
                    pending.child,
                    false,
                );
                return Err("浏览器启动后立即退出，请检查引擎完整性。".into());
            }
            Ok(None) => {}
            Err(_) => {
                cleanup_unverified_pending(
                    &state,
                    &pending.scope,
                    &pending.slot,
                    pending.child,
                    true,
                );
                return Err("无法读取浏览器状态。".into());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    }
    match profile::running_uncached(&pending.profile) {
        Ok(true) => {
            super::kill_switch::on_managed_browser_spawned(app, true);
            let ok_msg = if pending.urls.iter().any(|u| u == USAGE_SETTINGS_URL) {
                "已请求打开官方用量页。"
            } else {
                "浏览器已启动，等待起始页上报真实指纹与出口。"
            };
            log.log("browser", "ok", ok_msg, 0, None);
            let mut child = pending.child;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return if acquire_gate_for_snapshot {
                let _guard = state.gate.lock().unwrap();
                snapshot(app)
            } else {
                snapshot(app)
            };
        }
        Ok(false) => {}
        Err(err) => {
            cleanup_unverified_pending(&state, &pending.scope, &pending.slot, pending.child, true);
            return Err(err);
        }
    }
    let mut child = pending.child;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Err("浏览器仍在启动，请刷新状态。".into())
}

pub(super) fn spawn_with_urls_locked(
    app: &tauri::AppHandle,
    log: &Reporter,
    urls: &[&str],
) -> Result<SpawnOutcome, String> {
    let state = app.state::<Browser>();
    workspaces::ready(&root(app)?)?;
    workspaces::ensure(&root(app)?)?;
    *app.state::<Browser>().warning.lock().unwrap() = None;
    log.log(
        "browser",
        "running",
        "检查独立浏览器配置与资料占用。",
        0,
        None,
    );
    let root = root(app)?;
    let settings = workspaces::scope(&root)?;
    let slot = slot_name_for_scope(&settings);
    let profile = settings.join("profile");
    profile::check_path(&root, &profile)?;
    let mut running = profile::running(&profile)?;
    let config = load_config_ensured_seed(&root, &settings, Some(&slot))?;
    let machine = config::machine()?;
    config.validate(&machine)?;
    let options = config::LaunchOptions::for_purpose(config::LaunchPurpose::Verification);
    let desired = LaunchRuntimeSnapshot::from_config_with_options(&config, &machine, options);
    super::kill_switch::ensure_launch_route_healthy_when_triggered(app, Some(&slot), &config, &machine)?;
    if running
        && state
            .read_launched_config(&settings, &slot)
            .as_ref()
            .is_some_and(|prev| prev != &desired)
    {
        config::preflight_browser_launch_policy(&config, &machine, true)?;
        profile::quit(&profile)?;
        state.clear_launched_config(&settings, &slot);
        running = false;
    } else {
        config::preflight_browser_launch_policy(&config, &machine, !running)?;
    }
    let engine = prepare_engine(app)?;
    register(&engine)?;
    let binary = binary(&engine);
    if !binary.is_file() {
        return Err("内置浏览器引擎不可用。".into());
    }
    write_launch_args(&root, &config, &machine, &profile, &version(&engine))?;

    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(settings.join("engine.log"))
        .map_err(|_| "浏览器诊断日志不可用。")?;

    let has_session = state.session.lock().unwrap().is_some();
    if running && has_session && !urls.is_empty() {
        log.log(
            "browser",
            "running",
            "浏览器正在运行：沿用当前会话与资料打开目标页面。",
            0,
            None,
        );
        let mut cmd_args = vec![
            format!("--user-data-dir={}", profile.display()),
            "--profile-directory=Default".into(),
        ];
        for url in urls {
            cmd_args.push((*url).to_string());
        }
        let mut child = Command::new(binary)
            .args(cmd_args)
            .stdin(Stdio::null())
            .stdout(file.try_clone().map_err(|_| "浏览器日志不可用。")?)
            .stderr(file)
            .spawn()
            .map_err(|_| "无法在已运行的伴生浏览器中打开目标页面。")?;
        super::kill_switch::on_managed_browser_spawned(app, true);
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        let ok_msg = if urls.iter().any(|u| *u == USAGE_SETTINGS_URL) {
            "已请求打开官方用量页。"
        } else {
            "目标页面已调起。"
        };
        log.log("browser", "ok", ok_msg, 1, Some(1));
        return Ok(SpawnOutcome::AlreadyReady(snapshot(app)?));
    }

    if !running {
        prepare_slot_singleton_for_launch(&root, &profile)?;
        profile::preferences(&profile, &config, &machine)?;
    } else {
        log.log(
            "browser",
            "running",
            "浏览器正在运行：打开 Default 实测页，沿用当前进程参数，不改写正在使用的资料。",
            0,
            None,
        );
    }
    let page = open_session(app, &config, &machine, version(&engine))?;
    let mut cmd_args = config::arguments_with_options(
        &config,
        &machine,
        &profile,
        &page,
        &version(&engine),
        options,
    );
    for url in urls {
        cmd_args.push((*url).to_string());
    }
    profile::invalidate_running_memo(&profile);
    let child = Command::new(binary)
        .args(cmd_args)
        .stdin(Stdio::null())
        .stdout(file.try_clone().map_err(|_| "浏览器日志不可用。")?)
        .stderr(file)
        .spawn()
        .map_err(|_| "浏览器启动失败。")?;
    if !running {
        state.record_launched_config(&settings, &slot, &desired);
    }
    super::kill_switch::on_managed_browser_spawned(app, false);
    Ok(SpawnOutcome::WaitRunning(PendingLaunch {
        slot,
        scope: settings,
        profile,
        child,
        urls: urls.iter().map(|u| (*u).to_string()).collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_exiting_helper() -> std::process::Child {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            Command::new("cmd")
                .creation_flags(0x0800_0000)
                .args(["/C", "exit", "0"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-c", "exit 0"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        }
    }

    #[test]
    fn cleanup_unverified_pending_clears_matching_slot_state_and_preserves_other_sessions() {
        let scope = crate::browser::tests::sample();
        let state = Browser::default();
        let snap = LaunchRuntimeSnapshot {
            proxy: String::new(),
            effective_proxy: String::new(),
            region_id: "US".into(),
            language: "en-US".into(),
            timezone: "America/New_York".into(),
            seed: 42,
            native_graphics: false,
            enable_quota_bridge: false,
        };
        state.record_launched_config(&scope, "slot_a", &snap);
        assert!(scope.join("launch.snapshot.json").is_file());

        *state.session.lock().unwrap() = Some(Session {
            token: "tok-other".into(),
            slot: "slot_other".into(),
            config: Config::default(),
            received_at: None,
            report: None,
        });
        let mut child1 = spawn_exiting_helper();
        let _ = child1.wait();
        cleanup_unverified_pending(&state, &scope, "slot_a", child1, false);
        assert!(state.read_launched_config(&scope, "slot_a").is_none());
        assert!(!scope.join("launch.snapshot.json").exists());
        assert_eq!(
            state
                .session
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.slot.as_str()),
            Some("slot_other")
        );

        state.record_launched_config(&scope, "slot_a", &snap);
        *state.session.lock().unwrap() = Some(Session {
            token: "tok-a".into(),
            slot: "slot_a".into(),
            config: Config::default(),
            received_at: None,
            report: None,
        });
        let child2 = spawn_exiting_helper();
        cleanup_unverified_pending(&state, &scope, "slot_a", child2, true);
        assert!(state.read_launched_config(&scope, "slot_a").is_none());
        assert!(!scope.join("launch.snapshot.json").exists());
        assert!(state.session.lock().unwrap().is_none());

        fs::remove_dir_all(scope).unwrap();
    }
}
