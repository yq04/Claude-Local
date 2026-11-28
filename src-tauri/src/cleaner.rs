// [INPUT]: Claude 白名单、所选文件夹发现、配置变换、原子写入、官方原生 CLI 版本路径及 macOS/Linux/Windows 白名单路径边界。
// [OUTPUT]: 全机/文件夹元数据扫描、文件残留专用快照与选择清理、实时 Claude 进程角色分类（InteractiveCli/BackgroundDaemon/BackgroundPtyHost/BackgroundWorker/Desktop）与子 Shell 检测、后台守护进程优雅挂起（`daemon stop --any` 保活脱离 Shell 并落盘 `adopt.json`）、进程停止与退出后工作区文件句柄释放等待；支持排他写锁（enter）、并发只读配额门（enter_quota）与按账号分片并发的伴生浏览器打开门（enter_browser_account），身份写入显式提升代次。
// [POS]: 白名单与进程共用边界；身份由 identities 编排，残留入口仅允许文件操作且不访问钥匙串。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use crate::native;
use crate::progress::{Progress, Reporter};
#[cfg(windows)]
use dunce::canonicalize;
use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use std::fs::canonicalize;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
};
use tauri::{ipc::Channel, Manager};
#[path = "cleaner_config.rs"]
mod config;
#[path = "cleaner_io.rs"]
pub(crate) mod file_io;
#[path = "cleaner_folder.rs"]
mod folder;
#[path = "cleaner_identity.rs"]
pub(crate) mod identity;
#[path = "cleaner_residue.rs"]
pub(crate) mod residue;
#[path = "cleaner_targets.rs"]
pub(crate) mod targets;
#[path = "cleaner_transaction.rs"]
mod transaction;
#[cfg(test)]
use transaction::perform_items;
#[cfg(test)]
#[path = "cleaner_tests.rs"]
mod tests;
#[cfg(unix)]
extern "C" {
    fn getuid() -> u32;
    fn kill(pid: i32, signal: i32) -> i32;
}
#[derive(Clone, PartialEq, Eq)]
enum Operation {
    Delete,
    Edit(config::EditKind),
    Keychain(String),
}
#[derive(Clone, Serialize)]
pub struct Item {
    id: String,
    path: String,
    title: String,
    group: &'static str,
    risk: &'static str,
    impact: String,
    bytes: u64,
    files: usize,
    exact: bool,
    keys: Vec<String>,
    #[serde(skip)]
    operation: Operation,
    #[serde(skip)]
    directory: bool,
    #[serde(skip)]
    stamp: Option<Stamp>,
    #[serde(skip)]
    tree_stamp: Vec<u8>,
}
#[derive(Clone, PartialEq)]
struct Stamp {
    dev: u64,
    inode: u64,
    modified: i64,
    nanos: i64,
    changed: i64,
    changed_nanos: i64,
    size: u64,
}
#[cfg(unix)]
fn stamp(m: &fs::Metadata) -> Stamp {
    Stamp {
        dev: m.dev(),
        inode: m.ino(),
        modified: m.mtime(),
        nanos: m.mtime_nsec(),
        changed: m.ctime(),
        changed_nanos: m.ctime_nsec(),
        size: m.len(),
    }
}
#[cfg(windows)]
fn stamp(m: &fs::Metadata) -> Stamp {
    Stamp {
        dev: m.file_attributes() as u64,
        inode: 0,
        modified: m.last_write_time() as i64,
        nanos: 0,
        changed: m.creation_time() as i64,
        changed_nanos: 0,
        size: m.file_size(),
    }
}
pub(crate) fn linked(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        crate::windows::linked(meta)
    }
    #[cfg(unix)]
    {
        meta.file_type().is_symlink()
    }
}
fn generation() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
#[derive(Clone, Serialize)]
struct Diagnostic {
    title: String,
    detail: String,
    status: &'static str,
}
#[derive(Clone, Serialize, Default)]
pub struct Scan {
    folder: String,
    items: Vec<Item>,
    running: bool,
    processes: Vec<ClaudeProcess>,
    message: String,
    warnings: Vec<String>,
    diagnostics: Vec<Diagnostic>,
    org_id: String,
    #[serde(default)]
    pub cli_security: Option<crate::risk_check::CliSecurityAudit>,
}
const WRITER_BIT: u64 = 1u64 << 63;
const BROWSER_SHIFT: u32 = 32;
const BROWSER_ONE: u64 = 1u64 << BROWSER_SHIFT;
const BROWSER_MASK: u64 = 0x7FFF_FFFF_0000_0000;
const QUOTA_MASK: u64 = 0x0000_0000_FFFF_FFFF;

