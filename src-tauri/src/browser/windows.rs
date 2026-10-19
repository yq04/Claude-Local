// [INPUT]: Windows Chromium 引擎、资源目录、共用资料/随机令牌会话与独立 Claude-Local-Browser 注册名称空间。
// [OUTPUT]: 本地引擎发现与启动、用户主动注册本地版默认浏览器及纯内存名称空间回归。
// [POS]: browser 编排的 Windows 平台实现；只接收 URL/文件入口，不执行用户提供的 shell。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use std::os::windows::process::CommandExt;
fn register(_: &Path) -> Result<(), String> {
    Ok(())
}
const REGISTRATION_SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
$base='HKCU:\Software\Clients\StartMenuInternet\Claude-Local-Browser'
$cap=$base+'\Capabilities'
$class='HKCU:\Software\Classes\Claude-Local-Browser.URL'
$html='HKCU:\Software\Classes\Claude-Local-Browser.HTML'
$icon='"'+$env:CCBAGA_ICON+'",0'
$command='"'+$env:CCBAGA_EXE+'" --browser "%1"'
foreach($key in @($base,$cap,($cap+'\URLAssociations'),$class,($class+'\shell\open\command'),($class+'\DefaultIcon'),($base+'\shell\open\command'),($cap+'\FileAssociations'),($html+'\shell\open\command'),($html+'\DefaultIcon'),($base+'\DefaultIcon'))) { New-Item -Path $key -Force | Out-Null }
Set-Item -LiteralPath $base -Value 'Claude-Local-Browser'
Set-ItemProperty -LiteralPath $cap -Name ApplicationName -Value 'Claude-Local-Browser'
Set-ItemProperty -LiteralPath $cap -Name ApplicationDescription -Value 'Claude-Local companion browser'
Set-ItemProperty -LiteralPath $cap -Name ApplicationIcon -Value $icon
foreach($extension in @('.htm','.html')) { Set-ItemProperty -LiteralPath ($cap+'\FileAssociations') -Name $extension -Value 'Claude-Local-Browser.HTML' }
Set-Item -LiteralPath $html -Value 'Claude-Local-Browser HTML'
Set-Item -LiteralPath ($html+'\shell\open\command') -Value $command
Set-Item -LiteralPath ($html+'\DefaultIcon') -Value $icon
Set-Item -LiteralPath ($base+'\DefaultIcon') -Value $icon
foreach($protocol in @('http','https')) { Set-ItemProperty -LiteralPath ($cap+'\URLAssociations') -Name $protocol -Value 'Claude-Local-Browser.URL' }
Set-Item -LiteralPath $class -Value 'Claude-Local-Browser URL'
Set-ItemProperty -LiteralPath $class -Name 'URL Protocol' -Value ''
Set-Item -LiteralPath ($class+'\shell\open\command') -Value $command
Set-Item -LiteralPath ($base+'\shell\open\command') -Value $command
Set-Item -LiteralPath ($class+'\DefaultIcon') -Value $icon
New-Item -Path 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
Set-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name 'Claude-Local-Browser' -Value 'Software\Clients\StartMenuInternet\Claude-Local-Browser\Capabilities'
"#;
fn register_default() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "无法定位 Claude-Local。")?;
    let status = Command::new("powershell")
        .creation_flags(0x08000000)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            REGISTRATION_SCRIPT,
        ])
        .env("CCBAGA_EXE", &exe)
        .env(
            "CCBAGA_ICON",
            exe.parent()
                .unwrap()
                .join("browser-runtime/icons/browser.ico"),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "无法注册 Windows 浏览器入口。")?;
    if !status.success() {
        return Err("无法注册 Windows 浏览器入口。".into());
    }
    Ok(())
}

fn binary(engine: &Path) -> PathBuf {
    engine.join("chrome.exe")
}

fn packaged_engine(resources: &Path) -> PathBuf {
    let legacy = resources.join("browser-runtime/WindowsBrowser");
    if binary(&legacy).is_file() {
        return legacy;
    }
    resources.join("WindowsBrowser")
}

