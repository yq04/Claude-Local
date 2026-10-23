// [INPUT]: macOS/Linux/Windows 电脑设置桥与 Tauri 后台任务。
// [OUTPUT]: 电脑状态查询、时区与语言应用、定位关闭和系统设置入口。
// [POS]: 独立于清理的命令边界；所有成功状态来自原生核验。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#[cfg(target_os = "linux")]
use crate::linux::*;
use crate::native::decode;
#[cfg(target_os = "windows")]
use crate::windows::*;
#[cfg(target_os = "macos")]
use std::ffi::c_char;
use std::ffi::CString;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
extern "C" {
    fn rf_system_region(language: *const c_char, locale: *const c_char) -> *mut c_char;
    fn rf_system_read() -> *mut c_char;
    fn rf_system_open(pane: *const c_char) -> *mut c_char;
    fn rf_system_language(language: *const c_char) -> *mut c_char;
    fn rf_system_timezone(timezone: *const c_char) -> *mut c_char;
    fn rf_system_location() -> *mut c_char;
}
static SYSTEM_CHANGE_TRANSACTION: Mutex<()> = Mutex::new(());
async fn run(
    action: impl FnOnce() -> Result<serde_json::Value, String> + Send + 'static,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|_| "系统操作被中断，请刷新当前状态。".to_string())?
}
pub(crate) async fn run_change(
    app: tauri::AppHandle,
    operation: &'static str,
    action: impl FnOnce() -> Result<serde_json::Value, String> + Send + 'static,
) -> Result<serde_json::Value, String> {
    run(move || {
        let _transaction = SYSTEM_CHANGE_TRANSACTION
            .lock()
            .map_err(|_| "系统修改暂不可用。".to_string())?;
        let before: serde_json::Value = decode(unsafe { rf_system_read() })?;
        let id = crate::system_changes::begin(&app, operation, &before)?;
        let result = action();
        // Read even after an error: native changes can be partial (notably region setup).
        let after = decode::<serde_json::Value>(unsafe { rf_system_read() });
        let observed_known = after.is_ok();
        let observed = after.unwrap_or_else(|_| serde_json::json!({}));
        let success = result.is_ok();
        let mut message = result
            .as_ref()
            .map(|v| v["message"].as_str().unwrap_or("完成"))
            .unwrap_or_else(|e| e.as_str())
            .to_string();
        if !observed_known {
            message.push_str("；最终系统状态无法重新读取。");
        }
        let saved =
            crate::system_changes::finish(&app, &id, operation, &observed, success, &message);
        match (result, saved) {
            (Ok(value), Ok(())) => Ok(value),
            (Ok(_), Err(error)) => Err(format!(
                "系统修改已完成，但记录保存失败；当前状态已改变。{error}"
            )),
            (Err(error), Ok(())) => Err(error),
            (Err(error), Err(save_error)) => Err(format!(
                "{error} 部分修改可能已发生，且记录保存失败：{save_error}"
            )),
        }
    })
    .await
}
#[tauri::command]
pub fn system_change_history(
    app: tauri::AppHandle,
) -> Result<Vec<crate::system_changes::ChangeRecord>, String> {
    crate::system_changes::list(&app)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRestorePlan {
    pub record: crate::system_changes::ChangeRecord,
    pub fields: Vec<crate::system_changes::RestoreField>,
}
#[tauri::command]
pub fn system_change_restore_plan(
    app: tauri::AppHandle,
    id: String,
) -> Result<SystemRestorePlan, String> {
    let record = crate::system_changes::list(&app)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("找不到这次系统修改记录。")?;
    let current: serde_json::Value = decode(unsafe { rf_system_read() })?;
    let fields = crate::system_changes::plan(std::slice::from_ref(&record), &id, &current)?;
    Ok(SystemRestorePlan { record, fields })
}
pub(crate) fn restore_operation(fields: &[String]) -> &'static str {
    let has_tz = fields.iter().any(|f| f == "timezone");
    let has_lang = fields.iter().any(|f| f == "language");
    let has_locale = fields.iter().any(|f| f == "locale");
    if has_locale || (has_tz && has_lang) {
        "region"
    } else if has_lang {
        "language"
    } else {
        "timezone"
    }
}
#[tauri::command]
pub async fn system_change_restore(
    app: tauri::AppHandle,
    id: String,
    fields: Vec<String>,
) -> Result<serde_json::Value, String> {
    if fields.is_empty()
        || fields.len() > 3
        || fields
            .iter()
            .any(|f| !["timezone", "language", "locale"].contains(&f.as_str()))
    {
        return Err("请选择有效的系统字段。".into());
    }
    let record = crate::system_changes::list(&app)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("找不到这次系统修改记录。")?;
    let selected = fields.clone();
    let app_for_action = app.clone();
    let operation = restore_operation(&fields);
    run_change(app, operation, move || {
        let current: serde_json::Value = decode(unsafe { rf_system_read() })?;
        let plan = crate::system_changes::plan(std::slice::from_ref(&record), &id, &current)?;
        for field in &selected {
            let item = plan
                .iter()
                .find(|p| &p.field == field)
                .ok_or("该字段不支持安全恢复。")?;
            if item.conflict {
                return Err(format!("{} 已由用户再次修改；为避免覆盖，未恢复。", field));
            }
        }
        if selected.contains(&"locale".to_string()) && !selected.contains(&"language".to_string()) {
            return Err("恢复区域格式时也必须选择对应语言。".into());
        }
        if selected.contains(&"timezone".to_string()) {
            let value = record.before["timezone"]
                .as_str()
                .ok_or("原时区不可恢复。")?;
            let value = CString::new(value).map_err(|_| "原时区无效。")?;
            let _: serde_json::Value = decode(unsafe { rf_system_timezone(value.as_ptr()) })?;
        }
        if selected.contains(&"locale".to_string()) {
            let language = record.before["language"]
                .as_str()
                .ok_or("原语言不可恢复。")?;
            let locale = record.before["locale"]
                .as_str()
                .ok_or("原区域格式不可恢复。")?;
            let language = CString::new(language).map_err(|_| "原语言无效。")?;
            let locale = CString::new(locale).map_err(|_| "原区域格式无效。")?;
            let _: serde_json::Value =
                decode(unsafe { rf_system_region(language.as_ptr(), locale.as_ptr()) })?;
        } else if selected.contains(&"language".to_string()) {
            let value = record.before["language"]
                .as_str()
                .ok_or("原语言不可恢复。")?;
            let value = CString::new(value).map_err(|_| "原语言无效。")?;
            let _: serde_json::Value = decode(unsafe { rf_system_language(value.as_ptr()) })?;
        }
        let _ = app_for_action;
        decode(unsafe { rf_system_read() })
    })
    .await
}
#[tauri::command]
pub async fn system_read() -> Result<serde_json::Value, String> {
    run(|| decode(unsafe { rf_system_read() })).await
}
#[tauri::command]
pub async fn system_open_settings(pane: String) -> Result<serde_json::Value, String> {
    run(move || {
        let pane = CString::new(pane).map_err(|_| "系统设置入口无效。")?;
        decode(unsafe { rf_system_open(pane.as_ptr()) })
    })
    .await
}
#[tauri::command]
pub async fn system_set_language(
    app: tauri::AppHandle,
    language: String,
) -> Result<serde_json::Value, String> {
    run_change(app, "language", move || {
        let language = CString::new(language).map_err(|_| "语言无效。")?;
        decode(unsafe { rf_system_language(language.as_ptr()) })
    })
    .await
}
#[tauri::command]
pub async fn system_set_timezone(
    app: tauri::AppHandle,
    timezone: String,
) -> Result<serde_json::Value, String> {
    run_change(app, "timezone", move || {
        let timezone = CString::new(timezone).map_err(|_| "时区无效。")?;
        decode(unsafe { rf_system_timezone(timezone.as_ptr()) })
    })
    .await
}
#[tauri::command]
pub async fn system_disable_location(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    run_change(app, "location", || decode(unsafe { rf_system_location() })).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restore_operation_selects_expected_journal_scope() {
        let tz = vec!["timezone".to_string()];
        let lang = vec!["language".to_string()];
        let loc = vec!["locale".to_string()];
        let tz_lang = vec!["timezone".to_string(), "language".to_string()];
        let full = vec!["timezone".to_string(), "language".to_string(), "locale".to_string()];
        assert_eq!(restore_operation(&tz), "timezone");
        assert_eq!(restore_operation(&lang), "language");
        assert_eq!(restore_operation(&loc), "region");
        assert_eq!(restore_operation(&tz_lang), "region");
        assert_eq!(restore_operation(&full), "region");
    }
    #[test]
    fn reads_native_state_and_rejects_invalid_inputs_without_mutation() {
        let state: serde_json::Value = decode(unsafe { rf_system_read() }).unwrap();
        assert!(state["timezone"].as_str().is_some());
        assert!(
            state["timezones"].as_array().unwrap().len() > if cfg!(windows) { 30 } else { 100 }
        );
        assert!(state["languages"].is_array());
        assert!(state["location_enabled"].is_boolean() || state["location_enabled"].is_null());
        let invalid = CString::new("Invalid/Zone; touch /tmp/rf-injected").unwrap();
        assert!(
            decode::<serde_json::Value>(unsafe { rf_system_timezone(invalid.as_ptr()) }).is_err()
        );
        assert!(
            decode::<serde_json::Value>(unsafe { rf_system_language(invalid.as_ptr()) }).is_err()
        );
        assert!(decode::<serde_json::Value>(unsafe { rf_system_open(invalid.as_ptr()) }).is_err());
    }
}

#[tauri::command]
pub async fn system_set_region(
    app: tauri::AppHandle,
    region: String,
) -> Result<serde_json::Value, String> {
    let region = crate::regions::find(&region)?;
    run_change(app, "region", move || {
        let zone = CString::new(region.timezone).unwrap();
        let language = CString::new(region.language).unwrap();
        let locale = CString::new(region.locale).unwrap();
        #[cfg(target_os = "linux")]
        let _: serde_json::Value =
            decode(unsafe { rf_system_region(language.as_ptr(), locale.as_ptr()) })?;
        let _: serde_json::Value = decode(unsafe { rf_system_timezone(zone.as_ptr()) })?;
        let result = decode(unsafe { rf_system_region(language.as_ptr(), locale.as_ptr()) });
        result.map_err(|error| format!("时区已修改；{error}"))
    })
    .await
}
