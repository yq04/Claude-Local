// [INPUT]: Windows 平台桥、当前用户临时文件与纯路径/代理/语言转换。
// [OUTPUT]: 所有者边界、长路径/命名空间、SOCKS 协议与空白环境变量代理回退、CI 专用可还原时区回归。
// [POS]: Windows 平台桥隔离测试；代理只用虚构输入，不改全局环境；本机只处理临时文件，时区写入仅在 GitHub Actions 执行。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
#[test]
fn ci_timezone_write_is_verified_and_restored() {
    for region in crate::regions::get_regions() {
        assert!(iana_to_windows_tz(region.timezone).is_some());
    }
    if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true") {
        return;
    }
    struct Restore(String);
    impl Drop for Restore {
        fn drop(&mut self) {
            output("tzutil", &["/s", &self.0]).expect("restore CI timezone");
        }
    }
    let before = Restore(raw_windows_timezone());
    assert!(!before.0.is_empty());
    let requested = CString::new("Asia/Tokyo").unwrap();
    let state: Value =
        crate::native::decode(unsafe { rf_system_timezone(requested.as_ptr()) }).unwrap();
    assert!(state["state"].is_object());
    assert_eq!(raw_windows_timezone(), "Tokyo Standard Time");
    let invalid = CString::new("Asia/Tokyo; malicious").unwrap();
    assert!(
        crate::native::decode::<Value>(unsafe { rf_system_timezone(invalid.as_ptr()) }).is_err()
    );
    assert_eq!(raw_windows_timezone(), "Tokyo Standard Time");
}

#[test]
fn windows_paths_preserve_namespaces_and_only_extend_absolute_paths() {
    for (input, expected) in [
        (r"C:\Users\me\file", r"\\?\C:\Users\me\file"),
        ("C:/Users/me/file", r"\\?\C:\Users\me\file"),
        (r"\\server\share\file", r"\\?\UNC\server\share\file"),
        (r"relative\file", r"relative\file"),
        (r"C:relative", r"C:relative"),
        (r"C:\parent\..\file", r"C:\parent\..\file"),
        (r"C:\parent\.\file", r"C:\parent\.\file"),
        (r"\\?\C:\raw/file", r"\\?\C:\raw/file"),
        (r"\\.\pipe\test", r"\\.\pipe\test"),
    ] {
        let actual = wide_path(std::path::Path::new(input));
        assert_eq!(actual.last(), Some(&0));
        assert_eq!(
            String::from_utf16(&actual[..actual.len() - 1]).unwrap(),
            expected
        );
    }
    assert!(!current_owner_sids().is_empty());
    assert!(
        current_owner_sids().len() <= 2,
        "group membership is not ownership"
    );
}

#[test]
fn windows_owned_accepts_default_and_explicit_user_owners() {
    let dir = std::env::temp_dir().join(format!(
        "rf-win-owned-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let default_file = dir.join("default-owner.json");
    let explicit_file = dir.join("explicit-owner.json");
    std::fs::write(&default_file, b"{}").unwrap();
    std::fs::write(&explicit_file, b"{}").unwrap();
    fixture_owner(&explicit_file);
    assert!(owned(&dir));
    assert!(owned(&default_file));
    assert!(owned(&explicit_file));
    let default_owner = file_owner_sid(&default_file).unwrap();
    let user = current_sid().unwrap();
    assert!(current_owner_sids()
        .iter()
        .all(|sid| sid == user || sid == &default_owner));
    preserve_file_permissions(&default_file, &explicit_file).unwrap();
    assert!(owned(&explicit_file));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn windows_proxy_server_formats_are_normalized() {
    assert_eq!(parse_windows_proxy_server(""), "");
    assert_eq!(
        parse_windows_proxy_server("127.0.0.1:7890"),
        "http://127.0.0.1:7890"
    );
    assert_eq!(
        parse_windows_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7891"),
        "http://127.0.0.1:7891"
    );
    assert_eq!(
        parse_windows_proxy_server("socks=127.0.0.1:7898"),
        "socks4://127.0.0.1:7898"
    );
    assert_eq!(
        parse_windows_proxy_server("socks5=127.0.0.1:7898"),
        "socks5h://127.0.0.1:7898"
    );
    assert_eq!(
        parse_windows_proxy_server("https=https://proxy.invalid:443"),
        "https://proxy.invalid:443"
    );
    assert_eq!(normalize_language_tag("zh-CN"), "zh-Hans");
    assert_eq!(normalize_language_tag("zh-TW"), "zh-Hant");
    assert_eq!(normalize_language_tag("ja-JP"), "ja");
    assert_eq!(normalize_language_tag("fr-FR"), "fr");
    assert_eq!(normalize_language_tag("en-US"), "en-US");
}

#[test]
fn windows_proxy_environment_values_skip_empty_entries() {
    assert_eq!(first_nonempty_proxy([" ".into(), "\t".into()]), None);
    assert_eq!(
        first_nonempty_proxy([
            " \t ".into(),
            " http://127.0.0.1:7890 ".into(),
            "socks5h://127.0.0.1:1080".into()
        ]),
        Some("http://127.0.0.1:7890".into())
    );
    assert_eq!(
        first_nonempty_proxy([
            " socks5h://127.0.0.1:1080 ".into(),
            "http://127.0.0.1:7890".into()
        ]),
        Some("socks5h://127.0.0.1:1080".into())
    );
}
