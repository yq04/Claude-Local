// [INPUT]: 用户触发时读取的 Claude settings.json 路径和可选、受信任的随包 collector 路径。
// [OUTPUT]: 不含路径或命令正文的额度采集接入状态；不执行 statusLine 或 runtime。
// [POS]: 额度详情的只读自检边界；当前没有随包 collector，也不写 Claude 设置。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::Serialize;
use serde_json::Value;
use std::{fs, io::Read, path::Path};
use tauri::Manager;

const MAX_SETTINGS_BYTES: u64 = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuotaSetupState {
    NotConfigured,
    CustomStatusline,
    InvalidSettingsPath,
    InvalidSettingsJson,
    InvalidStatusline,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct QuotaSetupStatus {
    pub state: QuotaSetupState,
    pub collector_bundled: bool,
    pub has_statusline: bool,
}

impl QuotaSetupStatus {
    fn new(state: QuotaSetupState, collector_bundled: bool, has_statusline: bool) -> Self {
        Self {
            state,
            collector_bundled,
            has_statusline,
        }
    }
}

fn invalid_path() -> QuotaSetupStatus {
    QuotaSetupStatus::new(QuotaSetupState::InvalidSettingsPath, false, false)
}

#[cfg(windows)]
fn canonicalize(path: &Path) -> std::io::Result<std::path::PathBuf> {
    dunce::canonicalize(path)
}
#[cfg(not(windows))]
fn canonicalize(path: &Path) -> std::io::Result<std::path::PathBuf> {
    fs::canonicalize(path)
}

fn owned(path: &Path, metadata: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        extern "C" {
            fn getuid() -> u32;
        }
        metadata.uid() == unsafe { getuid() }
    }
    #[cfg(windows)]
    {
        let _ = metadata;
        crate::windows::owned(path)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, metadata);
        true
    }
}

fn expected_settings_path(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    path.is_absolute()
        && path.file_name().is_some_and(|name| name == "settings.json")
        && parent
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(".claude"))
}

fn safe_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    !crate::cleaner::linked(&metadata)
        && metadata.is_dir()
        && owned(path, &metadata)
        && canonicalize(path).ok().as_deref() == Some(path)
}

fn trusted_collector_present(path: Option<&Path>) -> bool {
    let Some(path) = path.filter(|p| p.is_absolute()) else {
        return false;
    };
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    !crate::cleaner::linked(&metadata)
        && metadata.is_file()
        && metadata.len() > 0
        && metadata.len() <= 16 * 1024 * 1024
        && owned(path, &metadata)
        && canonicalize(path).ok().as_deref() == Some(path)
}

/// Inspect synthetic or real settings without exposing its path or command value.
/// The optional collector path is only considered present when it is an owned,
/// ordinary, canonical file. This function never executes either file.
pub(crate) fn inspect(
    settings_path: &Path,
    packaged_collector_path: Option<&Path>,
) -> QuotaSetupStatus {
    if !expected_settings_path(settings_path) {
        return invalid_path();
    }
    let parent = settings_path.parent().expect("validated settings parent");
    let collector_bundled = trusted_collector_present(packaged_collector_path);

    // A missing .claude directory is the normal unconfigured state. Existing
    // parents are validated before any file is opened.
    match fs::symlink_metadata(parent) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return QuotaSetupStatus::new(QuotaSetupState::NotConfigured, collector_bundled, false)
        }
        Err(_) => return invalid_path(),
        Ok(_) if !safe_directory(parent) => return invalid_path(),
        Ok(_) => {}
    }

    let metadata = match fs::symlink_metadata(settings_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return QuotaSetupStatus::new(QuotaSetupState::NotConfigured, collector_bundled, false)
        }
        Err(_) => return invalid_path(),
        Ok(metadata) => metadata,
    };
    if crate::cleaner::linked(&metadata)
        || !metadata.is_file()
        || !owned(settings_path, &metadata)
        || metadata.len() > MAX_SETTINGS_BYTES
        || canonicalize(settings_path).ok().as_deref() != Some(settings_path)
    {
        return invalid_path();
    }

    let mut file = match fs::File::open(settings_path) {
        Ok(file) => file,
        Err(_) => return invalid_path(),
    };
    let Ok(open_metadata) = file.metadata() else {
        return invalid_path();
    };
    if !open_metadata.is_file() || open_metadata.len() > MAX_SETTINGS_BYTES {
        return invalid_path();
    }
    let mut bytes = Vec::with_capacity(open_metadata.len() as usize);
    if file
        .by_ref()
        .take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_SETTINGS_BYTES
    {
        return invalid_path();
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return QuotaSetupStatus::new(
            QuotaSetupState::InvalidSettingsJson,
            collector_bundled,
            false,
        );
    };
    let Some(settings) = value.as_object() else {
        return QuotaSetupStatus::new(
            QuotaSetupState::InvalidSettingsJson,
            collector_bundled,
            false,
        );
    };
    let Some(statusline) = settings.get("statusLine") else {
        return QuotaSetupStatus::new(QuotaSetupState::NotConfigured, collector_bundled, false);
    };
    let valid = statusline.as_object().is_some_and(|obj| {
        obj.get("type").and_then(Value::as_str) == Some("command")
            && obj
                .get("command")
                .and_then(Value::as_str)
                .is_some_and(|command| !command.trim().is_empty())
    });
    if !valid {
        return QuotaSetupStatus::new(QuotaSetupState::InvalidStatusline, collector_bundled, true);
    }

    // No product-owned signature is currently installed or bundled. Treat all
    // valid pre-existing commands as custom and never echo or invoke them.
    QuotaSetupStatus::new(QuotaSetupState::CustomStatusline, collector_bundled, true)
}

