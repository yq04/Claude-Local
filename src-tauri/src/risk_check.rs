// [INPUT]: 当前绑定浏览器的脱敏代理/地区配置、本机活跃网卡只读快照、常见 Mihomo/Clash 运行态结构特征与用户手动触发的三路边缘 trace 探针。
// [OUTPUT]: 本机 DNS 泄露隐患结构化诊断、RFC1918 安全内网 IPv4 候选（排除公网/WSL/Fake-IP）及 claude.ai vs withpersona.com 跨域名出口一致性核验结果。
// [POS]: 风控验证原生只读边界；绝不读取或输出任何代理密码、节点域名、订阅地址或账号凭据，不修改系统设置或中断运行进程。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const TRACE_BODY_LIMIT: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BrowserDnsGuard {
    pub proxy_configured: bool,
    pub proxy_scheme: Option<String>,
    pub proxy_local_port: Option<u16>,
    pub remote_dns_locked: bool,
    pub target_country: Option<String>,
    pub target_timezone: String,
    pub target_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct MihomoAudit {
    pub detected: bool,
    pub client_kind: Option<String>,
    pub mixed_port: Option<u16>,
    pub allow_lan: Option<bool>,
    pub tun_enabled: Option<bool>,
    pub tun_strict_route: Option<bool>,
    pub dns_enabled: Option<bool>,
    pub dns_enhanced_mode: Option<String>,
    pub dns_respect_rules: Option<bool>,
    pub dns_has_remote_doh: bool,
    pub dns_has_domestic_plain: bool,
    pub dns_has_nameserver_policy: bool,
    pub has_claude_rules: bool,
    pub has_persona_rules: bool,
    pub has_quic_reject: bool,
    pub has_geoip_cn: bool,
    pub dedicated_listener_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SystemNetworkAudit {
    pub tun_adapter_active: bool,
    pub secondary_plaintext_dns_active: bool,
    pub lan_ipv4_candidates: Vec<String>,
    pub public_wan_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LocalRiskSnapshot {
    pub browser: BrowserDnsGuard,
    pub mihomo: MihomoAudit,
    pub system: SystemNetworkAudit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceEndpointResult {
    pub domain: String,
    pub ok: bool,
    pub country: Option<String>,
    pub colo: Option<String>,
    pub ip: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConsistencyProbeReport {
    pub claude: TraceEndpointResult,
    pub persona: TraceEndpointResult,
    pub unlisted_dns: TraceEndpointResult,
    pub exit_isp: Option<crate::browser::network::Exit>,
    pub same_country: Option<bool>,
    pub same_exit_ip: Option<bool>,
    pub unlisted_same_country: Option<bool>,
}

pub fn is_valid_rfc1918_lan_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 严格仅接纳 RFC1918 私有局域网段，排除 127.0.0.0/8 回环、169.254.0.0/16 链路本地、198.18.0.0/15 Fake-IP/TUN 及全部公网地址。
    octets[0] == 10
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
}

fn is_fake_ip_or_tun_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
}

fn is_public_routable_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    if ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_unspecified()
        || is_valid_rfc1918_lan_ipv4(ip)
        || is_fake_ip_or_tun_ipv4(ip)
    {
        return false;
    }
    // 排除 CGNAT 100.64.0.0/10 与文档保留网段
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return false;
    }
    true
}

pub fn parse_browser_dns_guard(
    configured_proxy: &str,
    target_country: Option<String>,
    target_timezone: String,
    target_language: String,
) -> BrowserDnsGuard {
    let trimmed = configured_proxy.trim();
    if trimmed.is_empty() {
        return BrowserDnsGuard {
            proxy_configured: false,
            proxy_scheme: None,
            proxy_local_port: None,
            remote_dns_locked: false,
            target_country,
            target_timezone,
            target_language,
        };
    }
    if let Ok(url) = reqwest::Url::parse(trimmed) {
        let scheme = url.scheme().to_ascii_lowercase();
        let remote_dns_locked = scheme == "socks5" || scheme == "socks5h";
        let local_host = url.host_str().is_some_and(|host| {
            let clean = host.trim_matches(['[', ']']);
            clean.eq_ignore_ascii_case("localhost")
                || clean == "127.0.0.1"
                || clean == "::1"
                || clean
                    .parse::<Ipv4Addr>()
                    .is_ok_and(is_valid_rfc1918_lan_ipv4)
        });
        return BrowserDnsGuard {
            proxy_configured: true,
            proxy_scheme: Some(scheme),
            proxy_local_port: if local_host { url.port() } else { None },
            remote_dns_locked,
            target_country,
            target_timezone,
            target_language,
        };
    }
    BrowserDnsGuard {
        proxy_configured: true,
        proxy_scheme: None,
        proxy_local_port: None,
        remote_dns_locked: false,
        target_country,
        target_timezone,
        target_language,
    }
}

