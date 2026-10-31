/**
 * [INPUT]: 原生只读环境快照（浏览器远程 DNS 锁、Mihomo 结构特征、网卡 RFC1918 候选）与三路边缘 trace 一致性实测结果。
 * [OUTPUT]: 六项有界配置/HTTP 出口评估与同上下文遮罩浏览器归属、严格 RFC1918 校验、Mihomo strict-route 覆写片段、安全随机源缺失即失败的内存桥接凭据与双语提示词。
 * [POS]: 风控验证纯模型层；不持有上游家宽密码、不落盘临时口令、不向公网暴露任何监听配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {classifyExitIsp, type Exit} from './browser-model';
import type {Locale} from './i18n';

export type BrowserDnsGuard = {
  proxy_configured: boolean;
  proxy_scheme: string | null;
  proxy_local_port: number | null;
  remote_dns_locked: boolean;
  target_country: string | null;
  target_timezone: string;
  target_language: string;
};

export type MihomoAudit = {
  config_source?: 'running_core' | 'candidate_file' | null;
  config_source_status?: 'confirmed' | 'not_running' | 'process_unavailable' | 'ambiguous' | 'unreadable' | 'unsupported' | null;
  dns_projection_complete?: boolean;
  dns_has_encrypted_resolver?: boolean;
  dns_has_domestic_encrypted?: boolean;
  detected: boolean;
  client_kind: string | null;
  mixed_port: number | null;
  allow_lan: boolean | null;
  tun_enabled: boolean | null;
  tun_strict_route: boolean | null;
  dns_enabled: boolean | null;
  dns_enhanced_mode: string | null;
  dns_respect_rules: boolean | null;
  dns_has_remote_doh: boolean;
  dns_has_domestic_plain: boolean;
  dns_has_nameserver_policy: boolean;
  has_claude_rules: boolean;
  has_persona_rules: boolean;
  has_quic_reject: boolean;
  has_geoip_cn: boolean;
  dedicated_listener_port: number | null;
};

export type SystemNetworkAudit = {
  tun_adapter_active: boolean;
  secondary_plaintext_dns_active: boolean;
  lan_ipv4_candidates: string[];
  public_wan_detected: boolean;
};

export type LocalRiskSnapshot = {
  context_id?: string | null;
  browser_identity?: {name: string | null; email: string | null; status: string} | null;
  browser: BrowserDnsGuard;
  mihomo: MihomoAudit;
  system: SystemNetworkAudit;
};

export type TraceEndpointResult = {
  domain: string;
  ok: boolean;
  country: string | null;
  colo: string | null;
  ip: string | null;
  latency_ms: number | null;
  error: string | null;
};

export type ConsistencyProbeReport = {
  context_id?: string | null;
  claude: TraceEndpointResult;
  persona: TraceEndpointResult;
  unlisted_dns: TraceEndpointResult;
  exit_isp: Exit | null;
  same_country: boolean | null;
  same_exit_ip: boolean | null;
  unlisted_same_country: boolean | null;
};

export type RiskCheckStatus = 'ok' | 'warn' | 'fail' | 'pending';

export type RiskCheckId =
  | 'claude_exit'
  | 'persona_consistency'
  | 'browser_dns_lock'
  | 'mihomo_dns_leak'
  | 'kyc_routing_rules'
  | 'exit_isp_kind';

export type RiskCheckItem = {
  id: RiskCheckId;
  status: RiskCheckStatus;
  titleKey: string;
  summaryKey: string;
  summaryParams?: Record<string, string | number>;
  detailKeys?: string[];
};

export function compareProbeExits(probe: ConsistencyProbeReport): 'same_ip' | 'same_country' | 'different_country' | 'unknown' {
  const a = probe.claude;
  const b = probe.persona;
  if (!a.ok || !b.ok || !a.country?.trim() || !b.country?.trim()) return 'unknown';
  const sameCountry = a.country.trim().toUpperCase() === b.country.trim().toUpperCase();
  if (!sameCountry && probe.same_country === false) return 'different_country';
  if (!sameCountry || probe.same_country !== true || !a.ip?.trim() || !b.ip?.trim()) return 'unknown';
  if (probe.same_exit_ip === true && a.ip.trim() === b.ip.trim()) return 'same_ip';
  if (probe.same_exit_ip === false && a.ip.trim() !== b.ip.trim()) return 'same_country';
  return 'unknown';
}

export function isCurrentRiskProbe(local: LocalRiskSnapshot | null, probe: ConsistencyProbeReport | null): boolean {
  return Boolean(local?.context_id && probe?.context_id && local.context_id === probe.context_id);
}

export type MobileClientId = 'shadowrocket' | 'clash-mi' | 'stash' | 'sing-box';
export type MobileBridgeMode = 'lan' | 'standalone';

export type MobileBridgeArtifact = {
  client: MobileClientId;
  qrUri: string;
  socksUri: string;
  configText: string;
  filename: string;
};

const CREDENTIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const CREDENTIAL_TOKEN_RE = /^[A-Za-z0-9_-]{4,32}$/;

export const DEFAULT_DEDICATED_LISTENER_PORT = 7899;

export function isValidRfc1918Ipv4(ip: string): boolean {
  const trimmed = ip.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return false;
    octets.push(value);
  }
  const [a, b, c, d] = octets;
  if (a === 10) {
    if (b === 0 && c === 0 && d === 0) return false;
    if (b === 255 && c === 255 && d === 255) return false;
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    if (b === 16 && c === 0 && d === 0) return false;
    if (b === 31 && c === 255 && d === 255) return false;
    return true;
  }
  if (a === 192 && b === 168) {
    if (c === 0 && d === 0) return false;
    if (c === 255 && d === 255) return false;
    return true;
  }
  return false;
}

export function isValidBridgePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function maskIpAddress(ip: string | null | undefined, mask: boolean): string {
  const trimmed = ip?.trim();
  if (!trimmed) return '—';
  if (!mask) return trimmed;
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}:*:*`;
    return '*:*';
  }
  return '***';
}

export function generateBridgeCredentials(randomBytes?: Uint8Array): {username: string; password: string} {
  const buf = randomBytes && randomBytes.length >= 22 ? randomBytes : new Uint8Array(22);
  if (!randomBytes || randomBytes.length < 22) {
    try {
      if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('risk_secure_random_unavailable');
      globalThis.crypto.getRandomValues(buf);
    } catch {
      throw new Error('risk_secure_random_unavailable');
    }
  }
  const pick = (offset: number, length: number) => {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += CREDENTIAL_ALPHABET[buf[offset + i] % CREDENTIAL_ALPHABET.length];
    }
    return out;
  };
  return {
    username: `kyc${pick(0, 6)}`,
    password: pick(6, 16),
  };
}

export function summarizeRiskChecks(checks: readonly RiskCheckItem[]): RiskCheckStatus {
  if (checks.some(item => item.status === 'fail')) return 'fail';
  if (checks.every(item => item.status === 'pending')) return 'pending';
  if (checks.some(item => item.status === 'warn' || item.status === 'pending')) return 'warn';
  return 'ok';
}

export function evaluateRiskChecks(
  local: LocalRiskSnapshot | null,
  probe: ConsistencyProbeReport | null,
  privacyMask = false,
): RiskCheckItem[] {
  const checks: RiskCheckItem[] = [];

  // 1. claude.ai 主站出口核验
  if (!probe) {
    checks.push({
      id: 'claude_exit',
      status: 'pending',
      titleKey: 'risk.check.claudeExit.title',
      summaryKey: 'risk.check.claudeExit.pending',
    });
  } else if (!probe.claude.ok) {
    checks.push({
      id: 'claude_exit',
      status: 'fail',
      titleKey: 'risk.check.claudeExit.title',
      summaryKey: 'risk.check.claudeExit.fail',
      summaryParams: {error: probe.claude.error || 'timeout'},
    });
  } else if (!probe.claude.country?.trim()) {
    checks.push({id: 'claude_exit', status: 'pending', titleKey: 'risk.check.claudeExit.title', summaryKey: 'risk.check.claudeExit.unknown'});
  } else {
    const targetCountry = local?.browser.target_country?.trim().toUpperCase();
    const actualCountry = probe.claude.country.trim().toUpperCase();
    if (targetCountry && targetCountry !== actualCountry) {
      checks.push({
        id: 'claude_exit',
        status: 'warn',
        titleKey: 'risk.check.claudeExit.title',
        summaryKey: 'risk.check.claudeExit.targetMismatch',
        summaryParams: {
          actual: actualCountry,
          target: targetCountry,
          ip: maskIpAddress(probe.claude.ip, privacyMask),
        },
      });
    } else {
      checks.push({
        id: 'claude_exit',
        status: 'ok',
        titleKey: 'risk.check.claudeExit.title',
        summaryKey: 'risk.check.claudeExit.ok',
        summaryParams: {
          country: actualCountry,
          colo: probe.claude.colo || '—',
          ip: maskIpAddress(probe.claude.ip, privacyMask),
        },
      });
    }
  }

  // 2. withpersona.com KYC 跨域出口一致性
  if (!probe) {
    checks.push({
      id: 'persona_consistency',
      status: 'pending',
      titleKey: 'risk.check.personaConsistency.title',
      summaryKey: 'risk.check.personaConsistency.pending',
    });
  } else if (!probe.persona.ok || !probe.claude.ok) {
    checks.push({
      id: 'persona_consistency',
      status: 'fail',
      titleKey: 'risk.check.personaConsistency.title',
      summaryKey: 'risk.check.personaConsistency.unreachable',
    });
  } else if (compareProbeExits(probe) === 'different_country') {
    checks.push({
      id: 'persona_consistency',
      status: 'fail',
      titleKey: 'risk.check.personaConsistency.title',
      summaryKey: 'risk.check.personaConsistency.countryMismatch',
      summaryParams: {
        claudeCountry: probe.claude.country || '?',
        personaCountry: probe.persona.country || '?',
        personaIp: maskIpAddress(probe.persona.ip, privacyMask),
      },
    });
  } else if (compareProbeExits(probe) === 'same_country') {
    checks.push({
      id: 'persona_consistency',
      status: 'warn',
      titleKey: 'risk.check.personaConsistency.title',
      summaryKey: 'risk.check.personaConsistency.ipDiffSameCountry',
      summaryParams: {
        country: probe.persona.country || '?',
        claudeIp: maskIpAddress(probe.claude.ip, privacyMask),
        personaIp: maskIpAddress(probe.persona.ip, privacyMask),
      },
    });
  } else if (compareProbeExits(probe) === 'same_ip') {
    checks.push({
      id: 'persona_consistency',
      status: 'ok',
      titleKey: 'risk.check.personaConsistency.title',
      summaryKey: 'risk.check.personaConsistency.ok',
      summaryParams: {
        country: probe.persona.country || '?',
        ip: maskIpAddress(probe.persona.ip, privacyMask),
      },
    });
  } else {
    checks.push({id: 'persona_consistency', status: 'pending', titleKey: 'risk.check.personaConsistency.title', summaryKey: 'risk.check.personaConsistency.unknown'});
  }

  // 3. 绑定浏览器远程 DNS 强锁（MAP * ~NOTFOUND）
  if (!local) {
    checks.push({
      id: 'browser_dns_lock',
      status: 'pending',
      titleKey: 'risk.check.browserDnsLock.title',
      summaryKey: 'risk.check.browserDnsLock.pending',
    });
  } else if (local.browser.remote_dns_locked) {
    const dedicated = local.mihomo.dedicated_listener_port;
    if (dedicated && local.browser.proxy_local_port === dedicated) {
      checks.push({
        id: 'browser_dns_lock',
        status: 'ok',
        titleKey: 'risk.check.browserDnsLock.title',
        summaryKey: 'risk.check.browserDnsLock.okDedicated',
        summaryParams: {port: dedicated},
      });
    } else {
      checks.push({
        id: 'browser_dns_lock',
        status: 'ok',
        titleKey: 'risk.check.browserDnsLock.title',
        summaryKey: 'risk.check.browserDnsLock.okSocks',
        summaryParams: {port: local.browser.proxy_local_port ?? '—'},
      });
    }
  } else if (local.browser.proxy_configured) {
    checks.push({
      id: 'browser_dns_lock',
      status: 'warn',
      titleKey: 'risk.check.browserDnsLock.title',
      summaryKey: 'risk.check.browserDnsLock.warnHttpScheme',
      summaryParams: {scheme: local.browser.proxy_scheme || 'http'},
    });
  } else {
    checks.push({
      id: 'browser_dns_lock',
      status: 'warn',
      titleKey: 'risk.check.browserDnsLock.title',
      summaryKey: 'risk.check.browserDnsLock.warnFollowTun',
    });
  }

  // 4. Configuration evidence and HTTP routing samples; neither measures DNS packets.
  if (!local) {
    checks.push({id: 'mihomo_dns_leak', status: 'pending', titleKey: 'risk.check.mihomoDnsLeak.title', summaryKey: 'risk.check.mihomoDnsLeak.pending'});
  } else {
    const m = local.mihomo;
    const issues: string[] = [];
    const unknowns: string[] = [];
    const add = (reason: string) => issues.push(`risk.check.mihomoDnsLeak.${reason}`);
    const unknown = (reason: string) => unknowns.push(`risk.check.mihomoDnsLeak.${reason}`);
    if (probe?.unlisted_same_country === false && probe.claude.ok && probe.unlisted_dns.ok) add('unlistedMismatch');
    if (!m.detected) {
      unknown('notDetected');
    } else {
      if (m.config_source !== 'running_core' || m.config_source_status !== 'confirmed') unknown('unconfirmedSource');
      if (m.dns_enabled === false) add('dnsDisabled');
      else if (m.dns_enabled !== true) unknown('dnsUnknown');
      if (m.tun_enabled === true) {
        if (m.tun_strict_route === false) add('strictRouteDisabled');
        else if (m.tun_strict_route !== true) unknown('strictRouteUnknown');
      } else if (m.tun_enabled !== false) unknown('tunUnknown');
      if (m.dns_respect_rules === false) add(m.dns_has_domestic_plain && m.has_geoip_cn ? 'failDomesticLeak' : 'respectRulesDisabled');
      else if (m.dns_respect_rules !== true) unknown('respectRulesUnknown');
      if (m.dns_projection_complete !== true) unknown('projectionIncomplete');
      else if (m.dns_has_encrypted_resolver !== true) add('noEncryptedDns');
      else if (!m.dns_has_remote_doh && m.dns_has_domestic_encrypted) add('domesticEncryptedDns');
    }
    if (local.system.secondary_plaintext_dns_active && local.system.tun_adapter_active && m.tun_strict_route !== true) add('warnSecondaryDns');
    const reasons = [...issues, ...unknowns];
    checks.push({
      id: 'mihomo_dns_leak',
      status: issues.length ? 'warn' : unknowns.length ? 'pending' : 'ok',
      titleKey: 'risk.check.mihomoDnsLeak.title',
      summaryKey: reasons[0] ?? 'risk.check.mihomoDnsLeak.ok',
      summaryParams: {claudeCountry: probe?.claude.country || '?', dnsCountry: probe?.unlisted_dns.country || '?'},
      detailKeys: reasons.slice(1),
    });
  }

  // 5. KYC 身份核验域名分流与 QUIC/独立监听加固
  if (!local) {
    checks.push({
      id: 'kyc_routing_rules',
      status: 'pending',
      titleKey: 'risk.check.kycRoutingRules.title',
      summaryKey: 'risk.check.kycRoutingRules.pending',
    });
  } else if (!local.mihomo.detected) {
    if (probe && compareProbeExits(probe) === 'same_ip') {
      checks.push({
        id: 'kyc_routing_rules',
        status: 'ok',
        titleKey: 'risk.check.kycRoutingRules.title',
        summaryKey: 'risk.check.kycRoutingRules.okProbed',
      });
    } else {
      checks.push({
        id: 'kyc_routing_rules',
        status: 'warn',
        titleKey: 'risk.check.kycRoutingRules.title',
        summaryKey: 'risk.check.kycRoutingRules.notDetected',
      });
    }
  } else if (local.mihomo.config_source !== 'running_core' || local.mihomo.config_source_status !== 'confirmed') {
    checks.push({id: 'kyc_routing_rules', status: 'pending', titleKey: 'risk.check.kycRoutingRules.title', summaryKey: 'risk.check.kycRoutingRules.unconfirmedSource'});
  } else if (!local.mihomo.has_persona_rules) {
    checks.push({
      id: 'kyc_routing_rules',
      status: 'warn',
      titleKey: 'risk.check.kycRoutingRules.title',
      summaryKey: 'risk.check.kycRoutingRules.missingPersona',
    });
  } else if (!local.mihomo.has_quic_reject || !local.mihomo.dedicated_listener_port) {
    checks.push({
      id: 'kyc_routing_rules',
      status: 'warn',
      titleKey: 'risk.check.kycRoutingRules.title',
      summaryKey: 'risk.check.kycRoutingRules.warnMissingQuicOrListener',
    });
  } else {
    checks.push({
      id: 'kyc_routing_rules',
      status: 'ok',
      titleKey: 'risk.check.kycRoutingRules.title',
      summaryKey: 'risk.check.kycRoutingRules.okFull',
      summaryParams: {port: local.mihomo.dedicated_listener_port},
    });
  }

  // 6. 出口住宅 ISP / 机房属性核验
  if (!probe) {
    checks.push({
      id: 'exit_isp_kind',
      status: 'pending',
      titleKey: 'risk.check.exitIspKind.title',
      summaryKey: 'risk.check.exitIspKind.pending',
    });
  } else {
    const kind = classifyExitIsp(probe.exit_isp);
    const ispLabel = probe.exit_isp?.isp || probe.exit_isp?.asn || '—';
    if (kind === 'isp') {
      checks.push({
        id: 'exit_isp_kind',
        status: 'ok',
        titleKey: 'risk.check.exitIspKind.title',
        summaryKey: 'risk.check.exitIspKind.okIsp',
        summaryParams: {isp: ispLabel},
      });
    } else if (kind === 'hosting') {
      checks.push({
        id: 'exit_isp_kind',
        status: 'fail',
        titleKey: 'risk.check.exitIspKind.title',
        summaryKey: 'risk.check.exitIspKind.failHosting',
        summaryParams: {isp: ispLabel},
      });
    } else {
      checks.push({
        id: 'exit_isp_kind',
        status: 'warn',
        titleKey: 'risk.check.exitIspKind.title',
        summaryKey: 'risk.check.exitIspKind.unknown',
        summaryParams: {isp: ispLabel},
      });
    }
  }

  return checks;
}

const VALID_PROXY_HOST_RE = /^(?=.{1,128}$)(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function stripCodePasteQuotesAndComma(raw: string): string {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^(['"])([^\r\n]*?)\1\s*[,;]?$/);
  if (quoted) return quoted[2].trim();
  return trimmed;
}

export function parsePortInput(raw: string): number {
  const cleaned = stripCodePasteQuotesAndComma(raw).replace(/[,;\s]+$/g, '');
  if (!/^\d{1,5}$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export function buildShadowrocketSocksQrUri(opts: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  remarks?: string;
}): string | null {
  const host = stripCodePasteQuotesAndComma(opts.host).replace(/^['"\s]+|['",;\s]+$/g, '');
  const user = stripCodePasteQuotesAndComma(opts.username ?? '');
  const rawPass = (opts.password ?? '').trim();
  const passQuotedComma = rawPass.match(/^(['"])([^\r\n]+)\1\s*[,;]$/);
  const pass = passQuotedComma ? passQuotedComma[2] : rawPass;
  if (!VALID_PROXY_HOST_RE.test(host)) return null;
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) return null;
  if (/[\r\n\0]/.test(user) || /[\r\n\0]/.test(pass)) return null;
  if (!user && pass) return null;

  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  const remarks = encodeURIComponent((opts.remarks ?? 'Claude-Local-KYC').trim() || 'Claude-Local-KYC');
  const uri = `socks5://${auth}${host}:${opts.port}?remarks=${remarks}#${remarks}`;
  return new TextEncoder().encode(uri).length <= 265 ? uri : null;
}

export function buildShadowrocketUniversalAntiLeakConf(): {configText: string; filename: string} {
  return {
    filename: 'claude-local-kyc-shadowrocket-antileak.conf',
    configText: [
      '# Claude-Local Universal KYC Anti-Leak Profile (Shadowrocket / iPhone)',
      '# Zero node secrets stored: routes all TCP via your active Home-screen node (e.g. Kookeey -> Proxy Through iKuuu),',
      '# enforces IP-literal remote DoH (campus UDP:53 safe), disables IPv6 leaks, and blocks QUIC (UDP 443) + WebRTC STUN.',
      '[General]',
      'bypass-system = true',
      'skip-proxy = 127.0.0.1, ::1, localhost',
      'tun-excluded-routes = 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16',
      'dns-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query',
      'ipv6 = false',
      'prefer-ipv6 = false',
      'always-real-ip = *',
      'udp-policy-not-supported-behaviour = REJECT',
      '',
      '[Rule]',
      'AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP',
      'AND,((PROTOCOL,UDP),(DEST-PORT,3478)),REJECT',
      'AND,((PROTOCOL,UDP),(DEST-PORT,19302)),REJECT',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      'FINAL,PROXY,dns-failed',
    ].join('\n'),
  };
}

export function buildMobileBridgeConfig(opts: {
  client: MobileClientId;
  lanIp: string;
  port: number;
  username: string;
  password: string;
}): MobileBridgeArtifact | null {
  const lanIp = opts.lanIp.trim();
  const username = opts.username.trim();
  const password = opts.password.trim();
  if (!isValidRfc1918Ipv4(lanIp) || !isValidBridgePort(opts.port)) return null;
  if (!CREDENTIAL_TOKEN_RE.test(username) || !CREDENTIAL_TOKEN_RE.test(password)) return null;

  const socksUri = `socks5://${username}:${password}@${lanIp}:${opts.port}#Claude-Local-KYC`;

  if (opts.client === 'shadowrocket') {
    const qrUri =
      buildShadowrocketSocksQrUri({
        host: lanIp,
        port: opts.port,
        username,
        password,
        remarks: 'Claude-Local-KYC',
      }) ?? socksUri;
    const configText = [
      '# Claude-Local Mobile KYC Same-Origin Bridge (Shadowrocket)',
      '# Upstream residential credentials stay on PC; close LAN listener after KYC.',
      '[General]',
      'bypass-system = true',
      'skip-proxy = 127.0.0.1, ::1, localhost',
      'tun-excluded-routes = 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16',
      'dns-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query',
      'ipv6 = false',
      'prefer-ipv6 = false',
      'always-real-ip = *',
      'udp-policy-not-supported-behaviour = REJECT',
      '',
      '[Proxy]',
      `CL-PC-Residential = socks5, ${lanIp}, ${opts.port}, ${username}, ${password}`,
      '',
      '[Rule]',
      'AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT-NO-DROP',
      'AND,((PROTOCOL,UDP),(DEST-PORT,3478)),REJECT',
      'AND,((PROTOCOL,UDP),(DEST-PORT,19302)),REJECT',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      'FINAL,CL-PC-Residential,dns-failed',
    ].join('\n');
    return {
      client: 'shadowrocket',
      qrUri,
      socksUri,
      configText,
      filename: 'claude-local-kyc-shadowrocket.conf',
    };
  }

  if (opts.client === 'clash-mi') {
    const configText = [
      '# Claude-Local Mobile KYC Same-Origin Bridge (Clash Mi / FlClash / Mihomo)',
      'mixed-port: 7890',
      'allow-lan: false',
      'mode: rule',
      'ipv6: false',
      'unified-delay: true',
      'tcp-concurrent: true',
      '',
      'tun:',
      '  enable: true',
      '  stack: gvisor',
      '  auto-route: true',
      '  strict-route: true',
      '  inet4-route-exclude-address:',
      '    - 127.0.0.0/8',
      '    - 10.0.0.0/8',
      '    - 172.16.0.0/12',
      '    - 192.168.0.0/16',
      '  dns-hijack:',
      '    - any:53',
      '    - tcp://any:53',
      '',
      'dns:',
      '  enable: true',
      '  ipv6: false',
      '  enhanced-mode: fake-ip',
      '  fake-ip-range: 198.18.0.1/16',
      '  respect-rules: true',
      '  nameserver:',
      '    - https://1.1.1.1/dns-query#CL-PC-Residential',
      '    - https://8.8.8.8/dns-query#CL-PC-Residential',
      '',
      'proxies:',
      '  - name: CL-PC-Residential',
      '    type: socks5',
      `    server: ${lanIp}`,
      `    port: ${opts.port}`,
      `    username: "${username}"`,
      `    password: "${password}"`,
      '    udp: false',
      '',
      'rules:',
      '  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,3478)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,19302)),REJECT',
      '  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      '  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      '  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      '  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      '  - MATCH,CL-PC-Residential',
    ].join('\n');
    return {
      client: 'clash-mi',
      qrUri: socksUri,
      socksUri,
      configText,
      filename: 'claude-local-kyc-mihomo.yaml',
    };
  }

  if (opts.client === 'stash') {
    const configText = [
      '# Claude-Local Mobile KYC Same-Origin Bridge (Stash iOS)',
      'mode: rule',
      'allow-lan: false',
      'ipv6: false',
      '',
      'dns:',
      '  enable: true',
      '  ipv6: false',
      '  enhanced-mode: fake-ip',
      '  fake-ip-range: 198.18.0.1/16',
      '  nameserver:',
      '    - https://1.1.1.1/dns-query',
      '    - https://8.8.8.8/dns-query',
      '',
      'proxies:',
      '  - name: CL-PC-Residential',
      '    type: socks5',
      `    server: ${lanIp}`,
      `    port: ${opts.port}`,
      `    username: "${username}"`,
      `    password: "${password}"`,
      '    udp: false',
      '',
      'rules:',
      '  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,3478)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,19302)),REJECT',
      '  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      '  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      '  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      '  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      '  - MATCH,CL-PC-Residential',
    ].join('\n');
    return {
      client: 'stash',
      qrUri: socksUri,
      socksUri,
      configText,
      filename: 'claude-local-kyc-stash.yaml',
    };
  }

  const singBoxObj = {
    log: {level: 'warn'},
    dns: {
      servers: [
        {
          tag: 'remote-doh',
          address: 'https://1.1.1.1/dns-query',
          detour: 'cl-pc-residential',
        },
      ],
      final: 'remote-doh',
      strategy: 'ipv4_only',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        address: ['172.19.0.1/30'],
        auto_route: true,
        strict_route: true,
        route_exclude_address: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
        sniff: true,
      },
    ],
    outbounds: [
      {
        type: 'socks',
        tag: 'cl-pc-residential',
        server: lanIp,
        server_port: opts.port,
        version: '5',
        username,
        password,
        network: 'tcp',
      },
      {type: 'direct', tag: 'direct'},
      {type: 'block', tag: 'block'},
      {type: 'dns', tag: 'dns-out'},
    ],
    route: {
      auto_detect_interface: true,
      rules: [
        {protocol: 'dns', outbound: 'dns-out'},
        {network: 'udp', port: [443, 3478, 19302], outbound: 'block'},
        {ip_cidr: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'], outbound: 'direct'},
      ],
      final: 'cl-pc-residential',
    },
  };

  return {
    client: 'sing-box',
    qrUri: socksUri,
    socksUri,
    configText: JSON.stringify(singBoxObj, null, 2),
    filename: 'claude-local-kyc-singbox.json',
  };
}

export function buildDesktopDnsFixPrompt(opts: {
  locale?: Locale;
  dedicatedPort?: number;
  enableLanBridge?: boolean;
  lanUsername?: string;
  lanPassword?: string;
  clientKind?: string | null;
  targetTimezone?: string;
}): string {
  const locale = opts.locale ?? 'zh';
  const port = isValidBridgePort(opts.dedicatedPort ?? DEFAULT_DEDICATED_LISTENER_PORT)
    ? (opts.dedicatedPort ?? DEFAULT_DEDICATED_LISTENER_PORT)
    : DEFAULT_DEDICATED_LISTENER_PORT;
  const clientName = opts.clientKind?.trim() || 'Clash Verge Rev / Mihomo';
  const lanOpen = Boolean(opts.enableLanBridge && opts.lanUsername && opts.lanPassword);

  if (locale === 'en') {
    const listenerLine = lanOpen
      ? `5. Dedicated Residential Listener & Temporary Mobile KYC Bridge: Add a Mihomo \`listeners\` entry named \`claude-kyc-residential\` (` +
        `type: mixed, port: ${port}, listen: 0.0.0.0, udp: false, proxy: <the exact static residential proxy/group>, ` +
        `users: [{ username: "${opts.lanUsername}", password: "${opts.lanPassword}" }]). Keep the main \`mixed-port\` \`allow-lan: false\`. ` +
        `If Windows Firewall blocks LAN devices on Private Wi-Fi, allow inbound TCP ${port} on the Private profile only.`
      : `5. Dedicated Local Residential Listener: Add a Mihomo \`listeners\` entry named \`claude-kyc-residential\` (` +
        `type: mixed, port: ${port}, listen: 127.0.0.1, udp: false, proxy: <the exact static residential proxy/group>) so Claude-Local Browser can bind \`socks5://127.0.0.1:${port}\` with remote DNS locked and zero LAN exposure.`;

    return [
      `Please inspect and harden my local ${clientName} configuration to eliminate WebRTC leaks, DNS leaks, and KYC split-routing between claude.ai and withpersona.com.`,
      '1. Back Up & Persist Across Subscription Updates: Back up the active profile and place all changes in the persistent Global Extend Config (Merge) or Extend Script so subscription refreshes never overwrite them, preserving all existing nodes and subscriptions.',
      '2. Unified KYC & Anti-Fraud Residential Routing: Route ALL of the following domains and DoH resolver IPs to the EXACT SAME static residential exit used by claude.ai (never transit/fallback nodes): claude.ai, anthropic.com, clau.de, claudeusercontent.com, withpersona.com, persona.org, personacustomer.com, persona-cdn.com, stripe.com, stripe.network, hcaptcha.com, challenges.cloudflare.com, arkoselabs.com, sift.com, siftscience.com, sentry.io, intercom.io, statsig.com, ipquery.io, ippure.com, plus IP-CIDR 1.1.1.1/32, 1.0.0.1/32, 8.8.8.8/32 (no-resolve) and Fake-IP leak guard IP-CIDR,198.18.0.0/15,REJECT,no-resolve. Keep localhost, 127.0.0.1 and ::1 DIRECT.',
      '3. Block WebRTC STUN/TURN & QUIC UDP Leaks: Add explicit rules rejecting UDP ports 443 (QUIC), 3478, 19302 and 5349 (WebRTC STUN/TURN) plus `DOMAIN-KEYWORD,stun,REJECT` (`AND,((NETWORK,UDP),(DST-PORT,443)),REJECT`, `AND,((NETWORK,UDP),(DST-PORT,3478)),REJECT`, `AND,((NETWORK,UDP),(DST-PORT,19302)),REJECT`, `AND,((NETWORK,UDP),(DST-PORT,5349)),REJECT`) so neither TUN nor system browsers can leak real ISP UDP/WebRTC candidates.',
      '4. Eliminate Domestic Plaintext DNS Leaks (Campus/Enterprise Safe): Enable `sniffer.enable: true` (`parse-pure-ip: true`), `dns.respect-rules: true`, and `dns.direct-nameserver-follow-policy: true`; configure `proxy-server-nameserver` (`system`, `https://223.5.5.5/dns-query`, `https://1.12.12.12/dns-query`) strictly for resolving proxy server hostnames; use IP-literal encrypted remote DoH (`https://1.1.1.1/dns-query`, `https://8.8.8.8/dns-query` — avoids campus UDP:53 bootstrap hangs) for non-CN / Claude / Persona domains while keeping `geosite:cn,private` on `system` + domestic DoH via `nameserver-policy`; and set `tun.strict-route: true` with `inet4-route-exclude-address: [127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]` and `dns-hijack: [any:53, tcp://any:53]` so multi-homed Windows adapters never leak DNS while intranet/domestic traffic stays fast.',
      listenerLine,
      `6. Verify & Report: Reload the config, refresh the subscription once to confirm changes persist, and verify via curl that https://claude.ai/cdn-cgi/trace and https://withpersona.com/cdn-cgi/trace return the exact same exit IP and country code, then remind me to set Claude-Local Browser proxy to socks5://127.0.0.1:${port} and provide a one-step rollback command.`,
    ].join('\n');
  }

  const listenerLineZh = lanOpen
    ? `5. 独立家宽监听与手机 KYC 临时鉴权桥接：在 Mihomo \`listeners\` 中配置独立入口 \`claude-kyc-residential\`（` +
      `type: mixed, port: ${port}, listen: 0.0.0.0, udp: false, proxy: <与 claude.ai 完全一致的静态家宽节点或策略组>, ` +
      `users: [{ username: "${opts.lanUsername}", password: "${opts.lanPassword}" }]），同时保持主端口 \`mixed-port\` 的 \`allow-lan: false\` 不对局域网裸奔；若 Windows 防火墙拦截同一私有 Wi-Fi 手机访问，仅对「专用网络（Private）」临时放行入站 TCP ${port}。`
    : `5. 独立本地家宽监听端口（零局域网暴露 + 物理切断 UDP）：在 Mihomo \`listeners\` 中配置独立入口 \`claude-kyc-residential\`（` +
      `type: mixed, port: ${port}, listen: 127.0.0.1, udp: false, proxy: <与 claude.ai 完全一致的静态家宽节点或策略组>），便于 Claude-Local 浏览环境直接填写 \`socks5://127.0.0.1:${port}\` 同时锁死远程 DNS 与阻断非代理 UDP。`;

  return [
    `请检查并加固我本机的 ${clientName} 配置，彻底根治 WebRTC 穿透泄露、DNS 抢答泄露以及 claude.ai 与 KYC 核验服务 withpersona.com 跨域名分流不一致的问题：`,
    '1. 先备份并写入持久化覆写层：先完整备份当前生效配置文件与全局扩展覆写配置/脚本（Merge / Script），将修改写入不会被订阅刷新冲掉的扩展覆写层，保留原有订阅、节点与无关分流规则。',
    '2. 补齐 KYC 与风控全链路同源家宽分流：将以下域名与远程 DoH 解析器 IP 全部强制指向与 claude.ai 完全相同的静态住宅出口策略组（严禁漏入默认中转节点或直连）：claude.ai、anthropic.com、clau.de、claudeusercontent.com、withpersona.com、persona.org、personacustomer.com、persona-cdn.com、stripe.com、stripe.network、hcaptcha.com、challenges.cloudflare.com、arkoselabs.com、sift.com、siftscience.com、sentry.io、intercom.io、statsig.com、ipquery.io、ippure.com，以及 `IP-CIDR,1.1.1.1/32`、`IP-CIDR,1.0.0.1/32`、`IP-CIDR,8.8.8.8/32`（`no-resolve`）和防 Fake-IP 漏出规则 `IP-CIDR,198.18.0.0/15,REJECT,no-resolve`；同时确保 localhost、127.0.0.1、::1 本地回调保持 DIRECT。',
    '3. 阻断 WebRTC STUN/TURN 穿透与 QUIC UDP 旁路：添加 `AND,((NETWORK,UDP),(DST-PORT,443)),REJECT`（阻断 HTTP/3 QUIC）以及 `AND,((NETWORK,UDP),(DST-PORT,3478)),REJECT`、`AND,((NETWORK,UDP),(DST-PORT,19302)),REJECT`、`AND,((NETWORK,UDP),(DST-PORT,5349)),REJECT`、`DOMAIN-KEYWORD,stun,REJECT`（阻断 WebRTC STUN/TURN 探测），防止浏览器在 TUN 或直连下通过 UDP 暴露本机运营商真实公网 IP。',
    '4. 根治国内明文 DNS 抢答泄露（兼容校园网/企业内网）：开启 `sniffer.enable: true`（`parse-pure-ip: true`）、`dns.respect-rules: true` 与 `dns.direct-nameserver-follow-policy: true`；配置 `proxy-server-nameserver`（`system`、`https://223.5.5.5/dns-query`、`https://1.12.12.12/dns-query`）仅用于解析节点服务器域名；将海外及 Claude/Persona 域名的 `nameserver` 切换至纯 IP 远程加密 DoH（`https://1.1.1.1/dns-query`、`https://8.8.8.8/dns-query`，规避校园网封锁 UDP:53 导致的域名 DoH 引导死锁），并在 `nameserver-policy` 中让 `geosite:cn,private` 保留 `system` + 国内 DoH；若启用了 TUN，开启 `strict-route: true` 并配置 `inet4-route-exclude-address: [127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]` 与 `dns-hijack: [any:53, tcp://any:53]`，既阻断双网卡明文 DNS 泄露又确保内网与国内直连秒开。',
    listenerLineZh,
    `6. 实测验证与回滚说明：重载配置并手动刷新一次订阅确认覆写未丢失，分别请求 https://claude.ai/cdn-cgi/trace 与 https://withpersona.com/cdn-cgi/trace，确认两者的 ip= 与 loc= 完全一致；最后提醒我将 Claude-Local「浏览环境」代理设为 socks5://127.0.0.1:${port}，并附上一键回滚方法。`,
  ].join('\n');
}

export function buildCloseLanBridgePrompt(port = DEFAULT_DEDICATED_LISTENER_PORT, locale: Locale = 'zh'): string {
  const safePort = isValidBridgePort(port) ? port : DEFAULT_DEDICATED_LISTENER_PORT;
  if (locale === 'en') {
    return [
      `My mobile KYC verification is complete. Please lock down my local Clash Verge Rev / Mihomo listener on port ${safePort}:`,
      `1. Change the listener on port ${safePort} back to \`listen: 127.0.0.1\` and remove the temporary \`users\` credentials so \`socks5://127.0.0.1:${safePort}\` remains available only to local Claude-Local Browser.`,
      '2. Ensure top-level `allow-lan` remains `false`.',
      `3. Remove any temporary Windows Firewall inbound rule created for TCP port ${safePort}, reload Mihomo, and verify port ${safePort} only listens on 127.0.0.1.`,
    ].join('\n');
  }
  return [
    `我的手机扫码 KYC 验证已完成，请立即帮我收起本机 Clash Verge Rev / Mihomo 在端口 ${safePort} 上的局域网暴露面：`,
    `1. 将端口 ${safePort} 的独立 \`listeners\` 监听地址改回 \`listen: 127.0.0.1\`，并移除临时 \`users\` 鉴权口令，使其仅对本机 Claude-Local 浏览器（\`socks5://127.0.0.1:${safePort}\`）可用。`,
    '2. 确认顶层 `allow-lan` 保持 `false`。',
    `3. 若此前为 TCP ${safePort} 添加过 Windows 防火墙临时入站规则，请一并清理，重载配置后核验 ${safePort} 仅监听在 127.0.0.1。`,
  ].join('\n');
}

const CLIENT_LABELS: Record<MobileClientId, string> = {
  shadowrocket: 'Shadowrocket (iOS)',
  'clash-mi': 'Clash Mi / FlClash (Mihomo)',
  stash: 'Stash (iOS)',
  'sing-box': 'sing-box / NekoBox',
};

export function buildStandaloneMobilePrompt(opts: {
  client: MobileClientId;
  targetTimezone?: string;
  locale?: Locale;
}): string {
  const locale = opts.locale ?? 'zh';
  const clientLabel = CLIENT_LABELS[opts.client];
  const tzHint = opts.targetTimezone?.trim() || 'America/Los_Angeles';

  if (locale === 'en') {
    return [
      `My PC is on a public/campus network or AP-isolated Wi-Fi where LAN port sharing is unsafe. Generate a standalone Global TUN configuration for ${clientLabel} on my phone using the exact same two-hop residential chain as my PC (iKuuu transit -> Kookeey static residential SOCKS5):`,
      '1. Ask me for my transit node and static residential SOCKS5 host/port/username/password if not already provided in this local session.',
      `2. Build a complete, importable ${clientLabel} configuration that chains Transit -> Static Residential (via dialer-proxy / underlying-proxy / detour), enables Global TUN, routes ALL traffic (including claude.ai and withpersona.com) through the static residential exit, uses IP-literal encrypted remote DoH DNS (https://1.1.1.1/dns-query, https://8.8.8.8/dns-query), and explicitly blocks UDP ports 443 (QUIC), 3478 and 19302 (WebRTC STUN).`,
      `3. Give step-by-step instructions to import this profile on my phone, enable Airplane Mode + Wi-Fi, set phone timezone manually to ${tzHint}, and verify in Private Browsing that https://claude.ai/cdn-cgi/trace and https://withpersona.com/cdn-cgi/trace show my PC's exact residential ip= and http=http/2 before scanning the KYC QR code.`,
    ].join('\n');
  }

  return [
    `我当前处于校园网 / 公网有线或路由器 AP 隔离环境，不便开启电脑局域网共享端口。请为我手机端的 ${clientLabel} 生成一份与电脑完全同源的「独立双跳静态家宽全局 TUN 配置」（iKuuu 前置中转 -> Kookeey 静态住宅 SOCKS5）：`,
    '1. 若当前会话尚未提供前置中转节点与静态家宽 SOCKS5 的服务器、端口、账号密码，请先向我询问。',
    `2. 按 ${clientLabel} 原生语法生成完整可导入的配置文件：使用链式代理（dialer-proxy / underlying-proxy / detour）串联「前置节点 -> 静态家宽」，开启全局 TUN 接管，确保 claude.ai 与 withpersona.com 等全部流量统一走该静态家宽出口，启用纯 IP 远程加密 DoH（https://1.1.1.1/dns-query、https://8.8.8.8/dns-query）防 DNS 泄露，并显式拦截 UDP 443（QUIC，防纯 TCP 家宽卡死）及 UDP 3478/19302（防 WebRTC STUN 穿透）。`,
    `3. 给出手机端导入步骤，并提醒我在开启飞行模式仅连 Wi-Fi、手动将手机时区对齐为 ${tzHint} 后，先用手机无痕浏览器访问 https://claude.ai/cdn-cgi/trace 与 https://withpersona.com/cdn-cgi/trace 核对 ip= 与电脑完全一致且 http=http/2 再扫 KYC 二维码。`,
  ].join('\n');
}

export function buildMihomoStrictRouteSnippet(): string {
  return ['tun:', '  enable: true', '  strict-route: true'].join('\n');
}

export function buildDesktopMihomoAntiLeakYaml(port = DEFAULT_DEDICATED_LISTENER_PORT): {
  configText: string;
  filename: string;
} {
  const safePort = isValidBridgePort(port) ? port : DEFAULT_DEDICATED_LISTENER_PORT;
  return {
    filename: 'claude-local-mihomo-antileak-override.yaml',
    configText: [
      '# Claude-Local 电脑端一键防封覆写配置 (Clash Verge Rev / FlClash / Mihomo)',
      '# 用法：将下方「<你的静态家宽节点名称>」替换为你实际的家宽节点或策略组名，',
      '# 粘贴至 Clash Verge Rev「订阅 -> 全局扩展覆写配置 -> 编辑」并启用（刷新订阅不会丢失）。',
      'tun:',
      '  enable: true',
      '  strict-route: true',
      '  auto-route: true',
      '  dns-hijack:',
      '    - any:53',
      '    - tcp://any:53',
      '  inet4-route-exclude-address:',
      '    - 127.0.0.0/8',
      '    - 10.0.0.0/8',
      '    - 172.16.0.0/12',
      '    - 192.168.0.0/16',
      '',
      'sniffer:',
      '  enable: true',
      '  parse-pure-ip: true',
      '  force-dns-mapping: false',
      '  override-destination: false',
      '',
      'dns:',
      '  enable: true',
      '  enhanced-mode: fake-ip',
      '  fake-ip-range: 198.18.0.1/16',
      '  respect-rules: true',
      '  direct-nameserver-follow-policy: true',
      '  proxy-server-nameserver:',
      '    - https://223.5.5.5/dns-query',
      '    - https://1.12.12.12/dns-query',
      '  direct-nameserver:',
      '    - https://223.5.5.5/dns-query',
      '    - https://1.12.12.12/dns-query',
      '  fake-ip-filter:',
      '    - "*.lan"',
      '    - "*.local"',
      '    - "*.home.arpa"',
      '    - "localhost"',
      '  nameserver:',
      '    - "https://1.1.1.1/dns-query#<你的静态家宽节点名称>"',
      '    - "https://8.8.8.8/dns-query#<你的静态家宽节点名称>"',
      '  nameserver-policy:',
      '    "geosite:cn,private":',
      '      - system',
      '      - https://223.5.5.5/dns-query',
      '',
      'listeners:',
      '  - name: claude-kyc-residential',
      '    type: mixed',
      `    port: ${safePort}`,
      '    listen: 127.0.0.1',
      '    udp: false',
      '    proxy: "<你的静态家宽节点名称>"',
      '',
      'prepend-rules:',
      '  # 1. 阻断 QUIC (UDP 443) 与 WebRTC STUN/TURN (UDP 3478/19302/5349)，根除 WebRTC 穿透暴露真实 IP',
      '  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,3478)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,19302)),REJECT',
      '  - AND,((NETWORK,UDP),(DST-PORT,5349)),REJECT',
      '  - DOMAIN-KEYWORD,stun,REJECT',
      '  # 2. 防 Fake-IP 漏出并锁死远程 DoH 解析器走同一静态家宽',
      '  - IP-CIDR,198.18.0.0/15,REJECT,no-resolve',
      '  - IP-CIDR,1.1.1.1/32,<你的静态家宽节点名称>,no-resolve',
      '  - IP-CIDR,1.0.0.1/32,<你的静态家宽节点名称>,no-resolve',
      '  - IP-CIDR,8.8.8.8/32,<你的静态家宽节点名称>,no-resolve',
      '  # 3. Claude 主站 + Persona KYC + Stripe 支付 + 风控探针全链路同源家宽',
      '  - DOMAIN-SUFFIX,claude.ai,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,anthropic.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,clau.de,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,claudeusercontent.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,withpersona.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,persona.org,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,personacustomer.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,persona-cdn.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,stripe.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,stripe.network,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,challenges.cloudflare.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,hcaptcha.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,arkoselabs.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,sift.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,siftscience.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,sentry.io,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,intercom.io,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,statsig.com,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,ipquery.io,<你的静态家宽节点名称>',
      '  - DOMAIN-SUFFIX,ippure.com,<你的静态家宽节点名称>',
    ].join('\n'),
  };
}
