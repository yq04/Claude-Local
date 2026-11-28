/**
 * [INPUT]: node:net、playwright-core、vite、@tauri-apps/api/mocks、browser-runtime/WindowsBrowser/chrome.exe 与 ./sandbox.ts、./mock-network.ts。
 * [OUTPUT]: 导出 resolvePinnedChromeExecutable()、readProductionConnectSrc()、startViteServer()、buildChromeAntiLeakArgs()、launchPinnedChrome()、launchPersistentProfile()、buildMockIpcShellHtml()、openMockedAppPage() 与 IPC/事件辅助函数。
 * [POS]: E2E 浏览器与前端渲染驱动层；强制绑定仓库内置 Chromium（禁止系统 Edge/Chrome 回退），Vite 真实绑定 127.0.0.1:0 OS 临时端口并收敛 keep-alive，Chrome 默认注入防系统代理/后台网络卫生参数、阻断非白名单外网请求并按页/路由清理上下文与 PID。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { Socket } from 'node:net';
import { resolve } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
  type Route,
} from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { extractProductionCsp } from './mock-network.ts';
import type { SandboxHandle } from './types.ts';

export interface ViteHarnessHandle {
  baseUrl: string;
  port: number;
  server: ViteDevServer;
  close(): Promise<void>;
}

export interface ChromeArgsOptions {
  seed?: number;
  language?: string;
  acceptLanguage?: string;
  timezone?: string;
  proxyUrl?: string;
  noProxyServer?: boolean;
  extensionDir?: string;
  disableSpoofing?: string;
  antiLeakBase?: boolean;
  disableIpv6Probe?: boolean;
  extraArgs?: string[];
}

export interface IsolatedContextOptions {
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  ignoreHTTPSErrors?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  allowedUrlPrefixes?: string[];
  routeHandler?: (route: Route, abortedUrls: string[]) => Promise<void> | void;
}

export interface IsolatedContextHandle {
  context: BrowserContext;
  abortedUrls: string[];
  close(): Promise<void>;
}

export interface PinnedBrowserHandle {
  browser: Browser;
  pid: number | null;
  executablePath: string;
  newIsolatedContext(options?: IsolatedContextOptions): Promise<IsolatedContextHandle>;
  close(): Promise<void>;
}

export interface PersistentChromeHandle {
  context: BrowserContext;
  pid: number | null;
  executablePath: string;
  userDataDir: string;
  abortedUrls: string[];
  close(): Promise<void>;
}

export interface MockIpcCommandRecord {
  command: string;
  args: unknown;
}

export function resolvePinnedChromeExecutable(repoRoot: string): string {
  const rel =
    process.platform === 'darwin'
      ? 'browser-runtime/Browser.app/Contents/MacOS/Chromium'
      : process.platform === 'win32'
        ? 'browser-runtime/WindowsBrowser/chrome.exe'
        : 'browser-runtime/LinuxBrowser/chrome';
  const fullPath = resolve(repoRoot, rel);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    throw new Error(
      `Pinned browser binary not found at ${fullPath} (system Chrome/Edge fallback is strictly forbidden)`,
    );
  }
  return fullPath;
}

export function readProductionConnectSrc(repoRoot: string): string {
  return extractProductionCsp(repoRoot).connectSrc;
}

export async function startViteServer(options: {
  repoRoot: string;
  sandbox?: SandboxHandle;
  virtualPages?: Record<string, string>;
  optimizeEntries?: string[];
}): Promise<ViteHarnessHandle> {
  const virtualPages = options.virtualPages ?? {};
  const virtualPlugin = {
    name: 'e2e-virtual-entries',
    configureServer(instance: ViteDevServer) {
      instance.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '/';
        const pathname = rawUrl.split('?')[0];
        const html = virtualPages[pathname];
        if (html === undefined) {
          next();
          return;
        }
        try {
          const transformed = await instance.transformIndexHtml(pathname, html);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(transformed);
        } catch (err) {
          next(err);
        }
      });
    },
  };

  const server = await createServer({
    root: options.repoRoot,
    configFile: resolve(options.repoRoot, 'vite.config.ts'),
    logLevel: 'silent',
    plugins: [virtualPlugin],
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
      watch: {
        ignored: [
          '**/src-tauri/**',
          '**/browser-runtime/**',
          '**/releases/**',
          '**/.local/**',
          '**/dist/**',
        ],
      },
    },
    optimizeDeps: {
      entries: options.optimizeEntries ?? ['index.html', 'browser.html', 'tests/identities.html'],
      include: ['@tauri-apps/api/mocks'],
    },
  });

  const httpServer = server.httpServer;
  if (!httpServer) {
    await server.close().catch(() => {});
    throw new Error('Vite harness server created without httpServer');
  }

  // Bound HTTP keep-alive & per-socket reuse so rapid BrowserContext churn does not pile up idle sockets
  if ('keepAliveTimeout' in httpServer) {
    httpServer.keepAliveTimeout = 1_000;
    httpServer.headersTimeout = 10_000;
    httpServer.maxRequestsPerSocket = 100;
  }

  const activeSockets = new Set<Socket>();
  httpServer.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.once('close', () => {
      activeSockets.delete(socket);
    });
  });

  // Vite's startServer() treats port=0 as falsy (!configPort) and falls back to 5173.
  // Intercept the initial httpServer.listen call once so the OS assigns an ephemeral 127.0.0.1:0 port with zero TOCTOU race.
  const viteListen = httpServer.listen.bind(httpServer);
  httpServer.listen = ((...listenArgs: unknown[]) => {
    httpServer.listen = viteListen as typeof httpServer.listen;
    if (listenArgs.length > 0 && typeof listenArgs[0] === 'number') {
      listenArgs[0] = 0;
    } else if (listenArgs.length > 0 && typeof listenArgs[0] === 'object' && listenArgs[0] !== null) {
      listenArgs[0] = { ...(listenArgs[0] as Record<string, unknown>), port: 0 };
    }
    return (viteListen as (...a: unknown[]) => unknown)(...listenArgs);
  }) as typeof httpServer.listen;

  try {
    await server.listen();
  } catch (err) {
    for (const sock of activeSockets) {
      sock.destroy();
    }
    activeSockets.clear();
    await server.close().catch(() => {});
    throw err;
  }

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string' || addr.port <= 0) {
    for (const sock of activeSockets) {
      sock.destroy();
    }
    activeSockets.clear();
    await server.close().catch(() => {});
    throw new Error('Vite harness server failed to bind 127.0.0.1:0');
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const sock of activeSockets) {
      sock.destroy();
    }
    activeSockets.clear();
    await server.close().catch(() => {});
  };

  if (options.sandbox) {
    options.sandbox.registerCleanup(close);
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    server,
    close,
  };
}

export function buildChromeAntiLeakArgs(options: ChromeArgsOptions = {}): string[] {
  const args: string[] = [];

  if (options.seed !== undefined) {
    args.push(`--fingerprint=${options.seed}`);
  }
  if (options.language) {
    args.push(`--lang=${options.language}`);
  }
  if (options.acceptLanguage) {
    args.push(`--accept-lang=${options.acceptLanguage}`);
  }
  if (options.timezone) {
    args.push(`--timezone=${options.timezone}`);
  }

  if (options.antiLeakBase !== false) {
    args.push(
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-non-proxied-udp',
      '--enforce-webrtc-ip-permission-check',
      '--disable-quic',
      '--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability',
      '--disable-component-update',
      '--no-pings',
      '--disable-sync',
      '--disable-default-apps',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-mock-keychain',
      '--password-store=basic',
    );
  }

  if (options.disableIpv6Probe !== false) {
    args.push('--set-ipv6-probe-false');
  }

  if (options.disableSpoofing) {
    args.push(`--disable-spoofing=${options.disableSpoofing}`);
  }

  if (options.proxyUrl && options.proxyUrl.trim()) {
    const rawProxy = options.proxyUrl.trim();
    const browserProxy = rawProxy.replace(/^socks5h:\/\//i, 'socks5://');
    const parsed = new URL(rawProxy);
    const proxyHost = parsed.hostname.replace(/^\[|\]$/g, '');
    const excludes = new Set<string>([proxyHost, '127.0.0.1', 'localhost', '::1']);
    const excludeRules = [...excludes].map((h) => `EXCLUDE ${h}`).join(', ');
    args.push(
      `--proxy-server=${browserProxy}`,
      '--proxy-bypass-list=127.0.0.1;localhost;[::1]',
      `--host-resolver-rules=MAP * ~NOTFOUND, ${excludeRules}`,
      '--test-type',
    );
  } else if (options.noProxyServer !== false) {
    args.push('--no-proxy-server', '--disable-background-networking');
  }

  if (options.extensionDir) {
    const extPath = resolve(options.extensionDir);
    const manifestPath = resolve(extPath, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Extension manifest.json not found at ${manifestPath}`);
    }
    args.push(`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`);
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }

  return args;
}

function isUrlAllowed(url: string, allowedPrefixes: string[]): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') {
    return true;
  }
  return allowedPrefixes.some((prefix) => url.startsWith(prefix));
}

function findChromePidByUserDataDir(userDataDir: string): number | null {
  if (process.platform === 'win32') {
    const escaped = userDataDir.replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') -and -not $_.CommandLine.Contains('--type=') } | Select-Object -First 1 -ExpandProperty ProcessId`;
    const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const parsed = Number((res.stdout ?? '').trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  const res = spawnSync('pgrep', ['-f', userDataDir], {
    encoding: 'utf8',
    timeout: 3000,
  });
  const firstLine = (res.stdout ?? '').split(/\r?\n/).find((l) => /^\d+$/.test(l.trim()));
  return firstLine ? Number(firstLine.trim()) : null;
}

export async function launchPinnedChrome(options: {
  repoRoot: string;
  sandbox: SandboxHandle;
  headless?: boolean;
  args?: string[];
  envOverrides?: Record<string, string>;
}): Promise<PinnedBrowserHandle> {
  const executablePath = resolvePinnedChromeExecutable(options.repoRoot);
  const env = options.sandbox.buildEnv(
    options.envOverrides ? { extraEnv: options.envOverrides } : undefined,
  );

  const callerArgs = options.args ?? [];
  const hasProxyFlag = callerArgs.some(
    (a) => a.startsWith('--proxy-server') || a === '--no-proxy-server',
  );
  const baseHygieneArgs = [
    '--disable-background-networking',
    '--disable-component-update',
    '--no-pings',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    ...(hasProxyFlag ? [] : ['--no-proxy-server']),
  ];
  const mergedArgs = [...new Set([...baseHygieneArgs, ...callerArgs])];

  const browserServer: BrowserServer = await chromium.launchServer({
    host: '127.0.0.1',
    executablePath,
    headless: options.headless ?? true,
    env,
    args: mergedArgs,
  });

  const pid = browserServer.process()?.pid ?? null;
  options.sandbox.trackPid(pid);

  let browser: Browser | null = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser?.close().catch(() => {});
    await browserServer.close().catch(() => {});
  };
  options.sandbox.registerCleanup(close);

  try {
    browser = await chromium.connect(browserServer.wsEndpoint());
  } catch (err) {
    await close();
    throw err;
  }

  return {
    browser,
    pid,
    executablePath,
    async newIsolatedContext(ctxOpts: IsolatedContextOptions = {}): Promise<IsolatedContextHandle> {
      const context = await browser!.newContext({
        viewport: ctxOpts.viewport ?? { width: 1280, height: 800 },
        locale: ctxOpts.locale,
        timezoneId: ctxOpts.timezoneId,
        ignoreHTTPSErrors: ctxOpts.ignoreHTTPSErrors ?? true,
        reducedMotion: ctxOpts.reducedMotion ?? 'reduce',
      });
      const abortedUrls: string[] = [];
      const prefixes = ctxOpts.allowedUrlPrefixes ?? [];
      try {
        await context.route('**/*', async (route) => {
          if (ctxOpts.routeHandler) {
            await ctxOpts.routeHandler(route, abortedUrls);
            return;
          }
          const url = route.request().url();
          if (isUrlAllowed(url, prefixes)) {
            await route.continue();
          } else {
            abortedUrls.push(url);
            await route.abort();
          }
        });
      } catch (err) {
        await context.close().catch(() => {});
        throw err;
      }

      return {
        context,
        abortedUrls,
        async close() {
          await Promise.allSettled(context.pages().map((p) => p.close().catch(() => {})));
          await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          await context.close().catch(() => {});
        },
      };
    },
    close,
  };
}