type AccountShard = Arc<(Mutex<bool>, Condvar)>;

struct ShardGuard(AccountShard);

impl Drop for ShardGuard {
    fn drop(&mut self) {
        let mut held = self.0 .0.lock().unwrap_or_else(|e| e.into_inner());
        *held = false;
        self.0 .1.notify_one();
    }
}

pub(crate) struct BrowserAccountGuard<'a> {
    cleaner: &'a Cleaner,
    _shard: ShardGuard,
}

impl Drop for BrowserAccountGuard<'_> {
    fn drop(&mut self) {
        let mut cur = self.cleaner.lock_state.load(Ordering::SeqCst);
        loop {
            debug_assert!((cur & BROWSER_MASK) >= BROWSER_ONE);
            let next = if (cur & BROWSER_MASK) >= BROWSER_ONE {
                cur - BROWSER_ONE
            } else {
                cur & !BROWSER_MASK
            };
            match self.cleaner.lock_state.compare_exchange_weak(
                cur,
                next,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => break,
                Err(actual) => cur = actual,
            }
        }
    }
}

#[derive(Default)]
pub struct Cleaner {
    plan: Mutex<Option<Scan>>,
    residue_plan: Mutex<Option<Scan>>,
    /// Bit 63: exclusive writer (`enter`);
    /// Bits 32..62: browser-open shared readers (`enter_browser_account`);
    /// Bits 0..31: quota shared readers (`enter_quota`).
    lock_state: AtomicU64,
    identity_epoch: AtomicU64,
    account_locks: Mutex<HashMap<String, AccountShard>>,
}
impl Cleaner {
    pub(crate) fn enter(&self) -> Result<(), String> {
        self.lock_state
            .compare_exchange(0, WRITER_BIT, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| ())
            .map_err(|_| "已有清理操作正在运行。".into())
    }
    // Quota reads/commits share a reader count without mutating identity or blocking browser opens.
    pub(crate) fn enter_quota(&self) -> Result<(), String> {
        let mut cur = self.lock_state.load(Ordering::SeqCst);
        loop {
            if (cur & WRITER_BIT) != 0 || (cur & QUOTA_MASK) == QUOTA_MASK {
                return Err("quotaOnline.busy".into());
            }
            match self.lock_state.compare_exchange_weak(
                cur,
                cur + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return Ok(()),
                Err(actual) => cur = actual,
            }
        }
    }
    // Browser opens serialize per normalized account shard while running concurrently with other accounts and quota commits.
    pub(crate) fn enter_browser_account(
        &self,
        account_key: &str,
    ) -> Result<BrowserAccountGuard<'_>, String> {
        let normalized = {
            let trimmed = account_key.trim();
            if trimmed.is_empty() {
                "__empty__".to_string()
            } else {
                trimmed.to_ascii_lowercase()
            }
        };
        let shard = {
            let mut map = self.account_locks.lock().unwrap_or_else(|e| e.into_inner());
            map.entry(normalized)
                .or_insert_with(|| Arc::new((Mutex::new(false), Condvar::new())))
                .clone()
        };
        {
            let mut held = shard.0.lock().unwrap_or_else(|e| e.into_inner());
            while *held {
                held = shard.1.wait(held).unwrap_or_else(|e| e.into_inner());
            }
            *held = true;
        }
        let shard_guard = ShardGuard(shard);
        let mut cur = self.lock_state.load(Ordering::SeqCst);
        loop {
            if (cur & WRITER_BIT) != 0 || (cur & BROWSER_MASK) == BROWSER_MASK {
                return Err("quotaOnline.busy".into());
            }
            match self.lock_state.compare_exchange_weak(
                cur,
                cur + BROWSER_ONE,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    return Ok(BrowserAccountGuard {
                        cleaner: self,
                        _shard: shard_guard,
                    });
                }
                Err(actual) => cur = actual,
            }
        }
    }
    pub(crate) fn identity_epoch(&self) -> u64 {
        self.identity_epoch.load(Ordering::SeqCst)
    }
    // Call only inside the held door, before a real identity/configuration mutation.
    pub(crate) fn begin_identity_change(&self) {
        self.identity_epoch.fetch_add(1, Ordering::SeqCst);
    }
    pub(crate) fn leave(&self) {
        let mut cur = self.lock_state.load(Ordering::SeqCst);
        loop {
            let next = if (cur & WRITER_BIT) != 0 {
                cur & !WRITER_BIT
            } else if (cur & QUOTA_MASK) > 0 {
                cur - 1
            } else {
                break;
            };
            match self.lock_state.compare_exchange_weak(
                cur,
                next,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => break,
                Err(actual) => cur = actual,
            }
        }
    }
    pub(crate) fn is_busy(&self) -> bool {
        self.lock_state.load(Ordering::SeqCst) != 0
    }
}
fn home() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let var = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(windows))]
    let var = std::env::var_os("HOME");
    canonicalize(PathBuf::from(var.ok_or("无法定位用户目录。")?))
        .map_err(|_| "无法读取用户目录。".into())
}
fn add_target(scan: &mut Scan, target: targets::Target, batch: u128) {
    let path = target.path;
    let meta = match fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                scan.warnings.push(format!("无法检查 {}。", path.display()));
            }
            return;
        }
    };
    #[cfg(unix)]
    let wrong_user = meta.uid() != unsafe { getuid() };
    #[cfg(windows)]
    let wrong_user = !crate::windows::owned(&path);
    if linked(&meta)
        || wrong_user
        || (!meta.is_dir() && !meta.is_file())
        || canonicalize(&path).ok().as_deref() != Some(path.as_path())
    {
        scan.warnings.push(format!(
            "已跳过链接、其他用户或特殊路径：{}",
            path.display()
        ));
        return;
    }
    let mut keys = Vec::new();
    if let Operation::Edit(kind) = target.operation {
        if !meta.is_file() || meta.len() > 4 * 1024 * 1024 {
            scan.warnings
                .push(format!("配置过大或类型不正确：{}", path.display()));
            return;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if config::needs_manual_review(&text, kind) {
                scan.warnings.push(format!(
                    "{}：包含复合赋值或外部配置引用，未自动展开或改写这些内容。",
                    path.display()
                ));
            }
        }
        match fs::read_to_string(&path)
            .map_err(|_| "无法读取配置。".to_string())
            .and_then(|s| config::transform(&s, kind))
        {
            Ok((_, names)) => {
                if names.is_empty() {
                    return;
                }
                keys = names;
            }
            Err(e) => {
                scan.warnings.push(format!("{}：{e}", path.display()));
                return;
            }
        }
    }
    let (bytes, files, tree_stamp) = match targets::measure(&path) {
        Ok(measured) => measured,
        Err(error) => {
            scan.warnings.push(error);
            return;
        }
    };
    scan.items.push(Item {
        id: format!("{batch}-{}", scan.items.len()),
        path: path.to_string_lossy().into_owned(),
        title: target.title,
        group: target.group,
        risk: target.risk,
        impact: target.impact,
        bytes,
        files,
        exact: true,
        keys,
        operation: target.operation,
        directory: meta.is_dir(),
        stamp: Some(stamp(&meta)),
        tree_stamp,
    });
}
fn collect(root: &Path, org: Option<&str>) -> Result<Scan, String> {
    let batch = generation();
    let mut scan = Scan::default();
    for target in targets::definitions(root) {
        add_target(&mut scan, target, batch);
    }
    if let Some(org) = org.filter(|s| !s.is_empty()) {
        let (matches, complete) = targets::org_files(root, org)?;
        scan.org_id = org.into();
        for path in matches {
            if scan.items.iter().any(|i| i.path == path.to_string_lossy()) {
                continue;
            }
            add_target(
                &mut scan,
                targets::Target {
                    title: "旧组织会话文件".into(),
                    path,
                    group: "organization",
                    risk: "history",
                    impact: "文件正文匹配所填组织编号；请核对路径，只清理确认不再需要的旧会话。"
                        .into(),
                    operation: Operation::Delete,
                },
                batch,
            );
        }
        if !complete {
            scan.warnings
                .push("组织检索达到时间或条目上限；未扫描全部文件。".into());
        }
    }
    scan.message = format!("已发现 {} 个可选项目。", scan.items.len());
    Ok(scan)
}
fn diagnostics(scan: &mut Scan) {
    let names: Vec<_> = std::env::vars_os()
        .filter_map(|(key, _)| key.into_string().ok())
        .filter(|key| {
            matches!(
                key.to_ascii_uppercase().as_str(),
                "HTTP_PROXY"
                    | "HTTPS_PROXY"
                    | "ALL_PROXY"
                    | "GRPC_PROXY"
                    | "NO_PROXY"
                    | "CLAUDE_CODE_OAUTH_TOKEN"
                    | "CLAUDE_CONFIG_DIR"
            ) || key.starts_with("ANTHROPIC_")
        })
        .collect();
    scan.diagnostics.push(Diagnostic {
        title: "当前应用环境".into(),
        detail: if names.is_empty() {
            "未发现代理或认证变量。终端已启动的会话需单独检查。".into()
        } else {
            format!(
                "发现变量：{}。清理启动文件后，请重开终端。",
                names.join("、")
            )
        },
        status: if names.is_empty() { "ok" } else { "review" },
    });
    if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
        scan.warnings.push(
            "检测到自定义 CLAUDE_CONFIG_DIR；本次仅检查默认目录，自定义目录未纳入清理。".into(),
        );
    }
    #[cfg(target_os = "macos")]
    let proxy = std::process::Command::new("/usr/sbin/scutil")
        .arg("--proxy")
        .output();
    #[cfg(target_os = "macos")]
    let enabled = proxy
        .as_ref()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.contains("Enable : 1"))
        })
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let enabled = [
        "ALL_PROXY",
        "all_proxy",
        "GRPC_PROXY",
        "grpc_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .iter()
    .any(|key| std::env::var_os(key).is_some());
    #[cfg(target_os = "macos")]
    scan.diagnostics.push(Diagnostic {
        title: "系统代理".into(),
        detail: if enabled {
            "系统代理已开启。此处仅检查，不改动现有 Clash 路由。".into()
        } else {
            "未发现已开启的系统代理；仍需在客户端验证实际出口和断线保护。".into()
        },
        status: if enabled { "review" } else { "info" },
    });
    #[cfg(target_os = "linux")]
    scan.diagnostics.push(Diagnostic {
        title: "代理环境".into(),
        detail: if enabled {
            "检测到代理环境变量；桌面代理设置未独立核验，请验证实际出口。".into()
        } else {
            "未发现代理环境变量；桌面代理设置未独立核验，请验证实际出口。".into()
        },
        status: if enabled { "review" } else { "info" },
    });
    #[cfg(target_os = "windows")]
    {
        let env_enabled = [
            "ALL_PROXY",
            "all_proxy",
            "GRPC_PROXY",
            "grpc_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
        ]
        .iter()
        .any(|key| std::env::var_os(key).is_some());
        let sys_enabled = !crate::windows::system_proxy().is_empty();
        let enabled = env_enabled || sys_enabled;
        scan.diagnostics.push(Diagnostic {
            title: "代理环境".into(),
            detail: if sys_enabled {
                "系统代理已开启。此处仅检查，不改动现有 Clash 路由。".into()
            } else if env_enabled {
                "检测到代理环境变量；桌面代理设置未独立核验，请验证实际出口。".into()
            } else {
                "未发现代理环境变量；TUN 是推荐的网络环境。".into()
            },
            status: if enabled { "review" } else { "info" },
        });
    }
    #[cfg(not(target_os = "windows"))]
    let timezone = fs::read_link("/etc/localtime")
        .ok()
        .map(|p| {
            p.to_string_lossy()
                .split("/zoneinfo/")
                .last()
                .unwrap_or("未知")
                .to_string()
        })
        .unwrap_or("未知".into());
    #[cfg(target_os = "windows")]
    let timezone = crate::windows::timezone();
    scan.diagnostics.push(Diagnostic {
        title: "设备时区".into(),
        detail: format!("{timezone} · 可在电脑设置中修改。"),
        status: "info",
    });
    scan.diagnostics.push(Diagnostic {
        title: "保留个人资产".into(),
        detail: "skills、plugins、hooks、commands、CLAUDE.md、MCP、权限、模型及遥测设置保持不变。"
            .into(),
        status: "ok",
    });
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeProcessRole {
    #[default]
    InteractiveCli,
    BackgroundDaemon,
    BackgroundPtyHost,
    BackgroundWorker,
    Desktop,
}
impl ClaudeProcessRole {
    pub fn is_background(self) -> bool {
        matches!(
            self,
            Self::BackgroundDaemon | Self::BackgroundPtyHost | Self::BackgroundWorker
        )
    }
}
#[derive(Clone, Serialize)]
pub struct ClaudeProcess {
    pub pid: i32,
    pub name: String,
    #[serde(skip)]
    #[allow(dead_code)]
    pub executable: String,
    #[cfg(windows)]
    #[serde(skip)]
    pub created: u64,
    #[cfg(windows)]
    #[serde(skip)]
    pub role: ClaudeProcessRole,
    #[cfg(windows)]
    #[serde(skip)]
    pub child_shells: Vec<String>,
}
impl ClaudeProcess {
    pub fn role(&self) -> ClaudeProcessRole {
        #[cfg(windows)]
        {
            self.role
        }
        #[cfg(not(windows))]
        {
            if self.name == "Claude Desktop" {
                ClaudeProcessRole::Desktop
            } else {
                ClaudeProcessRole::InteractiveCli
            }
        }
    }
    pub fn child_shells(&self) -> &[String] {
        #[cfg(windows)]
        {
            &self.child_shells
        }
        #[cfg(not(windows))]
        {
            &[]
        }
    }
}
#[cfg(not(target_os = "windows"))]
fn process_row(line: &str, desktop: &[i32], uid: u32) -> Option<ClaudeProcess> {
    let mut fields = line.trim().splitn(2, char::is_whitespace);
    if fields.next()?.parse::<u32>().ok()? != uid {
        return None;
    }
    let mut fields = fields.next()?.trim_start().splitn(2, char::is_whitespace);
    let pid = fields.next()?.parse::<i32>().ok()?;
    if pid <= 1 {
        return None;
    }
    let executable = fields.next()?.trim().to_owned();
    let name = Path::new(&executable).file_name()?.to_str()?;
    let desktop_app = desktop.contains(&pid);
    let native_cli = name.split('.').count() == 3
        && name
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && home().ok().is_some_and(|root| {
            let expected = root.join(".local/share/claude/versions");
            Path::new(&executable).parent().is_some_and(|p| {
                p.components().collect::<Vec<_>>() == expected.components().collect::<Vec<_>>()
            })
        });
    if !desktop_app
        && !native_cli
        && !matches!(
            name,
            "claude" | "claude.exe" | "claude-code" | "claude-code-vm"
        )
    {
        return None;
    }
    Some(ClaudeProcess {
        pid,
        name: if native_cli {
            "Claude Code".into()
        } else if desktop_app {
            if matches!(name, "node" | "nodejs" | "bun") {
                "Claude Code".into()
            } else if name == "Claude" {
                "Claude Desktop".into()
            } else {
                name.into()
            }
        } else {
            name.into()
        },
        executable,
    })
}
#[cfg(target_os = "macos")]
fn processes() -> Result<Vec<ClaudeProcess>, String> {
    let desktop = native::claude_pids()?;
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "uid=,pid=,comm="])
        .output()
        .map_err(|_| "无法检查 Claude 进程，请刷新重试。")?;
    if !output.status.success() {
        return Err("无法检查 Claude 进程，请刷新重试。".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| process_row(line, &desktop, unsafe { getuid() }))
        .collect())
}
#[cfg(target_os = "linux")]
fn processes() -> Result<Vec<ClaudeProcess>, String> {
    Ok(crate::linux::processes()?
        .into_iter()
        .filter_map(|p| {
            let desktop = if crate::linux::node_cli(&p) {
                vec![p.pid]
            } else {
                vec![]
            };
            process_row(
                &format!(
                    "{} {} {}",
                    unsafe { getuid() },
                    p.pid,
                    p.executable.display()
                ),
                &desktop,
                unsafe { getuid() },
            )
        })
        .collect())
}
#[cfg(target_os = "windows")]
fn processes() -> Result<Vec<ClaudeProcess>, String> {
    crate::windows::claude_processes()
}
fn running() -> Result<bool, String> {
    Ok(!processes()?.is_empty())
}
pub(crate) fn cli_running() -> Result<bool, String> {
    Ok(processes()?.iter().any(|process| {
        matches!(
            process.name.as_str(),
            "Claude Code"
                | "claude"
                | "claude.exe"
                | "claude-code"
                | "claude-code-vm"
                | "claude-code-helper"
                | "claude-code-helper.exe"
        )
    }))
}
#[tauri::command]
pub async fn cleaner_processes() -> Result<Vec<ClaudeProcess>, String> {
    tauri::async_runtime::spawn_blocking(processes)
        .await
        .map_err(|_| "进程检查被中断。".to_string())?
}
#[cfg(not(target_os = "windows"))]
fn signal_same_process(target: &ClaudeProcess, signal: i32) -> Result<(), String> {
    if processes()?
        .iter()
        .any(|p| p.pid == target.pid && p.executable == target.executable)
    {
        if unsafe { kill(target.pid, signal) } != 0
            && processes()?
                .iter()
                .any(|p| p.pid == target.pid && p.executable == target.executable)
        {
            return Err(format!("无法结束 Claude 进程 {}。", target.pid));
        }
    }
    Ok(())
}
#[cfg(target_os = "windows")]
fn signal_same_process(target: &ClaudeProcess, _signal: i32) -> Result<(), String> {
    crate::windows::kill_process(target)
}