#[tauri::command]
pub(crate) fn quota_setup_status(_app: tauri::AppHandle) -> Result<QuotaSetupStatus, String> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    let Some(home) = home else {
        return Ok(invalid_path());
    };
    let path = Path::new(&home).join(".claude").join("settings.json");
    let collector = _app
        .path()
        .resource_dir()
        .ok()
        .map(|root| root.join("scripts").join("claude_quota.py"));
    Ok(inspect(&path, collector.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "claude-local-quota-setup-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(root.join(".claude")).unwrap();
            Self(root)
        }
        fn settings(&self) -> std::path::PathBuf {
            self.0.join(".claude").join("settings.json")
        }
        fn write(&self, body: &str) {
            fs::write(self.settings(), body).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn inspect_distinguishes_unconfigured_invalid_json_and_custom_command() {
        let fixture = Fixture::new();
        assert_eq!(
            inspect(&fixture.settings(), None).state,
            QuotaSetupState::NotConfigured
        );

        fixture.write("{");
        assert_eq!(
            inspect(&fixture.settings(), None).state,
            QuotaSetupState::InvalidSettingsJson
        );

        fixture.write(r#"{"statusLine":{"type":"command","command":"do-not-run"}}"#);
        let status = inspect(&fixture.settings(), None);
        assert_eq!(status.state, QuotaSetupState::CustomStatusline);
        assert!(status.has_statusline);
        assert!(!status.collector_bundled);
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(!serialized.contains("do-not-run"));
        assert!(!serialized.contains(&fixture.0.to_string_lossy().to_string()));
    }

    #[test]
    fn inspect_rejects_wrong_shape_and_path() {
        let fixture = Fixture::new();
        fixture.write(r#"{"statusLine":{"type":"command","command":"  "}}"#);
        assert_eq!(
            inspect(&fixture.settings(), None).state,
            QuotaSetupState::InvalidStatusline
        );
        assert_eq!(
            inspect(&fixture.0.join("elsewhere.json"), None).state,
            QuotaSetupState::InvalidSettingsPath
        );
    }

    #[cfg(unix)]
    #[test]
    fn inspect_rejects_settings_symlink() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let elsewhere = fixture.0.join("outside.json");
        fs::write(
            &elsewhere,
            r#"{"statusLine":{"type":"command","command":"x"}}"#,
        )
        .unwrap();
        symlink(elsewhere, fixture.settings()).unwrap();
        assert_eq!(
            inspect(&fixture.settings(), None).state,
            QuotaSetupState::InvalidSettingsPath
        );
    }

    #[cfg(windows)]
    #[test]
    fn inspect_rejects_settings_symlink() {
        use std::os::windows::fs::symlink_file;
        let fixture = Fixture::new();
        let elsewhere = fixture.0.join("outside.json");
        fs::write(
            &elsewhere,
            r#"{"statusLine":{"type":"command","command":"x"}}"#,
        )
        .unwrap();
        if symlink_file(elsewhere, fixture.settings()).is_err() {
            // Symlink creation can be unavailable when Windows Developer Mode
            // or the one-time CI privilege is disabled.
            return;
        }
        assert_eq!(
            inspect(&fixture.settings(), None).state,
            QuotaSetupState::InvalidSettingsPath
        );
    }
}