fn parse_yaml_bool(raw: &str) -> Option<bool> {
    let val = raw
        .split('#')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(['"', '\'']);
    if val.eq_ignore_ascii_case("true") {
        Some(true)
    } else if val.eq_ignore_ascii_case("false") {
        Some(false)
    } else {
        None
    }
}

fn parse_yaml_u16(raw: &str) -> Option<u16> {
    raw.split('#')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(['"', '\''])
        .parse::<u16>()
        .ok()
        .filter(|p| *p > 0)
}

/// 仅对 Mihomo/Clash 配置做纯布尔/端口/规则命中特征扫描；跳过 proxies / proxy-providers 等敏感段落，零秘密提取。
pub fn audit_mihomo_yaml_structure(content: &str, client_kind: Option<&str>) -> MihomoAudit {
    let mut audit = MihomoAudit {
        detected: true,
        client_kind: client_kind.map(str::to_string),
        ..Default::default()
    };

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Section {
        Root,
        Tun,
        Dns,
        Listeners,
        Rules,
        IgnoredSecretSection,
    }

    let mut section = Section::Root;
    let mut dns_subkey = "";
    let mut current_listener_port: Option<u16> = None;
    let mut current_listener_has_proxy = false;
    let mut current_listener_is_proxy_type = false;

    let flush_listener = |audit: &mut MihomoAudit,
                          port: Option<u16>,
                          has_proxy: bool,
                          is_proxy_type: bool| {
        if audit.dedicated_listener_port.is_none() && has_proxy && is_proxy_type {
            audit.dedicated_listener_port = port;
        }
    };

    for raw_line in content.lines() {
        let trimmed_comment = raw_line.split('#').next().unwrap_or("").trim_end();
        if trimmed_comment.trim().is_empty() {
            continue;
        }
        let indent = trimmed_comment.len() - trimmed_comment.trim_start().len();
        let line = trimmed_comment.trim();

        if indent == 0 && !line.starts_with('-') {
            if section == Section::Listeners {
                flush_listener(
                    &mut audit,
                    current_listener_port.take(),
                    current_listener_has_proxy,
                    current_listener_is_proxy_type,
                );
                current_listener_has_proxy = false;
                current_listener_is_proxy_type = false;
            }
            dns_subkey = "";
            if let Some((key, rest)) = line.split_once(':') {
                let key = key.trim();
                let rest = rest.trim();
                match key {
                    "mixed-port" => {
                        audit.mixed_port = parse_yaml_u16(rest);
                        section = Section::Root;
                    }
                    "port" if audit.mixed_port.is_none() => {
                        audit.mixed_port = parse_yaml_u16(rest);
                        section = Section::Root;
                    }
                    "socks-port" if audit.mixed_port.is_none() => {
                        audit.mixed_port = parse_yaml_u16(rest);
                        section = Section::Root;
                    }
                    "allow-lan" => {
                        audit.allow_lan = parse_yaml_bool(rest);
                        section = Section::Root;
                    }
                    "tun" => section = Section::Tun,
                    "dns" => section = Section::Dns,
                    "listeners" => section = Section::Listeners,
                    "rules" => section = Section::Rules,
                    // 显式跳过可能包含节点域名、密码、订阅链接与认证口令的所有段落。
                    "proxies" | "proxy-providers" | "authentication" | "secret" | "hosts" => {
                        section = Section::IgnoredSecretSection;
                    }
                    _ => section = Section::Root,
                }
            }
            continue;
        }

        match section {
            Section::IgnoredSecretSection | Section::Root => {}
            Section::Tun => {
                if let Some((k, v)) = line.split_once(':') {
                    match k.trim() {
                        "enable" => audit.tun_enabled = parse_yaml_bool(v),
                        "strict-route" => audit.tun_strict_route = parse_yaml_bool(v),
                        _ => {}
                    }
                }
            }
            Section::Dns => {
                if indent <= 2 && !line.starts_with('-') {
                    if let Some((k, v)) = line.split_once(':') {
                        let k = k.trim();
                        let v = v.trim();
                        dns_subkey = match k {
                            "nameserver" => "nameserver",
                            "fallback" => "fallback",
                            "nameserver-policy" => "nameserver-policy",
                            "proxy-server-nameserver" => "proxy-server-nameserver",
                            "default-nameserver" => "default-nameserver",
                            _ => "",
                        };
                        match k {
                            "enable" => audit.dns_enabled = parse_yaml_bool(v),
                            "enhanced-mode" => {
                                let mode = v.trim_matches(['"', '\'']);
                                if !mode.is_empty() {
                                    audit.dns_enhanced_mode = Some(mode.to_ascii_lowercase());
                                }
                            }
                            "respect-rules" => audit.dns_respect_rules = parse_yaml_bool(v),
                            "nameserver-policy" => audit.dns_has_nameserver_policy = true,
                            _ => {}
                        }
                    }
                } else {
                    let lower = line.to_ascii_lowercase();
                    if matches!(dns_subkey, "nameserver" | "fallback" | "nameserver-policy") {
                        if (lower.contains("https://")
                            || lower.contains("tls://")
                            || lower.contains("quic://"))
                            && (lower.contains("1.1.1.1")
                                || lower.contains("cloudflare")
                                || lower.contains("8.8.8.8")
                                || lower.contains("dns.google")
                                || lower.contains("9.9.9.9")
                                || lower.contains("quad9")
                                || lower.contains("opendns")
                                || lower.contains("adguard"))
                        {
                            audit.dns_has_remote_doh = true;
                        }
                    }
                    if dns_subkey == "nameserver"
                        && (lower.contains("system")
                            || lower.contains("223.5.5.5")
                            || lower.contains("223.6.6.6")
                            || lower.contains("119.29.29.29")
                            || lower.contains("114.114.114.114")
                            || lower.contains("180.76.76.76")
                            || lower.contains("alidns")
                            || lower.contains("doh.pub"))
                    {
                        audit.dns_has_domestic_plain = true;
                    }
                    if dns_subkey == "nameserver-policy" {
                        audit.dns_has_nameserver_policy = true;
                    }
                }
            }
            Section::Listeners => {
                let item = if let Some(stripped) = line.strip_prefix('-') {
                    flush_listener(
                        &mut audit,
                        current_listener_port.take(),
                        current_listener_has_proxy,
                        current_listener_is_proxy_type,
                    );
                    current_listener_has_proxy = false;
                    current_listener_is_proxy_type = false;
                    stripped.trim()
                } else {
                    line
                };
                if let Some((k, v)) = item.split_once(':') {
                    let k = k.trim();
                    let v = v.trim().trim_matches(['"', '\'']);
                    match k {
                        "type" => {
                            let lower = v.to_ascii_lowercase();
                            if matches!(lower.as_str(), "mixed" | "socks" | "socks5" | "http") {
                                current_listener_is_proxy_type = true;
                            }
                        }
                        "port" => current_listener_port = parse_yaml_u16(v),
                        "proxy" if !v.is_empty() && !v.eq_ignore_ascii_case("DIRECT") => {
                            current_listener_has_proxy = true;
                        }
                        _ => {}
                    }
                }
            }
            Section::Rules => {
                let lower = line.to_ascii_lowercase();
                if lower.contains("claude.ai") || lower.contains("anthropic.com") {
                    audit.has_claude_rules = true;
                }
                if lower.contains("withpersona.com") || lower.contains("withpersona") {
                    audit.has_persona_rules = true;
                }
                if (lower.contains("443") && lower.contains("udp") && lower.contains("reject"))
                    || (lower.contains("quic") && lower.contains("reject"))
                {
                    audit.has_quic_reject = true;
                }
                if lower.contains("geoip,cn") || lower.contains("geoip, cn") {
                    audit.has_geoip_cn = true;
                }
            }
        }
    }

    if section == Section::Listeners {
        flush_listener(
            &mut audit,
            current_listener_port,
            current_listener_has_proxy,
            current_listener_is_proxy_type,
        );
    }

    audit
}

