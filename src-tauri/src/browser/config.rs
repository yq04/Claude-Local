// [INPUT]: 原生机器快照、独立浏览器配置、LaunchPurpose/LaunchOptions 与实际引擎版本。
// [OUTPUT]: 含有效国家的机器快照、持久化非零种子补全、默认开启指纹伪装与派生屏幕档案、Chromium 148 防卡死/防泄露启动参数（含大小写与尾部 `/` 规范化 `--proxy-server`、`socks5h`->`socks5` 重写及 UTF-8 安全前缀匹配）、复用连接池与 Tokio 运行时的出口国家门禁（受限主机强绑定代理 fail-closed）及阻塞探针桥接。
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
            seed: 0,
            proxy: String::new(),
            follow_machine: true,
            language: "en-US".into(),
            timezone: "America/New_York".into(),
            native_graphics: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchPurpose {
    BrowseClaudeAi,
    QuotaSync,
    OAuth,
    Verification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchOptions {
    pub purpose: LaunchPurpose,
    pub enable_quota_bridge: bool,
}

impl LaunchOptions {
    pub const fn legacy_default() -> Self {
        Self {
            purpose: LaunchPurpose::QuotaSync,
            enable_quota_bridge: true,
        }
    }

    pub const fn for_purpose(purpose: LaunchPurpose) -> Self {
        Self {
            purpose,
            enable_quota_bridge: matches!(purpose, LaunchPurpose::QuotaSync),
        }
    }
}

pub(crate) fn random_seed() -> Result<u32, String> {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    for _ in 0..8 {
        let mut bytes = [0u8; 4];
        rng.fill(&mut bytes).map_err(|_| "无法生成指纹种子。")?;
        let value = u32::from_le_bytes(bytes);
        if value > 0 {
            return Ok(value);
        }
    }
    Ok(crate::identities::browser_link::seed("legacy", 0).max(1))
}

pub(crate) fn ensure_persisted_seed(
    scope: &Path,
    db_seed: Option<u32>,
    config: &mut Config,
) -> Result<(), String> {
    if config.seed > 0 {
        return Ok(());
    }
    config.seed = match db_seed.filter(|&s| s > 0) {
        Some(seed) => seed,
        None => random_seed()?,
    };
    save(scope, config)
}

fn virtual_screen_preset(seed: u32, platform: &str) -> (u32, u32, u32) {
    if platform.eq_ignore_ascii_case("macos") {
        const MAC_PRESETS: [(u32, u32, u32); 4] = [
            (1440, 900, 2),
            (1680, 1050, 2),
            (1920, 1080, 2),
            (2560, 1600, 2),
        ];
        MAC_PRESETS[(seed as usize) % MAC_PRESETS.len()]
    } else {
        const DESKTOP_PRESETS: [(u32, u32, u32); 4] = [
            (1920, 1080, 1),
            (2560, 1440, 1),
            (1920, 1200, 1),
            (1680, 1050, 1),
        ];
        DESKTOP_PRESETS[(seed as usize) % DESKTOP_PRESETS.len()]
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
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let url = reqwest::Url::parse(trimmed).map_err(|_| "代理地址格式无效。")?;
    if !["http", "https", "socks5", "socks5h"].contains(&url.scheme())
        || url.host_str().is_none()
        || url.port_or_known_default().unwrap_or(0) == 0
        || !url_has_explicit_port(trimmed)
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
#[cfg(test)]
pub fn arguments(
    config: &Config,
    machine: &Machine,
    profile: &Path,
    page: &str,
    version: &str,
) -> Vec<String> {
    arguments_with_options(
        config,
        machine,
        profile,
        page,
        version,
        LaunchOptions::legacy_default(),
    )
}

pub fn arguments_with_options(
    config: &Config,
    machine: &Machine,
    profile: &Path,
    page: &str,
    version: &str,
    options: LaunchOptions,
) -> Vec<String> {
    let language = config.language(machine);
    let allow_ipv6 = std::env::var("CLAUDE_LOCAL_ALLOW_IPV6").ok().as_deref() == Some("1");
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
        "--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability".into(),
        "--disable-background-networking".into(),
        "--disable-component-update".into(),
        "--no-pings".into(),
        "--disable-sync".into(),
        "--disable-default-apps".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
    ];
    if !allow_ipv6 {
        args.push("--set-ipv6-probe-false".into());
    }
    if config.native_graphics {
        args.push("--disable-spoofing=font,audio,gpu,canvas,clientrects".into());
    } else if config.seed > 0 {
        let (width, height, scale) = virtual_screen_preset(config.seed, &machine.platform);
        args.push(format!("--fingerprint-screen-width={width}"));
        args.push(format!("--fingerprint-screen-height={height}"));
        args.push(format!("--fingerprint-device-scale-factor={scale}"));
    }
    if !config.proxy.trim().is_empty() {
        args.push(format!(
            "--proxy-server={}",
            normalize_chromium_proxy_arg(&config.proxy)
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
    } else {
        args.push("--no-proxy-server".into());
    }
    #[cfg(target_os = "windows")]
    if options.enable_quota_bridge {
        if let Some(extension) = quota_bridge_extension() {
            args.push(format!("--load-extension={}", extension.display()));
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = options;
    args.push(page.into());
    args
}

pub(crate) fn strip_prefix_ascii_ci<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    value
        .get(..prefix.len())
        .filter(|head| head.eq_ignore_ascii_case(prefix))
        .map(|_| &value[prefix.len()..])
}

pub(crate) fn normalize_chromium_proxy_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some((scheme, rest)) = trimmed.split_once("://") {
        let lower_scheme = scheme.to_ascii_lowercase();
        let chromium_scheme = if lower_scheme == "socks5h" {
            "socks5"
        } else {
            lower_scheme.as_str()
        };
        let clean_rest = rest.trim().trim_end_matches('/');
        format!("{chromium_scheme}://{clean_rest}")
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn normalize_reqwest_proxy(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = strip_prefix_ascii_ci(trimmed, "socks5://") {
        format!("socks5h://{rest}")
    } else if let Some(rest) = strip_prefix_ascii_ci(trimmed, "socks4://") {
        format!("socks4a://{rest}")
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
    "https://1.1.1.1/cdn-cgi/trace",
    "https://www.cloudflare.com/cdn-cgi/trace",
];
const EXIT_COUNTRY_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);
const EXIT_CLIENT_POOL_TTL: std::time::Duration = std::time::Duration::from_secs(600);
const EXIT_CLIENT_POOL_MAX: usize = 16;
const EXIT_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1200);
const EXIT_URL_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1800);
const EXIT_TOTAL_BUDGET: std::time::Duration = std::time::Duration::from_millis(3200);

static EXIT_COUNTRY_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, String)>>,
> = std::sync::OnceLock::new();

static EXIT_CLIENT_POOL: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, reqwest::Client)>>,
> = std::sync::OnceLock::new();

static EXIT_PROBE_RUNTIME: std::sync::OnceLock<Option<tokio::runtime::Runtime>> =
    std::sync::OnceLock::new();

fn shared_exit_runtime() -> Option<&'static tokio::runtime::Runtime> {
    EXIT_PROBE_RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .max_blocking_threads(2)
                .thread_name("exit-probe-rt")
                .enable_all()
                .build()
                .ok()
        })
        .as_ref()
}

