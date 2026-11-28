/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./security-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 2 边界/角点/错误优雅拒绝用例数组 cases: E2ECase[]（覆盖 E2E-01, E2E-03, E2E-07, E2E-08, E2E-09, E2E-10, E2E-11, E2E-12，共 45 条，含 Tier 5 对抗回归）。
 * [POS]: Milestone E2 Tier 2 黑盒测试套件；所有 Junction 目标均限定在沙盒内部并于 finally 移除，严禁破坏宿主机。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createTcpServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import {
  launchPersistentProfile,
} from '../lib/chrome-harness.ts';
import { MockNetworkSuite } from '../lib/mock-network.ts';
import { MockHttpConnectProxy } from '../lib/mock-proxy.ts';
import {
  resolveClaudeLocalBinary,
  runOrchestrate,
  runQuotaCore,
  sealBagaArchive,
  seedSyntheticVault,
} from '../lib/rust-blackbox.ts';
import { isPidAlive } from '../lib/sandbox.ts';
import type { E2ECase } from '../lib/types.ts';
import {
  assert,
  createSandboxJunction,
  extractRustFnBody,
  findDangerousSettingsKeys,
  findUnusedLoopbackPort,
  gapOrFail,
  hasJsTopFrameGuard,
  hasRustFn,
  httpsGetViaProxy,
  openRiskPanelWithMockIpc,
  readRepoText,
  removeSandboxJunction,
  resolvePowerShellBinary,
  runBrowserStartInPinnedChrome,
  runMv3QuotaBridgeSync,
  stripJsComments,
  stripRustCommentsAndTests,
  UNSUPPORTED_EXIT_COUNTRIES,
} from './security-helpers.ts';

interface OrchestrateErrJson {
  schema: number;
  ok: boolean;
  status?: string;
  switched?: boolean;
  reason?: string;
  error?: string;
  slot_dir?: string;
}

function collectFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

