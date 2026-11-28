/**
 * [INPUT]: node:fs、node:os、node:path、node:child_process 与 ./types.ts 沙盒接口契约。
 * [OUTPUT]: 提供 createSandbox()、cleanupAllSandboxes()、captureHostBaseline()、auditHostBaseline()，实现 mkdtemp 全隔离目录、白名单环境重建、symlink/junction 逃逸防护、PID 级 taskkill.exe 进程树清理与只读元数据宿主自校验。
 * [POS]: E2E 基础设施隔离核心层；严禁读取或修改宿主机 ~/.claude 或 %APPDATA%/ai.local.claude-local 内容，严禁使用 taskkill /IM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
import type {
  HostSafetyAuditResult,
  SandboxEnvOptions,
  SandboxHandle,
  SandboxPaths,
  SandboxSpawnOptions,
  SandboxSpawnResult,
} from './types.ts';

interface SentinelMeta {
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
}

const HOST_ENV_SNAPSHOT = {
  userProfile: process.env.USERPROFILE || '',
  home: process.env.HOME || '',
  appData: process.env.APPDATA || '',
  localAppData: process.env.LOCALAPPDATA || '',
};

const WHITELIST_UPPER = new Set([
  'PATH',
  'SYSTEMROOT',
  'COMSPEC',
  'WINDIR',
  'PATHEXT',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'SYSTEMDRIVE',
  'LANG',
  'LC_ALL',
  'RUSTUP_HOME',
  'CARGO_HOME',
  'TERM',
  'COLORTERM',
]);

const FORBIDDEN_UPPER = new Set([
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT',
  'CLAUDE_LOCAL_ALLOW_DIRECT',
  'PSMODULEPATH',
  'GITHUB_ACTIONS',
]);

const ISOLATED_PATH_ENV_UPPER = new Set([
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'CLAUDE_CONFIG_DIR',
]);

const activeSandboxes = new Set<SandboxHandle>();

function normalizeForCompare(target: string): string {
  const n = normalize(resolve(target));
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = normalizeForCompare(candidatePath);
  const resolvedRoot = normalizeForCompare(rootPath);
  if (resolvedCandidate === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolvedCandidate.startsWith(prefix);
}

function collectSentinelPaths(): string[] {
  const candidates: string[] = [];
  const homeRoots = new Set<string>();
  for (const h of [HOST_ENV_SNAPSHOT.userProfile, HOST_ENV_SNAPSHOT.home]) {
    if (h && h.trim()) homeRoots.add(resolve(h.trim()));
  }
  for (const homeRoot of homeRoots) {
    candidates.push(
      join(homeRoot, '.claude', 'settings.json'),
      join(homeRoot, '.claude', 'settings.local.json'),
      join(homeRoot, '.claude.json'),
      join(homeRoot, '.claude', '.credentials.json'),
    );
  }
  if (HOST_ENV_SNAPSHOT.appData && HOST_ENV_SNAPSHOT.appData.trim()) {
    const appData = resolve(HOST_ENV_SNAPSHOT.appData.trim());
    candidates.push(
      join(appData, 'ai.local.claude-local', 'identities.sqlite'),
      join(appData, 'ai.local.claude-local', 'smart_relay_v1.json'),
      join(appData, 'ai.local.claude-local', 'warming_cards.json'),
    );
  }
  if (HOST_ENV_SNAPSHOT.localAppData && HOST_ENV_SNAPSHOT.localAppData.trim()) {
    const localAppData = resolve(HOST_ENV_SNAPSHOT.localAppData.trim());
    candidates.push(join(localAppData, 'Programs', 'Claude-Local'));
  }

  const dedup = new Map<string, string>();
  for (const item of candidates) {
    dedup.set(normalizeForCompare(item), item);
  }
  return [...dedup.values()];
}

function statSentinel(targetPath: string): SentinelMeta {
  try {
    const st = lstatSync(targetPath);
    return {
      path: targetPath,
      exists: true,
      size: st.isDirectory() ? 0 : st.size,
      mtimeMs: st.mtimeMs,
    };
  } catch {
    return {
      path: targetPath,
      exists: false,
      size: 0,
      mtimeMs: 0,
    };
  }
}

export type HostSentinelBaseline = SentinelMeta[];

export function captureHostBaseline(): HostSentinelBaseline {
  return collectSentinelPaths().map((p) => statSentinel(p));
}

export function diffHostBaseline(baseline: HostSentinelBaseline): {
  violations: string[];
  checkedSentinels: number;
} {
  const violations: string[] = [];
  for (const before of baseline) {
    const after = statSentinel(before.path);
    if (before.exists !== after.exists) {
      violations.push(
        `Host sentinel existence changed: ${before.path} (before=${before.exists}, after=${after.exists})`,
      );
    } else if (
      before.exists &&
      (before.size !== after.size || Math.abs(before.mtimeMs - after.mtimeMs) > 0.5)
    ) {
      violations.push(
        `Host sentinel modified: ${before.path} (size ${before.size}->${after.size}, mtime ${before.mtimeMs}->${after.mtimeMs})`,
      );
    }
  }
  return { violations, checkedSentinels: baseline.length };
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (!isPidAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // process already terminated
    }
  }
}

function isForbiddenEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (FORBIDDEN_UPPER.has(upper)) return true;
  if (upper.startsWith('APPLE_')) return true;
  if (upper.startsWith('TAURI_SIGNING_PRIVATE_KEY')) return true;
  return false;
}

function buildIsolatedEnv(paths: SandboxPaths, options?: SandboxEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    if (isForbiddenEnvKey(key)) continue;
    const upper = key.toUpperCase();
    if (WHITELIST_UPPER.has(upper)) {
      env[key] = value;
    }
  }

  env.HOME = paths.homeDir;
  env.USERPROFILE = paths.homeDir;
  env.APPDATA = paths.appDataDir;
  env.LOCALAPPDATA = paths.localAppDataDir;
  env.XDG_CONFIG_HOME = paths.xdgConfigDir;
  env.XDG_CACHE_HOME = paths.xdgCacheDir;
  env.XDG_DATA_HOME = paths.xdgConfigDir;
  env.TEMP = paths.tempDir;
  env.TMP = paths.tempDir;
  env.TMPDIR = paths.tempDir;

  if (options?.proxyUrl) {
    env.HTTP_PROXY = options.proxyUrl;
    env.HTTPS_PROXY = options.proxyUrl;
  }

  if (options?.claudeConfigDir) {
    if (!isWithinRoot(options.claudeConfigDir, paths.root)) {
      throw new Error(
        `Sandbox isolation violation: claudeConfigDir (${options.claudeConfigDir}) escapes sandbox root (${paths.root})`,
      );
    }
    env.CLAUDE_CONFIG_DIR = resolve(options.claudeConfigDir);
  }

  if (options?.skipProxyPreflight) {
    env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT = '1';
  }
  if (options?.allowDirect) {
    env.CLAUDE_LOCAL_ALLOW_DIRECT = '1';
  }

  if (options?.extraEnv) {
    for (const [k, v] of Object.entries(options.extraEnv)) {
      const upper = k.toUpperCase();
      if (upper.startsWith('TAURI_SIGNING_PRIVATE_KEY') || upper.startsWith('APPLE_')) {
        throw new Error(
          `Sandbox isolation violation: extraEnv[${k}] is a forbidden signing/Apple credential key`,
        );
      }
      if (ISOLATED_PATH_ENV_UPPER.has(upper) && !isWithinRoot(v, paths.root)) {
        throw new Error(
          `Sandbox isolation violation: extraEnv[${k}] (${v}) points outside sandbox root (${paths.root})`,
        );
      }
      env[k] = v;
    }
  }

  return env;
}

async function scanSymlinkEscapes(dirPath: string, sandboxRealRoot: string): Promise<string[]> {
  const escaped: string[] = [];
  if (!existsSync(dirPath)) return escaped;

  let rootReal = sandboxRealRoot;
  try {
    rootReal = await realpath(sandboxRealRoot);
  } catch {
    return escaped;
  }

  const walk = async (current: string): Promise<void> => {
    let st;
    try {
      st = await lstat(current);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) {
      try {
        const targetReal = await realpath(current);
        if (!isWithinRoot(targetReal, rootReal)) {
          escaped.push(`${current} -> ${targetReal}`);
        }
      } catch {
        escaped.push(`${current} -> <dangling-link>`);
      }
      return;
    }
    if (!st.isDirectory()) return;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      await walk(join(current, entry.name));
    }
  };

  await walk(dirPath);
  return escaped;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function removeDirBoundedRetry(targetDir: string): Promise<void> {
  if (!existsSync(targetDir)) return;
  const backoffs = [50, 100, 200, 400, 800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      await rm(targetDir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < backoffs.length) {
        await sleep(backoffs[attempt]);
      }
    }
  }
  throw lastErr;
}

export async function createSandbox(label: string): Promise<SandboxHandle> {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'e2e';
  const root = await mkdtemp(join(tmpdir(), `cl-e2e-${safeLabel}-`));
  const realRoot = realpathSync(root);

  const paths: SandboxPaths = {
    root: realRoot,
    homeDir: join(realRoot, 'home'),
    appDataDir: join(realRoot, 'appdata'),
    localAppDataDir: join(realRoot, 'localappdata'),
    xdgConfigDir: join(realRoot, 'xdg-config'),
    xdgCacheDir: join(realRoot, 'xdg-cache'),
    tempDir: join(realRoot, 'temp'),
    profilesDir: join(realRoot, 'profiles'),
  };

  mkdirSync(paths.homeDir, { recursive: true });
  mkdirSync(paths.appDataDir, { recursive: true });
  mkdirSync(join(paths.appDataDir, 'ai.local.claude-local'), { recursive: true });
  mkdirSync(paths.localAppDataDir, { recursive: true });
  mkdirSync(paths.xdgConfigDir, { recursive: true });
  mkdirSync(paths.xdgCacheDir, { recursive: true });
  mkdirSync(paths.tempDir, { recursive: true });
  mkdirSync(paths.profilesDir, { recursive: true });

  const baseline = captureHostBaseline();
  const trackedPids = new Set<number>();
  const cleanups: Array<() => Promise<void> | void> = [];
  let cleaned = false;
  let cleanupPromise: Promise<void> | null = null;
  let cachedEscapedLinks: string[] | null = null;

  const handle: SandboxHandle = {
    label: safeLabel,
    paths,
    trackedPids,

    buildEnv(options?: SandboxEnvOptions): Record<string, string> {
      return buildIsolatedEnv(paths, options);
    },

    profileDir(name: string): string {
      const trimmed = name.trim();
      if (!trimmed || /[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
        throw new Error(`Invalid sandbox profile name: ${name}`);
      }
      const target = resolve(paths.profilesDir, trimmed);
      if (!isWithinRoot(target, paths.profilesDir)) {
        throw new Error(`Profile directory escaped sandbox: ${target}`);
      }
      mkdirSync(target, { recursive: true });
      return target;
    },

    trackPid(pid: number | undefined | null): void {
      if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        trackedPids.add(pid);
      }
    },

    registerCleanup(fn: () => Promise<void> | void): void {
      cleanups.push(fn);
    },

    async spawn(
      command: string,
      args: string[],
      options?: SandboxSpawnOptions,
    ): Promise<SandboxSpawnResult> {
      const startMs = Date.now();
      const timeoutMs = options?.timeoutMs ?? 30_000;
      const env = options?.env ?? handle.buildEnv();

      return await new Promise<SandboxSpawnResult>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
          cwd: options?.cwd,
          env,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const pid = child.pid ?? 0;
        handle.trackPid(pid);

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        const timer = setTimeout(() => {
          timedOut = true;
          if (pid > 0) {
            killProcessTree(pid);
          } else {
            child.kill('SIGKILL');
          }
        }, timeoutMs);

        child.on('error', (err) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          rejectPromise(err);
        });

        child.on('close', (code, signal) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          const durationMs = Date.now() - startMs;
          if (!options?.allowNonZero && code !== 0 && !timedOut) {
            rejectPromise(
              new Error(
                `Command failed (${code ?? signal}): ${command} ${args.join(' ')}\nstderr: ${stderr.slice(0, 500)}`,
              ),
            );
            return;
          }
          resolvePromise({
            pid,
            exitCode: code,
            signal,
            stdout,
            stderr,
            durationMs,
            timedOut,
          });
        });

        if (options?.stdin !== undefined) {
          child.stdin?.end(options.stdin);
        } else {
          child.stdin?.end();
        }
      });
    },

    async assertNoSymlinkEscape(dir?: string): Promise<string[]> {
      const target = dir ? resolve(dir) : paths.root;
      if (dir && !isWithinRoot(target, paths.root)) {
        return [`Requested inspection dir ${target} is outside sandbox root ${paths.root}`];
      }
      if (cachedEscapedLinks !== null) {
        if (!dir) return [...cachedEscapedLinks];
        return cachedEscapedLinks.filter((entry) => {
          const linkPath = entry.split(' -> ')[0];
          return linkPath ? isWithinRoot(linkPath, target) : false;
        });
      }
      return await scanSymlinkEscapes(target, paths.root);
    },

    async assertHostUntouched(): Promise<HostSafetyAuditResult> {
      const escapedLinks = await handle.assertNoSymlinkEscape();
      const { violations, checkedSentinels } = diffHostBaseline(baseline);
      const lingeringPids: number[] = [];
      for (const pid of trackedPids) {
        if (isPidAlive(pid)) {
          lingeringPids.push(pid);
        }
      }
      if (escapedLinks.length > 0) {
        violations.push(`Symlink/junction escape detected: ${escapedLinks.join(', ')}`);
      }
      if (lingeringPids.length > 0) {
        violations.push(`Lingering tracked PIDs still alive: ${lingeringPids.join(', ')}`);
      }
      return {
        ok: violations.length === 0,
        checkedAt: new Date().toISOString(),
        violations,
        checkedSentinels,
        escapedLinks,
        lingeringPids,
      };
    },

    async cleanup(): Promise<void> {
      if (cleaned) return;
      if (cleanupPromise) return await cleanupPromise;

      cleanupPromise = (async () => {
        const errors: string[] = [];
        for (let i = cleanups.length - 1; i >= 0; i--) {
          try {
            await cleanups[i]();
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        for (const pid of trackedPids) {
          try {
            killProcessTree(pid);
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        if (cachedEscapedLinks === null) {
          try {
            cachedEscapedLinks = await scanSymlinkEscapes(paths.root, paths.root);
          } catch {
            cachedEscapedLinks = [];
          }
        }
        try {
          await removeDirBoundedRetry(paths.root);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        } finally {
          cleaned = true;
          activeSandboxes.delete(handle);
        }
        if (errors.length > 0) {
          throw new Error(`Sandbox cleanup errors (${safeLabel}): ${errors.join(' | ')}`);
        }
      })();

      return await cleanupPromise;
    },
  };

  activeSandboxes.add(handle);
  return handle;
}

export async function cleanupAllSandboxes(): Promise<void> {
  const list = [...activeSandboxes];
  for (const sb of list) {
    try {
      await sb.cleanup();
    } catch {
      // best-effort global cleanup
    }
  }
}