fn current_scan(root: &Path, org: Option<&str>) -> Result<Scan, String> {
    let mut scan = collect(root, org)?;
    match native::credentials() {
        Ok(credentials) => {
            let batch = generation();
            for credential in credentials {
                scan.items.push(Item {
                    id: format!("keychain-{batch}-{}", scan.items.len()),
                    path: format!("macOS 钥匙串 / {}", credential.service),
                    title: format!("登录凭据 · {}", credential.service),
                    group: "account",
                    risk: "login",
                    impact: "直接删除后需重新登录；不读取或保留凭据正文。".into(),
                    bytes: 0,
                    files: 0,
                    exact: true,
                    keys: vec![],
                    operation: Operation::Keychain(credential.reference),
                    directory: false,
                    stamp: None,
                    tree_stamp: vec![],
                });
            }
        }
        Err(e) => scan.warnings.push(e),
    }
    scan.processes = processes()?;
    scan.running = !scan.processes.is_empty();
    diagnostics(&mut scan);
    scan.message = format!("已发现 {} 个可选项目。", scan.items.len());
    Ok(scan)
}
fn scan_scope(
    folder: Option<&str>,
    org: Option<&str>,
    reporter: &Reporter,
) -> Result<Scan, String> {
    if let Some(path) = folder.filter(|p| !p.is_empty()) {
        let mut scan = folder::collect(Path::new(path), reporter)?;
        scan.processes = processes()?;
        scan.running = !scan.processes.is_empty();
        scan.diagnostics.push(Diagnostic { title: "文件夹范围".into(), detail: "仅检查所选文件夹内的 Claude 会话、缓存与既有备份。项目文档、设置、凭据、技能和插件保留；不检查目录外钥匙串或全局会话。".into(), status: "info" });
        Ok(scan)
    } else {
        current_scan(&home()?, org)
    }
}
#[tauri::command]
pub async fn cleaner_scan(
    app: tauri::AppHandle,
    org_id: Option<String>,
    folder: Option<String>,
    on_progress: Channel<Progress>,
) -> Result<Scan, String> {
    let state = app.state::<Cleaner>();
    state.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let reporter = Reporter::channel(Some(on_progress));
        reporter.log(
            "scan",
            "running",
            "正在发现文件、检查配置与钥匙串；凭据内容不进入日志。",
            0,
            None,
        );
        let scan = match scan_scope(
            folder.as_deref(),
            org_id.as_deref().map(str::trim),
            &reporter,
        ) {
            Ok(scan) => scan,
            Err(error) => {
                reporter.log("scan", "error", &error, 0, None);
                return Err(error);
            }
        };
        reporter.log(
            "scan",
            "ok",
            &scan.message,
            scan.items.len(),
            Some(scan.items.len()),
        );
        for warning in &scan.warnings {
            reporter.log("scan", "warning", warning, 0, None);
        }
        let state = worker.state::<Cleaner>();
        *state.plan.lock().unwrap() = Some(scan.clone());
        Ok(scan)
    })
    .await
    .map_err(|_| "深度扫描被中断，请重试。".to_string())
    .and_then(|r| r);
    state.leave();
    result
}
#[cfg(not(test))]
fn verified_daemon_stop_executable(bg_procs: &[ClaudeProcess]) -> Option<PathBuf> {
    let preferred = bg_procs
        .iter()
        .find(|p| p.role() == ClaudeProcessRole::BackgroundDaemon)
        .into_iter()
        .chain(bg_procs.iter());
    for proc in preferred {
        if proc.executable.trim().is_empty() {
            continue;
        }
        let path = PathBuf::from(&proc.executable);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !linked(&meta) && meta.is_file() {
                #[cfg(windows)]
                if !crate::windows::owned(&path) {
                    continue;
                }
                return Some(path);
            }
        }
    }
    if let Ok(root) = home() {
        #[cfg(windows)]
        let fallback = root.join(".local/bin/claude.exe");
        #[cfg(not(windows))]
        let fallback = root.join(".local/bin/claude");
        if let Ok(meta) = fs::symlink_metadata(&fallback) {
            if !linked(&meta) && meta.is_file() {
                #[cfg(windows)]
                if !crate::windows::owned(&fallback) {
                    return None;
                }
                return Some(fallback);
            }
        }
    }
    None
}

