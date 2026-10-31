// [INPUT]: Current-user known Windows core processes and local YAML file handles.
// [OUTPUT]: Native-only candidate paths and fixed evidence status; bounded UTF-8 content for projection.
// [POS]: Read-only risk source discovery; no commands, network, process memory reads, secrets or paths serialized.
// [PROTOCOL]: Update this header and parent CLAUDE.md when changing this boundary.
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

pub(super) struct Discovery {
    pub paths: Vec<PathBuf>,
    pub process_stamps: Vec<(u32, u64)>,
    pub status: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
enum CoreOwner {
    CurrentUser,
    SystemService,
    Unsupported,
}

fn core_owner(owner: Option<&[u8]>, current: &[u8]) -> CoreOwner {
    if owner == Some(current) {
        CoreOwner::CurrentUser
    } else if owner == Some(&[1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]) {
        CoreOwner::SystemService
    } else {
        CoreOwner::Unsupported
    }
}

#[cfg(windows)]
fn clash_verge_service_runtime_allowed(path: &Path, appdata_base: &Path) -> bool {
    let program_data = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let service_root = program_data.join("clash-verge-service");
    let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if !file_name.eq_ignore_ascii_case("config.yaml") {
        return false;
    }
    let Some(runtime_dir) = path.parent() else {
        return false;
    };
    if !runtime_dir
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("runtime"))
    {
        return false;
    }
    let Some(user_dir) = runtime_dir.parent() else {
        return false;
    };
    let Some(owner_key) = user_dir.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if owner_key.len() != 64 || !owner_key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return false;
    }
    let Some(users_dir) = user_dir.parent() else {
        return false;
    };
    let normalize = |p: &Path| {
        dunce::simplified(p)
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    if normalize(users_dir) != normalize(&service_root.join("users")) {
        return false;
    }
    if !no_links(path)
        || !crate::windows::service_or_user_owned(path)
        || !crate::windows::service_or_user_owned(runtime_dir)
    {
        return false;
    }
    let expected_appdata = normalize(&appdata_base.join("io.github.clash-verge-rev.clash-verge-rev"));
    let matches_appdata = |meta_path: &Path, max_bytes: u64| -> bool {
        read_bounded_utf8(meta_path, max_bytes).is_some_and(|raw| {
            let unescaped = raw.replace("\\\\", "\\").replace('/', "\\").to_ascii_lowercase();
            unescaped.contains(&expected_appdata)
        })
    };
    matches_appdata(&service_root.join("active-owner.json"), 16 * 1024)
        || matches_appdata(&runtime_dir.join(".runtime-manifest.json"), 64 * 1024)
}

#[cfg(windows)]
fn service_config_allowed(path: &Path) -> bool {
    let Some(appdata) = std::env::var_os("APPDATA") else {
        return false;
    };
    let base = PathBuf::from(appdata);
    let known_roots = [
        base.join("io.github.clash-verge-rev.clash-verge-rev"),
        base.join("mihomo-party"),
        base.join("com.follow"),
    ];
    let normalize = |p: &Path| {
        dunce::simplified(p)
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    let normalized = normalize(path);
    let in_user_appdata = known_roots
        .iter()
        .any(|root| normalized.starts_with(&(normalize(root) + "\\")))
        && no_links(path)
        && crate::windows::owned(path)
        && path.parent().is_some_and(crate::windows::owned);
    in_user_appdata || clash_verge_service_runtime_allowed(path, &base)
}

fn config_argument(args: &[String]) -> Option<PathBuf> {
    let mut selected = None;
    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        let value = if matches!(arg.as_str(), "-f" | "--config") {
            i += 1;
            args.get(i)?.as_str()
        } else if let Some(value) = arg
            .strip_prefix("--config=")
            .or_else(|| arg.strip_prefix("-f="))
        {
            value
        } else {
            i += 1;
            continue;
        };
        let path = PathBuf::from(value);
        if selected.is_some()
            || !path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return None;
        }
        let name = path.file_name()?.to_str()?.to_ascii_lowercase();
        if !matches!(path.extension()?.to_str()?, "yaml" | "yml")
            || ["secret", "token", "credential", "private"]
                .iter()
                .any(|s| name.contains(s))
        {
            return None;
        }
        selected = Some(path);
        i += 1;
    }
    selected
}

