// [INPUT]: Windows 当前用户/默认所有者 SID、时区、注册表状态、系统工具、受限进程接口与 Win32 文件路径。
// [OUTPUT]: Windows 平台 JSON 桥；用户/实际默认所有者文件检查、长路径调用、会话首选语言和仅原生使用的系统代理（空白变量回退并区分 SOCKS 协议）。
// [POS]: 仅原生识别与用户触发的系统操作；不含网络客户端，不向 UI 输出进程参数或代理秘密。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::{
    ffi::{c_char, CStr, CString},
    process::{Command, Stdio},
};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
use windows_sys::Win32::Security::OWNER_SECURITY_INFORMATION;
use windows_sys::Win32::Security::{
    GetLengthSid, GetTokenInformation, IsValidSid, TokenOwner, TokenUser, TOKEN_OWNER, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
#[path = "windows_process.rs"]
mod processes;
pub(crate) use processes::ChildJob;
pub use processes::{claude_processes, kill_process, rf_browser_quit, rf_browser_running};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[link(name = "kernel32")]
extern "system" {
    fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> HANDLE;
    fn GlobalLock(hMem: HANDLE) -> *mut std::ffi::c_void;
    fn GlobalUnlock(hMem: HANDLE) -> i32;
    fn GlobalFree(hMem: HANDLE) -> HANDLE;
}

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(hWndNewOwner: HANDLE) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(uFormat: u32, hMem: HANDLE) -> HANDLE;
}

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 0x0002;

fn response(value: Result<Value, String>) -> *mut c_char {
    let value = value.unwrap_or_else(|error| json!({"error": error}));
    CString::new(value.to_string())
        .expect("JSON escapes NUL")
        .into_raw()
}

unsafe fn input<'a>(value: *const c_char) -> &'a str {
    CStr::from_ptr(value).to_str().unwrap_or("")
}

pub unsafe fn rf_free(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

fn output(program: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(program)
        .creation_flags(0x08000000)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|_| format!("Windows: {program} 无法执行。"))?;
    if !out.status.success() {
        let err_msg = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Windows: {program} 执行失败: {err_msg}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let file: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let inst = ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
        if (inst as usize) > 32 {
            Ok(())
        } else {
            Err("无法打开目标地址。".into())
        }
    }
}

pub unsafe fn rf_copy(text: *const c_char) -> Result<(), String> {
    let val = input(text);
    let wide: Vec<u16> = val.encode_utf16().chain(Some(0)).collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();

    let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if h_mem.is_null() {
        return Err("无法分配剪贴板内存。".into());
    }
    let ptr = GlobalLock(h_mem);
    if ptr.is_null() {
        GlobalFree(h_mem);
        return Err("无法锁定剪贴板内存。".into());
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, bytes);
    GlobalUnlock(h_mem);

    let owner = windows_sys::Win32::UI::Input::KeyboardAndMouse::GetActiveWindow();
    if owner.is_null() || OpenClipboard(owner) == 0 {
        GlobalFree(h_mem);
        return Err("无法打开系统剪贴板。".into());
    }
    if EmptyClipboard() == 0 {
        CloseClipboard();
        GlobalFree(h_mem);
        return Err("剪贴板写入失败。".into());
    }
    let res = SetClipboardData(CF_UNICODETEXT, h_mem);
    CloseClipboard();

    if res.is_null() {
        GlobalFree(h_mem);
        Err("剪贴板写入失败。".into())
    } else {
        Ok(())
    }
}

pub unsafe fn rf_credentials_list() -> *mut c_char {
    response(Err(
        "Windows 凭据管理器不自动读取；文件登录记录可在清理预览中选择。".into(),
    ))
}
#[allow(dead_code)]
pub unsafe fn rf_credentials_remove(_: *const c_char) -> *mut c_char {
    response(Err("Windows 凭据管理器不支持自动删除。".into()))
}