fn candidate_mihomo_paths() -> Vec<(&'static str, PathBuf)> {
    let mut paths = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let base = PathBuf::from(appdata);
        paths.push((
            "clash-verge-rev",
            base.join("io.github.clash-verge-rev.clash-verge-rev")
                .join("clash-verge.yaml"),
        ));
        paths.push((
            "clash-party",
            base.join("mihomo-party").join("work").join("config.yaml"),
        ));
        paths.push(("flclash", base.join("com.follow").join("config.yaml")));
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        let base = PathBuf::from(home);
        paths.push((
            "clash-verge-rev",
            base.join(".local/share/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml"),
        ));
        paths.push((
            "clash-verge-rev",
            base.join("Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml"),
        ));
        paths.push(("mihomo", base.join(".config/mihomo/config.yaml")));
    }
    paths
}

fn read_bounded_utf8(path: &Path, max_bytes: u64) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > max_bytes {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn inspect_local_mihomo() -> MihomoAudit {
    for (kind, path) in candidate_mihomo_paths() {
        // 限制最大读取 2 MiB，拒绝超大异常文件或符号链接。
        if let Some(content) = read_bounded_utf8(&path, 2 * 1024 * 1024) {
            return audit_mihomo_yaml_structure(&content, Some(kind));
        }
    }
    MihomoAudit::default()
}

fn is_virtual_switch_name(header_lower: &str) -> bool {
    [
        "vethernet",
        "wsl",
        "hyper-v",
        "vmware",
        "virtualbox",
        "vbox",
        "docker",
        "loopback",
        "npcap",
        "bluetooth",
        "tailscale",
        "zerotier",
        "wireguard",
        "radmin",
        "hamachi",
    ]
    .iter()
    .any(|kw| header_lower.contains(kw))
}

fn is_tun_adapter_name(header_lower: &str) -> bool {
    ["meta", "mihomo", "clash", "singtun", "sing-box", "wintun"]
        .iter()
        .any(|kw| header_lower.contains(kw))
}

fn extract_first_ipv4(text: &str) -> Option<Ipv4Addr> {
    for token in text.split(|c: char| !c.is_ascii_digit() && c != '.') {
        if token.split('.').count() == 4 {
            if let Ok(ip) = token.parse::<Ipv4Addr>() {
                return Some(ip);
            }
        }
    }
    None
}

fn is_shared_campus_or_enterprise_dns_suffix(raw: &str) -> bool {
    let s = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if s.is_empty() || !s.contains('.') {
        return false;
    }
    let home_suffixes = [
        ".local",
        ".lan",
        ".home",
        ".home.arpa",
        ".internal",
        ".localdomain",
        "mshome.net",
        "fritz.box",
    ];
    !home_suffixes
        .iter()
        .any(|h| s == h.trim_start_matches('.') || s.ends_with(h))
}

fn is_windows_mobile_hotspot_adapter(header_lower: &str, ipv4s: &[Ipv4Addr]) -> bool {
    let has_ics_ip = ipv4s
        .iter()
        .any(|ip| ip.octets()[0] == 192 && ip.octets()[1] == 168 && ip.octets()[2] == 137);
    let is_hotspot_name = header_lower.contains("wi-fi direct")
        || header_lower.contains("local area connection*")
        || header_lower.contains("本地连接*");
    has_ics_ip && is_hotspot_name
}

/// 解析 UTF-8 (`chcp 65001`) 下的 `ipconfig /all` 输出（兼容中英文系统字段），严格过滤校园网大内网/WSL/虚拟交换机/Fake-IP/公网 WAN 地址。
pub fn parse_windows_ipconfig_utf8(output: &str) -> SystemNetworkAudit {
    let mut audit = SystemNetworkAudit::default();

    #[derive(Default)]
    struct AdapterBlock {
        header: String,
        disconnected: bool,
        shared_campus_suffix: bool,
        ipv4s: Vec<Ipv4Addr>,
        has_gateway: bool,
        dns_ipv4s: Vec<Ipv4Addr>,
        has_tun_ipv6_dns: bool,
    }

    let mut blocks: Vec<AdapterBlock> = Vec::new();
    let mut current: Option<AdapterBlock> = None;
    let mut in_dns_continuation = false;
    let mut in_gateway_continuation = false;

    for raw_line in output.lines() {
        let trimmed = raw_line.trim_end();
        if trimmed.trim().is_empty() {
            continue;
        }
        let is_indented = raw_line.starts_with(' ') || raw_line.starts_with('\t');
        if !is_indented && (trimmed.ends_with(':') || trimmed.ends_with('：')) {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            current = Some(AdapterBlock {
                header: trimmed.to_lowercase(),
                ..Default::default()
            });
            in_dns_continuation = false;
            in_gateway_continuation = false;
            continue;
        }

        let Some(block) = current.as_mut() else {
            continue;
        };
        let line = trimmed.trim();
        let lower = line.to_lowercase();

        if let Some((left, right)) = line.split_once(':').or_else(|| line.split_once('：')) {
            let key = left.to_lowercase();
            let val = right.trim();
            in_dns_continuation = false;
            in_gateway_continuation = false;

            if (key.contains("media state") || key.contains("媒体状态"))
                && (val.to_lowercase().contains("disconnected") || val.contains("已断开"))
            {
                block.disconnected = true;
            } else if key.contains("dns suffix") || key.contains("dns 后缀") {
                if is_shared_campus_or_enterprise_dns_suffix(val) {
                    block.shared_campus_suffix = true;
                }
            } else if key.contains("description") || key.contains("描述") {
                block.header.push(' ');
                block.header.push_str(&val.to_lowercase());
            } else if key.contains("ipv4 address")
                || key.contains("ip address")
                || key.contains("ipv4 地址")
                || key.contains("ip 地址")
            {
                if let Some(ip) = extract_first_ipv4(val) {
                    block.ipv4s.push(ip);
                }
            } else if key.contains("default gateway") || key.contains("默认网关") {
                if extract_first_ipv4(val).is_some()
                    || (!val.is_empty() && val.contains(':'))
                {
                    block.has_gateway = true;
                }
                in_gateway_continuation = true;
            } else if key.contains("dns servers") || key.contains("dns 服务器") {
                if val.to_ascii_lowercase().contains("fdfe:dcba") {
                    block.has_tun_ipv6_dns = true;
                }
                if let Some(ip) = extract_first_ipv4(val) {
                    block.dns_ipv4s.push(ip);
                }
                in_dns_continuation = true;
            }
        } else if in_dns_continuation {
            if lower.contains("fdfe:dcba") {
                block.has_tun_ipv6_dns = true;
            }
            if let Some(ip) = extract_first_ipv4(line) {
                block.dns_ipv4s.push(ip);
            }
        } else if in_gateway_continuation {
            if extract_first_ipv4(line).is_some() || line.contains(':') {
                block.has_gateway = true;
            }
        }
    }
    if let Some(block) = current {
        blocks.push(block);
    }

    for block in blocks {
        if block.disconnected {
            continue;
        }
        let is_tun = is_tun_adapter_name(&block.header)
            || block.has_tun_ipv6_dns
            || block.ipv4s.iter().copied().any(is_fake_ip_or_tun_ipv4)
            || block
                .dns_ipv4s
                .iter()
                .copied()
                .any(is_fake_ip_or_tun_ipv4);

        if is_tun {
            audit.tun_adapter_active = true;
            continue;
        }

        if is_virtual_switch_name(&block.header) {
            continue;
        }

        let is_hotspot = is_windows_mobile_hotspot_adapter(&block.header, &block.ipv4s);
        if block.shared_campus_suffix && (block.has_gateway || !block.ipv4s.is_empty()) {
            audit.public_wan_detected = true;
        }

        if block.has_gateway || is_hotspot {
            for ip in &block.ipv4s {
                if is_valid_rfc1918_lan_ipv4(*ip) && (!block.shared_campus_suffix || is_hotspot) {
                    let s = ip.to_string();
                    if !audit.lan_ipv4_candidates.contains(&s) {
                        audit.lan_ipv4_candidates.push(s);
                    }
                } else if is_public_routable_ipv4(*ip) {
                    audit.public_wan_detected = true;
                }
            }
        }

        for dns in &block.dns_ipv4s {
            if !dns.is_loopback() && !is_fake_ip_or_tun_ipv4(*dns) {
                audit.secondary_plaintext_dns_active = true;
            }
        }
    }

    // 优先将常见家庭路由器 192.168.x.x 排在最前
    audit
        .lan_ipv4_candidates
        .sort_by_key(|ip| if ip.starts_with("192.168.") { 0 } else { 1 });
    audit
}

fn inspect_system_network() -> SystemNetworkAudit {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        if let Ok(out) = Command::new("cmd.exe")
            .creation_flags(0x08000000)
            .args(["/d", "/c", "chcp 65001 >nul && ipconfig /all"])
            .stdin(Stdio::null())
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                return parse_windows_ipconfig_utf8(&text);
            }
        }
    }

    // 非 Windows 或命令不可用时的纯内核路由表回退探测（不发任何真实线上包）
    let mut audit = SystemNetworkAudit::default();
    for probe_target in ["192.168.1.1:80", "10.0.0.1:80", "172.16.0.1:80"] {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(probe_target).is_ok() {
                if let Ok(std::net::SocketAddr::V4(local)) = sock.local_addr() {
                    let ip = *local.ip();
                    if is_fake_ip_or_tun_ipv4(ip) {
                        audit.tun_adapter_active = true;
                    } else if is_valid_rfc1918_lan_ipv4(ip) {
                        let s = ip.to_string();
                        if !audit.lan_ipv4_candidates.contains(&s) {
                            audit.lan_ipv4_candidates.push(s);
                        }
                    } else if is_public_routable_ipv4(ip) {
                        audit.public_wan_detected = true;
                    }
                }
            }
        }
    }
    audit
}

