// [INPUT]: Win32 Toolhelp/进程句柄、当前用户 SID、精确 CLI 入口与独立浏览器资料路径。
// [OUTPUT]: Claude 进程零侵入识别与角色分类（InteractiveCli/BackgroundDaemon/BackgroundPtyHost/BackgroundWorker/Desktop；栈缓冲优先路径查询、仅在存在 Claude 候选时构建父子进程树、PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE + NtQueryInformationProcess(ProcessCommandLineInformation = 60) 零 VM_READ + (pid, created) 缓存 + 交互式 CLI 存活子 Shell 树采样）、node/bun 与带 (pid, created_100ns) 进程级缓存及单快照批量托管资料探活（running_chrome_profiles）的浏览器参数识别、创建时间/所有权复核后的同步等待结束（1500ms 句柄排空）、5 重校验受限浏览器进程树强杀兜底（terminate_browser_profile_tree），及以文件句柄标识匹配关闭与只读可见窗口采样。
// [POS]: Windows 进程边界；原生二进制与受管浏览器免 PROCESS_VM_READ/ReadProcessMemory；参数仅用于角色分类与 node/bun/chrome 判定，原始命令行不返回 UI。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{current_sid, input, process_sid, response};
use crate::cleaner::{ClaudeProcess, ClaudeProcessRole};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    ffi::c_char,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, FILETIME, HANDLE, HWND,
        INVALID_HANDLE_VALUE, LPARAM, STILL_ACTIVE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
        },
        Threading::{
            GetExitCodeProcess, GetProcessTimes, IsWow64Process, OpenProcess,
            QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
            PROCESS_VM_READ,
        },
    },
    UI::{
        Shell::CommandLineToArgvW,
        WindowsAndMessaging::{
            EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
        },
    },
};
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
impl Handle {
    fn open_with_flags(pid: u32, flags: u32) -> Option<Self> {
        let handle = unsafe { OpenProcess(flags, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let handle = Self(handle);
        if unsafe { process_sid(handle.0) }.as_ref() != current_sid() || current_sid().is_none() {
            return None;
        }
        Some(handle)
    }
    /// Open with `PROCESS_QUERY_LIMITED_INFORMATION` (+ `PROCESS_SYNCHRONIZE` when allowed, zero `PROCESS_VM_READ`).
    /// Prevents cross-process PEB/memory reads on native `claude.exe` / `versions\X.Y.Z.exe` while detecting exited handles.
    fn open_limited(pid: u32) -> Option<Self> {
        Self::open_with_flags(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE)
            .or_else(|| Self::open_with_flags(pid, PROCESS_QUERY_LIMITED_INFORMATION))
    }
    /// Open for verified termination without `PROCESS_VM_READ`.
    fn open_terminate_limited(pid: u32) -> Option<Self> {
        let base = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE;
        Self::open_with_flags(pid, base | PROCESS_SYNCHRONIZE)
            .or_else(|| Self::open_with_flags(pid, base))
    }
    fn open(pid: u32, terminate: bool) -> Option<Self> {
        let base = PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_VM_READ
            | if terminate { PROCESS_TERMINATE } else { 0 };
        Self::open_with_flags(pid, base | PROCESS_SYNCHRONIZE)
            .or_else(|| Self::open_with_flags(pid, base))
    }
    fn is_alive(&self) -> bool {
        match unsafe { WaitForSingleObject(self.0, 0) } {
            WAIT_TIMEOUT => true,
            WAIT_OBJECT_0 => false,
            _ => {
                let mut code = 0u32;
                unsafe { GetExitCodeProcess(self.0, &mut code) != 0 && code == STILL_ACTIVE as u32 }
            }
        }
    }
    fn wait_exited(&self, timeout_ms: u32) -> bool {
        match unsafe { WaitForSingleObject(self.0, timeout_ms) } {
            WAIT_OBJECT_0 => true,
            WAIT_TIMEOUT => false,
            _ => {
                let deadline = std::time::Instant::now()
                    + std::time::Duration::from_millis(timeout_ms as u64);
                while self.is_alive() {
                    if std::time::Instant::now() >= deadline {
                        return false;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                true
            }
        }
    }
    fn image(&self) -> Option<String> {
        // Stack buffer covers ordinary paths; only ERROR_INSUFFICIENT_BUFFER falls back to the heap.
        let mut stack = [0u16; 1024];
        let mut size = stack.len() as u32;
        if unsafe { QueryFullProcessImageNameW(self.0, 0, stack.as_mut_ptr(), &mut size) } != 0 {
            return Some(String::from_utf16_lossy(&stack[..size as usize]));
        }
        if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
            return None;
        }
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut size) } == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..size as usize]))
    }
    fn packaged_claude(&self) -> bool {
        let mut buffer = [0u16; 128];
        let mut size = buffer.len() as u32;
        let status = unsafe {
            windows_sys::Win32::Storage::Packaging::Appx::GetPackageFamilyName(
                self.0,
                &mut size,
                buffer.as_mut_ptr(),
            )
        };
        status == 0
            && String::from_utf16_lossy(&buffer[..size.saturating_sub(1) as usize])
                == "Claude_pzs8sxrjxfjjc"
    }
    fn created(&self) -> Option<u64> {
        let [mut created, mut exited, mut kernel, mut user] = [FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        }; 4];
        if unsafe { GetProcessTimes(self.0, &mut created, &mut exited, &mut kernel, &mut user) }
            == 0
        {
            return None;
        }
        Some((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64)
    }
}
#[repr(C)]
#[derive(Default, Copy, Clone)]
struct BasicInfo {
    status: i32,
    peb: usize,
    affinity: usize,
    priority: i32,
    pid: usize,
    parent: usize,
}
#[repr(C)]
#[derive(Default, Copy, Clone)]
struct Unicode {
    length: u16,
    maximum: u16,
    buffer: usize,
}
#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        handle: HANDLE,
        class: u32,
        info: *mut std::ffi::c_void,
        size: u32,
        written: *mut u32,
    ) -> i32;
}
fn read<T: Default + Copy>(handle: HANDLE, address: usize) -> Option<T> {
    let mut value = T::default();
    let mut written = 0;
    let size = std::mem::size_of::<T>();
    if address == 0
        || unsafe {
            ReadProcessMemory(
                handle,
                address as _,
                (&mut value as *mut T).cast(),
                size,
                &mut written,
            )
        } == 0
        || written != size
    {
        return None;
    }
    Some(value)
}
// Windows 8.1+ ProcessCommandLineInformation (60) 在 PROCESS_QUERY_LIMITED_INFORMATION 下直接将命令行写入调用方缓冲，无需 PROCESS_VM_READ。
const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
const MAX_COMMAND_LINE_BYTES: usize = 1024 * 1024;

fn parsed_arguments(command: &[u16]) -> Option<Vec<String>> {
    if command.is_empty() {
        return None;
    }
    let mut nul_terminated = Vec::with_capacity(command.len() + 1);
    nul_terminated.extend_from_slice(command);
    nul_terminated.push(0);
    unsafe {
        // ----- 按 Windows 参数语法解析；完整参数判定，禁止子串命中 -----
        let mut count = 0;
        let args = CommandLineToArgvW(nul_terminated.as_ptr(), &mut count);
        if args.is_null() {
            return None;
        }
        let values = std::slice::from_raw_parts(args, count as usize)
            .iter()
            .map(|p| {
                let mut size = 0;
                while *p.add(size) != 0 {
                    size += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(*p, size))
            })
            .collect();
        LocalFree(args.cast());
        Some(values)
    }
}

fn decode_command_line_buffer(buffer: &[usize]) -> Option<Vec<String>> {
    let start = buffer.as_ptr() as usize;
    let size = std::mem::size_of_val(buffer);
    if size < std::mem::size_of::<Unicode>() {
        return None;
    }
    let command = unsafe { *(buffer.as_ptr().cast::<Unicode>()) };
    let end = start.checked_add(size)?;
    if command.length == 0
        || command.length % 2 != 0
        || command.length > command.maximum
        || command.buffer % std::mem::align_of::<u16>() != 0
        || command.buffer < start.checked_add(std::mem::size_of::<Unicode>())?
        || command.buffer.checked_add(command.length as usize)? > end
    {
        return None;
    }
    let text = unsafe {
        std::slice::from_raw_parts(command.buffer as *const u16, command.length as usize / 2)
    };
    if text.contains(&0) || String::from_utf16(text).is_err() {
        return None;
    }
    parsed_arguments(text)
}

