import {expect, test} from 'bun:test';
import {translate} from './i18n';
import {encodeQrMatrix, renderQrSvgPath} from './qrcode-svg';
import {
  areCliAndBrowserProxiesAligned,
  auditClaudeCliSecurityBoundary,
  buildClaudeCliAntiLeakSettingsJson,
  buildCloseLanBridgePrompt,
  buildDesktopDnsFixPrompt,
  buildDesktopMihomoAntiLeakYaml,
  buildMihomoStrictRouteSnippet,
  buildMobileBridgeConfig,
  buildMultiPortClashYaml,
  buildShadowrocketSocksQrUri,
  buildShadowrocketUniversalAntiLeakConf,
  buildStandaloneMobilePrompt,
  classifyRiskExitIsp,
  evaluateRiskChecks,
  formatExitIspLabel,
  compareProbeExits,
  isCliMcpBoundarySafe,
  isCliSecurityShieldOk,
  isCurrentRiskProbe,
  generateBridgeCredentials,
  isValidBridgePort,
  isValidRfc1918Ipv4,
  maskIpAddress,
  normalizeProxyEndpoint,
  parsePortInput,
  resolveRiskBanner,
  summarizeRiskChecks,
  toBrowserSocks5ProxyFromCli,
  toCliHttpProxy,
  type ConsistencyProbeReport,
  type LocalRiskSnapshot,
} from './risk-model';
import {createWarmingDraft, editWarmingDraft, warmingStageSopKey} from './warming-model';
import {buildAiProxyPrompt} from './vps';

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