pub fn parse_cloudflare_trace(domain: &str, body: &str, latency_ms: u64) -> TraceEndpointResult {
    let mut ip: Option<String> = None;
    let mut country: Option<String> = None;
    let mut colo: Option<String> = None;

    for line in body.lines().take(32) {
        if let Some((k, v)) = line.trim().split_once('=') {
            let v = v.trim();
            match k {
                "ip" => {
                    if v.parse::<IpAddr>().is_ok() {
                        ip = Some(v.to_string());
                    }
                }
                "loc" => {
                    if v.len() == 2 && v.bytes().all(|b| b.is_ascii_uppercase()) {
                        country = Some(v.to_string());
                    }
                }
                "colo" => {
                    if !v.is_empty()
                        && v.len() <= 8
                        && v.bytes().all(|b| b.is_ascii_alphanumeric())
                    {
                        colo = Some(v.to_ascii_uppercase());
                    }
                }
                _ => {}
            }
        }
    }

    if country.is_some() && ip.is_some() {
        TraceEndpointResult {
            domain: domain.to_string(),
            ok: true,
            country,
            colo,
            ip,
            latency_ms: Some(latency_ms),
            error: None,
        }
    } else {
        TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country,
            colo,
            ip,
            latency_ms: Some(latency_ms),
            error: Some("invalid_trace".into()),
        }
    }
}

