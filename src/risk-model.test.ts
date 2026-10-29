import {expect, test} from 'bun:test';
import {translate} from './i18n';
import {encodeQrMatrix, renderQrSvgPath} from './qrcode-svg';
import {
  buildCloseLanBridgePrompt,
  buildDesktopDnsFixPrompt,
  buildMobileBridgeConfig,
  buildShadowrocketSocksQrUri,
  buildShadowrocketUniversalAntiLeakConf,
  buildStandaloneMobilePrompt,
  evaluateRiskChecks,
  generateBridgeCredentials,
  isValidBridgePort,
  isValidRfc1918Ipv4,
  maskIpAddress,
  parsePortInput,
  summarizeRiskChecks,
  type ConsistencyProbeReport,
  type LocalRiskSnapshot,
} from './risk-model';

test('RFC1918 validator strictly accepts private LAN hosts and rejects WAN, loopback, WSL network base and Fake-IP', () => {
  expect(isValidRfc1918Ipv4('192.168.1.25')).toBe(true);
  expect(isValidRfc1918Ipv4('10.0.1.0')).toBe(true);
  expect(isValidRfc1918Ipv4('172.16.0.1')).toBe(true);
  expect(isValidRfc1918Ipv4('172.31.255.254')).toBe(true);

  expect(isValidRfc1918Ipv4('127.0.0.1')).toBe(false);
  expect(isValidRfc1918Ipv4('198.18.0.1')).toBe(false);
  expect(isValidRfc1918Ipv4('198.19.1.2')).toBe(false);
  expect(isValidRfc1918Ipv4('169.254.10.20')).toBe(false);
  expect(isValidRfc1918Ipv4('100.64.0.1')).toBe(false);
  expect(isValidRfc1918Ipv4('8.8.8.8')).toBe(false);
  expect(isValidRfc1918Ipv4('172.15.1.1')).toBe(false);
  expect(isValidRfc1918Ipv4('172.32.1.1')).toBe(false);
  expect(isValidRfc1918Ipv4('192.168.01.2')).toBe(false);
  expect(isValidRfc1918Ipv4('192.168.0.0')).toBe(false);
  expect(isValidRfc1918Ipv4('192.168.255.255')).toBe(false);
  expect(isValidBridgePort(7899)).toBe(true);
  expect(isValidBridgePort(80)).toBe(false);
  expect(isValidBridgePort(70000)).toBe(false);
});

test('IP masking respects privacy toggle across IPv4 and IPv6', () => {
  expect(maskIpAddress('198.51.100.42', false)).toBe('198.51.100.42');
  expect(maskIpAddress('198.51.100.42', true)).toBe('198.51.*.*');
  expect(maskIpAddress('2001:db8:85a3::8a2e:370:7334', true)).toBe('2001:db8:*:*');
  expect(maskIpAddress(null, true)).toBe('—');
});

