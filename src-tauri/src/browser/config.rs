// [INPUT]: 原生机器快照、独立浏览器配置和实际引擎版本。
// [OUTPUT]: 含有效国家的机器快照、独立目标地区与 Default 资料参数；所有显式代理统一锁定远程 DNS 规则与回环正向豁免、reqwest 代理远程 DNS 归一化（socks5h/socks4a）、本机回环代理 300ms TCP 预检及启动前受限主机直连阻断与 60s 缓存出口国家门禁。
// [POS]: 浏览器配置真相源；路径来自宿主，输入不能变成额外命令参数。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#[cfg(target_os = "linux")]
use crate::linux::*;
use crate::native::decode;
#[cfg(target_os = "windows")]
use crate::windows::*;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::ffi::c_char;
use std::path::Path;
#[cfg(target_os = "macos")]
extern "C" {
    fn rf_browser_machine() -> *mut c_char;
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Machine {
    pub platform: String,
    pub version: String,
    pub cores: u32,
    pub timezone: String,
    pub languages: Vec<String>,
    pub locale: String,
    #[serde(default)]
    pub locale_country: String,
    pub location_enabled: Option<bool>,
    pub timezones: Vec<String>,
    #[serde(skip_serializing)]
    pub system_proxy: String,
}
pub fn machine() -> Result<Machine, String> {
    let mut machine: Machine = decode(unsafe { rf_browser_machine() })?;
    if machine.locale_country.is_empty() {
        machine.locale_country =
            crate::regions::locale_country(&machine.locale).unwrap_or_default();
    }
    Ok(machine)
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub seed: u32,
    pub proxy: String,
    pub follow_machine: bool,
    pub language: String,
    pub timezone: String,
    pub native_graphics: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            seed: 495574189,
            proxy: String::new(),
            follow_machine: true,
            language: "en-US".into(),
            timezone: "America/New_York".into(),
            native_graphics: true,
        }
    }
}
impl Config {
    pub fn region(&self, machine: &Machine) -> Option<&'static crate::regions::Region> {
        if self.follow_machine {
            crate::regions::matching_country(&machine.locale_country, &machine.timezone)
        } else {
            crate::regions::matching(&self.language, &self.timezone)
        }
    }
    pub fn language(&self, machine: &Machine) -> String {
        if self.follow_machine {
            let first = machine
                .languages
                .first()
                .map(String::as_str)
                .unwrap_or("en-US");
            if first == "en" {
                "en-US".into()
            } else {
                first.to_string()
            }
        } else {
            self.language.clone()
        }
    }
    pub fn timezone(&self, machine: &Machine) -> String {
        if self.follow_machine {
            machine.timezone.clone()
        } else {
            self.timezone.clone()
        }
    }
    pub fn validate(&self, machine: &Machine) -> Result<(), String> {
        if self.seed == 0 {
            return Err("指纹种子必须是 1–4294967295 的整数。".into());
        }
        proxy(&self.proxy)?;
        if ![
            "en-US", "en-CA", "en-GB", "en-SG", "en-AU", "en", "zh-Hans", "zh-Hant", "fr", "de",
            "es", "it", "ja", "ko",
        ]
        .contains(&self.language.as_str())
            || !machine.timezones.contains(&self.timezone)
        {
            return Err("语言或时区无效。".into());
        }
        Ok(())
    }
}
pub fn proxy(value: &str) -> Result<Option<reqwest::Url>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let url = reqwest::Url::parse(value).map_err(|_| "代理地址格式无效。")?;
    if !["http", "https", "socks5", "socks5h"].contains(&url.scheme())
        || url.host_str().is_none()
        || url.port_or_known_default().unwrap_or(0) == 0
        || !url_has_explicit_port(value)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !["", "/"].contains(&url.path())
    {
        return Err("填写 http、https 或 socks5 代理主机与端口；带密码代理请交给本机 Clash，不在本软件保存凭据。".into());
    }
    Ok(Some(url))
}
// URL 会将 http:80 / https:443 归一化为 port() == None；原始 authority 仍须显式携带数字端口。
fn url_has_explicit_port(value: &str) -> bool {
    let Some((_, rest)) = value.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    let after_host = if let Some(rest) = hostport.strip_prefix('[') {
        match rest.split_once(']') {
            Some((_, after)) => after,
            None => return false,
        }
    } else {
        match hostport.rfind(':') {
            Some(index) => &hostport[index..],
            None => return false,
        }
    };
    let Some(port) = after_host.strip_prefix(':') else {
        return false;
    };
    !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit())
}
pub fn load(root: &Path) -> Result<Config, String> {
    match std::fs::read(root.join("config.json")) {
        Ok(data) => {
            serde_json::from_slice(&data).map_err(|_| "浏览器配置损坏，未使用默认值覆盖。".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(_) => Err("无法读取浏览器配置。".into()),
    }
}
pub fn save(root: &Path, config: &Config) -> Result<(), String> {
    super::profile::check_path(root, &root.join("config.json"))?;
    crate::identities::private::directory(root)?;
    crate::identities::private::write(
        &root.join("config.json"),
        &serde_json::to_vec_pretty(config).map_err(|_| "配置编码失败。")?,
    )
}
pub(super) fn accept_languages(language: &str) -> String {
    match language.split_once('-') {
        Some((primary, _)) if !primary.is_empty() && primary != language => {
            format!("{language},{primary}")
        }
        _ => language.to_string(),
    }
}
pub fn arguments(
    config: &Config,
    machine: &Machine,
    profile: &Path,
    page: &str,
    version: &str,
) -> Vec<String> {
    let language = config.language(machine);
    let mut args = vec![
        format!("--user-data-dir={}", profile.display()),
        "--profile-directory=Default".into(),
        format!("--fingerprint={}", config.seed),
        format!("--fingerprint-platform={}", machine.platform),
        format!("--fingerprint-platform-version={}", machine.version),
        "--fingerprint-brand=Chrome".into(),
        format!("--fingerprint-brand-version={version}"),
        format!("--fingerprint-hardware-concurrency={}", machine.cores),
        format!("--lang={language}"),
        format!("--accept-lang={}", accept_languages(&language)),
        format!("--timezone={}", config.timezone(machine)),
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp".into(),
        "--disable-non-proxied-udp".into(),
        "--enforce-webrtc-ip-permission-check".into(),
        "--disable-quic".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        format!(
            "--disable-spoofing={}",
            if config.native_graphics {
                "font,audio,gpu,canvas,clientrects"
            } else {
                "font,audio,gpu"
            }
        ),
    ];
    if !config.proxy.is_empty() {
        args.push(format!(
            "--proxy-server={}",
            config.proxy.replace("socks5h://", "socks5://")
        ));
        // 不使用 <-loopback>：它会减去隐式回环豁免，不能把带令牌的本地页面交给代理。
        args.push("--proxy-bypass-list=127.0.0.1;localhost;[::1]".into());
        if let Ok(Some(url)) = proxy(&config.proxy) {
            let host = url.host_str().unwrap().trim_matches(['[', ']']);
            let mut excludes = Vec::with_capacity(4);
            excludes.push(format!("EXCLUDE {host}"));
            for loopback in ["127.0.0.1", "localhost", "::1"] {
                if !host.eq_ignore_ascii_case(loopback) {
                    excludes.push(format!("EXCLUDE {loopback}"));
                }
            }
            args.push(format!(
                "--host-resolver-rules=MAP * ~NOTFOUND, {}",
                excludes.join(", ")
            ));
            args.push("--test-type".into());
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(extension) = quota_bridge_extension() {
        args.push(format!("--load-extension={}", extension.display()));
    }
    args.push(page.into());
    args
}

pub(crate) fn normalize_reqwest_proxy(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 9 && trimmed[..9].eq_ignore_ascii_case("socks5://") {
        format!("socks5h://{}", &trimmed[9..])
    } else if trimmed.len() >= 9 && trimmed[..9].eq_ignore_ascii_case("socks4://") {
        format!("socks4a://{}", &trimmed[9..])
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn preflight_loopback_proxy_with_flag(
    raw: &str,
    force_check: bool,
) -> Result<(), String> {
    if !force_check
        && (cfg!(test)
            || std::env::var("CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT")
                .ok()
                .as_deref()
                == Some("1"))
    {
        return Ok(());
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let Some(url) = proxy(trimmed)? else {
        return Ok(());
    };
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    let Some(port) = url.port_or_known_default() else {
        return Ok(());
    };
    let timeout = std::time::Duration::from_millis(300);
    let reachable = if host == "127.0.0.1" {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            timeout,
        )
        .is_ok()
    } else if host == "::1" {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
            timeout,
        )
        .is_ok()
    } else if host.eq_ignore_ascii_case("localhost") {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            std::time::Duration::from_millis(200),
        )
        .is_ok()
            || std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
                std::time::Duration::from_millis(150),
            )
            .is_ok()
    } else {
        return Ok(());
    };
    if reachable {
        Ok(())
    } else {
        Err(format!("本机代理端口不可达 ({host}:{port})，请确认 Clash / Mihomo 已启动。"))
    }
}

pub(crate) fn preflight_loopback_proxy(raw: &str) -> Result<(), String> {
    preflight_loopback_proxy_with_flag(raw, false)
}

const EXIT_TRACE_URLS: [&str; 2] = [
    "https://www.cloudflare.com/cdn-cgi/trace",
    "https://1.1.1.1/cdn-cgi/trace",
];
const EXIT_COUNTRY_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

static EXIT_COUNTRY_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, String)>>,
> = std::sync::OnceLock::new();

pub(crate) fn machine_is_restricted_region(machine: &Machine) -> bool {
    if crate::regions::is_unsupported_exit_country(&machine.locale_country) {
        return true;
    }
    if crate::regions::locale_country(&machine.locale)
        .is_some_and(|cc| crate::regions::is_unsupported_exit_country(&cc))
    {
        return true;
    }
    if crate::regions::timezone_country(&machine.timezone)
        .is_some_and(crate::regions::is_unsupported_exit_country)
    {
        return true;
    }
    machine.languages.iter().take(2).any(|lang| {
        let low = lang.trim().to_ascii_lowercase();
        low.starts_with("zh-cn")
            || low.starts_with("zh_cn")
            || low.starts_with("zh-hk")
            || low.starts_with("zh_hk")
            || low.starts_with("zh-mo")
            || low.starts_with("zh_mo")
            || low.starts_with("ru-ru")
            || low.starts_with("ru_ru")
    })
}

fn parse_trace_loc(body: &str) -> Option<String> {
    for line in body.lines().take(64) {
        if let Some((k, v)) = line.trim().split_once('=') {
            if k == "loc" {
                let cc = v.trim();
                if cc.len() == 2 && cc.bytes().all(|b| b.is_ascii_alphabetic()) {
                    return Some(cc.to_ascii_uppercase());
                }
            }
        }
    }
    None
}

fn probe_proxy_exit_country_blocking(normalized_proxy: &str, urls: &[&str]) -> Option<String> {
    let proxy_owned = normalized_proxy.to_string();
    let urls_owned: Vec<String> = urls.iter().map(|u| (*u).to_string()).collect();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .ok()?;
        rt.block_on(async move {
            let req_proxy = reqwest::Proxy::all(&proxy_owned).ok()?;
            let client = reqwest::Client::builder()
                .no_proxy()
                .proxy(req_proxy)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_millis(2000))
                .timeout(std::time::Duration::from_millis(3500))
                .user_agent("Claude-Local-ExitGuard/1.0")
                .build()
                .ok()?;
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(3500);
            for url in &urls_owned {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let Ok(Ok(resp)) = tokio::time::timeout(remaining, client.get(url).send()).await
                else {
                    continue;
                };
                if !resp.status().is_success() {
                    continue;
                }
                let rem_body = deadline.saturating_duration_since(tokio::time::Instant::now());
                if rem_body.is_zero() {
                    break;
                }
                let Ok(Ok(bytes)) = tokio::time::timeout(rem_body, resp.bytes()).await else {
                    continue;
                };
                if bytes.len() > 8192 {
                    continue;
                }
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    if let Some(loc) = parse_trace_loc(text) {
                        return Some(loc);
                    }
                }
            }
            None
        })
    })
    .join()
    .ok()
    .flatten()
}