test('bridge credentials fail closed when secure randomness is unavailable or throws', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: undefined});
    expect(() => generateBridgeCredentials()).toThrow('risk_secure_random_unavailable');
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {getRandomValues() {throw new Error('synthetic RNG failure');}}});
    expect(() => generateBridgeCredentials()).toThrow('risk_secure_random_unavailable');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('evaluateRiskChecks distinguishes HTTP country split from static domestic DNS risk', () => {
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
  expect(byId.mihomo_dns_leak.status).toBe('warn');
  expect(byId.kyc_routing_rules.status).toBe('pending');
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
      config_source: 'running_core',
      config_source_status: 'confirmed',
      dns_projection_complete: true,
      dns_has_encrypted_resolver: true,
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

  const dnsCheck = (changes: Partial<LocalRiskSnapshot['mihomo']>, report = alignedProbe) => evaluateRiskChecks(
    {...hardenedLocal, mihomo: {...hardenedLocal.mihomo, ...changes}}, report,
  ).find(item => item.id === 'mihomo_dns_leak')!;
  const strictOnly = dnsCheck({tun_strict_route: false});
  expect(strictOnly.status).toBe('warn');
  expect(strictOnly.summaryKey).toBe('risk.check.mihomoDnsLeak.strictRouteDisabled');
  expect(strictOnly.detailKeys).toEqual([]);
  expect(dnsCheck({tun_strict_route: null}).status).toBe('pending');
  expect(dnsCheck({dns_respect_rules: null}).status).toBe('pending');
  expect(dnsCheck({dns_enabled: false}).status).toBe('warn');
  expect(dnsCheck({dns_has_encrypted_resolver: false, dns_has_remote_doh: false}).summaryKey).toBe('risk.check.mihomoDnsLeak.noEncryptedDns');
  expect(dnsCheck({dns_has_remote_doh: false, dns_has_domestic_encrypted: true}).summaryKey).toBe('risk.check.mihomoDnsLeak.domesticEncryptedDns');
  expect(dnsCheck({dns_projection_complete: false}).status).toBe('pending');
  expect(dnsCheck({config_source: 'candidate_file', config_source_status: 'not_running'}).status).toBe('pending');
  expect(dnsCheck({config_source: undefined, config_source_status: undefined}).status).toBe('pending');
  const unknown = {...alignedProbe, same_country: null, same_exit_ip: null};
  expect(compareProbeExits(unknown)).toBe('unknown');
  expect(evaluateRiskChecks(hardenedLocal, unknown).find(item => item.id === 'persona_consistency')?.status).toBe('pending');
  expect(evaluateRiskChecks(hardenedLocal, {...alignedProbe, claude: {...alignedProbe.claude, country: null}}).find(item => item.id === 'claude_exit')?.status).toBe('pending');
  const diffIp = {...alignedProbe, persona: {...alignedProbe.persona, ip: '198.51.100.25'}, same_exit_ip: false};
  expect(compareProbeExits(diffIp)).toBe('same_country');
  expect(evaluateRiskChecks(hardenedLocal, diffIp).find(item => item.id === 'persona_consistency')?.status).toBe('warn');
  expect(isCurrentRiskProbe({...hardenedLocal, context_id: 'slot-a'}, {...alignedProbe, context_id: 'slot-b'})).toBe(false);
  expect(isCurrentRiskProbe({...hardenedLocal, context_id: 'slot-a'}, {...alignedProbe, context_id: 'slot-a'})).toBe(true);
  expect(isCurrentRiskProbe(hardenedLocal, alignedProbe)).toBe(false);
  for (const item of [strictOnly, dnsCheck({tun_strict_route: null}), dnsCheck({dns_respect_rules: null}), dnsCheck({dns_enabled: false}), dnsCheck({dns_projection_complete: false}), dnsCheck({dns_has_remote_doh: false, dns_has_domestic_encrypted: true}), dnsCheck({dns_has_encrypted_resolver: false, dns_has_remote_doh: false})]) {
    for (const locale of ['zh', 'en'] as const) {
      for (const key of [item.summaryKey, ...(item.detailKeys ?? [])]) expect(translate(key, {}, locale)).not.toBe(key);
    }
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

  for (const profileText of [sr!.configText, cm!.configText, stash!.configText, sb!.configText]) {
    expect(profileText).toContain('browser-intake-us5-datadoghq.com');
    expect(profileText).toContain('growthbook.io');
    expect(profileText).toContain('claude.com');
    expect(profileText).toContain('withpersona.com');
    expect(profileText).toContain('yoti.com');
    expect(profileText).toContain('hexagon-cdn.com');
    expect(profileText).toContain('hexagon-analytics.com');
  }

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
  expect(conf.configText).toContain('browser-intake-us5-datadoghq.com');
  expect(conf.configText).toContain('growthbook.io');
  expect(conf.configText).toContain('claude.com');
  expect(conf.configText).toContain('withpersona.com');
  expect(conf.configText).toContain('yoti.com');
  expect(conf.configText).toContain('hexagon-cdn.com');
  expect(conf.configText).toContain('hexagon-analytics.com');
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
  expect(zhStandalone).toContain('yoti.com');
  expect(zhStandalone).toContain('hexagon-cdn.com');
  expect(zhStandalone).toContain('hexagon-analytics.com');

  const enStandalone = buildStandaloneMobilePrompt({client: 'clash-mi', targetTimezone: 'America/Los_Angeles', locale: 'en'});
  expect(enStandalone).toContain('yoti.com');
  expect(enStandalone).toContain('hexagon-cdn.com');
  expect(enStandalone).toContain('hexagon-analytics.com');
  expect(enStandalone).not.toMatch(/[\u3400-\u9fff]/);

  for (const locale of ['zh', 'en'] as const) {
    const prompt = buildAiProxyPrompt(locale);
    const lines = prompt.trim().split(/\r?\n/).filter(line => line.trim());
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(prompt).toMatch(/iKuuu/i);
    expect(prompt).toMatch(/Kookeey/i);
    expect(prompt).toMatch(/Clash Verge Rev/i);
    expect(prompt).toMatch(/SOCKS5/i);
    expect(prompt).toMatch(/dialer-proxy/);
    expect(prompt).toMatch(/Merge\.yaml/);
    expect(prompt).toMatch(/config\.yaml/);
    expect(prompt).toMatch(/tun\.strict-route/);
    expect(prompt).toMatch(/claudeusercontent\.com/);
    expect(prompt).toMatch(/withpersona\.com/);
    expect(prompt).toMatch(/persona\.org/);
    expect(prompt).toMatch(/yoti\.com/);
    expect(prompt).toMatch(/hexagon-cdn\.com/);
    expect(prompt).toMatch(/hexagon-analytics\.com/);
    expect(prompt).toMatch(/ippure\.com/);
    expect(prompt).toMatch(/198\.18\.0\.0\/15/);
    expect(prompt).toMatch(/https:\/\/1\.1\.1\.1\/dns-query/);
    expect(prompt).toMatch(/3478\/19302\/5349/);
    expect(prompt).toMatch(/socks5:\/\/127\.0\.0\.1:7899/);
    expect(prompt).toMatch(/美国.*静态.*(?:住宅|家宽)|US static residential/i);
    expect(prompt).not.toMatch(/function\s+main|tcp-concurrent|mixed-port|7890|proxy-providers|listeners\s*:|rules\s*[:=]|<PASSWORD>|<USERNAME>/i);
  }
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

test('buildMihomoStrictRouteSnippet and strict-route detection flag tun_strict_route === false', () => {
  const snippet = buildMihomoStrictRouteSnippet();
  expect(snippet).toBe('tun:\n  enable: true\n  strict-route: true');

  const checks = evaluateRiskChecks(
    {
      browser: {
        proxy_configured: true,
        proxy_scheme: 'socks5',
        proxy_local_port: 17899,
        remote_dns_locked: true,
        target_country: 'US',
        target_timezone: 'America/Los_Angeles',
        target_language: 'en-US',
      },
      mihomo: {
        config_source: 'running_core',
        config_source_status: 'confirmed',
        dns_projection_complete: true,
        dns_has_encrypted_resolver: true,
        dns_has_domestic_encrypted: false,
        detected: true,
        client_kind: 'Clash Verge Rev',
        mixed_port: 7897,
        allow_lan: false,
        tun_enabled: true,
        tun_strict_route: false,
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
        dedicated_listener_port: 17899,
      },
      system: {
        tun_adapter_active: true,
        secondary_plaintext_dns_active: false,
        lan_ipv4_candidates: ['192.168.1.10'],
        public_wan_detected: false,
      },
    },
    null,
    false,
  );
  const dnsCheck = checks.find(item => item.id === 'mihomo_dns_leak');
  expect(dnsCheck?.status).toBe('warn');
  expect(dnsCheck?.summaryKey).toBe('risk.check.mihomoDnsLeak.strictRouteDisabled');

  expect(warmingStageSopKey('unregistered', 1)).toBe('identities.warming.sop.unregistered');
  expect(warmingStageSopKey('kyc_passed', 2)).toBe('identities.warming.sop.kycEarly');
  expect(warmingStageSopKey('kyc_passed', 5)).toBe('identities.warming.sop.kycPassed');
  expect(warmingStageSopKey('warming_free', 3)).toBe('identities.warming.sop.kycEarly');
  expect(warmingStageSopKey('warming_free', 6)).toBe('identities.warming.sop.warmingFree');
  expect(warmingStageSopKey('pro_ready', 10)).toBe('identities.warming.sop.proReady');

  const draft = createWarmingDraft('2026-10-30');
  expect(draft.registeredCountry).toBe('');
  expect(draft.registeredTimezone).toBe('');
  const edited = editWarmingDraft({
    id: '10000000000000000000000000000001',
    name: 'Test Card',
    email: 'a@b.c',
    note: null,
    stage: 'warming_free',
    created_ymd: '2026-10-25',
    last_warmed_ymd: '2026-10-30',
    created_at: 1,
    updated_at: 2,
    slot: 'warming-slot-1',
    seed: 1234,
    browser_active: false,
    registered_country: 'JP',
    registered_timezone: 'Asia/Tokyo',
  });
  expect(edited.registeredCountry).toBe('JP');
  expect(edited.registeredTimezone).toBe('Asia/Tokyo');

  const desktopYaml = buildDesktopMihomoAntiLeakYaml(17899);
  expect(desktopYaml.configText).toContain('ipv6: false');
  expect(desktopYaml.configText).toContain('claude.com');
  expect(desktopYaml.configText).toContain('claudemcpcontent.com');
  expect(desktopYaml.configText).toContain('persona.com');
  expect(desktopYaml.configText).toContain('stripecdn.com');
  expect(desktopYaml.configText).toContain('paypal.com');
  expect(desktopYaml.configText).toContain('paypalobjects.com');
  expect(desktopYaml.configText).toContain('braintreegateway.com');
  expect(desktopYaml.configText).toContain('featuregates.org');
  expect(desktopYaml.configText).toContain('intercomcdn.com');
  expect(desktopYaml.configText).toContain('datadoghq.com');
  expect(desktopYaml.configText).toContain('openai.com');
  expect(desktopYaml.configText).toContain('chatgpt.com');
  expect(desktopYaml.configText).toContain('8.8.4.4/32');
});

test('CLI and Companion Browser dual-protocol proxy alignment recognizes same mixed port and preserves socks5:// on sync', () => {
  expect(areCliAndBrowserProxiesAligned('socks5://127.0.0.1:7899', 'http://127.0.0.1:7899')).toBe(true);
  expect(areCliAndBrowserProxiesAligned('socks5://localhost:7899', 'http://127.0.0.1:7899')).toBe(true);
  expect(areCliAndBrowserProxiesAligned('socks5h://127.0.0.1:7899', 'https://127.0.0.1:7899')).toBe(true);
  expect(areCliAndBrowserProxiesAligned('socks5://127.0.0.1:7899', null)).toBe(true);
  expect(areCliAndBrowserProxiesAligned('socks5://127.0.0.1:7899', 'http://127.0.0.1:7890')).toBe(false);
  expect(areCliAndBrowserProxiesAligned('', 'http://127.0.0.1:7899')).toBe(false);

  expect(toBrowserSocks5ProxyFromCli('http://127.0.0.1:7890')).toBe('socks5://127.0.0.1:7890');
  expect(toBrowserSocks5ProxyFromCli('http://localhost:7899')).toBe('socks5://127.0.0.1:7899');
  expect(toCliHttpProxy('socks5://127.0.0.1:7899')).toBe('http://127.0.0.1:7899');
  expect(toCliHttpProxy('socks5://localhost:17899')).toBe('http://127.0.0.1:17899');

  const cliJson = buildClaudeCliAntiLeakSettingsJson(7899);
  expect(cliJson.filename).toBe('claude-settings-env-override.json');
  const parsed = JSON.parse(cliJson.configText);
  expect(parsed.env.HTTP_PROXY).toBe('http://127.0.0.1:7899');
  expect(parsed.env.http_proxy).toBe('http://127.0.0.1:7899');
  expect(parsed.env.HTTPS_PROXY).toBe('http://127.0.0.1:7899');
  expect(parsed.env.https_proxy).toBe('http://127.0.0.1:7899');
  expect(parsed.env.ALL_PROXY).toBe('http://127.0.0.1:7899');
  expect(parsed.env.all_proxy).toBe('http://127.0.0.1:7899');
  expect(parsed.env.GRPC_PROXY).toBe('http://127.0.0.1:7899');
  expect(parsed.env.grpc_proxy).toBe('http://127.0.0.1:7899');
  expect(parsed.env.NO_PROXY).toContain('169.254.0.0/16');
  expect(parsed.env.no_proxy).toBe(parsed.env.NO_PROXY);
  expect(parsed.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined();
  expect(parsed.env.DISABLE_TELEMETRY).toBe('1');
  expect(parsed.env.DISABLE_ERROR_REPORTING).toBe('1');
  expect(parsed.env.DO_NOT_TRACK).toBe('1');

  const desktopYamlFull = buildDesktopMihomoAntiLeakYaml(7899).configText;
  const zhPromptFull = buildDesktopDnsFixPrompt({locale: 'zh', dedicatedPort: 7899});
  const enPromptFull = buildDesktopDnsFixPrompt({locale: 'en', dedicatedPort: 7899});
  for (const portfolioDomain of [
    'claude.ai',
    'ant.dev',
    'anthropic.com',
    'anthropic.dev',
    'anthropic.team',
    'antspace.dev',
    'chatbotclaude.com',
    'clau.de',
    'claude.app',
    'claude.com',
    'claude.dev',
    'claude.new',
    'claude.site',
    'claudeacademy.com',
    'claudemcpclient.com',
    'claudemcpcontent.com',
    'claudepages.dev',
    'claudestudio.com',
    'claudeusercontent.com',
    'http-intake.logs.us5.datadoghq.com',
    'datadoghq.com',
    'browser-intake-datadoghq.com',
    'browser-intake-us5-datadoghq.com',
    'datadoghq.eu',
    'beyondwickedmapping.org',
    'yoti.com',
    'hexagon-cdn.com',
    'hexagon-analytics.com',
    'ipquery.io',
    'ipinfo.io',
    'ip.sb',
    'geojs.io',
    'ipwho.is',
  ]) {
    expect(desktopYamlFull).toContain(`DOMAIN-SUFFIX,${portfolioDomain},`);
    expect(zhPromptFull).toContain(portfolioDomain);
    expect(enPromptFull).toContain(portfolioDomain);
  }
  expect(desktopYamlFull).toContain('GEOSITE,anthropic,');
  expect(desktopYamlFull).toContain('DOMAIN-KEYWORD,datadoghq,');
  expect(desktopYamlFull).toContain('DOMAIN-SUFFIX,growthbook.io,');
  expect(desktopYamlFull).toContain('DOMAIN-SUFFIX,storage.googleapis.com,');
  expect(desktopYamlFull).toContain('::1/128');

  const hardenedAudit = auditClaudeCliSecurityBoundary({
    settingsJson: parsed,
    claudeJson: {
      mcpServers: {
        pinnedLocal: {command: 'cmd.exe', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem@0.6.2']},
      },
    },
    pendingFailedTelemetryFiles: 0,
  });
  expect(hardenedAudit.settings_present).toBe(true);
  expect(hardenedAudit.telemetry_shield_active).toBe(true);
  expect(hardenedAudit.nonessential_traffic_blocked).toBe(false);
  expect(hardenedAudit.proxy_env_complete).toBe(true);
  expect(hardenedAudit.socks5_in_cli_env).toBe(false);
  expect(hardenedAudit.has_custom_hooks_or_helpers).toBe(false);
  expect(hardenedAudit.unpinned_npx_count).toBe(0);
  expect(hardenedAudit.windows_bare_npx_count).toBe(0);
  expect(hardenedAudit.remote_http_mcp_count).toBe(0);

  // Windows uppercase-only proxy vars + 3-var telemetry shield + settings.local.json override + project-scoped mcpServers
  const winUpperAudit = auditClaudeCliSecurityBoundary({
    settingsJson: {
      env: {
        HTTP_PROXY: 'http://127.0.0.1:7899',
        HTTPS_PROXY: 'http://127.0.0.1:7899',
        ALL_PROXY: 'http://127.0.0.1:7899',
        GRPC_PROXY: 'http://127.0.0.1:7899',
        NO_PROXY: 'localhost,127.0.0.1',
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        DO_NOT_TRACK: '1',
      },
    },
    mcpJson: {
      projects: {
        'D:/repo/a': {
          mcpServers: {
            projectUnpinned: {command: 'npx', args: ['-y', '@scope/proj-pkg@latest']},
            projectRemote: {url: 'https://proj-mcp.example.com/mcp'},
          },
        },
        'd:\\repo\\a\\': {
          mcpServers: {
            duplicateShouldSkip: {command: 'npx', args: ['-y', '@scope/proj-pkg@latest']},
          },
        },
      },
    },
  });
  expect(winUpperAudit.telemetry_shield_active).toBe(true);
  expect(winUpperAudit.nonessential_traffic_blocked).toBe(false);
  expect(winUpperAudit.proxy_env_complete).toBe(true);
  expect(winUpperAudit.unpinned_npx_count).toBe(1);
  expect(winUpperAudit.windows_bare_npx_count).toBe(1);
  expect(winUpperAudit.remote_http_mcp_count).toBe(1);

  const riskyAudit = auditClaudeCliSecurityBoundary({
    settingsJson: {
      env: {
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
      },
      apiKeyHelper: 'echo token',
    },
    settingsLocalJson: {
      env: {
        HTTP_PROXY: 'socks://127.0.0.1:7899',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    },
    claudeJson: {
      mcpServers: {
        bareFloating: {command: 'npx', args: ['-y', '@scope/pkg@latest']},
        remoteHttp: {url: 'https://mcp.example.com/sse'},
      },
    },
    pendingFailedTelemetryFiles: 2,
  });
  expect(riskyAudit.telemetry_shield_active).toBe(false);
  expect(riskyAudit.nonessential_traffic_blocked).toBe(true);
  expect(riskyAudit.proxy_env_complete).toBe(false);
  expect(riskyAudit.socks5_in_cli_env).toBe(true);
  expect(riskyAudit.has_custom_hooks_or_helpers).toBe(true);
  expect(riskyAudit.unpinned_npx_count).toBe(1);
  expect(riskyAudit.windows_bare_npx_count).toBe(1);
  expect(riskyAudit.remote_http_mcp_count).toBe(1);
  expect(riskyAudit.pending_failed_telemetry_files).toBe(2);
  expect(isCliSecurityShieldOk(hardenedAudit)).toBe(true);
  expect(isCliMcpBoundarySafe(hardenedAudit)).toBe(true);
  expect(isCliSecurityShieldOk(winUpperAudit)).toBe(true);
  expect(isCliMcpBoundarySafe(winUpperAudit)).toBe(false);
  expect(isCliSecurityShieldOk(riskyAudit)).toBe(false);
  expect(isCliMcpBoundarySafe(riskyAudit)).toBe(false);

  // TUN-only config: telemetry shield active, but missing explicit CLI HTTP proxy vars
  // must NOT be treated as a full CLI shield pass (vulnerable on sleep/wake or TUN drop).
  const tunOnlyAudit = auditClaudeCliSecurityBoundary({
    settingsJson: {
      env: {
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        DO_NOT_TRACK: '1',
      },
    },
  });
  expect(tunOnlyAudit.telemetry_shield_active).toBe(true);
  expect(tunOnlyAudit.proxy_env_complete).toBe(false);
  expect(isCliSecurityShieldOk(tunOnlyAudit)).toBe(false);
  expect(isCliSecurityShieldOk(null)).toBe(false);
  expect(isCliMcpBoundarySafe(undefined)).toBe(false);
});

test('classifyRiskExitIsp, formatExitIspLabel, and resolveRiskBanner classify RCN/Astound/US residential ISPs and produce cause-specific banner copy', () => {
  // Multi-signal residential recognition even when supplementary hosting flag is omitted (RFC 5737 synthetic IP)
  expect(classifyRiskExitIsp({isp: 'RCN', asn: 'AS6079'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'RCN Corporation'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Astound Broadband', asn: 'AS6079'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Wave Broadband', asn: 'AS11404'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Comcast Cable Communications', asn: 'AS7922'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Verizon Fios', asn: 'AS701'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'AT&T Services, Inc.', asn: 'AS7018'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Google Fiber Inc.', asn: 'AS16591'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Google LLC', asn: 'AS16591'})).toBe('isp');

  // Hard datacenter blocklist wins first (Google Cloud AS15169/AS396982, M247 AS9009, Cogent AS174, Hurricane Electric AS6939)
  expect(classifyRiskExitIsp({isp: 'Google LLC', asn: 'AS15169', hosting: false})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Google Cloud', asn: 'AS396982'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'M247 Europe SRL', asn: 'AS9009'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Cogent Communications', asn: 'AS174'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Hurricane Electric LLC', asn: 'AS6939'})).toBe('hosting');

  // Unlisted carrier without hosting flag stays unknown
  expect(classifyRiskExitIsp({isp: 'Obscure Regional Carrier', asn: 'AS64512'})).toBe('unknown');

  // Clean display label appends ASN once without duplicating
  expect(formatExitIspLabel({isp: 'RCN', asn: 'AS6079'})).toBe('RCN · AS6079');
  expect(formatExitIspLabel({isp: 'RCN (Astound Broadband · AS6079)', asn: 'AS6079'})).toBe(
    'RCN (Astound Broadband · AS6079)',
  );

  const staticGreenLocal: LocalRiskSnapshot = {
    browser: {
      proxy_configured: true,
      proxy_scheme: 'socks5',
      proxy_local_port: 7899,
      remote_dns_locked: true,
      target_country: 'US',
      target_timezone: 'America/New_York',
      target_language: 'en-US',
    },
    mihomo: {
      detected: true,
      config_source: 'running_core',
      config_source_status: 'confirmed',
      dns_projection_complete: true,
      dns_has_encrypted_resolver: true,
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
      lan_ipv4_candidates: ['192.168.1.10'],
      public_wan_detected: false,
    },
  };

  // 1) Before probe: static 3/3 ready -> green localReady banner prompting to run probe
  const preProbeChecks = evaluateRiskChecks(staticGreenLocal, null, false);
  expect(resolveRiskBanner(staticGreenLocal, null, preProbeChecks)).toEqual({
    status: 'ok',
    titleKey: 'risk.auditStatus.localReadyTitle',
    descKey: 'risk.auditStatus.localReadyDesc',
  });

  // 2) RCN (AS6079) without hosting boolean -> 6/6 all green!
  const rcnProbe: ConsistencyProbeReport = {
    claude: {domain: 'claude.ai', ok: true, country: 'US', colo: 'IAD', ip: '198.51.100.42', latency_ms: 165, error: null},
    persona: {domain: 'withpersona.com', ok: true, country: 'US', colo: 'IAD', ip: '198.51.100.42', latency_ms: 170, error: null},
    unlisted_dns: {domain: 'cloudflare-dns.com', ok: true, country: 'US', colo: 'IAD', ip: '198.51.100.42', latency_ms: 160, error: null},
    exit_isp: {ip: '198.51.100.42', country: 'US', city: 'New York', timezone: 'America/New_York', isp: 'RCN', asn: 'AS6079'},
    same_country: true,
    same_exit_ip: true,
    unlisted_same_country: true,
  };
  const rcnChecks = evaluateRiskChecks(staticGreenLocal, rcnProbe, false);
  expect(rcnChecks.every(c => c.status === 'ok')).toBe(true);
  expect(resolveRiskBanner(staticGreenLocal, rcnProbe, rcnChecks)).toEqual({
    status: 'ok',
    titleKey: 'risk.auditStatus.okTitle',
    descKey: 'risk.auditStatus.okDesc',
  });

  // 3) Static 3/3 green + unlisted ISP -> points to Exit ASN card, NEVER tells user to fix Strict-Route!
  const unlistedIspProbe: ConsistencyProbeReport = {
    ...rcnProbe,
    exit_isp: {ip: '198.51.100.42', country: 'US', city: 'New York', timezone: 'America/New_York', isp: 'Unlisted Cooperative Fiber', asn: 'AS64512'},
  };
  const unlistedChecks = evaluateRiskChecks(staticGreenLocal, unlistedIspProbe, false);
  const unlistedBanner = resolveRiskBanner(staticGreenLocal, unlistedIspProbe, unlistedChecks);
  expect(unlistedBanner).toEqual({
    status: 'warn',
    titleKey: 'risk.auditStatus.ispPendingTitle',
    descKey: 'risk.auditStatus.ispPendingDesc',
  });
  expect(translate(unlistedBanner.descKey, {}, 'zh')).not.toContain('Strict-Route');
  expect(translate(unlistedBanner.descKey, {}, 'en')).not.toContain('Strict-Route');

  // 4) Static 3/3 green + datacenter node -> ispHosting banner
  const idcProbe: ConsistencyProbeReport = {
    ...rcnProbe,
    exit_isp: {ip: '198.51.100.42', country: 'US', city: 'Ashburn', timezone: 'America/New_York', isp: 'M247 Europe SRL', asn: 'AS9009'},
  };
  const idcChecks = evaluateRiskChecks(staticGreenLocal, idcProbe, false);
  expect(resolveRiskBanner(staticGreenLocal, idcProbe, idcChecks)).toEqual({
    status: 'fail',
    titleKey: 'risk.auditStatus.ispHostingTitle',
    descKey: 'risk.auditStatus.ispHostingDesc',
  });

  // 5) Datacenter exit + same-country multi-IP warn STILL shows ispHostingTitle instead of generic split fail
  const idcDiffIpProbe: ConsistencyProbeReport = {
    ...idcProbe,
    persona: {...idcProbe.persona, ip: '198.51.100.43'},
    same_exit_ip: false,
  };
  const idcDiffIpChecks = evaluateRiskChecks(staticGreenLocal, idcDiffIpProbe, false);
  expect(resolveRiskBanner(staticGreenLocal, idcDiffIpProbe, idcDiffIpChecks)).toEqual({
    status: 'fail',
    titleKey: 'risk.auditStatus.ispHostingTitle',
    descKey: 'risk.auditStatus.ispHostingDesc',
  });

  // 6) Corrected ASN catalog parity (GleSYS AS42708 & Internap AS11854 -> hosting; Brightspeed/Altafiber/Starry/Ting/Hawaiian/Singtel -> isp)
  expect(classifyRiskExitIsp({isp: 'GleSYS AB', asn: 'AS42708'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Internap Holding LLC', asn: 'AS11854'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Datacamp Limited', asn: 'AS212238'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'DigitalOcean, LLC', asn: 'AS62567'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Acme Dedicated Servers', asn: 'AS64512'})).toBe('hosting');
  expect(classifyRiskExitIsp({isp: 'Connect Holding II LLC', asn: 'AS40127'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Cincinnati Bell', asn: 'AS10910'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Starry, Inc.', asn: 'AS394925'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Tucows', asn: 'AS14654'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Hawaiian Telcom', asn: 'AS11858'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Singapore Telecommunications', asn: 'AS7473'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Ting Fiber'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Ting Internet'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Sonic.net'})).toBe('isp');
  expect(classifyRiskExitIsp({isp: 'Ting Mobile Corp'})).toBe('unknown');
  expect(classifyRiskExitIsp({isp: 'Sonic Corp'})).toBe('unknown');
});

test('auditClaudeCliSecurityBoundary rejects NO_PROXY bypasses, case-clobbered or split-port proxies, unpinned npx trailing @, ws(s) remote MCP, missing DO_NOT_TRACK, and flags non-English language', () => {
  const baseEnv = {
    HTTP_PROXY: 'http://127.0.0.1:7899',
    HTTPS_PROXY: 'http://127.0.0.1:7899',
    ALL_PROXY: 'http://127.0.0.1:7899',
    GRPC_PROXY: 'http://127.0.0.1:7899',
    NO_PROXY: 'localhost,127.0.0.1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DO_NOT_TRACK: '1',
  };

  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, DO_NOT_TRACK: undefined}},
    }).telemetry_shield_active,
  ).toBe(false);

  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, NO_PROXY: '*'}},
    }).proxy_env_complete,
  ).toBe(false);

  for (const bypassedDomain of [
    '.claude.ai',
    'claudeusercontent.com',
    'claudemcpclient.com',
    'claudemcpcontent.com',
    'claudepages.dev',
    'claude.site',
    'ant.dev',
    'clau.de',
    'http-intake.logs.us5.datadoghq.com',
  ]) {
    expect(
      auditClaudeCliSecurityBoundary({
        settingsJson: {env: {...baseEnv, NO_PROXY: `localhost,${bypassedDomain}`}},
      }).proxy_env_complete,
    ).toBe(false);
  }

  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, https_proxy: ''}},
    }).proxy_env_complete,
  ).toBe(false);

  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, GRPC_PROXY: 'http://127.0.0.1:7890'}},
    }).proxy_env_complete,
  ).toBe(false);

  const mcpEdgeAudit = auditClaudeCliSecurityBoundary({
    settingsJson: {language: 'zh-CN', env: baseEnv},
    claudeJson: {
      mcpServers: {
        spoofedTrailingAt: {command: 'cmd.exe', args: ['/c', 'npx', '-y', 'unpinned-pkg', 'admin@example.com']},
        wsLoopback: {url: 'ws://127.0.0.1:9000/mcp'},
        wssRemote: {url: 'wss://remote-mcp.example.invalid/ws'},
      },
    },
  });
  expect(mcpEdgeAudit.non_english_language).toBe(true);
  expect(mcpEdgeAudit.unpinned_npx_count).toBe(1);
  expect(mcpEdgeAudit.remote_http_mcp_count).toBe(1);
});

