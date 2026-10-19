// [INPUT]: 临时 Claude 文件、虚构账号配置、隔离 SQLite 保险库与注入的进程状态。
// [OUTPUT]: 文件范围、凭据脱敏与桌面个人资产保留、Linux 路径排除、快照过期/不完整、运行/恢复阻断及部分失败回归。
// [POS]: 文件残留入口的离线安全验收；不改 HOME、不检查真实进程、不访问钥匙串或现有账号。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
fn collect(root: &Path) -> Scan {
    collect_progress(root, &Reporter::channel(None)).0
}

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = canonicalize(std::env::temp_dir()).unwrap().join(format!(
            "claude-local-residue-{}-{}",
            std::process::id(),
            crate::identities::new_id().unwrap()
        ));
        crate::identities::private::directory(&path).unwrap();
        Self(canonicalize(path).unwrap())
    }
    fn file(&self, relative: &str, text: &str) {
        let path = self.0.join(relative);
        crate::identities::private::directory(path.parent().unwrap()).unwrap();
        if path.exists() {
            fs::write(path, text).unwrap();
        } else {
            crate::identities::private::write(&path, text.as_bytes()).unwrap();
        }
    }
    fn clean(
        &self,
        scan: &Scan,
        ids: &[String],
        running: impl Fn() -> Result<bool, String>,
    ) -> Result<CleanResult, String> {
        clean(
            &self.0,
            &self.0.join("identity-vault"),
            scan,
            ids,
            &Cleaner::default(),
            running,
            &Reporter::channel(None),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn ids(scan: &Scan) -> Vec<String> {
    scan.items.iter().map(|item| item.id.clone()).collect()
}

#[test]
fn desktop_personal_assets_are_never_residue_cleanup_targets() {
    let f = Fixture::new();
    #[cfg(windows)]
    let desktop = "AppData/Roaming/Claude";
    #[cfg(not(windows))]
    let desktop = "Library/Application Support/Claude";
    for name in [
        "config.json",
        "Preferences",
        "Local State",
        "window-state.json",
        "Web Data",
        "developer_settings.json",
        "mcp-user-tool-toggles.json",
        "extensions-blocklist.json",
        "git-worktrees.json",
        "claude-code-vm/disk",
    ] {
        f.file(&format!("{desktop}/{name}"), "personal asset");
    }
    f.file(&format!("{desktop}/Local Storage/state"), "login state");
    let scan = collect(&f.0);
    if cfg!(target_os = "linux") {
        // Linux 仅支持自己的固定目录，不能把 macOS 目录加入可清理范围。
        assert!(scan.items.is_empty());
        assert_eq!(
            fs::read(f.0.join(desktop).join("Local Storage/state")).unwrap(),
            b"login state"
        );
    } else {
        assert_eq!(scan.items.len(), 1);
        assert!(scan.items[0].path.ends_with("Local Storage"));
        assert!(f.clean(&scan, &ids(&scan), || Ok(false)).unwrap().completed);
        assert!(!f.0.join(desktop).join("Local Storage").exists());
    }
    assert_eq!(
        fs::read_dir(f.0.join(desktop)).unwrap().count(),
        if cfg!(target_os = "linux") { 11 } else { 10 }
    );
}

#[test]
fn residual_scope_never_includes_shell_personal_assets_vault_or_browser() {
    let f = Fixture::new();
    for (name, value) in [
        (".claude/cache/data", "cached"),
        (".claude/projects/session.jsonl", "session"),
        (".claude/backups/config.json", "old account"),
        (".claude.json.backup.1", "old account"),
        (".claude/skills/personal/SKILL.md", "keep"),
        (".claude/plugins/personal", "keep"),
        (
            ".claude/settings.json",
            r#"{"env":{"HTTPS_PROXY":"keep-proxy","ANTHROPIC_API_KEY":"keep-key"}}"#,
        ),
        (".zshrc", "export ANTHROPIC_API_KEY=keep-key"),
        (".npmrc", "proxy=keep-proxy"),
        (".gitconfig", "[http]\nproxy=keep-proxy"),
        ("ClaudeBackups/old", "keep"),
        ("identity-vault/archive", "keep"),
        ("data/browser/profile/Default/Cookies", "keep"),
        (
            "Library/Caches/com.anthropic.claudefordesktop-other-app/cache",
            "keep",
        ),
        (
            "Library/Logs/DiagnosticReports/ClaudeOtherApp-2026.ips",
            "keep",
        ),
        (
            "Library/Application Support/CrashReporter/ClaudeOtherApp.state",
            "keep",
        ),
        (
            "Library/Preferences/com.anthropic.claudefordesktop.plist",
            "keep prefs",
        ),
        (
            "Library/Preferences/ByHost/com.anthropic.claudefordesktop.device.plist",
            "keep device prefs",
        ),
        (
            "Library/Saved Application State/com.anthropic.claudefordesktop.savedState/window",
            "keep window state",
        ),
    ] {
        f.file(name, value);
    }
    let reporter = Reporter::channel(None);
    let (scan, checked) = collect_progress(&f.0, &reporter);
    let events = reporter.events();
    assert_eq!(events.len(), checked + 1);
    for (index, event) in events.iter().enumerate() {
        assert_eq!(event.current(), index);
    }
    assert_eq!(scan.items.len(), 4);
    assert!(scan
        .items
        .iter()
        .all(|item| matches!(item.group, "cache" | "history" | "backups")));
    let safe = scan
        .items
        .iter()
        .filter(|item| item.risk == "safe")
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(f.clean(&scan, &safe, || Ok(false)).unwrap().cleaned, 1);
    assert!(!f.0.join(".claude/cache").exists());
    for name in [
        ".claude/projects/session.jsonl",
        ".claude/skills/personal/SKILL.md",
        ".claude/plugins/personal",
        ".claude/settings.json",
        ".zshrc",
        ".npmrc",
        ".gitconfig",
        "ClaudeBackups/old",
        "identity-vault/archive",
        "data/browser/profile/Default/Cookies",
        "Library/Caches/com.anthropic.claudefordesktop-other-app/cache",
        "Library/Logs/DiagnosticReports/ClaudeOtherApp-2026.ips",
        "Library/Application Support/CrashReporter/ClaudeOtherApp.state",
        "Library/Preferences/com.anthropic.claudefordesktop.plist",
        "Library/Preferences/ByHost/com.anthropic.claudefordesktop.device.plist",
        "Library/Saved Application State/com.anthropic.claudefordesktop.savedState/window",
    ] {
        assert!(f.0.join(name).exists(), "preserve {name}");
    }
    let remaining = collect(&f.0);
    assert!(
        f.clean(&remaining, &ids(&remaining), || Ok(false))
            .unwrap()
            .completed
    );
    for name in [
        "Library/Preferences/com.anthropic.claudefordesktop.plist",
        "Library/Preferences/ByHost/com.anthropic.claudefordesktop.device.plist",
        "Library/Saved Application State/com.anthropic.claudefordesktop.savedState/window",
        ".claude/skills/personal/SKILL.md",
        ".claude/plugins/personal",
        ".claude/settings.json",
        "identity-vault/archive",
        "data/browser/profile/Default/Cookies",
        "Library/Caches/com.anthropic.claudefordesktop-other-app/cache",
        "Library/Logs/DiagnosticReports/ClaudeOtherApp-2026.ips",
        "Library/Application Support/CrashReporter/ClaudeOtherApp.state",
    ] {
        assert!(f.0.join(name).exists(), "preserve all-selected {name}");
    }
}

#[test]
fn residual_account_cleanup_shows_only_keys_and_preserves_shared_secrets() {
    let f = Fixture::new();
    f.file(".claude/.credentials.json", r#"{"claudeAiOauth":{"accessToken":"fake-secret-value"},"trustedDeviceToken":"fake-secret-value","mcpOAuth":{"secret":"keep"},"pluginSecrets":{"secret":"keep"}}"#);
    f.file(".claude.json", r#"{"oauthAccount":{"emailAddress":"fake-private@example.invalid"},"machineID":"fake-device","mcpServers":{"keep":{}},"projects":{"keep":{}},"theme":"dark"}"#);
    let scan = collect(&f.0);
    let output = serde_json::to_string(&scan).unwrap();
    for value in [
        "fake-secret-value",
        "fake-private@example.invalid",
        "fake-device",
    ] {
        assert!(!output.contains(value));
    }
    assert_eq!(scan.items.len(), 2);
    assert!(f.clean(&scan, &ids(&scan), || Ok(false)).unwrap().completed);
    let credentials: serde_json::Value =
        serde_json::from_slice(&fs::read(f.0.join(".claude/.credentials.json")).unwrap()).unwrap();
    assert!(credentials.get("claudeAiOauth").is_none());
    assert!(credentials.get("trustedDeviceToken").is_none());
    assert_eq!(credentials["mcpOAuth"]["secret"], "keep");
    assert_eq!(credentials["pluginSecrets"]["secret"], "keep");
    let config: serde_json::Value =
        serde_json::from_slice(&fs::read(f.0.join(".claude.json")).unwrap()).unwrap();
    assert!(config.get("oauthAccount").is_none());
    assert!(config.get("machineID").is_none());
    assert!(config["mcpServers"]["keep"].is_object());
    assert!(config["projects"]["keep"].is_object());
    assert_eq!(config["theme"], "dark");
}

#[test]
fn residual_cleaning_rejects_stale_unknown_incomplete_and_outside_plans() {
    let f = Fixture::new();
    f.file(".claude/cache/data", "first");
    let scan = collect(&f.0);
    assert!(f.clean(&scan, &["unknown".into()], || Ok(false)).is_err());
    assert!(f.clean(&scan, &[], || Ok(false)).is_err());
    f.file(".claude/cache/data", "changed data");
    assert!(f.clean(&scan, &ids(&scan), || Ok(false)).is_err());
    let mut incomplete = collect(&f.0);
    incomplete.items[0].exact = false;
    assert!(f
        .clean(&incomplete, &ids(&incomplete), || Ok(false))
        .is_err());
    let mut outside = collect(&f.0);
    outside.items[0].path = f.0.join(".zshrc").to_string_lossy().into_owned();
    assert!(f.clean(&outside, &ids(&outside), || Ok(false)).is_err());
    let mut keychain = collect(&f.0);
    keychain.items[0].operation = Operation::Keychain("never-call-native".into());
    assert!(f.clean(&keychain, &ids(&keychain), || Ok(false)).is_err());
    assert!(transaction::perform_items(
        &f.0,
        &keychain.items,
        &Cleaner::default(),
        || Ok(false),
        &Reporter::channel(None)
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(f.0.join(".claude/cache/data")).unwrap(),
        "changed data"
    );
}

#[test]
fn residual_cleaning_blocks_running_and_unfinished_identity_recovery() {
    let f = Fixture::new();
    f.file(".claude/cache/data", "keep");
    let scan = collect(&f.0);
    assert!(f
        .clean(&scan, &ids(&scan), || Ok(true))
        .unwrap_err()
        .contains("Claude"));
    let path = f.0.join("identity-vault/identities.sqlite");
    let connection = rusqlite::Connection::open(path).unwrap();
    connection
        .execute(
            "INSERT INTO state(key,value) VALUES('recovery','fake-pending')",
            [],
        )
        .unwrap();
    assert!(f
        .clean(&scan, &ids(&scan), || Ok(false))
        .unwrap_err()
        .contains("恢复"));
    assert_eq!(
        fs::read_to_string(f.0.join(".claude/cache/data")).unwrap(),
        "keep"
    );
}

#[test]
fn residual_cleaning_stops_if_claude_restarts_and_reports_partial_result() {
    let f = Fixture::new();
    f.file(".claude/cache/data", "cache");
    f.file(".claude/projects/history.jsonl", "history");
    let scan = collect(&f.0);
    let count = std::cell::Cell::new(0);
    let result = f
        .clean(&scan, &ids(&scan), || {
            let call = count.get();
            count.set(call + 1);
            Ok(call > 1)
        })
        .unwrap();
    assert!(!result.completed);
    assert_eq!(result.cleaned, 1);
    assert_eq!(result.errors.len(), 1);
    assert!(f.0.join(".claude/projects/history.jsonl").exists());
}

#[cfg(unix)]
#[test]
fn residual_scan_rejects_linked_default_directories() {
    let f = Fixture::new();
    let outside = Fixture::new();
    outside.file("cache/data", "keep outside");
    std::os::unix::fs::symlink(&outside.0, f.0.join(".claude")).unwrap();
    let scan = collect(&f.0);
    assert!(scan.items.is_empty());
    assert!(!scan.warnings.is_empty());
    assert_eq!(
        fs::read_to_string(outside.0.join("cache/data")).unwrap(),
        "keep outside"
    );
}
