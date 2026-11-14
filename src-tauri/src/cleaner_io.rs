// [INPUT]: 待写入的清理后配置、目标路径、原权限及 Windows 文件锁/共享冲突重试需求。
// [OUTPUT]: 显式关闭句柄后的原子配置替换、Windows 瞬态文件锁（5/32/33/145）有界退避重试、安全只读位清理及无残留失败清理。
// [POS]: 清理与身份切换共享的底层文件 I/O 边界；临时文件仅保存新内容，绝不跟随符号链接或重解析点。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use std::{io::Write, time::Duration};

#[cfg(windows)]
const WINDOWS_RETRY_BACKOFF_MS: [u64; 8] = [5, 10, 20, 40, 80, 120, 180, 250];

pub(crate) fn is_transient_windows_io_error(error: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(5 | 32 | 33))
    }
    #[cfg(not(windows))]
    {
        let _ = error;
        false
    }
}

pub(crate) fn is_transient_windows_dir_error(error: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        is_transient_windows_io_error(error) || error.raw_os_error() == Some(145)
    }
    #[cfg(not(windows))]
    {
        let _ = error;
        false
    }
}

pub(crate) fn retry_io<T>(mut op: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    #[cfg(windows)]
    for delay_ms in WINDOWS_RETRY_BACKOFF_MS {
        match op() {
            Ok(value) => return Ok(value),
            Err(error) if is_transient_windows_io_error(&error) => {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            Err(error) => return Err(error),
        }
    }
    op()
}

#[cfg(windows)]
fn clear_readonly_non_linked(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if linked(&meta) || !crate::windows::owned(path) {
        return;
    }
    if meta.permissions().readonly() {
        let mut perms = meta.permissions();
        perms.set_readonly(false);
        let _ = fs::set_permissions(path, perms);
    }
    if meta.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                clear_readonly_non_linked(&entry.path());
            }
        }
    }
}

pub(crate) fn rename_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    retry_io(|| fs::rename(from, to))
}

pub(crate) fn open_read_retry(path: &Path) -> std::io::Result<fs::File> {
    retry_io(|| fs::File::open(path))
}

pub(crate) fn read_bytes_retry(path: &Path) -> std::io::Result<Vec<u8>> {
    retry_io(|| fs::read(path))
}

pub(crate) fn read_to_string_retry(path: &Path) -> std::io::Result<String> {
    retry_io(|| fs::read_to_string(path))
}

pub(crate) fn remove_file_retry(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    for delay_ms in WINDOWS_RETRY_BACKOFF_MS {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                if error.raw_os_error() == Some(5) {
                    clear_readonly_non_linked(path);
                }
                if is_transient_windows_io_error(&error) {
                    std::thread::sleep(Duration::from_millis(delay_ms));
                    continue;
                }
                return Err(error);
            }
        }
    }
    match fs::remove_file(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

pub(crate) fn remove_dir_all_retry(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    for delay_ms in WINDOWS_RETRY_BACKOFF_MS {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                if error.raw_os_error() == Some(5) {
                    clear_readonly_non_linked(path);
                }
                if is_transient_windows_dir_error(&error) {
                    std::thread::sleep(Duration::from_millis(delay_ms));
                    continue;
                }
                return Err(error);
            }
        }
    }
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

pub(super) fn atomic_write(path: &Path, bytes: &[u8], mode: u32) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".rf-cleanup-{}", generation()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode & 0o777);
        }
        let _ = mode;
        let mut file = options
            .open(&temporary)
            .map_err(|_| "无法创建配置临时文件。")?;
        #[cfg(windows)]
        crate::windows::preserve_file_permissions(path, &temporary)?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存完整配置。")?;
        drop(file);
        rename_retry(&temporary, path).map_err(|_| "无法替换配置。")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = remove_file_retry(&temporary);
    }
    result
}