test('evaluateRiskChecks marks kyc_routing_rules warn with missingSift / missingTelemetry details on confirmed running_core', () => {
  const baseLocal: LocalRiskSnapshot = {
    browser: {
      proxy_configured: true,
      proxy_scheme: 'socks5',
      proxy_local_port: 7899,
      remote_dns_locked: true,
      target_country: 'US',
      target_timezone: 'America/New_York',
      target_language: 'en-US',
    },
    mihomo: {
      detected: true,
      config_source: 'running_core',
      config_source_status: 'confirmed',
      dns_projection_complete: true,
      dns_has_encrypted_resolver: true,
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
      lan_ipv4_candidates: ['192.168.1.10'],
      public_wan_detected: false,
    },
  };

  // 1) undefined flags keep detailKeys undefined and status 'ok'
  const kycUndefined = evaluateRiskChecks(baseLocal, null, false).find(c => c.id === 'kyc_routing_rules')!;
  expect(kycUndefined.status).toBe('ok');
  expect(kycUndefined.summaryKey).toBe('risk.check.kycRoutingRules.okFull');
  expect(kycUndefined.detailKeys).toBeUndefined();

  // 2) both true keeps detailKeys undefined and status 'ok'
  const kycTrue = evaluateRiskChecks(
    {...baseLocal, mihomo: {...baseLocal.mihomo, has_sift_rules: true, has_telemetry_rules: true}},
    null,
    false,
  ).find(c => c.id === 'kyc_routing_rules')!;
  expect(kycTrue.status).toBe('ok');
  expect(kycTrue.detailKeys).toBeUndefined();

  // 3) has_sift_rules === false on running_core marks kyc_routing_rules as warn with missingSift detail
  const checksSiftFalse = evaluateRiskChecks(
    {...baseLocal, mihomo: {...baseLocal.mihomo, has_sift_rules: false}},
    null,
    false,
  );
  const kycSiftFalse = checksSiftFalse.find(c => c.id === 'kyc_routing_rules')!;
  expect(kycSiftFalse.status).toBe('warn');
  expect(kycSiftFalse.summaryKey).toBe('risk.check.kycRoutingRules.warnIncompleteRules');
  expect(kycSiftFalse.detailKeys).toEqual(['risk.check.kycRoutingRules.missingSift']);
  expect(resolveRiskBanner(baseLocal, null, checksSiftFalse).status).toBe('warn');

  // 4) has_telemetry_rules === false on running_core marks kyc_routing_rules as warn with missingTelemetry detail
  const kycTelemetryFalse = evaluateRiskChecks(
    {...baseLocal, mihomo: {...baseLocal.mihomo, has_sift_rules: true, has_telemetry_rules: false}},
    null,
    false,
  ).find(c => c.id === 'kyc_routing_rules')!;
  expect(kycTelemetryFalse.status).toBe('warn');
  expect(kycTelemetryFalse.detailKeys).toEqual(['risk.check.kycRoutingRules.missingTelemetry']);

  // 5) warnMissingQuicOrListener branch attaches both missingSift and missingTelemetry details
  const kycBothFalseWarn = evaluateRiskChecks(
    {
      ...baseLocal,
      mihomo: {
        ...baseLocal.mihomo,
        has_quic_reject: false,
        has_sift_rules: false,
        has_telemetry_rules: false,
      },
    },
    null,
    false,
  ).find(c => c.id === 'kyc_routing_rules')!;
  expect(kycBothFalseWarn.status).toBe('warn');
  expect(kycBothFalseWarn.summaryKey).toBe('risk.check.kycRoutingRules.warnMissingQuicOrListener');
  expect(kycBothFalseWarn.detailKeys).toEqual([
    'risk.check.kycRoutingRules.missingSift',
    'risk.check.kycRoutingRules.missingTelemetry',
  ]);

  for (const locale of ['zh', 'en'] as const) {
    for (const key of [
      'risk.check.kycRoutingRules.missingSift',
      'risk.check.kycRoutingRules.missingTelemetry',
      'risk.check.kycRoutingRules.warnIncompleteRules',
      'risk.cliSecurity.telemetryRulesMissing',
    ]) {
      const msg = translate(key, {port: 7899}, locale);
      expect(msg).not.toBe(key);
    }
  }
});