fn no_links(path: &Path) -> bool {
    path.ancestors().all(|part| {
        let Ok(meta) = std::fs::symlink_metadata(part) else {
            return false;
        };
        if meta.file_type().is_symlink() {
            return false;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return false;
            }
        }
        true
    })
}

pub(super) fn read_bounded_utf8(path: &Path, max_bytes: u64) -> Option<String> {
    if !path.is_absolute() || !no_links(path) {
        return None;
    }
    let mut options = File::options();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        let mut buffer = vec![0u16; 32768];
        let size = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as _,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if size == 0 || size as usize >= buffer.len() {
            return None;
        }
        let actual = PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize]));
        if !dunce::simplified(&actual)
            .to_string_lossy()
            .eq_ignore_ascii_case(&path.to_string_lossy())
        {
            return None;
        }
    }
    let mut bytes = Vec::new();
    file.take(max_bytes + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > max_bytes || !no_links(path) {
        return None;
    }
    let after = std::fs::metadata(path).ok()?;
    if after.len() != metadata.len() || after.modified().ok()? != metadata.modified().ok()? {
        return None;
    }
    String::from_utf8(bytes).ok()
}

#[cfg(not(windows))]
pub(super) fn running_core_configs() -> Discovery {
    Discovery {
        paths: vec![],
        process_stamps: vec![],
        status: "unsupported",
    }
}