export async function launchPersistentProfile(options: {
  repoRoot: string;
  sandbox: SandboxHandle;
  profileName: string;
  headless?: boolean;
  ignoreHTTPSErrors?: boolean;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  argsOptions?: ChromeArgsOptions;
  allowedUrlPrefixes?: string[];
  routeHandler?: (route: Route, abortedUrls: string[]) => Promise<void> | void;
}): Promise<PersistentChromeHandle> {
  const executablePath = resolvePinnedChromeExecutable(options.repoRoot);
  const userDataDir = options.sandbox.profileDir(options.profileName);
  const args = buildChromeAntiLeakArgs(options.argsOptions ?? {});
  const env = options.sandbox.buildEnv();

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: options.headless ?? true,
    env,
    ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? true,
    viewport: options.viewport ?? { width: 1280, height: 800 },
    locale: options.locale,
    timezoneId: options.timezoneId,
    args,
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await context.close().catch(() => {});
  };
  options.sandbox.registerCleanup(close);

  const pid = findChromePidByUserDataDir(userDataDir);
  options.sandbox.trackPid(pid);

  const abortedUrls: string[] = [];
  const prefixes = [...(options.allowedUrlPrefixes ?? [])];
  if (options.argsOptions?.extensionDir) {
    prefixes.push('chrome-extension://');
  }

  await context.route('**/*', async (route) => {
    if (options.routeHandler) {
      await options.routeHandler(route, abortedUrls);
      return;
    }
    const url = route.request().url();
    if (isUrlAllowed(url, prefixes)) {
      await route.continue();
    } else {
      abortedUrls.push(url);
      await route.abort();
    }
  });

  return {
    context,
    pid,
    executablePath,
    userDataDir,
    abortedUrls,
    close,
  };
}

