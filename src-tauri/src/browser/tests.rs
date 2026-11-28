// [INPUT]: 临时样本、指纹参数、固定清理边界、托管扩展参数与注入地理/分类 HTTP 样本。
// [OUTPUT]: 资料/风控修订上下文隔离、同快照有效代理、进程/链接阻断、地区/Host/framing及有界 WebRTC 诊断回归。
// [POS]: 浏览器模块行为验证；不访问用户实际资料。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
#[test]
fn risk_browser_context_binds_slot_config_revision_and_effective_machine_route() {
    let fixture = sample();
    let root = fixture.join("browser");
    let mut db = workspaces::database(&root).unwrap();
    let scope_a = workspaces::ensure(&root).unwrap();
    let mut m = machine();
    m.system_proxy = "http://127.0.0.1:8123".into();
    let snapshot =
        |m: &Machine| risk_browser_context(risk_browser_settings(&root).ok(), Some(m.clone()));
    let a = snapshot(&m);
    assert_eq!(a, snapshot(&m));
    assert_eq!(a.configured_proxy, "");
    assert_eq!(a.effective_proxy, m.system_proxy);
    let id = a.context_id.as_ref().unwrap();
    assert!(id.starts_with("brc1-"));
    assert_eq!(id.len(), 29);
    assert!(id[5..].bytes().all(|byte| byte.is_ascii_hexdigit()));
    m.system_proxy = "http://127.0.0.1:8124".into();
    assert_ne!(a.context_id, snapshot(&m).context_id);
    m.timezone = "America/Los_Angeles".into();
    assert_ne!(a.context_id, snapshot(&m).context_id);
    let cfg_a = config::load(&scope_a).unwrap();
    assert!(
        risk_browser_context(risk_browser_settings(&root).ok(), None)
            .context_id
            .is_none(),
        "missing system route evidence must not become a direct probe"
    );
    let before_slot = snapshot(&m);
    db.configure_browser(true, false, None).unwrap();
    let scope_b = workspaces::ensure(&root).unwrap();
    config::save(&scope_b, &cfg_a).unwrap();
    assert_ne!(
        before_slot.context_id,
        snapshot(&m).context_id,
        "identical configs in different slots stay distinct"
    );
    let mut cfg_b = cfg_a.clone();
    cfg_b.proxy = "socks5://127.0.0.1:9123".into();
    config::save(&scope_b, &cfg_b).unwrap();
    let b = snapshot(&m);
    assert!(
        risk_browser_context(risk_browser_settings(&root).ok(), None)
            .context_id
            .is_some(),
        "a configured explicit route does not require system proxy fallback"
    );
    assert_eq!(b.configured_proxy, cfg_b.proxy);
    assert_eq!(
        b.effective_proxy, cfg_b.proxy,
        "explicit proxy wins in the same snapshot"
    );
    assert_ne!(b.context_id, a.context_id);
    cfg_b.native_graphics = !cfg_b.native_graphics;
    config::save(&scope_b, &cfg_b).unwrap();
    assert_ne!(
        b.context_id,
        snapshot(&m).context_id,
        "all config changes invalidate the revision"
    );
    fs::write(scope_b.join("config.json"), b"invalid synthetic config").unwrap();
    assert!(risk_browser_settings(&root).is_err());
    let unavailable = snapshot(&m);
    assert!(unavailable.context_id.is_none());
    assert_eq!(unavailable.effective_proxy, m.system_proxy);
    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}