// ----- 所有权：只比较 SID，不收集账户名称或凭据正文 -----
pub(super) unsafe fn process_sid(process: HANDLE) -> Option<Vec<u8>> {
    let mut token = std::ptr::null_mut();
    if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
        return None;
    }
    let mut size = 0;
    GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
    let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    let ok = size > 0
        && GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        ) != 0;
    let sid = if ok {
        let user = &*(buffer.as_ptr().cast::<TOKEN_USER>());
        Some(
            std::slice::from_raw_parts(
                user.User.Sid.cast::<u8>(),
                GetLengthSid(user.User.Sid) as usize,
            )
            .to_vec(),
        )
    } else {
        None
    };
    CloseHandle(token);
    sid
}
pub(super) fn current_sid() -> Option<&'static Vec<u8>> {
    static SID: std::sync::OnceLock<Option<Vec<u8>>> = std::sync::OnceLock::new();
    SID.get_or_init(|| unsafe { process_sid(GetCurrentProcess()) })
        .as_ref()
}

unsafe fn copy_sid(sid: *mut std::ffi::c_void) -> Option<Vec<u8>> {
    if sid.is_null() || IsValidSid(sid) == 0 {
        return None;
    }
    Some(std::slice::from_raw_parts(sid.cast::<u8>(), GetLengthSid(sid) as usize).to_vec())
}

fn push_unique_sid(sids: &mut Vec<Vec<u8>>, candidate: Option<Vec<u8>>) {
    if let Some(sid) = candidate {
        if !sids.iter().any(|existing| existing == &sid) {
            sids.push(sid);
        }
    }
}

// 仅信任进程用户与实际默认所有者；组成员（包括 deny-only 管理员组）不证明文件属于本人。
unsafe fn current_process_owner_sids() -> Vec<Vec<u8>> {
    let mut sids = Vec::new();
    push_unique_sid(&mut sids, current_sid().cloned());
    let mut token = std::ptr::null_mut();
    if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
        return sids;
    }
    let mut size = 0;
    GetTokenInformation(token, TokenOwner, std::ptr::null_mut(), 0, &mut size);
    if size > 0 {
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if GetTokenInformation(
            token,
            TokenOwner,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        ) != 0
        {
            let owner = &*(buffer.as_ptr().cast::<TOKEN_OWNER>());
            push_unique_sid(&mut sids, copy_sid(owner.Owner));
        }
    }
    CloseHandle(token);
    sids
}

pub(super) fn current_owner_sids() -> &'static [Vec<u8>] {
    static SIDS: std::sync::OnceLock<Vec<Vec<u8>>> = std::sync::OnceLock::new();
    SIDS.get_or_init(|| unsafe { current_process_owner_sids() })
        .as_slice()
}

