/**
 * [INPUT]: node:http、node:https、node:fs、python + cryptography 临时 SAN 证书签发与 src-tauri/src/browser/server.rs CSP 策略。
 * [OUTPUT]: 导出 MockNetworkSuite（127.0.0.1:0 HTTP + HTTPS 双栈，支持 /cdn-cgi/trace 国家/机房预设、5 源 GeoIP + 同 IP ipquery 分类与故障注入、Mock claude.ai usage/kyc、/probe/webrtc.html、/probe/cross-context.html 与 bindToProxy）及 extractProductionCsp()。
 * [POS]: E2E 出口、GeoIP 与 Claude 服务端仿真层；所有 TLS 凭证在沙盒内动态签发并随沙盒清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import { join, resolve } from 'node:path';
import type { MockHttpConnectProxy } from './mock-proxy.ts';

export type TracePreset =
  | 'us_isp'
  | 'fr_isp'
  | 'jp_isp'
  | 'cn_blocked'
  | 'hk_blocked'
  | 'us_datacenter';

export type GeoProviderKey = 'ipquery' | 'ipinfo' | 'ip_sb' | 'geojs' | 'ipwho';

export type EndpointFault =
  | 'ok'
  | 'rate_limit_429'
  | 'server_500'
  | 'timeout'
  | 'bad_json'
  | 'ip_mismatch'
  | 'oversized'
  | 'html_challenge';

export interface GeoProviderState {
  fault: EndpointFault;
  ip: string;
  country: string;
  city: string;
  timezone: string;
  asn: string;
  isp: string;
  hosting?: boolean;
}

export interface MockNetworkConfig {
  trace: {
    country: string;
    ip: string;
    colo: string;
    fault?: EndpointFault;
    delayMs?: number;
  };
  geoip: Record<GeoProviderKey, GeoProviderState>;
  claude: {
    accountUuid: string;
    email: string;
    organizationUuid: string;
    otherOrganizationUuid?: string;
    usageMode:
      | 'normal'
      | 'ultra_no_5h'
      | 'reset_grants'
      | 'challenge_html'
      | '401'
      | '403'
      | 'timeout'
      | 'identity_changed_on_recheck';
    kycRaw?: Record<string, unknown>;
    subscriptionDetails?: Record<string, unknown> | null;
  };
}

const PRESET_MAP: Record<
  TracePreset,
  {
    country: string;
    ip: string;
    colo: string;
    city: string;
    timezone: string;
    asn: string;
    isp: string;
    hosting: boolean;
  }
> = {
  us_isp: {
    country: 'US',
    ip: '203.0.113.10',
    colo: 'LAX',
    city: 'Los Angeles',
    timezone: 'America/Los_Angeles',
    asn: 'AS6079',
    isp: 'RCN',
    hosting: false,
  },
  fr_isp: {
    country: 'FR',
    ip: '198.51.100.20',
    colo: 'CDG',
    city: 'Paris',
    timezone: 'Europe/Paris',
    asn: 'AS3215',
    isp: 'Orange S.A.',
    hosting: false,
  },
  jp_isp: {
    country: 'JP',
    ip: '203.0.113.30',
    colo: 'NRT',
    city: 'Tokyo',
    timezone: 'Asia/Tokyo',
    asn: 'AS2516',
    isp: 'KDDI CORPORATION',
    hosting: false,
  },
  cn_blocked: {
    country: 'CN',
    ip: '198.51.100.40',
    colo: 'HKG',
    city: 'Beijing',
    timezone: 'Asia/Shanghai',
    asn: 'AS4134',
    isp: 'Chinanet',
    hosting: false,
  },
  hk_blocked: {
    country: 'HK',
    ip: '198.51.100.41',
    colo: 'HKG',
    city: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    asn: 'AS4760',
    isp: 'HKT Limited',
    hosting: false,
  },
  us_datacenter: {
    country: 'US',
    ip: '198.51.100.99',
    colo: 'IAD',
    city: 'Ashburn',
    timezone: 'America/New_York',
    asn: 'AS15169',
    isp: 'Google LLC',
    hosting: true,
  },
};

function generateEphemeralTlsCert(sandboxRoot: string): { key: string; cert: string } {
  const tlsDir = join(sandboxRoot, '.mock-tls');
  mkdirSync(tlsDir, { recursive: true });
  const keyPath = join(tlsDir, 'mock-key.pem');
  const certPath = join(tlsDir, 'mock-cert.pem');

  const pyScript = `
import sys, datetime, ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

key_path, cert_path = sys.argv[1], sys.argv[2]
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, u"claude.ai")])
now = datetime.datetime.now(datetime.timezone.utc)
san = x509.SubjectAlternativeName([
    x509.DNSName(u"claude.ai"),
    x509.DNSName(u"*.claude.ai"),
    x509.DNSName(u"www.cloudflare.com"),
    x509.DNSName(u"api.ipquery.io"),
    x509.DNSName(u"ipinfo.io"),
    x509.DNSName(u"api.ip.sb"),
    x509.DNSName(u"get.geojs.io"),
    x509.DNSName(u"ipwho.is"),
    x509.DNSName(u"localhost"),
    x509.IPAddress(ipaddress.IPv4Address("1.1.1.1")),
    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
])
cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(minutes=5))
    .not_valid_after(now + datetime.timedelta(days=7))
    .add_extension(san, critical=False)
    .sign(key, hashes.SHA256())
)
with open(key_path, "wb") as f:
    f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
with open(cert_path, "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))
`.trim();

  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  let lastErr = '';
  for (const bin of candidates) {
    const args = bin === 'py' ? ['-3', '-c', pyScript, keyPath, certPath] : ['-c', pyScript, keyPath, certPath];
    const res = spawnSync(bin, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    if (res.status === 0) {
      return {
        key: readFileSync(keyPath, 'utf8'),
        cert: readFileSync(certPath, 'utf8'),
      };
    }
    lastErr = `${bin} failed (${res.status}): ${res.stderr || res.error?.message || ''}`;
  }
  throw new Error(`Failed to generate ephemeral TLS cert via Python cryptography: ${lastErr}`);
}

function buildDefaultConfig(): MockNetworkConfig {
  const preset = PRESET_MAP.us_isp;
  const makeGeo = (): GeoProviderState => ({
    fault: 'ok',
    ip: preset.ip,
    country: preset.country,
    city: preset.city,
    timezone: preset.timezone,
    asn: preset.asn,
    isp: preset.isp,
    hosting: preset.hosting,
  });

  return {
    trace: {
      country: preset.country,
      ip: preset.ip,
      colo: preset.colo,
      fault: 'ok',
    },
    geoip: {
      ipquery: makeGeo(),
      ipinfo: makeGeo(),
      ip_sb: makeGeo(),
      geojs: makeGeo(),
      ipwho: makeGeo(),
    },
    claude: {
      accountUuid: '11111111-2222-4333-8444-555555555555',
      email: 'synthetic-e2e@example.invalid',
      organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      usageMode: 'normal',
      kycRaw: {
        status: 'approved',
        check_kind: 'identity',
        vendor_inquiry_id: 'inq_leak_test_should_be_stripped',
        vendor_inquiry_url: 'https://vendor.invalid/leak_should_be_stripped',
      },
      subscriptionDetails: {
        cancel_at_period_end: false,
        current_period_end: '2026-12-31T00:00:00Z',
      },
    },
  };
}

function parseAsnNumber(asn: string): number {
  const digits = asn.replace(/^AS/i, '').trim();
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6079;
}

const WEBRTC_PROBE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>WebRTC Probe</title></head>
<body>
<script>
window.__WEBRTC_DONE__ = false;
window.__WEBRTC_CANDIDATES__ = [];
window.__WEBRTC_ERROR__ = null;
(async () => {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.onicecandidate = (ev) => {
      if (ev.candidate && ev.candidate.candidate) {
        window.__WEBRTC_CANDIDATES__.push(ev.candidate.candidate);
      }
    };
    pc.createDataChannel('probe');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, 1500);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    pc.close();
  } catch (err) {
    window.__WEBRTC_ERROR__ = String(err);
  } finally {
    window.__WEBRTC_DONE__ = true;
  }
})();
</script>
</body>
</html>`;

const CROSS_CONTEXT_PROBE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Cross-Context Probe</title></head>
<body>
<script>
window.__CROSS_CONTEXT_DONE__ = false;
window.__CROSS_CONTEXT__ = null;
(async () => {
  function readWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { supported: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        supported: true,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } catch (e) {
      return { supported: false, error: String(e) };
    }
  }
  function readOffscreenWebGL() {
    try {
      if (typeof OffscreenCanvas === 'undefined') return { supported: false };
      const oc = new OffscreenCanvas(16, 16);
      const gl = oc.getContext('webgl');
      if (!gl) return { supported: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        supported: true,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } catch (e) {
      return { supported: false, error: String(e) };
    }
  }
  async function readWorker() {
    try {
      const code = 'self.onmessage = () => { self.postMessage({ hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); };';
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      return await new Promise((resolve) => {
        const t = setTimeout(() => { w.terminate(); URL.revokeObjectURL(url); resolve({ error: 'timeout' }); }, 2000);
        w.onmessage = (ev) => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(ev.data); };
        w.postMessage('go');
      });
    } catch (e) {
      return { error: String(e) };
    }
  }
  function readIframe(sandboxed) {
    try {
      const iframe = document.createElement('iframe');
      if (sandboxed) iframe.sandbox = 'allow-scripts';
      iframe.srcdoc = '<!doctype html><script>window.parent.postMessage({ type: "iframe-probe", sandboxed: ' + String(sandboxed) + ', hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, "*");<\\/script>';
      return new Promise((resolve) => {
        const t = setTimeout(() => { iframe.remove(); resolve({ error: 'timeout' }); }, 2000);
        const handler = (ev) => {
          if (ev.data && ev.data.type === 'iframe-probe' && ev.data.sandboxed === sandboxed) {
            window.removeEventListener('message', handler);
            clearTimeout(t);
            iframe.remove();
            resolve(ev.data);
          }
        };
        window.addEventListener('message', handler);
        document.body.appendChild(iframe);
      });
    } catch (e) {
      return Promise.resolve({ error: String(e) });
    }
  }

  const winData = {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    orientation: screen.orientation ? screen.orientation.type : null,
    permissionsToString: Function.prototype.toString.call(navigator.permissions.query),
    webgl: readWebGL(),
    offscreenWebgl: readOffscreenWebGL(),
  };

  const [workerData, sameIframe, sandboxIframe] = await Promise.all([
    readWorker(),
    readIframe(false),
    readIframe(true),
  ]);

  window.__CROSS_CONTEXT__ = {
    window: winData,
    worker: workerData,
    sameOriginIframe: sameIframe,
    sandboxedIframe: sandboxIframe,
  };
  window.__CROSS_CONTEXT_DONE__ = true;
})();
</script>
</body>
</html>`;

export class MockNetworkSuite {
  readonly httpPort: number;
  readonly httpsPort: number;
  readonly httpBaseUrl: string;
  readonly httpsBaseUrl: string;
  readonly tlsCert: { key: string; cert: string };

  private readonly httpServer: http.Server;
  private readonly httpsServer: https.Server;
  private readonly activeSockets = new Set<Duplex>();
  private readonly config: MockNetworkConfig = buildDefaultConfig();
  private readonly ipClassifications = new Map<string, { hosting: boolean; fault?: EndpointFault }>();
  private readonly hitCounts: Record<string, number> = {};
  private claudeAccountCalls = 0;
  private closed = false;

  private constructor(
    httpServer: http.Server,
    httpsServer: https.Server,
    httpPort: number,
    httpsPort: number,
    tlsCert: { key: string; cert: string },
  ) {
    this.httpServer = httpServer;
    this.httpsServer = httpsServer;
    this.httpPort = httpPort;
    this.httpsPort = httpsPort;
    this.httpBaseUrl = `http://127.0.0.1:${httpPort}`;
    this.httpsBaseUrl = `https://127.0.0.1:${httpsPort}`;
    this.tlsCert = tlsCert;
  }

  static async start(sandboxRoot: string): Promise<MockNetworkSuite> {
    const tlsCert = generateEphemeralTlsCert(sandboxRoot);
    let suiteRef: MockNetworkSuite;

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      void suiteRef.handleRequest(req, res);
    };

    const httpServer = http.createServer(handler);
    const httpsServer = https.createServer({ key: tlsCert.key, cert: tlsCert.cert }, handler);

    await Promise.all([
      new Promise<void>((resolvePromise, rejectPromise) => {
        httpServer.once('error', rejectPromise);
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', rejectPromise);
          resolvePromise();
        });
      }),
      new Promise<void>((resolvePromise, rejectPromise) => {
        httpsServer.once('error', rejectPromise);
        httpsServer.listen(0, '127.0.0.1', () => {
          httpsServer.off('error', rejectPromise);
          resolvePromise();
        });
      }),
    ]);

    const httpAddr = httpServer.address();
    const httpsAddr = httpsServer.address();
    if (!httpAddr || typeof httpAddr === 'string' || !httpsAddr || typeof httpsAddr === 'string') {
      httpServer.close();
      httpsServer.close();
      throw new Error('MockNetworkSuite failed to bind ephemeral HTTP/HTTPS ports');
    }

    suiteRef = new MockNetworkSuite(httpServer, httpsServer, httpAddr.port, httpsAddr.port, tlsCert);
    for (const srv of [httpServer, httpsServer]) {
      srv.on('connection', (sock) => {
        suiteRef.activeSockets.add(sock);
        sock.once('close', () => suiteRef.activeSockets.delete(sock));
      });
    }
    return suiteRef;
  }

  applyTracePreset(preset: TracePreset): void {
    const p = PRESET_MAP[preset];
    this.config.trace = {
      country: p.country,
      ip: p.ip,
      colo: p.colo,
      fault: 'ok',
    };
    for (const key of Object.keys(this.config.geoip) as GeoProviderKey[]) {
      this.config.geoip[key] = {
        fault: 'ok',
        ip: p.ip,
        country: p.country,
        city: p.city,
        timezone: p.timezone,
        asn: p.asn,
        isp: p.isp,
        hosting: p.hosting,
      };
    }
  }

  setProviderFault(provider: GeoProviderKey, fault: EndpointFault): void {
    this.config.geoip[provider].fault = fault;
  }

  setProviderState(provider: GeoProviderKey, patch: Partial<GeoProviderState>): void {
    Object.assign(this.config.geoip[provider], patch);
  }

  setTraceConfig(patch: Partial<MockNetworkConfig['trace']>): void {
    Object.assign(this.config.trace, patch);
  }

  setIpClassification(ip: string, result: { hosting: boolean; fault?: EndpointFault }): void {
    this.ipClassifications.set(ip, result);
  }

  setClaudeState(patch: Partial<MockNetworkConfig['claude']>): void {
    Object.assign(this.config.claude, patch);
    if (patch.usageMode !== undefined) {
      this.claudeAccountCalls = 0;
    }
  }

  getHitCounts(): Record<string, number> {
    return { ...this.hitCounts };
  }

  resetHits(): void {
    for (const key of Object.keys(this.hitCounts)) {
      delete this.hitCounts[key];
    }
    this.claudeAccountCalls = 0;
  }

  bindToProxy(
    proxy: MockHttpConnectProxy,
    mode: 'tcp_tunnel' | 'tls_terminate' = 'tls_terminate',
  ): void {
    const targetPort = mode === 'tls_terminate' ? this.httpPort : this.httpsPort;
    proxy.setRoute('*', { mode, host: '127.0.0.1', port: targetPort });
  }

  private bumpHit(key: string): void {
    this.hitCounts[key] = (this.hitCounts[key] ?? 0) + 1;
  }

  private sendFault(res: http.ServerResponse, fault: EndpointFault): boolean {
    if (fault === 'ok') return false;
    if (fault === 'timeout') {
      // keep connection open until client aborts
      return true;
    }
    if (fault === 'rate_limit_429') {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': '5',
      });
      res.end(JSON.stringify({ error: 'rate limit' }));
      return true;
    }
    if (fault === 'server_500') {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'internal error' }));
      return true;
    }
    if (fault === 'bad_json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('{not-valid-json');
      return true;
    }
    if (fault === 'oversized') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('{"pad":"' + 'x'.repeat(600 * 1024) + '"}');
      return true;
    }
    if (fault === 'html_challenge') {
      res.writeHead(403, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('<html><body>Just a moment...</body></html>');
      return true;
    }
    return false;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.closed) {
      res.destroy();
      return;
    }

    const rawHost = (req.headers.host ?? '127.0.0.1').toLowerCase();
    const host = rawHost.replace(/:\d+$/, '');
    const url = new URL(req.url ?? '/', `http://${rawHost}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    // 1. Cloudflare trace
    if ((host === 'www.cloudflare.com' || host === '1.1.1.1') && pathname === '/cdn-cgi/trace') {
      this.bumpHit('trace');
      if (this.config.trace.delayMs && this.config.trace.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.config.trace.delayMs));
      }
      if (this.sendFault(res, this.config.trace.fault ?? 'ok')) return;
      const body = `fl=1f1\nh=${host}\nip=${this.config.trace.ip}\nts=${Math.floor(Date.now() / 1000)}.000\nvisit_scheme=https\nuag=Mock\ncolo=${this.config.trace.colo}\nloc=${this.config.trace.country}\n`;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
      return;
    }

    // 2. api.ipquery.io (primary + supplementary same-IP classification)
    if (host === 'api.ipquery.io') {
      if (pathname === '/' && url.searchParams.get('format') === 'json') {
        this.bumpHit('geo:ipquery');
        const g = this.config.geoip.ipquery;
        if (this.sendFault(res, g.fault)) return;
        const ipOut = g.fault === 'ip_mismatch' ? '192.0.2.254' : g.ip;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(
          JSON.stringify({
            ip: ipOut,
            location: { country_code: g.country, city: g.city, timezone: g.timezone },
            isp: { asn: g.asn, org: g.isp, isp: g.isp },
            ...(g.hosting !== undefined ? { risk: { is_datacenter: g.hosting } } : {}),
          }),
        );
        return;
      }

      const ipMatch = pathname.match(/^\/([0-9a-fA-F:.]+)$/);
      if (ipMatch) {
        const reqIp = ipMatch[1];
        this.bumpHit(`classify:${reqIp}`);
        const cls = this.ipClassifications.get(reqIp) ?? {
          hosting: this.config.geoip.ipquery.hosting ?? false,
          fault: 'ok' as EndpointFault,
        };
        const fault = cls.fault ?? 'ok';
        if (this.sendFault(res, fault)) return;
        const returnedIp = fault === 'ip_mismatch' ? '192.0.2.253' : reqIp;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(
          JSON.stringify({
            ip: returnedIp,
            risk: { is_datacenter: cls.hosting },
          }),
        );
        return;
      }
    }

    // 3. ipinfo.io
    if (host === 'ipinfo.io' && pathname === '/json') {
      this.bumpHit('geo:ipinfo');
      const g = this.config.geoip.ipinfo;
      if (this.sendFault(res, g.fault)) return;
      const ipOut =
        g.fault === 'ip_mismatch' ? (g.ip === '192.0.2.254' ? '192.0.2.253' : '192.0.2.254') : g.ip;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          ip: ipOut,
          country: g.country,
          city: g.city,
          timezone: g.timezone,
          org: `${g.asn} ${g.isp}`,
          ...(g.hosting !== undefined ? { hosting: g.hosting } : {}),
        }),
      );
      return;
    }

    // 4. api.ip.sb
    if (host === 'api.ip.sb' && pathname === '/geoip') {
      this.bumpHit('geo:ip_sb');
      const g = this.config.geoip.ip_sb;
      if (this.sendFault(res, g.fault)) return;
      const ipOut =
        g.fault === 'ip_mismatch' ? (g.ip === '192.0.2.254' ? '192.0.2.253' : '192.0.2.254') : g.ip;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          ip: ipOut,
          country_code: g.country,
          city: g.city,
          timezone: g.timezone,
          asn: parseAsnNumber(g.asn),
          organization: g.isp,
          ...(g.hosting !== undefined ? { hosting: g.hosting } : {}),
        }),
      );
      return;
    }

    // 5. get.geojs.io
    if (host === 'get.geojs.io' && pathname === '/v1/ip/geo.json') {
      this.bumpHit('geo:geojs');
      const g = this.config.geoip.geojs;
      if (this.sendFault(res, g.fault)) return;
      const ipOut =
        g.fault === 'ip_mismatch' ? (g.ip === '192.0.2.254' ? '192.0.2.253' : '192.0.2.254') : g.ip;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          ip: ipOut,
          country_code: g.country,
          city: g.city,
          timezone: g.timezone,
          asn: parseAsnNumber(g.asn),
          organization_name: `${g.asn} ${g.isp}`,
          ...(g.hosting !== undefined ? { hosting: g.hosting } : {}),
        }),
      );
      return;
    }

    // 6. ipwho.is
    if (host === 'ipwho.is' && pathname === '/') {
      this.bumpHit('geo:ipwho');
      const g = this.config.geoip.ipwho;
      if (this.sendFault(res, g.fault)) return;
      const ipOut =
        g.fault === 'ip_mismatch' ? (g.ip === '192.0.2.254' ? '192.0.2.253' : '192.0.2.254') : g.ip;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          success: true,
          ip: ipOut,
          country_code: g.country,
          city: g.city,
          timezone: { id: g.timezone },
          connection: {
            asn: parseAsnNumber(g.asn),
            org: g.isp,
            isp: g.isp,
            ...(g.hosting !== undefined ? { type: g.hosting ? 'hosting' : 'isp' } : {}),
          },
        }),
      );
      return;
    }

    // 7. claude.ai mock routes
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) {
      const c = this.config.claude;
      if (pathname === '/new' || pathname === '/settings/usage') {
        this.bumpHit(`claude:${pathname}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Mock Claude</title></head><body><main data-mock-route="${pathname}">Mock Claude ${pathname}</main></body></html>`);
        return;
      }

      if (pathname === '/api/account') {
        this.bumpHit('claude:account');
        this.claudeAccountCalls += 1;
        if (c.usageMode === 'challenge_html') {
          this.sendFault(res, 'html_challenge');
          return;
        }
        if (c.usageMode === '401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        if (c.usageMode === '403') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        if (c.usageMode === 'timeout') {
          return;
        }
        const uuid =
          c.usageMode === 'identity_changed_on_recheck' && this.claudeAccountCalls >= 2
            ? '99999999-9999-4999-8999-999999999999'
            : c.accountUuid;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            account_uuid: uuid,
            email_address: c.email,
          }),
        );
        return;
      }

      if (pathname === '/api/account_profile') {
        this.bumpHit('claude:account_profile');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            account: {
              uuid: c.accountUuid,
              email_address: c.email,
            },
          }),
        );
        return;
      }

      if (pathname === '/api/organizations') {
        this.bumpHit('claude:organizations');
        const orgs = [{ uuid: c.organizationUuid, name: 'Synthetic Org' }];
        if (c.otherOrganizationUuid) {
          orgs.push({ uuid: c.otherOrganizationUuid, name: 'Secondary Org' });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orgs));
        return;
      }

      const subMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/subscription_details$/);
      if (subMatch) {
        this.bumpHit('claude:subscription_details');
        if (!c.subscriptionDetails) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(c.subscriptionDetails));
        return;
      }

      const usageMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/usage$/);
      if (usageMatch) {
        this.bumpHit('claude:usage');
        if (c.usageMode === 'challenge_html') {
          this.sendFault(res, 'html_challenge');
          return;
        }
        if (c.usageMode === '401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        if (c.usageMode === '403') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        if (c.usageMode === 'timeout') {
          return;
        }

        const future5h = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
        const future7d = new Date(Date.now() + 5 * 86400 * 1000).toISOString();
        const payload =
          c.usageMode === 'ultra_no_5h'
            ? {
                five_hour: null,
                seven_day: { utilization: 18, resets_at: future7d },
              }
            : c.usageMode === 'reset_grants'
              ? {
                  five_hour: { utilization: 42, resets_at: future5h },
                  seven_day: { utilization: 31, resets_at: future7d },
                  cedar_ember: {
                    eligible: true,
                    grants: [
                      {
                        resets_left: 2,
                        starts_at: new Date(Date.now() - 86400 * 1000).toISOString(),
                        ends_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
                        paused: false,
                      },
                    ],
                  },
                }
              : {
                  five_hour: { utilization: 25, resets_at: future5h },
                  seven_day: { utilization: 15, resets_at: future7d },
                };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      const kycMatch = pathname.match(/^\/api\/organizations\/([^/]+)\/kyc_status$/);
      if (kycMatch) {
        this.bumpHit('claude:kyc_status');
        if (!c.kycRaw) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(c.kycRaw));
        return;
      }
    }

    // 8. Local probe pages
    if (pathname === '/probe/webrtc.html') {
      this.bumpHit('probe:webrtc');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(WEBRTC_PROBE_HTML);
      return;
    }

    if (pathname === '/probe/cross-context.html') {
      this.bumpHit('probe:cross-context');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CROSS_CONTEXT_PROBE_HTML);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'mock_route_not_found', host, pathname }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const sock of this.activeSockets) {
      sock.destroy();
    }
    this.activeSockets.clear();
    (this.httpServer as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    (this.httpsServer as https.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    await Promise.all([
      new Promise<void>((resolvePromise) => this.httpServer.close(() => resolvePromise())),
      new Promise<void>((resolvePromise) => this.httpsServer.close(() => resolvePromise())),
    ]);
  }
}

export function extractProductionCsp(repoRoot: string): {
  connectSrc: string;
  fullHeader: string;
  allowedOrigins: string[];
} {
  const serverRsPath = resolve(repoRoot, 'src-tauri/src/browser/server.rs');
  const content = readFileSync(serverRsPath, 'utf8');
  const fullMatch = content.match(/Content-Security-Policy:\s*([^\r\n\\"]+)/);
  if (!fullMatch) {
    throw new Error(`Failed to extract Content-Security-Policy header from ${serverRsPath}`);
  }
  const fullHeader = fullMatch[1].trim();
  const connectMatch = fullHeader.match(/connect-src\s+([^;]+);?/);
  if (!connectMatch) {
    throw new Error(`Failed to extract connect-src directive from CSP header: ${fullHeader}`);
  }
  const connectSrc = connectMatch[1].trim();
  const allowedOrigins = connectSrc
    .split(/\s+/)
    .filter((token) => token.startsWith('https://') || token.startsWith('http://'));

  return {
    connectSrc,
    fullHeader,
    allowedOrigins,
  };
}
