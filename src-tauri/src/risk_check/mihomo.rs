// [INPUT]: 本地 Mihomo/Clash 候选配置路径及 running_core 进程发现的受限只读 YAML 投影（最多 2 MiB）。
// [OUTPUT]: Mihomo 布尔/端口/DNS 投影与按生效顺序（prepend-rules -> rules -> append-rules）的 Claude/Persona/Yoti/Sift+Hexagon/Datadog 分流一致性结构诊断。
// [POS]: risk_check 子模块：代理内核规则与 DNS 结构只读解析，显式跳过 proxies/authentication/secret 等敏感段落。
// [PROTOCOL]: 变更时更新此头部，然后检查 risk_check/CLAUDE.md
use super::{config_source, MihomoAudit};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;

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

// A deliberately narrow YAML projection: unsupported aliases/maps stay uncertain.
fn yaml_without_comment(line: &str) -> &str {
    let mut quote = None;
    let mut previous = ' ';
    for (i, ch) in line.char_indices() {
        if matches!(ch, '\'' | '"') && previous != '\\' {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            }
        }
        if ch == '#' && quote.is_none() && previous.is_whitespace() {
            return &line[..i];
        }
        previous = ch;
    }
    line
}

fn project_resolvers(raw: &str, audit: &mut MihomoAudit) {
    let raw = raw.trim().trim_start_matches('-').trim();
    if raw.is_empty() {
        return;
    }
    if raw.contains(['{', '}', '&', '*', '|', '>']) {
        audit.dns_projection_complete = false;
        return;
    }
    // Resolver URI query fragments are retained; only resulting booleans escape this function.
    for item in raw.trim_matches(['[', ']']).split(',') {
        let value = item.trim().trim_matches(['\'', '"']).to_ascii_lowercase();
        if value.is_empty() {
            continue;
        }
        let encrypted = ["https://", "tls://", "quic://", "h3://"]
            .iter()
            .any(|s| value.starts_with(s));
        let host = if value.contains("://") {
            reqwest::Url::parse(&value)
                .ok()
                .and_then(|u| u.host_str().map(str::to_owned))
        } else {
            Some(value.split(['#', ':']).next().unwrap_or("").to_owned())
        };
        let Some(host) = host else {
            audit.dns_projection_complete = false;
            continue;
        };
        let domestic = matches!(
            host.as_str(),
            "223.5.5.5"
                | "223.6.6.6"
                | "119.29.29.29"
                | "1.12.12.12"
                | "120.53.53.53"
                | "114.114.114.114"
                | "180.76.76.76"
                | "dns.alidns.com"
                | "doh.pub"
                | "dot.pub"
                | "dns.pub"
        );
        if encrypted {
            audit.dns_has_encrypted_resolver = true;
            audit.dns_has_domestic_encrypted |= domestic;
            audit.dns_has_remote_doh |= !domestic;
        } else if value == "system" || domestic {
            audit.dns_has_domestic_plain = true;
        } else if host.parse::<IpAddr>().is_err() {
            // Unknown plaintext/system transports cannot establish a hardened DNS setup.
            audit.dns_projection_complete = false;
        }
    }
}

