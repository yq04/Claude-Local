// [INPUT]: 平台内嵌 claude-cli.sh/ps1、用户手动更新检查、固定公开版本元数据、事务锁及真实进度通道。
// [OUTPUT]: CLI 本地安装/运行状态、真实最新版本对比及原安装方式的一键更新；运行中拒绝修改，不结束 Claude 会话。
// [POS]: 本机程序安装边界；Windows 子进程丢弃继承的 PSModulePath，避免 PowerShell 7 模块污染 5.1；固定动作/事务锁限制修改，输出只含脱敏协议，测试替身仅在 cfg(test) 中注入。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use crate::{
    cleaner::Cleaner,
    progress::{Progress, Reporter},
};
use serde::Serialize;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
#[cfg(not(windows))]
const SCRIPT: &str = include_str!("../../scripts/claude-cli.sh");
#[cfg(windows)]
const SCRIPT: &str = include_str!("../../scripts/claude-cli.ps1");
#[derive(Debug, Default, Serialize)]
pub struct CliStatus {
    method: String,
    path: String,
    version: String,
    running: bool,
}
#[derive(Debug, Serialize)]
pub struct ClaudeCliUpdateStatus {
    current: CliStatus,
    latest_version: String,
    update_available: bool,
}
const LATEST_VERSION_URL: &str = "https://downloads.claude.ai/claude-code-releases/latest";
fn release_version(text: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = text.trim().split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || !part.bytes().all(|b| b.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return None;
        }
        result[index] = part.parse().ok()?;
    }
    Some(result)
}
fn compare_release(current: &str, latest: &str) -> Result<bool, String> {
    let current = current
        .split_whitespace()
        .next()
        .and_then(release_version)
        .ok_or("cli.error.currentVersion")?;
    let latest = release_version(latest).ok_or("cli.error.latestVersion")?;
    Ok(latest > current)
}
async fn latest_release(mut response: reqwest::Response) -> Result<String, String> {
    if response.status() != reqwest::StatusCode::OK {
        return Err("cli.error.checkFailed".into());
    }
    if response.content_length().is_some_and(|size| size > 64) {
        return Err("cli.error.latestVersion".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "cli.error.checkFailed")?
    {
        if chunk.len() > 64 - bytes.len() {
            return Err("cli.error.latestVersion".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let version = std::str::from_utf8(&bytes)
        .map_err(|_| "cli.error.latestVersion")?
        .trim();
    release_version(version).ok_or("cli.error.latestVersion")?;
    Ok(version.to_string())
}
fn execute(command: Command, log: Arc<Reporter>, seconds: u64) -> Result<CliStatus, String> {
    execute_script(
        command,
        log,
        seconds,
        SCRIPT.trim_start_matches('\u{feff}').to_owned(),
    )
}
fn execute_script(
    mut command: Command,
    log: Arc<Reporter>,
    seconds: u64,
    script: String,
) -> Result<CliStatus, String> {
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "无法启动 Claude Code 安装任务。")?;
    #[cfg(windows)]
    let job = match crate::windows::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let writer = std::thread::spawn(move || stdin.write_all(script.as_bytes()));
    let output = std::thread::spawn(move || {
        let mut result = CliStatus::default();
        let mut completed = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(message) = line.strip_prefix("CC_CLI_STEP=") {
                log.log("cli", "running", message, 0, None);
            }
            if let Some(value) = line.strip_prefix("CC_CLI_METHOD=") {
                result.method = value.into();
            }
            if let Some(value) = line.strip_prefix("CC_CLI_PATH=") {
                result.path = value.into();
            }
            if let Some(value) = line.strip_prefix("CC_CLI_VERSION=") {
                result.version = value.into();
            }
            if line == "CC_CLI_DONE=1" {
                completed = true;
            }
        }
        (result, completed)
    });
    let errors = std::thread::spawn(move || {
        let mut pipe = stderr;
        let mut message = Vec::new();
        let mut bytes = [0; 4096];
        while let Ok(n) = pipe.read(&mut bytes) {
            if n == 0 {
                break;
            }
            message.extend_from_slice(&bytes[..n]);
            if message.len() > 65536 {
                message.drain(..message.len() - 65536);
            }
        }
        String::from_utf8_lossy(&message).into_owned()
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < Duration::from_secs(seconds) => {
                std::thread::sleep(Duration::from_millis(100))
            }
            _ => {
                // 安装器可能带起 curl/npm；超时结束整个本次子进程组，防止后台继续修改。
                #[cfg(windows)]
                job.stop();
                #[cfg(unix)]
                unsafe {
                    kill(-(child.id() as i32), 9);
                }
                let _ = child.wait();
                break Err("Claude Code 安装任务超时，操作可能已部分完成，请重试。".to_string());
            }
        }
    };
    #[cfg(windows)]
    job.stop();
    let _ = writer.join();
    let result = output.join().map_err(|_| "Claude Code 安装任务被中断。")?;
    let errors = errors.join().map_err(|_| "Claude Code 安装任务被中断。")?;
    if !status?.success() {
        // 优先最后的回滚结论，仅显示脚本自有固定错误文案，不泄漏 shell/npm/Homebrew 输出中的配置或凭据。
        let message = errors.lines().rev().find(|line| {
            line.starts_with("Claude Code ")
                || line.starts_with("cli.error.")
                || line.starts_with("npm ")
                || line.starts_with("Homebrew ")
                || line.starts_with("无法读取 ")
                || line.starts_with("无法暂存原程序")
                || line.starts_with("发现未识别的 ")
                || line.starts_with("检测到自定义 ")
                || line.starts_with("仍有其他 ")
        });
        return Err(message
            .unwrap_or("Claude Code 安装任务失败，请检查终端环境和安装目录权限。")
            .into());
    }
    if !result.1 {
        return Err("Claude Code 安装状态回报不完整，请检查终端环境。".into());
    }
    Ok(result.0)
}
#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, signal: i32) -> i32;
}
fn command(action: &str) -> Result<Command, String> {
    #[cfg(windows)]
    {
        let user_dir = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .ok_or("无法定位用户目录。")?;
        let root =
            dunce::canonicalize(PathBuf::from(user_dir)).map_err(|_| "无法读取用户目录。")?;
        use std::os::windows::process::CommandExt;
        let shell =
            PathBuf::from(std::env::var_os("SystemRoot").ok_or("无法定位 Windows 系统目录。")?)
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(shell);
        command.creation_flags(0x08000000)
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(format!("[Console]::InputEncoding = New-Object System.Text.UTF8Encoding; & ([scriptblock]::Create([Console]::In.ReadToEnd())) '{action}'"))
            .env("CC_CLI_USER_DIR", root)
            .env_remove("PSModulePath");
        Ok(command)
    }
    #[cfg(not(windows))]
    {
        let root = std::fs::canonicalize(PathBuf::from(
            std::env::var_os("HOME").ok_or("无法定位用户目录。")?,
        ))
        .map_err(|_| "无法读取用户目录。")?;
        let mut command = Command::new("/bin/zsh");
        command
            .args(["-ilc", "source /dev/stdin", "cctool-cli", action])
            .env("CC_CLI_USER_DIR", root)
            .current_dir("/");
        Ok(command)
    }
}
#[tauri::command]
pub async fn claude_cli_read() -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut status = execute(command("read")?, Arc::new(Reporter::channel(None)), 60)?;
        status.running = crate::cleaner::cli_running()?;
        Ok(status)
    })
    .await
    .map_err(|_| "Claude Code 安装任务被中断。".to_string())?
}
#[tauri::command]
pub async fn claude_cli_check(app: tauri::AppHandle) -> Result<ClaudeCliUpdateStatus, String> {
    let current = claude_cli_read().await?;
    if current.method.is_empty() {
        return Err("cli.error.notInstalled".into());
    }
    let proxy = tauri::async_runtime::spawn_blocking(move || {
        crate::browser::configured_or_system_proxy(&app)
    })
    .await
    .map_err(|_| "cli.error.checkFailed")?;
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12));
    if !proxy.trim().is_empty() {
        builder =
            builder.proxy(reqwest::Proxy::all(proxy.trim()).map_err(|_| "cli.error.checkFailed")?);
    }
    let client = builder.build().map_err(|_| "cli.error.checkFailed")?;
    let latest_version = latest_release(
        client
            .get(LATEST_VERSION_URL)
            .send()
            .await
            .map_err(|_| "cli.error.checkFailed")?,
    )
    .await?;
    let update_available = compare_release(&current.version, &latest_version)?;
    Ok(ClaudeCliUpdateStatus {
        current,
        latest_version,
        update_available,
    })
}
#[tauri::command]
pub async fn claude_cli_manage(
    app: tauri::AppHandle,
    action: String,
    on_progress: Channel<Progress>,
) -> Result<CliStatus, String> {
    if !matches!(action.as_str(), "update" | "uninstall" | "reinstall") {
        return Err("无效的 Claude Code 安装操作。".into());
    }
    let state = app.state::<Cleaner>();
    state.enter()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let log = Arc::new(Reporter::channel(Some(on_progress)));
        let result = (|| {
            if crate::cleaner::cli_running()? {
                return Err("cli.error.running".into());
            }
            execute(command(&action)?, log.clone(), 600)
        })();
        if let Err(error) = &result {
            log.fail(error);
        }
        result
    })
    .await
    .map_err(|_| "Claude Code 安装任务被中断。".to_string())
    .and_then(|result| result);
    state.leave();
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
    };
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "cctool-cli-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(path.join("bin")).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
        fn file(&self, name: &str, text: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, text).unwrap();
            path
        }
        fn executable(&self, name: &str, text: &str) -> PathBuf {
            let path = self.file(name, text);
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            path
        }
        fn run(&self, action: &str) -> Result<CliStatus, String> {
            self.run_script(action, SCRIPT.into())
        }
        fn run_script(&self, action: &str, script: String) -> Result<CliStatus, String> {
            let mut command = Command::new("/bin/zsh");
            command
                .env_clear()
                .args([
                    "-fc",
                    "PATH=\"$CC_TEST_BIN\"; source /dev/stdin",
                    "fixture",
                    action,
                ])
                .env("HOME", &self.0)
                .env("ZDOTDIR", &self.0)
                .env("LANG", "en_US.UTF-8")
                .env("CC_CLI_USER_DIR", &self.0)
                .env("PATH", self.0.join("bin"))
                .env("CC_TEST_ROOT", self.0.join("lib/node_modules"))
                .env("CC_TEST_BINARY", self.0.join("fake-cli"))
                .env("CC_TEST_BIN", self.0.join("bin"));
            execute_script(command, Arc::new(Reporter::channel(None)), 10, script)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn native_uninstall_preserves_assets_and_rejects_custom_launchers() {
        let fixture = Fixture::new();
        fixture.file(".claude/settings.json", "personal-settings");
        fixture.file(".claude/skills/custom/SKILL.md", "personal-skill");
        let binary = fixture.executable(
            ".local/share/claude/versions/2.0",
            "#!/bin/sh\nprintf '2.0 (Claude Code)\\n'\n",
        );
        fs::create_dir_all(fixture.0.join(".local/bin")).unwrap();
        symlink(&binary, fixture.0.join(".local/bin/claude")).unwrap();
        assert_eq!(fixture.run("read").unwrap().method, "native");
        assert!(fixture.run("uninstall").unwrap().method.is_empty());
        assert!(!binary.exists());
        assert_eq!(
            fs::read_to_string(fixture.0.join(".claude/settings.json")).unwrap(),
            "personal-settings"
        );
        assert!(fixture.0.join(".claude/skills/custom/SKILL.md").exists());
        let custom = fixture.executable(".local/bin/claude", "#!/bin/sh\nexit 0\n");
        assert!(fixture.run("uninstall").unwrap_err().contains("自定义"));
        assert!(custom.exists());
    }
    #[test]
    fn native_reinstall_restores_original_and_preserves_backup_if_rollback_is_blocked() {
        for mode in ["install-failure", "invalid-version", "blocked-rollback"] {
            let fixture = Fixture::new();
            fixture.file(".claude/settings.json", "keep");
            let original = "#!/bin/sh\nprintf '2.0.0 (Claude Code)\\n'\n";
            let binary = fixture.executable(".local/share/claude/versions/2.0.0", original);
            fs::create_dir_all(fixture.0.join(".local/bin")).unwrap();
            symlink(&binary, fixture.0.join(".local/bin/claude")).unwrap();
            fixture.executable(
                "bin/curl",
                "#!/bin/sh\n/bin/cat \"$CC_CLI_USER_DIR/fixture-installer\"\n",
            );
            let installer = match mode {
                "install-failure" => "#!/bin/bash\nexit 1\n",
                "invalid-version" => "#!/bin/bash\nmkdir -p \"$CC_CLI_USER_DIR/.local/share/claude/versions\"\nexit 0\n",
                _ => "#!/bin/bash\n/bin/ln -s \"$CC_CLI_USER_DIR/outside\" \"$CC_CLI_USER_DIR/.local/share/claude\"\nexit 1\n",
            };
            fixture.file("fixture-installer", installer);
            fixture.file("outside/keep", "outside intact");
            let script = SCRIPT.replace("/usr/bin/curl", "\"$CC_CLI_USER_DIR/bin/curl\"");
            let error = fixture.run_script("reinstall", script).unwrap_err();
            if mode == "blocked-rollback" {
                assert!(error.contains("恢复文件保留"));
                assert!(!error.contains("已恢复原程序"));
                let backup = fs::read_dir(fixture.0.join(".local/share"))
                    .unwrap()
                    .filter_map(Result::ok)
                    .find(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .starts_with(".claude-reinstall.")
                    })
                    .unwrap()
                    .path();
                assert_eq!(
                    fs::read_to_string(backup.join("program/versions/2.0.0")).unwrap(),
                    original
                );
            } else {
                assert!(error.contains("已恢复原程序"), "{error}");
                assert_eq!(fs::read_to_string(&binary).unwrap(), original);
                assert_eq!(
                    fs::read_link(fixture.0.join(".local/bin/claude")).unwrap(),
                    binary
                );
            }
            assert_eq!(
                fs::read_to_string(fixture.0.join("outside/keep")).unwrap(),
                "outside intact"
            );
            assert_eq!(
                fs::read_to_string(fixture.0.join(".claude/settings.json")).unwrap(),
                "keep"
            );
        }
    }
    #[test]
    fn npm_reinstall_verifies_version_and_uninstall_is_real() {
        let fixture = Fixture::new();
        fixture.file(
            "lib/node_modules/@anthropic-ai/claude-code/package.json",
            "{\"name\":\"@anthropic-ai/claude-code\"}",
        );
        fixture.executable("fake-cli", "#!/bin/sh\nprintf '3.0 (Claude Code)\\n'\n");
        fixture.executable("bin/claude", "#!/bin/sh\nprintf '2.0 (Claude Code)\\n'\n");
        fixture.executable("bin/npm",r#"#!/bin/sh
case "$1" in
root) printf '%s\n' "$CC_TEST_ROOT" ;;
uninstall) /bin/rm -rf "$CC_TEST_ROOT/@anthropic-ai/claude-code"; /bin/rm -f "$CC_TEST_BIN/claude" ;;
install) /bin/mkdir -p "$CC_TEST_ROOT/@anthropic-ai/claude-code"; printf '{}' > "$CC_TEST_ROOT/@anthropic-ai/claude-code/package.json"; /bin/cp "$CC_TEST_BINARY" "$CC_TEST_BIN/claude" ;;
*) exit 1 ;;
esac
"#);
        assert_eq!(fixture.run("read").unwrap().version, "2.0 (Claude Code)");
        let result = fixture.run("reinstall").unwrap();
        assert_eq!(result.method, "npm");
        assert_eq!(result.version, "3.0 (Claude Code)");
        fixture.run("uninstall").unwrap();
        assert!(!fixture.0.join("bin/claude").exists());
        assert!(fixture.run("read").unwrap().method.is_empty());
    }
    #[test]
    fn failed_install_and_timeout_cannot_report_success() {
        let fixture = Fixture::new();
        fixture.file(
            "lib/node_modules/@anthropic-ai/claude-code/package.json",
            "{}",
        );
        fixture.executable(
            "bin/npm",
            "#!/bin/sh\ncase \"$1\" in root) printf '%s\\n' \"$CC_TEST_ROOT\";; *) exit 1;; esac\n",
        );
        assert!(fixture.run("reinstall").is_err());
        let mut command = Command::new("/bin/zsh");
        command.args(["-fc", "/bin/sleep 10"]);
        let began = Instant::now();
        assert!(execute(command, Arc::new(Reporter::channel(None)), 0)
            .unwrap_err()
            .contains("超时"));
        assert!(began.elapsed() < Duration::from_secs(3));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    #[test]
    fn powershell_child_rebuilds_its_own_module_path() {
        let command = super::command("read").unwrap();
        assert!(command.get_envs().any(|(key, value)| {
            key.to_string_lossy().eq_ignore_ascii_case("PSModulePath") && value.is_none()
        }));
    }
}