async fn fetch_trace_endpoint(
    client: reqwest::Client,
    domain: &'static str,
    url: String,
) -> TraceEndpointResult {
    let started = Instant::now();
    let response = match client.get(&url).send().await {
        Ok(resp) => resp,
        Err(err) => {
            let code = if err.is_timeout() {
                "timeout"
            } else if err.is_connect() {
                "connect_failed"
            } else {
                "network_error"
            };
            return TraceEndpointResult {
                domain: domain.to_string(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: Some(code.into()),
            };
        }
    };

    if !response.status().is_success() {
        return TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country: None,
            colo: None,
            ip: None,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: Some(format!("HTTP {}", response.status().as_u16())),
        };
    }

    let mut bytes = Vec::with_capacity(512);
    let mut resp = response;
    while let Ok(Some(chunk)) = resp.chunk().await {
        if bytes.len() + chunk.len() > TRACE_BODY_LIMIT {
            return TraceEndpointResult {
                domain: domain.to_string(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: Some("invalid_trace".into()),
            };
        }
        bytes.extend_from_slice(&chunk);
    }

    let latency_ms = started.elapsed().as_millis() as u64;
    match std::str::from_utf8(&bytes) {
        Ok(text) => parse_cloudflare_trace(domain, text, latency_ms),
        Err(_) => TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country: None,
            colo: None,
            ip: None,
            latency_ms: Some(latency_ms),
            error: Some("invalid_trace".into()),
        },
    }
}