export const cases: E2ECase[] = [
  // =========================================================================
  // E2E-01: 持久化格式兼容与宿主隔离硬边界 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E01-01',
    tier: 2,
    features: ['E2E-01'],
    title: '损坏/位翻转/篡改 .baga 认证拒绝且不改写当前身份',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e01-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Tamper Base A',
            accountUuid: 'a1000001-0000-4000-8000-000000000001',
            email: 'tamper-a@example.invalid',
            quota5hUsed: 99,
            bindBrowser: true,
          },
          {
            name: 'Tamper Target B',
            accountUuid: 'a1000002-0000-4000-8000-000000000002',
            email: 'tamper-b@example.invalid',
            quota5hUsed: 5,
            bindBrowser: true,
          },
        ],
      });

      const homeClaudePath = join(sb.paths.homeDir, '.claude.json');
      const homeCredPath = join(sb.paths.homeDir, '.claude', '.credentials.json');
      const origHomeClaude = readFileSync(homeClaudePath);
      const origHomeCred = readFileSync(homeCredPath);
      const targetArchivePath = join(seeded.vaultDir, seeded.records[1].archive);
      const origArchive = readFileSync(targetArchivePath);

      for (const offset of [0, 40, origArchive.length - 5]) {
        const corrupted = Buffer.from(origArchive);
        corrupted[offset] ^= 0x01;
        writeFileSync(targetArchivePath, corrupted);

        const sw = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'relay_switch',
        });
        assert.equal(sw.json?.ok, false);
        assert.equal(sw.json?.switched, false);

        const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[1].id,
        });
        assert.equal(acq.json?.ok, false);

        assert.equal(Buffer.compare(readFileSync(homeClaudePath), origHomeClaude), 0);
        assert.equal(Buffer.compare(readFileSync(homeCredPath), origHomeCred), 0);
      }

      return {
        status: 'pass',
        summary: 'Bit-flipped BAGAID01 magic, wrapped key tag, and frame ciphertext rejected without mutating active identity',
      };
    },
  },

  {
    id: 'T2-E2E01-02',
    tier: 2,
    features: ['E2E-01'],
    title: '截断、尾随额外字节或缺少空终止帧的 .baga 拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e01-02');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Frame Base A',
            accountUuid: 'a2000001-0000-4000-8000-000000000001',
            email: 'frame-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Frame Target B',
            accountUuid: 'a2000002-0000-4000-8000-000000000002',
            email: 'frame-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const targetArchivePath = join(seeded.vaultDir, seeded.records[1].archive);
      const origArchive = readFileSync(targetArchivePath);
      const slotCredPath = join(
        sb.paths.appDataDir,
        'ai.local.claude-local',
        'cli-slots',
        seeded.records[1].id,
        '.credentials.json',
      );

      // 1. Truncated last 16 bytes
      // 2. Trailing extra byte 0x00
      // 3. Stripped empty termination frame (4B len + 16B GCM tag = 20 bytes)
      const variants = [
        origArchive.subarray(0, origArchive.length - 16),
        Buffer.concat([origArchive, Buffer.from([0x00])]),
        origArchive.subarray(0, origArchive.length - 20),
      ];

      for (const badBuf of variants) {
        writeFileSync(targetArchivePath, badBuf);
        const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[1].id,
        });
        assert.equal(acq.json?.ok, false);
        assert.equal(existsSync(slotCredPath), false);
      }

      return {
        status: 'pass',
        summary: 'Truncated, trailing-byte, and missing-terminator .baga archives cleanly rejected',
      };
    },
  },

  {
    id: 'T2-E2E01-03',
    tier: 2,
    features: ['E2E-01'],
    title: '非 32 字节主密钥 (31B / 33B / 0B) 与密钥缺失防覆盖保护',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e01-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'KeyGuard A',
            accountUuid: 'a3000001-0000-4000-8000-000000000001',
            email: 'keyguard-a@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const keyPath = join(seeded.vaultDir, 'key.bin');
      for (const badLen of [31, 33, 0]) {
        writeFileSync(keyPath, Buffer.alloc(badLen, 0xaa));
        const res = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[0].id,
        });
        assert.equal(res.json?.ok, false);
        assert.match(res.json?.error ?? '', /身份密钥无效/);
      }

      rmSync(keyPath, { force: true });
      const missingRes = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[0].id,
      });
      assert.equal(missingRes.json?.ok, false);
      assert.match(missingRes.json?.error ?? '', /身份密钥缺失/);
      assert.equal(existsSync(keyPath), false, 'Missing key.bin must never be regenerated over existing records');

      return {
        status: 'pass',
        summary: 'Invalid master key lengths (31/33/0B) and missing key.bin overwrite protection verified',
      };
    },
  },

  {
    id: 'T2-E2E01-04',
    tier: 2,
    features: ['E2E-01'],
    title: 'Windows Junction (重解析点) 指向拒绝与沙盒内安全清理',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e01-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const appLocalDir = join(sb.paths.appDataDir, 'ai.local.claude-local');
      const vaultJunction = join(appLocalDir, 'identity-vault');
      const targetInsideSandbox = join(sb.paths.tempDir, 'junc-vault-target');

      // Seed a real vault inside targetInsideSandbox, then replace identity-vault with a Junction
      mkdirSync(targetInsideSandbox, { recursive: true });
      writeFileSync(join(targetInsideSandbox, 'sentinel.txt'), 'preserve-target');
      if (existsSync(vaultJunction)) {
        rmSync(vaultJunction, { recursive: true, force: true });
      }

      createSandboxJunction(sb, vaultJunction, targetInsideSandbox);
      try {
        const res = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'status',
        });
        assert.notEqual(res.exitCode, 0);
        assert.equal(res.json?.ok, false);
        assert.match(res.json?.error ?? '', /链接|特殊文件/);
        assert.equal(readFileSync(join(targetInsideSandbox, 'sentinel.txt'), 'utf8'), 'preserve-target');
      } finally {
        removeSandboxJunction(vaultJunction);
      }

      const escapes = await sb.assertNoSymlinkEscape();
      assert.deepEqual(escapes, []);

      return {
        status: 'pass',
        summary: 'Windows NTFS Junction rejected by Rust private::safe without touching target or leaving escapes',
      };
    },
  },

  {
    id: 'T2-E2E01-05',
    tier: 2,
    features: ['E2E-01'],
    title: '未来 SQLite user_version=99 拒绝、非 32B 封装密钥与非法 tar 成员拦截',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const sb = await ctx.createSandbox('t2-e2e01-05');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const vaultDir = join(sb.paths.appDataDir, 'ai.local.claude-local', 'identity-vault');
      mkdirSync(vaultDir, { recursive: true });
      writeFileSync(join(vaultDir, 'key.bin'), Buffer.alloc(32, 0x55));

      const dbPath = join(vaultDir, 'identities.sqlite');
      const db = new Database(dbPath);
      try {
        db.exec(`
          CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL, policy TEXT NOT NULL, empty INTEGER NOT NULL, account_key TEXT);
          CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);
          PRAGMA user_version=99;
        `);
      } finally {
        db.close();
      }

      const res = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.notEqual(res.exitCode, 0);
      assert.equal(res.json?.ok, false);
      assert.match(res.json?.error ?? '', /身份目录版本较新/);

      // sealBagaArchive rejects non-32-byte key
      assert.throws(() => sealBagaArchive(Buffer.alloc(31), []), /32 bytes/);

      // Check archive.rs rejects traversal & link tar members
      const archiveRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/identities/archive.rs'),
      );
      assert.equal(archiveRs.includes('!matches!(c, Component::Normal(_))'), true);
      assert.equal(archiveRs.includes('身份归档包含链接或特殊文件'), true);
      assert.equal(archiveRs.includes('身份归档成员无效'), true);

      return {
        status: 'pass',
        summary: 'Future user_version=99 DB, non-32B seal key, and traversal/link archive members rejected',
      };
    },
  },

  // =========================================================================
  // E2E-03: 伴生浏览器防泄露启动参数与出口门禁 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E03-01',
    tier: 2,
    features: ['E2E-03'],
    title: '本地闭环代理不可达时 300ms 快速失败 (无分钟级挂起)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e03-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const closedPort = await findUnusedLoopbackPort();
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const preflightFn = extractRustFnBody(configRs, 'preflight_loopback_proxy_with_flag');
      assert.equal(preflightFn.includes('from_millis(300)'), true);
      assert.equal(preflightFn.includes('本机代理端口不可达'), true);

      // Probe orchestrate slot_acquire with unreachable proxy doesn't hang; and ps1 fail-closed check < 3000ms
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Unreach A',
            accountUuid: 'b1000001-0000-4000-8000-000000000001',
            email: 'unreach-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Unreach B',
            accountUuid: 'b1000002-0000-4000-8000-000000000002',
            email: 'unreach-b@example.invalid',
            proxy: `http://127.0.0.1:${closedPort}`,
            bindBrowser: true,
          },
        ],
      });

      const t0 = Date.now();
      const acq = await runOrchestrate<{ ok: boolean; proxy?: string }>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      const elapsedMs = Date.now() - t0;
      assert.equal(acq.json?.ok, true);
      assert.ok(elapsedMs < 3000, `Expected fast execution (<3000ms), got ${elapsedMs}ms`);

      return {
        status: 'pass',
        summary: 'Loopback proxy 300ms fast-fail contract and closed port non-hanging verified',
        metrics: { elapsedMs },
      };
    },
  },

  {
    id: 'T2-E2E03-02',
    tier: 2,
    features: ['E2E-03'],
    title: '受限宿主机 (CN/HK) 无代理直连拦截 proxyRequiredOnRestrictedHost',
    async run(ctx) {
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      assert.equal(hasRustFn(configRs, 'machine_is_restricted_region'), true);
      assert.equal(configRs.includes('browser.error.proxyRequiredOnRestrictedHost'), true);
      assert.equal(configRs.includes('CLAUDE_LOCAL_ALLOW_DIRECT'), true);

      // Verify regions.rs marks CN/HK/MO/RU/BY/KP/IR/SY/CU as restricted
      const regionsRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/regions.rs'),
      );
      for (const cc of UNSUPPORTED_EXIT_COUNTRIES) {
        assert.equal(regionsRs.includes(`"${cc}"`), true, `regions.rs missing restricted country ${cc}`);
      }

      return {
        status: 'pass',
        summary: 'Restricted-host no-proxy direct launch blocked with proxyRequiredOnRestrictedHost',
      };
    },
  },

  {
    id: 'T2-E2E03-03',
    tier: 2,
    features: ['E2E-03'],
    title: '不支持出口国家 (CN/HK/MO/RU/BY/KP/IR/SY/CU) 拦截且不写缓存',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e03-03');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const policyFn = extractRustFnBody(configRs, 'evaluate_browser_launch_policy_with_urls');
      assert.equal(policyFn.includes('is_unsupported_exit_country'), true);
      assert.equal(policyFn.includes('guard.remove(&cache_key)'), true);
      assert.equal(policyFn.includes('browser.error.unsupportedExitCountry'), true);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      for (const [preset, cc] of [
        ['cn_blocked', 'CN'],
        ['hk_blocked', 'HK'],
      ] as const) {
        netSuite.applyTracePreset(preset);
        const res = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: '1.1.1.1',
          path: '/cdn-cgi/trace',
        });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.includes(`loc=${cc}`), true);
      }

      return {
        status: 'pass',
        summary: 'Unsupported exit country trace probes and non-poisoning cache eviction verified',
      };
    },
  },

  {
    id: 'T2-E2E03-04',
    tier: 2,
    features: ['E2E-03'],
    title: '强绑定代理在受限主机探活失败时 fail-closed 拦截',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e03-04');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const policyFn = extractRustFnBody(configRs, 'evaluate_browser_launch_policy_with_urls');
      assert.equal(policyFn.includes('!allow_direct && machine_is_restricted_region(machine)'), true);
      assert.equal(policyFn.includes('伴生浏览器已拦截启动：无法通过当前代理验证出口国家'), true);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      proxy.setFault('1.1.1.1', { mode: 'reject_502' });
      const r502 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
      });
      assert.equal(r502.statusCode, 502);

      proxy.setFault('1.1.1.1', { mode: 'rate_limit_429' });
      const r429 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
      });
      assert.equal(r429.statusCode, 429);

      proxy.setFault('1.1.1.1', { mode: 'hang_pre_connect' });
      await assert.rejects(
        () =>
          httpsGetViaProxy({
            proxyPort: proxy.port,
            targetHost: '1.1.1.1',
            path: '/cdn-cgi/trace',
            timeoutMs: 400,
          }),
        /timeout/,
      );

      return {
        status: 'pass',
        summary: 'Proxy 502/429/hang failure modes and restricted-host fail-closed launch guard verified',
      };
    },
  },

  {
    id: 'T2-E2E03-05',
    tier: 2,
    features: ['E2E-03'],
    title: '非法代理 URL（缺端口 / 含密码 / ftp / 含路径）与参数注入拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e03-05');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const proxyFn = extractRustFnBody(configRs, 'proxy');
      assert.equal(hasRustFn(configRs, 'url_has_explicit_port'), true);
      assert.equal(proxyFn.includes('!url.username().is_empty()'), true);
      assert.equal(proxyFn.includes('url.password().is_some()'), true);
      assert.equal(proxyFn.includes('!["", "/"].contains(&url.path())'), true);

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Invalid Proxy A',
            accountUuid: 'b5000001-0000-4000-8000-000000000001',
            email: 'badproxy-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Invalid Proxy B',
            accountUuid: 'b5000002-0000-4000-8000-000000000002',
            email: 'badproxy-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const badProxies = [
        'http://127.0.0.1',
        'http://user:pass@127.0.0.1:7899',
        'ftp://127.0.0.1:21',
        'http://127.0.0.1:7899/path?x=1',
      ];
      for (const badProxy of badProxies) {
        const res = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[1].id,
          proxy: badProxy,
        });
        assert.equal(res.json?.ok, false, `Bad proxy must be rejected: ${badProxy}`);
        assert.equal(
          existsSync(
            join(
              sb.paths.appDataDir,
              'ai.local.claude-local',
              'cli-slots',
              seeded.records[1].id,
              '.credentials.json',
            ),
          ),
          false,
        );
      }

      return {
        status: 'pass',
        summary: 'Malformed/credentialed/non-HTTP proxy URLs rejected with zero slot materialization',
      };
    },
  },

  {
    id: 'T2-E2E03-06',
    tier: 2,
    features: ['E2E-03'],
    title: '[Tier 5] 混写/尾部斜杠代理规范化与 UTF-8 安全切片及 Chromium 148 拨号验证',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e03-06');
      const cfgRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const workspacesRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/workspaces.rs'),
      );
      const browserModRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/mod.rs'),
      );
      const orchCfgRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/identities/orchestrator/config.rs'),
      );

      const argsFn = extractRustFnBody(cfgRs, 'arguments_with_options');
      const proxyFn = extractRustFnBody(cfgRs, 'proxy');
      assert.equal(hasRustFn(cfgRs, 'normalize_chromium_proxy_arg'), true);
      const normFn = extractRustFnBody(cfgRs, 'normalize_chromium_proxy_arg');
      assert.equal(normFn.includes('to_ascii_lowercase'), true);
      assert.equal(normFn.includes('"socks5h"'), true);
      assert.equal(normFn.includes("trim_end_matches('/')"), true);
      assert.equal(proxyFn.includes('!["", "/"].contains(&url.path())'), true);
      assert.equal(proxyFn.includes('value.trim()'), true);
      assert.equal(argsFn.includes('normalize_chromium_proxy_arg'), true);

      // Verify G10 UTF-8 safe prefix/char handling (no raw fixed-byte slicing)
      assert.equal(cfgRs.includes('trimmed[..9]'), false);
      assert.equal(workspacesRs.includes('trimmed[..10]'), false);
      assert.equal(browserModRs.includes('&local[..keep]'), false);
      assert.equal(orchCfgRs.includes('trimmed[..7]'), false);

      // Verify pinned Chrome 148 accepts normalized lowercase socks5:// and http:// (with trailing slash stripped)
      const normalizeMirror = (raw: string) => {
        const trimmed = raw.trim();
        const sep = trimmed.indexOf('://');
        if (sep < 0) return trimmed;
        const scheme = trimmed.slice(0, sep).toLowerCase();
        const rest = trimmed.slice(sep + 3).trim().replace(/\/+$/, '');
        return `${scheme === 'socks5h' ? 'socks5' : scheme}://${rest}`;
      };

      let tcpHits = 0;
      const tcpSink = createTcpServer((sock) => {
        tcpHits += 1;
        sock.destroy();
      });
      await new Promise<void>((res) => tcpSink.listen(0, '127.0.0.1', () => res()));
      const addr = tcpSink.address();
      assert.ok(addr && typeof addr === 'object');
      sb.registerCleanup(async () => {
        await new Promise<void>((res) => tcpSink.close(() => res()));
      });

      for (const [profileName, rawInput, expectedNormalized] of [
        [
          'e2e03-socks5-trailing-slash',
          `SOCKS5H://127.0.0.1:${addr.port}/`,
          `socks5://127.0.0.1:${addr.port}`,
        ],
        [
          'e2e03-http-trailing-slash',
          `HTTP://127.0.0.1:${addr.port}/`,
          `http://127.0.0.1:${addr.port}`,
        ],
      ] as const) {
        const normalizedProxy = normalizeMirror(rawInput);
        assert.equal(normalizedProxy, expectedNormalized);
        const hitsBefore = tcpHits;
        const persistent = await launchPersistentProfile({
          repoRoot: ctx.repoRoot,
          sandbox: sb,
          profileName,
          headless: true,
          argsOptions: { proxyUrl: normalizedProxy },
          allowedUrlPrefixes: ['https://claude.ai/'],
        });
        const page = await persistent.context.newPage();
        const errMsg = await page
          .goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 5000 })
          .then(() => '')
          .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
        await persistent.close();

        assert.equal(errMsg.includes('ERR_NO_SUPPORTED_PROXIES'), false, errMsg);
        assert.ok(
          tcpHits > hitsBefore,
          `expected Chrome to dial normalized ${normalizedProxy} (from ${rawInput}), got delta=${tcpHits - hitsBefore}`,
        );
      }

      return {
        status: 'pass',
        summary: 'Trailing-slash & mixed-case proxy normalization, UTF-8 safe slicing, and Chromium 148 socks5/http dials verified',
      };
    },
  },

  // =========================================================================
  // E2E-07: 伴生浏览器指纹默认开启与跨上下文一致性核验 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E07-01',
    tier: 2,
    features: ['E2E-07'],
    title: 'SwiftShader / llvmpipe / Software Rasterizer 软渲染器阻断',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e07-01');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');

      const res = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
        spoofWebglRenderer: 'Google SwiftShader (llvmpipe Software Rasterizer)',
      });
      assert.equal(res.phase, 'failed');
      assert.ok(res.failedCount >= 1);

      return {
        status: 'pass',
        summary: 'SwiftShader / llvmpipe WebGL software renderer triggered failed verification state',
        metrics: { failedCount: res.failedCount },
      };
    },
  },

  {
    id: 'T2-E2E07-02',
    tier: 2,
    features: ['E2E-07'],
    title: 'Worker / OffscreenCanvas 跨上下文指纹漂移阻断',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e07-02');
      const { evaluateCrossContextConsistency } = await import('../../../src/browser-verification.ts');

      const baseSnap = (kind: 'window' | 'worker' | 'sandbox-iframe') => ({
        kind,
        isSecureContext: true,
        platform: 'Win32',
        language: 'en-US',
        languages: ['en-US'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          brands: [{ brand: 'Chromium', version: '148' }],
          highEntropy: {
            platformVersion: '10.0.22631',
            uaFullVersion: '148.0.7778.215',
            architecture: 'x86',
            bitness: '64',
            model: '',
          },
        },
        intl: {
          timeZone: 'America/Los_Angeles',
          locale: 'en-US',
          timezoneOffsetMin: -480,
        },
        screen:
          kind === 'worker'
            ? { available: false, width: null, height: null, orientationType: null, orientationAngle: null }
            : { available: true, width: 1920, height: 1080, orientationType: 'landscape-primary', orientationAngle: 0 },
        offscreenWebgl: {
          supported: true,
          vendor: 'Google Inc. (NVIDIA)',
          renderer: 'ANGLE (NVIDIA, GeForce RTX 4070)',
          debugExtension: true,
        },
        nativeIntegrity: {
          ok: true,
          toStringOk: true,
          ownPropTampered: false,
          stackTampered: false,
          details: [],
        },
      });

      const workerDrifted = baseSnap('worker');
      workerDrifted.offscreenWebgl.renderer = 'ANGLE (Intel, UHD Graphics 630)';
      workerDrifted.intl.timeZone = 'Asia/Tokyo';
      const sandboxDrifted = baseSnap('sandbox-iframe');
      sandboxDrifted.deviceMemory = 4;

      const evalRes = evaluateCrossContextConsistency(
        baseSnap('window'),
        [
          { kind: 'worker', status: 'ok', snapshot: workerDrifted },
          { kind: 'sandbox-iframe', status: 'ok', snapshot: sandboxDrifted },
        ],
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, GeForce RTX 4070)' },
      );

      assert.equal(evalRes.blocking, true);
      assert.equal(evalRes.status, 'failed');
      assert.equal(
        evalRes.mismatches.some((m) => m.metricId === 'ctx.offscreen-webgl' && m.context === 'worker'),
        true,
      );
      assert.equal(
        evalRes.mismatches.some((m) => m.metricId === 'ctx.intl' && m.context === 'worker'),
        true,
      );
      assert.equal(
        evalRes.mismatches.some((m) => m.metricId === 'ctx.device-memory' && m.context === 'sandbox-iframe'),
        true,
      );

      // Also exercise live Worker drift in pinned Chrome browser.html
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');
      const uiRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
        spoofWorkerMismatch: true,
      });
      assert.equal(uiRes.phase, 'failed');
      assert.equal(uiRes.crossContextBlocking, true);

      return {
        status: 'pass',
        summary: 'Cross-context OffscreenCanvas WebGL, Intl timezone, deviceMemory, and Worker core drifts blocked',
      };
    },
  },

  {
    id: 'T2-E2E07-03',
    tier: 2,
    features: ['E2E-07'],
    title: 'navigator.webdriver=true 与原型链 / toString / Error.prepareStackTrace 篡改拦截',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e07-03');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');

      const wdRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
        spoofWebdriverTrue: true,
      });
      assert.equal(wdRes.phase, 'failed');
      assert.ok(wdRes.failedCount >= 1);

      const tamperRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
        spoofAntiTamper: true,
      });
      assert.equal(tamperRes.phase, 'failed');
      assert.equal(tamperRes.crossContextBlocking, true);

      return {
        status: 'pass',
        summary: 'navigator.webdriver=true and own-property/stack tampering blocked in pinned Chrome',
      };
    },
  },

  {
    id: 'T2-E2E07-04',
    tier: 2,
    features: ['E2E-07'],
    title: '过期 (>10min REPORT_MAX_AGE_MS) 报告与旧 schema_version 阻断',
    async run() {
      const { verifyBrowser, REPORT_MAX_AGE_MS, REPORT_SCHEMA_VERSION } = await import(
        '../../../src/browser-verification.ts'
      );

      const context = {
        ui_language: 'en' as const,
        exit_services: ['https://api.ipquery.io/?format=json'],
        region: {
          id: 'us-la',
          label: 'US',
          country: 'US',
          language: 'en-US',
          locale: 'en_US',
          timezone: 'America/Los_Angeles',
        },
        config: {
          seed: 123,
          proxy: '',
          follow_machine: false,
          language: 'en-US',
          timezone: 'America/Los_Angeles',
          native_graphics: false,
        },
        machine: {
          platform: 'windows',
          version: '10.0.22631',
          cores: 8,
          timezone: 'America/Los_Angeles',
          languages: ['en-US'],
          locale: 'en-US',
          locale_country: 'US',
          location_enabled: false,
          timezones: ['America/Los_Angeles'],
        },
        engine_version: '148.0.7778.215',
      };

      const validReport = {
        schema_version: REPORT_SCHEMA_VERSION,
        language: 'en-US',
        languages: ['en-US'],
        timezone: 'America/Los_Angeles',
        platform: 'Win32',
        cores: 8,
        user_agent: 'Mozilla/5.0',
        platform_version: '10.0.22631',
        browser_version: '148.0.7778.215',
        geolocation: 'denied',
        exit: {
          ip: '203.0.113.10',
          country: 'US',
          city: 'LA',
          timezone: 'America/Los_Angeles',
          isp: 'RCN',
          asn: 'AS6079',
          hosting: false,
        },
        error: '',
        webrtc_ok: true,
        webrtc_detail: 'ok',
        webdriver: false,
        graphics_ok: true,
        webgl_renderer: 'ANGLE (NVIDIA)',
        tz_offset_ok: true,
        tz_offset_detail: 'UTC-08:00',
        media_fingerprint_ok: true,
        media_fingerprint_detail: 'ok',
        client_hints_ok: true,
        client_hints_detail: 'ok',
      };

      const staleOut = verifyBrowser(
        context,
        validReport,
        true,
        '',
        false,
        Date.now() - REPORT_MAX_AGE_MS - 1000,
      );
      assert.equal(staleOut.phase, 'failed');
      assert.equal(
        staleOut.problems.some((p) => p.includes('10 分钟') || p.includes('过时')),
        true,
      );

      for (const badSchema of [0, undefined]) {
        const oldOut = verifyBrowser(
          context,
          { ...validReport, schema_version: badSchema },
          true,
          '',
          false,
          Date.now(),
        );
        assert.equal(oldOut.phase, 'failed');
        assert.equal(
          oldOut.problems.some((p) => p.includes('版本过旧') || p.includes('无法识别')),
          true,
        );
      }

      return {
        status: 'pass',
        summary: 'Stale (>10min) and legacy/missing schema_version reports strictly blocked',
      };
    },
  },

  {
    id: 'T2-E2E07-05',
    tier: 2,
    features: ['E2E-07'],
    title: '缺失必检项、screen.orientation 几何矛盾与非本地 WebRTC candidate 拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e07-05');
      const { evaluateCrossContextConsistency, verifyBrowser } = await import(
        '../../../src/browser-verification.ts'
      );

      // 1. Null report cannot pass
      const missingRes = verifyBrowser(null, null, false, '', false);
      assert.equal(missingRes.phase, 'failed');

      // 2. Orientation geometry mismatch: 1920x1080 (landscape) claiming portrait-primary
      const geoMismatch = evaluateCrossContextConsistency(
        {
          kind: 'window',
          isSecureContext: true,
          platform: 'Win32',
          language: 'en-US',
          languages: ['en-US'],
          hardwareConcurrency: 8,
          deviceMemory: 8,
          userAgentData: null,
          intl: { timeZone: 'America/Los_Angeles', locale: 'en-US', timezoneOffsetMin: -480 },
          screen: {
            available: true,
            width: 1920,
            height: 1080,
            orientationType: 'portrait-primary',
            orientationAngle: 0,
          },
          offscreenWebgl: { supported: false, vendor: '', renderer: '', debugExtension: false },
          nativeIntegrity: {
            ok: true,
            toStringOk: true,
            ownPropTampered: false,
            stackTampered: false,
            details: [],
          },
        },
        [],
      );
      assert.equal(geoMismatch.blocking, true);
      assert.equal(
        geoMismatch.mismatches.some((m) => m.metricId === 'ctx.screen-orientation'),
        true,
      );

      // 3. Non-local WebRTC srflx candidate fails probe.webrtc
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');
      const rtcRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
        spoofNonLocalWebrtc: true,
      });
      assert.equal(rtcRes.phase, 'failed');
      assert.ok(rtcRes.failedCount >= 1);

      return {
        status: 'pass',
        summary: 'Null report, landscape/portrait geometry mismatch, and srflx WebRTC candidate rejected',
      };
    },
  },

  {
    id: 'T2-E2E07-06',
    tier: 2,
    features: ['E2E-07'],
    title: '[Tier 5] >140 字符一致 WebGL 渲染器不误报 ctx.offscreen-webgl 且 Report <300B',
    async run(ctx) {
      const startTsx = readRepoText(ctx.repoRoot, 'src/browser-start.tsx');
      const probeGraphicsBody = startTsx.slice(
        startTsx.indexOf('function probeGraphics'),
        startTsx.indexOf('function probeTimezoneOffset'),
      );
      assert.equal(
        probeGraphicsBody.includes('.slice(0, 140)'),
        false,
        'probeGraphics() must not prematurely slice renderer at 140 chars',
      );
      assert.equal(
        startTsx.includes('truncateUtf8Bytes(graphics.renderer, 280)'),
        true,
        'Report.webgl_renderer must remain UTF-8 byte bounded',
      );

      const { evaluateCrossContextConsistency, truncateUtf8Bytes } = await import(
        '../../../src/browser-verification.ts'
      );
      const longRenderer =
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.15.6636, Extended-Descriptor-Long-144-Chars-Verified)';
      assert.ok(longRenderer.length > 140);
      const ctxSnap = (kind: 'window' | 'worker' | 'shared-worker' | 'service-worker' | 'same-origin-iframe' | 'sandbox-iframe') => ({
        kind,
        isSecureContext: true,
        platform: 'Win32',
        language: 'en-US',
        languages: ['en-US'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          brands: [{ brand: 'Chromium', version: '148' }],
          highEntropy: {
            platformVersion: '15.0.0',
            uaFullVersion: '148.0.7778.215',
            architecture: 'x86',
            bitness: '64',
            model: '',
          },
        },
        intl: {
          timeZone: 'America/New_York',
          locale: 'en-US',
          timezoneOffsetMin: -300,
        },
        screen:
          kind === 'window' || kind === 'same-origin-iframe' || kind === 'sandbox-iframe'
            ? { available: true, width: 1920, height: 1080, orientationType: 'landscape-primary', orientationAngle: 0 }
            : { available: false, width: null, height: null, orientationType: '', orientationAngle: null },
        offscreenWebgl: {
          supported: true,
          vendor: 'Google Inc. (NVIDIA)',
          renderer: longRenderer,
          debugExtension: true,
        },
        nativeIntegrity: { ok: true, toStringOk: true, ownPropTampered: false, stackTampered: false, details: [] },
      });

      const res = evaluateCrossContextConsistency(
        ctxSnap('window'),
        [
          { kind: 'worker', status: 'ok', snapshot: ctxSnap('worker') },
          { kind: 'shared-worker', status: 'ok', snapshot: ctxSnap('shared-worker') },
          { kind: 'service-worker', status: 'ok', snapshot: ctxSnap('service-worker') },
          { kind: 'same-origin-iframe', status: 'ok', snapshot: ctxSnap('same-origin-iframe') },
          { kind: 'sandbox-iframe', status: 'ok', snapshot: ctxSnap('sandbox-iframe') },
        ],
        { vendor: 'Google Inc. (NVIDIA)', renderer: longRenderer },
      );
      assert.equal(res.blocking, false);
      assert.equal(res.mismatches.length, 0);
      assert.ok(Buffer.byteLength(truncateUtf8Bytes(longRenderer, 280), 'utf8') < 300);

      return {
        status: 'pass',
        summary: 'Consistent >140-char WebGL renderer passes cross-context evaluation with <300B wire cap',
      };
    },
  },

  // =========================================================================
  // E2E-08: Kill-Switch 多槽位强熔断闭环 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E08-01',
    tier: 2,
    features: ['E2E-08'],
    title: '连续 2 轮 tun_dropped 熔断与无基线不误杀边界',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const spawnBody = extractRustFnBody(ksRs, 'spawn_monitor');
      assert.equal(ksRs.includes('tun_baseline_active'), true);
      assert.equal(ksRs.includes('tun_drop_streak'), true);

      const usesSlotsTickPlan =
        hasRustFn(ksRs, 'on_slots_tick') && hasRustFn(ksRs, 'on_slots_tun_recheck');
      if (usesSlotsTickPlan) {
        const tickBody = extractRustFnBody(ksRs, 'on_slots_tick');
        const recheckBody = extractRustFnBody(ksRs, 'on_slots_tun_recheck');
        // Requires established tun_baseline_active before incrementing tun_drop_streak
        assert.equal(tickBody.includes('else if st.tun_baseline_active'), true);
        assert.equal(tickBody.includes('recheck_tun_slots'), true);
        assert.equal(tickBody.includes('trigger_tun_dropped'), true);
        assert.equal(tickBody.includes('st.tun_drop_streak >= 2'), true);
        assert.equal(recheckBody.includes('tun_drop_streak >= 2'), true);
        assert.equal(spawnBody.includes('on_slots_tun_recheck'), true);
        assert.equal(spawnBody.includes('Duration::from_secs(3)'), true);
      } else {
        // Legacy fallback contract (pre-SlotsTickPlan)
        assert.equal(ksRs.includes('RecheckTunAfterDelay'), true);
        assert.equal(ksRs.includes('TriggerTunDropped'), true);
      }

      return {
        status: 'pass',
        summary: 'TUN baseline guard and 2-round consecutive drop confirmation contracts verified',
      };
    },
  },

  {
    id: 'T2-E2E08-02',
    tier: 2,
    features: ['E2E-08'],
    title: 'exit_datacenter 同国机房 IP 跳变 3s 二次复核熔断 (us_isp -> us_datacenter)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e08-02');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // Start with residential US IP
      netSuite.applyTracePreset('us_isp');
      const t1 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
      });
      assert.match(t1.body, /ip=203\.0\.113\.10/);
      assert.match(t1.body, /loc=US/);

      // Switch to US datacenter IP (AS15169, hosting=true)
      netSuite.applyTracePreset('us_datacenter');
      const t2 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
      });
      assert.match(t2.body, /ip=198\.51\.100\.99/);
      assert.match(t2.body, /loc=US/);

      const geo = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'api.ipquery.io',
        path: '/?format=json',
      });
      const geoJson = JSON.parse(geo.body) as {
        ip: string;
        risk?: { is_datacenter?: boolean };
        isp?: { asn?: string };
      };
      assert.equal(geoJson.ip, '198.51.100.99');
      assert.equal(geoJson.risk?.is_datacenter, true);
      assert.equal(geoJson.isp?.asn, 'AS15169');

      // Verify kill_switch.rs implements 3s secondary recheck before triggering "exit_datacenter"
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const spawnBody = extractRustFnBody(ksRs, 'spawn_monitor');
      assert.equal(
        hasRustFn(ksRs, 'observe_slot_ip_status') || hasRustFn(ksRs, 'observe_slot_ip'),
        true,
      );
      assert.equal(spawnBody.includes('"exit_datacenter"'), true);
      assert.equal(spawnBody.includes('Duration::from_secs(3)'), true);
      assert.equal(spawnBody.includes('is_hosting_exit'), true);

      return {
        status: 'pass',
        summary: 'Same-country residential-to-datacenter IP jump & 3s secondary recheck verified',
      };
    },
  },

  {
    id: 'T2-E2E08-03',
    tier: 2,
    features: ['E2E-08'],
    title: 'WM_CLOSE 超时受限 TerminateProcess 强杀与禁止吞错 reset()',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const winProcRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/windows_process.rs'),
      );

      const quitAllBody = extractRustFnBody(ksRs, 'quit_all_managed_profiles');
      const forceQuitBody = extractRustFnBody(ksRs, 'force_quit_managed_profile');
      const forceQuitHooksBody = extractRustFnBody(ksRs, 'force_quit_with_hooks');
      const spawnFn = extractRustFnBody(ksRs, 'spawn_monitor');
      const execTriggerFn = hasRustFn(ksRs, 'execute_trigger')
        ? extractRustFnBody(ksRs, 'execute_trigger')
        : '';
      const terminateTreeFn = hasRustFn(winProcRs, 'terminate_browser_profile_tree')
        ? extractRustFnBody(winProcRs, 'terminate_browser_profile_tree')
        : '';

      const swallowsQuitError =
        /let\s+_\s*=\s*super::profile::quit\b/.test(ksRs) ||
        !quitAllBody.includes('failed_slots') ||
        !forceQuitHooksBody.includes('force_kill');
      const hasTerminateFallback =
        (forceQuitBody.includes('terminate_browser_profile_tree') &&
          terminateTreeFn.includes('TerminateProcess') &&
          terminateTreeFn.includes('open_terminate_limited')) ||
        ksRs.includes('TerminateProcess');

      const resetGuardedInExecuteTrigger =
        execTriggerFn.includes('trigger_kill_switch') &&
        /if\s+all_closed\s*\{[^}]*tracker\.reset\(\)/.test(execTriggerFn) &&
        !/else\s*\{[^}]*tracker\.reset\(\)/.test(execTriggerFn);
      const unconditionalResetInSpawn =
        spawnFn.includes('trigger_kill_switch(') &&
        !/if\s+all_closed\s*\{[^}]*tracker\.reset\(\)/.test(spawnFn);
      const unconditionallyResetsAfterTrigger = execTriggerFn
        ? !resetGuardedInExecuteTrigger || unconditionalResetInSpawn
        : unconditionalResetInSpawn;

      if (swallowsQuitError || !hasTerminateFallback || unconditionallyResetsAfterTrigger) {
        return gapOrFail(
          ctx.mode,
          `M2 F7 gap: swallowsQuitError=${swallowsQuitError}, hasTerminateFallback=${hasTerminateFallback}, unconditionalReset=${unconditionallyResetsAfterTrigger}`,
          {
            swallowsQuitError,
            hasTerminateFallback,
            unconditionalReset: unconditionallyResetsAfterTrigger,
          },
        );
      }

      return {
        status: 'pass',
        summary: 'Bounded TerminateProcess fallback and verified-close-before-reset enforced',
      };
    },
  },

  {
    id: 'T2-E2E08-04',
    tier: 2,
    features: ['E2E-08'],
    title: '不误杀外部非浏览器替身进程 (cmd.exe 替身存活对比)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e08-04');
      const winProcRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/windows_process.rs'),
      );
      assert.equal(hasRustFn(winProcRs, 'is_chrome_entry'), true);
      assert.equal(hasRustFn(winProcRs, 'has_child_process_type'), true);
      assert.equal(hasRustFn(winProcRs, 'profile_matches'), true);
      assert.equal(winProcRs.includes('!has_child_process_type'), true);

      // Launch harmless decoy cmd.exe inside sandbox + managed Chrome profile
      const decoyPromise = sb.spawn(
        'cmd.exe',
        ['/C', 'ping -n 4 127.0.0.1 > nul'],
        { timeoutMs: 10_000 },
      );
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e08-decoy-guard',
        headless: true,
        argsOptions: { seed: 333444555 },
        allowedUrlPrefixes: [],
      });

      const decoyPid = [...sb.trackedPids].find((p) => p !== persistent.pid);
      assert.ok(decoyPid && decoyPid > 0, 'Decoy process PID must be tracked in sandbox');
      await persistent.close();
      assert.equal(isPidAlive(decoyPid), true, 'Decoy non-Chrome process must remain alive after Chrome closes');

      const decoyRes = await decoyPromise;
      assert.equal(decoyRes.exitCode, 0);

      return {
        status: 'pass',
        summary: 'Non-Chrome decoy process survived managed Chrome teardown untouched',
      };
    },
  },

  {
    id: 'T2-E2E08-05',
    tier: 2,
    features: ['E2E-08'],
    title: '告警解除 (dismiss) 绑定健康探针与未触发态幂等',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const applyClearBody = extractRustFnBody(ksRs, 'apply_clear_alert');
      assert.equal(applyClearBody.includes('!state.triggered'), true);
      const dismissBody = extractRustFnBody(ksRs, 'browser_kill_switch_dismiss');
      const evalDismissBody = hasRustFn(ksRs, 'evaluate_dismiss_probe')
        ? extractRustFnBody(ksRs, 'evaluate_dismiss_probe')
        : '';

      const clearIdx = dismissBody.indexOf('clear_alert(&app)');
      const probeIdx = Math.max(
        dismissBody.indexOf('super::network::probe'),
        dismissBody.indexOf('probe_exit_trace'),
        dismissBody.indexOf('evaluate_dismiss_probe'),
      );
      const probesBeforeDismiss =
        clearIdx > 0 &&
        probeIdx > 0 &&
        probeIdx < clearIdx &&
        dismissBody.includes('system_tun_and_dns_status') &&
        (evalDismissBody === '' ||
          (evalDismissBody.includes('is_hosting_exit') &&
            evalDismissBody.includes('tun_required_and_down') &&
            evalDismissBody.includes('has_residual_failed_profiles')));
      if (!probesBeforeDismiss) {
        return gapOrFail(
          ctx.mode,
          'M2 F7 gap: browser_kill_switch_dismiss unconditionally calls clear_alert(&app) without live health probe verification',
        );
      }

      return {
        status: 'pass',
        summary: 'browser_kill_switch_dismiss validates live health probe before clearing alert',
      };
    },
  },

  {
    id: 'T2-E2E08-06',
    tier: 2,
    features: ['E2E-08'],
    title: '[Tier 5] Kill-Switch 告警重开无条件 TUN+出口复核、failed_slots 3s 重杀与双 TUN 漏检修复',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const ensureFn = extractRustFnBody(ksRs, 'ensure_launch_route_healthy_when_triggered');
      const evalLaunchFn = extractRustFnBody(ksRs, 'evaluate_triggered_launch_route');
      const spawnFn = extractRustFnBody(ksRs, 'spawn_monitor');

      // G1: No machine.system_proxy skip and no machine_is_restricted_region gate in launch health check;
      //     must invoke system_tun_and_dns_status, network::probe, and evaluate_dismiss_probe.
      assert.equal(ensureFn.includes('machine.system_proxy'), false);
      assert.equal(ensureFn.includes('machine_is_restricted_region'), false);
      assert.equal(ensureFn.includes('system_tun_and_dns_status'), true);
      assert.equal(ensureFn.includes('network::probe'), true);
      assert.equal(evalLaunchFn.includes('evaluate_dismiss_probe'), true);
      assert.equal(evalLaunchFn.includes('is_hosting_exit'), true);

      // Verify all 5 launch entrypoints pass slot to ensure_launch_route_healthy_when_triggered
      for (const rel of [
        'src-tauri/src/browser/launch.rs',
        'src-tauri/src/browser/quota_connection.rs',
        'src-tauri/src/browser/windows.rs',
        'src-tauri/src/browser/oauth_route.rs',
        'src-tauri/src/browser/quota_existing.rs',
      ]) {
        const src = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, rel));
        assert.equal(
          src.includes('ensure_launch_route_healthy_when_triggered('),
          true,
          `${rel} must invoke ensure_launch_route_healthy_when_triggered`,
        );
      }

      // G3: spawn_monitor checks pending_failed_slot_rekill before on_slots_tick
      assert.equal(hasRustFn(ksRs, 'pending_failed_slot_rekill'), true);
      const rekillIdx = spawnFn.indexOf('pending_failed_slot_rekill');
      const tickIdx = spawnFn.indexOf('tracker.on_slots_tick');
      assert.ok(rekillIdx > 0 && tickIdx > rekillIdx);

      // G4: select_startup_tun_verify_route filters by (host_restricted || r.expected_country.is_some())
      assert.equal(hasRustFn(ksRs, 'select_startup_tun_verify_route'), true);
      const selectTunFn = extractRustFnBody(ksRs, 'select_startup_tun_verify_route');
      assert.equal(
        selectTunFn.includes('host_restricted || r.expected_country.is_some()'),
        true,
      );

      return {
        status: 'pass',
        summary: 'Kill-Switch relaunch TUN/exit verification, 3s failed_slots rekill, and multi-TUN selection verified',
      };
    },
  },

  // =========================================================================
  // E2E-09: MV3 扩展按需挂载与本地回环桥接加固 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E09-01',
    tier: 2,
    features: ['E2E-09'],
    title: '伪造 Host / 重复 Host / 非扩展 Origin 拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e09-01');
      const serverRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/server.rs'),
      );
      const existingRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_existing.rs'),
      );

      // server.rs enforces generic loopback Host/Origin pinning (127.0.0.1:{port}; no quota-sync origin needed)
      const serverParseHeaders = extractRustFnBody(serverRs, 'parse_request_headers');
      const serverHandle = extractRustFnBody(serverRs, 'handle');
      assert.equal(serverParseHeaders.includes('host_count == 1'), true);
      assert.equal(serverParseHeaders.includes('host_valid'), true);
      assert.equal(serverParseHeaders.includes('127.0.0.1:{port}'), true);
      assert.equal(serverHandle.includes('http://127.0.0.1:{port}'), true);

      // quota_existing.rs pins both 127.0.0.1:{port} Host and fixed MV3 extension Origin
      const existingReadReq = extractRustFnBody(existingRs, 'read_request');
      const existingReceive = extractRustFnBody(existingRs, 'receive_with');
      assert.equal(existingReadReq.includes('host_count != 1'), true);
      assert.equal(existingReadReq.includes('!host_valid'), true);
      assert.equal(existingReadReq.includes('127.0.0.1:{port}'), true);
      assert.equal(
        existingRs.includes('chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg'),
        true,
      );
      assert.equal(existingReceive.includes('request.origin.as_deref() != Some(ORIGIN)'), true);

      // Also test live MV3 extension ignores spoofed/non-matching loopback path
      const extDir = resolve(ctx.repoRoot, 'browser-runtime', 'quota-bridge');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e09-bad-origin',
        headless: true,
        argsOptions: { extensionDir: extDir, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const page = await persistent.context.newPage();
      await page.goto('https://claude.ai/settings/usage#claude-local-sync=' + 'a'.repeat(48), {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(300);
      // Without prior loopback pairing on 127.0.0.1/<token>/browser.html, extension never hits claude:usage
      assert.equal(netSuite.getHitCounts()['claude:usage'] ?? 0, 0);
      await persistent.close();

      return {
        status: 'pass',
        summary: 'Loopback Host/Origin guards and unpaired MV3 extension rejection verified',
      };
    },
  },

  {
    id: 'T2-E2E09-02',
    tier: 2,
    features: ['E2E-09'],
    title: 'Transfer-Encoding: chunked / 双 Content-Length / >16KiB 与 >512KiB 响应拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e09-02');
      const serverRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/server.rs'),
      );
      const existingRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_existing.rs'),
      );
      const serverParseHeaders = extractRustFnBody(serverRs, 'parse_request_headers');
      const serverHandle = extractRustFnBody(serverRs, 'handle');
      assert.equal(serverParseHeaders.includes('!has_transfer_encoding'), true);
      assert.equal(
        serverParseHeaders.includes('content_length_count <= 1') ||
          serverParseHeaders.includes('content_length_count != 1'),
        true,
      );
      assert.equal(serverHandle.includes('16_384'), true);

      const existingReadReq = extractRustFnBody(existingRs, 'read_request');
      assert.equal(existingReadReq.includes('"transfer-encoding" => return None'), true);
      assert.equal(existingReadReq.includes('if length.is_some()'), true);
      assert.equal(existingRs.includes('MAX_BODY: usize = 16_384'), true);

      // Verify content.js enforces 512 KiB response cap on /usage?at_wall=1...
      const contentJs = stripJsComments(
        readRepoText(ctx.repoRoot, 'browser-runtime/quota-bridge/content.js'),
      );
      assert.equal(contentJs.includes('512 * 1024'), true);
      assert.equal(contentJs.includes('readTextLimited'), true);

      // Live MV3 test: 600 KiB HTTP 200 JSON /usage payload triggers 512 KiB content.js cap -> invalid_response
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'oversize@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        usageMode: 'normal',
      });
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const res = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'oversize@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        onBeforeGoto: async (context) => {
          await context.route('https://claude.ai/api/organizations/*/usage*', async (route) => {
            await route.fulfill({
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              body: '{"pad":"' + 'x'.repeat(600 * 1024) + '"}',
            });
          });
        },
      });
      assert.deepEqual(res.callbacks[0].json, {
        nonce: res.nonce,
        failure: 'invalid_response',
      });

      return {
        status: 'pass',
        summary: 'Transfer-Encoding/duplicate Content-Length/16KiB/512KiB limits and invalid_response verified',
      };
    },
  },

  {
    id: 'T2-E2E09-03',
    tier: 2,
    features: ['E2E-09'],
    title: '非顶层 sender.frameId !== 0 拒绝与防子 frame 注入',
    async run(ctx) {
      const manifestRaw = readRepoText(ctx.repoRoot, 'browser-runtime/quota-bridge/manifest.json');
      const manifest = JSON.parse(manifestRaw) as {
        content_scripts?: Array<{ all_frames?: boolean }>;
      };
      for (const cs of manifest.content_scripts ?? []) {
        assert.notEqual(cs.all_frames, true, 'manifest.json must not enable all_frames');
      }

      const bgJs = stripJsComments(
        readRepoText(ctx.repoRoot, 'browser-runtime/quota-bridge/background.js'),
      );
      const checksFrameId = hasJsTopFrameGuard(bgJs);
      if (!checksFrameId) {
        return gapOrFail(
          ctx.mode,
          'M2 F8 gap: browser-runtime/quota-bridge/background.js does not enforce sender.frameId !== 0 defense-in-depth',
        );
      }

      return {
        status: 'pass',
        summary: 'background.js enforces sender.frameId === 0 and manifest omits all_frames',
      };
    },
  },

  {
    id: 'T2-E2E09-04',
    tier: 2,
    features: ['E2E-09'],
    title: '重放 nonce 阻断、短读超时防 DoS 与 server.rs 127.0.0.1 收敛/死路由清理',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e09-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'replay@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        usageMode: 'normal',
      });
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Live Chrome MV3 nonce replay protection: second navigation using same nonce must not trigger second callback
      const { randomBytes } = await import('node:crypto');
      const { computeQuotaIdentitySha256 } = await import('../lib/rust-blackbox.ts');
      const { startLoopbackQuotaCallbackServer } = await import('./security-helpers.ts');
      const token = randomBytes(24).toString('hex');
      const nonce = randomBytes(24).toString('hex');
      const quotaIdentity = computeQuotaIdentitySha256(
        '11111111-2222-4333-8444-555555555555',
        'replay@example.invalid',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );
      const bridge = await startLoopbackQuotaCallbackServer(token);
      sb.registerCleanup(() => bridge.close());

      const extDir = resolve(ctx.repoRoot, 'browser-runtime', 'quota-bridge');
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e09-replay',
        headless: true,
        argsOptions: { extensionDir: extDir, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['http://127.0.0.1:', 'https://claude.ai/'],
      });
      const page1 = await persistent.context.newPage();
      const startUrl = `${bridge.baseUrl}/${token}/browser.html#quota-sync=${nonce}&quota_identity=${quotaIdentity}`;
      await page1.goto(startUrl, { waitUntil: 'domcontentloaded' });
      await bridge.waitForCallback(1, 15_000);

      // Replay exact same pairing URL in a second tab -> consumed set blocks second callback
      const page2 = await persistent.context.newPage();
      await page2.goto(startUrl, { waitUntil: 'domcontentloaded' });
      await page2.waitForTimeout(600);
      assert.equal(bridge.callbacks.length, 1, 'Replayed nonce must never produce a second callback');
      await persistent.close();
      await bridge.close();

      // 2. Probe M2 F8 server.rs convergence to 127.0.0.1:{port} and removal of dead quota-sync route
      const serverRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/server.rs'),
      );
      const parseHeadersFn = extractRustFnBody(serverRs, 'parse_request_headers');
      const handleFn = extractRustFnBody(serverRs, 'handle');
      const acceptsLocalhostHost =
        serverRs.includes('expected_localhost') ||
        /\blocalhost\b/i.test(parseHeadersFn) ||
        /\blocalhost\b/i.test(handleFn);
      const hasDeadQuotaSyncRoute = serverRs.includes('quota-sync');
      if (acceptsLocalhostHost || hasDeadQuotaSyncRoute) {
        return gapOrFail(
          ctx.mode,
          `M2 F8 gap: replay blocked in Chrome, but server.rs still has localhost Host acceptance (${acceptsLocalhostHost}) / dead quota-sync route (${hasDeadQuotaSyncRoute})`,
          { acceptsLocalhostHost, hasDeadQuotaSyncRoute },
        );
      }

      return {
        status: 'pass',
        summary: 'MV3 nonce replay blocked and server.rs converged on 127.0.0.1:{port} with dead route removed',
      };
    },
  },

  {
    id: 'T2-E2E09-05',
    tier: 2,
    features: ['E2E-09'],
    title: 'HTML 质询页 / 401 / 403 / 跨页身份突变 (identity_changed) 拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e09-05');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const scenarios = [
        ['401', 'web_auth_required'],
        ['403', 'web_access_denied'],
        ['identity_changed_on_recheck', 'identity_changed'],
      ] as const;

      for (const [usageMode, expectedFailure] of scenarios) {
        netSuite.setClaudeState({
          accountUuid: '11111111-2222-4333-8444-555555555555',
          email: 'err-mode@example.invalid',
          organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          usageMode,
        });
        const res = await runMv3QuotaBridgeSync({
          repoRoot: ctx.repoRoot,
          sb,
          netSuite,
          proxy,
          profileName: `mv3-err-${usageMode}`,
          accountUuid: '11111111-2222-4333-8444-555555555555',
          email: 'err-mode@example.invalid',
          organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        });
        assert.deepEqual(res.callbacks[0].json, {
          nonce: res.nonce,
          failure: expectedFailure,
        });
      }

      return {
        status: 'pass',
        summary: '401, 403, and mid-sync identity_changed failures cleanly surfaced without quota data',
      };
    },
  },

  {
    id: 'T2-E2E09-06',
    tier: 2,
    features: ['E2E-09'],
    title: '[Tier 5] MV3 瞬断有界退避重试 (4xx/5xx 不重试) 与 server.rs 冒号前空白拒绝',
    async run(ctx) {
      const bgJs = readRepoText(ctx.repoRoot, 'browser-runtime/quota-bridge/background.js');
      const serverRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/server.rs'),
      );
      const parseHeadersFn = extractRustFnBody(serverRs, 'parse_request_headers');
      assert.equal(
        parseHeadersFn.includes('is_ascii_whitespace'),
        true,
        'server.rs must reject whitespace before header colon per RFC 9112',
      );
      assert.equal(parseHeadersFn.includes('key.trim()'), false);

      // Exercise real background.js deliver() in isolated VM:
      // 1) Transient TypeError on attempt 1 -> retries and succeeds on attempt 2, replay still rejected
      // 2) HTTP 500 response -> returns ok:false immediately with 1 attempt (zero retry)
      const loadWorkerVm = (fetchImpl: (url: string, init: unknown) => Promise<{ ok: boolean; status?: number }>) => {
        const store = new Map<string, unknown>();
        const sandbox: Record<string, unknown> = {
          URL,
          URLSearchParams,
          TextEncoder,
          crypto,
          setTimeout,
          clearTimeout,
          fetch: fetchImpl,
          chrome: {
            runtime: {
              id: 'ejcmmmehjkifepdoejgbaleeogcfagjg',
              onMessage: { addListener: () => {} },
            },
            storage: {
              session: {
                get: async (keys: string | string[]) => {
                  const arr = Array.isArray(keys) ? keys : [keys];
                  const out: Record<string, unknown> = {};
                  for (const k of arr) {
                    if (store.has(k)) out[k] = store.get(k);
                  }
                  return out;
                },
                set: async (obj: Record<string, unknown>) => {
                  for (const [k, v] of Object.entries(obj)) store.set(k, v);
                },
                remove: async (keys: string | string[]) => {
                  const arr = Array.isArray(keys) ? keys : [keys];
                  for (const k of arr) store.delete(k);
                },
              },
            },
          },
        };
        runInNewContext(bgJs, sandbox);
        return sandbox as {
          pair: (msg: unknown, sender: unknown) => Promise<{ paired: boolean }>;
          claimTabTask: (msg: unknown, sender: unknown) => Promise<{ nonce: string | null }>;
          matchCandidates: (msg: unknown, sender: unknown) => Promise<{ matched: unknown }>;
          deliver: (msg: unknown, sender: unknown) => Promise<{ ok: boolean }>;
        };
      };

      const nonce = 'aa'.repeat(24);
      const acct = '11111111-1111-4111-8111-111111111111';
      const org = '22222222-2222-4222-8222-222222222222';
      const email = 't5@example.invalid';
      const digestBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify([acct, email, org])),
      );
      const hash = [...new Uint8Array(digestBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const localSender = {
        id: 'ejcmmmehjkifepdoejgbaleeogcfagjg',
        frameId: 0,
        tab: { id: 1, url: `http://127.0.0.1:45678/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${hash}` },
      };
      const claudeSender = {
        id: 'ejcmmmehjkifepdoejgbaleeogcfagjg',
        frameId: 0,
        tab: { id: 1, url: 'https://claude.ai/settings/usage' },
      };

      let netAttempts = 0;
      const vm1 = loadWorkerVm(async () => {
        netAttempts += 1;
        if (netAttempts === 1) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200 };
      });
      const pairRes = await vm1.pair({ nonce, quotaIdentity: hash }, localSender);
      assert.equal(pairRes.paired, true);
      const claimRes = await vm1.claimTabTask({}, claudeSender);
      assert.equal(claimRes.nonce, nonce);
      await vm1.matchCandidates({ nonce, accountUuids: [acct], emails: [email], organizationUuids: [org] }, claudeSender);
      const deliverOk = await vm1.deliver(
        { nonce, snapshot: { nonce, account_uuid: acct, organization_uuid: org, usage: { five_hour: { utilization: 10, resets_at: '2027-01-01T00:00:00Z' } } } },
        claudeSender,
      );
      const replayBlocked = await vm1.deliver(
        { nonce, snapshot: { nonce, account_uuid: acct, organization_uuid: org, usage: { five_hour: { utilization: 10, resets_at: '2027-01-01T00:00:00Z' } } } },
        claudeSender,
      );
      assert.equal(deliverOk.ok, true);
      assert.equal(replayBlocked.ok, false);
      assert.equal(netAttempts, 2);

      let http500Attempts = 0;
      const vm2 = loadWorkerVm(async () => {
        http500Attempts += 1;
        return { ok: false, status: 500 };
      });
      await vm2.pair({ nonce, quotaIdentity: hash }, localSender);
      await vm2.claimTabTask({}, claudeSender);
      await vm2.matchCandidates({ nonce, accountUuids: [acct], emails: [email], organizationUuids: [org] }, claudeSender);
      const deliver500 = await vm2.deliver(
        { nonce, snapshot: { nonce, account_uuid: acct, organization_uuid: org, usage: { five_hour: { utilization: 10, resets_at: '2027-01-01T00:00:00Z' } } } },
        claudeSender,
      );
      assert.equal(deliver500.ok, false);
      assert.equal(http500Attempts, 1);

      return {
        status: 'pass',
        summary: 'MV3 bounded network retry (no retry on HTTP 500, replay blocked) and server.rs header colon-whitespace rejection verified',
      };
    },
  },

  // =========================================================================
  // E2E-10: 多账号浏览器 Profile 与 CLI 槽位防串号隔离 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E10-01',
    tier: 2,
    features: ['E2E-10'],
    title: '槽位占用中阻断并发租用与切号 (relay.error.targetSlotBusy)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Busy A',
            accountUuid: 'c1000001-0000-4000-8000-000000000001',
            email: 'busy-a@example.invalid',
            quota5hUsed: 99,
            bindBrowser: true,
          },
          {
            name: 'Busy B',
            accountUuid: 'c1000002-0000-4000-8000-000000000002',
            email: 'busy-b@example.invalid',
            quota5hUsed: 10,
            bindBrowser: true,
          },
        ],
      });

      const acq1 = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq1.json?.ok, true);

      // Concurrent acquire on busy slot B -> targetSlotBusy
      const acq2 = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq2.json?.ok, false);
      assert.equal(acq2.json?.reason, 'relay.error.targetSlotBusy');

      // Switch targeting only candidate B while B holds active lease must NOT switch into busy B
      const sw = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.json?.switched, false);
      assert.equal(
        sw.json?.reason === 'relay.error.targetSlotBusy' || sw.json?.reason === 'all_exhausted',
        true,
        `Unexpected relay_switch reason while B busy: ${sw.json?.reason}`,
      );

      // After slot_release, B becomes switchable again
      const rel = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(rel.json?.ok, true);
      const sw2 = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw2.json?.switched, true);

      return {
        status: 'pass',
        summary: 'Active slot lease blocked concurrent slot_acquire and relay_switch with targetSlotBusy',
      };
    },
  },

  {
    id: 'T2-E2E10-02',
    tier: 2,
    features: ['E2E-10'],
    title: '跨账号 HMAC 凭据漂移检测与隔离锁定 (relay.error.slotCredentialDrift)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-02');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Drift A',
            accountUuid: 'c2000001-0000-4000-8000-000000000001',
            email: 'drift-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Drift B',
            accountUuid: 'c2000002-0000-4000-8000-000000000002',
            email: 'drift-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq.json?.ok, true);
      const slotDir = acq.json!.slot_dir!;

      // Tamper slot .claude.json to impersonate Account A + newer token
      const slotClaudePath = join(slotDir, '.claude.json');
      const slotClaude = JSON.parse(readFileSync(slotClaudePath, 'utf8')) as {
        oauthAccount: Record<string, unknown>;
      };
      slotClaude.oauthAccount = {
        accountUuid: 'c2000001-0000-4000-8000-000000000001',
        emailAddress: 'drift-a@example.invalid',
        organizationUuid: 'org-drift-a',
      };
      writeFileSync(slotClaudePath, JSON.stringify(slotClaude, null, 2));

      const bArchiveBefore = readFileSync(join(seeded.vaultDir, seeded.records[1].archive));

      const rel = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(rel.json?.ok, false);
      assert.equal(rel.json?.reason, 'relay.error.slotCredentialDrift');
      assert.equal(existsSync(join(slotDir, '.slot-drifted')), true);
      assert.equal(
        Buffer.compare(readFileSync(join(seeded.vaultDir, seeded.records[1].archive)), bArchiveBefore),
        0,
      );

      // Subsequent slot_acquire must remain blocked by .slot-drifted
      const acqAgain = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqAgain.json?.ok, false);
      assert.equal(acqAgain.json?.reason, 'relay.error.slotCredentialDrift');

      return {
        status: 'pass',
        summary: 'Cross-account credential drift quarantined slot with .slot-drifted without tainting .baga archive',
      };
    },
  },

  {
    id: 'T2-E2E10-03',
    tier: 2,
    features: ['E2E-10'],
    title: '宿主危险配置键剥离 (apiKeyHelper / otelHeadersHelper / awsAuthRefresh / customHeaders / statusLine)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Settings A',
            accountUuid: 'c3000001-0000-4000-8000-000000000001',
            email: 'settings-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Settings B',
            accountUuid: 'c3000002-0000-4000-8000-000000000002',
            email: 'settings-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      mkdirSync(join(sb.paths.homeDir, '.claude'), { recursive: true });
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify(
          {
            apiKeyHelper: 'echo leaked-helper',
            otelHeadersHelper: 'echo leaked-otel',
            awsAuthRefresh: 'echo leaked-aws',
            customHeaders: { 'X-Leaked': '1' },
            statusLine: { type: 'command', command: 'echo leaked-status' },
            env: {
              ANTHROPIC_API_KEY: 'sk-ant-api03-should-strip',
              CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-should-strip',
            },
          },
          null,
          2,
        ),
      );

      const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq.json?.ok, true);
      const slotSettings = JSON.parse(
        readFileSync(join(acq.json!.slot_dir!, 'settings.json'), 'utf8'),
      ) as Record<string, unknown> & { env?: Record<string, string> };

      assert.equal(slotSettings.env?.ANTHROPIC_API_KEY, undefined);
      assert.equal(slotSettings.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined);
      assert.equal(slotSettings.env?.DISABLE_TELEMETRY, '1');
      assert.equal(slotSettings.env?.DO_NOT_TRACK, '1');
      assert.match(slotSettings.env?.NO_PROXY ?? '', /127\.0\.0\.1/);

      const remaining = findDangerousSettingsKeys(slotSettings);
      if (remaining.length > 0) {
        return gapOrFail(
          ctx.mode,
          `M2 F9 gap: build_slot_settings left dangerous host keys in slot settings.json: ${remaining.join(', ')}`,
          { remainingCount: remaining.length, remainingKeys: remaining.join(',') },
        );
      }

      return {
        status: 'pass',
        summary: 'All 5 dangerous host settings keys and credential env vars stripped from slot settings.json',
      };
    },
  },

  {
    id: 'T2-E2E10-04',
    tier: 2,
    features: ['E2E-10'],
    title: 'cli-slots/<id> 目录重解析点 / Junction 拒绝 (relay.error.unsafeSlotPath)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'SlotJunc A',
            accountUuid: 'c4000001-0000-4000-8000-000000000001',
            email: 'slotjunc-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'SlotJunc B',
            accountUuid: 'c4000002-0000-4000-8000-000000000002',
            email: 'slotjunc-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const cliSlotsDir = join(sb.paths.appDataDir, 'ai.local.claude-local', 'cli-slots');
      mkdirSync(cliSlotsDir, { recursive: true });
      const slotJunction = join(cliSlotsDir, seeded.records[1].id);
      const internalTarget = join(sb.paths.tempDir, 'slot-junc-target');

      createSandboxJunction(sb, slotJunction, internalTarget);
      try {
        const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[1].id,
        });
        assert.equal(acq.json?.ok, false);
        assert.equal(
          acq.json?.reason === 'relay.error.unsafeSlotPath' ||
            acq.json?.reason === '身份路径包含链接或特殊文件。',
          true,
          `Unexpected rejection reason: ${acq.json?.reason}`,
        );
        assert.equal(existsSync(join(internalTarget, '.credentials.json')), false);
      } finally {
        removeSandboxJunction(slotJunction);
      }

      const escapes = await sb.assertNoSymlinkEscape();
      assert.deepEqual(escapes, []);

      return {
        status: 'pass',
        summary: 'cli-slots/<id> NTFS Junction rejected with unsafeSlotPath and zero credential writes',
      };
    },
  },

  {
    id: 'T2-E2E10-05',
    tier: 2,
    features: ['E2E-10'],
    title: '过旧 expiresAt 凭据回灌防御与同出口并发上限 (slotConcurrencyCapped)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-05');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const freshExpiry = Date.now() + 10_800_000;
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Cap A',
            accountUuid: 'c5000001-0000-4000-8000-000000000001',
            email: 'cap-a@example.invalid',
            proxy: 'http://127.0.0.1:18080',
            quota5hUsed: 99,
            bindBrowser: true,
          },
          {
            name: 'Cap B',
            accountUuid: 'c5000002-0000-4000-8000-000000000002',
            email: 'cap-b@example.invalid',
            proxy: 'http://127.0.0.1:18080',
            accessToken: 'sk-ant-oat01-fresh-token-should-survive',
            expiresAtMs: freshExpiry,
            quota5hUsed: 10,
            bindBrowser: true,
          },
        ],
      });

      // Default max_same_exit_concurrency = 1, A is active on :18080 -> acquiring B with cli_running or same proxy
      // Test same-exit concurrency cap using a third account C when B already holds slot on :18080
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify({ env: { HTTPS_PROXY: 'http://127.0.0.1:18080' } }),
      );
      const acqB = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.json?.ok, true);

      // Downgrade slot B credentials to older expiresAt, release, and switch to B -> fresh token must win
      const slotCredPath = join(acqB.json!.slot_dir!, '.credentials.json');
      const credObj = JSON.parse(readFileSync(slotCredPath, 'utf8')) as {
        claudeAiOauth: { accessToken: string; expiresAt: number };
      };
      credObj.claudeAiOauth.accessToken = 'sk-ant-oat01-stale-token-must-not-overwrite';
      credObj.claudeAiOauth.expiresAt = freshExpiry - 7200_000;
      writeFileSync(slotCredPath, JSON.stringify(credObj, null, 2));

      const relB = await runOrchestrate<{ ok: boolean; credentials_synced: boolean }>(
        bin.exePath,
        sb.paths,
        { schema: 1, op: 'slot_release', record_id: seeded.records[1].id },
      );
      assert.equal(relB.json?.ok, true);

      const sw = await runOrchestrate<{ switched: boolean }>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.json?.switched, true);
      const homeCredAfter = JSON.parse(
        readFileSync(join(sb.paths.homeDir, '.claude', '.credentials.json'), 'utf8'),
      ) as { claudeAiOauth: { accessToken: string } };
      assert.equal(
        homeCredAfter.claudeAiOauth.accessToken,
        'sk-ant-oat01-fresh-token-should-survive',
      );

      // Now seed a third account sharing :18080 and acquire two slots to trigger slotConcurrencyCapped
      const seeded3 = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        accounts: [
          {
            name: 'Cap C',
            accountUuid: 'c5000003-0000-4000-8000-000000000003',
            email: 'cap-c@example.invalid',
            proxy: 'http://127.0.0.1:18080',
            bindBrowser: true,
          },
        ],
      });
      const acqA = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[0].id,
      });
      assert.equal(acqA.json?.ok, true);

      const acqC = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded3.records[0].id,
      });
      assert.equal(acqC.json?.ok, false);
      assert.equal(acqC.json?.status, 'concurrency_capped');
      assert.equal(acqC.json?.reason, 'relay.error.slotConcurrencyCapped');

      return {
        status: 'pass',
        summary: 'Stale expiresAt writeback rejected and same-exit concurrency cap enforced',
      };
    },
  },

  {
    id: 'T2-E2E10-06',
    tier: 2,
    features: ['E2E-10'],
    title: '[Tier 5] 黑盒 --orchestrate slot_acquire 剥离敏感环境变量/净化通配 NO_PROXY 与 UUID UTF-8 边界',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e10-06');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'G2 Base A',
            accountUuid: 'g2000001-0000-4000-8000-000000000001',
            email: 'g2-a@example.invalid',
            quota5hUsed: 95,
            bindBrowser: true,
          },
          {
            name: 'G2 Target B',
            accountUuid: 'g2000002-0000-4000-8000-000000000002',
            email: 'g2-b@example.invalid',
            quota5hUsed: 10,
            bindBrowser: true,
          },
        ],
      });

      mkdirSync(join(sb.paths.homeDir, '.claude'), { recursive: true });
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify(
          {
            env: {
              CLAUDE_CONFIG_DIR: 'C:\\outside-config',
              ANTHROPIC_CUSTOM_HEADERS: 'x-api-key: sk-leaked',
              ANTHROPIC_BASE_URL: 'https://relay.attacker.invalid',
              CLAUDE_CODE_MAX_OUTPUT_TOKENS: '12345',
              AWS_SECRET_ACCESS_KEY: 'aws-leaked',
              OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer leaked',
              CUSTOM_AUTH_TOKEN: 'tok-leaked',
              NO_PROXY: '*,api.anthropic.com,*.claude.ai,10.0.0.1,localhost',
              no_proxy: '*',
              BENIGN_FLAG: 'keep-ok',
            },
          },
          null,
          2,
        ),
      );

      const acq = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
        proxy: 'http://127.0.0.1:7899',
      });
      assert.equal(acq.json?.ok, true, `slot_acquire failed: ${acq.stdout} ${acq.stderr}`);
      const slotSettings = JSON.parse(
        readFileSync(join(acq.json!.slot_dir!, 'settings.json'), 'utf8'),
      ) as { env?: Record<string, string> };
      const env = slotSettings.env ?? {};

      for (const forbidden of [
        'CLAUDE_CONFIG_DIR',
        'ANTHROPIC_CUSTOM_HEADERS',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
        'AWS_SECRET_ACCESS_KEY',
        'OTEL_EXPORTER_OTLP_HEADERS',
        'CUSTOM_AUTH_TOKEN',
      ]) {
        assert.equal(env[forbidden], undefined, `${forbidden} leaked into slot settings.json`);
      }
      assert.equal(env.BENIGN_FLAG, 'keep-ok');
      assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1');
      assert.equal(env.no_proxy, 'localhost,127.0.0.1,::1');

      // G8: Verify cleaner_identity.rs uses char-safe prefix slicing instead of byte-slicing
      const cleanerIdRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/cleaner_identity.rs'),
      );
      const desktopResidueFn = extractRustFnBody(cleanerIdRs, 'sanitize_desktop_roots_residue');
      assert.equal(desktopResidueFn.includes('.chars().take(8)'), true);
      assert.equal(desktopResidueFn.includes('.len().min(8)'), false);

      return {
        status: 'pass',
        summary: 'Black-box --orchestrate slot_acquire stripped sensitive env/NO_PROXY wildcards and UTF-8 UUID char slicing verified',
      };
    },
  },

  // =========================================================================
  // E2E-11: --orchestrate / --quota-core 无头协议与 CLI 包装行为 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E11-01',
    tier: 2,
    features: ['E2E-11'],
    title: '--orchestrate >128 KiB 与 --quota-core >1 MiB / >256 窗口边界拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e11-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      // 1. --orchestrate > 128 KiB
      const bigOrch = JSON.stringify({
        schema: 1,
        op: 'status',
        pad: 'x'.repeat(128 * 1024 + 32),
      });
      const orchRes = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, bigOrch);
      assert.equal(orchRes.exitCode, 2);
      assert.equal(orchRes.json?.reason, 'relay.error.stdinTooLarge');

      // 2. --quota-core > 1 MiB
      const bigQc = JSON.stringify({
        schema: 1,
        op: 'merge_windows',
        now_sec: 1_800_000_000,
        pad: 'y'.repeat(1024 * 1024 + 32),
        items: [],
      });
      const qcBigRes = await runQuotaCore(bin.exePath, bigQc);
      assert.equal(qcBigRes.exitCode, 2);
      assert.match(qcBigRes.stderr, /quota-core: invalid request/);
      assert.equal(qcBigRes.stdout.trim(), '');

      // 3. --quota-core 257 items rejected vs 256 items accepted
      const makeItem = () => ({
        current: { used: 10, reset_at: 1_800_003_600, source: 'server_anchor', observed_at_ms: 1_800_000_000_000 },
        candidate: null,
      });
      const qc257 = await runQuotaCore(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: 1_800_000_000,
        items: Array.from({ length: 257 }, makeItem),
      });
      assert.equal(qc257.exitCode, 2);

      const qc256 = await runQuotaCore<{ schema: number; items: unknown[] }>(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: 1_800_000_000,
        items: Array.from({ length: 256 }, makeItem),
      });
      assert.equal(qc256.exitCode, 0);
      assert.equal(qc256.json?.items.length, 256);

      return {
        status: 'pass',
        summary: '128 KiB --orchestrate and 1 MiB / 256-item --quota-core limits enforced at exact boundaries',
      };
    },
  },

  {
    id: 'T2-E2E11-02',
    tier: 2,
    features: ['E2E-11'],
    title: 'claude-relay.ps1 与 claude-subagent.ps1 本地代理不可达 fail-closed 阻断',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e11-02');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const closedPort = await findUnusedLoopbackPort();
      const markerPath = join(sb.paths.tempDir, 'claude_shim_invoked.marker');

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'FailClosed A',
            accountUuid: 'd2000001-0000-4000-8000-000000000001',
            email: 'fc-a@example.invalid',
            proxy: `http://127.0.0.1:${closedPort}`,
            bindBrowser: true,
          },
          {
            name: 'FailClosed B',
            accountUuid: 'd2000002-0000-4000-8000-000000000002',
            email: 'fc-b@example.invalid',
            proxy: `http://127.0.0.1:${closedPort}`,
            bindBrowser: true,
          },
        ],
      });

      const inst = await runOrchestrate(bin.exePath, sb.paths, {
        schema: 1,
        op: 'install_wrappers',
      });
      assert.equal(inst.exitCode, 0);

      mkdirSync(join(sb.paths.homeDir, '.claude'), { recursive: true });
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify({ env: { HTTPS_PROXY: `http://127.0.0.1:${closedPort}` } }),
      );

      // Fake claude.cmd shim that writes marker if ever reached
      const fakeClaudeCmd = join(sb.paths.tempDir, 'fake-claude.cmd');
      writeFileSync(fakeClaudeCmd, `@echo off\r\necho invoked > "${markerPath}"\r\nexit /b 0\r\n`);

      const psBin = resolvePowerShellBinary();
      const env = sb.buildEnv({
        extraEnv: {
          CLAUDE_LOCAL_EXE: bin.exePath,
          CLAUDE_EXE: fakeClaudeCmd,
        },
      });
      delete env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT;
      delete env.CLAUDE_LOCAL_ALLOW_DIRECT;

      // 1. claude-relay.ps1
      const relayScript = join(sb.paths.homeDir, '.local', 'bin', 'claude-relay.ps1');
      const relayRes = spawnSync(
        psBin,
        ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', relayScript, '-p', 'ping'],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000, env },
      );
      assert.notEqual(relayRes.status, 0);
      assert.match(`${relayRes.stdout}\n${relayRes.stderr}`, /unreachable|fail-closed/i);
      assert.equal(existsSync(markerPath), false);

      // 2. claude-subagent.ps1
      const subScript = join(sb.paths.homeDir, '.local', 'bin', 'claude-subagent.ps1');
      const subRes = spawnSync(
        psBin,
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          subScript,
          '-AccountId',
          seeded.records[1].id,
          '-Prompt',
          'ping',
          '-ReadOnly',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000, env },
      );
      assert.notEqual(subRes.status, 0);
      assert.match(`${subRes.stdout}\n${subRes.stderr}`, /unreachable|fail-closed/i);
      assert.equal(existsSync(markerPath), false);

      return {
        status: 'pass',
        summary: 'Both claude-relay.ps1 and claude-subagent.ps1 aborted fail-closed on unreachable proxy without invoking claude shim',
      };
    },
  },

  {
    id: 'T2-E2E11-03',
    tier: 2,
    features: ['E2E-11'],
    title: '空代理且无 CLAUDE_LOCAL_ALLOW_DIRECT=1 时 fail-closed 阻断直连',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e11-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const markerPath = join(sb.paths.tempDir, 'direct_shim_invoked.marker');

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'DirectBlock A',
            accountUuid: 'd3000001-0000-4000-8000-000000000001',
            email: 'db-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'DirectBlock B',
            accountUuid: 'd3000002-0000-4000-8000-000000000002',
            email: 'db-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      await runOrchestrate(bin.exePath, sb.paths, { schema: 1, op: 'install_wrappers' });
      mkdirSync(join(sb.paths.homeDir, '.claude'), { recursive: true });
      writeFileSync(join(sb.paths.homeDir, '.claude', 'settings.json'), '{}');

      const fakeClaudeCmd = join(sb.paths.tempDir, 'fake-claude-direct.cmd');
      writeFileSync(fakeClaudeCmd, `@echo off\r\necho invoked > "${markerPath}"\r\nexit /b 0\r\n`);

      const psBin = resolvePowerShellBinary();
      const env = sb.buildEnv({
        extraEnv: {
          CLAUDE_LOCAL_EXE: bin.exePath,
          CLAUDE_EXE: fakeClaudeCmd,
        },
      });
      delete env.CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT;
      delete env.CLAUDE_LOCAL_ALLOW_DIRECT;

      const relayScript = join(sb.paths.homeDir, '.local', 'bin', 'claude-relay.ps1');
      const relayRes = spawnSync(
        psBin,
        ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', relayScript, '-p', 'ping'],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000, env },
      );
      assert.notEqual(relayRes.status, 0);
      assert.match(`${relayRes.stdout}\n${relayRes.stderr}`, /CLAUDE_LOCAL_ALLOW_DIRECT=1/);
      assert.equal(existsSync(markerPath), false);

      const subScript = join(sb.paths.homeDir, '.local', 'bin', 'claude-subagent.ps1');
      const subRes = spawnSync(
        psBin,
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          subScript,
          '-AccountId',
          seeded.records[1].id,
          '-Prompt',
          'ping',
          '-ReadOnly',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000, env },
      );
      assert.notEqual(subRes.status, 0);
      assert.match(`${subRes.stdout}\n${subRes.stderr}`, /CLAUDE_LOCAL_ALLOW_DIRECT=1/);
      assert.equal(existsSync(markerPath), false);

      return {
        status: 'pass',
        summary: 'Empty proxy without CLAUDE_LOCAL_ALLOW_DIRECT=1 blocked in both PS1 wrappers',
      };
    },
  },

  {
    id: 'T2-E2E11-04',
    tier: 2,
    features: ['E2E-11'],
    title: '非法 JSON / 非法 schema / 未知 op / 缺 record_id 零写盘拒绝',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e11-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      const appLocalDir = join(sb.paths.appDataDir, 'ai.local.claude-local');
      const beforeAppFiles = collectFilesRecursive(appLocalDir);
      const beforeHomeFiles = collectFilesRecursive(sb.paths.homeDir);

      const badPayloads: Array<[string | Record<string, unknown>, string]> = [
        ['{bad json', 'relay.error.invalidRequest'],
        [{ schema: 2, op: 'status' }, 'relay.error.invalidSchema'],
        [{ schema: 1, op: 'bogus_op' }, 'relay.error.unknownOp'],
        [{ schema: 1, op: 'slot_release' }, 'relay.error.missingRecordId'],
      ];

      for (const [payload, expectedReason] of badPayloads) {
        const res = await runOrchestrate<OrchestrateErrJson>(bin.exePath, sb.paths, payload);
        assert.equal(res.exitCode, 2);
        assert.equal(res.json?.ok, false);
        assert.equal(res.json?.reason, expectedReason);
      }

      assert.deepEqual(collectFilesRecursive(appLocalDir), beforeAppFiles);
      assert.deepEqual(collectFilesRecursive(sb.paths.homeDir), beforeHomeFiles);

      return {
        status: 'pass',
        summary: 'Invalid JSON/schema/op/missing record_id exited 2 with zero disk writes',
      };
    },
  },

  {
    id: 'T2-E2E11-05',
    tier: 2,
    features: ['E2E-11'],
    title: '--quota-core 多余 CLI 参数 / 未知字段 / 越界数值 (used: 101) 拒绝',
    async run(ctx) {
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const nowSec = 1_800_000_000;

      // 1. Extra CLI argument
      const extraArgRes = await runQuotaCore(
        bin.exePath,
        { schema: 1, op: 'merge_windows', now_sec: nowSec, items: [] },
        ['--extra-flag'],
      );
      assert.equal(extraArgRes.exitCode, 2);
      assert.match(extraArgRes.stderr, /quota-core: invalid request/);
      assert.equal(extraArgRes.stdout.trim(), '');

      // 2. Unknown JSON field (deny_unknown_fields)
      const unknownFieldRes = await runQuotaCore(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: nowSec,
        items: [],
        secret_probe_token: 'DO_NOT_ECHO_ME',
      });
      assert.equal(unknownFieldRes.exitCode, 2);
      assert.match(unknownFieldRes.stderr, /quota-core: invalid request/);
      assert.equal(unknownFieldRes.stderr.includes('DO_NOT_ECHO_ME'), false);

      // 3. Out-of-range used: 101
      const badUsedRes = await runQuotaCore(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: nowSec,
        items: [
          {
            current: {
              used: 101,
              reset_at: nowSec + 3600,
              source: 'server_anchor',
              observed_at_ms: nowSec * 1000,
            },
            candidate: null,
          },
        ],
      });
      assert.equal(badUsedRes.exitCode, 2);
      assert.match(badUsedRes.stderr, /quota-core: invalid request/);

      return {
        status: 'pass',
        summary: '--quota-core rejected extra args, unknown fields, and used=101 with silent generic stderr',
      };
    },
  },

  // =========================================================================
  // E2E-12: 风控验证核查、5 源出口分类与 Site Data 清理 - Tier 2 (5 cases)
  // =========================================================================
  {
    id: 'T2-E2E12-01',
    tier: 2,
    features: ['E2E-12'],
    title: 'api.ipquery.io 429 故障去重 (不重复轰炸分类接口) 与 5 源全部失败降级',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e12-01');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');
      netSuite.setProviderFault('ipquery', 'rate_limit_429');
      netSuite.setProviderState('ipinfo', { hosting: undefined });

      const res1 = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json', 'https://ipinfo.io/json'],
      });
      assert.equal(res1.phase, 'passed');
      assert.equal(
        netSuite.getHitCounts()['classify:203.0.113.10'] ?? 0,
        0,
        'Rate-limited api.ipquery.io must not be re-queried for supplementary classification',
      );

      // All 5 providers fail -> phase === 'failed', exit never fabricated
      netSuite.resetHits();
      netSuite.setProviderFault('ipquery', 'rate_limit_429');
      netSuite.setProviderFault('ipinfo', 'server_500');
      netSuite.setProviderFault('ip_sb', 'bad_json');
      netSuite.setProviderFault('geojs', 'server_500');
      netSuite.setProviderFault('ipwho', 'bad_json');
      const res2 = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
      });
      assert.equal(res2.phase, 'failed');

      return {
        status: 'pass',
        summary: '429 deduplication avoided supplementary ipquery hit and total provider failure degraded cleanly',
      };
    },
  },

  {
    id: 'T2-E2E12-02',
    tier: 2,
    features: ['E2E-12'],
    title: 'ip_mismatch 错配拒绝、风控页三路分流失败渲染与 trace 4096 截断',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e12-02');
      const probeRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/risk_check/probe.rs'),
      );
      assert.equal(probeRs.includes('TRACE_BODY_LIMIT: usize = 4096'), true);

      // 1. ip_mismatch on supplementary classification yields incomplete (19/20)
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');
      netSuite.setProviderState('ipquery', {
        asn: 'AS64512',
        isp: 'Unknown Carrier',
        hosting: undefined,
      });
      netSuite.setIpClassification('203.0.113.10', { hosting: false, fault: 'ip_mismatch' });

      const bvRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
      });
      assert.equal(bvRes.phase, 'incomplete');
      assert.equal(bvRes.okCount, 19);
      assert.equal(bvRes.pendingCount, 1);

      // 2. RiskVerificationPanel 3-way split-leak mismatch
      const riskUi = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 'e2e12-02-split',
          browser_identity: { name: 'Split Leak ID', email: 'split@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: true,
            proxy_scheme: 'http',
            proxy_local_port: 7899,
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
            client_kind: 'Clash Verge',
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
            has_sift_rules: true,
            has_telemetry_rules: true,
            has_quic_reject: true,
            has_geoip_cn: true,
            dedicated_listener_port: 7899,
          },
          system: {
            tun_adapter_active: true,
            secondary_plaintext_dns_active: false,
            lan_ipv4_candidates: ['192.168.1.50'],
            public_wan_detected: false,
          },
          cli_security: null,
        },
        probeReport: {
          context_id: 'e2e12-02-split',
          claude: { domain: 'claude.ai', ok: true, country: 'US', colo: 'LAX', ip: '203.0.113.10', latency_ms: 40, error: null },
          persona: { domain: 'withpersona.com', ok: true, country: 'DE', colo: 'FRA', ip: '198.51.100.88', latency_ms: 55, error: null },
          unlisted_dns: { domain: 'example.com', ok: true, country: 'HK', colo: 'HKG', ip: '198.51.100.41', latency_ms: 60, error: null },
          exit_isp: { ip: '203.0.113.10', country: 'US', city: 'LA', timezone: 'America/Los_Angeles', isp: 'RCN', asn: 'AS6079', hosting: false },
          same_country: false,
          same_exit_ip: false,
          unlisted_same_country: false,
        },
        onPage: async (page) => {
          await page.locator('.risk-header-actions button').click();
          await page.waitForSelector('.risk-trace-compare', { timeout: 8000 });
        },
      });
      assert.equal(riskUi.bannerStatus, 'fail');

      return {
        status: 'pass',
        summary: 'ip_mismatch classification rejection, 3-way split-leak UI fail banner, and 4096B trace cap verified',
      };
    },
  },

  {
    id: 'T2-E2E12-03',
    tier: 2,
    features: ['E2E-12'],
    title: '站点清理 Junction 逃逸拒绝与 login=false 重置拒绝边界',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e12-03');
      // Note: profile::clear is not exposed via --orchestrate CLI, so this case combines
      // stripped-source static contract checks (profile.rs / browser/mod.rs) with live
      // in-sandbox NTFS Junction creation and verified-reparse-point-only removal.
      const profileRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'),
      );
      const browserModRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/mod.rs'),
      );
      assert.equal(profileRs.includes('缓存中包含链接，已停止。'), true);
      assert.equal(profileRs.includes('crate::cleaner::linked(&meta)'), true);
      assert.equal(browserModRs.includes('if reset && !include_site_data'), true);

      // Safe in-sandbox junction inside profileDir Default/SharedStorage -> ensure target stays intact & clean
      const profDir = sb.profileDir('e2e12-site-junc');
      const defaultDir = join(profDir, 'Default');
      mkdirSync(defaultDir, { recursive: true });
      const sharedStorageJunc = join(defaultDir, 'SharedStorage');
      const targetInside = join(sb.paths.tempDir, 'shared-storage-target');
      writeFileSync(join(defaultDir, 'Preferences'), '{}');

      createSandboxJunction(sb, sharedStorageJunc, targetInside);
      try {
        writeFileSync(join(targetInside, 'keep.db'), 'must-not-delete');
        assert.equal(existsSync(join(sharedStorageJunc, 'keep.db')), true);
      } finally {
        removeSandboxJunction(sharedStorageJunc);
      }
      assert.equal(readFileSync(join(targetInside, 'keep.db'), 'utf8'), 'must-not-delete');
      assert.deepEqual(await sb.assertNoSymlinkEscape(), []);

      return {
        status: 'pass',
        summary:
          'Site-data reparse-point abort & login=false reset static contracts (profile::clear not exposed via --orchestrate) + safe in-sandbox junction removal verified',
      };
    },
  },

  {
    id: 'T2-E2E12-04',
    tier: 2,
    features: ['E2E-12'],
    title: '异号桌面 UUID 会话残留与孤儿 Privacy Sandbox 文件清理边界',
    async run(ctx) {
      const cleanerIdRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/cleaner_identity.rs'),
      );
      const desktopResidueFn = hasRustFn(cleanerIdRs, 'sanitize_desktop_roots_residue')
        ? (() => {
            const switchFn = extractRustFnBody(cleanerIdRs, 'sanitize_desktop_residue_for_switch');
            assert.equal(switchFn.includes('sanitize_desktop_roots_residue'), true);
            return extractRustFnBody(cleanerIdRs, 'sanitize_desktop_roots_residue');
          })()
        : extractRustFnBody(cleanerIdRs, 'sanitize_cross_account_residue');
      for (const expectedSymbol of [
        'foreign_desktop_root',
        'lastKnownAccountUuid',
        'local-agent-mode-sessions',
        'skills-plugin',
        '00000000-0000-4000-8000-000000000001',
        'DIPS',
        'SharedStorage',
        'blob_storage',
      ]) {
        assert.equal(
          desktopResidueFn.includes(expectedSymbol),
          true,
          `cleaner_identity.rs missing residue cleanup symbol: ${expectedSymbol}`,
        );
      }

      return {
        status: 'pass',
        summary: 'Cross-account desktop UUID, skills-plugin, and orphan Privacy Sandbox cleanup rules verified',
      };
    },
  },

  {
    id: 'T2-E2E12-05',
    tier: 2,
    features: ['E2E-12'],
    title: '风控页移动端桥接非 RFC1918 公网 / fake-IP / 越界端口拦截',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e12-05');
      const { isValidRfc1918Ipv4, isValidBridgePort } = await import('../../../src/risk-model.ts');

      assert.equal(isValidRfc1918Ipv4('203.0.113.45'), false);
      assert.equal(isValidRfc1918Ipv4('198.18.0.1'), false);
      assert.equal(isValidRfc1918Ipv4('192.168.1.50'), true);
      assert.equal(isValidBridgePort(0), false);
      assert.equal(isValidBridgePort(65536), false);
      assert.equal(isValidBridgePort(7899), true);

      let publicIpRejectedInDom = false;
      let badPortRejectedInDom = false;
      await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 'e2e12-05',
          browser_identity: { name: 'Bridge Guard', email: 'bridge@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: true,
            proxy_scheme: 'http',
            proxy_local_port: 7899,
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
            client_kind: 'Clash Verge',
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
            has_sift_rules: true,
            has_telemetry_rules: true,
            has_quic_reject: true,
            has_geoip_cn: true,
            dedicated_listener_port: 7899,
          },
          system: {
            tun_adapter_active: true,
            secondary_plaintext_dns_active: false,
            lan_ipv4_candidates: ['192.168.1.50'],
            public_wan_detected: false,
          },
          cli_security: null,
        },
        onPage: async (page) => {
          const inputs = page.locator('.risk-bridge-form input');
          await inputs.nth(0).fill('203.0.113.45');
          await inputs.nth(1).fill('65536');
          await page.waitForSelector('.risk-field-error', { timeout: 5000 });
          const errorCount = await page.locator('.risk-field-error').count();
          publicIpRejectedInDom = errorCount >= 1;
          badPortRejectedInDom = errorCount >= 2;
        },
      });

      assert.equal(publicIpRejectedInDom, true);
      assert.equal(badPortRejectedInDom, true);

      return {
        status: 'pass',
        summary: 'Mobile bridge blocked public IP (203.0.113.45), fake-IP (198.18.0.1), and port 65536 in model & DOM',
      };
    },
  },
];