#[cfg(windows)]
pub(super) fn running_core_configs() -> Discovery {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree, FILETIME, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
        UI::Shell::CommandLineToArgvW,
    };
    #[repr(C)]
    struct Unicode {
        length: u16,
        maximum: u16,
        buffer: *const u16,
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            handle: windows_sys::Win32::Foundation::HANDLE,
            class: u32,
            info: *mut std::ffi::c_void,
            size: u32,
            written: *mut u32,
        ) -> i32;
    }
    let mut result = Discovery {
        paths: vec![],
        process_stamps: vec![],
        status: "not_running",
    };
    let Some(user) = crate::windows::current_sid() else {
        result.status = "process_unavailable";
        return result;
    };
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            result.status = "process_unavailable";
            return result;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = Process32FirstW(snapshot, &mut entry);
        let mut failed = false;
        let mut count = 0;
        while found != 0 {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "mihomo.exe"
                    | "clash-meta.exe"
                    | "clash.exe"
                    | "verge-mihomo.exe"
                    | "verge-mihomo-alpha.exe"
                    | "mihomo-party.exe"
            ) {
                let process =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if process.is_null() {
                    failed = true;
                } else {
                    let owner_sid = crate::windows::process_sid(process);
                    let owner = core_owner(owner_sid.as_deref(), user);
                    if owner != CoreOwner::Unsupported {
                        count += 1;
                        let [mut created, mut exited, mut kernel, mut user_time] = [FILETIME {
                            dwLowDateTime: 0,
                            dwHighDateTime: 0,
                        };
                            4];
                        if GetProcessTimes(
                            process,
                            &mut created,
                            &mut exited,
                            &mut kernel,
                            &mut user_time,
                        ) != 0
                        {
                            result.process_stamps.push((
                                entry.th32ProcessID,
                                ((created.dwHighDateTime as u64) << 32)
                                    | created.dwLowDateTime as u64,
                            ));
                        } else {
                            failed = true;
                        }
                        // Class 60 copies the command line into our buffer; never reads the PEB/VM.
                        let mut buffer = vec![0usize; 8192];
                        let mut written = 0;
                        let bytes = buffer.len() * std::mem::size_of::<usize>();
                        if NtQueryInformationProcess(
                            process,
                            60,
                            buffer.as_mut_ptr().cast(),
                            bytes as u32,
                            &mut written,
                        ) >= 0
                        {
                            let command = &*(buffer.as_ptr() as *const Unicode);
                            let start = command.buffer as usize;
                            let base = buffer.as_ptr() as usize;
                            if command.length % 2 == 0
                                && start >= base
                                && start
                                    .checked_add(command.length as usize)
                                    .is_some_and(|end| end <= base + bytes)
                            {
                                let mut text = std::slice::from_raw_parts(
                                    command.buffer,
                                    command.length as usize / 2,
                                )
                                .to_vec();
                                text.push(0);
                                let mut argc = 0;
                                let argv = CommandLineToArgvW(text.as_ptr(), &mut argc);
                                if !argv.is_null() && (1..=256).contains(&argc) {
                                    let args: Vec<String> =
                                        std::slice::from_raw_parts(argv, argc as usize)
                                            .iter()
                                            .map(|ptr| {
                                                let mut len = 0;
                                                while *ptr.add(len) != 0 {
                                                    len += 1;
                                                }
                                                String::from_utf16_lossy(
                                                    std::slice::from_raw_parts(*ptr, len),
                                                )
                                            })
                                            .collect();
                                    if let Some(path) = config_argument(&args) {
                                        if owner == CoreOwner::CurrentUser
                                            || service_config_allowed(&path)
                                        {
                                            result.paths.push(path);
                                        } else {
                                            failed = true;
                                        }
                                    } else {
                                        failed = true;
                                    }
                                } else {
                                    failed = true;
                                }
                                if !argv.is_null() {
                                    LocalFree(argv.cast());
                                }
                            } else {
                                failed = true;
                            }
                        } else {
                            failed = true;
                        }
                    } else {
                        // Other-user/unknown-owner cores remain outside this audit.
                        failed = true;
                    }
                    CloseHandle(process);
                }
            }
            found = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
        result.status = if count > 1 {
            "ambiguous"
        } else if failed {
            "process_unavailable"
        } else if count == 1 && result.paths.len() == 1 {
            "confirmed"
        } else {
            "not_running"
        };
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn core_owner_only_admits_current_user_or_exact_local_system_sid() {
        let current = [1, 2, 3, 4];
        assert_eq!(core_owner(Some(&current), &current), CoreOwner::CurrentUser);
        assert_eq!(
            core_owner(Some(&[1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]), &current),
            CoreOwner::SystemService
        );
        assert_eq!(
            core_owner(Some(&[1, 1, 0, 0, 0, 0, 0, 5, 19, 0, 0, 0]), &current),
            CoreOwner::Unsupported
        );
        assert_eq!(core_owner(None, &current), CoreOwner::Unsupported);
    }
    #[test]
    fn config_selection_rejects_relative_duplicate_and_sensitive_paths() {
        let root = std::env::temp_dir();
        let config = root
            .join("synthetic-risk.yaml")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            config_argument(&["mihomo".into(), "-f".into(), config.clone()]),
            Some(PathBuf::from(&config))
        );
        assert!(config_argument(&["mihomo".into(), "-f".into(), "config.yaml".into()]).is_none());
        assert!(config_argument(&[
            "mihomo".into(),
            "-f".into(),
            config.clone(),
            "--config".into(),
            config
        ])
        .is_none());
        assert!(config_argument(&[
            "mihomo".into(),
            format!("--config={}", root.join("credentials.yaml").display())
        ])
        .is_none());
    }
    #[test]
    fn bounded_reader_rejects_oversize_without_returning_partial_yaml() {
        let root = std::env::temp_dir().join(format!(
            "risk-synthetic-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("config.yaml");
        std::fs::write(&path, b"dns:\n  enable: true\n").unwrap();
        assert!(read_bounded_utf8(&path, 4).is_none());
        assert!(read_bounded_utf8(&path, 128)
            .unwrap()
            .contains("enable: true"));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn bounded_reader_rejects_linked_file_and_linked_ancestor() {
        let root = std::env::temp_dir().join(format!(
            "risk-links-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("source");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("config.yaml"), b"dns:\n  enable: true\n").unwrap();
        let linked_file = root.join("linked.yaml");
        let linked_dir = root.join("linked-dir");
        #[cfg(windows)]
        let file_link =
            std::os::windows::fs::symlink_file(source.join("config.yaml"), &linked_file);
        #[cfg(unix)]
        let file_link = std::os::unix::fs::symlink(source.join("config.yaml"), &linked_file);
        if file_link.is_ok() {
            assert!(read_bounded_utf8(&linked_file, 128).is_none());
            std::fs::remove_file(linked_file).unwrap();
        }
        #[cfg(windows)]
        let dir_link = std::os::windows::fs::symlink_dir(&source, &linked_dir);
        #[cfg(unix)]
        let dir_link = std::os::unix::fs::symlink(&source, &linked_dir);
        if dir_link.is_ok() {
            assert!(read_bounded_utf8(&linked_dir.join("config.yaml"), 128).is_none());
            #[cfg(windows)]
            std::fs::remove_dir(linked_dir).unwrap();
            #[cfg(unix)]
            std::fs::remove_file(linked_dir).unwrap();
        }
        std::fs::remove_file(source.join("config.yaml")).unwrap();
        std::fs::remove_dir(source).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