// Win32 名称 API 对普通路径有 MAX_PATH(260) 限制；绝对且不含相对段的路径在
// 分隔符统一为反斜杠后转为 \\?\ verbatim 形式再补 NUL，其余路径原样返回。
pub fn wide_path(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.starts_with(&[92, 92, 63, 92]) || wide.starts_with(&[92, 92, 46, 92]) {
        wide.push(0);
        return wide;
    }
    for c in wide.iter_mut() {
        if *c == b'/' as u16 {
            *c = b'\\' as u16;
        }
    }
    let backslash = |c: &u16| *c == b'\\' as u16;
    let has_prefix = |text: &str| wide.starts_with(&text.encode_utf16().collect::<Vec<u16>>());
    let disk = wide.len() >= 3
        && matches!(wide[0], 0x41..=0x5A | 0x61..=0x7A)
        && wide[1] == ':' as u16
        && wide[2] == '\\' as u16;
    let unc = !disk && wide.len() >= 2 && backslash(&wide[0]) && backslash(&wide[1]);
    if (disk || unc) && !has_prefix(r"\\?\") && !has_prefix(r"\\.\") {
        let dot = [b'.' as u16];
        let dotdot = [b'.' as u16, b'.' as u16];
        let mut segments = wide.split(backslash);
        if unc {
            segments.next();
            segments.next();
        } else {
            segments.next();
        }
        if segments.all(|segment| {
            !segment.is_empty() && segment != dot.as_slice() && segment != dotdot.as_slice()
        }) {
            let mut verbatim: Vec<u16> = r"\\?\".encode_utf16().collect();
            if unc {
                verbatim.extend(r"UNC\".encode_utf16());
                verbatim.extend_from_slice(&wide[2..]);
            } else {
                verbatim.extend_from_slice(&wide);
            }
            wide = verbatim;
        }
    }
    wide.push(0);
    wide
}
fn file_owner_sid(path: &std::path::Path) -> Option<Vec<u8>> {
    let wide = wide_path(path);
    unsafe {
        let mut owner = std::ptr::null_mut();
        let mut descriptor = std::ptr::null_mut();
        let status = GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        );
        let actual = if status == 0 { copy_sid(owner) } else { None };
        if !descriptor.is_null() {
            LocalFree(descriptor.cast());
        }
        actual
    }
}
pub fn owned(path: &std::path::Path) -> bool {
    file_owner_sid(path).is_some_and(|actual| current_owner_sids().contains(&actual))
}
#[cfg(test)]
pub(crate) fn fixture_owner(path: &std::path::Path) {
    let wide = wide_path(path);
    let mut owner = current_sid().expect("test user SID").clone();
    assert_eq!(
        unsafe {
            windows_sys::Win32::Security::Authorization::SetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                owner.as_mut_ptr().cast(),
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
            )
        },
        0
    );
}
pub fn preserve_file_permissions(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    use windows_sys::Win32::Security::Authorization::SetNamedSecurityInfoW;
    use windows_sys::Win32::Security::{
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };
    let source = wide_path(source);
    let target = wide_path(target);
    unsafe {
        let mut owner = std::ptr::null_mut();
        let mut acl = std::ptr::null_mut();
        let mut descriptor = std::ptr::null_mut();
        let read = GetNamedSecurityInfoW(
            source.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut acl,
            std::ptr::null_mut(),
            &mut descriptor,
        );
        let status = if read == 0 && !owner.is_null() && !acl.is_null() {
            let first = SetNamedSecurityInfoW(
                target.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION,
                owner,
                std::ptr::null_mut(),
                acl,
                std::ptr::null(),
            );
            if first != 0 {
                if let Some(sid) = current_sid() {
                    SetNamedSecurityInfoW(
                        target.as_ptr(),
                        SE_FILE_OBJECT,
                        OWNER_SECURITY_INFORMATION
                            | DACL_SECURITY_INFORMATION
                            | PROTECTED_DACL_SECURITY_INFORMATION,
                        sid.as_ptr() as *mut _,
                        std::ptr::null_mut(),
                        acl,
                        std::ptr::null(),
                    )
                } else {
                    first
                }
            } else {
                0
            }
        } else {
            1
        };
        if !descriptor.is_null() {
            LocalFree(descriptor.cast());
        }
        if status != 0 {
            return Err("无法保留 Windows 配置权限，未写入内容。".into());
        }
    }
    Ok(())
}
pub fn linked(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}

pub unsafe fn rf_keychain_unlock() -> *mut c_char {
    response(Ok(json!({"message": "Windows 凭据管理器无需单独解锁。"})))
}

pub fn open_settings(pane: &str) -> Result<Value, String> {
    let uri = match pane {
        "timezone" => "ms-settings:dateandtime",
        "language" => "ms-settings:regionformatting",
        "location" => "ms-settings:privacy-location",
        _ => return Err("无效的系统设置入口。".into()),
    };
    open_external_url(uri)?;
    Ok(json!({"ok": true}))
}

#[path = "windows_timezones.rs"]
mod zones;
use zones::TZ_MAP;

pub fn iana_to_windows_tz(iana: &str) -> Option<&'static str> {
    TZ_MAP.iter().find(|(i, _)| *i == iana).map(|(_, w)| *w)
}