test('normalizeProxyEndpoint unifies [::1] and ::1 loopback and returns null for portless endpoints', () => {
  expect(normalizeProxyEndpoint('http://[::1]:7899')).toEqual({scheme: 'http', hostPort: '127.0.0.1:7899'});
  expect(normalizeProxyEndpoint('socks5://::1:7899')).toEqual({scheme: 'socks5', hostPort: '127.0.0.1:7899'});
  expect(normalizeProxyEndpoint('::1:7900')).toEqual({scheme: 'http', hostPort: '127.0.0.1:7900'});
  expect(normalizeProxyEndpoint('http://localhost:7899')).toEqual({scheme: 'http', hostPort: '127.0.0.1:7899'});
  expect(normalizeProxyEndpoint('http://127.0.0.1')).toBeNull();
  expect(normalizeProxyEndpoint('https://proxy.example.com')).toBeNull();
  expect(normalizeProxyEndpoint('socks5://localhost')).toBeNull();
  expect(areCliAndBrowserProxiesAligned('socks5h://[::1]:7899', 'http://::1:7899')).toBe(true);
});

test('auditClaudeCliSecurityBoundary warns when NO_PROXY omits loopback and aligns settings.local.json non-string language with Rust', () => {
  const baseEnv = {
    HTTP_PROXY: 'http://[::1]:7899',
    HTTPS_PROXY: 'http://localhost:7899',
    ALL_PROXY: 'http://127.0.0.1:7899',
    GRPC_PROXY: 'http://::1:7899',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DO_NOT_TRACK: '1',
  };

  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, NO_PROXY: '192.168.1.0/24'}},
    }).proxy_env_complete,
  ).toBe(false);
  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, NO_PROXY: 'localhost'}},
    }).proxy_env_complete,
  ).toBe(false);
  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, NO_PROXY: '127.0.0.1'}},
    }).proxy_env_complete,
  ).toBe(false);
  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {env: {...baseEnv, NO_PROXY: 'localhost,127.0.0.1'}},
    }).proxy_env_complete,
  ).toBe(true);

  // settings.local.json overriding `language: null` clears settings.json `zh-CN`, matching Rust Option<String>
  expect(
    auditClaudeCliSecurityBoundary({
      settingsJson: {language: 'zh-CN', env: {...baseEnv, NO_PROXY: 'localhost,127.0.0.1'}},
      settingsLocalJson: {language: null},
    }).non_english_language,
  ).toBe(false);
});

