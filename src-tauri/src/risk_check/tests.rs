// [INPUT]: 合成 Mihomo YAML、中英文 ipconfig 样本、临时 Claude CLI 目录与回环 mock trace HTTP 服务。
// [OUTPUT]: 风控规则优先级/KYC/Sift/遥测分流、RFC1918 过滤、CLI 边界与出口分类器离线单元测试回归。
// [POS]: risk_check 单元测试子模块；不读取真实用户配置或发起外部网络请求。
// [PROTOCOL]: 变更时更新此头部，然后检查 risk_check/CLAUDE.md
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn mihomo_inline_resolvers_distinguish_domestic_encryption_and_plaintext() {
        let audit = audit_mihomo_yaml_structure("dns:\n    enable: true\n    nameserver: [https://dns.alidns.com/dns-query, tls://dot.pub, h3://resolver.example.invalid/dns-query#RULES]\ntun:\n    enable: true\n    strict-route: true\n", None);
        assert!(audit.dns_has_encrypted_resolver);
        assert!(audit.dns_has_domestic_encrypted);
        assert!(audit.dns_has_remote_doh);
        assert!(!audit.dns_has_domestic_plain);
        assert!(audit.dns_projection_complete);
        assert_eq!(audit.tun_strict_route, Some(true));
        let plain = audit_mihomo_yaml_structure("dns:\n  nameserver: [223.5.5.5, system]\n", None);
        assert!(plain.dns_has_domestic_plain);
        assert!(!plain.dns_has_encrypted_resolver);
        let serialized = serde_json::to_string(&audit).unwrap();
        assert!(!serialized.contains("resolver.example.invalid"));
        assert!(!serialized.contains("RULES"));
    }

    #[test]
    fn mihomo_projection_marks_unsupported_maps_aliases_and_nested_flags_uncertain() {
        for sample in ["dns: {enable: true, nameserver: [https://dns.google/dns-query]}", "dns:\n  nameserver: *resolvers\n", "dns:\n  nameserver: [https://dns.google/dns-query]\ntun:\n  options:\n    strict-route: true\n"] {
            let audit = audit_mihomo_yaml_structure(sample, None);
            assert!(!audit.dns_projection_complete);
            assert_eq!(audit.tun_strict_route, None);
        }
        let audit = audit_mihomo_yaml_structure("dns:\n  nameserver:\n    - 'https://custom.example.invalid/dns-query#RULES' # comment\n  enhanced-mode: fake-ip\nproxies:\n  - dns:\n      nameserver: system\n", None);
        assert!(audit.dns_has_remote_doh);
        assert!(!audit.dns_has_domestic_plain);
    }

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
        assert_eq!(
            parsed.lan_ipv4_candidates,
            vec!["192.168.31.88".to_string()]
        );
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
        assert_eq!(
            parsed.lan_ipv4_candidates,
            vec!["192.168.137.1".to_string()]
        );
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

    #[test]
    fn cli_security_dir_audit_detects_shield_proxy_and_mcp_risks() {
        let dir = std::env::temp_dir().join(format!(
            "claude-local-risk-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let claude_dir = dir.join(".claude");
        std::fs::create_dir_all(claude_dir.join("telemetry")).unwrap();
        std::fs::write(
            claude_dir.join("telemetry").join("1p_failed_events.sample.json"),
            "{}",
        )
        .unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            r#"{
                "env": {
                    "HTTP_PROXY": "http://127.0.0.1:7899",
                    "HTTPS_PROXY": "http://127.0.0.1:7899",
                    "ALL_PROXY": "http://127.0.0.1:7899",
                    "GRPC_PROXY": "http://127.0.0.1:7899",
                    "NO_PROXY": "localhost,127.0.0.1",
                    "DISABLE_TELEMETRY": "1",
                    "DISABLE_ERROR_REPORTING": "1",
                    "DO_NOT_TRACK": "1"
                }
            }"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude.json"),
            r#"{
                "mcpServers": {
                    "pinned": {"command": "cmd.exe", "args": ["/c", "npx", "-y", "@scope/pkg@1.2.3"]}
                },
                "projects": {
                    "D:/workspace/demo": {
                        "mcpServers": {
                            "unpinned": {"command": "npx", "args": ["-y", "@scope/pkg@latest"]},
                            "spoofedAt": {"command": "cmd.exe", "args": ["/c", "npx", "-y", "unpinned-pkg", "ops@example.invalid"]},
                            "wsLocal": {"url": "ws://127.0.0.1:9000/mcp"},
                            "wssRemote": {"url": "wss://mcp.example.invalid/ws"},
                            "remote": {"url": "https://mcp.example.invalid/sse"}
                        }
                    },
                    "d:\\workspace\\demo\\": {
                        "mcpServers": {
                            "dupSkipped": {"command": "npx", "args": ["-y", "dup-pkg"]}
                        }
                    }
                }
            }"#,
        )
        .unwrap();

        let audit = audit_claude_cli_security_dir(&dir);
        assert!(audit.settings_present);
        assert!(audit.telemetry_shield_active);
        assert!(!audit.nonessential_traffic_blocked);
        assert!(audit.proxy_env_complete);
        assert!(!audit.socks5_in_cli_env);
        assert!(!audit.non_english_language);
        assert!(!audit.has_custom_hooks_or_helpers);
        assert_eq!(audit.unpinned_npx_count, 2);
        assert_eq!(audit.windows_bare_npx_count, 1);
        assert_eq!(audit.remote_http_mcp_count, 2);
        assert_eq!(audit.pending_failed_telemetry_files, 1);

        // settings.local.json overrides settings.json env keys, detects non-English language & NO_PROXY bypass, and flags CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
        std::fs::write(
            claude_dir.join("settings.local.json"),
            r#"{
                "language": "zh-CN",
                "env": {
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                    "ALL_PROXY": "socks://127.0.0.1:7899",
                    "NO_PROXY": "localhost,.claude.ai"
                }
            }"#,
        )
        .unwrap();
        let blocked = audit_claude_cli_security_dir(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(blocked.nonessential_traffic_blocked);
        assert!(blocked.non_english_language);
        assert!(!blocked.telemetry_shield_active);
        assert!(blocked.socks5_in_cli_env);
        assert!(!blocked.proxy_env_complete);

        let mihomo = audit_mihomo_yaml_structure(
            "dns:\n  nameserver:\n    - https://1.12.12.12/dns-query\nrules:\n  - DOMAIN-KEYWORD,datadoghq,ClaudeGroup\n",
            None,
        );
        assert!(mihomo.has_telemetry_rules);
        assert!(mihomo.dns_has_domestic_encrypted);
        assert!(!mihomo.dns_has_remote_doh);

        // Same residential group with QUIC UDP-443 REJECT above claude.ai & datadoghq.com passes without false positive
        let aligned_tun = audit_mihomo_yaml_structure(
            "rules:\n  - AND,((NETWORK,UDP),(DST-PORT,443),(DOMAIN-SUFFIX,claude.ai)),REJECT\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n  - DOMAIN-SUFFIX,datadoghq.com,US-Residential\n  - IP-CIDR,104.16.0.0/13,Cloudflare\n",
            None,
        );
        assert!(aligned_tun.has_quic_reject);
        assert!(aligned_tun.has_claude_rules);
        assert!(aligned_tun.has_persona_rules);
        assert!(aligned_tun.has_telemetry_rules);

        // Split exit group (claude.ai -> US-Residential vs datadoghq.com -> JP-Residential) fails telemetry check
        let split_dd = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,datadoghq.com,JP-Residential\n",
            None,
        );
        assert!(!split_dd.has_telemetry_rules);

        // Missing datadoghq (only growthbook.io) or shadowed by non-no-resolve IP-CIDR fails telemetry check
        let missing_dd = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,growthbook.io,US-Residential\n",
            None,
        );
        assert!(!missing_dd.has_telemetry_rules);

        let shadowed_dd = audit_mihomo_yaml_structure(
            "rules:\n  - IP-CIDR,104.16.0.0/13,Cloudflare\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,datadoghq.com,US-Residential\n",
            None,
        );
        assert!(!shadowed_dd.has_telemetry_rules);

        // GEOSITE,anthropic aligned with datadoghq.com passes without requiring every vanity domain
        let geosite_aligned = audit_mihomo_yaml_structure(
            "rules:\n  - GEOSITE,anthropic,US-Residential\n  - DOMAIN-SUFFIX,datadoghq.com,US-Residential\n",
            None,
        );
        assert!(geosite_aligned.has_claude_rules);
        assert!(geosite_aligned.has_telemetry_rules);
    }

    #[test]
    fn exit_isp_multi_signal_classifier_recognizes_rcn_and_us_broadband_while_blocking_idc() {
        use crate::browser::network::{self, ExitKind};

        // 1. Live RCN / Astound Broadband (AS6079) payload without hosting boolean -> ResidentialIsp + enriched display
        let rcn_ipwho = serde_json::json!({
            "success": true,
            "type": "IPv4",
            "ip": "198.51.100.42",
            "country_code": "US",
            "city": "Washington",
            "timezone": { "id": "America/New_York" },
            "connection": {
                "asn": 6079,
                "org": "RCN",
                "isp": "RCN",
                "domain": "rcn.com"
            }
        });
        let rcn_exit = network::parse(&rcn_ipwho).unwrap();
        assert_eq!(network::classify_exit(&rcn_exit), ExitKind::ResidentialIsp);
        assert_eq!(rcn_exit.hosting, Some(false));
        assert_eq!(rcn_exit.asn.as_deref(), Some("AS6079"));
        assert_eq!(rcn_exit.isp, "RCN (Astound Broadband · AS6079)");

        // 2. Google Fiber (AS16591) is ResidentialIsp, whereas Google Cloud (AS15169 / AS396982) is Hosting!
        let gfiber = network::parse(&serde_json::json!({
            "ip": "198.51.100.43",
            "country_code": "US",
            "org": "Google Fiber Inc.",
            "asn": "AS16591"
        }))
        .unwrap();
        assert_eq!(network::classify_exit(&gfiber), ExitKind::ResidentialIsp);
        assert_eq!(gfiber.hosting, Some(false));
        assert_eq!(gfiber.isp, "Google Fiber Inc. (AS16591)");

        let gcloud = network::parse(&serde_json::json!({
            "ip": "198.51.100.44",
            "country_code": "US",
            "org": "Google Cloud",
            "asn": "AS15169",
            "hosting": false
        }))
        .unwrap();
        assert_eq!(network::classify_exit(&gcloud), ExitKind::Hosting);
        assert_eq!(gcloud.hosting, Some(true));

        // 3. Hard IDC / Transit blocklist wins first (M247 AS9009, Cogent AS174, Hurricane Electric AS6939, Choopa AS20473)
        for (org, asn) in [
            ("M247 Europe SRL", "AS9009"),
            ("Cogent Communications", "AS174"),
            ("Hurricane Electric LLC", "AS6939"),
            ("The Constant Company, LLC", "AS20473"),
            ("ColoCrossing", "AS36352"),
            ("Hostinger International Limited", "AS47583"),
        ] {
            let idc = network::parse(&serde_json::json!({
                "ip": "198.51.100.45",
                "country_code": "US",
                "org": org,
                "asn": asn
            }))
            .unwrap();
            assert_eq!(
                network::classify_exit(&idc),
                ExitKind::Hosting,
                "expected Hosting for {org} ({asn})"
            );
            assert_eq!(idc.hosting, Some(true));
        }

        // 4. Major US & regional residential ISPs resolve to ResidentialIsp without ipquery
        for (org, asn) in [
            ("Astound Broadband", "AS6079"),
            ("Wave Broadband", "AS11404"),
            ("Comcast Cable Communications, LLC", "AS7922"),
            ("Charter Communications Inc", "AS20115"),
            ("AT&T Services, Inc.", "AS7018"),
            ("MCI Communications Services, Inc. d/b/a Verizon Business", "AS701"),
            ("Cox Communications Inc.", "AS22773"),
            ("Cablevision Systems Corp.", "AS6128"),
            ("Frontier Communications of America, Inc.", "AS5650"),
            ("CenturyLink Communications, LLC", "AS209"),
            ("Ziply Fiber", "AS20055"),
            ("Sonic.net, Inc.", "AS46375"),
            ("SpaceX Starlink", "AS14593"),
            ("Chunghwa Telecom Co., Ltd.", "AS3462"),
            ("Open Computer Network", "AS4713"),
        ] {
            let res = network::parse(&serde_json::json!({
                "ip": "198.51.100.46",
                "country_code": "US",
                "org": org,
                "asn": asn
            }))
            .unwrap();
            assert_eq!(
                network::classify_exit(&res),
                ExitKind::ResidentialIsp,
                "expected ResidentialIsp for {org} ({asn})"
            );
            assert_eq!(res.hosting, Some(false));
        }
    }

    #[test]
    fn mihomo_audit_recognizes_yoti_rules_and_rejects_persona_yoti_group_mismatch() {
        let yoti_domain = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,yoti.com,US-Residential\n",
            None,
        );
        assert!(yoti_domain.has_claude_rules);
        assert!(yoti_domain.has_persona_rules);

        let yoti_keyword_only = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-KEYWORD,yoti,US-Residential\n",
            None,
        );
        assert!(!yoti_keyword_only.has_claude_rules);
        assert!(yoti_keyword_only.has_persona_rules);

        let both_aligned = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n  - DOMAIN-SUFFIX,yoti.com,US-Residential\n",
            None,
        );
        assert!(both_aligned.has_persona_rules);

        let both_aligned_without_claude = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n  - DOMAIN-KEYWORD,yoti,US-Residential\n",
            None,
        );
        assert!(both_aligned_without_claude.has_persona_rules);

        let mismatch_with_claude = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n  - DOMAIN-SUFFIX,yoti.com,JP-Residential\n",
            None,
        );
        assert!(!mismatch_with_claude.has_persona_rules);

        let mismatch_without_claude = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n  - DOMAIN-KEYWORD,yoti,JP-Residential\n",
            None,
        );
        assert!(!mismatch_without_claude.has_persona_rules);

        let yoti_mismatch_claude = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,yoti.com,JP-Residential\n",
            None,
        );
        assert!(!yoti_mismatch_claude.has_persona_rules);
    }

    #[test]
    fn mihomo_audit_recognizes_sift_rules_and_rejects_mismatch_or_ip_shadowing() {
        let aligned = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,sift.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-cdn.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-analytics.com,US-Residential\n",
            None,
        );
        assert!(aligned.has_claude_rules);
        assert!(aligned.has_sift_rules);

        let missing_sift = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,withpersona.com,US-Residential\n",
            None,
        );
        assert!(missing_sift.has_claude_rules);
        assert!(!missing_sift.has_sift_rules);

        let split_group_mismatch = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,sift.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-cdn.com,JP-Residential\n",
            None,
        );
        assert!(split_group_mismatch.has_claude_rules);
        assert!(!split_group_mismatch.has_sift_rules);

        let shadowed_by_unresolved_ip = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - IP-CIDR,104.16.0.0/13,Cloudflare\n  - DOMAIN-SUFFIX,sift.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-cdn.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-analytics.com,US-Residential\n",
            None,
        );
        assert!(shadowed_by_unresolved_ip.has_claude_rules);
        assert!(!shadowed_by_unresolved_ip.has_sift_rules);

        let sift_only_missing_hexagon = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,sift.com,US-Residential\n",
            None,
        );
        assert!(!sift_only_missing_hexagon.has_sift_rules);

        let hexagon_only_missing_sift = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,hexagon-cdn.com,US-Residential\n",
            None,
        );
        assert!(!hexagon_only_missing_sift.has_sift_rules);

        let keyword_sift_hexagon = audit_mihomo_yaml_structure(
            "rules:\n  - DOMAIN-KEYWORD,sift,US-Residential\n  - DOMAIN-KEYWORD,hexagon,US-Residential\n",
            None,
        );
        assert!(keyword_sift_hexagon.has_sift_rules);

        // Out-of-order rules: before prepend-rules: must not poison higher-precedence prepend-rules,
        // and RFC1918 private CIDRs without no-resolve are exempted cleanly.
        let ordered_sections_and_rfc1918 = audit_mihomo_yaml_structure(
            "rules:\n  - IP-CIDR,104.16.0.0/13,Cloudflare\nprepend-rules:\n  - IP-CIDR,10.0.0.0/8,DIRECT\n  - IP-CIDR,172.16.0.0/12,DIRECT\n  - IP-CIDR,192.168.0.0/16,DIRECT\n  - DOMAIN-SUFFIX,claude.ai,US-Residential\n  - DOMAIN-SUFFIX,sift.com,US-Residential\n  - DOMAIN-SUFFIX,hexagon-cdn.com,US-Residential\n",
            None,
        );
        assert!(ordered_sections_and_rfc1918.has_claude_rules);
        assert!(ordered_sections_and_rfc1918.has_sift_rules);
    }

    #[test]
    fn cli_security_parity_checks_loopback_proxy_no_proxy_and_custom_scheme_mcp() {
        let dir = std::env::temp_dir().join(format!(
            "claude-local-risk-parity-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let claude_dir = dir.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            r#"{
                "env": {
                    "HTTP_PROXY": "http://[::1]:7899",
                    "HTTPS_PROXY": "http://localhost:7899",
                    "ALL_PROXY": "http://127.0.0.1:7899",
                    "GRPC_PROXY": "http://::1:7899",
                    "NO_PROXY": "localhost,127.0.0.1",
                    "DISABLE_TELEMETRY": "1",
                    "DISABLE_ERROR_REPORTING": "1",
                    "DO_NOT_TRACK": "1"
                }
            }"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude.json"),
            r#"{
                "mcpServers": {
                    "localV6": {"url": "http://[::1]:8080/mcp"},
                    "customScheme": {"url": "grpc://mcp.invalid/svc"}
                }
            }"#,
        )
        .unwrap();
        let audit = audit_claude_cli_security_dir(&dir);
        assert!(audit.proxy_env_complete);
        assert_eq!(audit.remote_http_mcp_count, 1);

        // Omitting either localhost or 127.0.0.1 fails NO_PROXY loopback check (parity with risk-model.ts).
        for np in ["192.168.1.0/24", "localhost", "127.0.0.1"] {
            std::fs::write(
                claude_dir.join("settings.local.json"),
                serde_json::json!({"env": {"NO_PROXY": np}}).to_string(),
            )
            .unwrap();
            let res = audit_claude_cli_security_dir(&dir);
            assert!(!res.proxy_env_complete, "NO_PROXY={np} must not pass");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
