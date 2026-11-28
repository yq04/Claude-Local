/**
 * [INPUT]: node:crypto、node:zlib、node:fs、懒加载 bun:sqlite、src-tauri/target/{release,debug}/claude-local.exe。
 * [OUTPUT]: 导出 resolveClaudeLocalBinary()、runOrchestrate()、runQuotaCore()、sealBagaArchive()、seedSyntheticVault()、computeAccountKeyHmac()、computeQuotaIdentitySha256()、deriveDeterministicBrowserSeed() 与只读 runBunTest()/runOfflinePythonTest()。
 * [POS]: Rust 无头黑盒协议（--orchestrate / --quota-core）与合成持久 format（BAGAID01/SQLite v3/HMAC/CCBaga）测试驱动层；严禁空参数启动 GUI，严禁调用 test-windows.py。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface BinaryResolution {
  exePath: string;
  variant: 'release' | 'debug';
}

export interface HeadlessResult<T = unknown> {
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: T;
}

export interface SyntheticAccountSpec {
  id?: string;
  name: string;
  accountUuid: string;
  email: string;
  organizationUuid?: string;
  organizationName?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAtMs?: number;
  quota5hUsed?: number;
  quota5hResetAt?: number;
  quota7dUsed?: number;
  quota7dResetAt?: number;
  proxy?: string;
  plan?: string;
  bindBrowser?: boolean;
}

export interface SeededAccountRecord {
  id: string;
  name: string;
  archive: string;
  accountKey: string;
  quotaIdentity: string;
  seed?: number;
}

export function resolveClaudeLocalBinary(repoRoot: string): BinaryResolution {
  const exeName = process.platform === 'win32' ? 'claude-local.exe' : 'claude-local';
  const releasePath = resolve(repoRoot, 'src-tauri', 'target', 'release', exeName);
  if (existsSync(releasePath) && statSync(releasePath).isFile()) {
    return { exePath: releasePath, variant: 'release' };
  }
  const debugPath = resolve(repoRoot, 'src-tauri', 'target', 'debug', exeName);
  if (existsSync(debugPath) && statSync(debugPath).isFile()) {
    return { exePath: debugPath, variant: 'debug' };
  }
  throw new Error(
    `claude-local binary not found at ${releasePath} or ${debugPath}; build it before running Rust black-box tests`,
  );
}

function assertHeadlessArgsAllowed(args: string[]): void {
  if (args.length === 0) {
    throw new Error('Refusing empty-argument GUI launch of claude-local.exe in E2E harness');
  }
  if (args[0] !== '--orchestrate' && args[0] !== '--quota-core') {
    throw new Error(`Unsupported claude-local headless entrypoint in E2E harness: ${args.join(' ')}`);
  }
}

function buildMinimalSafeRustEnv(sandbox?: {
  appDataDir: string;
  homeDir: string;
  tempDir: string;
  extraEnv?: Record<string, string>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const keepKeys = new Set([
    'PATH',
    'SYSTEMROOT',
    'COMSPEC',
    'WINDIR',
    'PATHEXT',
    'OS',
    'SYSTEMDRIVE',
  ]);
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && keepKeys.has(k.toUpperCase())) {
      env[k] = v;
    }
  }
  if (sandbox) {
    env.HOME = sandbox.homeDir;
    env.USERPROFILE = sandbox.homeDir;
    env.APPDATA = sandbox.appDataDir;
    env.LOCALAPPDATA = sandbox.appDataDir;
    env.TEMP = sandbox.tempDir;
    env.TMP = sandbox.tempDir;
    env.TMPDIR = sandbox.tempDir;
    if (sandbox.extraEnv) {
      Object.assign(env, sandbox.extraEnv);
    }
  }
  return env;
}

export async function runOrchestrate<T = unknown>(
  exePath: string,
  sandbox: { appDataDir: string; homeDir: string; tempDir: string; extraEnv?: Record<string, string> },
  request: Record<string, unknown> | string,
  timeoutMs = 20_000,
): Promise<HeadlessResult<T>> {
  const args = ['--orchestrate'];
  assertHeadlessArgsAllowed(args);
  const input = typeof request === 'string' ? request : JSON.stringify(request);
  const res = spawnSync(exePath, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    env: buildMinimalSafeRustEnv(sandbox),
    maxBuffer: 4 * 1024 * 1024,
  });

  if (res.error) {
    throw res.error;
  }

  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  let json: T | undefined;
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      json = JSON.parse(trimmed) as T;
    } catch {
      // leave undefined for invalid-json checks
    }
  }
  return {
    exitCode: res.status ?? -1,
    stdout,
    stderr,
    json,
  };
}

export async function runQuotaCore<T = unknown>(
  exePath: string,
  request: Record<string, unknown> | string,
  extraArgs: string[] = [],
  timeoutMs = 15_000,
): Promise<HeadlessResult<T>> {
  const args = ['--quota-core', ...extraArgs];
  assertHeadlessArgsAllowed(args);
  const input = typeof request === 'string' ? request : JSON.stringify(request);
  const res = spawnSync(exePath, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    env: buildMinimalSafeRustEnv(),
    maxBuffer: 4 * 1024 * 1024,
  });

  if (res.error) {
    throw res.error;
  }

  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  let json: T | undefined;
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      json = JSON.parse(trimmed) as T;
    } catch {
      // leave undefined
    }
  }
  return {
    exitCode: res.status ?? -1,
    stdout,
    stderr,
    json,
  };
}

function writeAsciiField(buf: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}

function encodeTarArchive(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    const nameBytes = Buffer.from(entry.name, 'utf8');
    if (nameBytes.length > 100) {
      throw new Error(`Tar entry name exceeds 100 bytes: ${entry.name}`);
    }
    nameBytes.copy(header, 0);
    writeAsciiField(header, 100, 8, '0000600\0');
    writeAsciiField(header, 108, 8, '0000000\0');
    writeAsciiField(header, 116, 8, '0000000\0');
    writeAsciiField(header, 124, 12, `${entry.content.length.toString(8).padStart(11, '0')}\0`);
    const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0');
    writeAsciiField(header, 136, 12, `${mtimeOctal}\0`);
    header.fill(0x20, 148, 156); // chksum spaces during calculation
    writeAsciiField(header, 156, 1, '0');
    writeAsciiField(header, 257, 6, 'ustar\0');
    writeAsciiField(header, 263, 2, '00');

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    writeAsciiField(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);

    chunks.push(header);
    if (entry.content.length > 0) {
      chunks.push(entry.content);
      const rem = entry.content.length % 512;
      if (rem !== 0) {
        chunks.push(Buffer.alloc(512 - rem, 0));
      }
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

const BAGA_MAGIC = Buffer.from('BAGAID01', 'ascii');
const BAGA_BLOCK_SIZE = 64 * 1024;

function sealFrame(archiveKey: Buffer, counter: bigint, plain: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(plain.length + 16, 0);

  const nonce = Buffer.alloc(12, 0);
  nonce.writeBigUInt64BE(counter, 4);

  const cipher = createCipheriv('aes-256-gcm', archiveKey, nonce);
  cipher.setAAD(lenBuf);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([lenBuf, encrypted, tag]);
}

export function sealBagaArchive(
  masterKey: Uint8Array,
  entries: Array<{ name: string; content: Buffer }>,
): Buffer {
  if (masterKey.length !== 32) {
    throw new Error(`masterKey must be exactly 32 bytes (got ${masterKey.length})`);
  }

  const archiveKey = randomBytes(32);
  const headerNonce = randomBytes(12);
  const headerCipher = createCipheriv('aes-256-gcm', masterKey, headerNonce);
  headerCipher.setAAD(BAGA_MAGIC);
  const wrappedKey = Buffer.concat([headerCipher.update(archiveKey), headerCipher.final()]);
  const headerTag = headerCipher.getAuthTag();

  const tarBytes = encodeTarArchive(entries);
  const gzBytes = gzipSync(tarBytes);

  const out: Buffer[] = [BAGA_MAGIC, headerNonce, wrappedKey, headerTag];
  let counter = 0n;
  for (let offset = 0; offset < gzBytes.length; offset += BAGA_BLOCK_SIZE) {
    const slice = gzBytes.subarray(offset, Math.min(offset + BAGA_BLOCK_SIZE, gzBytes.length));
    out.push(sealFrame(archiveKey, counter, slice));
    counter += 1n;
  }
  // Authenticated empty termination frame
  out.push(sealFrame(archiveKey, counter, Buffer.alloc(0)));
  return Buffer.concat(out);
}

export function computeAccountKeyHmac(
  masterKey: Uint8Array,
  accountUuid: string | null,
  email: string,
  organizationUuidOrName = '',
): string {
  const org = organizationUuidOrName.trim();
  const payload =
    accountUuid && accountUuid.trim()
      ? JSON.stringify(['uuid', accountUuid.trim(), org])
      : JSON.stringify(['email', email.trim().toLowerCase(), org]);
  return createHmac('sha256', masterKey).update(payload, 'utf8').digest('hex');
}

export function computeQuotaIdentitySha256(
  accountUuid: string,
  email: string,
  organizationUuidOrName = '',
): string {
  const raw = JSON.stringify([
    accountUuid.trim(),
    email.trim().toLowerCase(),
    organizationUuidOrName.trim(),
  ]);
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function deriveDeterministicBrowserSeed(id: string, attempt = 0): number {
  const digest = createHash('sha256')
    .update(`CCBaga/browser/${id}/${attempt}`, 'utf8')
    .digest();
  return digest.readUInt32BE(0);
}

function rustPlatformName(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function randomHex32(): string {
  return randomBytes(16).toString('hex');
}

export async function seedSyntheticVault(options: {
  appDataDir: string;
  homeDir: string;
  accounts: SyntheticAccountSpec[];
  activeAccountIndex?: number;
  masterKey?: Uint8Array;
}): Promise<{
  masterKey: Uint8Array;
  vaultDir: string;
  records: SeededAccountRecord[];
}> {
  const { Database } = await import('bun:sqlite');

  const vaultDir = join(options.appDataDir, 'ai.local.claude-local', 'identity-vault');
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(options.homeDir, { recursive: true });

  const keyPath = join(vaultDir, 'key.bin');
  const masterKey = options.masterKey
    ? Uint8Array.from(options.masterKey)
    : existsSync(keyPath)
      ? Uint8Array.from(readFileSync(keyPath))
      : randomBytes(32);
  if (masterKey.length !== 32) {
    throw new Error(`masterKey must be 32 bytes (got ${masterKey.length})`);
  }
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, masterKey);
  }

  const dbPath = join(vaultDir, 'identities.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS identities(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        archive TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        policy TEXT NOT NULL,
        empty INTEGER NOT NULL,
        account_key TEXT
      );
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_bindings(
        identity TEXT PRIMARY KEY,
        slot TEXT NOT NULL UNIQUE,
        seed INTEGER NOT NULL UNIQUE
      );
      PRAGMA user_version=3;
    `);
    db.query("INSERT OR IGNORE INTO state VALUES('browser.enabled','1')").run();
    db.query("INSERT OR IGNORE INTO state VALUES('browser.active','legacy')").run();
    db.query("INSERT OR IGNORE INTO state VALUES('browser.draft', ?1)").run(randomHex32());

    const defaultPolicy = {
      skills: true,
      plugins: true,
      mcp: true,
      settings: true,
      projects: true,
      history: true,
      cache: false,
    };
    const policyJson = JSON.stringify(defaultPolicy);
    const nowSec = Math.floor(Date.now() / 1000);
    const records: SeededAccountRecord[] = [];
    const usedSeeds = new Set<number>();

    const insertIdentity = db.query(
      'INSERT OR REPLACE INTO identities(id,name,archive,saved_at,bytes,policy,empty,account_key) VALUES(?1,?2,?3,?4,?5,?6,0,?7)',
    );
    const insertSummary = db.query(
      'INSERT OR REPLACE INTO identity_summaries(id,summary) VALUES(?1,?2)',
    );
    const insertBinding = db.query(
      'INSERT OR REPLACE INTO browser_bindings(identity,slot,seed) VALUES(?1,?2,?3)',
    );

    const claudeJsonPath = join(options.homeDir, '.claude.json');
    const credJsonPath = join(options.homeDir, '.claude', '.credentials.json');

    for (let i = 0; i < options.accounts.length; i++) {
      const spec = options.accounts[i];
      const id = spec.id ?? randomHex32();
      const generation = randomHex32();
      const archiveName = `${generation}.baga`;
      const orgUuid = spec.organizationUuid ?? `org-${id.slice(0, 8)}`;
      const orgName = spec.organizationName ?? 'Synthetic Org';
      const accountKey = computeAccountKeyHmac(masterKey, spec.accountUuid, spec.email, orgUuid);
      const quotaIdentity = computeQuotaIdentitySha256(spec.accountUuid, spec.email, orgUuid);

      const claudeData = {
        oauthAccount: {
          accountUuid: spec.accountUuid,
          emailAddress: spec.email,
          displayName: spec.name,
          organizationUuid: orgUuid,
          organizationName: orgName,
        },
      };
      const credData = {
        claudeAiOauth: {
          accessToken: spec.accessToken ?? `sk-ant-oat01-synthetic-${id}`,
          refreshToken: spec.refreshToken ?? `sk-ant-ort01-synthetic-${id}`,
          expiresAt: spec.expiresAtMs ?? Date.now() + 3600_000,
        },
      };

      const data0 = Buffer.from(JSON.stringify(claudeData), 'utf8');
      const data1 = Buffer.from(JSON.stringify(credData), 'utf8');
      const fp0 = [...createHash('sha256').update(data0).digest()];
      const fp1 = [...createHash('sha256').update(data1).digest()];

      const manifest = {
        version: 1,
        id,
        home: options.homeDir,
        platform: rustPlatformName(),
        policy: defaultPolicy,
        sources: [
          {
            path: claudeJsonPath,
            category: 'account',
            keys: ['oauthAccount'],
          },
          {
            path: credJsonPath,
            category: 'account',
            keys: [
              'claudeAiOauth',
              'trustedDeviceToken',
              'organizationUuid',
              'enterpriseGateway',
              'designOauth',
              'trustedDeviceEnrolledAfterRefusalAtMs',
              'cloudSessionsOauth',
            ],
          },
        ],
        credentials: [],
        fingerprints: [fp0, fp1],
        account_key: accountKey,
      };

      const bagaBuf = sealBagaArchive(masterKey, [
        { name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest), 'utf8') },
        { name: 'data/0', content: data0 },
        { name: 'data/1', content: data1 },
      ]);
      writeFileSync(join(vaultDir, archiveName), bagaBuf);

      const savedAt = nowSec - (options.accounts.length - i);
      insertIdentity.run(id, spec.name, archiveName, savedAt, bagaBuf.length, policyJson, accountKey);

      const summary = {
        quota_identity: quotaIdentity,
        display_name: spec.name,
        email: spec.email,
        organization: orgName,
        plan: spec.plan ?? 'Max',
        auth_status: 'valid',
        ...(spec.proxy ? { proxy: spec.proxy } : {}),
        quota_5h_used: spec.quota5hUsed ?? 15,
        quota_5h_reset_at: spec.quota5hResetAt ?? nowSec + 4 * 3600,
        quota_7d_used: spec.quota7dUsed ?? 10,
        quota_7d_reset_at: spec.quota7dResetAt ?? nowSec + 5 * 86400,
        quota_no_5h_limit: false,
        quota_5h_rested: false,
        quota_checked: true,
        quota_version: 7,
        quota_source: 'server_anchor',
        quota_5h_source: 'server_anchor',
        quota_7d_source: 'server_anchor',
        quota_observed_at_ms: Date.now(),
        quota_5h_observed_at_ms: Date.now(),
        quota_7d_observed_at_ms: Date.now(),
      };
      insertSummary.run(id, JSON.stringify(summary));

      let assignedSeed: number | undefined;
      if (spec.bindBrowser) {
        for (let attempt = 0; attempt < 32; attempt++) {
          const candidate = deriveDeterministicBrowserSeed(id, attempt);
          if (candidate > 0 && !usedSeeds.has(candidate)) {
            usedSeeds.add(candidate);
            assignedSeed = candidate;
            break;
          }
        }
        if (assignedSeed === undefined) {
          throw new Error(`Failed to derive non-zero unique browser seed for ${id}`);
        }
        insertBinding.run(id, id, assignedSeed);
      }

      if (options.activeAccountIndex === i) {
        mkdirSync(join(options.homeDir, '.claude'), { recursive: true });
        writeFileSync(claudeJsonPath, JSON.stringify(claudeData, null, 2));
        writeFileSync(credJsonPath, JSON.stringify(credData, null, 2));
        db.query("INSERT OR REPLACE INTO state VALUES('active', ?1)").run(id);
        db.query("INSERT OR REPLACE INTO state VALUES('active_since', ?1)").run(String(nowSec));
        if (spec.bindBrowser) {
          db.query("INSERT OR REPLACE INTO state VALUES('browser.active', ?1)").run(id);
        }
      }

      records.push({
        id,
        name: spec.name,
        archive: archiveName,
        accountKey,
        quotaIdentity,
        ...(assignedSeed !== undefined ? { seed: assignedSeed } : {}),
      });
    }

    return { masterKey, vaultDir, records };
  } finally {
    db.close();
  }
}

export function runBunTest(repoRoot: string, filterArgs: string[] = []): HeadlessResult {
  const res = spawnSync('bun', ['test', ...filterArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

export function runOfflinePythonTest(
  repoRoot: string,
  scriptName: string,
  sandbox: { appDataDir: string; homeDir: string; tempDir: string },
): HeadlessResult {
  const normalized = scriptName.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('test-windows.py') || normalized.includes('deploy-local')) {
    throw new Error(`Forbidden host-mutating script blocked by E2E safety guard: ${scriptName}`);
  }
  const scriptPath = resolve(repoRoot, 'scripts', scriptName);
  const res = spawnSync('python', [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    env: buildMinimalSafeRustEnv(sandbox),
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

export function inspectSqliteMeta(dbPath: string): {
  exists: boolean;
  sizeBytes: number;
} {
  if (!existsSync(dbPath)) {
    return { exists: false, sizeBytes: 0 };
  }
  return { exists: true, sizeBytes: statSync(dbPath).size };
}

export { readFileSync };