pub(crate) fn park_background_daemon_in(app_data_dir: Option<&Path>) -> Result<bool, String> {
    let non_slot = identity::filter_non_slot_processes(app_data_dir, processes()?);
    let bg_procs: Vec<ClaudeProcess> = non_slot
        .into_iter()
        .filter(|p| p.role().is_background())
        .collect();
    if bg_procs.is_empty() {
        return Ok(false);
    }
    #[cfg(test)]
    {
        let _ = bg_procs;
        Ok(false)
    }
    #[cfg(not(test))]
    {
        const SCRUB_ENV_KEYS: &[&str] = &[
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
            "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_GATEWAY",
            "CLAUDE_CODE_SIMPLE",
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CONFIG_DIR",
        ];
        const PROXY_ENV_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
        ];
        let Some(exe) = verified_daemon_stop_executable(&bg_procs) else {
            return Ok(false);
        };
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(["daemon", "stop", "--any"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        for key in SCRUB_ENV_KEYS {
            cmd.env_remove(key);
        }
        for key in PROXY_ENV_KEYS {
            cmd.env_remove(key);
        }
        if let Ok(root) = home() {
            if let Some(proxy) = crate::identities::read_claude_dir_http_proxy(&root.join(".claude"))
            {
                for key in PROXY_ENV_KEYS {
                    cmd.env(key, &proxy);
                }
            }
        }
        cmd.env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1")
            .env("DISABLE_TELEMETRY", "1")
            .env("DISABLE_ERROR_REPORTING", "1")
            .env("DO_NOT_TRACK", "1");

        let Ok(mut child) = cmd.spawn() else {
            return Ok(false);
        };
        let stop_deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(4500);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() < stop_deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
        let drain_deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(2500);
        loop {
            let still_bg = identity::filter_non_slot_processes(
                app_data_dir,
                processes().unwrap_or_default(),
            )
            .iter()
            .any(|p| p.role().is_background());
            if !still_bg || std::time::Instant::now() >= drain_deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if let Ok(root) = home() {
            wait_claude_workspace_handles_released(&root, 300);
        }
        Ok(true)
    }
}

pub(crate) fn park_if_only_background_in(app_data_dir: Option<&Path>) -> Result<bool, String> {
    let non_slot = identity::filter_non_slot_processes(app_data_dir, processes()?);
    if non_slot.is_empty() || non_slot.iter().any(|p| !p.role().is_background()) {
        return Ok(false);
    }
    let parked = park_background_daemon_in(app_data_dir)?;
    #[cfg(not(test))]
    {
        let remaining = identity::filter_non_slot_processes(app_data_dir, processes()?);
        if !remaining.is_empty() && remaining.iter().all(|p| p.role().is_background()) {
            for target in &remaining {
                let _ = signal_same_process(target, 15);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
            for target in identity::filter_non_slot_processes(app_data_dir, processes()?)
                .into_iter()
                .filter(|p| p.role().is_background())
            {
                let _ = signal_same_process(&target, 9);
            }
        }
        if let Ok(root) = home() {
            identity::clear_stale_locks(&root);
            wait_claude_workspace_handles_released(&root, 300);
        }
    }
    Ok(parked)
}

pub(crate) fn stop_processes() -> Result<usize, String> {
    stop_processes_in(None)
}
pub(crate) fn stop_processes_in(app_data_dir: Option<&Path>) -> Result<usize, String> {
    let filter_main = |all: Vec<ClaudeProcess>| -> Vec<ClaudeProcess> {
        let Some(app_dir) = app_data_dir else {
            return all;
        };
        let slot_pids: std::collections::HashSet<i32> =
            crate::identities::orchestrator::slot_pids_by_record(app_dir, &all)
                .into_values()
                .flatten()
                .collect();
        if slot_pids.is_empty() {
            all
        } else {
            all.into_iter()
                .filter(|p| !slot_pids.contains(&p.pid))
                .collect()
        }
    };
    let mut targets = std::collections::HashSet::new();
    let initial_bg: Vec<i32> = filter_main(processes()?)
        .into_iter()
        .filter(|p| p.role().is_background())
        .map(|p| p.pid)
        .collect();
    if !initial_bg.is_empty() {
        targets.extend(initial_bg);
        let _ = park_background_daemon_in(app_data_dir);
    }
    // 主进程退出期间辅助进程可能重生；每轮重新识别，最多三轮，不扩大到其他 Node/MCP/终端。
    for _ in 0..3 {
        let current = filter_main(processes()?);
        if current.is_empty() {
            break;
        }
        for target in &current {
            targets.insert(target.pid);
            signal_same_process(target, 15)?;
        }
        std::thread::sleep(std::time::Duration::from_millis(800));
        for target in filter_main(processes()?) {
            targets.insert(target.pid);
            signal_same_process(&target, 9)?;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    if !filter_main(processes()?).is_empty() {
        return Err("仍有 Claude 进程在运行。".into());
    }
    if let Ok(root) = home() {
        identity::clear_stale_locks(&root);
        wait_claude_workspace_handles_released(&root, 600);
    }
    Ok(targets.len())
}
pub(crate) fn wait_claude_workspace_handles_released(home: &Path, timeout_ms: u64) {
    #[cfg(not(windows))]
    let _ = (home, timeout_ms);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let candidates = [
            home.join(".claude.json"),
            home.join(".claude/.credentials.json"),
            home.join(".claude/settings.json"),
            home.join(".claude/settings.local.json"),
        ];
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            let mut busy = false;
            for path in &candidates {
                let Ok(meta) = fs::symlink_metadata(path) else {
                    continue;
                };
                if !meta.is_file() || linked(&meta) || !crate::windows::owned(path) {
                    continue;
                }
                if let Err(err) = fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(path)
                {
                    if matches!(err.raw_os_error(), Some(32 | 33)) {
                        busy = true;
                        break;
                    }
                }
            }
            if !busy || std::time::Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}
#[tauri::command]
pub async fn cleaner_stop(app: tauri::AppHandle) -> Result<Scan, String> {
    let state = app.state::<Cleaner>();
    state.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let count = stop_processes()?;
        let plan = worker.state::<Cleaner>().plan.lock().unwrap().clone();
        let mut scan = scan_scope(
            plan.as_ref().map(|p| p.folder.as_str()),
            plan.as_ref().map(|p| p.org_id.as_str()),
            &Reporter::channel(None),
        )?;
        scan.message = if scan.running {
            "仍有 Claude 进程在运行。".into()
        } else {
            format!("已结束 {} 个 Claude 进程，可以清理。", count)
        };
        *worker.state::<Cleaner>().plan.lock().unwrap() = Some(scan.clone());
        Ok(scan)
    })
    .await
    .map_err(|_| "结束进程被中断，请刷新。".to_string())
    .and_then(|r| r);
    state.leave();
    result
}
fn selected(plan: &Scan, ids: &[String]) -> Result<Vec<Item>, String> {
    if ids.is_empty() {
        return Err("请选择清理项目。".into());
    }
    let mut chosen: Vec<Item> = Vec::new();
    for id in ids {
        let item = plan
            .items
            .iter()
            .find(|i| &i.id == id)
            .ok_or("清理快照已过期，请重新扫描。")?;
        if !chosen.iter().any(|i| i.id == *id) {
            chosen.push(item.clone());
        }
    }
    Ok(chosen
        .iter()
        .filter(|item| {
            !chosen.iter().any(|parent| {
                parent.id != item.id
                    && matches!(parent.operation, Operation::Delete)
                    && parent.directory
                    && !matches!(item.operation, Operation::Keychain(_))
                    && Path::new(&item.path).starts_with(&parent.path)
            })
        })
        .cloned()
        .collect())
}
fn identity(item: &Item, root: &Path) -> Result<(), String> {
    if let Operation::Keychain(reference) = &item.operation {
        return if native::credentials()?
            .iter()
            .any(|c| &c.reference == reference)
        {
            Ok(())
        } else {
            Err("登录凭据已变化，请重新扫描。".into())
        };
    }
    let path = Path::new(&item.path);
    let in_scope = path.starts_with(root);
    #[cfg(target_os = "linux")]
    let in_scope = in_scope
        || (home().ok().as_deref() == Some(root)
            && targets::definitions(root).iter().any(|t| t.path == path));
    #[cfg(target_os = "windows")]
    let in_scope = in_scope
        || (home().ok().as_deref() == Some(root)
            && targets::definitions(root).iter().any(|t| t.path == path));
    if !in_scope || canonicalize(path).ok().as_deref() != Some(path) {
        return Err("路径已变化或超出当前用户范围。".into());
    }
    let m = fs::symlink_metadata(path).map_err(|_| "项目已变化，请重新扫描。")?;
    #[cfg(unix)]
    let wrong_user = m.uid() != unsafe { getuid() };
    #[cfg(windows)]
    let wrong_user = !crate::windows::owned(path);
    if linked(&m) || wrong_user || m.is_dir() != item.directory || Some(stamp(&m)) != item.stamp {
        return Err("数据已变化，请退出 Claude 后重新扫描。".into());
    }
    if item.directory {
        if !item.exact {
            return Err("目录快照不完整，请重新扫描。".into());
        }
        let (_, _, tree) = targets::measure(path)?;
        if tree != item.tree_stamp {
            return Err("目录内的文件已经变化，请重新扫描。".into());
        }
    }

    Ok(())
}
#[derive(Debug, Serialize)]
pub struct CleanResult {
    cleaned: usize,
    errors: Vec<String>,
    completed: bool,
}