export function buildMockIpcShellHtml(options: {
  entryModule?: string | null;
  title?: string;
  windowLabel?: 'main' | 'monitor';
  setupScript?: string;
}): string {
  const title = options.title ?? 'Claude-Local E2E Shell';
  const currentWin = options.windowLabel ?? 'main';
  const secondaryWin = currentWin === 'main' ? 'monitor' : 'main';
  const entryModule = options.entryModule === undefined ? '/src/main.tsx' : options.entryModule;
  const setupScript = options.setupScript ?? '';

  return `<!doctype html>
<html lang="zh-CN" data-mode="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body>
  <main id="app"></main>
  <script type="module">
    import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';

    mockWindows(${JSON.stringify(currentWin)}, ${JSON.stringify(secondaryWin)});
    const listeners = new Map();
    let nextListenerId = 1;
    const commands = [];

    const ipcController = {
      commands,
      listeners,
      emit(event, payload) {
        for (const [id, entry] of listeners.entries()) {
          if (entry.event === event) {
            window.__TAURI_INTERNALS__?.runCallback?.(entry.handler, { event, id, payload });
          }
        }
      },
      emitChannel(callbackRef, index, message) {
        const cbId = typeof callbackRef === 'string'
          ? Number(callbackRef.replace('__CHANNEL__:', ''))
          : callbackRef?.id;
        if (typeof cbId === 'number' && !Number.isNaN(cbId)) {
          window.__TAURI_INTERNALS__?.runCallback?.(cbId, { index, message });
        }
      },
      clear() {
        commands.length = 0;
        listeners.clear();
        clearMocks();
      },
    };
    window.__e2eIpc = ipcController;

    ${setupScript}

    mockIPC(async (command, args) => {
      commands.push({ command, args });
      if (command === 'plugin:event|listen') {
        const id = nextListenerId++;
        listeners.set(id, { event: args?.event, handler: args?.handler });
        return id;
      }
      if (command === 'plugin:event|unlisten') {
        listeners.delete(args?.eventId);
        return null;
      }
      if (command.startsWith('plugin:window|')) {
        if (command.endsWith('|is_maximized')) return false;
        if (command.endsWith('|is_minimized')) return false;
        if (command.endsWith('|is_fullscreen')) return false;
        if (command.endsWith('|scale_factor')) return 1;
        if (command.endsWith('|inner_size') || command.endsWith('|outer_size')) {
          return { width: 1040, height: 820 };
        }
        return null;
      }
      if (typeof window.__e2eHandleCommand === 'function') {
        return await window.__e2eHandleCommand(command, args);
      }
      return null;
    }, { shouldMockEvents: false });

    ${entryModule ? `await import(${JSON.stringify(entryModule)});` : ''}
  </script>
</body>
</html>`;
}