pub fn windows_to_iana_tz(win: &str) -> Option<&'static str> {
    let win_clean = win.trim();
    TZ_MAP
        .iter()
        .find(|(_, w)| w.eq_ignore_ascii_case(win_clean))
        .map(|(i, _)| *i)
}

pub fn timezone() -> String {
    let out = raw_windows_timezone();
    crate::regions::get_regions()
        .iter()
        .find(|region| {
            region.locale == locale() && iana_to_windows_tz(region.timezone) == Some(out.as_str())
        })
        .map(|region| region.timezone)
        .or_else(|| windows_to_iana_tz(&out))
        .unwrap_or(&out)
        .to_string()
}

pub fn raw_windows_timezone() -> String {
    use windows_sys::Win32::System::Time::{
        GetDynamicTimeZoneInformation, DYNAMIC_TIME_ZONE_INFORMATION,
    };
    let mut information = unsafe { std::mem::zeroed::<DYNAMIC_TIME_ZONE_INFORMATION>() };
    if unsafe { GetDynamicTimeZoneInformation(&mut information) } == u32::MAX {
        return String::new();
    }
    let key = information
        .TimeZoneKeyName
        .split(|c| *c == 0)
        .next()
        .unwrap_or_default();
    String::from_utf16_lossy(key)
}

pub fn timezones() -> Vec<String> {
    let mut list = Vec::new();
    for (iana, _) in TZ_MAP {
        list.push((*iana).to_string());
    }
    list.sort();
    list.dedup();
    list
}

fn locale() -> String {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;
    let mut value = [0u16; 85];
    let count = unsafe { GetUserDefaultLocaleName(value.as_mut_ptr(), value.len() as i32) };
    if count <= 1 {
        return String::new();
    }
    String::from_utf16_lossy(&value[..count as usize - 1]).replace('-', "_")
}
pub(crate) fn normalize_language_tag(tag: &str) -> String {
    let trimmed = tag.trim();
    match trimmed {
        "zh-CN" | "zh-SG" | "zh-Hans" => "zh-Hans".into(),
        "zh-TW" | "zh-HK" | "zh-MO" | "zh-Hant" => "zh-Hant".into(),
        s if s.starts_with("zh-Hans-") => "zh-Hans".into(),
        s if s.starts_with("zh-Hant-") => "zh-Hant".into(),
        s if s.starts_with("fr-") => "fr".into(),
        s if s.starts_with("de-") => "de".into(),
        s if s.starts_with("ja-") => "ja".into(),
        s if s.starts_with("ko-") => "ko".into(),
        s if s.starts_with("es-") => "es".into(),
        s if s.starts_with("it-") => "it".into(),
        _ => trimmed.into(),
    }
}
fn ui_display_language() -> String {
    use windows_sys::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};
    let mut count = 0;
    let mut size = 0;
    unsafe {
        GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut count,
            std::ptr::null_mut(),
            &mut size,
        );
    }
    let mut buffer = vec![0u16; size as usize];
    if size == 0
        || unsafe {
            GetUserPreferredUILanguages(
                MUI_LANGUAGE_NAME,
                &mut count,
                buffer.as_mut_ptr(),
                &mut size,
            )
        } == 0
    {
        return String::new();
    }
    let first = buffer.split(|c| *c == 0).next().unwrap_or_default();
    normalize_language_tag(&String::from_utf16_lossy(first))
}
fn user_profile_language() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_MULTI_SZ, RRF_RT_REG_SZ,
    };
    let key: Vec<u16> = r"Control Panel\International\User Profile"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let name: Vec<u16> = "Languages".encode_utf16().chain(Some(0)).collect();
    let mut value = [0u16; 2048];
    let mut bytes = std::mem::size_of_val(&value) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ,
            std::ptr::null_mut(),
            value.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if status != 0 || bytes < 2 {
        return None;
    }
    let first = value[..bytes as usize / 2]
        .split(|c| *c == 0)
        .find(|s| !s.is_empty())?;
    let normalized = normalize_language_tag(&String::from_utf16_lossy(first));
    (!normalized.is_empty()).then_some(normalized)
}
fn session_language() -> String {
    user_profile_language().unwrap_or_else(ui_display_language)
}
pub(super) fn registry_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    key: &str,
    name: &str,
) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let key: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut value = [0u16; 2048];
    let mut bytes = std::mem::size_of_val(&value) as u32;
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            value.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if status != 0 {
        return None;
    }
    Some(
        String::from_utf16_lossy(&value[..bytes as usize / 2])
            .trim_end_matches('\0')
            .into(),
    )
}
pub(super) fn registry_dword(
    root: windows_sys::Win32::System::Registry::HKEY,
    key: &str,
    name: &str,
) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_DWORD};
    let key: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut value: u32 = 0;
    let mut bytes = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut value as *mut u32).cast(),
            &mut bytes,
        )
    };
    if status != 0 {
        return None;
    }
    Some(value)
}