fn query_command_line_limited(handle: HANDLE) -> Option<Vec<String>> {
    if handle.is_null() {
        return None;
    }
    let mut needed = 0u32;
    unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_COMMAND_LINE_INFORMATION,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
    }
    let bytes = needed as usize;
    if !(std::mem::size_of::<Unicode>()..=MAX_COMMAND_LINE_BYTES).contains(&bytes) {
        return None;
    }
    let mut buffer = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_COMMAND_LINE_INFORMATION,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } != 0
        || needed as usize > std::mem::size_of_val(buffer.as_slice())
    {
        return None;
    }
    decode_command_line_buffer(&buffer)
}

fn arguments(handle: &Handle) -> Option<Vec<String>> {
    unsafe {
        let mut wow = 0;
        if IsWow64Process(handle.0, &mut wow) == 0 || wow != 0 {
            return None;
        }
        let mut basic = BasicInfo::default();
        let mut written = 0;
        if NtQueryInformationProcess(
            handle.0,
            0,
            (&mut basic as *mut BasicInfo).cast(),
            std::mem::size_of::<BasicInfo>() as u32,
            &mut written,
        ) != 0
        {
            return None;
        }
        let params: usize = read(handle.0, basic.peb.checked_add(0x20)?)?;
        let command: Unicode = read(handle.0, params.checked_add(0x70)?)?;
        if command.buffer == 0
            || command.length == 0
            || command.length > command.maximum
            || command.length % 2 != 0
        {
            return None;
        }
        let words = command.length as usize / 2;
        let mut buffer = vec![0u16; words];
        let mut read_bytes = 0usize;
        if ReadProcessMemory(
            handle.0,
            command.buffer as _,
            buffer.as_mut_ptr().cast(),
            command.length as usize,
            &mut read_bytes,
        ) == 0
            || read_bytes != command.length as usize
        {
            return None;
        }
        parsed_arguments(&buffer)
    }
}
fn normalized(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}
fn official_cli(args: &[String]) -> bool {
    let script = if args
        .first()
        .is_some_and(|a| normalized(a).ends_with("\\bun.exe"))
        && args.get(1).is_some_and(|a| a == "run")
    {
        2
    } else {
        1
    };
    args.get(script).is_some_and(|arg| {
        Path::new(arg).is_absolute()
            && normalized(arg).ends_with("\\node_modules\\@anthropic-ai\\claude-code\\cli.js")
    })
}
fn needs_vm_arguments(exe_name: &str) -> bool {
    matches!(exe_name, "node.exe" | "bun.exe")
}
fn claude_kind(image: &str, args: &[String]) -> Option<&'static str> {
    let path = normalized(image);
    let name = path.rsplit('\\').next()?;
    if ["node.exe", "bun.exe"].contains(&name) && official_cli(args) {
        return Some("Claude Code");
    }
    let home = normalized(&std::env::var("USERPROFILE").ok()?);
    let local = normalized(&std::env::var("LOCALAPPDATA").ok()?);
    if name == "claude-code-helper.exe"
        && (path.starts_with(&format!("{home}\\.local\\share\\claude\\"))
            || path.starts_with(&format!("{home}\\.claude\\"))
            || path.starts_with(&format!("{local}\\anthropicclaude\\"))
            || path.starts_with(&format!("{local}\\programs\\claude\\")))
    {
        return Some("Claude Code");
    }
    if path == format!("{home}\\.local\\bin\\claude.exe")
        || path == format!("{home}\\.bun\\bin\\claude.exe")
        || path == format!("{home}\\scoop\\apps\\claude-code\\current\\claude.exe")
        || path == format!("{home}\\scoop\\shims\\claude.exe")
        || path == format!("{home}\\.volta\\bin\\claude.exe")
        || path == format!("{local}\\volta\\bin\\claude.exe")
        || (Path::new(&path).parent()
            == Some(Path::new(&format!(
                "{home}\\.local\\share\\claude\\versions"
            )))
            && version_name(name))
    {
        return Some("Claude Code");
    }
    if path.starts_with(&format!("{local}\\anthropicclaude\\"))
        || path.starts_with(&format!("{local}\\programs\\claude\\"))
    {
        if [
            "claude.exe",
            "cowork-svc.exe",
            "claude-ssh-askpass.exe",
            "claude-ssh-proxy.exe",
        ]
        .contains(&name)
        {
            return Some("Claude Desktop");
        }
    }
    if name != "claude.exe" {
        return None;
    }
    if path == format!("{local}\\microsoft\\winget\\packages\\anthropic.claudecode_microsoft.winget.source_8wekyb3d8bbwe\\claude.exe")
        || path == format!("{local}\\microsoft\\winget\\links\\claude.exe")
        || ide_extension_claude(&path, &home)
    {
        return Some("Claude Code");
    }
    None
}
fn ide_extension_claude(path: &str, home: &str) -> bool {
    let Some(before_bin) = path.strip_suffix("\\resources\\native-binary\\claude.exe") else {
        return false;
    };
    [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]
        .iter()
        .any(|ide| {
            let prefix = format!("{home}\\{ide}\\extensions\\anthropic.claude-code-");
            before_bin
                .strip_prefix(&prefix)
                .is_some_and(|ver| !ver.is_empty() && !ver.contains('\\'))
        })
}
fn version_name(name: &str) -> bool {
    let name = name.strip_suffix(".exe").unwrap_or(name);
    let parts: Vec<_> = name.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}