export async function openMockedAppPage(options: {
  context: BrowserContext;
  url: string;
  timeoutMs?: number;
}): Promise<{ page: Page; errors: string[]; pageErrors: string[]; consoleErrors: string[] }> {
  const page = await options.context.newPage();
  page.setDefaultTimeout(options.timeoutMs ?? 10_000);
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      errors.push(txt);
      consoleErrors.push(txt);
    }
  });
  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
  return { page, errors, pageErrors, consoleErrors };
}

export async function getIpcCommands(page: Page): Promise<MockIpcCommandRecord[]> {
  return await page.evaluate(() => {
    const list = (window as unknown as { __e2eIpc?: { commands?: MockIpcCommandRecord[] } })
      .__e2eIpc?.commands;
    return Array.isArray(list) ? structuredClone(list) : [];
  });
}

export async function emitTauriEvent(
  page: Page,
  event: string,
  payload: unknown,
): Promise<void> {
  await page.evaluate(
    ({ evt, data }) => {
      (window as unknown as { __e2eIpc?: { emit: (e: string, p: unknown) => void } }).__e2eIpc?.emit(
        evt,
        data,
      );
    },
    { evt: event, data: payload },
  );
}

export async function clearIpcLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ipc = (window as unknown as { __e2eIpc?: { commands?: unknown[] } }).__e2eIpc;
    if (ipc?.commands) ipc.commands.length = 0;
  });
}