#[cfg(test)]
mod update_tests {
    use super::*;
    #[test]
    fn versions_compare_numerically_and_reject_untrusted_metadata() {
        assert_eq!(compare_release("2.1.9 (Claude Code)", "2.1.10"), Ok(true));
        assert_eq!(compare_release("2.1.10 (Claude Code)", "2.1.10"), Ok(false));
        assert_eq!(compare_release("3.0.0 (Claude Code)", "2.1.10"), Ok(false));
        for invalid in [
            "<html>2.1.10</html>",
            "2.1",
            "2.01.10",
            "2.1.10\nCC_CLI_DONE=1",
            "2.1.10-beta",
        ] {
            assert!(compare_release("2.1.9 (Claude Code)", invalid).is_err());
        }
        assert!(compare_release("unknown", "2.1.10").is_err());
    }
    #[test]
    fn release_http_rejects_redirects_invalid_and_oversized_responses_without_credentials() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for response in [
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 7\r\n\r\n2.1.10\n".to_string(),
                "HTTP/1.1 302 Found\r\nConnection: close\r\nLocation: https://example.invalid\r\nContent-Length: 0\r\n\r\n".to_string(),
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 4\r\n\r\nOops".to_string(),
                format!("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 65\r\n\r\n{}", "2".repeat(65)),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = String::new();
                let mut reader = BufReader::new(&stream);
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    request.push_str(&line);
                    if line == "\r\n" { break; }
                }
                assert!(!request.to_lowercase().contains("authorization:"));
                assert!(!request.to_lowercase().contains("cookie:"));
                stream.write_all(response.as_bytes()).unwrap();
                let _ = stream.flush();
            }
        });
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            for index in 0..4 {
                let response = client
                    .get(format!("http://{address}/latest"))
                    .send()
                    .await
                    .unwrap();
                let result = latest_release(response).await;
                if index == 0 {
                    assert_eq!(result.unwrap(), "2.1.10");
                } else {
                    assert!(result.is_err());
                }
            }
        });
        server.join().unwrap();
    }
}
