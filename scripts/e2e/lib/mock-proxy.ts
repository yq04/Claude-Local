/**
 * [INPUT]: node:http、node:net、node:tls、node:stream 阻塞/隧道原语及可选沙盒自签 TLS 证书。
 * [OUTPUT]: 导出 MockHttpConnectProxy（127.0.0.1:0 真实 HTTP + HTTPS CONNECT 代理，支持 tcp_tunnel/tls_terminate 双模式、7 种故障注入、全量 ProxyAuditEntry 记录与 assertNoDomainDnsLeak 域名防泄露断言）。
 * [POS]: E2E 网络隔离与代理故障注入层；完全绑定本地回环随机端口，绝不占用 :7890/:7899/:7900。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import http from 'node:http';
import net from 'node:net';
import { Duplex, Transform } from 'node:stream';
import tls from 'node:tls';

export type ProxyFaultMode =
  | 'healthy'
  | 'delay'
  | 'hang_pre_connect'
  | 'slow_tls'
  | 'drop_mid_stream'
  | 'reject_502'
  | 'rate_limit_429';

export interface ProxyFaultPolicy {
  mode: ProxyFaultMode;
  delayMs?: number;
  dropAfterBytes?: number;
  dropAfterMs?: number;
  retryAfterSec?: number;
}

export type ProxyRouteTarget =
  | { mode: 'tcp_tunnel'; host?: string; port: number }
  | { mode: 'tls_terminate'; host?: string; port: number };

export interface ProxyAuditEntry {
  seq: number;
  timestampMs: number;
  method: 'CONNECT' | 'HTTP';
  rawTarget: string;
  host: string;
  port: number;
  isLiteralIp: boolean;
  faultApplied: ProxyFaultMode;
  routedTo?: string;
}

export interface MockProxyOptions {
  tlsCert?: { key: string | Buffer; cert: string | Buffer };
  defaultFault?: ProxyFaultPolicy;
}

function parseTargetHostPort(rawTarget: string, defaultPort: number): { host: string; port: number } {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx > 0) {
      const host = trimmed.slice(1, closeIdx);
      const rest = trimmed.slice(closeIdx + 1);
      const port = rest.startsWith(':') ? Number(rest.slice(1)) || defaultPort : defaultPort;
      return { host, port };
    }
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon > 0 && trimmed.indexOf(':') === lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = Number(trimmed.slice(lastColon + 1)) || defaultPort;
    return { host, port };
  }
  return { host: trimmed, port: defaultPort };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockHttpConnectProxy {
  readonly host = '127.0.0.1';
  readonly port: number;
  readonly url: string;

  private readonly server: http.Server;
  private readonly tlsCert?: { key: string | Buffer; cert: string | Buffer };
  private readonly defaultFault: ProxyFaultPolicy;
  private readonly routes = new Map<string, ProxyRouteTarget>();
  private readonly faults = new Map<string, ProxyFaultPolicy>();
  private readonly activeSockets = new Set<Duplex>();
  private readonly activeUpstreamRequests = new Set<http.ClientRequest>();
  private readonly auditLog: ProxyAuditEntry[] = [];
  private seqCounter = 0;
  private closed = false;

  private constructor(
    server: http.Server,
    port: number,
    options?: MockProxyOptions,
  ) {
    this.server = server;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.tlsCert = options?.tlsCert;
    this.defaultFault = options?.defaultFault ?? { mode: 'healthy' };
    this.attachHandlers();
  }

  static async start(options?: MockProxyOptions): Promise<MockHttpConnectProxy> {
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      server.close();
      throw new Error('MockHttpConnectProxy failed to bind ephemeral port');
    }
    return new MockHttpConnectProxy(server, addr.port, options);
  }

  setRoute(hostOrPattern: string, target: ProxyRouteTarget): void {
    this.routes.set(hostOrPattern.toLowerCase(), target);
  }

  setFault(hostOrPattern: string, policy: ProxyFaultPolicy): void {
    this.faults.set(hostOrPattern.toLowerCase(), policy);
  }

  clearFaults(): void {
    this.faults.clear();
  }

  getAuditLog(): ProxyAuditEntry[] {
    return this.auditLog.map((entry) => ({ ...entry }));
  }

  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  assertNoDomainDnsLeak(allowedLiteralIps: string[] = ['1.1.1.1', '127.0.0.1', '::1']): void {
    const allowed = new Set(allowedLiteralIps.map((ip) => ip.toLowerCase()));
    const leaks = this.auditLog.filter(
      (entry) => entry.isLiteralIp && !allowed.has(entry.host.toLowerCase()),
    );
    if (leaks.length > 0) {
      const detail = leaks.map((l) => `${l.method} ${l.rawTarget}`).join(', ');
      throw new Error(`DNS leak detected (literal IP sent to proxy instead of domain): ${detail}`);
    }
  }

  private trackSocket(socket: Duplex): void {
    this.activeSockets.add(socket);
    const remove = () => {
      this.activeSockets.delete(socket);
    };
    socket.once('close', remove);
    socket.on('error', () => {
      // swallow connection reset errors on tracked sockets
    });
  }

  private resolvePolicy(host: string, port: number): ProxyFaultPolicy {
    const h = host.toLowerCase();
    return (
      this.faults.get(`${h}:${port}`) ??
      this.faults.get(h) ??
      this.faults.get('*') ??
      this.defaultFault
    );
  }

  private resolveRoute(host: string, port: number): ProxyRouteTarget | undefined {
    const h = host.toLowerCase();
    return (
      this.routes.get(`${h}:${port}`) ??
      this.routes.get(h) ??
      this.routes.get('*')
    );
  }

  private attachHandlers(): void {
    this.server.on('connection', (socket) => {
      this.trackSocket(socket);
    });

    this.server.on('connect', (req, clientSocket, head) => {
      void this.handleConnect(req, clientSocket, head);
    });

    this.server.on('request', (req, res) => {
      void this.handleHttpRequest(req, res);
    });
  }

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    this.trackSocket(clientSocket);
    const rawTarget = req.url ?? '';
    const { host, port } = parseTargetHostPort(rawTarget, 443);
    const policy = this.resolvePolicy(host, port);
    const route = this.resolveRoute(host, port);
    const routedTo = route ? `${route.mode}:${route.host ?? '127.0.0.1'}:${route.port}` : undefined;

    this.auditLog.push({
      seq: ++this.seqCounter,
      timestampMs: Date.now(),
      method: 'CONNECT',
      rawTarget,
      host,
      port,
      isLiteralIp: net.isIP(host) !== 0,
      faultApplied: policy.mode,
      routedTo,
    });

    if (this.closed || clientSocket.destroyed) return;

    if (policy.mode === 'hang_pre_connect') {
      // Deliberately hold socket open without responding until client timeout or proxy close()
      return;
    }

    if (policy.mode === 'reject_502') {
      clientSocket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad Gateway',
      );
      return;
    }

    if (policy.mode === 'rate_limit_429') {
      const retryAfter = policy.retryAfterSec ?? 5;
      const body = 'Too Many Requests';
      clientSocket.end(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
      );
      return;
    }

    if (policy.mode === 'delay') {
      await sleep(policy.delayMs ?? 150);
      if (this.closed || clientSocket.destroyed) return;
    }

    if (!route) {
      clientSocket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 16\r\nConnection: close\r\n\r\nNo route matched',
      );
      return;
    }

    const upstreamHost = route.host ?? '127.0.0.1';

    if (route.mode === 'tcp_tunnel') {
      const upstream = net.connect({ host: upstreamHost, port: route.port });
      this.trackSocket(upstream);

      upstream.once('error', () => {
        if (!clientSocket.destroyed) {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        }
      });

      upstream.once('connect', () => {
        if (this.closed || clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        this.bridgeStreams(clientSocket, upstream, policy);
      });
      return;
    }

    // tls_terminate mode
    if (!this.tlsCert) {
      clientSocket.end(
        'HTTP/1.1 500 Internal Server Error\r\nContent-Length: 23\r\nConnection: close\r\n\r\nTLS cert not configured',
      );
      return;
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    if (policy.mode === 'slow_tls') {
      await sleep(policy.delayMs ?? 250);
      if (this.closed || clientSocket.destroyed) return;
    }

    if (head.length > 0) {
      clientSocket.unshift(head);
    }

    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: this.tlsCert.key,
      cert: this.tlsCert.cert,
    });
    this.trackSocket(tlsSocket);

    const upstream = net.connect({ host: upstreamHost, port: route.port });
    this.trackSocket(upstream);

    upstream.once('error', () => {
      tlsSocket.destroy();
    });

    tlsSocket.once('error', () => {
      upstream.destroy();
    });

    upstream.once('connect', () => {
      if (this.closed || tlsSocket.destroyed) {
        upstream.destroy();
        return;
      }
      this.bridgeStreams(tlsSocket, upstream, policy);
    });
  }

  private bridgeStreams(clientStream: Duplex, upstream: Duplex, policy: ProxyFaultPolicy): void {
    if (policy.mode !== 'drop_mid_stream') {
      clientStream.pipe(upstream);
      upstream.pipe(clientStream);
      clientStream.once('close', () => upstream.destroy());
      upstream.once('close', () => clientStream.destroy());
      return;
    }

    const maxBytes = policy.dropAfterBytes ?? 64;
    let bytesSeen = 0;
    let dropped = false;
    const dropNow = () => {
      if (dropped) return;
      dropped = true;
      clientStream.destroy();
      upstream.destroy();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (policy.dropAfterMs !== undefined) {
      timer = setTimeout(dropNow, policy.dropAfterMs);
    }

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytesSeen += chunk.length;
        if (bytesSeen >= maxBytes) {
          const keep = Math.max(0, chunk.length - (bytesSeen - maxBytes));
          if (keep > 0) this.push(chunk.subarray(0, keep));
          cb();
          setImmediate(dropNow);
          return;
        }
        cb(null, chunk);
      },
    });

    clientStream.pipe(upstream);
    upstream.pipe(meter).pipe(clientStream);
    clientStream.once('close', () => {
      if (timer) clearTimeout(timer);
      upstream.destroy();
    });
    upstream.once('close', () => {
      if (timer) clearTimeout(timer);
      clientStream.destroy();
    });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const rawTarget = req.url ?? '/';
    let targetUrl: URL;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      const hostHeader = req.headers.host ?? '127.0.0.1';
      targetUrl = new URL(`http://${hostHeader}${rawTarget.startsWith('/') ? rawTarget : '/' + rawTarget}`);
    }

    const host = targetUrl.hostname;
    const port = Number(targetUrl.port) || 80;
    const policy = this.resolvePolicy(host, port);
    const route = this.resolveRoute(host, port);
    const routedTo = route ? `${route.mode}:${route.host ?? '127.0.0.1'}:${route.port}` : undefined;

    this.auditLog.push({
      seq: ++this.seqCounter,
      timestampMs: Date.now(),
      method: 'HTTP',
      rawTarget: `${host}:${port}${targetUrl.pathname}`,
      host,
      port,
      isLiteralIp: net.isIP(host) !== 0,
      faultApplied: policy.mode,
      routedTo,
    });

    if (this.closed || res.destroyed) return;

    if (policy.mode === 'hang_pre_connect') {
      return;
    }
    if (policy.mode === 'reject_502') {
      res.writeHead(502, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('Bad Gateway');
      return;
    }
    if (policy.mode === 'rate_limit_429') {
      res.writeHead(429, {
        'Content-Type': 'text/plain',
        'Retry-After': String(policy.retryAfterSec ?? 5),
        Connection: 'close',
      });
      res.end('Too Many Requests');
      return;
    }
    if (policy.mode === 'delay') {
      await sleep(policy.delayMs ?? 150);
      if (this.closed || res.destroyed) return;
    }
    if (!route) {
      res.writeHead(502, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('No route matched');
      return;
    }

    let finished = false;
    let upstreamReq!: http.ClientRequest;
    const markFinished = () => {
      if (finished) return;
      finished = true;
      this.activeUpstreamRequests.delete(upstreamReq);
    };

    upstreamReq = http.request(
      {
        host: route.host ?? '127.0.0.1',
        port: route.port,
        method: req.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: { ...req.headers, host: targetUrl.host },
        agent: false,
      },
      (upstreamRes) => {
        if (this.closed || res.destroyed) {
          markFinished();
          upstreamRes.destroy();
          upstreamReq.destroy();
          return;
        }
        upstreamRes.once('end', markFinished);
        upstreamRes.once('close', markFinished);
        upstreamRes.once('error', () => {
          markFinished();
          if (!res.destroyed) res.destroy();
        });

        if (policy.mode === 'drop_mid_stream') {
          res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
          let sent = 0;
          const limit = policy.dropAfterBytes ?? 32;
          upstreamRes.on('data', (chunk: Buffer) => {
            sent += chunk.length;
            if (sent >= limit) {
              markFinished();
              res.destroy();
              upstreamRes.destroy();
              upstreamReq.destroy();
              return;
            }
            res.write(chunk);
          });
          upstreamRes.on('end', () => {
            markFinished();
            if (!res.destroyed) res.end();
          });
          return;
        }
        res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    this.activeUpstreamRequests.add(upstreamReq);
    upstreamReq.once('close', markFinished);
    upstreamReq.on('error', () => {
      markFinished();
      if (this.closed || res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain', Connection: 'close' });
        res.end('Upstream error');
        return;
      }
      res.destroy();
    });
    req.once('close', () => {
      if (!req.complete && !finished) {
        markFinished();
        upstreamReq.destroy();
      }
    });
    res.once('close', () => {
      if (!finished) {
        markFinished();
        upstreamReq.destroy();
      }
    });
    res.on('error', () => {
      if (!finished) {
        markFinished();
        upstreamReq.destroy();
      }
    });
    req.pipe(upstreamReq);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const upstreamReq of this.activeUpstreamRequests) {
      upstreamReq.destroy();
    }
    this.activeUpstreamRequests.clear();
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    (this.server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
