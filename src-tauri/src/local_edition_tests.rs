// [INPUT]: 本地版的实际配置、原生入口与 Windows 浏览器安装钩子。
// [OUTPUT]: 防止官方更新能力、应用标识或浏览器注册名称意外回流的离线回归。
// [POS]: 本地发行边界测试；不访问网络、注册表或真实用户资料。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde_json::Value;

#[test]
fn local_runtime_has_no_official_update_authority() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["identifier"], "ai.local.claude-local");
    assert_eq!(config["productName"], "Claude-Local");
    assert_eq!(config["mainBinaryName"], "claude-local");
    assert!(config
        .get("plugins")
        .and_then(|p| p.get("updater"))
        .is_none());
    let capabilities: Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    assert!(capabilities["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| {
            let permission = p.as_str().unwrap();
            !permission.starts_with("updater:") && !permission.starts_with("process:")
        }));
    let main = include_str!("main.rs");
    assert!(!main.contains("tauri_plugin_updater"));
    assert!(!main.contains("tauri_plugin_process"));
    let windows: Value = serde_json::from_str(include_str!("../tauri.windows.conf.json")).unwrap();
    assert_eq!(windows["app"]["windows"][0]["title"], "Claude-Local");
    assert!(windows.get("plugins").is_none());
}

#[test]
fn imported_browser_seed_domain_remains_compatible() {
    assert_eq!(
        crate::identities::browser_link::seed("00000000000000000000000000000001", 0),
        3857289292
    );
}