fn machine() -> Machine {
    Machine {
        platform: "macos".into(),
        version: "27.2.0".into(),
        cores: 10,
        timezone: "America/New_York".into(),
        languages: vec!["en-US".into()],
        locale: "en_US".into(),
        locale_country: "US".into(),
        location_enabled: Some(false),
        timezones: vec!["America/New_York".into()],
        system_proxy: String::new(),
    }
}
pub(super) fn sample() -> PathBuf {
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("rf-browser-{}", server::nonce().unwrap()));
    fs::create_dir(&root).unwrap();
    root
}
#[test]
fn proxy_and_real_hardware() {
    let mut c = Config::default();
    for bad in [
        "http://a:8080/--disable-web-security",
        "http://user:pass@a:8080",
        "file:///tmp/a",
        "http://a:8080?q=x",
        "http://127.0.0.1",
        "https://proxy.example.com",
        "socks5://127.0.0.1",
        "http://127.0.0.1:0",
    ] {
        assert!(config::proxy(bad).is_err(), "expected {bad} rejected");
    }
    for ok_default_port in [
        "http://127.0.0.1:80",
        "http://[::1]:80",
        "https://proxy.example.com:443",
        "socks5://127.0.0.1:7898",
        "socks5h://127.0.0.1:7898",
    ] {
        assert!(
            config::proxy(ok_default_port).is_ok(),
            "expected {ok_default_port} accepted"
        );
    }
    c.proxy = "socks5h://127.0.0.1:7898".into();
    let a = config::arguments(
        &c,
        &machine(),
        Path::new("/profile"),
        "http://127.0.0.1/page",
        "148.0.7778.215",
    );
    assert!(a.contains(&"--fingerprint-brand-version=148.0.7778.215".into()));
    assert!(a.contains(&"--profile-directory=Default".into()));
    assert!(a.contains(&"--fingerprint-platform-version=27.2.0".into()));
    assert!(a.contains(&"--fingerprint-hardware-concurrency=10".into()));
    assert!(a.contains(&"--proxy-bypass-list=127.0.0.1;localhost;[::1]".into()));
    assert!(!a.iter().any(|argument| argument.contains("<-loopback>")));
    assert!(a.contains(
        &"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1"
            .into()
    ));
    assert!(a.contains(&"--test-type".into()));
    c.proxy = "socks5://[::1]:7898".into();
    let ipv6_args = config::arguments(
        &c,
        &machine(),
        Path::new("/profile"),
        "http://127.0.0.1/page",
        "148.0.7778.215",
    );
    assert!(ipv6_args
        .iter()
        .any(|x| x.contains("EXCLUDE ::1") && !x.contains("EXCLUDE [::1]")));
    assert!(!a.iter().any(|x| x.contains("disable-web-security")));
    let extension_args = a
        .iter()
        .filter(|argument| argument.starts_with("--load-extension="))
        .collect::<Vec<_>>();
    #[cfg(target_os = "windows")]
    {
        let installed = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .map(|parent| parent.join("browser-runtime/quota-bridge"))
            .filter(|path| path.join("manifest.json").is_file());
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/quota-bridge");
        let expected = installed.or_else(|| {
            (cfg!(any(debug_assertions, test)) && source.join("manifest.json").is_file()).then_some(source)
        });
        assert_eq!(extension_args.len(), if expected.is_some() { 1 } else { 0 });
        if let Some(expected) = expected {
            assert_eq!(
                extension_args[0],
                &format!("--load-extension={}", expected.display())
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    assert!(extension_args.is_empty());
}
#[test]
fn cache_isolation_and_direct_delete() {
    let root = sample();
    for name in [
        "Default/Cache/data",
        "Default/Network/Cookies",
        "Default/Bookmarks",
        "Default/Login Data",
        "Local State",
        "Default/Preferences",
        "Default/Web Data",
        "Default/History",
    ] {
        let p = root.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, b"fixture").unwrap();
    }
    let mut log = Vec::new();
    assert_eq!(
        profile::clear(&root, false, |n, d| log.push((n.to_string(), d))).unwrap(),
        1
    );
    assert_eq!(log.len(), 2);
    assert!(!root.join("Default/Cache").exists());
    assert!(root.join("Default/Network/Cookies").exists());
    profile::clear(&root, true, |_, _| {}).unwrap();
    assert!(!root.join("Default/Network/Cookies").exists());
    assert!(root.join("Default/Bookmarks").exists());
    assert!(root.join("Default/Login Data").exists());
    for name in [
        "Local State",
        "Default/Preferences",
        "Default/Web Data",
        "Default/History",
    ] {
        assert_eq!(
            fs::read(root.join(name)).unwrap(),
            b"fixture",
            "preserve {name}"
        );
    }
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn explicit_profile_reset_clears_all_profiles_keys_and_assets_but_nothing_outside() {
    let root = sample();
    let active = root.join("browser/contexts/a/profile");
    let files = [
        "Local State",
        "Default/Login Data",
        "Default/Login Data For Account",
        "Default/Bookmarks",
        "Default/History",
        "Default/Preferences",
        "Default/Web Data",
        "Default/Network/Cookies",
        "Default/Extensions/example/data",
        "Profile 1/Login Data",
        "Profile 1/Bookmarks",
        "Guest Profile/Local Storage/value",
        "unknown-provider/credential",
        "unknown-root-file",
    ];
    for file in files {
        let path = active.join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"synthetic profile value").unwrap();
    }
    let outside = [
        "browser/contexts/b/profile/Default/Login Data",
        "browser/contexts/a/config.json",
        "browser/contexts/a/seed.owner",
        "identity-vault/key.bin",
        "browser-runtime/chrome",
        "login.keychain-db",
    ];
    for file in outside {
        let path = root.join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"keep synthetic external value").unwrap();
    }
    let mut events = Vec::new();
    let count = profile::reset(
        &active,
        || Ok(()),
        |name, done, current, total| events.push((name.to_owned(), done, current, total)),
    )
    .unwrap();
    assert_eq!(fs::read_dir(&active).unwrap().count(), 0);
    assert_eq!(events.len(), count * 2);
    for (index, pair) in events.chunks_exact(2).enumerate() {
        assert_eq!((pair[0].1, pair[0].2, pair[0].3), (false, index, count));
        assert_eq!((pair[1].1, pair[1].2, pair[1].3), (true, index + 1, count));
        assert_eq!(pair[0].0, pair[1].0);
    }
    for file in outside {
        assert_eq!(
            fs::read(root.join(file)).unwrap(),
            b"keep synthetic external value"
        );
    }
    // 下一次启动的既有偏好层可重建空资料；没有恢复旧密码或书签。
    profile::preferences(&active, &Config::default(), &machine()).unwrap();
    assert!(active.join("Default/Preferences").is_file());
    assert!(!active.join("Default/Login Data").exists());
    assert!(!active.join("Default/Bookmarks").exists());
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn profile_reset_preflights_every_link_before_deleting_any_file() {
    let root = sample();
    let active = root.join("profile");
    let outside = root.join("external");
    fs::create_dir_all(active.join("Default/Cache")).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(
        active.join("Default/Cache/data"),
        b"keep before failed preflight",
    )
    .unwrap();
    fs::write(outside.join("keychain"), b"synthetic external keychain").unwrap();
    let link = active.join("linked-profile");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    #[cfg(windows)]
    assert!(Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap()
        .status
        .success());
    let mut events = Vec::new();
    assert!(profile::reset(
        &active,
        || Ok(()),
        |name, _, _, _| events.push(name.to_owned())
    )
    .is_err());
    assert!(events.is_empty());
    assert!(active.join("Default/Cache/data").exists());
    assert_eq!(
        fs::read(outside.join("keychain")).unwrap(),
        b"synthetic external keychain"
    );
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
    fs::remove_dir_all(root).unwrap();
}
#[cfg(unix)]
#[test]
fn profile_reset_unlinks_only_owned_root_chromium_crash_locks() {
    let root = sample();
    let active = root.join("profile");
    let outside = root.join("outside");
    fs::create_dir(&active).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), b"external fixture").unwrap();
    for name in ["SingletonLock", "SingletonCookie", "SingletonSocket"] {
        std::os::unix::fs::symlink(&outside, active.join(name)).unwrap();
    }
    assert_eq!(
        profile::reset(&active, || Ok(()), |_, _, _, _| {}).unwrap(),
        3
    );
    assert_eq!(fs::read_dir(&active).unwrap().count(), 0);
    assert_eq!(fs::read(outside.join("keep")).unwrap(), b"external fixture");
    // 相同名称放在子目录中也不能获得根锁例外。
    fs::create_dir(active.join("Default")).unwrap();
    std::os::unix::fs::symlink(&outside, active.join("Default/SingletonLock")).unwrap();
    assert!(profile::reset(&active, || Ok(()), |_, _, _, _| {}).is_err());
    fs::remove_file(active.join("Default/SingletonLock")).unwrap();
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn profile_reset_reports_partial_deletion_and_stops_when_browser_restarts() {
    let root = sample();
    fs::write(root.join("a"), b"first").unwrap();
    fs::write(root.join("b"), b"second").unwrap();
    assert!(profile::reset(
        &root,
        || Err("fixture process running".into()),
        |_, _, _, _| panic!("no deletion before process check")
    )
    .is_err());
    assert!(root.join("a").exists());
    let mut checks = 0;
    let mut completed = Vec::new();
    let error = profile::reset(
        &root,
        || {
            checks += 1;
            if checks >= 3 {
                Err("fixture browser restarted".into())
            } else {
                Ok(())
            }
        },
        |_, done, count, total| {
            if done {
                completed.push((count, total));
                std::thread::sleep(std::time::Duration::from_millis(260));
            }
        },
    )
    .unwrap_err();
    assert!(error.contains("1/2"));
    assert_eq!(completed, [(1, 2)]);
    assert!(!root.join("a").exists());
    assert!(root.join("b").exists());
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn reject_links_and_malformed_preferences() {
    let root = sample();
    let outside = sample();
    fs::write(outside.join("keep"), b"keep").unwrap();
    fs::create_dir(root.join("Default")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("Default/Cache")).unwrap();
    #[cfg(windows)]
    assert!(Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(
            root.join("Default/Cache")
                .to_string_lossy()
                .replace('/', "\\")
        )
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap()
        .status
        .success());
    assert!(profile::clear(&root, false, |_, _| {}).is_err());
    assert!(outside.join("keep").exists());
    let prefs = root.join("Default/Preferences");
    fs::write(&prefs, b"{\"intl\":\"wrong\"}").unwrap();
    assert!(profile::preferences(&root, &Config::default(), &machine()).is_err());
    assert_eq!(fs::read(&prefs).unwrap(), b"{\"intl\":\"wrong\"}");
    fs::write(&prefs, b"{}").unwrap();
    let local_state = root.join("Local State");
    fs::write(&local_state, b"{\"dns_over_https\":\"wrong\"}").unwrap();
    assert!(profile::preferences(&root, &Config::default(), &machine()).is_err());
    assert_eq!(fs::read(&local_state).unwrap(), b"{\"dns_over_https\":\"wrong\"}");
    assert!(server::resource(&root, "../keep").is_none());
    assert!(server::resource(&root, "Default/Cache/keep").is_none());
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
#[test]
fn preferences_preserve_assets_and_block_both_geolocation_modes() {
    let root = sample();
    fs::create_dir(root.join("Default")).unwrap();
    fs::write(root.join("Default/Preferences"),br#"{"bookmarks":{"keep":true},"profile":{"content_settings":{"exceptions":{"geolocation_with_options":{"site":{"setting":1}}}}}}"#).unwrap();
    fs::write(
        root.join("Local State"),
        br#"{"os_crypt":{"encrypted_key":"keep-synthetic"}}"#,
    )
    .unwrap();
    profile::preferences(&root, &Config::default(), &machine()).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("Default/Preferences")).unwrap()).unwrap();
    assert_eq!(value["bookmarks"]["keep"], true);
    assert_eq!(
        value["profile"]["default_content_setting_values"]["geolocation_with_options"],
        serde_json::json!({"approximate":2,"precise":2})
    );
    assert_eq!(
        value["profile"]["content_settings"]["exceptions"]["geolocation_with_options"],
        serde_json::json!({})
    );
    assert_eq!(value["dns_prefetching"]["enabled"], serde_json::json!(false));
    assert_eq!(
        value["net"]["network_prediction_options"],
        serde_json::json!(2)
    );
    let local_state: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("Local State")).unwrap()).unwrap();
    assert_eq!(
        local_state["os_crypt"]["encrypted_key"],
        serde_json::json!("keep-synthetic")
    );
    assert_eq!(
        local_state["dns_over_https"]["mode"],
        serde_json::json!("off")
    );
    assert_eq!(config::accept_languages("ja"), "ja");
    assert_eq!(config::accept_languages("en-US"), "en-US,en");
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn observations_required() {
    let checks = network::checks(&machine(), &Config::default(), None, None, "148");
    assert_eq!(checks.iter().filter(|x| x.status == "pending").count(), 10);
    assert!(
        network::parse(&serde_json::json!({"success":true,"ip":"fake","country_code":"US"}))
            .is_err()
    );
}
#[test]
fn country_checks_follow_region_instead_of_assuming_america() {
    let mut machine = machine();
    machine.timezone = "Asia/Tokyo".into();
    machine.languages = vec!["ja".into()];
    machine.locale = "ja_JP".into();
    machine.locale_country = "JP".into();
    let mut config = Config::default();
    config.follow_machine = false;
    config.language = "ja".into();
    config.timezone = "Asia/Tokyo".into();
    let mut report = network::Report {
        schema_version: None,
        language: "ja".into(),
        languages: vec!["ja".into()],
        timezone: "Asia/Tokyo".into(),
        platform: "MacIntel".into(),
        cores: 10,
        user_agent: "fixture".into(),
        platform_version: machine.version.clone(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: Some(network::Exit {
            ip: "203.0.113.1".into(),
            country: "JP".into(),
            city: "Tokyo".into(),
            timezone: "Asia/Tokyo".into(),
            isp: "fixture".into(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let checks = network::checks(&machine, &config, Some(&report), None, "148");
    assert_eq!(checks[0].status, "ok");
    assert_eq!(checks[3].status, "ok");
    report.exit.as_mut().unwrap().country = "US".into();
    assert_eq!(
        network::checks(&machine, &config, Some(&report), None, "148")[0].status,
        "mismatch"
    );
    assert_eq!(
        crate::regions::matching("ja", "Europe/Paris").map(|r| r.country),
        None
    );
}

#[test]
fn rate_limited_service_falls_back_without_changing_route() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for status in ["429 Too Many Requests", "200 OK"] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            let body = r#"{"ip":"203.0.113.2","country_code":"JP","timezone":"Asia/Tokyo","org":"fixture"}"#;
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
    });
    let urls = [
        format!("http://{address}/primary"),
        format!("http://{address}/backup"),
    ];
    let exit =
        tauri::async_runtime::block_on(network::probe_urls("", &[&urls[0], &urls[1]])).unwrap();
    assert_eq!(exit.ip, "203.0.113.2");
    assert_eq!(exit.timezone, "Asia/Tokyo");
    assert!(network::parse(
        &serde_json::json!({"error":true,"ip":"203.0.113.2","country_code":"US"})
    )
    .is_err());
    server.join().unwrap();
}

#[test]
fn classification_uses_frozen_proxy_and_preserves_base_geo_on_failure() {
    use std::io::{BufRead, BufReader, Write};
    let cases = vec![
        ("200 OK", r#"{"ip":"203.0.113.2","risk":{"is_datacenter":false},"location":{"country_code":"US"}}"#.to_string(), None),
        ("200 OK", r#"{"ip":"203.0.113.2","risk":{"is_datacenter":true}}"#.to_string(), None),
        ("429 Too Many Requests", "private provider error".into(), Some("rate_limited")),
        ("503 Unavailable", "private provider error".into(), Some("http_error")),
        ("200 OK", "private malformed JSON".into(), Some("invalid_response")),
        ("200 OK", r#"{"ip":"203.0.113.3","risk":{"is_datacenter":false}}"#.into(), Some("ip_mismatch")),
        ("200 OK", r#"{"ip":"203.0.113.2","risk":{"is_datacenter":"false"}}"#.into(), Some("invalid_response")),
        ("200 OK", r#"{"ip":"203.0.113.2","risk":{}}"#.into(), Some("invalid_response")),
        ("200 OK", "x".repeat(32_769), Some("response_too_large")),
    ];
    for (status, body, error) in cases {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let base = r#"{"ip":"203.0.113.2","country_code":"JP","city":"Tokyo","timezone":"Asia/Tokyo","connection":{"asn":12345,"isp":"Unlisted fixture carrier"}}"#;
            for (expected, status, body) in [
                ("GET http://geo.invalid/ HTTP/1.1", "200 OK", base),
                (
                    "GET http://classification.invalid/203.0.113.2?format=json HTTP/1.1",
                    status,
                    body.as_str(),
                ),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.trim_end(), expected);
                loop {
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                }
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let exit = tauri::async_runtime::block_on(network::probe_with_classification(
            &proxy,
            &["http://geo.invalid/"],
            Some("http://classification.invalid/"),
        ))
        .unwrap();
        assert_eq!(exit.ip, "203.0.113.2");
        assert_eq!(exit.country, "JP");
        assert_eq!(exit.city, "Tokyo");
        assert_eq!(exit.timezone, "Asia/Tokyo");
        assert_eq!(exit.isp, "Unlisted fixture carrier");
        assert_eq!(exit.asn.as_deref(), Some("AS12345"));
        assert_eq!(exit.hosting_error.as_deref(), error);
        if error.is_some() {
            assert!(exit.hosting.is_none());
            assert!(exit.hosting_source.is_none());
        } else {
            assert!(exit.hosting.is_some());
            assert_eq!(exit.hosting_source.as_deref(), Some("ipquery"));
        }
        assert!(!serde_json::to_string(&exit).unwrap().contains("private"));
        server.join().unwrap();
    }
}

#[test]
fn classification_matches_canonical_ipv6_and_skips_existing_hosting() {
    use std::io::{BufRead, BufReader, Write};
    for existing in [false, true] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let base = serde_json::json!({"ip":"2001:db8::1","country_code":"JP","hosting":if existing {Some(false)} else {None}}).to_string();
            let classification =
                r#"{"ip":"2001:0db8:0000:0000:0000:0000:0000:0001","risk":{"is_datacenter":true}}"#;
            for body in std::iter::once(base.as_str()).chain((!existing).then_some(classification))
            {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                loop {
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                }
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let base = format!("http://{address}/");
        let exit = tauri::async_runtime::block_on(network::probe_with_classification(
            "",
            &[&base],
            Some(&base),
        ))
        .unwrap();
        assert_eq!(exit.ip, "2001:db8::1");
        assert_eq!(exit.hosting, Some(!existing));
        assert_eq!(
            exit.hosting_source.as_deref(),
            if existing { None } else { Some("ipquery") }
        );
        server.join().unwrap();
    }
}

#[test]
fn report_bounds_classification_and_webrtc_diagnostics_without_rejecting_legacy() {
    let mut report = network::Report {
        cores: 1,
        ..Default::default()
    };
    assert!(report.valid());
    for reason in [
        "complete",
        "non_local_candidate",
        "constructor_error",
        "setup_error",
        "offer_error",
        "description_error",
        "negotiation_timeout",
        "gathering_timeout",
    ] {
        report.webrtc_reason = Some(reason.into());
        report.webrtc_elapsed_ms = Some(120_000);
        assert!(report.valid());
    }
    report.webrtc_elapsed_ms = Some(120_001);
    assert!(!report.valid());
    report.webrtc_elapsed_ms = None;
    report.webrtc_reason = Some("arbitrary external error".into());
    assert!(!report.valid());
    report.webrtc_reason = None;
    report.exit = Some(network::Exit {
        ip: "203.0.113.2".into(),
        ..Default::default()
    });
    assert!(report.valid());
    report.exit.as_mut().unwrap().hosting_error = Some("rate_limited".into());
    assert!(report.valid());
    report.exit.as_mut().unwrap().hosting_error = Some("arbitrary external error".into());
    assert!(!report.valid());
    let exit = report.exit.as_mut().unwrap();
    exit.hosting_error = None;
    exit.hosting = Some(false);
    exit.hosting_source = Some("ipquery".into());
    assert!(report.valid());
    report.exit.as_mut().unwrap().hosting_source = Some("arbitrary source".into());
    assert!(!report.valid());
}

#[test]
fn linux_platform_and_unknown_location_cannot_be_misreported_as_mac_or_disabled() {
    let mut m = machine();
    m.platform = "linux".into();
    m.version = "6.18.0".into();
    m.location_enabled = None;
    let args = config::arguments(
        &Config::default(),
        &m,
        Path::new("/profile"),
        "http://localhost",
        "148",
    );
    assert!(args.contains(&"--fingerprint-platform=linux".into()));
    let report = network::Report {
        schema_version: None,
        language: "en-US".into(),
        languages: vec!["en-US".into()],
        timezone: m.timezone.clone(),
        platform: "Linux x86_64".into(),
        cores: m.cores,
        user_agent: "fixture".into(),
        platform_version: String::new(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: None,
        ..Default::default()
    };
    let checks = network::checks(&m, &Config::default(), Some(&report), None, "148");
    assert_eq!(
        checks
            .iter()
            .find(|c| c.title == "真实设备与 CPU")
            .unwrap()
            .status,
        "ok"
    );
    assert_eq!(
        checks
            .iter()
            .find(|c| c.title == "地理位置关闭")
            .unwrap()
            .status,
        "pending"
    );
}

#[test]
fn invalid_or_unreachable_proxy_never_falls_back_to_direct() {
    let origin = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    origin.set_nonblocking(true).unwrap();
    let url = format!("http://{}/", origin.local_addr().unwrap());
    let unused = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let unavailable_proxy = format!("http://{}", unused.local_addr().unwrap());
    drop(unused);
    for proxy in ["http://[invalid", unavailable_proxy.as_str()] {
        assert!(tauri::async_runtime::block_on(network::probe_urls(proxy, &[&url])).is_err());
        assert_eq!(
            origin.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[test]
fn distinct_iana_timezones_remain_conflicts_on_every_platform() {
    let mut machine = machine();
    machine.timezone = "Europe/Berlin".into();
    machine.languages = vec!["de".into()];
    machine.locale_country = "DE".into();
    let report = network::Report {
        schema_version: None,
        language: "de".into(),
        languages: machine.languages.clone(),
        timezone: "Europe/Paris".into(),
        platform: "MacIntel".into(),
        cores: machine.cores,
        user_agent: "fixture".into(),
        platform_version: machine.version.clone(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: Some(network::Exit {
            ip: "203.0.113.2".into(),
            country: "DE".into(),
            city: String::new(),
            timezone: "Europe/Berlin".into(),
            isp: String::new(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let checks = network::checks(&machine, &Config::default(), Some(&report), None, "148");
    assert_eq!(
        checks
            .iter()
            .find(|check| check.title == "时区一致")
            .unwrap()
            .status,
        "mismatch"
    );
}

#[test]
fn machine_proxy_credentials_never_leave_native_code() {
    let mut m = machine();
    m.system_proxy = "http://private-user:private-password@localhost:8080".into();
    let value = serde_json::to_string(&m).unwrap();
    assert!(!value.contains("private-password"));
    assert!(!value.contains("system_proxy"));
}

#[test]
fn windows_report_requires_real_platform_cpu_and_version() {
    let mut m = machine();
    m.platform = "windows".into();
    m.version = "10.0.26100".into();
    let mut report = network::Report {
        schema_version: None,
        language: "en-US".into(),
        languages: vec!["en-US".into()],
        timezone: m.timezone.clone(),
        platform: "Win32".into(),
        cores: m.cores,
        user_agent: "fixture".into(),
        platform_version: m.version.clone(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: None,
        ..Default::default()
    };
    let result = |r: &network::Report| {
        network::checks(&m, &Config::default(), Some(r), None, "148")
            .into_iter()
            .find(|c| c.title == "真实设备与 CPU")
            .unwrap()
            .status
    };
    assert_eq!(result(&report), "ok");
    report.platform = "MacIntel".into();
    assert_eq!(result(&report), "mismatch");
    report.platform = "Win32".into();
    report.platform_version = "fake".into();
    assert_eq!(result(&report), "mismatch");
}

#[test]
fn follow_machine_taiwan_preserves_language_script_and_checks_actual_country() {
    let mut machine = machine();
    machine.timezone = "Asia/Taipei".into();
    machine.languages = vec!["zh-Hans-TW".into(), "zh-Hant-TW".into()];
    machine.locale = "zh_CN@rg=twzzzz".into();
    machine.locale_country = "TW".into();
    let config = Config::default();
    assert_eq!(config.region(&machine).map(|r| r.id), Some("tw"));
    assert_eq!(config.language(&machine), "zh-Hans-TW");
    let mut report = network::Report {
        schema_version: None,
        language: "zh-Hans-TW".into(),
        languages: machine.languages.clone(),
        timezone: machine.timezone.clone(),
        platform: "MacIntel".into(),
        cores: machine.cores,
        user_agent: "fixture".into(),
        platform_version: machine.version.clone(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: Some(network::Exit {
            ip: "203.0.113.1".into(),
            country: "TW".into(),
            city: "Taipei".into(),
            timezone: machine.timezone.clone(),
            isp: "fixture".into(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let checks = network::checks(&machine, &config, Some(&report), None, "148");
    assert_eq!(checks[0].status, "ok");
    assert_eq!(checks[3].status, "ok");
    report.language = "zh-Hant-TW".into();
    assert_eq!(
        network::checks(&machine, &config, Some(&report), None, "148")[3].status,
        "mismatch"
    );
    report.exit.as_mut().unwrap().country = "CN".into();
    assert_eq!(
        network::checks(&machine, &config, Some(&report), None, "148")[0].status,
        "mismatch"
    );
    machine.locale_country = "CN".into();
    assert!(config.region(&machine).is_none());
    assert_eq!(
        network::checks(&machine, &config, Some(&report), None, "148")[0].status,
        "pending"
    );
    machine.locale_country.clear();
    assert!(config.region(&machine).is_none());
    // A matching timezone and Chinese language alone never establish Taiwan.
    machine.locale_country = "TW".into();
    machine.languages = vec!["en-GB".into()];
    assert_eq!(config.region(&machine).map(|r| r.id), Some("tw"));
    assert_eq!(config.language(&machine), "en-GB");
}

#[test]
fn refreshed_context_recomputes_target_from_effective_machine_country() {
    let mut context = Context {
        identity: crate::identities::browser_link::BrowserIdentity {
            linked: false,
            status: "unlinked",
            name: None,
            email: None,
            organization: None,
            cli_proxy: None,
        },
        ui_language: "zh".into(),
        exit_services: &network::SERVICES,
        exit_classification_service: Some(network::CLASSIFICATION_SERVICE),
        config: Config::default(),
        region: None,
        machine: machine(),
        engine_version: "148".into(),
    };
    let mut taiwan = machine();
    taiwan.timezone = "Asia/Taipei".into();
    taiwan.languages = vec!["zh-Hans-TW".into()];
    taiwan.locale = "zh_CN@rg=twzzzz".into();
    taiwan.locale_country = "TW".into();
    context.update_machine(taiwan.clone());
    assert_eq!(context.region.map(|r| r.country), Some("TW"));
    assert_eq!(context.config.language(&context.machine), "zh-Hans-TW");
    taiwan.locale_country = "CN".into();
    context.update_machine(taiwan);
    assert!(context.region.is_none());
}

#[test]
fn deep_probes_close_graphics_and_webrtc_checks() {
    let m = machine();
    let c = Config::default();
    let host = network::Exit {
        ip: "203.0.113.9".into(),
        country: "US".into(),
        city: "New York".into(),
        timezone: "America/New_York".into(),
        isp: "Comcast Cable".into(),
        asn: Some("AS7922".into()),
        hosting: Some(false),
        ..Default::default()
    };
    let report = network::Report {
        schema_version: Some(1),
        language: "en-US".into(),
        languages: vec!["en-US".into()],
        timezone: "America/New_York".into(),
        platform: "MacIntel".into(),
        cores: m.cores,
        user_agent: "fixture".into(),
        platform_version: m.version.clone(),
        browser_version: "148".into(),
        geolocation: "denied".into(),
        error: String::new(),
        exit: Some(host.clone()),
        webrtc_ok: Some(true),
        webrtc_detail: Some("未检出公网/局域网 IP 泄漏".into()),
        webdriver: Some(false),
        graphics_ok: Some(true),
        webgl_renderer: Some("ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)".into()),
        tz_offset_ok: Some(true),
        tz_offset_detail: Some("America/New_York (UTC-05:00)".into()),
        media_fingerprint_ok: Some(true),
        media_fingerprint_detail: Some("Canvas 2D + AudioContext 48000Hz".into()),
        client_hints_ok: Some(true),
        client_hints_detail: Some("UA-CH 桌面端 · 24-bit 屏幕".into()),
        ..Default::default()
    };
    let checks = network::checks(&m, &c, Some(&report), Some(&host), "148");
    assert_eq!(checks.len(), 10);
    assert!(checks.iter().all(|item| item.status == "ok"));
    assert_eq!(checks[8].id, "probe.webrtc-local-candidates");
    let old = network::Report {
        schema_version: None,
        ..report.clone()
    };
    let old_checks = network::checks(&m, &c, Some(&old), Some(&host), "148");
    assert_eq!(old_checks[8].status, "pending");
    assert_eq!(old_checks[9].status, "pending");
    let unknown_exit = network::Exit {
        hosting: None,
        asn: None,
        isp: "Unlisted carrier".into(),
        ..host.clone()
    };
    let unknown = network::Report {
        exit: Some(unknown_exit),
        ..report
    };
    assert_eq!(
        network::checks(&m, &c, Some(&unknown), Some(&host), "148")[9].status,
        "pending"
    );

    // RCN / AS6079 without upstream hosting flag resolves cleanly as ResidentialIsp with canonical label
    let rcn_exit = network::parse(&serde_json::json!({
        "ip": "198.51.100.42",
        "country_code": "US",
        "city": "Ashburn",
        "timezone": "America/New_York",
        "org": "RCN",
        "asn": "AS6079"
    }))
    .unwrap();
    assert_eq!(rcn_exit.hosting, Some(false));
    assert_eq!(rcn_exit.isp, "RCN (Astound Broadband · AS6079)");
    assert!(network::Report {
        cores: 1,
        exit: Some(rcn_exit.clone()),
        ..Default::default()
    }
    .valid());
    let rcn_report = network::Report {
        exit: Some(rcn_exit.clone()),
        ..unknown
    };
    assert_eq!(
        network::checks(&m, &c, Some(&rcn_report), Some(&rcn_exit), "148")[9].status,
        "ok"
    );
}

#[test]
fn launch_policy_blocks_restricted_direct_and_unsupported_exit_while_passing_us_proxy() {
    use std::io::{BufRead, BufReader, Write};
    let mut cn_machine = machine();
    cn_machine.timezone = "Asia/Shanghai".into();
    cn_machine.locale = "zh_CN".into();
    cn_machine.locale_country = "CN".into();
    cn_machine.languages = vec!["zh-CN".into()];

    let empty_cfg = Config::default();
    assert_eq!(
        config::evaluate_browser_launch_policy_with_urls(
            &empty_cfg,
            &cn_machine,
            true,
            false,
            &[]
        )
        .unwrap_err(),
        "browser.error.proxyRequiredOnRestrictedHost"
    );
    assert!(config::evaluate_browser_launch_policy_with_urls(
        &empty_cfg,
        &cn_machine,
        true,
        true,
        &[]
    )
    .is_ok());

    let spawn_proxy_trace = |loc: &'static str| -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" {
                        break;
                    }
                    line.clear();
                }
                let body = format!("ip=198.51.100.42\nloc={loc}\n");
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        format!("http://{addr}")
    };

    let mut hk_cfg = Config::default();
    hk_cfg.proxy = spawn_proxy_trace("HK");
    assert_eq!(
        config::evaluate_browser_launch_policy_with_urls(
            &hk_cfg,
            &cn_machine,
            true,
            false,
            &["http://trace.example.invalid/cdn-cgi/trace"],
        )
        .unwrap_err(),
        "browser.error.unsupportedExitCountry"
    );

    let mut us_cfg = Config::default();
    us_cfg.proxy = spawn_proxy_trace("US");
    assert!(config::evaluate_browser_launch_policy_with_urls(
        &us_cfg,
        &cn_machine,
        true,
        false,
        &["http://trace.example.invalid/cdn-cgi/trace"],
    )
    .is_ok());
}

#[test]
fn slot_materialization_prioritizes_slot_proxies_and_auto_heals_empty_proxy_without_touching_seed() {
    let fixture = sample();
    let root = fixture.join("browser");
    crate::identities::private::directory(&root).unwrap();
    let mut root_cfg = Config::default();
    root_cfg.proxy = "http://127.0.0.1:7897".into();
    config::save(&root, &root_cfg).unwrap();

    let mut db = workspaces::database(&root).unwrap();
    let owner_a = crate::identities::new_id().unwrap();
    let owner_b = crate::identities::new_id().unwrap();
    let make_record = |id: &str, name: &str| crate::identities::database::Record {
        id: id.into(),
        name: name.into(),
        archive: format!("{id}.baga"),
        saved_at: 1,
        bytes: 1,
        policy: crate::identities::Policy::default(),
        empty: false,
        account_key: Some(name.into()),
    };
    db.remember(&make_record(&owner_a, "Owner A")).unwrap();
    db.remember(&make_record(&owner_b, "Owner B")).unwrap();
    db.configure_browser(true, false, Some(&owner_a)).unwrap();
    let scope_a = workspaces::ensure(&root).unwrap();
    let mut donor_cfg = config::load(&scope_a).unwrap();
    donor_cfg.proxy = "socks5://127.0.0.1:7899".into();
    donor_cfg.follow_machine = false;
    donor_cfg.language = "en-US".into();
    donor_cfg.timezone = "America/New_York".into();
    config::save(&scope_a, &donor_cfg).unwrap();

    fs::write(
        fixture.join("smart_relay_v1.json"),
        serde_json::to_vec(&serde_json::json!({
            "slotProxies": {
                owner_b.clone(): "http://127.0.0.1:17899"
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let (slot_b, seed_b) = db.ensure_identity_binding(&owner_b).unwrap();
    let scope_b =
        workspaces::ensure_slot_with_home_and_policy(&root, &db, &slot_b, None, true).unwrap();
    let cfg_b = config::load(&scope_b).unwrap();
    assert_eq!(cfg_b.seed, seed_b);
    assert_eq!(cfg_b.proxy, "socks5://127.0.0.1:17899");
    assert!(!cfg_b.follow_machine);
    assert_eq!(cfg_b.timezone, "America/New_York");

    // Remove slotProxies and clear scope_b proxy while customizing seed -> auto-heal restores donor proxy & timezone without touching seed!
    fs::remove_file(fixture.join("smart_relay_v1.json")).unwrap();
    let mut broken = cfg_b.clone();
    broken.seed = 777_777;
    broken.proxy.clear();
    broken.follow_machine = true;
    broken.timezone = "Asia/Shanghai".into();
    config::save(&scope_b, &broken).unwrap();

    workspaces::ensure_slot_with_home_and_policy(&root, &db, &slot_b, None, true).unwrap();
    let healed = config::load(&scope_b).unwrap();
    assert_eq!(healed.seed, 777_777, "auto-heal must never overwrite seed");
    assert_eq!(healed.proxy, "socks5://127.0.0.1:7899");
    assert!(!healed.follow_machine);
    assert_eq!(healed.timezone, "America/New_York");

    drop(db);
    fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn parse_supports_multi_provider_geo_schemas_and_rejects_errors() {
    let ipq = network::parse(&serde_json::json!({
        "ip": "203.0.113.51",
        "isp": { "asn": "AS6079", "org": "RCN", "isp": "RCN" },
        "location": { "country": "United States", "country_code": "US", "city": "Ashburn", "timezone": "America/New_York" },
        "risk": { "is_datacenter": false }
    }))
    .unwrap();
    assert_eq!(ipq.country, "US");
    assert_eq!(ipq.city, "Ashburn");
    assert_eq!(ipq.timezone, "America/New_York");
    assert_eq!(ipq.asn.as_deref(), Some("AS6079"));
    assert_eq!(ipq.hosting, Some(false));

    let ipinfo = network::parse(&serde_json::json!({
        "ip": "203.0.113.52",
        "city": "Ashburn",
        "country": "US",
        "org": "AS6079 RCN",
        "timezone": "America/New_York"
    }))
    .unwrap();
    assert_eq!(ipinfo.country, "US");
    assert_eq!(ipinfo.asn.as_deref(), Some("AS6079"));
    assert_eq!(ipinfo.hosting, Some(false));

    let ipsb = network::parse(&serde_json::json!({
        "ip": "203.0.113.53",
        "country_code": "US",
        "city": "Ashburn",
        "timezone": "America/New_York",
        "asn": 6079,
        "isp": "Astound Broadband"
    }))
    .unwrap();
    assert_eq!(ipsb.country, "US");
    assert_eq!(ipsb.asn.as_deref(), Some("AS6079"));
    assert_eq!(ipsb.hosting, Some(false));

    let geojs = network::parse(&serde_json::json!({
        "ip": "203.0.113.54",
        "country_code": "US",
        "city": "Los Angeles",
        "timezone": "America/Los_Angeles",
        "asn": 0,
        "organization_name": "Unlisted Carrier"
    }))
    .unwrap();
    assert_eq!(geojs.country, "US");
    assert_eq!(geojs.isp, "Unlisted Carrier");
    assert!(geojs.asn.is_none());
    assert!(geojs.hosting.is_none());

    assert!(network::parse(&serde_json::json!({"ip":"203.0.113.55","country":"United States"})).is_err());
    assert!(network::parse(&serde_json::json!({"ip":"203.0.113.55","country_code":"USA","country":"US"})).is_err());
    assert!(network::parse(&serde_json::json!({"ip":"203.0.113.55","country":"US","error":{"title":"Rate limit"}})).is_err());

    // Hard datacenter ASN must override false is_datacenter from upstream without claiming ipquery source.
    let idc_override = network::parse(&serde_json::json!({
        "ip": "203.0.113.56",
        "isp": { "asn": "AS14061", "org": "DigitalOcean, LLC", "isp": "DigitalOcean" },
        "location": { "country_code": "US", "city": "New York", "timezone": "America/New_York" },
        "risk": { "is_datacenter": false }
    }))
    .unwrap();
    assert_eq!(idc_override.hosting, Some(true));
    assert!(idc_override.hosting_source.is_none());
}

#[test]
fn probe_deduplicates_failed_ipquery_origin_and_sets_source_on_direct_ipquery() {
    use std::io::{BufRead, BufReader, Write};

    // Case 1: api.ipquery.io returns 200 with risk.is_datacenter -> 1 request total, hosting_source="ipquery".
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert_eq!(line.trim_end(), "GET http://api.ipquery.io/?format=json HTTP/1.1");
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let body = r#"{"ip":"203.0.113.60","isp":{"asn":"AS12345","org":"Unlisted Carrier","isp":"Unlisted Carrier"},"location":{"country_code":"US","city":"Ashburn","timezone":"America/New_York"},"risk":{"is_datacenter":false}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let exit = tauri::async_runtime::block_on(network::probe_with_classification(
        &proxy,
        &["http://api.ipquery.io/?format=json", "http://ipinfo.io/json"],
        Some("http://api.ipquery.io/"),
    ))
    .unwrap();
    assert_eq!(exit.ip, "203.0.113.60");
    assert_eq!(exit.country, "US");
    assert_eq!(exit.hosting, Some(false));
    assert_eq!(exit.hosting_source.as_deref(), Some("ipquery"));
    server.join().unwrap();

    // Case 2: api.ipquery.io returns 429 -> falls back to ipinfo.io, skips duplicate classifier call, records rate_limited.
    let listener2 = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy2 = format!("http://{}", listener2.local_addr().unwrap());
    let server2 = std::thread::spawn(move || {
        for (expected, status, body) in [
            (
                "GET http://api.ipquery.io/?format=json HTTP/1.1",
                "429 Too Many Requests",
                "rate limit",
            ),
            (
                "GET http://ipinfo.io/json HTTP/1.1",
                "200 OK",
                r#"{"ip":"203.0.113.61","country":"US","city":"Ashburn","timezone":"America/New_York","org":"AS12345 Unlisted Carrier"}"#,
            ),
        ] {
            let (mut stream, _) = listener2.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), expected);
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
    });
    let fallback = tauri::async_runtime::block_on(network::probe_with_classification(
        &proxy2,
        &["http://api.ipquery.io/?format=json", "http://ipinfo.io/json"],
        Some("http://api.ipquery.io/"),
    ))
    .unwrap();
    assert_eq!(fallback.ip, "203.0.113.61");
    assert_eq!(fallback.country, "US");
    assert_eq!(fallback.asn.as_deref(), Some("AS12345"));
    assert_eq!(fallback.isp, "Unlisted Carrier");
    assert!(fallback.hosting.is_none());
    assert_eq!(fallback.hosting_error.as_deref(), Some("rate_limited"));
    server2.join().unwrap();
}

#[test]
fn probe_country_uses_trace_for_explicit_proxy_and_falls_back() {
    use std::io::{BufRead, BufReader, Write};

    // Case 1: Explicit proxy succeeds on lightweight trace without touching GeoIP services.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert_eq!(line.trim_end(), "GET http://trace.invalid/cdn-cgi/trace HTTP/1.1");
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        let body = "fl=123\nip=203.0.113.70\nloc=US\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let cc = tauri::async_runtime::block_on(network::probe_country_with_urls(
        &proxy,
        &["http://trace.invalid/cdn-cgi/trace"],
        &["http://geo-unused.invalid/"],
    ))
    .unwrap();
    assert_eq!(cc, "US");
    server.join().unwrap();

    // Case 2: Trace returns 503 -> falls back to GeoIP service.
    let listener2 = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy2 = format!("http://{}", listener2.local_addr().unwrap());
    let server2 = std::thread::spawn(move || {
        for (expected, status, body) in [
            ("GET http://trace.invalid/cdn-cgi/trace HTTP/1.1", "503 Service Unavailable", "err"),
            (
                "GET http://geo.invalid/ HTTP/1.1",
                "200 OK",
                r#"{"ip":"203.0.113.71","country":"JP","timezone":"Asia/Tokyo"}"#,
            ),
        ] {
            let (mut stream, _) = listener2.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), expected);
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
    });
    let cc2 = tauri::async_runtime::block_on(network::probe_country_with_urls(
        &proxy2,
        &["http://trace.invalid/cdn-cgi/trace"],
        &["http://geo.invalid/"],
    ))
    .unwrap();
    assert_eq!(cc2, "JP");
    server2.join().unwrap();

    let parsed = network::parse_trace_exit("fl=123\nip=198.51.100.42\nloc=us\n").unwrap();
    assert_eq!(parsed.country, "US");
    assert_eq!(parsed.ip.as_deref(), Some("198.51.100.42"));
    let bad_ip = network::parse_trace_exit("ip=not-an-ip\nloc=US\n").unwrap();
    assert_eq!(bad_ip.country, "US");
    assert_eq!(bad_ip.ip, None);
    assert!(network::parse_trace_exit("ip=198.51.100.42\n").is_none());
}

#[test]
fn default_config_enables_spoofing_and_requires_persisted_non_zero_seed() {
    let cfg = Config::default();
    assert!(!cfg.native_graphics, "native_graphics must default to false");
    assert_eq!(cfg.seed, 0, "Config::default must not hardcode a static seed");
    assert!(
        cfg.validate(&machine()).is_err(),
        "Config::validate must still reject seed == 0"
    );

    let fixture = sample();
    let mut loaded = config::load(&fixture).unwrap();
    assert_eq!(loaded.seed, 0);
    config::ensure_persisted_seed(&fixture, None, &mut loaded).unwrap();
    assert!(loaded.seed > 0);
    assert_eq!(config::load(&fixture).unwrap().seed, loaded.seed);
    assert!(loaded.validate(&machine()).is_ok());

    let mut from_db = Config::default();
    config::ensure_persisted_seed(&fixture, Some(987654321), &mut from_db).unwrap();
    assert_eq!(from_db.seed, 987654321);
    assert_eq!(config::load(&fixture).unwrap().seed, 987654321);

    fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn chromium_148_anti_hang_and_spoofing_flags_are_emitted_by_mode() {
    let m = machine();
    let mut cfg = Config {
        seed: 123456789,
        proxy: String::new(),
        follow_machine: false,
        language: "en-US".into(),
        timezone: "America/New_York".into(),
        native_graphics: false,
    };

    // TUN mode + spoofing enabled + extension disabled (BrowseClaudeAi target policy)
    let tun_args = config::arguments_with_options(
        &cfg,
        &m,
        Path::new("/profile"),
        "https://claude.ai/new",
        "148.0.7778.215",
        config::LaunchOptions::for_purpose(config::LaunchPurpose::BrowseClaudeAi),
    );
    assert!(!tun_args.iter().any(|a| a.starts_with("--disable-spoofing=")));
    assert!(tun_args.contains(&"--no-proxy-server".into()));
    assert!(tun_args.contains(&"--set-ipv6-probe-false".into()));
    assert!(tun_args.contains(&"--disable-quic".into()));
    assert!(tun_args.contains(
        &"--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability".into()
    ));
    assert!(tun_args.contains(&"--disable-background-networking".into()));
    assert!(tun_args.contains(&"--disable-component-update".into()));
    assert!(tun_args.contains(&"--no-pings".into()));
    assert!(tun_args.contains(&"--disable-sync".into()));
    assert!(tun_args.contains(&"--disable-default-apps".into()));
    assert!(tun_args.contains(&"--fingerprint-hardware-concurrency=10".into()));
    assert!(tun_args.iter().any(|a| a.starts_with("--fingerprint-screen-width=")));
    assert!(tun_args.iter().any(|a| a.starts_with("--fingerprint-screen-height=")));
    assert!(tun_args.iter().any(|a| a.starts_with("--fingerprint-device-scale-factor=")));
    assert!(!tun_args.iter().any(|a| a.starts_with("--load-extension=")));

    // QuotaSync mode injects --load-extension on Windows when manifest exists
    let sync_args = config::arguments_with_options(
        &cfg,
        &m,
        Path::new("/profile"),
        "https://claude.ai/settings/usage",
        "148.0.7778.215",
        config::LaunchOptions::for_purpose(config::LaunchPurpose::QuotaSync),
    );
    #[cfg(target_os = "windows")]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/quota-bridge");
        if source.join("manifest.json").is_file() {
            assert!(sync_args.iter().any(|a| a.starts_with("--load-extension=")));
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = sync_args;

    // native_graphics = true disables spoofing & omits virtual screen preset
    cfg.native_graphics = true;
    cfg.proxy = "socks5://127.0.0.1:7899".into();
    let native_args = config::arguments_with_options(
        &cfg,
        &m,
        Path::new("/profile"),
        "about:blank",
        "148.0.7778.215",
        config::LaunchOptions::legacy_default(),
    );
    assert!(native_args.contains(&"--disable-spoofing=font,audio,gpu,canvas,clientrects".into()));
    assert!(!native_args.iter().any(|a| a.starts_with("--fingerprint-screen-width=")));
    assert!(!native_args.contains(&"--no-proxy-server".into()));
}

#[test]
fn preferences_and_local_state_hardening_skips_redundant_writes() {
    let root = sample();
    fs::create_dir(root.join("Default")).unwrap();
    fs::write(
        root.join("Default/Preferences"),
        br#"{"bookmarks":{"keep":true},"proxy":{"mode":"system"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("Local State"),
        br#"{"os_crypt":{"encrypted_key":"keep-synthetic"},"variations_seed":"strip-me","variations_compressed_seed":"strip-me","user_experience_metrics":{"client_id":"strip-me"}}"#,
    )
    .unwrap();

    let m = machine();
    let tun_cfg = Config {
        seed: 424242,
        proxy: String::new(),
        follow_machine: false,
        language: "en-US".into(),
        timezone: "America/New_York".into(),
        native_graphics: false,
    };
    profile::preferences(&root, &tun_cfg, &m).unwrap();

    let prefs_path = root.join("Default/Preferences");
    let ls_path = root.join("Local State");
    let prefs: serde_json::Value = serde_json::from_slice(&fs::read(&prefs_path).unwrap()).unwrap();
    assert_eq!(prefs["bookmarks"]["keep"], true);
    assert_eq!(prefs["alternate_error_pages"]["enabled"], false);
    assert_eq!(prefs["safebrowsing"]["enabled"], false);
    assert_eq!(prefs["safebrowsing"]["enhanced"], false);
    assert_eq!(prefs["proxy"]["mode"], "direct");

    let ls: serde_json::Value = serde_json::from_slice(&fs::read(&ls_path).unwrap()).unwrap();
    assert_eq!(ls["os_crypt"]["encrypted_key"], "keep-synthetic");
    assert_eq!(ls["dns_over_https"]["mode"], "off");
    assert_eq!(ls["ssl"]["rev_checking"]["enabled"], false);
    assert_eq!(ls["ssl"]["ech_enabled"], false);
    assert_eq!(ls["proxy"]["quick_check_enabled"], false);
    assert!(ls.get("variations_seed").is_none());
    assert!(ls.get("variations_compressed_seed").is_none());
    assert!(ls.get("user_experience_metrics").is_none());

    // Second unchanged call must skip write_json (mtime preserved).
    let prefs_mtime_1 = fs::metadata(&prefs_path).unwrap().modified().unwrap();
    let ls_mtime_1 = fs::metadata(&ls_path).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(30));
    profile::preferences(&root, &tun_cfg, &m).unwrap();
    assert_eq!(
        fs::metadata(&prefs_path).unwrap().modified().unwrap(),
        prefs_mtime_1,
        "Preferences rewrite should be skipped when unchanged"
    );
    assert_eq!(
        fs::metadata(&ls_path).unwrap().modified().unwrap(),
        ls_mtime_1,
        "Local State rewrite should be skipped when unchanged"
    );

    // Switching to explicit proxy removes stale proxy.mode="direct".
    let mut proxy_cfg = tun_cfg.clone();
    proxy_cfg.proxy = "socks5://127.0.0.1:7899".into();
    profile::preferences(&root, &proxy_cfg, &m).unwrap();
    let prefs2: serde_json::Value = serde_json::from_slice(&fs::read(&prefs_path).unwrap()).unwrap();
    assert!(prefs2.get("proxy").is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn site_data_clears_chromium_148_privacy_sandbox_and_wal_while_preserving_core_files() {
    let root = sample();
    for name in [
        "Default/InterestGroups/data",
        "Default/PrivateAggregation/data",
        "Default/AttributionReporting/data",
        "Default/Site Characteristics Database/data",
        "Default/QuotaManager/data",
        "Default/WebRTC Logs/log.txt",
        "Default/Network/Cookies-wal",
        "Default/Network/SCT Auditing/data",
        "Default/BrowsingTopicsState-wal",
        "Local State",
        "Default/Preferences",
        "Default/Web Data",
        "Default/History",
    ] {
        let p = root.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, b"fixture").unwrap();
    }
    profile::clear(&root, true, |_, _| {}).unwrap();
    for deleted in [
        "Default/InterestGroups",
        "Default/PrivateAggregation",
        "Default/AttributionReporting",
        "Default/Site Characteristics Database",
        "Default/QuotaManager",
        "Default/WebRTC Logs",
        "Default/Network/Cookies-wal",
        "Default/Network/SCT Auditing",
        "Default/BrowsingTopicsState-wal",
    ] {
        assert!(!root.join(deleted).exists(), "expected {deleted} cleared");
    }
    for kept in [
        "Local State",
        "Default/Preferences",
        "Default/Web Data",
        "Default/History",
    ] {
        assert_eq!(fs::read(root.join(kept)).unwrap(), b"fixture");
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restricted_host_proxy_probe_fails_closed_on_failure_and_recovers_on_fallback_url() {
    use std::io::{BufRead, BufReader, Write};
    let mut cn_machine = machine();
    cn_machine.timezone = "Asia/Shanghai".into();
    cn_machine.locale = "zh_CN".into();
    cn_machine.locale_country = "CN".into();
    cn_machine.languages = vec!["zh-CN".into()];

    // 1. Proxy returns 503 on restricted host with !allow_direct -> fail-closed Err
    let err_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let err_addr = err_listener.local_addr().unwrap();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = err_listener.accept() {
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                if line == "\r\n" {
                    break;
                }
                line.clear();
            }
            let _ = write!(
                stream,
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 3\r\nConnection: close\r\n\r\nerr"
            );
        }
    });
    let mut cfg = Config {
        seed: 777,
        proxy: format!("http://{err_addr}"),
        ..Config::default()
    };
    let res = config::evaluate_browser_launch_policy_with_urls(
        &cfg,
        &cn_machine,
        true,
        false,
        &["http://trace-fail.example.invalid/cdn-cgi/trace"],
    );
    assert!(
        res.is_err(),
        "restricted host must fail-closed when exit probe fails"
    );

    // 2. First URL hangs beyond 1800ms per-URL cap, second URL succeeds within 3200ms total budget
    let fb_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let fb_addr = fb_listener.local_addr().unwrap();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_srv = stop.clone();
    std::thread::spawn(move || {
        let mut req_idx = 0usize;
        while !stop_srv.load(std::sync::atomic::Ordering::Relaxed) {
            if let Ok((mut stream, _)) = fb_listener.accept() {
                req_idx += 1;
                if req_idx == 1 {
                    std::thread::spawn(move || {
                        let _ = stream;
                        std::thread::sleep(std::time::Duration::from_millis(2400));
                    });
                } else {
                    let mut reader = BufReader::new(&stream);
                    let mut line = String::new();
                    while reader.read_line(&mut line).unwrap_or(0) > 0 {
                        if line == "\r\n" {
                            break;
                        }
                        line.clear();
                    }
                    let body = "ip=198.51.100.99\nloc=US\n";
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                }
            }
        }
    });
    cfg.proxy = format!("http://{fb_addr}");
    let t0 = std::time::Instant::now();
    let fb_res = config::evaluate_browser_launch_policy_with_urls(
        &cfg,
        &cn_machine,
        true,
        false,
        &[
            "http://hung-first.example.invalid/cdn-cgi/trace",
            "http://fast-second.example.invalid/cdn-cgi/trace",
        ],
    );
    let elapsed = t0.elapsed();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = std::net::TcpStream::connect(fb_addr);
    assert!(
        fb_res.is_ok(),
        "per-URL 1800ms cap should allow fallback URL to succeed: {fb_res:?}"
    );
    assert!(
        elapsed < std::time::Duration::from_millis(3200),
        "fallback should complete within 3200ms budget, took {elapsed:?}"
    );
}

#[test]
fn slot_gate_serializes_active_slot_mutations_with_concurrent_profile_open() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    use std::time::Duration;

    let browser = Arc::new(Browser::default());
    let in_critical = Arc::new(AtomicUsize::new(0));
    let max_concurrent = Arc::new(AtomicUsize::new(0));
    let start = Arc::new(Barrier::new(3));

    let h1 = std::thread::spawn({
        let b = browser.clone();
        let cur = in_critical.clone();
        let max_c = max_concurrent.clone();
        let bar = start.clone();
        move || {
            bar.wait();
            b.with_slot_then_gate(
                || Ok("slot_a".to_string()),
                |slot| {
                    assert_eq!(slot, "slot_a");
                    let now = cur.fetch_add(1, Ordering::SeqCst) + 1;
                    max_c.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    cur.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .unwrap();
        }
    });

    let h2 = std::thread::spawn({
        let b = browser.clone();
        let cur = in_critical.clone();
        let max_c = max_concurrent.clone();
        let bar = start.clone();
        move || {
            bar.wait();
            let sg = b.slot_gate("slot_a");
            let _guard = sg.lock();
            let now = cur.fetch_add(1, Ordering::SeqCst) + 1;
            max_c.fetch_max(now, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(30));
            cur.fetch_sub(1, Ordering::SeqCst);
        }
    });

    start.wait();
    h1.join().unwrap();
    h2.join().unwrap();
    assert_eq!(max_concurrent.load(Ordering::SeqCst), 1);
}

#[test]
fn slot_gate_allows_concurrent_non_active_slot_and_non_blocking_gate_reads() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier, Condvar, Mutex,
    };
    use std::time::{Duration, Instant};

    // Subcase A: active slot_a mutation does not block concurrent non-active slot_b open
    let browser = Arc::new(Browser::default());
    let in_critical = Arc::new(AtomicUsize::new(0));
    let max_concurrent = Arc::new(AtomicUsize::new(0));
    let pair_sync = Arc::new((Mutex::new(0usize), Condvar::new()));

    let wait_both = |sync: &(Mutex<usize>, Condvar)| {
        let (lock, cv) = sync;
        let mut count = lock.lock().unwrap();
        *count += 1;
        cv.notify_all();
        let deadline = Instant::now() + Duration::from_secs(1);
        while *count < 2 {
            let rem = deadline.saturating_duration_since(Instant::now());
            assert!(
                !rem.is_zero(),
                "slot_a and slot_b failed to enter concurrently"
            );
            let (guard, res) = cv.wait_timeout(count, rem).unwrap();
            count = guard;
            assert!(!res.timed_out() || *count >= 2);
        }
    };

    let h_a = std::thread::spawn({
        let b = browser.clone();
        let cur = in_critical.clone();
        let max_c = max_concurrent.clone();
        let sync = pair_sync.clone();
        move || {
            b.with_slot_then_gate(
                || Ok("slot_a".to_string()),
                |_| {
                    let now = cur.fetch_add(1, Ordering::SeqCst) + 1;
                    max_c.fetch_max(now, Ordering::SeqCst);
                    wait_both(&sync);
                    cur.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .unwrap();
        }
    });

    let h_b = std::thread::spawn({
        let b = browser.clone();
        let cur = in_critical.clone();
        let max_c = max_concurrent.clone();
        let sync = pair_sync.clone();
        move || {
            let sg = b.slot_gate("slot_b");
            let _guard = sg.lock();
            let now = cur.fetch_add(1, Ordering::SeqCst) + 1;
            max_c.fetch_max(now, Ordering::SeqCst);
            wait_both(&sync);
            cur.fetch_sub(1, Ordering::SeqCst);
        }
    });

    h_a.join().unwrap();
    h_b.join().unwrap();
    assert_eq!(max_concurrent.load(Ordering::SeqCst), 2);

    // Subcase B: Phase 2 holding SlotGate(slot_a) without Browser::gate never blocks gate reads
    let phase2_entered = Arc::new(Barrier::new(2));
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let h_launch = std::thread::spawn({
        let b = browser.clone();
        let entered = phase2_entered.clone();
        move || {
            b.with_active_slot_gate(
                || Ok("slot_a".to_string()),
                |_, gate| {
                    {
                        let _g = gate.lock().unwrap();
                    }
                    entered.wait();
                    let _ = rx.recv_timeout(Duration::from_secs(2));
                    let _g = gate.lock().unwrap();
                    Ok((true, ()))
                },
            )
            .unwrap();
        }
    });

    phase2_entered.wait();
    let t0 = Instant::now();
    {
        let _gate_guard = browser.gate.lock().unwrap();
    }
    let gate_wait = t0.elapsed();
    let _ = tx.send(());
    h_launch.join().unwrap();
    assert!(
        gate_wait < Duration::from_millis(100),
        "Browser::gate read blocked during Phase 2 SlotGate hold: {gate_wait:?}"
    );
}

#[test]
fn global_lock_order_stress_prevents_ab_ba_deadlock_across_slot_switches() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use std::time::Duration;

    const RETRY_EXHAUSTED_ERR: &str = "浏览器身份仍在切换，请重试。";

    let browser = Arc::new(Browser::default());
    let active_slot = Arc::new(Mutex::new("slot_a".to_string()));
    let (done_tx, done_rx) = std::sync::mpsc::channel::<usize>();
    let rounds = 200usize;

    let t1_stats = Arc::new((AtomicUsize::new(0), AtomicUsize::new(0)));
    let t4_stats = Arc::new((AtomicUsize::new(0), AtomicUsize::new(0)));
    let t7_stats = Arc::new((AtomicUsize::new(0), AtomicUsize::new(0)));

    let mut handles = Vec::new();

    // 1. with_slot_then_gate (browser_save / browser_clear style)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let active = active_slot.clone();
        let tx = done_tx.clone();
        let stats = t1_stats.clone();
        move || {
            for _ in 0..rounds {
                match b.with_slot_then_gate(
                    || Ok(active.lock().unwrap().clone()),
                    |slot| {
                        assert_eq!(slot, active.lock().unwrap().as_str());
                        Ok(())
                    },
                ) {
                    Ok(()) => {
                        stats.0.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) if err == RETRY_EXHAUSTED_ERR => {
                        stats.1.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) => panic!("with_slot_then_gate unexpected error: {err}"),
                }
            }
            tx.send(1).unwrap();
        }
    }));

    // 2. slot_gate("slot_a") only (browser_open_identity_profile A)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let tx = done_tx.clone();
        move || {
            for _ in 0..rounds {
                let sg = b.slot_gate("slot_a");
                let _g = sg.lock();
            }
            tx.send(2).unwrap();
        }
    }));

    // 3. slot_gate("slot_b") -> drop -> gate (browser_open_usage B)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let tx = done_tx.clone();
        move || {
            for _ in 0..rounds {
                {
                    let sg = b.slot_gate("slot_b");
                    let _g = sg.lock();
                }
                let _gate = b.gate.lock().unwrap();
            }
            tx.send(3).unwrap();
        }
    }));

    // 4. with_slots_then_gate flipping active slot_a <-> slot_b (browser_return_to_cli)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let active = active_slot.clone();
        let tx = done_tx.clone();
        let stats = t4_stats.clone();
        move || {
            for _ in 0..rounds {
                match b.with_slots_then_gate(
                    || {
                        let cur = active.lock().unwrap().clone();
                        let other = if cur == "slot_a" {
                            "slot_b".to_string()
                        } else {
                            "slot_a".to_string()
                        };
                        Ok(vec![cur, other])
                    },
                    || {
                        let mut cur = active.lock().unwrap();
                        *cur = if *cur == "slot_a" {
                            "slot_b".to_string()
                        } else {
                            "slot_a".to_string()
                        };
                        Ok(())
                    },
                ) {
                    Ok(()) => {
                        stats.0.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) if err == RETRY_EXHAUSTED_ERR => {
                        stats.1.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) => panic!("with_slots_then_gate unexpected error: {err}"),
                }
            }
            tx.send(4).unwrap();
        }
    }));

    // 5. gate only (M2 workspaces / quota_bridge / kill_switch)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let tx = done_tx.clone();
        move || {
            for _ in 0..rounds {
                let _gate = b.gate.lock().unwrap();
            }
            tx.send(5).unwrap();
        }
    }));

    // 6. gate(read) -> drop -> slot_gate -> drop -> gate (browser_quit)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let active = active_slot.clone();
        let tx = done_tx.clone();
        move || {
            for _ in 0..rounds {
                let slot = {
                    let _gate = b.gate.lock().unwrap();
                    active.lock().unwrap().clone()
                };
                {
                    let sg = b.slot_gate(&slot);
                    let _g = sg.lock();
                }
                let _gate = b.gate.lock().unwrap();
            }
            tx.send(6).unwrap();
        }
    }));

    // 7. with_active_slot_gate two-phase lock (browser_launch style:
    //    Phase 1 gate -> drop gate keeping SlotGate -> Phase 2 yield -> re-acquire gate)
    handles.push(std::thread::spawn({
        let b = browser.clone();
        let active = active_slot.clone();
        let tx = done_tx.clone();
        let stats = t7_stats.clone();
        move || {
            for _ in 0..rounds {
                match b.with_active_slot_gate(
                    || Ok(active.lock().unwrap().clone()),
                    |slot, gate| {
                        {
                            let _gate = gate.lock().unwrap();
                            if active.lock().unwrap().as_str() != slot {
                                return Ok((false, ()));
                            }
                        }
                        std::thread::yield_now();
                        {
                            let _gate = gate.lock().unwrap();
                            assert_eq!(slot, active.lock().unwrap().as_str());
                        }
                        Ok((true, ()))
                    },
                ) {
                    Ok(()) => {
                        stats.0.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) if err == RETRY_EXHAUSTED_ERR => {
                        stats.1.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(err) => panic!("with_active_slot_gate unexpected error: {err}"),
                }
            }
            tx.send(7).unwrap();
        }
    }));

    drop(done_tx);
    for _ in 0..handles.len() {
        done_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("global lock order stress test deadlocked");
    }
    for h in handles {
        h.join().unwrap();
    }

    let (t1_ok, t1_retry) = (
        t1_stats.0.load(Ordering::Relaxed),
        t1_stats.1.load(Ordering::Relaxed),
    );
    let (t4_ok, t4_retry) = (
        t4_stats.0.load(Ordering::Relaxed),
        t4_stats.1.load(Ordering::Relaxed),
    );
    let (t7_ok, t7_retry) = (
        t7_stats.0.load(Ordering::Relaxed),
        t7_stats.1.load(Ordering::Relaxed),
    );
    assert_eq!(t1_ok + t1_retry, rounds);
    assert_eq!(t4_ok + t4_retry, rounds);
    assert_eq!(t7_ok + t7_retry, rounds);
    assert!(
        t1_ok > 0,
        "with_slot_then_gate made no forward progress (retry_exhausted={t1_retry})"
    );
    assert!(
        t4_ok > 0,
        "with_slots_then_gate made no forward progress (retry_exhausted={t4_retry})"
    );
    assert!(
        t7_ok > 0,
        "with_active_slot_gate made no forward progress (retry_exhausted={t7_retry})"
    );

    let final_active = active_slot.lock().unwrap().clone();
    assert!(final_active == "slot_a" || final_active == "slot_b");
}

#[test]
fn launch_snapshot_bridge_drift_and_singleton_lock_junction_rejected() {
    let fixture = sample();
    let root = fixture.join("browser");
    let scope = root.join("contexts").join("0123456789abcdef0123456789abcdef");
    let profile = scope.join("profile");
    crate::identities::private::directory(&profile).unwrap();

    let mut cfg = config::Config::default();
    cfg.seed = 9999;
    let machine = config::Machine {
        platform: "Win32".into(),
        version: "10.0.22631".into(),
        cores: 8,
        timezone: "America/New_York".into(),
        languages: vec!["en-US".into()],
        locale: "en-US".into(),
        locale_country: "US".into(),
        location_enabled: Some(false),
        timezones: vec!["America/New_York".into()],
        system_proxy: String::new(),
    };
    let snap_plain = LaunchRuntimeSnapshot::from_config_with_options(
        &cfg,
        &machine,
        config::LaunchOptions::for_purpose(config::LaunchPurpose::BrowseClaudeAi),
    );
    let snap_bridge = LaunchRuntimeSnapshot::from_config_with_options(
        &cfg,
        &machine,
        config::LaunchOptions::for_purpose(config::LaunchPurpose::QuotaSync),
    );
    assert!(!snap_plain.enable_quota_bridge);
    assert!(snap_bridge.enable_quota_bridge);
    assert_ne!(snap_plain, snap_bridge);

    // Safe stale lockfile is accepted by prepare_slot_singleton_for_launch.
    let lockfile = profile.join("lockfile");
    crate::identities::private::write(&lockfile, b"stale").unwrap();
    super::launch::prepare_slot_singleton_for_launch(&root, &profile).unwrap();

    // Junction/symlink SingletonLock must be rejected before launch.
    let target_dir = fixture.join("outside-target");
    std::fs::create_dir_all(&target_dir).unwrap();
    let singleton = profile.join("SingletonLock");
    #[cfg(windows)]
    {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&singleton)
            .arg(&target_dir)
            .status()
            .unwrap();
        assert!(status.success());
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target_dir, &singleton).unwrap();

    let err = super::launch::prepare_slot_singleton_for_launch(&root, &profile).unwrap_err();
    assert!(err.contains("单例锁"));

    #[cfg(windows)]
    let _ = std::fs::remove_dir(&singleton);
    #[cfg(unix)]
    let _ = std::fs::remove_file(&singleton);
    std::fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn chromium_proxy_arg_normalizes_mixed_case_schemes_and_rewrites_socks5h() {
    let m = machine();
    for (raw, expected) in [
        ("SOCKS5H://127.0.0.1:7899", "--proxy-server=socks5://127.0.0.1:7899"),
        ("SOCKS5H://127.0.0.1:7899/", "--proxy-server=socks5://127.0.0.1:7899"),
        ("Socks5h://[::1]:7899", "--proxy-server=socks5://[::1]:7899"),
        ("SOCKS5://127.0.0.1:7899", "--proxy-server=socks5://127.0.0.1:7899"),
        ("socks5://127.0.0.1:7899/", "--proxy-server=socks5://127.0.0.1:7899"),
        ("HTTP://127.0.0.1:7897", "--proxy-server=http://127.0.0.1:7897"),
        ("http://127.0.0.1:7899/", "--proxy-server=http://127.0.0.1:7899"),
        ("  HTTP://127.0.0.1:7899/  ", "--proxy-server=http://127.0.0.1:7899"),
        ("HTTPS://proxy.example.com:443", "--proxy-server=https://proxy.example.com:443"),
        ("https://127.0.0.1:7899/", "--proxy-server=https://127.0.0.1:7899"),
    ] {
        assert!(config::proxy(raw).unwrap().is_some(), "proxy validation rejected {raw}");
        let mut cfg = config::Config::default();
        cfg.proxy = raw.into();
        let args = config::arguments_with_options(
            &cfg,
            &m,
            Path::new("/profile"),
            "about:blank",
            "148.0.0.0",
            config::LaunchOptions::for_purpose(config::LaunchPurpose::BrowseClaudeAi),
        );
        assert!(
            args.contains(&expected.to_string()),
            "expected {expected} in {args:?} for input {raw}"
        );
        assert!(
            args.iter().any(|arg| arg.starts_with("--host-resolver-rules=")),
            "expected --host-resolver-rules for {raw}: {args:?}"
        );
    }
}

#[test]
fn utf8_multibyte_inputs_do_not_panic_in_proxy_mask_or_asn_parsers() {
    assert_eq!(
        config::normalize_reqwest_proxy("socks5:\u{4e2d}"),
        "socks5:\u{4e2d}"
    );
    assert_eq!(
        config::normalize_reqwest_proxy("socks4:\u{4e2d}"),
        "socks4:\u{4e2d}"
    );
    assert_eq!(mask_email("a\u{7528}@example.com"), "a***@example.com");
    assert_eq!(mask_email("\u{7528}@example.com"), "*@example.com");
    assert_eq!(
        mask_email("\u{7528}\u{6237}\u{540d}\u{5b57}@example.com"),
        "\u{7528}\u{6237}***@example.com"
    );
    let parsed = network::parse(&serde_json::json!({
        "ip": "1.2.3.4",
        "country": "US",
        "asn": "\u{4e2d}",
        "org": "\u{4e2d}\u{6587} ISP"
    }))
    .unwrap();
    assert_eq!(parsed.asn.as_deref(), Some("AS\u{4e2d}"));
}