/// 仅对 Mihomo/Clash 配置做纯布尔/端口/规则命中特征扫描；跳过 proxies / proxy-providers 等敏感段落，零秘密提取。
pub fn audit_mihomo_yaml_structure(content: &str, client_kind: Option<&str>) -> MihomoAudit {
    let mut audit = MihomoAudit {
        detected: true,
        client_kind: client_kind.map(str::to_string),
        dns_projection_complete: true,
        ..Default::default()
    };

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Section {
        Root,
        Tun,
        Dns,
        Listeners,
        PrependRules,
        Rules,
        AppendRules,
        IgnoredSecretSection,
    }

    let mut section = Section::Root;
    let mut dns_subkey = "";
    let mut dns_child_indent = None;
    let mut tun_child_indent = None;
    let mut current_listener_port: Option<u16> = None;
    let mut current_listener_has_proxy = false;
    let mut current_listener_is_proxy_type = false;
    let mut prepend_rule_lines: Vec<String> = Vec::new();
    let mut main_rule_lines: Vec<String> = Vec::new();
    let mut append_rule_lines: Vec<String> = Vec::new();

    let flush_listener =
        |audit: &mut MihomoAudit, port: Option<u16>, has_proxy: bool, is_proxy_type: bool| {
            if audit.dedicated_listener_port.is_none() && has_proxy && is_proxy_type {
                audit.dedicated_listener_port = port;
            }
        };

    for raw_line in content.lines() {
        let trimmed_comment = yaml_without_comment(raw_line).trim_end();
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
            dns_child_indent = None;
            tun_child_indent = None;
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
                    "tun" => {
                        section = Section::Tun;
                        if !rest.is_empty() {
                            audit.dns_projection_complete = false;
                        }
                    }
                    "dns" => {
                        section = Section::Dns;
                        if !rest.is_empty() {
                            audit.dns_projection_complete = false;
                        }
                    }
                    "listeners" => section = Section::Listeners,
                    "prepend-rules" => section = Section::PrependRules,
                    "rules" => section = Section::Rules,
                    "append-rules" => section = Section::AppendRules,
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
                let child_indent = *tun_child_indent.get_or_insert(indent);
                if indent != child_indent {
                    audit.dns_projection_complete = false;
                    continue;
                }
                if let Some((k, v)) = line.split_once(':') {
                    match k.trim() {
                        "enable" => audit.tun_enabled = parse_yaml_bool(v),
                        "strict-route" => audit.tun_strict_route = parse_yaml_bool(v),
                        _ => {}
                    }
                }
            }
            Section::Dns => {
                let child_indent = *dns_child_indent.get_or_insert(indent);
                if indent == child_indent && !line.starts_with('-') {
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
                                if matches!(mode, "fake-ip" | "redir-host" | "normal") {
                                    audit.dns_enhanced_mode = Some(mode.to_ascii_lowercase());
                                } else {
                                    audit.dns_projection_complete = false;
                                }
                            }
                            "respect-rules" => audit.dns_respect_rules = parse_yaml_bool(v),
                            "nameserver-policy" => audit.dns_has_nameserver_policy = true,
                            _ => {}
                        }
                        if matches!(dns_subkey, "nameserver" | "fallback") {
                            project_resolvers(v, &mut audit);
                        }
                        if dns_subkey == "nameserver-policy" && !v.is_empty() {
                            audit.dns_projection_complete = false;
                        }
                    }
                } else {
                    if matches!(dns_subkey, "nameserver" | "fallback" | "nameserver-policy") {
                        let resolver =
                            if dns_subkey == "nameserver-policy" && !line.starts_with('-') {
                                line.split_once(": ").map(|(_, v)| v).unwrap_or("")
                            } else {
                                line
                            };
                        project_resolvers(resolver, &mut audit);
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
            Section::PrependRules => {
                prepend_rule_lines.push(line.to_string());
            }
            Section::Rules => {
                main_rule_lines.push(line.to_string());
            }
            Section::AppendRules => {
                append_rule_lines.push(line.to_string());
            }
        }
    }

    fn is_exempt_unresolved_ip_rule(pattern: &str) -> bool {
        if matches!(
            pattern,
            "127.0.0.0/8"
                | "10.0.0.0/8"
                | "172.16.0.0/12"
                | "192.168.0.0/16"
                | "198.18.0.0/15"
                | "::1/128"
        ) {
            return true;
        }
        if let Some((ip_str, prefix_str)) = pattern.split_once('/') {
            if let (Ok(ip), Ok(prefix)) =
                (ip_str.parse::<Ipv4Addr>(), prefix_str.parse::<u8>())
            {
                if prefix <= 32 {
                    let octets = ip.octets();
                    return (octets[0] == 127 && prefix >= 8)
                        || (octets[0] == 10 && prefix >= 8)
                        || (octets[0] == 172 && (16..=31).contains(&octets[1]) && prefix >= 12)
                        || (octets[0] == 192 && octets[1] == 168 && prefix >= 16)
                        || (octets[0] == 198 && (18..=19).contains(&octets[1]) && prefix >= 15);
                }
            }
        }
        false
    }

    let mut seen_unresolved_ip_rule = false;
    let mut claude_group: Option<String> = None;
    let mut kyc_groups: Vec<String> = Vec::new();
    let mut sift_groups: Vec<String> = Vec::new();
    let mut has_sift_domain = false;
    let mut has_hexagon_domain = false;
    let mut has_datadog_logs_rule = false;
    let mut datadog_groups: Vec<String> = Vec::new();

    // Evaluate sections in Mihomo runtime precedence order (`prepend-rules` -> `rules` -> `append-rules`),
    // tracking unresolved IP-CIDR/GEOIP rules strictly in that effective order so later YAML sections
    // cannot retroactively shadow higher-precedence `prepend-rules:`.
    for section_lines in [&prepend_rule_lines, &main_rule_lines, &append_rule_lines] {
        for line in section_lines {
            let lower = line.to_ascii_lowercase();
            if (lower.contains("443") && lower.contains("udp") && lower.contains("reject"))
                || (lower.contains("quic") && lower.contains("reject"))
            {
                audit.has_quic_reject = true;
            }
            if lower.contains("geoip,cn") || lower.contains("geoip, cn") {
                audit.has_geoip_cn = true;
            }
            if let Some(rule_item) = line.strip_prefix('-') {
                let cleaned = rule_item.trim().trim_matches(['"', '\'']).trim();
                let upper_head = cleaned.to_ascii_uppercase();
                if upper_head.starts_with("AND,")
                    || upper_head.starts_with("OR,")
                    || upper_head.starts_with("NOT,")
                {
                    continue;
                }
                let parts: Vec<&str> = cleaned.split(',').map(str::trim).collect();
                if parts.len() >= 3 {
                    let rtype = parts[0].to_ascii_uppercase();
                    let pattern = parts[1].trim_start_matches('.').to_ascii_lowercase();
                    let target = parts[2];
                    let has_no_resolve = parts[3..]
                        .iter()
                        .any(|p| p.eq_ignore_ascii_case("no-resolve"));
                    if matches!(
                        rtype.as_str(),
                        "IP-CIDR" | "IP-CIDR6" | "GEOIP" | "IP-ASN"
                    ) {
                        if !has_no_resolve && !is_exempt_unresolved_ip_rule(&pattern) {
                            seen_unresolved_ip_rule = true;
                        }
                        continue;
                    }
                    if matches!(
                        rtype.as_str(),
                        "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "GEOSITE"
                    ) && !target.is_empty()
                        && !target.eq_ignore_ascii_case("DIRECT")
                        && !target.eq_ignore_ascii_case("REJECT")
                        && !target.eq_ignore_ascii_case("REJECT-DROP")
                        && !target.eq_ignore_ascii_case("REJECT-NO-DROP")
                        && !seen_unresolved_ip_rule
                    {
                        if matches!(
                            pattern.as_str(),
                            "claude.ai" | "anthropic.com" | "claude.com"
                        ) || (matches!(rtype.as_str(), "DOMAIN-KEYWORD" | "GEOSITE")
                            && matches!(pattern.as_str(), "claude" | "anthropic"))
                        {
                            claude_group.get_or_insert_with(|| target.to_string());
                        }
                        if matches!(
                            pattern.as_str(),
                            "withpersona.com" | "persona.com" | "persona.org" | "yoti.com"
                        ) || (rtype == "DOMAIN-KEYWORD"
                            && matches!(pattern.as_str(), "withpersona" | "yoti"))
                        {
                            kyc_groups.push(target.to_string());
                        }
                        let is_sift_rule = (matches!(rtype.as_str(), "DOMAIN" | "DOMAIN-SUFFIX")
                            && matches!(pattern.as_str(), "sift.com" | "siftscience.com"))
                            || (rtype == "DOMAIN-KEYWORD" && pattern == "sift");
                        let is_hexagon_rule =
                            (matches!(rtype.as_str(), "DOMAIN" | "DOMAIN-SUFFIX")
                                && matches!(
                                    pattern.as_str(),
                                    "hexagon-cdn.com" | "hexagon-analytics.com"
                                ))
                                || (rtype == "DOMAIN-KEYWORD"
                                    && matches!(
                                        pattern.as_str(),
                                        "hexagon" | "hexagon-cdn" | "hexagon-analytics"
                                    ));
                        if is_sift_rule {
                            has_sift_domain = true;
                            sift_groups.push(target.to_string());
                        }
                        if is_hexagon_rule {
                            has_hexagon_domain = true;
                            sift_groups.push(target.to_string());
                        }
                        let is_dd_keyword =
                            rtype == "DOMAIN-KEYWORD" && pattern == "datadoghq";
                        let is_dd_logs_domain = matches!(
                            pattern.as_str(),
                            "datadoghq.com" | "http-intake.logs.us5.datadoghq.com"
                        );
                        let is_dd_aux_domain = matches!(
                            pattern.as_str(),
                            "browser-intake-datadoghq.com"
                                | "browser-intake-us5-datadoghq.com"
                                | "datadoghq.eu"
                                | "ddog-gov.com"
                        );
                        if is_dd_keyword || is_dd_logs_domain || is_dd_aux_domain {
                            if is_dd_keyword || is_dd_logs_domain {
                                has_datadog_logs_rule = true;
                            }
                            datadog_groups.push(target.to_string());
                        }
                    }
                }
            }
        }
    }

    audit.has_claude_rules = claude_group.is_some();
    audit.has_persona_rules = !kyc_groups.is_empty()
        && match &claude_group {
            Some(cg) => kyc_groups.iter().all(|kg| kg == cg),
            None => {
                let first = &kyc_groups[0];
                kyc_groups.iter().all(|kg| kg == first)
            }
        };
    audit.has_sift_rules = has_sift_domain
        && has_hexagon_domain
        && !sift_groups.is_empty()
        && match &claude_group {
            Some(cg) => sift_groups.iter().all(|sg| sg == cg),
            None => {
                let first = &sift_groups[0];
                sift_groups.iter().all(|sg| sg == first)
            }
        };
    audit.has_telemetry_rules = has_datadog_logs_rule
        && !datadog_groups.is_empty()
        && match &claude_group {
            Some(cg) => datadog_groups.iter().all(|dg| dg == cg),
            None => {
                let first = &datadog_groups[0];
                datadog_groups.iter().all(|dg| dg == first)
            }
        };

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