test('buildMultiPortClashYaml clamps port counts, emits TCP-only local listeners, and covers KYC/Sift/Datadog rules', () => {
  const snippet = buildMultiPortClashYaml({
    count: 3,
    startPort: 7899,
    groupNames: ['US-Res-1', 'US-Res-2', 'US-Res-3'],
  });
  expect(snippet.ports).toEqual([7899, 7900, 7901]);
  expect(snippet.groups).toEqual(['US-Res-1', 'US-Res-2', 'US-Res-3']);
  expect(snippet.yaml).toContain('listeners:');
  expect(snippet.yaml).toContain('type: mixed');
  expect(snippet.yaml).toContain('listen: 127.0.0.1');
  expect(snippet.yaml).toContain('udp: false');
  expect(snippet.yaml).toContain('port: 7899');
  expect(snippet.yaml).toContain('port: 7900');
  expect(snippet.yaml).toContain('port: 7901');
  expect(snippet.yaml).toContain('prepend-rules:');
  for (const domain of [
    'claude.ai',
    'anthropic.com',
    'sift.com',
    'siftscience.com',
    'hexagon-cdn.com',
    'hexagon-analytics.com',
    'withpersona.com',
    'yoti.com',
    'datadoghq',
  ]) {
    expect(snippet.yaml).toContain(domain);
  }
  expect(snippet.yaml).toContain('US-Res-1');
  expect(snippet.yaml).toContain('US-Res-3');
  const clamped = buildMultiPortClashYaml({count: 9, startPort: 80});
  expect(clamped.ports).toHaveLength(5);
  expect(clamped.ports[0]).toBe(7899);
});