pub(crate) fn evaluate_browser_launch_policy_with_urls(
    config: &Config,
    machine: &Machine,
    check_upstream_exit: bool,
    allow_direct: bool,
    trace_urls: &[&str],
) -> Result<(), String> {
    let trimmed = config.proxy.trim();
    if trimmed.is_empty() {
        if machine_is_restricted_region(machine) && !allow_direct {
            return Err("browser.error.proxyRequiredOnRestrictedHost".into());
        }
        return Ok(());
    }
    if !check_upstream_exit || trace_urls.is_empty() {
        return Ok(());
    }
    let normalized = normalize_reqwest_proxy(trimmed);
    let cache = EXIT_COUNTRY_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        if let Some((at, cc)) = guard.get(&normalized) {
            if at.elapsed() < EXIT_COUNTRY_CACHE_TTL {
                if crate::regions::is_unsupported_exit_country(cc) {
                    guard.remove(&normalized);
                    return Err("browser.error.unsupportedExitCountry".into());
                }
                return Ok(());
            }
            guard.remove(&normalized);
        }
    }
    if let Some(loc) = probe_proxy_exit_country_blocking(&normalized, trace_urls) {
        if crate::regions::is_unsupported_exit_country(&loc) {
            if let Ok(mut guard) = cache.lock() {
                guard.remove(&normalized);
            }
            return Err("browser.error.unsupportedExitCountry".into());
        }
        if let Ok(mut guard) = cache.lock() {
            if guard.len() >= 64 {
                guard.retain(|_, (at, _)| at.elapsed() < EXIT_COUNTRY_CACHE_TTL);
            }
            guard.insert(normalized, (std::time::Instant::now(), loc));
        }
    }
    Ok(())
}

