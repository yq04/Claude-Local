// [INPUT]: 当前身份的浏览器资料、配置、原生引擎与进度通道；调用方已持有 Browser gate。
// [OUTPUT]: 唯一启动过程，验证实际进程和回环会话，失败不冒充成功。
// [POS]: 身份联动和手动启动共用的同步核心，避免重复锁和不同资料路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
pub(super) fn launch_locked(app: &tauri::AppHandle, log: &Reporter) -> Result<Snapshot, String> {
    let state = app.state::<Browser>();
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
    let profile = settings.join("profile");
    profile::check_path(&root, &profile)?;
    let running = profile::running(&profile)?;
    let config = config::load(&workspaces::scope(&root)?)?;
    let machine = config::machine()?;
    config.validate(&machine)?;
    let engine = prepare_engine(app)?;
    register(&engine)?;
    let binary = binary(&engine);
    if !binary.is_file() {
        return Err("内置浏览器引擎不可用。".into());
    }
    write_launch_args(&root, &config, &machine, &profile, &version(&engine))?;
    if !running {
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
    *state.host.lock().unwrap() = None;
    let page = open_session(app, &config, &machine, version(&engine))?;
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(settings.join("engine.log"))
        .map_err(|_| "浏览器诊断日志不可用。")?;
    let mut child = Command::new(binary)
        .args(config::arguments(
            &config,
            &machine,
            &profile,
            &page,
            &version(&engine),
        ))
        .stdin(Stdio::null())
        .stdout(file.try_clone().map_err(|_| "浏览器日志不可用。")?)
        .stderr(file)
        .spawn()
        .map_err(|_| "浏览器启动失败。")?;
    for _ in 0..100 {
        if profile::running(&profile)? {
            log.log(
                "browser",
                "ok",
                "浏览器已启动，等待起始页上报真实指纹与出口。",
                0,
                None,
            );
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return snapshot(app);
        }
        if child
            .try_wait()
            .map_err(|_| "无法读取浏览器状态。")?
            .is_some()
        {
            *state.session.lock().unwrap() = None;
            return Err("浏览器启动后立即退出，请检查引擎完整性。".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Err("浏览器仍在启动，请刷新状态。".into())
}
