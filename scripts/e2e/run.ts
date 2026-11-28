/**
 * [INPUT]: CLI 参数（--mode/--tier/--feature/--report-dir/--json/--self-check）、scripts/e2e/suites/*.ts 与 ./lib/*.ts 基础设施库。
 * [OUTPUT]: 串行执行 E2E 用例或 --self-check，强制校验 --mode target Tier 1-4 全覆盖门禁（>=138 用例），输出 report.json 与 report.md 至 .local/e2e/。
 * [POS]: Claude-Local 黑盒 E2E 测试运行器统一入口；只读宿主元数据，隔离执行并自动回收所有沙盒与子进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildMockIpcShellHtml,
  getIpcCommands,
  launchPersistentProfile,
  launchPinnedChrome,
  openMockedAppPage,
  resolvePinnedChromeExecutable,
  startViteServer,
} from './lib/chrome-harness.ts';
import { extractProductionCsp, MockNetworkSuite } from './lib/mock-network.ts';
import { MockHttpConnectProxy } from './lib/mock-proxy.ts';
import {
  resolveClaudeLocalBinary,
  runOrchestrate,
  runQuotaCore,
  seedSyntheticVault,
} from './lib/rust-blackbox.ts';
import {
  captureHostBaseline,
  cleanupAllSandboxes,
  createSandbox,
  diffHostBaseline,
} from './lib/sandbox.ts';
import {
  ALL_FEATURE_IDS,
  ALL_TIERS,
  type CaseExecutionRecord,
  type CoverageValidationResult,
  type E2ECase,
  type E2EContext,
  type E2ERunReport,
  type FeatureId,
  type HostSafetyAuditResult,
  type RunMode,
  type SandboxHandle,
  type SuiteModule,
  type Tier,
} from './lib/types.ts';

interface ParsedCli {
  mode: RunMode;
  tiers: Tier[];
  features: FeatureId[] | null;
  reportDir: string | null;
  json: boolean;
  selfCheck: boolean;
}

function formatUtcCompact(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function parseCliArgs(argv: string[]): ParsedCli {
  let mode: RunMode = 'baseline';
  const tierSet = new Set<Tier>();
  let tierSpecified = false;
  const featureSet = new Set<FeatureId>();
  let featureSpecified = false;
  let reportDir: string | null = null;
  let json = false;
  let selfCheck = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--self-check') {
      selfCheck = true;
      continue;
    }
    if (arg === '--mode') {
      const val = argv[++i];
      if (val !== 'baseline' && val !== 'target') {
        throw new Error(`Invalid --mode value: ${val ?? '<missing>'} (expected baseline|target)`);
      }
      mode = val;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const val = arg.slice('--mode='.length);
      if (val !== 'baseline' && val !== 'target') {
        throw new Error(`Invalid --mode value: ${val} (expected baseline|target)`);
      }
      mode = val;
      continue;
    }
    if (arg === '--tier') {
      const val = argv[++i];
      if (!val) throw new Error('Missing value for --tier');
      tierSpecified = true;
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (part === 'all') {
          for (const t of ALL_TIERS) tierSet.add(t);
        } else {
          const num = Number(part);
          if (num !== 1 && num !== 2 && num !== 3 && num !== 4) {
            throw new Error(`Invalid --tier value: ${part} (expected 1|2|3|4|all)`);
          }
          tierSet.add(num);
        }
      }
      continue;
    }
    if (arg.startsWith('--tier=')) {
      const val = arg.slice('--tier='.length);
      tierSpecified = true;
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (part === 'all') {
          for (const t of ALL_TIERS) tierSet.add(t);
        } else {
          const num = Number(part);
          if (num !== 1 && num !== 2 && num !== 3 && num !== 4) {
            throw new Error(`Invalid --tier value: ${part} (expected 1|2|3|4|all)`);
          }
          tierSet.add(num);
        }
      }
      continue;
    }
    if (arg === '--feature') {
      const val = argv[++i];
      if (!val) throw new Error('Missing value for --feature');
      featureSpecified = true;
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!(ALL_FEATURE_IDS as readonly string[]).includes(part)) {
          throw new Error(`Unknown --feature ID: ${part}`);
        }
        featureSet.add(part as FeatureId);
      }
      continue;
    }
    if (arg.startsWith('--feature=')) {
      const val = arg.slice('--feature='.length);
      featureSpecified = true;
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!(ALL_FEATURE_IDS as readonly string[]).includes(part)) {
          throw new Error(`Unknown --feature ID: ${part}`);
        }
        featureSet.add(part as FeatureId);
      }
      continue;
    }
    if (arg === '--report-dir') {
      const val = argv[++i];
      if (!val) throw new Error('Missing value for --report-dir');
      reportDir = val;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      reportDir = arg.slice('--report-dir='.length);
      continue;
    }
    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  const tiers = tierSpecified ? ([...tierSet].sort() as Tier[]) : [...ALL_TIERS];
  const features = featureSpecified ? [...featureSet] : null;
  return { mode, tiers, features, reportDir, json, selfCheck };
}

interface LoadedCaseEntry {
  suiteFile: string;
  testCase: E2ECase;
}

async function loadSuites(repoRoot: string): Promise<LoadedCaseEntry[]> {
  const suitesDir = resolve(repoRoot, 'scripts', 'e2e', 'suites');
  if (!existsSync(suitesDir)) {
    return [];
  }
  const dirEntries = await readdir(suitesDir, { withFileTypes: true });
  const files = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const seenIds = new Set<string>();
  const loaded: LoadedCaseEntry[] = [];

  for (const fileName of files) {
    if (fileName.endsWith('.d.ts') || !fileName.endsWith('.ts')) continue;
    if (fileName.endsWith('.test.ts')) {
      throw new Error(
        `Forbidden *.test.ts naming inside scripts/e2e/suites/: ${fileName} (would be picked up by bun test)`,
      );
    }
    const fullPath = join(suitesDir, fileName);
    const mod = (await import(pathToFileURL(fullPath).href)) as Partial<SuiteModule>;
    if (!Array.isArray(mod.cases)) {
      throw new Error(`Suite ${fileName} must export "cases: E2ECase[]"`);
    }
    for (const c of mod.cases) {
      if (!c || typeof c.id !== 'string' || !c.id.trim()) {
        throw new Error(`Suite ${fileName} contains a case with missing id`);
      }
      if (seenIds.has(c.id)) {
        throw new Error(`Duplicate E2E case ID detected: ${c.id} (in ${fileName})`);
      }
      if (!Array.isArray(c.features) || c.features.length === 0) {
        throw new Error(`Case ${c.id} in ${fileName} must declare non-empty features[]`);
      }
      seenIds.add(c.id);
      loaded.push({ suiteFile: fileName, testCase: c });
    }
  }

  return loaded;
}

export function validateTargetCoverage(allCases: E2ECase[]): CoverageValidationResult {
  const byTier: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byFeatureTier1 = Object.fromEntries(ALL_FEATURE_IDS.map((f) => [f, 0])) as Record<
    FeatureId,
    number
  >;
  const byFeatureTier2 = Object.fromEntries(ALL_FEATURE_IDS.map((f) => [f, 0])) as Record<
    FeatureId,
    number
  >;
  const tier3Features = new Set<FeatureId>();

  for (const c of allCases) {
    byTier[c.tier] += 1;
    if (c.tier === 1) {
      for (const f of c.features) byFeatureTier1[f] += 1;
    } else if (c.tier === 2) {
      for (const f of c.features) byFeatureTier2[f] += 1;
    } else if (c.tier === 3) {
      for (const f of c.features) tier3Features.add(f);
    }
  }

  const errors: string[] = [];
  if (byTier[1] < 60) {
    errors.push(`Tier 1 total cases ${byTier[1]} < 60`);
  }
  if (byTier[2] < 60) {
    errors.push(`Tier 2 total cases ${byTier[2]} < 60`);
  }
  for (const fid of ALL_FEATURE_IDS) {
    if (byFeatureTier1[fid] < 5) {
      errors.push(`Tier 1 coverage for ${fid} is ${byFeatureTier1[fid]} < 5`);
    }
    if (byFeatureTier2[fid] < 5) {
      errors.push(`Tier 2 coverage for ${fid} is ${byFeatureTier2[fid]} < 5`);
    }
    if (!tier3Features.has(fid)) {
      errors.push(`Tier 3 pairwise coverage missing feature ${fid}`);
    }
  }
  if (byTier[3] < 12) {
    errors.push(`Tier 3 total cases ${byTier[3]} < 12`);
  }
  if (byTier[4] < 6) {
    errors.push(`Tier 4 total cases ${byTier[4]} < 6`);
  }
  if (allCases.length < 138) {
    errors.push(`Total E2E cases ${allCases.length} < 138 minimum threshold`);
  }

  return {
    ok: errors.length === 0,
    errors,
    byTier,
    byFeatureTier1,
    byFeatureTier2,
    tier3CoveredFeatures: [...tier3Features],
    totalCases: allCases.length,
  };
}

async function httpsViaConnectProxy(options: {
  proxyPort: number;
  targetHost: string;
  targetPort: number;
  path: string;
}): Promise<{ statusCode: number; headers: string; body: string }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let tlsSock: tls.TLSSocket | null = null;
    const socket = net.connect({ host: '127.0.0.1', port: options.proxyPort });
    let handshakeBuf = Buffer.alloc(0);

    const onSocketConnect = () => {
      socket.write(
        `CONNECT ${options.targetHost}:${options.targetPort} HTTP/1.1\r\nHost: ${options.targetHost}:${options.targetPort}\r\n\r\n`,
      );
    };
    const onConnectTimeout = () => {
      fail(new Error(`Proxy CONNECT timeout for ${options.targetHost}:${options.targetPort}`));
    };
    const onConnectPrematureEnd = () => {
      fail(new Error('Proxy socket closed before CONNECT response'));
    };
    const onConnectPrematureClose = () => {
      fail(new Error('Proxy socket closed before CONNECT response'));
    };
    const cleanupConnectListeners = () => {
      socket.off('connect', onSocketConnect);
      socket.off('data', onConnectData);
      socket.off('timeout', onConnectTimeout);
      socket.off('end', onConnectPrematureEnd);
      socket.off('close', onConnectPrematureClose);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupConnectListeners();
      socket.off('error', fail);
      socket.setTimeout(0);
      if (tlsSock && !tlsSock.destroyed) tlsSock.destroy();
      if (!socket.destroyed) socket.destroy();
      rejectPromise(err);
    };

    socket.setTimeout(8000);
    socket.once('timeout', onConnectTimeout);
    socket.once('error', fail);
    socket.once('end', onConnectPrematureEnd);
    socket.once('close', onConnectPrematureClose);
    socket.once('connect', onSocketConnect);

    function onConnectData(chunk: Buffer): void {
      handshakeBuf = Buffer.concat([handshakeBuf, chunk]);
      const headerEnd = handshakeBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      cleanupConnectListeners();
      socket.setTimeout(0);
      const headerText = handshakeBuf.subarray(0, headerEnd).toString('utf8');
      const statusLine = headerText.split('\r\n')[0] ?? '';
      const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/);
      const connectStatus = statusMatch ? Number(statusMatch[1]) : 0;

      if (connectStatus !== 200) {
        settled = true;
        socket.off('error', fail);
        if (!socket.destroyed) socket.destroy();
        resolvePromise({ statusCode: connectStatus, headers: headerText, body: '' });
        return;
      }

      const leftover = handshakeBuf.subarray(headerEnd + 4);
      if (leftover.length > 0) socket.unshift(leftover);

      tlsSock = tls.connect({
        socket,
        servername: options.targetHost,
        rejectUnauthorized: false,
      });
      const activeTlsSock = tlsSock;
      const onTlsTimeout = () => {
        fail(new Error(`TLS timeout on ${options.targetHost}${options.path}`));
      };
      const onTlsPrematureEnd = () => {
        fail(
          new Error(
            `TLS socket ended before handshake completed on ${options.targetHost}${options.path}`,
          ),
        );
      };
      const onTlsPrematureClose = () => {
        fail(
          new Error(
            `TLS socket closed before handshake completed on ${options.targetHost}${options.path}`,
          ),
        );
      };
      activeTlsSock.setTimeout(8000);
      activeTlsSock.once('error', fail);
      activeTlsSock.once('timeout', onTlsTimeout);
      activeTlsSock.once('end', onTlsPrematureEnd);
      activeTlsSock.once('close', onTlsPrematureClose);

      activeTlsSock.once('secureConnect', () => {
        activeTlsSock.off('end', onTlsPrematureEnd);
        activeTlsSock.off('close', onTlsPrematureClose);
        const req = http.request(
          {
            hostname: options.targetHost,
            port: options.targetPort,
            path: options.path,
            method: 'GET',
            headers: {
              Host: options.targetHost,
              Connection: 'close',
            },
            createConnection: () => activeTlsSock,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('error', fail);
            res.on('end', () => {
              if (settled) return;
              settled = true;
              activeTlsSock.off('error', fail);
              activeTlsSock.off('timeout', onTlsTimeout);
              activeTlsSock.setTimeout(0);
              socket.off('error', fail);
              if (!activeTlsSock.destroyed) activeTlsSock.destroy();
              if (!socket.destroyed) socket.destroy();
              resolvePromise({
                statusCode: res.statusCode ?? 0,
                headers: JSON.stringify(res.headers),
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          },
        );
        req.on('error', fail);
        req.end();
      });
    }

    socket.on('data', onConnectData);
  });
}

function buildSelfCheckCases(): LoadedCaseEntry[] {
  const cases: E2ECase[] = [
    {
      id: 'SELF-01',
      tier: 1,
      features: ['E2E-01'],
      title: 'Sandbox isolation, env scrubbing, symlink escape check & host sentinel audit',
      async run(ctx) {
        const sb = await ctx.createSandbox('self-sandbox');
        const requiredDirs = [
          sb.paths.root,
          sb.paths.homeDir,
          sb.paths.appDataDir,
          sb.paths.localAppDataDir,
          sb.paths.xdgConfigDir,
          sb.paths.xdgCacheDir,
          sb.paths.tempDir,
          sb.paths.profilesDir,
          join(sb.paths.appDataDir, 'ai.local.claude-local'),
        ];
        for (const d of requiredDirs) {
          assert.equal(existsSync(d), true, `Missing sandbox dir: ${d}`);
        }

        const origSkip = process.env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT;
        const origProxy = process.env.HTTPS_PROXY;
        try {
          process.env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT = '1';
          process.env.HTTPS_PROXY = 'http://127.0.0.1:7900';
          const env = sb.buildEnv();
          assert.equal(env.HOME, sb.paths.homeDir);
          assert.equal(env.USERPROFILE, sb.paths.homeDir);
          assert.equal(env.APPDATA, sb.paths.appDataDir);
          assert.equal(env.LOCALAPPDATA, sb.paths.localAppDataDir);
          assert.equal(env.TEMP, sb.paths.tempDir);
          assert.equal(env.HTTPS_PROXY, undefined, 'HTTPS_PROXY must be scrubbed');
          assert.equal(
            env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT,
            undefined,
            'CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT must be scrubbed',
          );
          assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
          assert.equal(env.GITHUB_ACTIONS, undefined);
        } finally {
          if (origSkip === undefined) delete process.env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT;
          else process.env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT = origSkip;
          if (origProxy === undefined) delete process.env.HTTPS_PROXY;
          else process.env.HTTPS_PROXY = origProxy;
        }

        const escapes = await sb.assertNoSymlinkEscape();
        assert.deepEqual(escapes, []);
        const audit = await sb.assertHostUntouched();
        assert.equal(audit.ok, true, `Host audit failed: ${audit.violations.join('; ')}`);

        return {
          status: 'pass',
          summary: 'Sandbox paths, env scrubbing, symlink check, and host sentinels verified',
          metrics: { checkedSentinels: audit.checkedSentinels, dirsCreated: requiredDirs.length },
        };
      },
    },
    {
      id: 'SELF-02',
      tier: 1,
      features: ['E2E-03', 'E2E-12'],
      title: 'MockHttpConnectProxy + MockNetworkSuite TLS CONNECT, fault injection & CSP extraction',
      async run(ctx) {
        const sb = await ctx.createSandbox('self-net');
        const netSuite = await MockNetworkSuite.start(sb.paths.root);
        sb.registerCleanup(() => netSuite.close());
        const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
        sb.registerCleanup(() => proxy.close());
        netSuite.bindToProxy(proxy, 'tls_terminate');

        const traceRes = await httpsViaConnectProxy({
          proxyPort: proxy.port,
          targetHost: 'www.cloudflare.com',
          targetPort: 443,
          path: '/cdn-cgi/trace',
        });
        assert.equal(traceRes.statusCode, 200);
        assert.match(traceRes.body, /loc=US/);

        const kycRes = await httpsViaConnectProxy({
          proxyPort: proxy.port,
          targetHost: 'claude.ai',
          targetPort: 443,
          path: '/api/organizations/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/kyc_status',
        });
        assert.equal(kycRes.statusCode, 200);
        const kycJson = JSON.parse(kycRes.body) as Record<string, unknown>;
        assert.equal(kycJson.status, 'approved');
        assert.ok(typeof kycJson.vendor_inquiry_id === 'string');

        const audit = proxy.getAuditLog();
        assert.equal(audit.length, 2);
        assert.equal(audit.every((e) => e.isLiteralIp === false), true);
        proxy.assertNoDomainDnsLeak();

        // Fault injection: 429, 502, drop_mid_stream
        proxy.setFault('claude.ai', { mode: 'rate_limit_429', retryAfterSec: 9 });
        const r429 = await httpsViaConnectProxy({
          proxyPort: proxy.port,
          targetHost: 'claude.ai',
          targetPort: 443,
          path: '/api/account',
        });
        assert.equal(r429.statusCode, 429);

        proxy.setFault('claude.ai', { mode: 'reject_502' });
        const r502 = await httpsViaConnectProxy({
          proxyPort: proxy.port,
          targetHost: 'claude.ai',
          targetPort: 443,
          path: '/api/account',
        });
        assert.equal(r502.statusCode, 502);

        proxy.setFault('claude.ai', { mode: 'drop_mid_stream', dropAfterBytes: 16 });
        let dropObserved = false;
        try {
          const rDrop = await httpsViaConnectProxy({
            proxyPort: proxy.port,
            targetHost: 'claude.ai',
            targetPort: 443,
            path: '/api/account',
          });
          dropObserved = rDrop.statusCode === 0 || !rDrop.body.includes('synthetic-e2e@example.invalid');
        } catch {
          dropObserved = true;
        }
        assert.equal(dropObserved, true, 'drop_mid_stream must sever response prematurely');

        const csp = extractProductionCsp(ctx.repoRoot);
        for (const expected of [
          'https://api.ipquery.io',
          'https://ipinfo.io',
          'https://api.ip.sb',
          'https://get.geojs.io',
          'https://ipwho.is',
        ]) {
          assert.equal(
            csp.allowedOrigins.includes(expected),
            true,
            `Production CSP missing ${expected}`,
          );
        }

        return {
          status: 'pass',
          summary: 'CONNECT tls_terminate, DNS leak log, 429/502/drop_mid_stream, and CSP extraction passed',
          metrics: { cspOriginCount: csp.allowedOrigins.length, auditEntries: proxy.getAuditLog().length },
        };
      },
    },
    {
      id: 'SELF-03',
      tier: 1,
      features: ['E2E-05', 'E2E-07'],
      title: 'ChromeHarness pinned engine, Vite + mockIPC command capture, route block & persistent PID tracking',
      async run(ctx) {
        const sb = await ctx.createSandbox('self-chrome');
        const exe = resolvePinnedChromeExecutable(ctx.repoRoot);
        assert.match(exe.replace(/\\/g, '/'), /browser-runtime\/WindowsBrowser\/chrome\.exe$/i);

        const html = buildMockIpcShellHtml({
          entryModule: null,
          setupScript: `
            window.__e2eHandleCommand = async (cmd, args) => {
              if (cmd === 'e2e_ping') return { pong: true, echo: args };
              return null;
            };
          `,
        });

        const vite = await startViteServer({
          repoRoot: ctx.repoRoot,
          sandbox: sb,
          virtualPages: { '/__e2e-self-check.html': html },
        });

        const pinned = await launchPinnedChrome({
          repoRoot: ctx.repoRoot,
          sandbox: sb,
          headless: true,
        });
        assert.ok(pinned.pid && pinned.pid > 0, 'launchPinnedChrome must track valid PID');

        const isolated = await pinned.newIsolatedContext({
          allowedUrlPrefixes: [`${vite.baseUrl}/`],
        });
        const { page, pageErrors, consoleErrors } = await openMockedAppPage({
          context: isolated.context,
          url: `${vite.baseUrl}/__e2e-self-check.html`,
        });

        const pingResult = await page.evaluate(async () => {
          const internals = (window as unknown as {
            __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
          }).__TAURI_INTERNALS__;
          const res = await internals.invoke('e2e_ping', { probe: 'self-check' });
          let blocked = false;
          try {
            await fetch('https://example.invalid/external-leak-test');
          } catch {
            blocked = true;
          }
          return { res, blocked };
        });

        assert.deepEqual(pingResult.res, { pong: true, echo: { probe: 'self-check' } });
        assert.equal(pingResult.blocked, true, 'External non-whitelisted request must be aborted');
        assert.equal(
          isolated.abortedUrls.some((u) => u.includes('example.invalid')),
          true,
          'abortedUrls must record blocked external request',
        );
        const cmds = await getIpcCommands(page);
        assert.equal(cmds.some((c) => c.command === 'e2e_ping'), true);
        assert.deepEqual(pageErrors, []);
        const unexpectedConsoleErrors = consoleErrors.filter(
          (msg) => !msg.includes('net::ERR_FAILED'),
        );
        assert.deepEqual(unexpectedConsoleErrors, []);
        await isolated.close();
        await pinned.close();

        const persistent = await launchPersistentProfile({
          repoRoot: ctx.repoRoot,
          sandbox: sb,
          profileName: 'self-persist',
          headless: true,
          argsOptions: { seed: 987654321 },
          allowedUrlPrefixes: [`${vite.baseUrl}/`],
        });
        assert.ok(persistent.pid && persistent.pid > 0, 'launchPersistentProfile must track real PID');
        assert.equal(sb.trackedPids.has(persistent.pid), true, 'Sandbox must track persistent PID');
        await persistent.close();

        return {
          status: 'pass',
          summary: 'Pinned Chrome, Vite + mockIPC, route block, and persistent profile PID tracking passed',
          metrics: { abortedCount: isolated.abortedUrls.length, trackedPids: sb.trackedPids.size },
        };
      },
    },
    {
      id: 'SELF-04',
      tier: 1,
      features: ['E2E-01', 'E2E-11'],
      title: 'RustBlackbox --quota-core merge_windows & synthetic .baga/SQLite v3 -> --orchestrate status',
      async run(ctx) {
        const sb = await ctx.createSandbox('self-rust');
        const bin = resolveClaudeLocalBinary(ctx.repoRoot);

        const nowSec = Math.floor(Date.now() / 1000);
        const qcRes = await runQuotaCore<{ schema: number; items: Array<{ used: number }> }>(
          bin.exePath,
          {
            schema: 1,
            op: 'merge_windows',
            now_sec: nowSec,
            items: [
              {
                current: {
                  used: 20,
                  reset_at: nowSec + 3600,
                  source: 'server_anchor',
                  observed_at_ms: (nowSec - 60) * 1000,
                },
                candidate: {
                  used: 35,
                  reset_at: nowSec + 3600,
                  source: 'server_anchor',
                  observed_at_ms: nowSec * 1000,
                },
              },
            ],
          },
        );
        assert.equal(qcRes.exitCode, 0, `--quota-core failed: ${qcRes.stderr}`);
        assert.equal(qcRes.json?.schema, 1);
        assert.equal(qcRes.json?.items?.[0]?.used, 35);

        const seeded = await seedSyntheticVault({
          appDataDir: sb.paths.appDataDir,
          homeDir: sb.paths.homeDir,
          activeAccountIndex: 0,
          accounts: [
            {
              name: 'Synthetic SelfCheck',
              accountUuid: '22222222-3333-4444-8555-666666666666',
              email: 'selfcheck@example.invalid',
              organizationUuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
              quota5hUsed: 12,
              quota7dUsed: 8,
              bindBrowser: true,
            },
          ],
        });

        const orchRes = await runOrchestrate<{
          schema: number;
          ok: boolean;
          accounts: Array<{ record_id: string; name: string }>;
        }>(bin.exePath, sb.paths, { schema: 1, op: 'status' });
        assert.equal(orchRes.exitCode, 0, `--orchestrate status failed: ${orchRes.stdout} ${orchRes.stderr}`);
        assert.equal(orchRes.json?.ok, true);
        assert.equal(
          orchRes.json?.accounts?.some((a) => a.record_id === seeded.records[0].id),
          true,
          'Orchestrator status must recognize synthetic BAGAID01 + SQLite v3 account',
        );

        return {
          status: 'pass',
          summary: `Rust ${bin.variant} binary verified via --quota-core and synthetic vault -> --orchestrate status`,
          metrics: { seededAccounts: seeded.records.length, orchestrateAccounts: orchRes.json?.accounts?.length ?? 0 },
        };
      },
    },
  ];

  return cases.map((testCase) => ({ suiteFile: '__self_check__', testCase }));
}

function renderMarkdownReport(report: E2ERunReport): string {
  const lines: string[] = [
    `# Claude-Local E2E Report (${report.runId})`,
    '',
    `- **Mode**: \`${report.mode}\``,
    `- **Self-Check**: \`${report.filters.selfCheck}\``,
    `- **Tiers**: \`${report.filters.tiers.join(',')}\``,
    `- **Features**: \`${report.filters.features ? report.filters.features.join(',') : 'all'}\``,
    `- **Duration**: ${report.durationMs} ms`,
    `- **Host Safety**: ${report.hostSafety.ok ? 'PASS' : `FAIL (${report.hostSafety.violations.join('; ')})`}`,
    '',
    '## Summary Counts',
    '',
    '| Total | Pass | Fail | Baseline Gap |',
    '|------:|-----:|-----:|-------------:|',
    `| ${report.counts.total} | ${report.counts.pass} | ${report.counts.fail} | ${report.counts.baseline_gap} |`,
    '',
  ];

  if (report.coverage) {
    lines.push('## Coverage Matrix', '');
    lines.push(
      `- **Gate Result**: ${report.coverage.ok ? 'PASS' : `FAIL (${report.coverage.errors.length} error(s))`}`,
    );
    if (report.coverage.errors.length > 0) {
      for (const err of report.coverage.errors) {
        lines.push(`  - ${err}`);
      }
    }
    lines.push(
      '',
      '| Feature | Tier 1 (>=5) | Tier 2 (>=5) | Tier 3 Covered |',
      '|---------|-------------:|-------------:|:--------------:|',
    );
    for (const fid of ALL_FEATURE_IDS) {
      const t1 = report.coverage.byFeatureTier1[fid];
      const t2 = report.coverage.byFeatureTier2[fid];
      const t3 = report.coverage.tier3CoveredFeatures.includes(fid) ? 'YES' : 'NO';
      lines.push(`| ${fid} | ${t1} | ${t2} | ${t3} |`);
    }
    lines.push('');
  }

  lines.push('## Case Results', '');
  lines.push('| ID | Tier | Features | Status | Duration (ms) | Summary |');
  lines.push('|----|-----:|----------|--------|--------------:|---------|');
  for (const r of report.results) {
    lines.push(
      `| ${r.id} | T${r.tier} | ${r.features.join(', ')} | ${r.status} | ${r.durationMs} | ${r.summary.replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push('');

  const flagged = report.results.filter((r) => r.status !== 'pass');
  if (flagged.length > 0) {
    lines.push('## Non-Passing Details', '');
    for (const r of flagged) {
      lines.push(`### ${r.id} (${r.status})`);
      lines.push(`- **Title**: ${r.title}`);
      lines.push(`- **Summary**: ${r.summary}`);
      if (r.error) lines.push(`- **Error**: \`${r.error}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(__dirname, '..', '..');

  let cli: ParsedCli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const startedDate = new Date();
  const runId = `${formatUtcCompact(startedDate)}-${cli.mode}${cli.selfCheck ? '-selfcheck' : ''}`;
  const reportDir = cli.reportDir
    ? resolve(repoRoot, cli.reportDir)
    : resolve(repoRoot, '.local', 'e2e', runId);

  const cleanupSignal = () => {
    void cleanupAllSandboxes().finally(() => process.exit(1));
  };
  process.once('SIGINT', cleanupSignal);
  process.once('SIGTERM', cleanupSignal);

  const globalBaseline = captureHostBaseline();
  const createdSandboxRoots: string[] = [];

  let entries: LoadedCaseEntry[] = [];
  let coverage: CoverageValidationResult | null = null;

  if (cli.selfCheck) {
    entries = buildSelfCheckCases();
  } else {
    const allLoaded = await loadSuites(repoRoot);
    coverage = validateTargetCoverage(allLoaded.map((e) => e.testCase));
    entries = allLoaded.filter(({ testCase }) => {
      if (!cli.tiers.includes(testCase.tier)) return false;
      if (cli.features && !testCase.features.some((f) => cli.features!.includes(f))) {
        return false;
      }
      return true;
    });
    entries.sort((a, b) => {
      if (a.testCase.tier !== b.testCase.tier) return a.testCase.tier - b.testCase.tier;
      return a.testCase.id.localeCompare(b.testCase.id);
    });
  }

  const results: CaseExecutionRecord[] = [];

  for (const { suiteFile, testCase } of entries) {
    const caseSandboxes: SandboxHandle[] = [];
    const ctx: E2EContext = {
      mode: cli.mode,
      repoRoot,
      reportDir,
      async createSandbox(label: string): Promise<SandboxHandle> {
        const sb = await createSandbox(label);
        caseSandboxes.push(sb);
        createdSandboxRoots.push(sb.paths.root);
        return sb;
      },
    };

    const startMs = Date.now();
    let status: 'pass' | 'fail' | 'baseline_gap' = 'fail';
    let summary = '';
    let metrics: Record<string, number | string | boolean> | undefined;
    let errorMsg: string | undefined;

    const preCleanupEscapesBySandbox = new Map<SandboxHandle, string[]>();
    try {
      const outcome = await testCase.run(ctx);
      status = outcome.status;
      summary = outcome.summary;
      metrics = outcome.metrics;
    } catch (err) {
      status = 'fail';
      errorMsg = err instanceof Error ? err.stack || err.message : String(err);
      summary = `Unhandled exception: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      for (const sb of caseSandboxes) {
        try {
          preCleanupEscapesBySandbox.set(sb, await sb.assertNoSymlinkEscape());
        } catch (scanErr) {
          const msg = scanErr instanceof Error ? scanErr.message : String(scanErr);
          errorMsg = errorMsg
            ? `${errorMsg}\nPre-cleanup symlink scan: ${msg}`
            : `Pre-cleanup symlink scan: ${msg}`;
        }
        try {
          await sb.cleanup();
        } catch (cleanupErr) {
          status = 'fail';
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          errorMsg = errorMsg ? `${errorMsg}\nCleanup: ${msg}` : `Cleanup: ${msg}`;
        }
      }
    }

    const aggregatedViolations: string[] = [];
    const aggregatedEscapedLinks = new Set<string>();
    const aggregatedLingeringPids = new Set<number>();
    let checkedSentinels = globalBaseline.length;
    let lastCheckedAt = new Date().toISOString();

    for (const sb of caseSandboxes) {
      const sbAudit = await sb.assertHostUntouched();
      checkedSentinels = sbAudit.checkedSentinels;
      lastCheckedAt = sbAudit.checkedAt;
      for (const link of preCleanupEscapesBySandbox.get(sb) ?? []) {
        aggregatedEscapedLinks.add(link);
      }
      for (const link of sbAudit.escapedLinks) {
        aggregatedEscapedLinks.add(link);
      }
      for (const pid of sbAudit.lingeringPids) {
        aggregatedLingeringPids.add(pid);
      }
      for (const v of sbAudit.violations) {
        if (!aggregatedViolations.includes(v)) {
          aggregatedViolations.push(v);
        }
      }
      if (existsSync(sb.paths.root)) {
        aggregatedViolations.push(`Sandbox root directory still exists after cleanup: ${sb.paths.root}`);
      }
    }
    if (
      aggregatedEscapedLinks.size > 0 &&
      !aggregatedViolations.some((v) => v.startsWith('Symlink/junction escape detected:'))
    ) {
      aggregatedViolations.push(
        `Symlink/junction escape detected: ${[...aggregatedEscapedLinks].join(', ')}`,
      );
    }

    const hostAudit: HostSafetyAuditResult = {
      ok:
        aggregatedViolations.length === 0 &&
        aggregatedEscapedLinks.size === 0 &&
        aggregatedLingeringPids.size === 0,
      checkedAt: lastCheckedAt,
      violations: aggregatedViolations,
      checkedSentinels,
      escapedLinks: [...aggregatedEscapedLinks],
      lingeringPids: [...aggregatedLingeringPids],
    };
    if (!hostAudit.ok) {
      status = 'fail';
      summary = `${summary} | Host safety audit failed: ${hostAudit.violations.join('; ')}`;
    }

    results.push({
      id: testCase.id,
      tier: testCase.tier,
      features: testCase.features,
      title: testCase.title,
      suiteFile,
      status,
      summary,
      ...(metrics ? { metrics } : {}),
      durationMs: Date.now() - startMs,
      ...(errorMsg ? { error: errorMsg } : {}),
      hostAudit,
    });
  }

  await cleanupAllSandboxes();

  const globalDiff = diffHostBaseline(globalBaseline);
  for (const rootDir of createdSandboxRoots) {
    if (existsSync(rootDir)) {
      globalDiff.violations.push(`Sandbox temp directory left behind after cleanup: ${rootDir}`);
    }
  }
  const hostSafety: HostSafetyAuditResult = {
    ok: globalDiff.violations.length === 0 && results.every((r) => r.hostAudit.ok),
    checkedAt: new Date().toISOString(),
    violations: [
      ...globalDiff.violations,
      ...results.flatMap((r) => (r.hostAudit.ok ? [] : r.hostAudit.violations)),
    ],
    checkedSentinels: globalDiff.checkedSentinels,
    escapedLinks: results.flatMap((r) => r.hostAudit.escapedLinks),
    lingeringPids: results.flatMap((r) => r.hostAudit.lingeringPids),
  };

  const finishedDate = new Date();
  const counts = {
    total: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    baseline_gap: results.filter((r) => r.status === 'baseline_gap').length,
  };

  const report: E2ERunReport = {
    schema: 1,
    runId,
    mode: cli.mode,
    startedAt: startedDate.toISOString(),
    finishedAt: finishedDate.toISOString(),
    durationMs: finishedDate.getTime() - startedDate.getTime(),
    filters: {
      tiers: cli.tiers,
      features: cli.features,
      selfCheck: cli.selfCheck,
    },
    counts,
    coverage,
    hostSafety,
    results,
  };

  await mkdir(reportDir, { recursive: true });
  const jsonPath = join(reportDir, 'report.json');
  const mdPath = join(reportDir, 'report.md');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, renderMarkdownReport(report), 'utf8');

  const isFullTargetRun =
    !cli.selfCheck &&
    cli.mode === 'target' &&
    cli.tiers.length === ALL_TIERS.length &&
    cli.features === null;

  let exitCode = 0;
  if (!hostSafety.ok || counts.fail > 0) {
    exitCode = 1;
  } else if (cli.selfCheck) {
    exitCode = counts.total > 0 && counts.pass === counts.total ? 0 : 1;
  } else if (cli.mode === 'target') {
    if (
      counts.total === 0 ||
      counts.baseline_gap > 0 ||
      (isFullTargetRun && coverage !== null && !coverage.ok)
    ) {
      exitCode = 1;
    }
  }

  if (cli.json) {
    console.log(
      JSON.stringify(
        {
          schema: report.schema,
          runId: report.runId,
          mode: report.mode,
          selfCheck: cli.selfCheck,
          exitCode,
          counts: report.counts,
          coverageOk: report.coverage?.ok ?? null,
          coverageErrors: report.coverage?.errors ?? [],
          hostSafety,
          reportJson: jsonPath,
          reportMd: mdPath,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `[E2E ${report.mode}${cli.selfCheck ? ' --self-check' : ''}] total=${counts.total} pass=${counts.pass} fail=${counts.fail} gap=${counts.baseline_gap} hostSafety=${hostSafety.ok} exit=${exitCode}`,
    );
    if (coverage && !coverage.ok && cli.mode === 'target') {
      console.error(`Target coverage gate failed:\n- ${coverage.errors.join('\n- ')}`);
    }
    console.log(`Reports: ${jsonPath} | ${mdPath}`);
  }

  process.exit(exitCode);
}

main().catch(async (err) => {
  await cleanupAllSandboxes();
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