fn engine(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resources = app.path().resource_dir().map_err(|_| "资源目录不可用。")?;
    let packaged = packaged_engine(&resources);
    if binary(&packaged).is_file() || !cfg!(debug_assertions) {
        return Ok(packaged);
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/WindowsBrowser"))
}

fn prepare_engine(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let engine = engine(app)?;
    if !binary(&engine).is_file() {
        return Err(
            "Windows 指纹浏览器引擎缺失。请先运行 python scripts/fetch-browser.py 下载并准备引擎。"
                .into(),
        );
    }
    Ok(engine)
}

fn version(engine: &Path) -> String {
    fs::read_to_string(engine.join("version.txt"))
        .unwrap_or_default()
        .trim()
        .into()
}

pub fn open_urls(app: tauri::AppHandle, args: Vec<String>) {
    let urls = args
        .into_iter()
        .skip(1)
        .filter(|s| {
            s.starts_with("https://")
                || s.starts_with("http://")
                || s.starts_with("file://")
                || Path::new(s).is_absolute()
        })
        .collect::<Vec<_>>();
    std::thread::spawn(move || {
        if let Err(error) = start_windows_companion(&app, &urls) {
            eprintln!("Claude-Local-Browser: {error}");
        }
    });
}

fn start_windows_companion(app: &tauri::AppHandle, urls: &[String]) -> Result<(), String> {
    crate::startup_trace("companion entry");
    let state = app.state::<Browser>();
    let _guard = state.gate.lock().unwrap();
    let engine = prepare_engine(app)?;
    crate::startup_trace("engine ready");
    let root = root(app)?;
    let settings = workspaces::ensure(&root)?;
    let profile = settings.join("profile");
    profile::check_path(&root, &profile)?;
    let config = config::load(&settings)?;
    crate::startup_trace("config ready");
    let machine = config::machine()?;
    crate::startup_trace("machine ready");
    config.validate(&machine)?;
    let running = profile::running(&profile)?;
    if !running {
        profile::preferences(&profile, &config, &machine)?;
    }
    write_launch_args(&root, &config, &machine, &profile, &version(&engine))?;
    workspaces::unblock(&root)?;
    crate::startup_trace("preferences ready");
    let reuse_running = !urls.is_empty() && running && state.session.lock().unwrap().is_some();
    let mut cmd_args = if reuse_running {
        let mut a = config::arguments(&config, &machine, &profile, "", &version(&engine));
        a.pop();
        a
    } else {
        let page = open_session(app, &config, &machine, version(&engine))?;
        crate::startup_trace("session ready");
        config::arguments(&config, &machine, &profile, &page, &version(&engine))
    };
    cmd_args.extend_from_slice(urls);
    let mut child = Command::new(binary(&engine))
        .args(cmd_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动 Windows Chromium 浏览器。请检查引擎文件与依赖。".to_string())?;
    crate::startup_trace("companion spawned");
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn default_associations_match(http: &str, https: &str) -> bool {
    http.eq_ignore_ascii_case("Claude-Local-Browser.URL")
        && https.eq_ignore_ascii_case("Claude-Local-Browser.URL")
}

fn default_read() -> Result<DefaultBrowser, String> {
    use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
    let read = |protocol| {
        crate::windows::registry_string(HKEY_CURRENT_USER, &format!(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{protocol}\UserChoice"), "ProgId").unwrap_or_default()
    };
    let http = read("http");
    let https = read("https");
    let is_default = default_associations_match(&http, &https);
    let exe = std::env::current_exe().map_err(|_| "无法定位 Claude-Local。")?;
    let installed = exe
        .parent()
        .is_some_and(|folder| binary(&packaged_engine(folder)).is_file());
    Ok(DefaultBrowser {
        is_default,
        http,
        https,
        installed,
        app: std::env::current_exe()
            .map_err(|_| "无法定位 Claude-Local。")?
            .display()
            .to_string(),
    })
}

#[tauri::command]
pub async fn browser_set_default(app: tauri::AppHandle) -> Result<DefaultBrowser, String> {
    run(move || {
        prepare_engine(&app)?;
        register_default()?;
        crate::windows::open_external_url(
            "ms-settings:defaultapps?registeredAppUser=Claude-Local-Browser",
        )?;
        default_read()
    })
    .await
}

#[cfg(test)]
mod windows_browser_tests {
    use super::*;
    #[test]
    fn local_browser_namespace_preserves_official_associations() {
        assert!(default_associations_match(
            "Claude-Local-Browser.URL",
            "claude-local-browser.url"
        ));
        for (http, https) in [
            ("Claude-Local Browser.URL", "Claude-Local Browser.URL"),
            ("Claude-Local-Browser.URL", "Claude-Local Browser.URL"),
            ("Claude-Local Browser.URL", "Claude-Local-Browser.URL"),
            ("", ""),
        ] {
            assert!(!default_associations_match(http, https));
        }
        for path in [
            r"HKCU:\Software\Clients\StartMenuInternet\Claude-Local-Browser",
            r"HKCU:\Software\Classes\Claude-Local-Browser.URL",
            r"HKCU:\Software\Classes\Claude-Local-Browser.HTML",
        ] {
            assert!(REGISTRATION_SCRIPT.contains(path));
        }
        assert!(!REGISTRATION_SCRIPT.contains("Claude-Local Browser"));
        let installer = include_str!("../../windows/installer-hooks.nsh");
        assert!(installer.contains(r"$SMPROGRAMS\Claude-Local-Browser.lnk"));
        assert!(installer.contains(r"$INSTDIR\claude-local.exe"));
        assert!(!installer.contains("Claude-Local Browser"));
        assert!(!installer.contains("requirement-french.exe"));
    }
    #[test]
    fn ci_registration_preserves_default_associations() {
        if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true") {
            return;
        }
        use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
        let key = r"Software\Clients\StartMenuInternet\Claude-Local-Browser\Capabilities";
        assert!(
            crate::windows::registry_string(HKEY_CURRENT_USER, key, "ApplicationName").is_none()
        );
        let before = default_read().unwrap();
        register_default().unwrap();
        let read =
            |path: &str, name: &str| crate::windows::registry_string(HKEY_CURRENT_USER, path, name);
        assert_eq!(
            read(key, "ApplicationName").as_deref(),
            Some("Claude-Local-Browser")
        );
        for protocol in ["http", "https"] {
            assert_eq!(
                read(&format!(r"{key}\URLAssociations"), protocol).as_deref(),
                Some("Claude-Local-Browser.URL")
            );
        }
        let command = read(
            r"Software\Classes\Claude-Local-Browser.URL\shell\open\command",
            "",
        )
        .unwrap();
        assert_eq!(
            command,
            format!(
                "\"{}\" --browser \"%1\"",
                std::env::current_exe().unwrap().display()
            )
        );
        let after = default_read().unwrap();
        assert_eq!(before.http, after.http);
        assert_eq!(before.https, after.https);
        let status = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", r"Remove-Item -LiteralPath 'HKCU:\Software\Clients\StartMenuInternet\Claude-Local-Browser','HKCU:\Software\Classes\Claude-Local-Browser.URL','HKCU:\Software\Classes\Claude-Local-Browser.HTML' -Recurse -Force; Remove-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name 'Claude-Local-Browser'"]).status().unwrap();
        assert!(status.success());
    }
}
