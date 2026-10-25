// [INPUT]: 宿主独立资料目录、原生进程核验、本人目录继承权限补齐、Unix 所有权/权限元数据与已验证配置。
// [OUTPUT]: 浏览资料占用保护、窄范围 Preferences 更新、缓存/登录数据清理及全资料重置。
// [POS]: 文件边界；常规清理遍历固定位置，全清理枚举并清空独立资料目录，拒绝链接，不生成备份。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#[cfg(target_os = "linux")]
use crate::linux::*;
use crate::native::decode;
#[cfg(target_os = "windows")]
use crate::windows::*;
use serde::Serialize;
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use std::ffi::c_char;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::{
    ffi::CString,
    fs,
    path::{Path, PathBuf},
};
#[cfg(target_os = "macos")]
extern "C" {
    fn rf_browser_running(profile: *const c_char) -> *mut c_char;
    fn rf_browser_quit(profile: *const c_char) -> *mut c_char;
}
pub fn running(profile: &Path) -> Result<bool, String> {
    let path = CString::new(profile.to_string_lossy().as_bytes()).map_err(|_| "资料路径无效。")?;
    let state: Value = decode(unsafe { rf_browser_running(path.as_ptr()) })?;
    Ok(state["running"].as_bool().unwrap_or(false))
}
pub fn quit(profile: &Path) -> Result<(), String> {
    let path = CString::new(profile.to_string_lossy().as_bytes()).map_err(|_| "资料路径无效。")?;
    let _: Value = decode(unsafe { rf_browser_quit(path.as_ptr()) })?;
    for _ in 0..100 {
        if !running(profile)? {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Err("浏览器仍在运行，请保存任务并关闭浏览器窗口。".into())
}
pub fn check_path(root: &Path, path: &Path) -> Result<(), String> {
    if !path.starts_with(root) {
        return Err("路径不在独立浏览资料内。".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) if crate::cleaner::linked(&meta) => {
                return Err("检测到链接，未修改资料。".into())
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err("无法检查浏览资料路径。".into())
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let root = path.parent().ok_or("配置目录无效。")?;
    check_path(root, path)?;
    fs::create_dir_all(root).map_err(|_| "无法创建浏览器目录。")?;
    let _ = crate::identities::private::ensure_owner_dacl(root);
    let temp = path.with_extension("pending");
    check_path(root, &temp)?;
    let data = serde_json::to_vec_pretty(value).map_err(|_| "配置编码失败。")?;
    fs::write(&temp, data).map_err(|_| "配置写入失败。")?;
    #[cfg(unix)]
    fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
        .map_err(|_| "配置权限设置失败。")?;
    if fs::rename(&temp, path).is_err() {
        let _ = fs::remove_file(&temp);
        return Err("配置保存失败。".into());
    }
    Ok(())
}
pub fn preferences(
    profile: &Path,
    config: &super::config::Config,
    machine: &super::config::Machine,
) -> Result<(), String> {
    let path = profile.join("Default/Preferences");
    check_path(profile, &path)?;
    let mut data: Value = match fs::read(&path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Preferences 损坏，未覆盖原文件。")?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => return Err("无法读取 Preferences。".into()),
    };
    if !data.is_object() {
        return Err("Preferences 格式错误。".into());
    }
    for pointer in [
        "/intl",
        "/webrtc",
        "/profile",
        "/profile/default_content_setting_values",
        "/profile/content_settings",
        "/profile/content_settings/exceptions",
    ] {
        if data
            .pointer(pointer)
            .map(|v| !v.is_object() && !v.is_null())
            .unwrap_or(false)
        {
            return Err("Preferences 字段格式错误，未修改原文件。".into());
        }
    }
    let lang = config.language(machine);
    data["intl"]["accept_languages"] =
        json!(format!("{lang},{}", lang.split('-').next().unwrap_or("en")));
    data["intl"]["selected_languages"] = data["intl"]["accept_languages"].clone();
    data["webrtc"]["ip_handling_policy"] = json!("disable_non_proxied_udp");
    data["profile"]["default_content_setting_values"]["geolocation"] = json!(2);
    // Chromium 148 的定位拆分近似/精确权限；同时关闭两项，旧键兼容旧资料。
    data["profile"]["default_content_setting_values"]["geolocation_with_options"] =
        json!({"approximate":2,"precise":2});
    data["profile"]["content_settings"]["exceptions"]["geolocation"] = json!({});
    data["profile"]["content_settings"]["exceptions"]["geolocation_with_options"] = json!({});
    write_json(&path, &data)
}
pub const CACHE: &[&str] = &[
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
    "ShaderCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "Crashpad/reports",
];
pub const SITE_DATA: &[&str] = &[
    "Default/Network/Cookies",
    "Default/Network/Cookies-journal",
    "Default/Network/Trust Tokens",
    "Default/Network/Trust Tokens-journal",
    "Default/Network/TransportSecurity",
    "Default/Network/Network Persistent State",
    "Default/Network/Reporting and Nel",
    "Default/Network/Reporting and Nel-journal",
    "Default/Cookies",
    "Default/Cookies-journal",
    "Default/Local Storage",
    "Default/Session Storage",
    "Default/IndexedDB",
    "Default/Service Worker",
    "Default/WebStorage",
    "Default/Storage",
    "Default/Sessions",
    "Default/Shared Dictionary",
    "Default/SharedStorage",
    "Default/SharedStorage-wal",
    "Default/DIPS",
    "Default/DIPS-journal",
    "Default/DIPS-wal",
    "Default/DIPS-shm",
    "Default/BrowsingTopicsState",
    "Default/blob_storage",
];
fn read_cache_dir(path: &Path) -> Result<fs::ReadDir, String> {
    match fs::read_dir(path) {
        Ok(entries) => Ok(entries),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            if let Some(parent) = path.parent() {
                let _ = crate::identities::private::ensure_owner_dacl(parent);
            }
            crate::identities::private::ensure_owner_dacl(path)?;
            fs::read_dir(path).map_err(|_| "无法枚举缓存。".to_string())
        }
        Err(_) => Err("无法枚举缓存。".into()),
    }
}
fn size(path: &Path) -> Result<u64, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "无法读取缓存项目。")?;
    if crate::cleaner::linked(&meta) {
        return Err("缓存中包含链接，已停止。".into());
    }
    if meta.is_file() {
        return Ok(meta.len());
    }
    let mut bytes = 0;
    for entry in read_cache_dir(path)? {
        bytes += size(&entry.map_err(|_| "无法读取缓存条目。")?.path())?;
    }
    Ok(bytes)
}
#[derive(Serialize)]
pub struct CacheItem {
    pub path: String,
    pub bytes: u64,
    pub login: bool,
}
pub fn scan(profile: &Path) -> Result<Vec<CacheItem>, String> {
    let mut items = Vec::new();
    for (paths, login) in [(CACHE, false), (SITE_DATA, true)] {
        for name in paths {
            let path = profile.join(name);
            check_path(profile, &path)?;
            if path.exists() {
                items.push(CacheItem {
                    path: name.to_string(),
                    bytes: size(&path)?,
                    login,
                });
            }
        }
    }
    Ok(items)
}
pub fn clear(
    profile: &Path,
    login: bool,
    mut log: impl FnMut(&str, bool),
) -> Result<usize, String> {
    let paths = if login {
        CACHE.iter().chain(SITE_DATA).copied().collect::<Vec<_>>()
    } else {
        CACHE.to_vec()
    };
    let mut count = 0;
    for name in paths {
        let path = profile.join(name);
        check_path(profile, &path)?;
        if !path.exists() {
            continue;
        }
        size(&path)?;
        log(name, false);
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if result.is_err() {
            return Err(format!("{name} 删除失败；已处理 {count} 项，后续未执行。"));
        }
        count += 1;
        log(name, true);
    }
    Ok(count)
}
fn reset_metadata(profile: &Path, path: &Path) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "浏览器资料发生变化。")?;
    #[cfg(unix)]
    {
        extern "C" {
            fn getuid() -> u32;
        }
        // 崩溃遗留的三类 Chromium 根锁仅删除链接自身，绝不进入链接目标。
        if meta.file_type().is_symlink()
            && path.parent() == Some(profile)
            && matches!(
                path.file_name().and_then(|s| s.to_str()),
                Some("SingletonLock" | "SingletonCookie" | "SingletonSocket")
            )
            && meta.uid() == unsafe { getuid() }
        {
            check_path(profile, profile)?;
            return Ok(meta);
        }
    }
    check_path(profile, path)?;
    crate::identities::private::safe(path)?;
    Ok(meta)
}
pub fn reset(
    profile: &Path,
    mut ensure_stopped: impl FnMut() -> Result<(), String>,
    mut log: impl FnMut(&str, bool, usize, usize),
) -> Result<usize, String> {
    use crate::identities::private;
    ensure_stopped()?;
    check_path(profile, profile)?;
    match fs::symlink_metadata(profile) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Ok(meta) if meta.is_dir() => {}
        _ => return Err("无法完整检查浏览器资料目录，未执行重置。".into()),
    }
    let original = crate::cleaner::identity::fingerprint(profile)?;
    let mut pending = vec![profile.to_path_buf()];
    let mut plan = Vec::new();
    // ----- 完整预检先于任何删除；不把未知文件或额外 Chromium Profile 排除在外 -----
    while let Some(path) = pending.pop() {
        let meta = reset_metadata(profile, &path)?;
        let directory = meta.is_dir();
        if directory {
            pending.extend(
                read_cache_dir(&path)
                    .map_err(|_| "无法完整检查浏览器资料目录，未执行重置。")?
                    .map(|entry| entry.map(|e| e.path()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "无法完整检查浏览器资料目录，未执行重置。")?,
            );
        }
        if path != profile {
            let stamp = if directory {
                Vec::new()
            } else {
                crate::cleaner::identity::fingerprint(&path)?
            };
            plan.push((path, meta.file_type(), stamp));
        }
    }
    if crate::cleaner::identity::fingerprint(profile)? != original {
        return Err("浏览器资料发生变化，未执行重置。".into());
    }
    plan.sort_by(|a, b| {
        b.0.components()
            .count()
            .cmp(&a.0.components().count())
            .then(a.0.cmp(&b.0))
    });
    let total = plan.len();
    let mut count = 0;
    let result = (|| {
        ensure_stopped()?;
        let mut checked_at = std::time::Instant::now();
        for (path, kind, stamp) in plan {
            // 与身份文件事务相同，每 250ms 复查进程，避免每个小文件都扫描系统进程。
            if checked_at.elapsed() >= std::time::Duration::from_millis(250) {
                ensure_stopped()?;
                checked_at = std::time::Instant::now();
            }
            let meta = reset_metadata(profile, &path).map_err(|_| "浏览器资料发生变化。")?;
            if meta.file_type() != kind
                || (!kind.is_dir() && crate::cleaner::identity::fingerprint(&path)? != stamp)
            {
                return Err("浏览器资料发生变化。".into());
            }
            let name = path
                .strip_prefix(profile)
                .map_err(|_| "资料路径无效。")?
                .to_string_lossy();
            log(&name, false, count, total);
            // 非递归删除目录：预检后新加入的文件不会被顺带删除。
            if kind.is_dir() {
                fs::remove_dir(&path)
            } else {
                fs::remove_file(&path)
            }
            .map_err(|_| "浏览器资料删除失败。")?;
            count += 1;
            log(&name, true, count, total);
        }
        ensure_stopped()?;
        check_path(profile, profile).map_err(|_| "浏览器资料发生变化。")?;
        private::safe(profile)?;
        if fs::read_dir(profile)
            .map_err(|_| "无法复查浏览器资料目录。")?
            .next()
            .is_some()
        {
            return Err("浏览器资料仍有未清理项目。".into());
        }
        Ok::<_, String>(())
    })();
    result.map_err(|error| {
        format!("浏览器资料重置未完成；已删除 {count}/{total} 个项目，后续未执行。{error}")
    })?;
    Ok(count)
}