test('ephemeral bridge credentials contain only unambiguous URL-safe characters', () => {
  const creds = generateBridgeCredentials();
  expect(creds.username).toMatch(/^kyc[A-HJ-NP-Za-km-z2-9]{6}$/);
  expect(creds.password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
});

test('evaluateRiskChecks catches KYC split-routing (US != JP) and domestic plaintext DNS leaks', () => {
  const leakyLocal: LocalRiskSnapshot = {
    browser: {
      proxy_configured: false,
      proxy_scheme: null,
      proxy_local_port: null,
      remote_dns_locked: false,
      target_country: 'US',
      target_timezone: 'America/Los_Angeles',
      target_language: 'en-US',
    },
    mihomo: {
      detected: true,
      client_kind: 'clash-verge-rev',
      mixed_port: 7897,
      allow_lan: false,
      tun_enabled: true,
      tun_strict_route: false,
      dns_enabled: true,
      dns_enhanced_mode: 'fake-ip',
      dns_respect_rules: false,
      dns_has_remote_doh: false,
      dns_has_domestic_plain: true,
      dns_has_nameserver_policy: false,
      has_claude_rules: true,
      has_persona_rules: false,
      has_quic_reject: false,
      has_geoip_cn: true,
      dedicated_listener_port: null,
    },
    system: {
      tun_adapter_active: true,
      secondary_plaintext_dns_active: true,
      lan_ipv4_candidates: [],
      public_wan_detected: true,
    },
  };

  const splitProbe: ConsistencyProbeReport = {
    claude: {domain: 'claude.ai', ok: true, country: 'US', colo: 'IAD', ip: '198.51.100.18', latency_ms: 210, error: null},
    persona: {domain: 'withpersona.com', ok: true, country: 'JP', colo: 'NRT', ip: '203.0.113.77', latency_ms: 85, error: null},
    unlisted_dns: {domain: 'cloudflare-dns.com', ok: true, country: 'JP', colo: 'NRT', ip: '203.0.113.77', latency_ms: 82, error: null},
    exit_isp: {ip: '198.51.100.18', country: 'US', city: 'Ashburn', timezone: 'America/New_York', isp: 'Example Cloud Hosting LLC', hosting: true},
    same_country: false,
    same_exit_ip: false,
    unlisted_same_country: false,
  };

  const checks = evaluateRiskChecks(leakyLocal, splitProbe, true);
  expect(summarizeRiskChecks(checks)).toBe('fail');
  const byId = Object.fromEntries(checks.map(c => [c.id, c]));
  expect(byId.claude_exit.status).toBe('ok');
  expect(byId.claude_exit.summaryParams?.ip).toBe('198.51.*.*');
  expect(byId.persona_consistency.status).toBe('fail');
  expect(byId.persona_consistency.summaryKey).toBe('risk.check.personaConsistency.countryMismatch');
  expect(byId.browser_dns_lock.status).toBe('warn');
  expect(byId.mihomo_dns_leak.status).toBe('fail');
  expect(byId.kyc_routing_rules.status).toBe('fail');
  expect(byId.exit_isp_kind.status).toBe('fail');
});

test('evaluateRiskChecks passes all 6 checks when hardened residential listener and remote DoH align', () => {
  const hardenedLocal: LocalRiskSnapshot = {
    browser: {
      proxy_configured: true,
      proxy_scheme: 'socks5',
      proxy_local_port: 7899,
      remote_dns_locked: true,
      target_country: 'US',
      target_timezone: 'America/Los_Angeles',
      target_language: 'en-US',
    },
    mihomo: {
      detected: true,
      client_kind: 'clash-verge-rev',
      mixed_port: 7897,
      allow_lan: false,
      tun_enabled: true,
      tun_strict_route: true,
      dns_enabled: true,
      dns_enhanced_mode: 'fake-ip',
      dns_respect_rules: true,
      dns_has_remote_doh: true,
      dns_has_domestic_plain: false,
      dns_has_nameserver_policy: true,
      has_claude_rules: true,
      has_persona_rules: true,
      has_quic_reject: true,
      has_geoip_cn: true,
      dedicated_listener_port: 7899,
    },
    system: {
      tun_adapter_active: true,
      secondary_plaintext_dns_active: false,
      lan_ipv4_candidates: ['192.168.31.10'],
      public_wan_detected: false,
    },
  };

  const alignedProbe: ConsistencyProbeReport = {
    claude: {domain: 'claude.ai', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 180, error: null},
    persona: {domain: 'withpersona.com', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 184, error: null},
    unlisted_dns: {domain: 'cloudflare-dns.com', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 179, error: null},
    exit_isp: {ip: '198.51.100.24', country: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles', isp: 'Charter Communications', hosting: false},
    same_country: true,
    same_exit_ip: true,
    unlisted_same_country: true,
  };

  const checks = evaluateRiskChecks(hardenedLocal, alignedProbe, false);
  expect(summarizeRiskChecks(checks)).toBe('ok');
  for (const item of checks) {
    expect(item.status).toBe('ok');
  }
});

test('buildMobileBridgeConfig generates hardened profiles for all 4 mobile clients and blocks non-RFC1918 IPs', () => {
  const creds = {username: 'kycAbc234', password: 'PassWord23456789'};
  expect(buildMobileBridgeConfig({client: 'shadowrocket', lanIp: '8.8.8.8', port: 7899, ...creds})).toBeNull();
  expect(buildMobileBridgeConfig({client: 'clash-mi', lanIp: '198.18.0.1', port: 7899, ...creds})).toBeNull();

  const sr = buildMobileBridgeConfig({client: 'shadowrocket', lanIp: '192.168.31.18', port: 7899, ...creds});
  expect(sr).not.toBeNull();
  expect(sr!.qrUri.startsWith('socks5://')).toBe(true);
  expect(sr!.configText).toContain('AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP');
  expect(sr!.configText).toContain('CL-PC-Residential = socks5, 192.168.31.18, 7899, kycAbc234, PassWord23456789');

  const cm = buildMobileBridgeConfig({client: 'clash-mi', lanIp: '192.168.31.18', port: 7899, ...creds});
  expect(cm).not.toBeNull();
  expect(cm!.configText).toContain('strict-route: true');
  expect(cm!.configText).toContain('AND,((NETWORK,UDP),(DST-PORT,443)),REJECT');
  expect(cm!.configText).toContain('IP-CIDR,192.168.0.0/16,DIRECT,no-resolve');

  const stash = buildMobileBridgeConfig({client: 'stash', lanIp: '192.168.31.18', port: 7899, ...creds});
  expect(stash).not.toBeNull();
  expect(stash!.filename).toBe('claude-local-kyc-stash.yaml');

  const sb = buildMobileBridgeConfig({client: 'sing-box', lanIp: '192.168.31.18', port: 7899, ...creds});
  expect(sb).not.toBeNull();
  const parsed = JSON.parse(sb!.configText);
  expect(parsed.outbounds[0].server).toBe('192.168.31.18');
  expect(parsed.outbounds[0].network).toBe('tcp');
  expect(parsed.route.rules[1].port).toEqual([443, 3478, 19302]);

  const matrix = encodeQrMatrix(sr!.qrUri);
  expect(matrix.length).toBeGreaterThanOrEqual(21);
  // Top-left 7x7 finder outer corner modules are dark
  expect(matrix[0][0]).toBe(true);
  expect(matrix[0][6]).toBe(true);
  expect(matrix[6][0]).toBe(true);
  expect(matrix[3][3]).toBe(true);
  const svg = renderQrSvgPath(matrix);
  expect(svg.viewBoxSize).toBe(matrix.length + 4);
  expect(svg.path.startsWith('M')).toBe(true);
});

test('Shadowrocket standalone SOCKS5 QR generator produces RFC 3986 socks5:// authority URI, sanitizes config pastes, and builds zero-secret anti-leak conf', () => {
  expect(buildShadowrocketSocksQrUri({host: '', port: 1080})).toBeNull();
  expect(buildShadowrocketSocksQrUri({host: 'bad host\nname', port: 1080})).toBeNull();
  expect(buildShadowrocketSocksQrUri({host: 'res.example.invalid', port: 70000})).toBeNull();
  expect(parsePortInput('')).toBeNaN();
  expect(parsePortInput(' "10808", ')).toBe(10808);
  expect(parsePortInput('7899,')).toBe(7899);

  const uri = buildShadowrocketSocksQrUri({
    host: ' "res.example.invalid", ',
    port: parsePortInput('10808,'),
    username: ' "user_01", ',
    password: '"pw+slash/eq=",',
    remarks: 'US-Static-Residential',
  });
  expect(uri).not.toBeNull();
  expect(uri!.startsWith('socks5://')).toBe(true);
  const parsed = new URL(uri!);
  expect(parsed.hostname).toBe('res.example.invalid');
  expect(parsed.port).toBe('10808');
  expect(decodeURIComponent(parsed.username)).toBe('user_01');
  expect(decodeURIComponent(parsed.password)).toBe('pw+slash/eq=');
  expect(parsed.searchParams.get('remarks')).toBe('US-Static-Residential');
  expect(encodeQrMatrix(uri!).length).toBeGreaterThanOrEqual(25);

  const conf = buildShadowrocketUniversalAntiLeakConf();
  expect(conf.filename).toBe('claude-local-kyc-shadowrocket-antileak.conf');
  expect(conf.configText).toContain('ipv6 = false');
  expect(conf.configText).toContain('udp-policy-not-supported-behaviour = REJECT');
  expect(conf.configText).toContain('dns-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query');
  expect(conf.configText).toContain('AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP');
  expect(conf.configText).toContain('FINAL,PROXY,dns-failed');
  expect(conf.configText).not.toContain('user_01');
});

test('AI remediation prompts cover desktop DNS/Persona fix, campus route exclusions, LAN lockdown and standalone campus mode in both locales', () => {
  const zhFix = buildDesktopDnsFixPrompt({locale: 'zh', dedicatedPort: 7899, enableLanBridge: true, lanUsername: 'kycAbc234', lanPassword: 'PassWord23456789'});
  expect(zhFix).toContain('withpersona.com');
  expect(zhFix).toContain('persona.org');
  expect(zhFix).toContain('respect-rules: true');
  expect(zhFix).toContain('https://1.1.1.1/dns-query');
  expect(zhFix).toContain('inet4-route-exclude-address');
  expect(zhFix).toContain('7899');
  expect(zhFix).toContain('kycAbc234');

  const enFix = buildDesktopDnsFixPrompt({locale: 'en', dedicatedPort: 7899, enableLanBridge: false});
  expect(enFix).toContain('listen: 127.0.0.1');
  expect(enFix).toContain('https://1.1.1.1/dns-query');
  expect(enFix).toContain('inet4-route-exclude-address');
  expect(enFix).not.toMatch(/[\u3400-\u9fff]/);

  const enClose = buildCloseLanBridgePrompt(7899, 'en');
  expect(enClose).toContain('listen: 127.0.0.1');
  expect(enClose).not.toMatch(/[\u3400-\u9fff]/);

  const zhStandalone = buildStandaloneMobilePrompt({client: 'shadowrocket', targetTimezone: 'America/New_York', locale: 'zh'});
  expect(zhStandalone).toContain('Shadowrocket (iOS)');
  expect(zhStandalone).toContain('America/New_York');
});

test('all dynamic diagnostic keys resolve in both zh and en without unresolved placeholders', () => {
  const sampleChecks = [
    ...evaluateRiskChecks(null, null, false),
    ...evaluateRiskChecks(
      {
        browser: {
          proxy_configured: true,
          proxy_scheme: 'http',
          proxy_local_port: 7897,
          remote_dns_locked: false,
          target_country: 'US',
          target_timezone: 'America/Los_Angeles',
          target_language: 'en-US',
        },
        mihomo: {
          detected: false,
          client_kind: null,
          mixed_port: null,
          allow_lan: null,
          tun_enabled: null,
          tun_strict_route: null,
          dns_enabled: null,
          dns_enhanced_mode: null,
          dns_respect_rules: null,
          dns_has_remote_doh: false,
          dns_has_domestic_plain: false,
          dns_has_nameserver_policy: false,
          has_claude_rules: false,
          has_persona_rules: false,
          has_quic_reject: false,
          has_geoip_cn: false,
          dedicated_listener_port: null,
        },
        system: {
          tun_adapter_active: true,
          secondary_plaintext_dns_active: true,
          lan_ipv4_candidates: [],
          public_wan_detected: false,
        },
      },
      {
        claude: {domain: 'claude.ai', ok: true, country: 'GB', colo: 'LHR', ip: '198.51.100.3', latency_ms: 90, error: null},
        persona: {domain: 'withpersona.com', ok: true, country: 'GB', colo: 'LHR', ip: '198.51.100.9', latency_ms: 95, error: null},
        unlisted_dns: {domain: 'cloudflare-dns.com', ok: true, country: 'JP', colo: 'NRT', ip: '203.0.113.5', latency_ms: 60, error: null},
        exit_isp: {ip: '198.51.100.3', country: 'GB', city: 'London', timezone: 'Europe/London', isp: ''},
        same_country: true,
        same_exit_ip: false,
        unlisted_same_country: false,
      },
      false,
    ),
  ];

  for (const locale of ['zh', 'en'] as const) {
    for (const item of sampleChecks) {
      const title = translate(item.titleKey, {}, locale);
      const summary = translate(item.summaryKey, item.summaryParams, locale);
      expect(title).not.toBe(item.titleKey);
      expect(summary).not.toBe(item.summaryKey);
      expect(summary).not.toMatch(/\{\w+\}/);
    }
  }
});