pub(crate) async fn probe_consistency_urls(
    proxy: &str,
    claude_url: &str,
    persona_url: &str,
    unlisted_url: &str,
    include_isp: bool,
) -> ConsistencyProbeReport {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8));

    let trimmed = proxy.trim();
    if !trimmed.is_empty() {
        if let Ok(p) = reqwest::Proxy::all(trimmed) {
            builder = builder.proxy(p);
        }
    }

    let client = match builder.build() {
        Ok(c) => c,
        Err(_) => {
            let fail = |domain: &str| TraceEndpointResult {
                domain: domain.into(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: None,
                error: Some("client_error".into()),
            };
            return ConsistencyProbeReport {
                claude: fail("claude.ai"),
                persona: fail("withpersona.com"),
                unlisted_dns: fail("cloudflare-dns.com"),
                exit_isp: None,
                same_country: None,
                same_exit_ip: None,
                unlisted_same_country: None,
            };
        }
    };

    let c_url = claude_url.to_string();
    let p_url = persona_url.to_string();
    let u_url = unlisted_url.to_string();
    let proxy_owned = trimmed.to_string();

    let t_claude =
        tauri::async_runtime::spawn(fetch_trace_endpoint(client.clone(), "claude.ai", c_url));
    let t_persona = tauri::async_runtime::spawn(fetch_trace_endpoint(
        client.clone(),
        "withpersona.com",
        p_url,
    ));
    let t_unlisted = tauri::async_runtime::spawn(fetch_trace_endpoint(
        client,
        "cloudflare-dns.com",
        u_url,
    ));
    let t_isp = if include_isp {
        Some(tauri::async_runtime::spawn(async move {
            crate::browser::network::probe(&proxy_owned).await.ok()
        }))
    } else {
        None
    };

    let fallback = |domain: &str| TraceEndpointResult {
        domain: domain.into(),
        ok: false,
        country: None,
        colo: None,
        ip: None,
        latency_ms: None,
        error: Some("network_error".into()),
    };

    let claude = t_claude.await.unwrap_or_else(|_| fallback("claude.ai"));
    let persona = t_persona
        .await
        .unwrap_or_else(|_| fallback("withpersona.com"));
    let unlisted_dns = t_unlisted
        .await
        .unwrap_or_else(|_| fallback("cloudflare-dns.com"));
    let exit_isp = match t_isp {
        Some(handle) => handle.await.ok().flatten(),
        None => None,
    };

    let same_country = match (&claude.country, &persona.country) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };
    let same_exit_ip = match (&claude.ip, &persona.ip) {
        (Some(a), Some(b)) => {
            let ca = a.parse::<IpAddr>().ok();
            let cb = b.parse::<IpAddr>().ok();
            match (ca, cb) {
                (Some(ia), Some(ib)) => Some(ia == ib),
                _ => Some(a == b),
            }
        }
        _ => None,
    };
    let unlisted_same_country = match (&claude.country, &unlisted_dns.country) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };

    ConsistencyProbeReport {
        claude,
        persona,
        unlisted_dns,
        exit_isp,
        same_country,
        same_exit_ip,
        unlisted_same_country,
    }
}