pub(crate) fn invalidate_exit_country_cache(proxy_raw: Option<&str>) {
    let Some(cache) = EXIT_COUNTRY_CACHE.get() else {
        return;
    };
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    match proxy_raw.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => {
            let normalized = normalize_reqwest_proxy(raw);
            let prefix = format!("{normalized}|");
            guard.retain(|key, _| key != &normalized && !key.starts_with(&prefix));
        }
        None => guard.clear(),
    }
}

fn pooled_exit_client(normalized_proxy: &str) -> Option<reqwest::Client> {
    let pool = EXIT_CLIENT_POOL
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(mut guard) = pool.lock() {
        if let Some((created_at, client)) = guard.get(normalized_proxy) {
            if created_at.elapsed() < EXIT_CLIENT_POOL_TTL {
                return Some(client.clone());
            }
            guard.remove(normalized_proxy);
        }
    }
    let req_proxy = reqwest::Proxy::all(normalized_proxy).ok()?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(req_proxy)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(EXIT_CONNECT_TIMEOUT)
        .timeout(EXIT_URL_TIMEOUT)
        .user_agent("Claude-Local-ExitGuard/1.0")
        .build()
        .ok()?;
    if let Ok(mut guard) = pool.lock() {
        guard.retain(|_, (at, _)| at.elapsed() < EXIT_CLIENT_POOL_TTL);
        if guard.len() >= EXIT_CLIENT_POOL_MAX {
            if let Some(oldest_key) = guard
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest_key);
            }
        }
        guard.insert(
            normalized_proxy.to_string(),
            (std::time::Instant::now(), client.clone()),
        );
    }
    Some(client)
}

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

