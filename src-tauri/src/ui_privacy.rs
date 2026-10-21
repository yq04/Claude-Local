// [INPUT]: 应用数据目录与显式的隐私打码布尔值偏好。
// [OUTPUT]: 隐私打码读写命令与全局共享偏好状态；私有文件原子保存后再发布内存状态。
// [POS]: 界面与原生运行时的隐私偏好边界；未配置时返回 None/null 供前端迁移，默认安全打码。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use std::{fs, path::Path, sync::Mutex};
use tauri::Manager;

pub struct UiPrivacy(pub Mutex<Option<bool>>);

impl UiPrivacy {
    pub fn load(app: &tauri::AppHandle) -> Self {
        let stored = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| read_preference(&dir.join("ui-privacy")))
            .unwrap_or(Some(true));
        Self(Mutex::new(stored))
    }
}

fn read_preference(path: &Path) -> Option<bool> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Ok(meta) if meta.is_file() && meta.len() <= 16
            && crate::identities::private::safe(path).is_ok() => {
                match fs::read_to_string(path).ok().as_deref().map(str::trim) {
                    Some("0" | "false") => Some(false),
                    _ => Some(true),
                }
            }
        _ => Some(true),
    }
}

pub fn effective_privacy_mask(app: &tauri::AppHandle) -> bool {
    app.try_state::<UiPrivacy>()
        .and_then(|state| *state.0.lock().unwrap())
        .unwrap_or(true)
}

#[cfg(test)]
pub fn effective_privacy_mask_raw(val: Option<bool>) -> bool {
    val.unwrap_or(true)
}

#[tauri::command]
pub fn ui_privacy_read(app: tauri::AppHandle) -> Option<bool> {
    *app.state::<UiPrivacy>().0.lock().unwrap()
}

#[tauri::command]
pub fn ui_privacy_write(app: tauri::AppHandle, masked: bool) -> Result<(), String> {
    let state = app.state::<UiPrivacy>();
    let mut current = state.0.lock().unwrap();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法保存隐私偏好。".to_string())?;
    let result = crate::identities::private::directory(&dir).and_then(|_| {
        let bytes = if masked { b"1" } else { b"0" };
        crate::identities::private::write(&dir.join("ui-privacy"), bytes)
    });
    if result.is_err() {
        *current = Some(true);
        return Err("无法保存隐私偏好。".into());
    }
    *current = Some(masked);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn privacy_defaults_to_masked_when_unconfigured() {
        assert!(effective_privacy_mask_raw(None));
        assert!(effective_privacy_mask_raw(Some(true)));
        assert!(!effective_privacy_mask_raw(Some(false)));
    }

    #[test]
    fn malformed_preferences_are_masked_and_distinct_from_missing() {
        let root = std::env::temp_dir().join(format!("claude-local-privacy-{}", crate::identities::new_id().unwrap()));
        fs::create_dir(&root).unwrap();
        let path = root.join("privacy");
        assert_eq!(read_preference(&path), None);
        for (value, expected) in [("0", false), ("1", true), ("invalid", true)] {
            fs::write(&path, value).unwrap();
            assert_eq!(read_preference(&path), Some(expected));
        }
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
