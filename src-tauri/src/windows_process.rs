// [INPUT]: Win32 Toolhelp/进程句柄、当前用户 SID、精确 CLI 入口与独立浏览器资料路径。
// [OUTPUT]: Claude 进程零侵入识别（优先 PROCESS_QUERY_LIMITED_INFORMATION + (pid, created) 缓存）、创建时间/所有权复核后的结束、浏览器在 PROCESS_QUERY_LIMITED_INFORMATION 下经 NtQueryInformationProcess(ProcessCommandLineInformation = 60) 零 VM_READ 读取完整参数（必要时优雅回退）并以文件句柄标识（GetFileInformationByHandle + 未建路径词法回退）匹配关闭及只读可见窗口采样。
// [POS]: Windows 进程边界；原生二进制与受管浏览器免 PROCESS_VM_READ/ReadProcessMemory；参数仅用于 node/bun/chrome 判定，不返回 UI。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{current_sid, input, process_sid, response};
use crate::cleaner::ClaudeProcess;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    ffi::c_char,
    path::Path,
    sync::{Mutex, OnceLock},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, FILETIME, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM},
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
        },
        Threading::{
            GetProcessTimes, IsWow64Process, OpenProcess, QueryFullProcessImageNameW,
            TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
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
    /// Open with `PROCESS_QUERY_LIMITED_INFORMATION` only (zero `PROCESS_VM_READ`).
    /// Prevents cross-process PEB/memory reads on native `claude.exe` / `versions\X.Y.Z.exe`.
    fn open_limited(pid: u32) -> Option<Self> {
        Self::open_with_flags(pid, PROCESS_QUERY_LIMITED_INFORMATION)
    }
    fn open(pid: u32, terminate: bool) -> Option<Self> {
        let flags = PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_VM_READ
            | if terminate { PROCESS_TERMINATE } else { 0 };
        Self::open_with_flags(pid, flags)
    }
    fn image(&self) -> Option<String> {
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
static CLAUDE_PROC_CACHE: OnceLock<Mutex<HashMap<(u32, u64), Option<(&'static str, String)>>>> =
    OnceLock::new();

fn claude_proc_cache() -> &'static Mutex<HashMap<(u32, u64), Option<(&'static str, String)>>> {
    CLAUDE_PROC_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn claude_candidate_pids() -> Result<Vec<(u32, String)>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法检查 Windows 进程。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut result = vec![];
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while has != 0 {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_lowercase();
        if ([
            "claude.exe",
            "claude-code-helper.exe",
            "cowork-svc.exe",
            "claude-ssh-askpass.exe",
            "claude-ssh-proxy.exe",
            "node.exe",
            "bun.exe",
        ]
        .contains(&name.as_str())
            || version_name(&name))
            && entry.th32ProcessID > 1
        {
            result.push((entry.th32ProcessID, name));
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(result)
}

fn processes(terminate: bool) -> Result<Vec<(u32, Handle)>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法检查 Windows 进程。".into());
    }
    let snapshot = Handle(snapshot);
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut result = vec![];
    let mut has = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while has != 0 {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_lowercase();
        if ([
            "claude.exe",
            "claude-code-helper.exe",
            "cowork-svc.exe",
            "claude-ssh-askpass.exe",
            "claude-ssh-proxy.exe",
            "node.exe",
            "bun.exe",
            "chrome.exe",
        ]
        .contains(&name.as_str())
            || version_name(&name))
            && entry.th32ProcessID > 1
        {
            if let Some(handle) = Handle::open(entry.th32ProcessID, terminate) {
                result.push((entry.th32ProcessID, handle));
            }
        }
        has = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(result)
}

pub fn claude_processes() -> Result<Vec<ClaudeProcess>, String> {
    let candidates = claude_candidate_pids()?;
    let mut found = vec![];
    let mut active_keys = HashSet::with_capacity(candidates.len());
    for (pid, exe_name) in candidates {
        // Always open with PROCESS_QUERY_LIMITED_INFORMATION first (zero PROCESS_VM_READ).
        let Some(limited) = Handle::open_limited(pid) else {
            continue;
        };
        let Some(created) = limited.created() else {
            continue;
        };
        let key = (pid, created);
        active_keys.insert(key);
        if let Ok(cache) = claude_proc_cache().lock() {
            if let Some(cached) = cache.get(&key) {
                if let Some((kind, image)) = cached {
                    found.push(ClaudeProcess {
                        pid: pid as i32,
                        name: (*kind).into(),
                        executable: image.clone(),
                        created,
                    });
                }
                continue;
            }
        }
        let Some(image) = limited.image() else {
            continue;
        };
        let kind = if limited.packaged_claude() {
            Some("Claude Desktop")
        } else if needs_vm_arguments(&exe_name) {
            let args = Handle::open(pid, false)
                .and_then(|vm_handle| arguments(&vm_handle))
                .unwrap_or_default();
            claude_kind(&image, &args)
        } else {
            claude_kind(&image, &[])
        };
        let resolved = kind.map(|k| (k, image));
        if let Ok(mut cache) = claude_proc_cache().lock() {
            cache.insert(key, resolved.clone());
        }
        if let Some((kind, executable)) = resolved {
            found.push(ClaudeProcess {
                pid: pid as i32,
                name: kind.into(),
                executable,
                created,
            });
        }
    }
    if let Ok(mut cache) = claude_proc_cache().lock() {
        cache.retain(|key, _| active_keys.contains(key));
    }
    Ok(found)
}

pub fn kill_process(target: &ClaudeProcess) -> Result<(), String> {
    let Some(handle) = Handle::open(target.pid as u32, true) else {
        return Ok(());
    };
    if handle.created() != Some(target.created)
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
        arguments(&handle).unwrap_or_default()
    } else {
        vec![]
    };
    if !handle.packaged_claude() && claude_kind(&target.executable, &args).is_none() {
        return Ok(());
    }
    if unsafe { TerminateProcess(handle.0, 1) } == 0 {
        return Err("无法终止已核验的 Claude 进程。".into());
    }
    Ok(())
}
fn browser_arguments(pid: u32, limited: &Handle, expected_created: u64) -> Option<Vec<String>> {
    if let Some(args) = query_command_line_limited(limited.0) {
        if limited.created() == Some(expected_created) {
            return Some(args);
        }
        return None;
    }
    let vm = Handle::open(pid, false)?;
    if vm.created() != Some(expected_created) {
        return None;
    }
    arguments(&vm)
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
    while has != 0 {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_lowercase();
        let pid = entry.th32ProcessID;
        if name == "chrome.exe" && pid > 1 {
            if let Some(limited) = Handle::open_limited(pid) {
                if limited
                    .image()
                    .is_some_and(|image| normalized(&image).ends_with("\\chrome.exe"))
                {
                    if let Some(created) = limited.created() {
                        if let Some(args) = browser_arguments(pid, &limited, created) {
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
    Ok(found)
}
pub unsafe fn rf_browser_running(profile: *const c_char) -> *mut c_char {
    response(browser(input(profile), false).map(|running| json!({"running":running})))
}
pub unsafe fn rf_browser_quit(profile: *const c_char) -> *mut c_char {
    response(browser(input(profile), true).map(|_| json!({"ok":true})))
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
            if handle.created() == Some(*created)
                && handle.image().as_deref() == Some(image.as_str()) =>
        {
            probe.visible = true;
        }
        _ => probe.uncertain = true,
    }
    1
}

/// Read-only current-user Chrome/profile observation. This deliberately avoids
/// `processes()`: it never opens a Claude/node/bun process or reads its arguments.
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
    while has != 0 {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_lowercase();
        if name == "chrome.exe" && entry.th32ProcessID > 1 {
            let raw =
                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
            if raw.is_null() {
                return Err(UNKNOWN.into());
            }
            let limited = Handle(raw);
            let owner = unsafe { process_sid(limited.0) }.ok_or(UNKNOWN)?;
            if &owner == sid {
                let image = limited.image().ok_or(UNKNOWN)?;
                if normalized(&image).ends_with("\\chrome.exe") {
                    let created = limited.created().ok_or(UNKNOWN)?;
                    let args =
                        browser_arguments(entry.th32ProcessID, &limited, created).ok_or(UNKNOWN)?;
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
    #[test]
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
}