#[tauri::command]
pub async fn risk_inspect_local_env(app: tauri::AppHandle) -> Result<LocalRiskSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = crate::browser::current_risk_browser_context(&app);
        let browser = parse_browser_dns_guard(
            &ctx.configured_proxy,
            ctx.target_country,
            ctx.target_timezone,
            ctx.target_language,
        );
        let mihomo = inspect_local_mihomo();
        let system = inspect_system_network();
        LocalRiskSnapshot {
            browser,
            mihomo,
            system,
        }
    })
    .await
    .map_err(|_| "风控环境读取被中断。".to_string())
}

#[tauri::command]
pub async fn risk_probe_consistency(
    app: tauri::AppHandle,
) -> Result<ConsistencyProbeReport, String> {
    let proxy = tauri::async_runtime::spawn_blocking(move || {
        crate::browser::configured_or_system_proxy(&app)
    })
    .await
    .unwrap_or_default();

    Ok(probe_consistency_urls(
        &proxy,
        "https://claude.ai/cdn-cgi/trace",
        "https://withpersona.com/cdn-cgi/trace",
        "https://cloudflare-dns.com/cdn-cgi/trace",
        true,
    )
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn mihomo_audit_extracts_dns_and_persona_gaps_without_leaking_secrets() {
        let sample = r#"
mixed-port: 7897
allow-lan: false
secret: "my-controller-secret-token"
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - system
    - 223.5.5.5
    - 119.29.29.29
tun:
  enable: true
  strict-route: false
proxies:
  - name: "US Static"
    type: socks5
    server: secret-residential.example.invalid
    port: 10800
    username: private_user_99
    password: SUPER_SECRET_PASSWORD_999
rules:
  - DOMAIN-SUFFIX,claude.ai,ClaudeGroup
  - DOMAIN-SUFFIX,anthropic.com,ClaudeGroup
  - GEOIP,CN,DIRECT
  - MATCH,TransitGroup
"#;
        let audit = audit_mihomo_yaml_structure(sample, Some("clash-verge-rev"));
        assert!(audit.detected);
        assert_eq!(audit.mixed_port, Some(7897));
        assert_eq!(audit.allow_lan, Some(false));
        assert_eq!(audit.tun_enabled, Some(true));
        assert_eq!(audit.tun_strict_route, Some(false));
        assert_eq!(audit.dns_enabled, Some(true));
        assert_eq!(audit.dns_enhanced_mode.as_deref(), Some("fake-ip"));
        assert_eq!(audit.dns_respect_rules, None);
        assert!(!audit.dns_has_remote_doh);
        assert!(audit.dns_has_domestic_plain);
        assert!(audit.has_claude_rules);
        assert!(!audit.has_persona_rules);
        assert!(audit.has_geoip_cn);
        assert_eq!(audit.dedicated_listener_port, None);

        let serialized = serde_json::to_string(&audit).unwrap();
        assert!(!serialized.contains("SUPER_SECRET_PASSWORD_999"));
        assert!(!serialized.contains("private_user_99"));
        assert!(!serialized.contains("secret-residential.example.invalid"));
        assert!(!serialized.contains("my-controller-secret-token"));
    }

    #[test]
    fn mihomo_audit_recognizes_hardened_dedicated_listener_and_remote_doh() {
        let hardened = r#"
mixed-port: 7897
allow-lan: false
listeners:
  - name: claude-kyc-residential
    type: mixed
    port: 7899
    listen: 127.0.0.1
    udp: true
    proxy: "ClaudeResidential"
dns:
  enable: true
  enhanced-mode: fake-ip
  respect-rules: true
  proxy-server-nameserver:
    - 223.5.5.5
  nameserver-policy:
    "geosite:cn": 223.5.5.5
  nameserver:
    - https://cloudflare-dns.com/dns-query
tun:
  enable: true
  strict-route: true
rules:
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - DOMAIN-SUFFIX,claude.ai,ClaudeResidential
  - DOMAIN-SUFFIX,withpersona.com,ClaudeResidential
  - GEOIP,CN,DIRECT,no-resolve
"#;
        let audit = audit_mihomo_yaml_structure(hardened, Some("clash-verge-rev"));
        assert_eq!(audit.dedicated_listener_port, Some(7899));
        assert_eq!(audit.dns_respect_rules, Some(true));
        assert!(audit.dns_has_remote_doh);
        assert!(audit.dns_has_nameserver_policy);
        assert_eq!(audit.tun_strict_route, Some(true));
        assert!(audit.has_persona_rules);
        assert!(audit.has_quic_reject);
    }

    #[test]
    fn rfc1918_and_ipconfig_parser_reject_public_wan_wsl_and_fake_ip() {
        let sample_ipconfig = r#"
Windows IP Configuration

Unknown adapter Meta:

   Connection-specific DNS Suffix  . :
   Description . . . . . . . . . . . : Meta Tunnel
   IPv4 Address. . . . . . . . . . . : 198.18.0.1(Preferred)
   Default Gateway . . . . . . . . . :
   DNS Servers . . . . . . . . . . . : 198.18.0.2
                                       fdfe:dcba:9876::2

Ethernet adapter vEthernet (WSL (Hyper-V firewall)):

   Connection-specific DNS Suffix  . :
   Description . . . . . . . . . . . : Hyper-V Virtual Ethernet Adapter
   IPv4 Address. . . . . . . . . . . : 172.19.16.1(Preferred)
   Default Gateway . . . . . . . . . :

Ethernet adapter Ethernet:

   Connection-specific DNS Suffix  . : example.edu.invalid
   Description . . . . . . . . . . . : Realtek PCIe GbE Family Controller
   IPv4 Address. . . . . . . . . . . : 203.0.113.45(Preferred)
   Default Gateway . . . . . . . . . : 203.0.113.1
   DNS Servers . . . . . . . . . . . : 203.0.113.2
                                       203.0.113.3

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . : lan
   Description . . . . . . . . . . . : Intel(R) Wi-Fi 6 AX200
   IPv4 Address. . . . . . . . . . . : 192.168.31.88(Preferred)
   Default Gateway . . . . . . . . . : 192.168.31.1
   DNS Servers . . . . . . . . . . . : 192.168.31.1
"#;
        let parsed = parse_windows_ipconfig_utf8(sample_ipconfig);
        assert!(parsed.tun_adapter_active);
        assert!(parsed.public_wan_detected);
        assert!(parsed.secondary_plaintext_dns_active);
        assert_eq!(parsed.lan_ipv4_candidates, vec!["192.168.31.88".to_string()]);
    }

    #[test]
    fn ipconfig_parser_flags_campus_rfc1918_intranet_and_allows_windows_hotspot_and_zh_fields() {
        let campus_and_hotspot = r#"
Windows IP 配置

以太网适配器 以太网:

   连接特定的 DNS 后缀 . . . . . . . : campus.edu.invalid
   描述. . . . . . . . . . . . . . . : Realtek Gaming GbE Family Controller
   IPv4 地址 . . . . . . . . . . . . : 10.68.12.45(首选)
   默认网关. . . . . . . . . . . . . : 10.68.0.1
   DNS 服务器  . . . . . . . . . . . : 10.10.0.21

无线局域网适配器 本地连接* 10:

   连接特定的 DNS 后缀 . . . . . . . :
   描述. . . . . . . . . . . . . . . : Microsoft Wi-Fi Direct Virtual Adapter #2
   IPv4 地址 . . . . . . . . . . . . : 192.168.137.1(首选)
   默认网关. . . . . . . . . . . . . :
"#;
        let parsed = parse_windows_ipconfig_utf8(campus_and_hotspot);
        assert!(parsed.public_wan_detected);
        assert_eq!(parsed.lan_ipv4_candidates, vec!["192.168.137.1".to_string()]);
    }

    #[test]
    fn browser_dns_guard_detects_socks5_remote_dns_lock_and_hides_external_hosts() {
        let locked = parse_browser_dns_guard(
            "socks5://127.0.0.1:7899",
            Some("US".into()),
            "America/New_York".into(),
            "en-US".into(),
        );
        assert!(locked.proxy_configured);
        assert!(locked.remote_dns_locked);
        assert_eq!(locked.proxy_local_port, Some(7899));

        let external = parse_browser_dns_guard(
            "http://198.51.100.22:8080",
            Some("US".into()),
            "America/New_York".into(),
            "en-US".into(),
        );
        assert!(external.proxy_configured);
        assert!(!external.remote_dns_locked);
        assert_eq!(external.proxy_local_port, None);
    }

    fn spawn_mock_trace_server(trace_body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    trace_body.len(),
                    trace_body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        format!("http://127.0.0.1:{}/cdn-cgi/trace", addr.port())
    }

    #[test]
    fn loopback_consistency_probe_detects_country_and_ip_escape() {
        let claude_url = spawn_mock_trace_server("ip=198.51.100.10\ncolo=IAD\nloc=US\n");
        let persona_url = spawn_mock_trace_server("ip=203.0.113.99\ncolo=NRT\nloc=JP\n");
        let unlisted_url = spawn_mock_trace_server("ip=203.0.113.99\ncolo=NRT\nloc=JP\n");

        let report = tauri::async_runtime::block_on(probe_consistency_urls(
            "",
            &claude_url,
            &persona_url,
            &unlisted_url,
            false,
        ));
        assert!(report.claude.ok);
        assert!(report.persona.ok);
        assert_eq!(report.claude.country.as_deref(), Some("US"));
        assert_eq!(report.persona.country.as_deref(), Some("JP"));
        assert_eq!(report.same_country, Some(false));
        assert_eq!(report.same_exit_ip, Some(false));
        assert_eq!(report.unlisted_same_country, Some(false));
    }
}