pub(crate) fn parse_windows_proxy_server(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.contains('=') {
        let pairs: Vec<(&str, &str)> = trimmed
            .split(';')
            .filter_map(|part| part.trim().split_once('='))
            .map(|(k, v)| (k.trim(), v.trim()))
            .filter(|(_, v)| !v.is_empty())
            .collect();
        for kind in ["https", "http", "socks", "socks5"] {
            if let Some((_, addr)) = pairs.iter().find(|(k, _)| k.eq_ignore_ascii_case(kind)) {
                if addr.contains("://") {
                    return (*addr).into();
                }
                let scheme = match kind {
                    "socks" => "socks4",
                    "socks5" => "socks5h",
                    _ => "http",
                };
                return format!("{scheme}://{addr}");
            }
        }
        return String::new();
    }
    let first = trimmed
        .split(';')
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or("");
    if first.is_empty() {
        String::new()
    } else if first.contains("://") {
        first.into()
    } else {
        format!("http://{first}")
    }
}

fn first_nonempty_proxy(values: impl IntoIterator<Item = String>) -> Option<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .find(|value| !value.is_empty())
}

pub(crate) fn system_proxy() -> String {
    if let Some(env_proxy) = first_nonempty_proxy(
        [
            "ALL_PROXY",
            "all_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
        ]
        .iter()
        .filter_map(|k| std::env::var(k).ok()),
    ) {
        return env_proxy;
    }
    use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
    let key = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    if registry_dword(HKEY_CURRENT_USER, key, "ProxyEnable").unwrap_or(0) != 0 {
        if let Some(server) = registry_string(HKEY_CURRENT_USER, key, "ProxyServer") {
            return parse_windows_proxy_server(&server);
        }
    }
    String::new()
}

fn location_enabled() -> Option<bool> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let hklm = registry_string(
        HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location",
        "Value",
    );
    if hklm.as_deref() == Some("Deny") {
        return Some(false);
    }
    for subkey in [
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location",
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location\NonPackaged",
    ] {
        if registry_string(HKEY_CURRENT_USER, subkey, "Value").as_deref() == Some("Deny") {
            return Some(false);
        }
    }
    match hklm.as_deref()? {
        "Allow" => Some(true),
        "Deny" => Some(false),
        _ => None,
    }
}

fn snapshot() -> Value {
    json!({
        "platform": "windows",
        "timezone": timezone(),
        "timezones": timezones(),
        "automatic_timezone": null,
        "languages": [session_language()],
        "location_enabled": location_enabled(),
        "accessibility": false
    })
}

pub unsafe fn rf_browser_machine() -> *mut c_char {
    let mut state = snapshot();
    state["platform"] = json!("windows");
    static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    state["version"] = json!(VERSION.get_or_init(|| output(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[System.Environment]::OSVersion.Version.ToString()"
        ]
    )
    .unwrap_or_default()));
    state["cores"] = json!(std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1));
    state["locale"] = json!(locale());
    state["system_proxy"] = json!(system_proxy());
    response(Ok(state))
}

pub unsafe fn rf_system_read() -> *mut c_char {
    response(Ok(snapshot()))
}

