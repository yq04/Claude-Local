// [INPUT]: Windows `ipconfig /all` UTF-8 输出或非 Windows 内核 UDP 路由探测结果。
// [OUTPUT]: 过滤校园网大内网/WSL/Hyper-V 虚拟交换机/Fake-IP/公网 WAN 后的 RFC1918 私有局域网候选及 TUN/明文 DNS 状态布尔值。
// [POS]: risk_check 子模块：本机网络接口与 TUN/DNS 只读检查，供风控快照与伴生浏览器断流急停守护复用。
// [PROTOCOL]: 变更时更新此头部，然后检查 risk_check/CLAUDE.md
use super::SystemNetworkAudit;
use std::net::Ipv4Addr;

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
                if extract_first_ipv4(val).is_some() || (!val.is_empty() && val.contains(':')) {
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
            || block.dns_ipv4s.iter().copied().any(is_fake_ip_or_tun_ipv4);

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

pub(super) fn inspect_system_network() -> SystemNetworkAudit {
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

pub(crate) fn system_tun_and_dns_status() -> (bool, bool) {
    let audit = inspect_system_network();
    (
        audit.tun_adapter_active,
        audit.secondary_plaintext_dns_active,
    )
}