pub(super) fn inspect_local_mihomo() -> MihomoAudit {
    let discovery = config_source::running_core_configs();
    if discovery.status == "confirmed" {
        if let Some(content) = discovery
            .paths
            .first()
            .and_then(|path| config_source::read_bounded_utf8(path, 2 * 1024 * 1024))
        {
            let after = config_source::running_core_configs();
            let mut audit = audit_mihomo_yaml_structure(&content, Some("mihomo"));
            audit.config_source = Some("running_core".into());
            audit.config_source_status = Some(
                if after.status == "confirmed"
                    && after.paths == discovery.paths
                    && after.process_stamps == discovery.process_stamps
                {
                    "confirmed"
                } else {
                    "ambiguous"
                }
                .into(),
            );
            return audit;
        }
        return MihomoAudit {
            config_source: Some("running_core".into()),
            config_source_status: Some("unreadable".into()),
            ..Default::default()
        };
    }
    for (kind, path) in candidate_mihomo_paths() {
        // 限制最大读取 2 MiB，拒绝超大异常文件或符号链接。
        if let Some(content) = config_source::read_bounded_utf8(&path, 2 * 1024 * 1024) {
            let mut audit = audit_mihomo_yaml_structure(&content, Some(kind));
            audit.config_source = Some("candidate_file".into());
            audit.config_source_status = Some(discovery.status.into());
            return audit;
        }
    }
    MihomoAudit {
        config_source_status: Some(discovery.status.into()),
        ..Default::default()
    }
}