pub(super) fn parse_trace_loc(body: &str) -> Option<String> {
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

async fn probe_proxy_exit_country_async(
    client: reqwest::Client,
    urls_owned: Vec<String>,
) -> Option<String> {
    let total_deadline = tokio::time::Instant::now() + EXIT_TOTAL_BUDGET;
    for url in &urls_owned {
        let remaining_total = total_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining_total.is_zero() {
            break;
        }
        let url_budget = remaining_total.min(EXIT_URL_TIMEOUT);
        let url_deadline = tokio::time::Instant::now() + url_budget;
        let Ok(Ok(resp)) = tokio::time::timeout(url_budget, client.get(url).send()).await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let rem_body = url_deadline.saturating_duration_since(tokio::time::Instant::now());
        if rem_body.is_zero() {
            continue;
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
}

pub(crate) fn block_on_exit_probe<F, T>(fut: F) -> Option<T>
where
    F: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread {
            return Some(tokio::task::block_in_place(|| handle.block_on(fut)));
        }
        return std::thread::spawn(move || shared_exit_runtime().map(|rt| rt.block_on(fut)))
            .join()
            .ok()
            .flatten();
    }
    shared_exit_runtime().map(|rt| rt.block_on(fut))
}

pub(crate) fn probe_proxy_exit_country_blocking(normalized_proxy: &str, urls: &[&str]) -> Option<String> {
    let client = pooled_exit_client(normalized_proxy)?;
    let urls_owned: Vec<String> = urls.iter().map(|u| (*u).to_string()).collect();
    let fut = probe_proxy_exit_country_async(client, urls_owned);
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread {
            return tokio::task::block_in_place(|| handle.block_on(fut));
        }
        return std::thread::spawn(move || shared_exit_runtime()?.block_on(fut))
            .join()
            .ok()
            .flatten();
    }
    shared_exit_runtime()?.block_on(fut)
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
    let cache_key = format!("{normalized}|{}", trace_urls.join(","));
    let cache = EXIT_COUNTRY_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        if let Some((at, cc)) = guard.get(&cache_key) {
            if at.elapsed() < EXIT_COUNTRY_CACHE_TTL {
                if crate::regions::is_unsupported_exit_country(cc) {
                    guard.remove(&cache_key);
                    return Err("browser.error.unsupportedExitCountry".into());
                }
                return Ok(());
            }
            guard.remove(&cache_key);
        }
    }
    match probe_proxy_exit_country_blocking(&normalized, trace_urls) {
        Some(loc) => {
            if crate::regions::is_unsupported_exit_country(&loc) {
                if let Ok(mut guard) = cache.lock() {
                    guard.remove(&cache_key);
                }
                return Err("browser.error.unsupportedExitCountry".into());
            }
            if let Ok(mut guard) = cache.lock() {
                if guard.len() >= 64 {
                    guard.retain(|_, (at, _)| at.elapsed() < EXIT_COUNTRY_CACHE_TTL);
                }
                guard.insert(cache_key, (std::time::Instant::now(), loc));
            }
        }
        None => {
            if !allow_direct && machine_is_restricted_region(machine) {
                if let Ok(mut guard) = cache.lock() {
                    guard.remove(&cache_key);
                }
                return Err(
                    "伴生浏览器已拦截启动：无法通过当前代理验证出口国家，请检查代理节点连通性。"
                        .into(),
                );
            }
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
    if cfg!(any(debug_assertions, test)) {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-runtime/quota-bridge");
        if source.join("manifest.json").is_file() {
            return Some(source);
        }
    }
    None
}