pub unsafe fn rf_system_open(pane: *const c_char) -> *mut c_char {
    response(open_settings(input(pane)))
}

pub unsafe fn rf_system_timezone(zone: *const c_char) -> *mut c_char {
    response((|| {
        let requested = input(zone).trim();
        let target_win_tz = iana_to_windows_tz(requested).ok_or("无效的时区。")?;
        if output("tzutil", &["/s", target_win_tz]).is_err() {
            open_settings("timezone")?;
            return Err("Windows 未允许修改时区；请在系统设置中完成授权后重试。".into());
        }
        let current_raw = raw_windows_timezone();
        if current_raw.to_lowercase() != target_win_tz.to_lowercase() {
            return Err("时区修改未通过核验。".into());
        }
        Ok(json!({
            "state": snapshot(),
            "message": "时区已成功应用并核验。"
        }))
    })())
}

fn language_matches(current: &str, requested: &str) -> bool {
    current == requested
        || current
            .strip_prefix(requested)
            .is_some_and(|s| s.starts_with('-'))
}
fn region_settings(language: &str, region: Option<&str>) -> Result<Value, String> {
    let tag = if let Some(locale) = region {
        crate::regions::get_regions()
            .iter()
            .find(|r| r.language == language && r.locale == locale)
            .ok_or("语言或区域无效。")?
            .locale
            .replace('_', "-")
    } else {
        match language {
            "en" | "en-US" => "en-US",
            "en-CA" => "en-CA",
            "en-GB" => "en-GB",
            "en-SG" => "en-SG",
            "en-AU" => "en-AU",
            "zh-Hans" => "zh-CN",
            "zh-Hant" => "zh-TW",
            "fr" => "fr-FR",
            "de" => "de-DE",
            "es" => "es-ES",
            "it" => "it-IT",
            "pt-BR" => "pt-BR",
            "ja" => "ja-JP",
            "ko" => "ko-KR",
            "ru" => "ru-RU",
            "ar" => "ar-SA",
            _ => return Err("语言或区域无效。".into()),
        }
        .into()
    };
    let display_language = ui_display_language();
    let script = include_str!("../../scripts/windows-region.ps1").trim_start_matches('\u{feff}');
    let result = Command::new("powershell")
        .creation_flags(0x08000000)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("CC_REGION_LANGUAGE", &tag)
        .env("CC_REGION_LOCALE", region.unwrap_or("").replace('_', "-"))
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Windows 语言设置无法执行。")?;
    if !result.status.success()
        || !String::from_utf8_lossy(&result.stdout).contains("CC_REGION_DONE=1")
    {
        open_settings("language")?;
        return Err("Windows 语言设置未完成；请检查系统设置中的语言包和权限。".into());
    }
    if region.is_some_and(|r| locale() != r) {
        return Err("Windows 区域格式修改未通过核验。".into());
    }
    let saved_language = session_language();
    if !language_matches(&saved_language, language) {
        open_settings("language")?;
        return Err(
            "首选语言与区域已保存；安装所需语言包并注销、重新登录后再核验显示语言。".into(),
        );
    }
    let message = if language_matches(&display_language, language) {
        "系统语言与区域已应用并核验。"
    } else {
        "首选语言与地区格式已保存，部分应用需重启或注销。"
    };
    Ok(json!({"state": snapshot(), "message": message}))
}
pub unsafe fn rf_system_language(language: *const c_char) -> *mut c_char {
    response(region_settings(input(language), None))
}
pub unsafe fn rf_system_region(language: *const c_char, locale: *const c_char) -> *mut c_char {
    response(region_settings(input(language), Some(input(locale))))
}

pub unsafe fn rf_system_location() -> *mut c_char {
    response((|| {
        if location_enabled() == Some(false) {
            Ok(json!({
                "state": snapshot(),
                "message": "Windows 定位权限已成功禁用并核验。"
            }))
        } else {
            open_settings("location")?;
            Err("请在打开的 Windows 设置窗口中手动关闭定位权限。".into())
        }
    })())
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