pub(crate) fn preflight_browser_launch_policy(
    config: &Config,
    machine: &Machine,
    check_upstream_exit: bool,
) -> Result<(), String> {
    preflight_loopback_proxy(&config.proxy)?;
    if cfg!(test)
        || std::env::var("CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT")
            .ok()
            .as_deref()
            == Some("1")
    {
        return Ok(());
    }
    let allow_direct = std::env::var("CLAUDE_LOCAL_ALLOW_DIRECT")
        .ok()
        .as_deref()
        == Some("1");
    evaluate_browser_launch_policy_with_urls(
        config,
        machine,
        check_upstream_exit,
        allow_direct,
        &EXIT_TRACE_URLS,
    )
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn reqwest_proxy_upgrades_socks5_and_socks4_to_remote_dns() {
        assert_eq!(
            normalize_reqwest_proxy("socks5://127.0.0.1:7899"),
            "socks5h://127.0.0.1:7899"
        );
        assert_eq!(
            normalize_reqwest_proxy("  SOCKS5://[::1]:7899 "),
            "socks5h://[::1]:7899"
        );
        assert_eq!(
            normalize_reqwest_proxy("socks4://127.0.0.1:1080"),
            "socks4a://127.0.0.1:1080"
        );
        assert_eq!(
            normalize_reqwest_proxy("socks5h://127.0.0.1:7899"),
            "socks5h://127.0.0.1:7899"
        );
        assert_eq!(
            normalize_reqwest_proxy("http://127.0.0.1:7899"),
            "http://127.0.0.1:7899"
        );
    }

    #[test]
    fn loopback_http_proxy_locks_chromium_host_resolver_and_preflights_tcp() {
        let m = Machine {
            platform: "windows".into(),
            version: "10.0".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en_US".into(),
            locale_country: "US".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into()],
            system_proxy: String::new(),
        };
        let mut cfg = Config::default();
        cfg.proxy = "http://127.0.0.1:7899".into();
        let args = arguments(&cfg, &m, Path::new("/profile"), "about:blank", "148.0.0.0");
        assert!(args.contains(
            &"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1".into()
        ));

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(preflight_loopback_proxy_with_flag(&format!("socks5://127.0.0.1:{port}"), true).is_ok());
        drop(listener);
        assert!(preflight_loopback_proxy_with_flag(&format!("socks5://127.0.0.1:{port}"), true).is_err());
    }

    #[test]
    fn explicit_http_and_https_proxies_also_lock_host_resolver_and_empty_skips() {
        let m = Machine {
            platform: "windows".into(),
            version: "10.0".into(),
            cores: 8,
            timezone: "America/New_York".into(),
            languages: vec!["en-US".into()],
            locale: "en_US".into(),
            locale_country: "US".into(),
            location_enabled: Some(false),
            timezones: vec!["America/New_York".into()],
            system_proxy: String::new(),
        };
        let mut cfg = Config::default();
        cfg.proxy = "http://192.168.1.10:7890".into();
        let lan_args = arguments(&cfg, &m, Path::new("/profile"), "about:blank", "148.0.0.0");
        assert!(lan_args.contains(
            &"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 192.168.1.10, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1".into()
        ));
        assert!(lan_args.contains(&"--test-type".into()));

        cfg.proxy = "https://proxy.example.com:443".into();
        let https_args = arguments(&cfg, &m, Path::new("/profile"), "about:blank", "148.0.0.0");
        assert!(https_args.contains(
            &"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE proxy.example.com, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ::1".into()
        ));
        assert!(https_args.contains(&"--test-type".into()));

        cfg.proxy.clear();
        let direct_args = arguments(&cfg, &m, Path::new("/profile"), "about:blank", "148.0.0.0");
        assert!(!direct_args.iter().any(|arg| arg.starts_with("--host-resolver-rules=")));
        assert!(!direct_args.contains(&"--test-type".into()));
    }
}

#[cfg(target_os = "windows")]
fn quota_bridge_extension() -> Option<std::path::PathBuf> {
    let installed = std::env::current_exe()
        .ok()?
        .parent()?
        .join("browser-runtime/quota-bridge");
    if installed.join("manifest.json").is_file() {
        return Some(installed);
    }
    if cfg!(debug_assertions) {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/quota-bridge");
        if source.join("manifest.json").is_file() {
            return Some(source);
        }
    }
    None
}