type CachedClaudeProc = Option<(&'static str, String, ClaudeProcessRole, bool)>;

static CLAUDE_PROC_CACHE: OnceLock<Mutex<HashMap<(u32, u64), CachedClaudeProc>>> = OnceLock::new();

fn claude_proc_cache() -> &'static Mutex<HashMap<(u32, u64), CachedClaudeProc>> {
    CLAUDE_PROC_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const CHILD_SHELL_EXES: &[&str] = &[
    "pwsh.exe",
    "powershell.exe",
    "cmd.exe",
    "bash.exe",
    "sh.exe",
    "zsh.exe",
    "python.exe",
    "python3.exe",
    "node.exe",
    "bun.exe",
];

fn classify_cli_role(cli_args: &[String]) -> (ClaudeProcessRole, bool) {
    let mut has_fork_session = false;
    let mut has_daemon = false;
    for arg in cli_args.iter().take_while(|a| a.as_str() != "--") {
        let s = arg.as_str();
        if s == "--bg-pty-host" || s.starts_with("--bg-pty-host=") {
            return (ClaudeProcessRole::BackgroundPtyHost, false);
        }
        if s == "--bg-spare"
            || s.starts_with("--bg-spare=")
            || s == "--daemon-worker"
            || s.starts_with("--daemon-worker=")
        {
            return (ClaudeProcessRole::BackgroundWorker, false);
        }
        if s == "daemon" {
            has_daemon = true;
        }
        if s == "--fork-session" || s.starts_with("--fork-session=") {
            has_fork_session = true;
        }
    }
    if has_daemon {
        return (ClaudeProcessRole::BackgroundDaemon, false);
    }
    (ClaudeProcessRole::InteractiveCli, has_fork_session)
}

fn has_background_host_ancestor(
    pid: u32,
    ppid_by_pid: &HashMap<u32, u32>,
    bg_host_pids: &HashSet<u32>,
) -> bool {
    if bg_host_pids.is_empty() {
        return false;
    }
    let mut visited = HashSet::with_capacity(6);
    visited.insert(pid);
    let mut cur = pid;
    for _ in 0..4 {
        let Some(&parent) = ppid_by_pid.get(&cur) else {
            break;
        };
        if parent <= 1 || !visited.insert(parent) {
            break;
        }
        if bg_host_pids.contains(&parent) {
            return true;
        }
        cur = parent;
    }
    false
}

fn collect_child_shells_from_tree<F>(
    root_pid: u32,
    claude_pids: &HashSet<u32>,
    children_by_ppid: &HashMap<u32, Vec<(u32, String)>>,
    mut is_pid_alive: F,
) -> Vec<String>
where
    F: FnMut(u32) -> bool,
{
    let mut out = Vec::new();
    let mut visited = HashSet::new();
    visited.insert(root_pid);
    let mut queue = std::collections::VecDeque::new();
    queue.push_back((root_pid, 0usize));
    while let Some((cur_pid, depth)) = queue.pop_front() {
        if depth >= 4 {
            continue;
        }
        let Some(children) = children_by_ppid.get(&cur_pid) else {
            continue;
        };
        for (child_pid, child_name) in children {
            if *child_pid <= 1 || !visited.insert(*child_pid) || claude_pids.contains(child_pid) {
                continue;
            }
            if matches!(child_name.as_str(), "conhost.exe" | "openconsole.exe") {
                continue;
            }
            if CHILD_SHELL_EXES.contains(&child_name.as_str()) && is_pid_alive(*child_pid) {
                if !out.contains(child_name) && out.len() < 8 {
                    out.push(child_name.clone());
                }
            }
            if depth + 1 < 4 {
                queue.push_back((*child_pid, depth + 1));
            }
        }
    }
    out
}

/// One Toolhelp snapshot: every `(pid, ppid, lowercase exe)` entry plus indices of Claude candidates.
/// Parent/child maps are derived lazily by the caller only when a candidate needs them.
struct ProcessSnapshotScan {
    entries: Vec<(u32, u32, String)>,
    candidates: Vec<usize>,
}

fn is_claude_candidate_name(name: &str) -> bool {
    [
        "claude.exe",
        "claude-code-helper.exe",
        "cowork-svc.exe",
        "claude-ssh-askpass.exe",
        "claude-ssh-proxy.exe",
        "node.exe",
        "bun.exe",
    ]
    .contains(&name)
        || version_name(name)
}

fn scan_process_snapshot() -> Result<ProcessSnapshotScan, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法检查 Windows 进程。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut scan = ProcessSnapshotScan {
        entries: Vec::with_capacity(256),
        candidates: vec![],
    };
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while has != 0 {
        let pid = entry.th32ProcessID;
        let ppid = entry.th32ParentProcessID;
        if pid > 1 {
            let name = String::from_utf16_lossy(&entry.szExeFile)
                .trim_end_matches('\0')
                .to_lowercase();
            if is_claude_candidate_name(&name) {
                scan.candidates.push(scan.entries.len());
            }
            scan.entries.push((pid, ppid, name));
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(scan)
}

fn ppid_map(entries: &[(u32, u32, String)]) -> HashMap<u32, u32> {
    entries.iter().map(|(pid, ppid, _)| (*pid, *ppid)).collect()
}

fn children_map(entries: &[(u32, u32, String)]) -> HashMap<u32, Vec<(u32, String)>> {
    let mut children_by_ppid: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    for (pid, ppid, name) in entries {
        children_by_ppid
            .entry(*ppid)
            .or_default()
            .push((*pid, name.clone()));
    }
    children_by_ppid
}

pub fn claude_processes() -> Result<Vec<ClaudeProcess>, String> {
    let scan = scan_process_snapshot()?;
    let candidates: Vec<(u32, String)> = scan
        .candidates
        .iter()
        .map(|&i| (scan.entries[i].0, scan.entries[i].2.clone()))
        .collect();
    let mut staged: Vec<(u32, &'static str, String, u64, ClaudeProcessRole, bool)> =
        Vec::with_capacity(candidates.len());
    let mut active_keys = HashSet::with_capacity(candidates.len());
    for (pid, exe_name) in candidates {
        // Always open with PROCESS_QUERY_LIMITED_INFORMATION (+ PROCESS_SYNCHRONIZE) first (zero PROCESS_VM_READ).
        let Some(limited) = Handle::open_limited(pid) else {
            continue;
        };
        if !limited.is_alive() {
            continue;
        }
        let Some(created) = limited.created() else {
            continue;
        };
        let key = (pid, created);
        active_keys.insert(key);
        if let Ok(cache) = claude_proc_cache().lock() {
            if let Some(cached) = cache.get(&key) {
                if let Some((kind, image, base_role, has_fork)) = cached {
                    staged.push((pid, *kind, image.clone(), created, *base_role, *has_fork));
                }
                continue;
            }
        }
        let Some(image) = limited.image() else {
            continue;
        };
        let resolved: CachedClaudeProc = if limited.packaged_claude() {
            Some(("Claude Desktop", image, ClaudeProcessRole::Desktop, false))
        } else if needs_vm_arguments(&exe_name) {
            let args = browser_arguments(pid, &limited, created).unwrap_or_default();
            claude_kind(&image, &args).map(|kind| {
                if kind == "Claude Desktop" {
                    (kind, image, ClaudeProcessRole::Desktop, false)
                } else {
                    let cli_args = args.get(2..).unwrap_or(&[]);
                    let (role, has_fork) = classify_cli_role(cli_args);
                    (kind, image, role, has_fork)
                }
            })
        } else {
            claude_kind(&image, &[]).map(|kind| {
                if kind == "Claude Desktop" {
                    (kind, image, ClaudeProcessRole::Desktop, false)
                } else {
                    // Query command line strictly via limited handle (ProcessCommandLineInformation = 60, zero PROCESS_VM_READ).
                    let args = query_command_line_limited(limited.0)
                        .filter(|_| limited.is_alive() && limited.created() == Some(created))
                        .unwrap_or_default();
                    let cli_args = args.get(1..).unwrap_or(&[]);
                    let (role, has_fork) = classify_cli_role(cli_args);
                    (kind, image, role, has_fork)
                }
            })
        };
        if let Ok(mut cache) = claude_proc_cache().lock() {
            cache.insert(key, resolved.clone());
        }
        if let Some((kind, executable, base_role, has_fork)) = resolved {
            staged.push((pid, kind, executable, created, base_role, has_fork));
        }
    }
    if let Ok(mut cache) = claude_proc_cache().lock() {
        cache.retain(|key, _| active_keys.contains(key));
    }
    if staged.is_empty() {
        return Ok(Vec::new());
    }
    // Parent/child maps are only built when at least one verified Claude process exists.
    let ppid_by_pid = ppid_map(&scan.entries);
    let children_by_ppid = if staged
        .iter()
        .any(|(_, _, _, _, role, _)| *role == ClaudeProcessRole::InteractiveCli)
    {
        children_map(&scan.entries)
    } else {
        HashMap::new()
    };

    let claude_pids: HashSet<u32> = staged.iter().map(|(pid, ..)| *pid).collect();
    let bg_host_pids: HashSet<u32> = staged
        .iter()
        .filter(|(_, _, _, _, role, _)| {
            matches!(
                role,
                ClaudeProcessRole::BackgroundPtyHost | ClaudeProcessRole::BackgroundDaemon
            )
        })
        .map(|(pid, ..)| *pid)
        .collect();

    let mut found = Vec::with_capacity(staged.len());
    for (pid, kind, executable, created, base_role, _has_fork) in staged {
        let role = if base_role == ClaudeProcessRole::InteractiveCli
            && has_background_host_ancestor(pid, &ppid_by_pid, &bg_host_pids)
        {
            ClaudeProcessRole::BackgroundWorker
        } else {
            base_role
        };
        let child_shells = if role == ClaudeProcessRole::InteractiveCli {
            collect_child_shells_from_tree(pid, &claude_pids, &children_by_ppid, |cpid| {
                Handle::open_limited(cpid).is_some_and(|h| h.is_alive())
            })
        } else {
            Vec::new()
        };
        found.push(ClaudeProcess {
            pid: pid as i32,
            name: kind.into(),
            executable,
            created,
            role,
            child_shells,
        });
    }
    Ok(found)
}

pub fn kill_process(target: &ClaudeProcess) -> Result<(), String> {
    let pid = target.pid as u32;
    let Some(handle) = Handle::open_terminate_limited(pid) else {
        if let Some(limited) = Handle::open_limited(pid) {
            if limited.is_alive()
                && limited.created() == Some(target.created)
                && limited.image().as_deref() == Some(target.executable.as_str())
            {
                return Err("无法终止已核验的 Claude 进程。".into());
            }
        }
        return Ok(());
    };
    if !handle.is_alive()
        || handle.created() != Some(target.created)
        || handle.image().as_deref() != Some(target.executable.as_str())
    {
        return Ok(());
    }
    let exe_name = normalized(&target.executable)
        .rsplit('\\')
        .next()
        .unwrap_or_default()
        .to_string();
    let args = if needs_vm_arguments(&exe_name) {
        browser_arguments(pid, &handle, target.created).unwrap_or_default()
    } else {
        vec![]
    };
    if !handle.packaged_claude() && claude_kind(&target.executable, &args).is_none() {
        return Ok(());
    }
    if unsafe { TerminateProcess(handle.0, 1) } == 0 {
        if !handle.is_alive() {
            if let Ok(mut cache) = claude_proc_cache().lock() {
                cache.remove(&(pid, target.created));
            }
            return Ok(());
        }
        return Err("无法终止已核验的 Claude 进程。".into());
    }
    let _ = handle.wait_exited(1500);
    if let Ok(mut cache) = claude_proc_cache().lock() {
        cache.remove(&(pid, target.created));
    }
    Ok(())
}
fn browser_arguments(pid: u32, limited: &Handle, expected_created: u64) -> Option<Vec<String>> {
    if let Some(args) = query_command_line_limited(limited.0) {
        if limited.is_alive() && limited.created() == Some(expected_created) {
            return Some(args);
        }
        return None;
    }
    let vm = Handle::open(pid, false)?;
    if !vm.is_alive() || vm.created() != Some(expected_created) {
        return None;
    }
    arguments(&vm)
}

// ----- Chrome 进程画像缓存：(pid, created_100ns) 进程生命周期内只取一次镜像路径与命令行 -----
#[derive(Clone, Debug, PartialEq, Eq)]
enum ChromeProbe {
    /// Image is not `...\chrome.exe` (e.g. another vendor's chrome.exe-named binary).
    NotChrome,
    Chrome { image: String, args: Vec<String> },
}

static CHROME_PROC_CACHE: OnceLock<Mutex<HashMap<(u32, u64), ChromeProbe>>> = OnceLock::new();

fn chrome_proc_cache() -> &'static Mutex<HashMap<(u32, u64), ChromeProbe>> {
    CHROME_PROC_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Memoized image/argument probe for a live, already-SID-verified chrome.exe handle.
/// Transient failures (`Err`) are never cached, so callers keep their unknown/skip semantics.
fn probe_chrome(pid: u32, limited: &Handle, created: u64) -> Result<ChromeProbe, ()> {
    let key = (pid, created);
    if let Some(hit) = chrome_proc_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).cloned())
    {
        return Ok(hit);
    }
    let image = limited.image().ok_or(())?;
    let probe = if normalized(&image).ends_with("\\chrome.exe") {
        let args = browser_arguments(pid, limited, created).ok_or(())?;
        ChromeProbe::Chrome { image, args }
    } else {
        ChromeProbe::NotChrome
    };
    if let Ok(mut cache) = chrome_proc_cache().lock() {
        cache.insert(key, probe.clone());
    }
    Ok(probe)
}

/// Drop cache entries for processes that are no longer present in a complete snapshot.
fn prune_chrome_cache(live: &HashSet<(u32, u64)>) {
    if let Ok(mut cache) = chrome_proc_cache().lock() {
        retain_live(&mut cache, live);
    }
}

fn retain_live<V>(cache: &mut HashMap<(u32, u64), V>, live: &HashSet<(u32, u64)>) {
    cache.retain(|key, _| live.contains(key));
}

#[cfg(test)]
fn chrome_cache_contains(key: (u32, u64)) -> bool {
    chrome_proc_cache()
        .lock()
        .map(|c| c.contains_key(&key))
        .unwrap_or(false)
}

/// Match one `--user-data-dir` against precomputed profile identities (same rules as `profile_matches`).
fn profile_index_matches(
    selected: &str,
    profiles: &[(Option<(u32, u64)>, String)],
) -> Vec<usize> {
    let selected_id = file_identity(Path::new(selected), true);
    let mut selected_lex: Option<String> = None;
    let mut hits = Vec::new();
    for (index, (profile_id, profile_lex)) in profiles.iter().enumerate() {
        let matched = match (selected_id, profile_id) {
            (Some(a), Some(b)) => a == *b,
            (None, None) => {
                selected_lex.get_or_insert_with(|| lexical_normalized_path(selected)) == profile_lex
            }
            _ => false,
        };
        if matched {
            hits.push(index);
        }
    }
    hits
}

/// Batched managed-profile liveness: ONE Toolhelp snapshot for all `profiles`, cached Chrome probes,
/// one file-identity open per profile and per running main Chrome process. Result aligns with input.
pub(crate) fn running_chrome_profiles(profiles: &[PathBuf]) -> Result<Vec<bool>, String> {
    let mut running = vec![false; profiles.len()];
    let prepared: Vec<(Option<(u32, u64)>, String)> = profiles
        .iter()
        .map(|p| {
            if !p.is_absolute() {
                // Never matches: an impossible identity plus an empty lexical key.
                return (Some((u32::MAX, u64::MAX)), String::new());
            }
            (
                file_identity(p, true),
                lexical_normalized_path(&p.to_string_lossy()),
            )
        })
        .collect();
    if profiles.is_empty() {
        return Ok(running);
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法检查正在运行的浏览器进程。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    if has == 0 {
        return Err("无法读取正在运行的浏览器进程。".into());
    }
    let mut live = HashSet::new();
    while has != 0 {
        let pid = entry.th32ProcessID;
        if pid > 1 && is_chrome_entry(&entry.szExeFile) {
            if let Some(limited) = Handle::open_limited(pid) {
                if limited.is_alive() {
                    if let Some(created) = limited.created() {
                        live.insert((pid, created));
                        if let Ok(ChromeProbe::Chrome { args, .. }) =
                            probe_chrome(pid, &limited, created)
                        {
                            if !has_child_process_type(&args) {
                                if let Some(selected) = profile_argument(&args) {
                                    for index in profile_index_matches(selected, &prepared) {
                                        running[index] = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    prune_chrome_cache(&live);
    Ok(running)
}

/// Case-insensitive `chrome.exe` check on the raw Toolhelp name without allocating for other processes.
fn is_chrome_entry(raw: &[u16]) -> bool {
    const CHROME: &[u8] = b"chrome.exe";
    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    len == CHROME.len()
        && raw[..len]
            .iter()
            .zip(CHROME)
            .all(|(&c, &b)| c < 128 && (c as u8).to_ascii_lowercase() == b)
}

fn has_child_process_type(args: &[String]) -> bool {
    args.iter()
        .take_while(|arg| arg.as_str() != "--")
        .any(|arg| arg.strip_prefix("--type=").is_some_and(|v| !v.is_empty()))
}

fn profile_argument(args: &[String]) -> Option<&str> {
    let mut selected: Option<&str> = None;
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            break;
        }
        if arg == "--user-data-dir" {
            let next = args.get(index + 1).map(String::as_str)?;
            if next == "--" || next.is_empty() || !Path::new(next).is_absolute() || selected.is_some()
            {
                return None;
            }
            selected = Some(next);
            index += 2;
            continue;
        }
        if let Some(val) = arg.strip_prefix("--user-data-dir=") {
            if val.is_empty() || !Path::new(val).is_absolute() || selected.is_some() {
                return None;
            }
            selected = Some(val);
        }
        index += 1;
    }
    selected
}

fn file_identity(path: &Path, directory: bool) -> Option<(u32, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return None;
    }
    let handle = Handle(raw);
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(handle.0, &mut info) } == 0
        || ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != directory
    {
        return None;
    }
    Some((
        info.dwVolumeSerialNumber,
        (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    ))
}

fn lexical_normalized_path(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    if let Some(unc) = s.strip_prefix("\\\\?\\UNC\\").or_else(|| s.strip_prefix("\\\\?\\unc\\")) {
        s = format!("\\\\{unc}");
    } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    }
    let mut out = Path::new(&s)
        .components()
        .filter(|c| !matches!(c, std::path::Component::CurDir))
        .collect::<std::path::PathBuf>()
        .to_string_lossy()
        .replace('/', "\\");
    while out.len() > 3 && out.ends_with('\\') {
        out.pop();
    }
    out.to_lowercase()
}

fn profile_matches(args: &[String], profile: &str) -> bool {
    let Some(selected) = profile_argument(args) else {
        return false;
    };
    if !Path::new(profile).is_absolute() {
        return false;
    }
    match (
        file_identity(Path::new(selected), true),
        file_identity(Path::new(profile), true),
    ) {
        (Some(id_sel), Some(id_prof)) => id_sel == id_prof,
        (None, None) => lexical_normalized_path(selected) == lexical_normalized_path(profile),
        (Some(_), None) | (None, Some(_)) => false,
    }
}

unsafe extern "system" fn close_window(window: HWND, pid: LPARAM) -> i32 {
    let mut owner = 0;
    GetWindowThreadProcessId(window, &mut owner);
    if owner == pid as u32 {
        PostMessageW(window, WM_CLOSE, 0, 0);
    }
    1
}

fn browser(profile: &str, close: bool) -> Result<bool, String> {
    if !Path::new(profile).is_absolute() {
        return Err("资料路径无效。".into());
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法检查正在运行的浏览器进程。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    if has == 0 {
        return Err("无法读取正在运行的浏览器进程。".into());
    }
    let mut found = false;
    let mut live = HashSet::new();
    while has != 0 {
        let pid = entry.th32ProcessID;
        if pid > 1 && is_chrome_entry(&entry.szExeFile) {
            if let Some(limited) = Handle::open_limited(pid) {
                if limited.is_alive() {
                    if let Some(created) = limited.created() {
                        live.insert((pid, created));
                        if let Ok(ChromeProbe::Chrome { args, .. }) =
                            probe_chrome(pid, &limited, created)
                        {
                            if !has_child_process_type(&args) && profile_matches(&args, profile) {
                                found = true;
                                if close {
                                    unsafe {
                                        EnumWindows(Some(close_window), pid as LPARAM);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    prune_chrome_cache(&live);
    Ok(found)
}
pub unsafe fn rf_browser_running(profile: *const c_char) -> *mut c_char {
    response(browser(input(profile), false).map(|running| json!({"running":running})))
}
pub unsafe fn rf_browser_quit(profile: *const c_char) -> *mut c_char {
    response(browser(input(profile), true).map(|_| json!({"ok":true})))
}

const EXCLUDED_NON_BROWSER_EXES: &[&str] = &[
    "claude.exe",
    "claude-code-helper.exe",
    "cowork-svc.exe",
    "claude-ssh-askpass.exe",
    "claude-ssh-proxy.exe",
    "claude-local.exe",
    "node.exe",
    "bun.exe",
];

fn is_excluded_non_browser_process(image: &str, args: &[String]) -> bool {
    let norm = normalized(image);
    let name = norm.rsplit('\\').next().unwrap_or("");
    if EXCLUDED_NON_BROWSER_EXES.contains(&name) || CHILD_SHELL_EXES.contains(&name) {
        return true;
    }
    claude_kind(image, args).is_some()
}

fn check_no_reparse_ancestors(path: &Path) -> Result<(), String> {
    let mut cur = PathBuf::new();
    for component in path.components() {
        cur.push(component);
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        match std::fs::symlink_metadata(&cur) {
            Ok(meta) if crate::cleaner::linked(&meta) => {
                return Err("检测到符号链接或联接点，已拒绝强制终止浏览器进程。".into());
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err("无法核验浏览器资料路径。".into());
            }
            _ => {}
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct TreeCandidate {
    pid: u32,
    created: u64,
    image: String,
    args: Vec<String>,
    same_image_dir: bool,
}

fn select_descendant_pids_pure(
    root_pid: u32,
    root_created: u64,
    profile_str: &str,
    children_by_ppid: &HashMap<u32, Vec<u32>>,
    inspect: &dyn Fn(u32) -> Option<TreeCandidate>,
) -> Vec<(u32, u64, String)> {
    const MAX_TREE_DEPTH: usize = 8;
    let mut visited = HashSet::new();
    visited.insert(root_pid);
    let mut queue = std::collections::VecDeque::new();
    queue.push_back((root_pid, 0usize));
    let mut selected = Vec::new();
    while let Some((pid, depth)) = queue.pop_front() {
        if depth >= MAX_TREE_DEPTH {
            continue;
        }
        let Some(children) = children_by_ppid.get(&pid) else {
            continue;
        };
        for &child_pid in children {
            if !visited.insert(child_pid) {
                continue;
            }
            let Some(cand) = inspect(child_pid) else {
                continue;
            };
            if cand.created < root_created || !cand.same_image_dir {
                continue;
            }
            if is_excluded_non_browser_process(&cand.image, &cand.args) {
                continue;
            }
            if normalized(&cand.image).ends_with("\\chrome.exe")
                && profile_argument(&cand.args).is_some()
                && !profile_matches(&cand.args, profile_str)
            {
                continue;
            }
            selected.push((cand.pid, cand.created, cand.image));
            queue.push_back((child_pid, depth + 1));
        }
    }
    selected
}

/// 5 重安全校验的受管浏览器进程树强杀兜底（仅在 `WM_CLOSE` 超时或被 `beforeunload` 拦截时调用）：
/// 1) 校验 `profile` 与 `expected_chrome_exe` 为绝对路径且无符号链接/联接点；
/// 2) 校验主进程为当前用户 SID、非子类型进程、`--user-data-dir` 文件标识精确匹配且镜像匹配 `expected_chrome_exe`；
/// 3) 有界 BFS（深度 <= 8 + 防环）收集同镜像目录后代，要求 `child_created >= root_created` 并排除 `claude.exe`/`node.exe`/`bun.exe`/shell；
/// 4) 逆序打开 `PROCESS_TERMINATE` 句柄并在调用 `TerminateProcess` 前再次核验 `created` 与 `image`；
/// 5) 终止后复核 `running_chrome_profiles(&[profile]) == [false]`，否则返回错误。
pub(crate) fn terminate_browser_profile_tree(
    profile: &Path,
    expected_chrome_exe: Option<&Path>,
) -> Result<bool, String> {
    if !profile.is_absolute() {
        return Err("资料路径无效。".into());
    }
    check_no_reparse_ancestors(profile)?;
    if let Some(exp) = expected_chrome_exe {
        if !exp.is_absolute() {
            return Err("浏览器引擎路径无效。".into());
        }
        check_no_reparse_ancestors(exp)?;
    }
    let profile_str = profile.to_str().ok_or("资料路径无效。")?;
    let self_pid = std::process::id();

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法创建进程快照以终止浏览器。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    if has == 0 {
        return Err("无法读取进程快照以终止浏览器。".into());
    }

    let mut children_by_ppid: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut roots: Vec<(u32, u64, String)> = Vec::new();
    let mut live = HashSet::new();
    let mut mismatched_binary = false;

    while has != 0 {
        let pid = entry.th32ProcessID;
        if pid > 1 && pid != self_pid {
            children_by_ppid
                .entry(entry.th32ParentProcessID)
                .or_default()
                .push(pid);
            if is_chrome_entry(&entry.szExeFile) {
                if let Some(limited) = Handle::open_limited(pid) {
                    if limited.is_alive() {
                        if let Some(created) = limited.created() {
                            live.insert((pid, created));
                            if let Ok(ChromeProbe::Chrome { image, args }) =
                                probe_chrome(pid, &limited, created)
                            {
                                if !has_child_process_type(&args)
                                    && profile_matches(&args, profile_str)
                                {
                                    let exe_matches = match expected_chrome_exe {
                                        Some(expected) => match (
                                            file_identity(Path::new(&image), false),
                                            file_identity(expected, false),
                                        ) {
                                            (Some(a), Some(b)) => a == b,
                                            _ => {
                                                lexical_normalized_path(&image)
                                                    == lexical_normalized_path(
                                                        &expected.to_string_lossy(),
                                                    )
                                            }
                                        },
                                        None => true,
                                    };
                                    if exe_matches && !is_excluded_non_browser_process(&image, &args)
                                    {
                                        roots.push((pid, created, image));
                                    } else {
                                        mismatched_binary = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    prune_chrome_cache(&live);

    if mismatched_binary && roots.is_empty() {
        return Err("检测到非受管引擎占用该资料，已拒绝强杀。".into());
    }
    if roots.is_empty() {
        let still = running_chrome_profiles(&[profile.to_path_buf()])?;
        if still.first().copied() == Some(true) {
            return Err("发现残留浏览器进程但未能通过身份校验。".into());
        }
        return Ok(false);
    }

    let mut targets: Vec<(u32, u64, String)> = Vec::new();
    let mut seen_target_pids = HashSet::new();
    for (root_pid, root_created, root_image) in roots {
        let root_dir = Path::new(&root_image).parent().map(Path::to_path_buf);
        let root_dir_id = root_dir.as_deref().and_then(|d| file_identity(d, true));
        let root_dir_lex = root_dir
            .as_deref()
            .map(|d| lexical_normalized_path(&d.to_string_lossy()));

        let descendants = select_descendant_pids_pure(
            root_pid,
            root_created,
            profile_str,
            &children_by_ppid,
            &|child_pid| {
                if child_pid == self_pid {
                    return None;
                }
                let child_handle = Handle::open_limited(child_pid)?;
                if !child_handle.is_alive() {
                    return None;
                }
                let child_created = child_handle.created()?;
                let child_image = child_handle.image()?;
                let child_dir = Path::new(&child_image).parent();
                let same_image_dir = match (child_dir.and_then(|d| file_identity(d, true)), root_dir_id) {
                    (Some(a), Some(b)) => a == b,
                    _ => child_dir
                        .map(|d| lexical_normalized_path(&d.to_string_lossy()))
                        .is_some_and(|l| Some(l) == root_dir_lex),
                };
                if !same_image_dir {
                    return None;
                }
                let child_norm = normalized(&child_image);
                let child_name = child_norm.rsplit('\\').next().unwrap_or("");
                let child_args = if child_name == "chrome.exe" || needs_vm_arguments(child_name) {
                    browser_arguments(child_pid, &child_handle, child_created).unwrap_or_default()
                } else {
                    Vec::new()
                };
                Some(TreeCandidate {
                    pid: child_pid,
                    created: child_created,
                    image: child_image,
                    args: child_args,
                    same_image_dir,
                })
            },
        );
        if seen_target_pids.insert(root_pid) {
            targets.push((root_pid, root_created, root_image));
        }
        for desc in descendants {
            if seen_target_pids.insert(desc.0) {
                targets.push(desc);
            }
        }
    }

    // Reverse order: terminate descendants before root process.
    for (pid, expected_created, expected_image) in targets.into_iter().rev() {
        let Some(handle) = Handle::open_terminate_limited(pid) else {
            if Handle::open_limited(pid).is_some_and(|h| h.is_alive()) {
                return Err("无法获取受管浏览器进程终止权限。".into());
            }
            continue;
        };
        if !handle.is_alive() {
            continue;
        }
        if handle.created() != Some(expected_created)
            || handle.image().as_deref() != Some(expected_image.as_str())
        {
            continue;
        }
        if unsafe { TerminateProcess(handle.0, 1) } == 0 && handle.is_alive() {
            return Err("无法强行终止受管浏览器进程。".into());
        }
        let _ = handle.wait_exited(1500);
        if let Ok(mut cache) = chrome_proc_cache().lock() {
            cache.remove(&(pid, expected_created));
        }
    }

    let still = running_chrome_profiles(&[profile.to_path_buf()])?;
    if still.first().copied() == Some(true) {
        return Err("受管浏览器进程树未完全退出。".into());
    }
    Ok(true)
}

struct BrowserWindowProbe {
    // Keep process handles alive throughout the window enumeration. Only this
    // already-proven profile's Chrome processes may own an observed window.
    processes: Vec<(u32, u64, String, Handle)>,
    visible: bool,
    uncertain: bool,
}
fn visible_profile_window(
    owner: u32,
    visible: bool,
    proven: impl IntoIterator<Item = u32>,
) -> bool {
    visible && proven.into_iter().any(|pid| pid == owner)
}
unsafe extern "system" fn inspect_browser_window(window: HWND, state: LPARAM) -> i32 {
    let probe = &mut *(state as *mut BrowserWindowProbe);
    let mut owner = 0;
    GetWindowThreadProcessId(window, &mut owner);
    if !visible_profile_window(
        owner,
        IsWindowVisible(window) != 0,
        probe.processes.iter().map(|(pid, _, _, _)| *pid),
    ) {
        return 1;
    }
    let Some((_, created, image, _)) = probe.processes.iter().find(|(pid, _, _, _)| *pid == owner)
    else {
        return 1;
    };
    // A PID observed in the Toolhelp snapshot is insufficient after process
    // exit/reuse. Reopen and compare its creation time and exact executable.
    match Handle::open_limited(owner) {
        Some(handle)
            if handle.is_alive()
                && handle.created() == Some(*created)
                && handle.image().as_deref() == Some(image.as_str()) =>
        {
            probe.visible = true;
        }
        _ => probe.uncertain = true,
    }
    1
}

/// Read-only current-user Chrome/profile observation. This deliberately avoids
/// `claude_processes()`: it never opens a Claude/node/bun process or reads its arguments.
/// An inspection failure is unknown to callers, never evidence of a closed UI.
pub(crate) fn browser_runtime(profile: &Path) -> Result<(bool, bool), String> {
    const UNKNOWN: &str = "无法检查浏览器窗口状态。";
    if !profile.is_absolute() {
        return Err("资料路径无效。".into());
    }
    let profile = profile.to_str().ok_or(UNKNOWN)?;
    let sid = current_sid().ok_or(UNKNOWN)?;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(UNKNOWN.into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    if has == 0 {
        return Err(UNKNOWN.into());
    }
    let mut probe = BrowserWindowProbe {
        processes: Vec::new(),
        visible: false,
        uncertain: false,
    };
    let mut live = HashSet::new();
    while has != 0 {
        if entry.th32ProcessID > 1 && is_chrome_entry(&entry.szExeFile) {
            let mut raw = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    entry.th32ProcessID,
                )
            };
            if raw.is_null() {
                raw = unsafe {
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID)
                };
            }
            if raw.is_null() {
                return Err(UNKNOWN.into());
            }
            let limited = Handle(raw);
            let owner = unsafe { process_sid(limited.0) }.ok_or(UNKNOWN)?;
            if &owner == sid && limited.is_alive() {
                let created = limited.created().ok_or(UNKNOWN)?;
                live.insert((entry.th32ProcessID, created));
                if let ChromeProbe::Chrome { image, args } =
                    probe_chrome(entry.th32ProcessID, &limited, created).map_err(|_| UNKNOWN)?
                {
                    if !has_child_process_type(&args) && profile_matches(&args, profile) {
                        probe
                            .processes
                            .push((entry.th32ProcessID, created, image, limited));
                    }
                }
            }
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    prune_chrome_cache(&live);
    if probe.processes.is_empty() {
        return Ok((false, false));
    }
    if unsafe {
        EnumWindows(
            Some(inspect_browser_window),
            (&mut probe as *mut BrowserWindowProbe) as LPARAM,
        )
    } == 0
        || probe.uncertain
    {
        return Err(UNKNOWN.into());
    }
    Ok((true, probe.visible))
}
// ----- 本次安装子进程树：超时和宿主退出都不会留下后台安装器 -----
pub(crate) struct ChildJob(Handle);
impl ChildJob {
    pub(crate) fn attach(child: &std::process::Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err("无法隔离 Windows 安装子进程。".into());
        }
        let job = Self(Handle(raw));
        let mut limit = unsafe { std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() };
        limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                (&limit as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limit) as u32,
            )
        } == 0
            || unsafe { AssignProcessToJobObject(raw, child.as_raw_handle()) } == 0
        {
            return Err("无法隔离 Windows 安装子进程。".into());
        }
        Ok(job)
    }
    pub(crate) fn stop(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0 .0, 1);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn wide(name: &str) -> [u16; 260] {
        let mut raw = [0u16; 260];
        for (slot, unit) in raw.iter_mut().zip(name.encode_utf16()) {
            *slot = unit;
        }
        raw
    }
    #[test]
    fn chrome_probe_cache_prunes_exited_processes_and_batched_scan_matches_profiles() {
        assert!(is_chrome_entry(&wide("chrome.exe")));
        assert!(is_chrome_entry(&wide("CHROME.EXE")));
        assert!(!is_chrome_entry(&wide("chrome.exe.bak")));
        assert!(!is_chrome_entry(&wide("xchrome.exe")));
        assert!(!is_chrome_entry(&wide("chrome.ex")));

        // (pid, created) keying: a reused PID with a new creation time is a different process.
        let mut cache: HashMap<(u32, u64), ChromeProbe> = HashMap::new();
        cache.insert((41, 1), ChromeProbe::NotChrome);
        cache.insert(
            (41, 2),
            ChromeProbe::Chrome {
                image: "C:\\synthetic\\chrome.exe".into(),
                args: vec!["--user-data-dir=C:\\synthetic\\profile".into()],
            },
        );
        cache.insert((42, 3), ChromeProbe::NotChrome);
        let live: HashSet<(u32, u64)> = [(41, 2)].into_iter().collect();
        retain_live(&mut cache, &live);
        assert_eq!(cache.len(), 1);
        assert!(matches!(cache.get(&(41, 2)), Some(ChromeProbe::Chrome { .. })));
        let synthetic = (u32::MAX - 7, 11u64);
        assert!(!chrome_cache_contains(synthetic));
        let base = std::env::temp_dir().join(format!(
            "claude-local-chrome-batch-{}",
            std::process::id()
        ));
        let a = base.join("contexts").join("a").join("profile");
        let b = base.join("contexts").join("b").join("profile");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let missing = base.join("missing").join("profile");
        let prepared: Vec<(Option<(u32, u64)>, String)> = [&a, &b, &missing]
            .iter()
            .map(|p| {
                (
                    file_identity(p, true),
                    lexical_normalized_path(&p.to_string_lossy()),
                )
            })
            .collect();
        assert_eq!(profile_index_matches(&a.to_string_lossy(), &prepared), vec![0]);
        assert_eq!(
            profile_index_matches(&format!("{}\\.", b.to_string_lossy()), &prepared),
            vec![1]
        );
        assert_eq!(
            profile_index_matches(&missing.to_string_lossy().to_uppercase(), &prepared),
            vec![2]
        );
        // Synthetic, never-launched profiles: one read-only snapshot reports none running.
        let flags =
            running_chrome_profiles(&[a.clone(), b.clone(), PathBuf::from("relative")]).unwrap();
        assert_eq!(flags, vec![false, false, false]);
        assert!(running_chrome_profiles(&[]).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }    #[test]
    fn runtime_window_requires_visibility_and_proven_profile_pid() {
        let selected_profile_pids = [101, 103];
        assert!(visible_profile_window(101, true, selected_profile_pids));
        assert!(!visible_profile_window(101, false, selected_profile_pids));
        assert!(!visible_profile_window(102, true, selected_profile_pids));
        assert!(!visible_profile_window(101, true, []));
    }
    #[test]
    fn exact_arguments_reject_substrings_and_unrelated_scripts() {
        assert!(official_cli(&[
            "node.exe".into(),
            "C:\\test\\node_modules\\@anthropic-ai\\claude-code\\cli.js".into()
        ]));
        assert!(!official_cli(&[
            "node.exe".into(),
            "C:\\other.js".into(),
            "C:\\test\\node_modules\\@anthropic-ai\\claude-code\\cli.js".into()
        ]));
        assert!(!profile_matches(
            &["--user-data-dir=C:\\profile-other".into()],
            "C:\\profile"
        ));
        assert!(profile_matches(
            &["--user-data-dir=C:\\空 格\\profile".into()],
            "C:\\空 格\\profile"
        ));
        let home = std::env::var("USERPROFILE").unwrap();
        let local = std::env::var("LOCALAPPDATA").unwrap();
        assert_eq!(
            claude_kind(&format!(r"{home}\.bun\bin\claude.exe"), &[]),
            Some("Claude Code")
        );
        assert_eq!(
            claude_kind(
                &format!(r"{local}\AnthropicClaude\app\resources\cowork-svc.exe"),
                &[]
            ),
            Some("Claude Desktop")
        );
        assert!(!needs_vm_arguments("claude.exe"));
        assert!(!needs_vm_arguments("2.1.304.exe"));
        assert!(needs_vm_arguments("node.exe"));
        assert!(needs_vm_arguments("bun.exe"));
        assert!(current_sid().is_some());
        let limited = Handle::open_limited(std::process::id());
        assert!(limited.is_some());
        let limited = limited.unwrap();
        assert!(limited.created().is_some());
        assert!(limited.image().is_some());
        assert!(Handle::open(std::process::id(), false).is_some());
    }

    #[test]
    fn query_only_self_handle_reads_complete_arguments_and_rejects_invalid_buffers() {
        let limited = Handle::open_limited(std::process::id()).unwrap();
        assert_eq!(
            query_command_line_limited(limited.0).unwrap(),
            std::env::args().collect::<Vec<_>>()
        );
        assert!(query_command_line_limited(std::ptr::null_mut()).is_none());
        assert!(decode_command_line_buffer(&[]).is_none());
        let mut buffer = [0usize; 16];
        let header = buffer.as_mut_ptr().cast::<Unicode>();
        unsafe {
            *header = Unicode {
                length: 2,
                maximum: 2,
                buffer: 2,
            };
            assert!(decode_command_line_buffer(&buffer).is_none());
            (*header).buffer = buffer.as_ptr() as usize + std::mem::size_of_val(&buffer);
            assert!(decode_command_line_buffer(&buffer).is_none());
            (*header).buffer = buffer.as_ptr() as usize + std::mem::size_of::<Unicode>();
            (*header).length = 3;
            assert!(decode_command_line_buffer(&buffer).is_none());
            (*header).length = 2;
            (*header).buffer += 1;
            assert!(decode_command_line_buffer(&buffer).is_none());
        }
    }

    #[test]
    fn browser_profile_file_identity_aliases_and_lexical_fallback() {
        let root = std::env::temp_dir().join(format!(
            "claude-local-win-profile-{}",
            crate::identities::new_id().unwrap()
        ));
        let profile = root.join("long profile name");
        let other = root.join("other");
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::create_dir_all(&other).unwrap();

        let verbatim = std::fs::canonicalize(&profile).unwrap();
        let with_dot = profile.join(".");
        assert_eq!(
            file_identity(&verbatim, true),
            file_identity(&profile, true)
        );
        assert_eq!(
            file_identity(&with_dot, true),
            file_identity(&profile, true)
        );
        assert!(profile_matches(
            &[
                "chrome.exe".into(),
                format!("--user-data-dir={}", verbatim.display())
            ],
            profile.to_str().unwrap()
        ));
        assert!(profile_matches(
            &[
                "chrome.exe".into(),
                "--user-data-dir".into(),
                with_dot.to_string_lossy().into()
            ],
            profile.to_str().unwrap()
        ));
        assert!(!profile_matches(
            &[
                "chrome.exe".into(),
                format!("--user-data-dir={}", other.display()),
                "--".into(),
                format!("--user-data-dir={}", profile.display())
            ],
            profile.to_str().unwrap()
        ));
        assert!(!profile_matches(
            &[
                "chrome.exe".into(),
                format!("--user-data-dir={}", root.join("missing").display())
            ],
            profile.to_str().unwrap()
        ));
        // Lexical fallback when neither path exists yet:
        let cold = root.join("not-created-yet");
        let cold_verbatim = format!(r"\\?\{}\.", cold.display());
        assert!(profile_matches(
            &[
                "chrome.exe".into(),
                format!("--user-data-dir={cold_verbatim}")
            ],
            cold.to_str().unwrap()
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn exited_process_with_unclosed_parent_handle_is_not_reported_alive() {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new("cmd.exe")
            .creation_flags(0x0800_0000)
            .args(["/C", "exit", "0"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn disposable cmd.exe");
        let pid = child.id();
        let wait_status = unsafe { WaitForSingleObject(child.as_raw_handle() as HANDLE, 5000) };
        assert_eq!(wait_status, WAIT_OBJECT_0);
        // `child` still holds an open parent HANDLE to the exited EPROCESS, reproducing
        // Windows Terminal / ConPTY lingering handles after terminal closure.
        let reopened = Handle::open_limited(pid).expect("reopen exited EPROCESS while handle held");
        assert!(
            !reopened.is_alive(),
            "exited EPROCESS with lingering handle must not be reported alive"
        );
        let dummy_target = ClaudeProcess {
            pid: pid as i32,
            name: "Claude Code".into(),
            executable: reopened.image().unwrap_or_default(),
            created: reopened.created().unwrap_or(0),
            role: ClaudeProcessRole::InteractiveCli,
            child_shells: Vec::new(),
        };
        assert_eq!(kill_process(&dummy_target), Ok(()));
        let _ = child.wait();
    }

    #[test]
    fn background_daemon_roles_and_child_shell_tree_are_classified_safely() {
        assert_eq!(
            classify_cli_role(&[
                "daemon".into(),
                "run".into(),
                "--origin".into(),
                "transient".into()
            ]),
            (ClaudeProcessRole::BackgroundDaemon, false)
        );
        assert!(ClaudeProcessRole::BackgroundDaemon.is_background());
        assert_eq!(
            classify_cli_role(&["--bg-pty-host".into(), "\\\\.\\pipe\\claude-pty".into()]),
            (ClaudeProcessRole::BackgroundPtyHost, false)
        );
        assert!(ClaudeProcessRole::BackgroundPtyHost.is_background());
        assert_eq!(
            classify_cli_role(&["--bg-spare".into(), "\\\\.\\pipe\\claude-claim".into()]),
            (ClaudeProcessRole::BackgroundWorker, false)
        );
        assert_eq!(
            classify_cli_role(&["--daemon-worker".into()]),
            (ClaudeProcessRole::BackgroundWorker, false)
        );
        assert!(ClaudeProcessRole::BackgroundWorker.is_background());
        assert_eq!(
            classify_cli_role(&[
                "--session-id".into(),
                "s-bg".into(),
                "--fork-session".into(),
                "--resume".into(),
                "s-orig".into()
            ]),
            (ClaudeProcessRole::InteractiveCli, true)
        );
        assert_eq!(
            classify_cli_role(&["--resume".into(), "s-orig".into()]),
            (ClaudeProcessRole::InteractiveCli, false)
        );
        assert_eq!(
            classify_cli_role(&["--verbose".into(), "daemon".into(), "start".into()]),
            (ClaudeProcessRole::BackgroundDaemon, false)
        );
        assert_eq!(
            classify_cli_role(&[
                "--debug".into(),
                "--bg-pty-host=\\\\.\\pipe\\claude-pty".into()
            ]),
            (ClaudeProcessRole::BackgroundPtyHost, false)
        );
        assert_eq!(
            classify_cli_role(&["--".into(), "daemon".into()]),
            (ClaudeProcessRole::InteractiveCli, false)
        );
        assert!(!ClaudeProcessRole::InteractiveCli.is_background());
        assert!(!ClaudeProcessRole::Desktop.is_background());

        let mut ppid_by_pid = HashMap::new();
        ppid_by_pid.insert(200, 100); // pty-host under daemon
        ppid_by_pid.insert(300, 200); // forked worker under pty-host
        ppid_by_pid.insert(400, 50); // standalone interactive claude under terminal
        // Cycle guard check
        ppid_by_pid.insert(900, 901);
        ppid_by_pid.insert(901, 900);
        let bg_hosts: HashSet<u32> = [100u32, 200u32].into_iter().collect();
        assert!(has_background_host_ancestor(300, &ppid_by_pid, &bg_hosts));
        assert!(!has_background_host_ancestor(400, &ppid_by_pid, &bg_hosts));
        assert!(!has_background_host_ancestor(900, &ppid_by_pid, &bg_hosts));

        let mut children: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
        children.insert(
            400,
            vec![
                (401, "conhost.exe".into()),
                (402, "pwsh.exe".into()),
                (403, "claude.exe".into()), // nested subagent claude: must NOT traverse
            ],
        );
        children.insert(402, vec![(404, "python.exe".into()), (405, "pwsh.exe".into())]);
        children.insert(403, vec![(406, "bash.exe".into())]); // under nested claude: excluded
        children.insert(404, vec![(407, "cmd.exe".into())]); // depth 3
        children.insert(407, vec![(408, "node.exe".into())]); // depth 4
        children.insert(408, vec![(409, "sh.exe".into())]); // depth 5 (>4): excluded
        let claude_pids: HashSet<u32> = [400u32, 403u32].into_iter().collect();
        let shells =
            collect_child_shells_from_tree(400, &claude_pids, &children, |pid| pid != 40700);
        assert_eq!(shells, vec!["pwsh.exe", "python.exe", "cmd.exe", "node.exe"]);
    }

    #[test]
    fn terminate_browser_profile_tree_enforces_five_layer_safety_and_kills_matching_tree() {
        use std::os::windows::process::CommandExt;
        // 1. Pure descendant selection checks (cycle, depth > 8, PID reuse, non-browser exclusion, profile mismatch).
        let profile = r"C:\synthetic\profile_a";
        let other_profile = r"C:\synthetic\profile_b";
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        children.insert(100, vec![101, 102, 103, 104, 105, 106, 107]);
        children.insert(101, vec![108]);
        // Cycle: 108 -> 100
        children.insert(108, vec![100]);
        // Depth chain from 108 (depth 2) -> 201..209
        let mut prev = 108u32;
        for d in 201..=209u32 {
            children.insert(prev, vec![d]);
            prev = d;
        }
        let cands: HashMap<u32, TreeCandidate> = [
            (
                101,
                TreeCandidate {
                    pid: 101,
                    created: 500,
                    image: r"C:\Engine\chrome.exe".into(),
                    args: vec!["--type=renderer".into()],
                    same_image_dir: true,
                },
            ),
            (
                102,
                TreeCandidate {
                    pid: 102,
                    created: 400, // older than root (PID reuse!) -> MUST exclude
                    image: r"C:\Engine\chrome.exe".into(),
                    args: vec!["--type=utility".into()],
                    same_image_dir: true,
                },
            ),
            (
                103,
                TreeCandidate {
                    pid: 103,
                    created: 501,
                    image: r"C:\Engine\claude.exe".into(),
                    args: vec![],
                    same_image_dir: true,
                },
            ),
            (
                104,
                TreeCandidate {
                    pid: 104,
                    created: 502,
                    image: r"C:\Engine\node.exe".into(),
                    args: vec![],
                    same_image_dir: true,
                },
            ),
            (
                105,
                TreeCandidate {
                    pid: 105,
                    created: 503,
                    image: r"C:\Engine\pwsh.exe".into(),
                    args: vec![],
                    same_image_dir: true,
                },
            ),
            (
                106,
                TreeCandidate {
                    pid: 106,
                    created: 504,
                    image: r"C:\Other\chrome.exe".into(),
                    args: vec![],
                    same_image_dir: false,
                },
            ),
            (
                107,
                TreeCandidate {
                    pid: 107,
                    created: 505,
                    image: r"C:\Engine\chrome.exe".into(),
                    args: vec![format!("--user-data-dir={other_profile}")],
                    same_image_dir: true,
                },
            ),
            (
                108,
                TreeCandidate {
                    pid: 108,
                    created: 506,
                    image: r"C:\Engine\chrome.exe".into(),
                    args: vec![format!("--user-data-dir={profile}"), "--type=gpu-process".into()],
                    same_image_dir: true,
                },
            ),
        ]
        .into_iter()
        .chain((201..=209u32).map(|pid| {
            (
                pid,
                TreeCandidate {
                    pid,
                    created: 600,
                    image: r"C:\Engine\chrome.exe".into(),
                    args: vec!["--type=renderer".into()],
                    same_image_dir: true,
                },
            )
        }))
        .collect();
        let selected = select_descendant_pids_pure(100, 500, profile, &children, &|pid| {
            cands.get(&pid).cloned()
        });
        let pids: Vec<u32> = selected.iter().map(|x| x.0).collect();
        assert!(pids.contains(&101));
        assert!(pids.contains(&108));
        assert!(!pids.contains(&102), "older PID-reused process must be excluded");
        assert!(!pids.contains(&103), "claude.exe must be excluded");
        assert!(!pids.contains(&104), "node.exe must be excluded");
        assert!(!pids.contains(&105), "pwsh.exe must be excluded");
        assert!(!pids.contains(&106), "foreign image dir must be excluded");
        assert!(!pids.contains(&107), "mismatched profile must be excluded");
        assert!(pids.contains(&206), "depth 8 must be reached");
        assert!(!pids.contains(&207), "depth > 8 must be bounded");

        // 2. Live disposable process-tree termination test (zero real claude.exe / chrome.exe touched).
        let base = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("claude-local-tree-kill-{}", crate::identities::new_id().unwrap()));
        let engine_a = base.join("engine_a");
        let engine_b = base.join("engine_b");
        let prof_a = base.join("profile_a");
        let prof_b = base.join("profile_b");
        std::fs::create_dir_all(&engine_a).unwrap();
        std::fs::create_dir_all(&engine_b).unwrap();
        std::fs::create_dir_all(&prof_a).unwrap();
        std::fs::create_dir_all(&prof_b).unwrap();
        let sys_cmd = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()))
            .join("System32")
            .join("cmd.exe");
        let fake_chrome_a = engine_a.join("chrome.exe");
        let fake_chrome_b = engine_b.join("chrome.exe");
        std::fs::copy(&sys_cmd, &fake_chrome_a).unwrap();
        std::fs::copy(&sys_cmd, &fake_chrome_b).unwrap();

        let mut child_a = std::process::Command::new(&fake_chrome_a)
            .creation_flags(0x0800_0000)
            .args(["/d", "/c", "set /p x="])
            .arg(format!("--user-data-dir={}", prof_a.display()))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let mut child_b = std::process::Command::new(&fake_chrome_b)
            .creation_flags(0x0800_0000)
            .args(["/d", "/c", "set /p x="])
            .arg(format!("--user-data-dir={}", prof_b.display()))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(80));
        let before = running_chrome_profiles(&[prof_a.clone(), prof_b.clone()]).unwrap();
        assert_eq!(before, vec![true, true]);

        // Mismatched expected binary must refuse termination and keep child_a alive.
        assert!(terminate_browser_profile_tree(&prof_a, Some(&fake_chrome_b)).is_err());
        assert_eq!(
            running_chrome_profiles(&[prof_a.clone(), prof_b.clone()]).unwrap(),
            vec![true, true]
        );

        // Matching binary terminates only prof_a while leaving prof_b completely untouched.
        assert_eq!(
            terminate_browser_profile_tree(&prof_a, Some(&fake_chrome_a)).unwrap(),
            true
        );
        assert_eq!(
            running_chrome_profiles(&[prof_a.clone(), prof_b.clone()]).unwrap(),
            vec![false, true]
        );
        assert!(child_a.try_wait().unwrap().is_some());
        assert!(child_b.try_wait().unwrap().is_none());

        // Cleanup child_b cleanly.
        drop(child_b.stdin.take());
        let _ = child_b.kill();
        let _ = child_b.wait();
        let _ = child_a.wait();
        let _ = std::fs::remove_dir_all(&base);
    }
}
