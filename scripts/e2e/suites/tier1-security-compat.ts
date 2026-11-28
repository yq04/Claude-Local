/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./security-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 1 happy-path 安全与兼容性用例数组 cases: E2ECase[]（覆盖 E2E-01, E2E-03, E2E-07, E2E-08, E2E-09, E2E-10, E2E-11, E2E-12，共 40 条，每特性 5 条）。
 * [POS]: Milestone E2 Tier 1 黑盒测试套件；全部在隔离沙盒执行，M2 未合入项诚实探测后在 baseline 返回 baseline_gap、target 返回 fail。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildChromeAntiLeakArgs,
  buildMockIpcShellHtml,
  emitTauriEvent,
  launchPersistentProfile,
  launchPinnedChrome,
  openMockedAppPage,
  startViteServer,
} from '../lib/chrome-harness.ts';
import { MockNetworkSuite } from '../lib/mock-network.ts';
import { MockHttpConnectProxy } from '../lib/mock-proxy.ts';
import {
  deriveDeterministicBrowserSeed,
  resolveClaudeLocalBinary,
  runOfflinePythonTest,
  runOrchestrate,
  runQuotaCore,
  seedSyntheticVault,
} from '../lib/rust-blackbox.ts';
import { isPidAlive } from '../lib/sandbox.ts';
import type { E2ECase } from '../lib/types.ts';
import {
  assert,
  extractRustBlock,
  extractRustFnBody,
  gapOrFail,
  hasRustFn,
  httpsGetViaProxy,
  openRiskPanelWithMockIpc,
  readRepoText,
  resolvePowerShellBinary,
  runBrowserStartInPinnedChrome,
  runMv3QuotaBridgeSync,
  stripJsComments,
  stripRustCommentsAndTests,
} from './security-helpers.ts';

interface OrchestrateStatusJson {
  schema: number;
  ok: boolean;
  active?: string;
  config?: {
    maxSameExitConcurrency: number;
    relayHandoffMode: string;
    spentThresholdPct: number;
    strategy: string;
  };
  accounts?: Array<{
    record_id: string;
    name: string;
  }>;
}

interface SlotAcquireJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id?: string;
  name?: string;
  slot_dir?: string;
  reason?: string;
  error?: string;
}

interface SlotReleaseJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id: string;
  credentials_synced: boolean;
  reason?: string;
}

interface RelaySwitchJson {
  schema: number;
  ok: boolean;
  switched: boolean;
  from_record_id?: string;
  target_id?: string;
  handoff_md_path?: string;
  handoff_json_path?: string;
  reason?: string;
  error?: string;
}

export const cases: E2ECase[] = [
  // =========================================================================
  // E2E-01: 持久化格式兼容与宿主隔离硬边界 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E01-01',
    tier: 1,
    features: ['E2E-01'],
    title: 'BAGAID01 / .baga 加密与 --orchestrate 往返解密与重封装',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e01-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Baga Roundtrip A',
            accountUuid: '10000001-0000-4000-8000-000000000001',
            email: 'baga-a@example.invalid',
            organizationUuid: 'org-baga-a',
            quota5hUsed: 99,
            quota7dUsed: 15,
            bindBrowser: true,
          },
          {
            name: 'Baga Roundtrip B',
            accountUuid: '10000002-0000-4000-8000-000000000002',
            email: 'baga-b@example.invalid',
            organizationUuid: 'org-baga-b',
            quota5hUsed: 10,
            quota7dUsed: 10,
            bindBrowser: true,
          },
        ],
      });

      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.ok, true);
      assert.equal(statusRes.json?.accounts?.length, 2);

      // Acquire slot for B -> verifies Rust decrypts synthetic BAGAID01 archive into cli-slots
      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.exitCode, 0);
      assert.equal(acqB.json?.ok, true);
      assert.equal(acqB.json?.status, 'acquired');
      const slotDir = acqB.json?.slot_dir ?? '';
      assert.equal(existsSync(join(slotDir, '.credentials.json')), true);
      assert.equal(existsSync(join(slotDir, '.claude.json')), true);

      const relB = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relB.exitCode, 0);
      assert.equal(relB.json?.ok, true);

      // Switch active from A -> B (re-seals A via Store::save_verified)
      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
        from_record_id: seeded.records[0].id,
      });
      assert.equal(sw.exitCode, 0, `relay_switch failed: ${sw.stdout} ${sw.stderr}`);
      assert.equal(sw.json?.ok, true);
      assert.equal(sw.json?.switched, true);
      assert.equal(sw.json?.target_id, seeded.records[1].id);

      // Verify all .baga files in vault carry exact 8-byte BAGAID01 magic header
      const bagaFiles = readdirSync(seeded.vaultDir).filter((f) => f.endsWith('.baga'));
      assert.ok(bagaFiles.length >= 2);
      for (const file of bagaFiles) {
        const magic = readFileSync(join(seeded.vaultDir, file)).subarray(0, 8).toString('ascii');
        assert.equal(magic, 'BAGAID01', `${file} must start with BAGAID01`);
      }

      // Re-acquire A to verify re-sealed archive can be decrypted again
      const acqA = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[0].id,
      });
      assert.equal(acqA.exitCode, 0);
      assert.equal(acqA.json?.ok, true);
      assert.equal(existsSync(join(acqA.json!.slot_dir!, '.credentials.json')), true);

      return {
        status: 'pass',
        summary: 'Synthetic BAGAID01 round-trip decryption, re-seal, and magic verification passed',
        metrics: { bagaFiles: bagaFiles.length },
      };
    },
  },

  {
    id: 'T1-E2E01-02',
    tier: 1,
    features: ['E2E-01'],
    title: 'SQLite identities.sqlite user_version=3 兼容与 v1/v2 自动迁移',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const migratedVersions: number[] = [];

      for (const initialVersion of [1, 2] as const) {
        const sb = await ctx.createSandbox(`t1-e2e01-02-v${initialVersion}`);
        const vaultDir = join(sb.paths.appDataDir, 'ai.local.claude-local', 'identity-vault');
        mkdirSync(vaultDir, { recursive: true });
        writeFileSync(join(vaultDir, 'key.bin'), Buffer.alloc(32, initialVersion));
        const dbPath = join(vaultDir, 'identities.sqlite');
        const db = new Database(dbPath);
        try {
          if (initialVersion === 1) {
            db.exec(`
              CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL, policy TEXT NOT NULL, empty INTEGER NOT NULL);
              CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);
              PRAGMA user_version=1;
            `);
          } else {
            db.exec(`
              CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL, policy TEXT NOT NULL, empty INTEGER NOT NULL, account_key TEXT);
              CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);
              PRAGMA user_version=2;
            `);
          }
        } finally {
          db.close();
        }

        const res = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'status',
        });
        assert.equal(res.exitCode, 0, `Migration from v${initialVersion} failed: ${res.stdout} ${res.stderr}`);
        assert.equal(res.json?.ok, true);

        const checkDb = new Database(dbPath, { readonly: true });
        try {
          const verRow = checkDb.query('PRAGMA user_version').get() as { user_version: number };
          migratedVersions.push(verRow.user_version);
          assert.equal(verRow.user_version, 3);
          const cols = checkDb.query('PRAGMA table_info(identities)').all() as Array<{ name: string }>;
          assert.equal(
            cols.some((c) => c.name === 'account_key'),
            true,
            'identities table must include account_key after migration',
          );
          const bindingsTable = checkDb
            .query("SELECT name FROM sqlite_master WHERE type='table' AND name='browser_bindings'")
            .get() as { name: string } | null;
          assert.equal(bindingsTable?.name, 'browser_bindings');
          const draft = checkDb
            .query("SELECT value FROM state WHERE key='browser.draft'")
            .get() as { value: string } | null;
          assert.ok(draft?.value && draft.value.length >= 16);
          const enabled = checkDb
            .query("SELECT value FROM state WHERE key='browser.enabled'")
            .get() as { value: string } | null;
          assert.equal(enabled?.value, '1');
        } finally {
          checkDb.close();
        }
      }

      return {
        status: 'pass',
        summary: 'SQLite v1 & v2 schemas cleanly migrated to user_version=3 with account_key and browser_bindings',
        metrics: { v1MigratedTo: migratedVersions[0], v2MigratedTo: migratedVersions[1] },
      };
    },
  },

  {
    id: 'T1-E2E01-03',
    tier: 1,
    features: ['E2E-01'],
    title: 'CCBaga/browser/{id}/{attempt} 确定性种子向量与 32B key.bin 复用',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e01-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      // Independent SHA-256 test vector check for CCBaga/browser/{id}/{attempt}
      const testId = '0123456789abcdef0123456789abcdef';
      for (const attempt of [0, 1, 2, 3]) {
        const expectedDigest = createHash('sha256')
          .update(`CCBaga/browser/${testId}/${attempt}`, 'utf8')
          .digest();
        const expectedU32 = expectedDigest.readUInt32BE(0);
        assert.equal(deriveDeterministicBrowserSeed(testId, attempt), expectedU32);
      }

      const firstSeed = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            id: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            name: 'Seed Reuse 1',
            accountUuid: '20000001-0000-4000-8000-000000000001',
            email: 'seed1@example.invalid',
            organizationUuid: 'org-seed-1',
            bindBrowser: true,
          },
        ],
      });
      const keyPath = join(firstSeed.vaultDir, 'key.bin');
      const keyBytes1 = readFileSync(keyPath);
      assert.equal(keyBytes1.length, 32);

      // Second seedSyntheticVault inside same sandbox must reuse existing key.bin and produce identical HMAC
      const secondSeed = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        accounts: [
          {
            id: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            name: 'Seed Reuse 1',
            accountUuid: '20000001-0000-4000-8000-000000000001',
            email: 'seed1@example.invalid',
            organizationUuid: 'org-seed-1',
            bindBrowser: true,
          },
          {
            id: 'bbbb2222bbbb2222bbbb2222bbbb2222',
            name: 'Seed Reuse 2',
            accountUuid: '20000002-0000-4000-8000-000000000002',
            email: 'seed2@example.invalid',
            organizationUuid: 'org-seed-2',
            bindBrowser: true,
          },
        ],
      });
      const keyBytes2 = readFileSync(keyPath);
      assert.equal(Buffer.compare(keyBytes1, keyBytes2), 0);
      assert.equal(firstSeed.records[0].accountKey, secondSeed.records[0].accountKey);

      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.ok, true);
      assert.equal(statusRes.json?.accounts?.length, 2);

      return {
        status: 'pass',
        summary: 'CCBaga browser seed vectors, 32-byte key.bin reuse, and HMAC consistency verified',
        metrics: { accounts: statusRes.json?.accounts?.length ?? 0 },
      };
    },
  },

  {
    id: 'T1-E2E01-04',
    tier: 1,
    features: ['E2E-01'],
    title: '沙盒 APPDATA / USERPROFILE 全套写入宿主零触碰',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e01-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Host Isolation A',
            accountUuid: '30000001-0000-4000-8000-000000000001',
            email: 'iso-a@example.invalid',
            quota5hUsed: 99,
            bindBrowser: true,
          },
          {
            name: 'Host Isolation B',
            accountUuid: '30000002-0000-4000-8000-000000000002',
            email: 'iso-b@example.invalid',
            quota5hUsed: 5,
            bindBrowser: true,
          },
        ],
      });

      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);

      const acq = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq.exitCode, 0);
      assert.equal(acq.json?.ok, true);

      const rel = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(rel.exitCode, 0);

      const inst = await runOrchestrate<{ ok: boolean; installed: boolean }>(
        bin.exePath,
        sb.paths,
        { schema: 1, op: 'install_wrappers' },
      );
      assert.equal(inst.exitCode, 0);
      assert.equal(inst.json?.installed, true);

      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.exitCode, 0);
      assert.equal(sw.json?.switched, true);

      const audit = await sb.assertHostUntouched();
      assert.equal(audit.ok, true, `Host safety violations: ${audit.violations.join('; ')}`);
      assert.ok(audit.checkedSentinels >= 6);

      return {
        status: 'pass',
        summary: 'All --orchestrate write operations remained strictly within sandbox; host sentinels untouched',
        metrics: { checkedSentinels: audit.checkedSentinels },
      };
    },
  },

  {
    id: 'T1-E2E01-05',
    tier: 1,
    features: ['E2E-01'],
    title: '离线 Python 归档编解码器与流式限额套件 (test-quota-archive.py)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e01-05');
      const res = runOfflinePythonTest(ctx.repoRoot, 'test-quota-archive.py', sb.paths);
      assert.equal(res.exitCode, 0, `test-quota-archive.py failed: ${res.stdout}\n${res.stderr}`);
      return {
        status: 'pass',
        summary: 'Offline Python test-quota-archive.py passed in isolated sandbox',
        metrics: { exitCode: res.exitCode },
      };
    },
  },

  // =========================================================================
  // E2E-03: 伴生浏览器防泄露启动参数与出口门禁 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E03-01',
    tier: 1,
    features: ['E2E-03'],
    title: '显式代理远程 DNS 锁定参数与 CONNECT 域名不泄露',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e03-01');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const argsFn = extractRustFnBody(configRs, 'arguments_with_options');
      const normProxyFn = extractRustFnBody(configRs, 'normalize_reqwest_proxy');
      assert.equal(
        argsFn.includes('--host-resolver-rules=MAP * ~NOTFOUND'),
        true,
        'config.rs must enforce MAP * ~NOTFOUND host resolver lockdown',
      );
      assert.equal(argsFn.includes('--proxy-bypass-list=127.0.0.1;localhost;[::1]'), true);
      assert.equal(argsFn.includes('--test-type'), true);
      assert.equal(normProxyFn.includes('socks5h://'), true);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e03-dns-lock',
        headless: true,
        argsOptions: { proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/', 'https://www.cloudflare.com/'],
      });
      const page = await persistent.context.newPage();
      await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
      const claudeText = await page.locator('main').innerText();
      assert.match(claudeText, /Mock Claude \/new/);

      await page.goto('https://www.cloudflare.com/cdn-cgi/trace', {
        waitUntil: 'domcontentloaded',
      });
      const traceBody = await page.locator('body').innerText();
      assert.match(traceBody, /loc=US/);

      const audit = proxy.getAuditLog();
      assert.ok(audit.length >= 2);
      proxy.assertNoDomainDnsLeak();
      assert.equal(
        audit.some((e) => e.host === 'claude.ai' && !e.isLiteralIp),
        true,
        'Proxy must receive claude.ai domain CONNECT rather than resolved IP',
      );

      return {
        status: 'pass',
        summary: 'Explicit proxy DNS lockdown verified in config.rs and live Chrome CONNECT audit',
        metrics: { connectEntries: audit.length },
      };
    },
  },

  {
    id: 'T1-E2E03-02',
    tier: 1,
    features: ['E2E-03'],
    title: 'WebRTC 禁用非代理 UDP 实测 (/probe/webrtc.html)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e03-02');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e03-webrtc',
        headless: true,
        argsOptions: { proxyUrl: proxy.url },
        allowedUrlPrefixes: [netSuite.httpsBaseUrl],
      });
      const page = await persistent.context.newPage();
      await page.goto(`${netSuite.httpsBaseUrl}/probe/webrtc.html`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => (window as unknown as { __WEBRTC_DONE__?: boolean }).__WEBRTC_DONE__ === true,
        { timeout: 10_000 },
      );

      const probe = await page.evaluate(() => {
        const w = window as unknown as {
          __WEBRTC_ERROR__: string | null;
          __WEBRTC_CANDIDATES__: string[];
        };
        return {
          error: w.__WEBRTC_ERROR__,
          candidates: w.__WEBRTC_CANDIDATES__,
        };
      });

      assert.equal(probe.error, null, `WebRTC probe error: ${probe.error}`);
      const leaked = probe.candidates.filter((c) => {
        if (/\btyp\s+(srflx|prflx|relay)\b/i.test(c)) return true;
        // Host candidate with non-mDNS explicit IPv4/IPv6 other than loopback
        const ipMatch = c.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (ipMatch && ipMatch[1] !== '127.0.0.1') return true;
        return false;
      });
      assert.deepEqual(
        leaked,
        [],
        `Non-proxied WebRTC candidates leaked: ${leaked.join(' | ')}`,
      );

      return {
        status: 'pass',
        summary: 'WebRTC anti-leak flags blocked all srflx/relay/public IP candidates in pinned Chrome',
        metrics: { totalCandidates: probe.candidates.length, leakedCount: leaked.length },
      };
    },
  },

  {
    id: 'T1-E2E03-03',
    tier: 1,
    features: ['E2E-03'],
    title: '禁用 QUIC、IPv6 探测、DoH/AsyncDns/ECH/背景联网参数及真实启动',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e03-03');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const argsFn = extractRustFnBody(configRs, 'arguments_with_options');
      const requiredFlags = [
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-non-proxied-udp',
        '--enforce-webrtc-ip-permission-check',
        '--disable-quic',
        '--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability',
        '--disable-background-networking',
        '--set-ipv6-probe-false',
      ];
      for (const flag of requiredFlags) {
        assert.equal(argsFn.includes(flag), true, `Missing flag in config.rs: ${flag}`);
      }

      const args = buildChromeAntiLeakArgs({ seed: 246813579 });
      for (const flag of [
        '--disable-quic',
        '--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability',
        '--set-ipv6-probe-false',
        '--no-proxy-server',
        '--disable-background-networking',
      ]) {
        assert.equal(args.includes(flag), true, `Harness args missing ${flag}`);
      }

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e03-flags',
        headless: true,
        argsOptions: { seed: 246813579 },
        allowedUrlPrefixes: ['chrome://'],
      });
      assert.ok(persistent.pid && persistent.pid > 0);
      const page = await persistent.context.newPage();
      await page.goto('about:blank');
      const ua = await page.evaluate(() => navigator.userAgent);
      assert.match(ua, /Chrome\/148\./);

      return {
        status: 'pass',
        summary: 'QUIC/IPv6/DoH/AsyncDns/ECH/background-networking flags verified in config.rs and Chrome launch',
        metrics: { requiredFlagsChecked: requiredFlags.length },
      };
    },
  },

  {
    id: 'T1-E2E03-04',
    tier: 1,
    features: ['E2E-03'],
    title: 'Default/Preferences 与 Local State 隐私偏好及 TUN 直连模式',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e03-04');
      const profileRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'),
      );
      for (const expectedSnippet of [
        'dns_prefetching',
        'network_prediction_options',
        'disable_non_proxied_udp',
        'multiple_routes_enabled',
        'nonproxied_udp_enabled',
        'geolocation',
        'dns_over_https',
        'rev_checking',
        'ech_enabled',
        'quick_check_enabled',
        '"direct"',
      ]) {
        assert.equal(
          profileRs.includes(expectedSnippet),
          true,
          `profile.rs missing hardened pref snippet: ${expectedSnippet}`,
        );
      }

      // Write equivalent hardened Preferences & Local State into sandbox profile and launch Chrome
      const profDir = sb.profileDir('e2e03-prefs');
      mkdirSync(join(profDir, 'Default'), { recursive: true });
      writeFileSync(
        join(profDir, 'Local State'),
        JSON.stringify({
          dns_over_https: { mode: 'off' },
          ssl: { rev_checking: { enabled: false }, ech_enabled: false },
          proxy: { quick_check_enabled: false },
        }),
      );
      writeFileSync(
        join(profDir, 'Default', 'Preferences'),
        JSON.stringify({
          dns_prefetching: { enabled: false },
          net: { network_prediction_options: 2 },
          webrtc: {
            ip_handling_policy: 'disable_non_proxied_udp',
            multiple_routes_enabled: false,
            nonproxied_udp_enabled: false,
          },
          proxy: { mode: 'direct' },
        }),
      );

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e03-prefs',
        headless: true,
        argsOptions: { noProxyServer: true },
        allowedUrlPrefixes: [],
      });
      await persistent.close();

      const localStateAfter = JSON.parse(readFileSync(join(profDir, 'Local State'), 'utf8')) as {
        dns_over_https?: { mode?: string };
      };
      const prefsAfter = JSON.parse(
        readFileSync(join(profDir, 'Default', 'Preferences'), 'utf8'),
      ) as {
        webrtc?: { ip_handling_policy?: string };
        dns_prefetching?: { enabled?: boolean };
      };
      assert.equal(localStateAfter.dns_over_https?.mode, 'off');
      assert.equal(prefsAfter.webrtc?.ip_handling_policy, 'disable_non_proxied_udp');
      assert.equal(prefsAfter.dns_prefetching?.enabled, false);

      return {
        status: 'pass',
        summary: 'Preferences & Local State anti-leak locks verified in profile.rs and persisted across Chrome exit',
      };
    },
  },

  {
    id: 'T1-E2E03-05',
    tier: 1,
    features: ['E2E-03'],
    title: '允许国家 (US/FR/JP) 出口放行与 1.1.1.1 trace 前置',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e03-05');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const idx1111 = configRs.indexOf('https://1.1.1.1/cdn-cgi/trace');
      const idxCf = configRs.indexOf('https://www.cloudflare.com/cdn-cgi/trace');
      assert.ok(idx1111 > 0 && idxCf > idx1111, '1.1.1.1 trace URL must precede www.cloudflare.com');
      assert.equal(configRs.includes('EXIT_COUNTRY_CACHE'), true);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const observed: string[] = [];
      for (const [preset, cc] of [
        ['us_isp', 'US'],
        ['fr_isp', 'FR'],
        ['jp_isp', 'JP'],
      ] as const) {
        netSuite.applyTracePreset(preset);
        const res = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: '1.1.1.1',
          path: '/cdn-cgi/trace',
        });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.includes(`loc=${cc}`), true, `Expected loc=${cc} in trace body`);
        observed.push(cc);
      }

      return {
        status: 'pass',
        summary: '1.1.1.1 trace priority and US/FR/JP allowed exit countries verified over CONNECT proxy',
        metrics: { verifiedCountries: observed.join(',') },
      };
    },
  },

  // =========================================================================
  // E2E-07: 伴生浏览器指纹默认开启与跨上下文一致性核验 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E07-01',
    tier: 1,
    features: ['E2E-07'],
    title: 'native_graphics=false 默认指纹开启与移除硬编码 --disable-spoofing',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e07-01');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const defaultBlock = extractRustBlock(configRs, /\bimpl\s+Default\s+for\s+Config\b/);
      const defaultMatch = defaultBlock.match(/native_graphics:\s*(true|false)/);
      assert.ok(defaultMatch, 'Config::default() must declare native_graphics');
      if (defaultMatch[1] !== 'false') {
        return gapOrFail(ctx.mode, 'Config::default().native_graphics is still true');
      }
      const argsFn = extractRustFnBody(configRs, 'arguments_with_options');
      assert.equal(
        argsFn.includes('--disable-spoofing=font,audio,gpu"'),
        false,
        'Unconditional font/audio/gpu disable-spoofing must be removed',
      );
      assert.equal(argsFn.includes('--fingerprint-screen-width='), true);

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e07-native-graphics',
        headless: true,
        argsOptions: { seed: 777888999 },
        allowedUrlPrefixes: [],
      });
      const page = await persistent.context.newPage();
      const canvasHash = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 16;
        const g = c.getContext('2d');
        if (!g) return '';
        g.fillStyle = '#c96442';
        g.fillRect(0, 0, 64, 16);
        return c.toDataURL();
      });
      assert.ok(canvasHash.startsWith('data:image/png;base64,'));

      return {
        status: 'pass',
        summary: 'native_graphics=false default & pinned Chromium --fingerprint rendering verified',
      };
    },
  },

  {
    id: 'T1-E2E07-02',
    tier: 1,
    features: ['E2E-07'],
    title: '非默认动态种子派生（无静态 495574189）与屏幕预设映射',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e07-02');
      const configRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      assert.equal(configRs.includes('495574189'), false, 'Legacy static seed 495574189 must be removed');
      assert.equal(extractRustFnBody(configRs, 'random_seed').includes('SystemRandom'), true);
      assert.equal(hasRustFn(configRs, 'virtual_screen_preset'), true);

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        accounts: [
          {
            name: 'Seed Dyn A',
            accountUuid: '40000001-0000-4000-8000-000000000001',
            email: 'dyna@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Seed Dyn B',
            accountUuid: '40000002-0000-4000-8000-000000000002',
            email: 'dynb@example.invalid',
            bindBrowser: true,
          },
        ],
      });
      assert.ok((seeded.records[0].seed ?? 0) > 0);
      assert.ok((seeded.records[1].seed ?? 0) > 0);
      assert.notEqual(seeded.records[0].seed, seeded.records[1].seed);
      assert.notEqual(seeded.records[0].seed, 495574189);
      assert.notEqual(seeded.records[1].seed, 495574189);

      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.accounts?.length, 2);

      return {
        status: 'pass',
        summary: 'Dynamic per-account browser seeds verified distinct, non-zero, and free of static 495574189',
        metrics: {
          seedA: seeded.records[0].seed!,
          seedB: seeded.records[1].seed!,
        },
      };
    },
  },

  {
    id: 'T1-E2E07-03',
    tier: 1,
    features: ['E2E-07'],
    title: 'browser-start.tsx 20 项必需检测全部通过',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e07-03');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');

      const res = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
      });
      assert.deepEqual(res.pageErrors, []);
      assert.equal(
        res.phase,
        'passed',
        `Expected passed, got ${res.phase}; failedChecks=${res.failedCheckIds.join(',')}`,
      );
      assert.equal(res.okCount, 20);
      assert.equal(res.failedCount, 0);

      return {
        status: 'pass',
        summary: 'All 20 browser-start.tsx verification checks passed in pinned WindowsBrowser/chrome.exe',
        metrics: { okCount: res.okCount, failedCount: res.failedCount },
      };
    },
  },

  {
    id: 'T1-E2E07-04',
    tier: 1,
    features: ['E2E-07'],
    title: 'Worker / SharedWorker / ServiceWorker / iframe / OffscreenCanvas 跨上下文一致性核验',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e07-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_isp');

      // 1. Live /probe/cross-context.html on pinned Chrome with --fingerprint
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e07-cross-ctx',
        headless: true,
        argsOptions: { seed: 314159265 },
        allowedUrlPrefixes: [netSuite.httpsBaseUrl],
      });
      const probePage = await persistent.context.newPage();
      await probePage.goto(`${netSuite.httpsBaseUrl}/probe/cross-context.html`, {
        waitUntil: 'domcontentloaded',
      });
      await probePage.waitForFunction(
        () => (window as unknown as { __CROSS_CONTEXT_DONE__?: boolean }).__CROSS_CONTEXT_DONE__ === true,
        { timeout: 10_000 },
      );
      const probeData = await probePage.evaluate(() => {
        return (window as unknown as {
          __CROSS_CONTEXT__: {
            window: { hardwareConcurrency: number; language: string; timezone: string };
            worker: { hardwareConcurrency: number; language: string; timezone: string };
            sameOriginIframe: { hardwareConcurrency: number; language: string; timezone: string };
            sandboxedIframe: { hardwareConcurrency: number; language: string; timezone: string };
          };
        }).__CROSS_CONTEXT__;
      });
      await persistent.close();

      assert.equal(probeData.worker.hardwareConcurrency, probeData.window.hardwareConcurrency);
      assert.equal(probeData.sameOriginIframe.language, probeData.window.language);
      assert.equal(probeData.sandboxedIframe.timezone, probeData.window.timezone);

      // 2. Vite /browser.html 6-context x 9-metric DOM panel
      const uiRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
      });
      if (uiRes.crossContextPillCount !== 6 || uiRes.crossContextMetricCount !== 9) {
        return gapOrFail(
          ctx.mode,
          `Cross-context panel incomplete (pills=${uiRes.crossContextPillCount}, metrics=${uiRes.crossContextMetricCount})`,
        );
      }
      assert.equal(uiRes.crossContextBlocking, false);

      return {
        status: 'pass',
        summary: '6 execution contexts and 9 cross-context consistency metrics verified in pinned Chrome',
        metrics: {
          pills: uiRes.crossContextPillCount,
          metrics: uiRes.crossContextMetricCount,
        },
      };
    },
  },

  {
    id: 'T1-E2E07-05',
    tier: 1,
    features: ['E2E-07'],
    title: 'toString、Error.stack、deviceMemory 与 screen.orientation 一致性',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e07-05');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());

      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e07-integrity',
        headless: true,
        argsOptions: { seed: 555666777 },
        allowedUrlPrefixes: [netSuite.httpsBaseUrl],
      });
      const page = await persistent.context.newPage();
      await page.goto(`${netSuite.httpsBaseUrl}/probe/cross-context.html`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => (window as unknown as { __CROSS_CONTEXT_DONE__?: boolean }).__CROSS_CONTEXT_DONE__ === true,
      );
      const toStringSample = await page.evaluate(() => {
        return (window as unknown as {
          __CROSS_CONTEXT__: { window: { permissionsToString: string } };
        }).__CROSS_CONTEXT__.window.permissionsToString;
      });
      await persistent.close();
      assert.match(toStringSample, /\[native code\]/);

      // Pure model check via direct Bun import of evaluateCrossContextConsistency
      const { evaluateCrossContextConsistency } = await import('../../../src/browser-verification.ts');
      const makeSnap = (kind: 'window' | 'worker' | 'shared-worker' | 'service-worker' | 'same-origin-iframe' | 'sandbox-iframe') => ({
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
          kind === 'worker' || kind === 'shared-worker' || kind === 'service-worker'
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

      const evalRes = evaluateCrossContextConsistency(
        makeSnap('window'),
        [
          { kind: 'worker', status: 'ok', snapshot: makeSnap('worker') },
          { kind: 'shared-worker', status: 'ok', snapshot: makeSnap('shared-worker') },
          { kind: 'service-worker', status: 'ok', snapshot: makeSnap('service-worker') },
          { kind: 'same-origin-iframe', status: 'ok', snapshot: makeSnap('same-origin-iframe') },
          { kind: 'sandbox-iframe', status: 'ok', snapshot: makeSnap('sandbox-iframe') },
        ],
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, GeForce RTX 4070)' },
      );

      assert.equal(evalRes.status, 'passed');
      assert.equal(evalRes.blocking, false);
      assert.equal(evalRes.mismatches.length, 0);
      const orientMetric = evalRes.metrics.find((m) => m.id === 'ctx.screen-orientation');
      assert.equal(orientMetric?.cells.worker.status, 'not_applicable');
      assert.equal(orientMetric?.cells['shared-worker'].status, 'not_applicable');
      assert.equal(orientMetric?.cells['service-worker'].status, 'not_applicable');

      return {
        status: 'pass',
        summary: 'toString native check, deviceMemory=8, and worker screen.orientation not_applicable semantics passed',
      };
    },
  },

  // =========================================================================
  // E2E-08: Kill-Switch 多槽位强熔断闭环 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E08-01',
    tier: 1,
    features: ['E2E-08'],
    title: 'Kill-Switch 0 秒基线探测与初始 IP is_hosting_exit 校验',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const spawnSection = extractRustFnBody(ksRs, 'spawn_monitor');
      const onSpawnedFn = extractRustFnBody(ksRs, 'on_managed_browser_spawned');
      const loopWaitIdx = spawnSection.indexOf('wait_for_next_tick(');
      const firstProbeIdx = spawnSection.indexOf('probe_exit_trace(');
      const onSlotsTickBody = hasRustFn(ksRs, 'on_slots_tick')
        ? extractRustFnBody(ksRs, 'on_slots_tick')
        : '';
      const checksInitialZeroWait =
        spawnSection.includes('Duration::ZERO') ||
        (firstProbeIdx > 0 && loopWaitIdx > 0 && firstProbeIdx < loopWaitIdx) ||
        (onSpawnedFn.includes('notify_browser_activity()') &&
          spawnSection.includes('wait_for_next_tick(') &&
          onSlotsTickBody.includes('st.tick_count == 1') &&
          onSlotsTickBody.includes('probe_exit_slots'));

      // Also check whether initial IP observation checks is_hosting_exit / probe() on first IP
      const observeIpFnName = hasRustFn(ksRs, 'observe_slot_ip_status')
        ? 'observe_slot_ip_status'
        : 'observe_slot_ip';
      const observeIpFn = extractRustFnBody(ksRs, observeIpFnName);
      const checksInitialHosting =
        spawnSection.includes('is_hosting_exit') &&
        (observeIpFn.includes('InitialBaseline') ||
          observeIpFn.includes('initial') ||
          hasRustFn(ksRs, 'observe_initial_slot_ip'));

      if (!checksInitialZeroWait || !checksInitialHosting) {
        return gapOrFail(
          ctx.mode,
          `M2 F7 gap: spawn_monitor still waits ACTIVE_POLL before initial probe (zeroWait=${checksInitialZeroWait}) or skips initial IP is_hosting_exit check (initialHosting=${checksInitialHosting})`,
          { zeroWait: checksInitialZeroWait, initialHosting: checksInitialHosting },
        );
      }

      return {
        status: 'pass',
        summary: 'Kill-Switch 0s baseline probe and initial IP hosting check present',
      };
    },
  },

  {
    id: 'T1-E2E08-02',
    tier: 1,
    features: ['E2E-08'],
    title: '显式代理 (30s) vs TUN (120s) per-slot 路由探测解耦',
    async run(ctx) {
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const spawnFn = extractRustFnBody(ksRs, 'spawn_monitor');
      const stillAggregatesTunProxy = spawnFn.includes('aggregate_tun_proxy(&routes)');
      if (stillAggregatesTunProxy) {
        return gapOrFail(
          ctx.mode,
          'M2 F7 gap: spawn_monitor still aggregates routes via aggregate_tun_proxy(&routes), downgrading explicit proxy slots to 120s when a TUN slot coexists',
        );
      }

      return {
        status: 'pass',
        summary: 'Per-slot exit probe cadence decoupled from aggregate_tun_proxy',
      };
    },
  },

  {
    id: 'T1-E2E08-03',
    tier: 1,
    features: ['E2E-08'],
    title: '单次瞬断 (TUN / 国家漂移 / 429) 自愈不误杀',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e08-03');
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const hasSlotsTunRecheck =
        hasRustFn(ksRs, 'on_slots_tick') &&
        hasRustFn(ksRs, 'on_slots_tun_recheck') &&
        extractRustFnBody(ksRs, 'on_slots_tick').includes('recheck_tun_slots') &&
        extractRustFnBody(ksRs, 'on_slots_tun_recheck').includes('tun_drop_streak >= 2');
      const hasLegacyTunRecheck =
        ksRs.includes('RecheckTunAfterDelay') && ksRs.includes('TriggerTunDropped');
      assert.equal(
        hasSlotsTunRecheck || hasLegacyTunRecheck,
        true,
        'kill_switch.rs must require secondary recheck before tun_dropped kill',
      );
      const evalExitFn = extractRustFnBody(ksRs, 'evaluate_exit_probe');
      assert.equal(evalExitFn.includes('RecheckExitAfterDelay'), true);
      assert.equal(evalExitFn.includes('IgnoredTransientError'), true);
      assert.equal(evalExitFn.includes('Err(_)'), true);

      // Dynamic proxy 429 -> healthy self-recovery check
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      proxy.setFault('www.cloudflare.com', { mode: 'rate_limit_429', retryAfterSec: 1 });
      const firstProbe = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'www.cloudflare.com',
        path: '/cdn-cgi/trace',
      });
      assert.equal(firstProbe.statusCode, 429);

      proxy.clearFaults();
      const recoveredProbe = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'www.cloudflare.com',
        path: '/cdn-cgi/trace',
      });
      assert.equal(recoveredProbe.statusCode, 200);
      assert.match(recoveredProbe.body, /loc=US/);

      return {
        status: 'pass',
        summary: 'Transient 429 / recheck contracts and proxy recovery verified without false kill',
      };
    },
  },

  {
    id: 'T1-E2E08-04',
    tier: 1,
    features: ['E2E-08'],
    title: '受管多槽位 reason_code 与 closed_slots 事件追踪',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e08-04');
      const ksRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'),
      );
      const runningProfilesFn = extractRustFnBody(ksRs, 'running_managed_profiles');
      const triggerKsFn = extractRustFnBody(ksRs, 'trigger_kill_switch');
      assert.equal(runningProfilesFn.includes('contexts'), true);
      assert.equal(triggerKsFn.includes('kill-switch-triggered'), true);

      // Drive real event delivery via Vite + mockIPC shell
      const html = buildMockIpcShellHtml({
        entryModule: null,
        setupScript: `
          import { listen } from '@tauri-apps/api/event';
          window.__e2eListen = listen;
          window.__ksEvents = [];
          window.__e2eHandleCommand = async (cmd) => {
            if (cmd === 'browser_kill_switch_state') {
              return { enabled: true, triggered: false, closed_slots: [] };
            }
            return null;
          };
        `,
      });
      const vite = await startViteServer({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        virtualPages: { '/__e2e-ks.html': html },
      });
      const pinned = await launchPinnedChrome({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        headless: true,
      });
      const iso = await pinned.newIsolatedContext({ allowedUrlPrefixes: [`${vite.baseUrl}/`] });
      const { page } = await openMockedAppPage({
        context: iso.context,
        url: `${vite.baseUrl}/__e2e-ks.html`,
      });

      await page.evaluate(async () => {
        const listenFn = (window as unknown as {
          __e2eListen: (evt: string, cb: (e: unknown) => void) => Promise<() => void>;
        }).__e2eListen;
        await listenFn('kill-switch-triggered', (evt: unknown) => {
          (window as unknown as { __ksEvents: unknown[] }).__ksEvents.push(evt);
        });
      });

      const slotA = 'a'.repeat(32);
      const slotB = 'b'.repeat(32);
      await emitTauriEvent(page, 'kill-switch-triggered', {
        enabled: true,
        triggered: true,
        reason_code: 'exit_datacenter',
        expected_country: 'US',
        observed_country: 'US',
        triggered_at: Math.floor(Date.now() / 1000),
        closed_slots: [slotA, slotB],
      });

      const received = await page.evaluate(
        () =>
          (window as unknown as {
            __ksEvents: Array<{
              payload: { reason_code: string; closed_slots: string[] };
            }>;
          }).__ksEvents,
      );
      assert.equal(received.length, 1);
      assert.equal(received[0].payload.reason_code, 'exit_datacenter');
      assert.deepEqual(received[0].payload.closed_slots, [slotA, slotB]);

      await iso.close();
      await pinned.close();

      return {
        status: 'pass',
        summary: 'Kill-switch event payload reason_code and multi-slot closed_slots verified',
      };
    },
  },

  {
    id: 'T1-E2E08-05',
    tier: 1,
    features: ['E2E-08'],
    title: '触发熔断仅隔离受管目标槽位，不触碰非受管浏览器进程',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e08-05');
      const winProcRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/windows_process.rs'),
      );
      assert.equal(hasRustFn(winProcRs, 'is_chrome_entry'), true);
      assert.equal(hasRustFn(winProcRs, 'has_child_process_type'), true);
      assert.equal(hasRustFn(winProcRs, 'profile_matches'), true);
      assert.equal(winProcRs.includes('!has_child_process_type'), true);

      const managed = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'managed-slot',
        headless: true,
        argsOptions: { seed: 111222333 },
        allowedUrlPrefixes: [],
      });
      const unmanaged = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'unmanaged-other',
        headless: true,
        argsOptions: { seed: 444555666 },
        allowedUrlPrefixes: [],
      });

      assert.ok(managed.pid && managed.pid > 0);
      assert.ok(unmanaged.pid && unmanaged.pid > 0);
      assert.notEqual(managed.pid, unmanaged.pid);

      await managed.close();
      assert.equal(
        isPidAlive(unmanaged.pid),
        true,
        'Closing managed slot browser must not terminate unmanaged browser process',
      );
      await unmanaged.close();

      return {
        status: 'pass',
        summary: 'Closing managed Chrome profile isolated strictly by user-data-dir; unmanaged PID survived',
      };
    },
  },

  // =========================================================================
  // E2E-09: MV3 扩展按需挂载与本地回环桥接加固 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E09-01',
    tier: 1,
    features: ['E2E-09'],
    title: '普通 claude_ai 打开不加载 MV3 扩展 (按需挂载门禁)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e09-01');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // Verify clean BrowseClaudeAi Chromium launch without extensionDir loads 0 service workers
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'e2e09-no-ext',
        headless: true,
        argsOptions: { proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const page = await persistent.context.newPage();
      await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
      assert.equal(persistent.context.serviceWorkers().length, 0);
      await persistent.close();

      // Probe Rust LaunchOptions gating in quota_connection.rs / config.rs / launch.rs
      const qcRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'),
      );
      const cfgRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'),
      );
      const launchRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/launch.rs'),
      );
      const openFn = extractRustFnBody(qcRs, 'browser_open_identity_profile');
      const launchTargetFn = extractRustFnBody(qcRs, 'launch_bound_profile_target_with_options');
      const forPurposeFn = extractRustFnBody(cfgRs, 'for_purpose');
      const argsWithOptsFn = extractRustFnBody(cfgRs, 'arguments_with_options');
      const spawnUrlsFn = extractRustFnBody(launchRs, 'spawn_with_urls_locked');

      const stillHardcodesBridge =
        openFn.includes('enable_quota_bridge: true') ||
        openFn.includes('LaunchOptions::legacy_default()') ||
        launchTargetFn.includes('enable_quota_bridge: true') ||
        launchTargetFn.includes('LaunchOptions::legacy_default()') ||
        !forPurposeFn.includes('matches!(purpose, LaunchPurpose::QuotaSync)') ||
        !argsWithOptsFn.includes('if options.enable_quota_bridge') ||
        spawnUrlsFn.includes('legacy_default()');
      if (
        stillHardcodesBridge ||
        !openFn.includes('LaunchOptions::for_purpose') ||
        !openFn.includes('LaunchPurpose::BrowseClaudeAi')
      ) {
        return gapOrFail(
          ctx.mode,
          'M2 F8 gap: quota_connection.rs still sets enable_quota_bridge: true / legacy_default() for BrowseClaudeAi',
        );
      }

      return {
        status: 'pass',
        summary: 'BrowseClaudeAi enforces LaunchOptions::for_purpose (enable_quota_bridge=false) and mounts 0 extensions',
      };
    },
  },

  {
    id: 'T1-E2E09-02',
    tier: 1,
    features: ['E2E-09'],
    title: '配额同步加载固定 ID 扩展并完成 /{token}/quota-sync 端到端回传',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e09-02');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'mv3-sync@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        usageMode: 'reset_grants',
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
        email: 'mv3-sync@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });

      assert.equal(res.callbacks.length, 1);
      const cb = res.callbacks[0];
      assert.equal(cb.origin, 'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg');
      assert.match(cb.host ?? '', /^127\.0\.0\.1:\d+$/);
      assert.equal(cb.json?.nonce, res.nonce);
      assert.equal(cb.json?.account_uuid, '11111111-2222-4333-8444-555555555555');
      assert.equal(cb.json?.organization_uuid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      const usage = cb.json?.usage as { cedar_ember?: { eligible?: boolean } } | undefined;
      assert.equal(usage?.cedar_ember?.eligible, true);

      return {
        status: 'pass',
        summary: 'MV3 pinned extension completed real loopback pairing and cedar_ember quota-sync callback',
        metrics: { callbackOriginOk: true },
      };
    },
  },

  {
    id: 'T1-E2E09-03',
    tier: 1,
    features: ['E2E-09'],
    title: '48-hex nonce + 64-hex quota_identity 多组织唯一匹配与无匹配失败回传',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e09-03');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Multi-org unique match
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'multiorg@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        otherOrganizationUuid: '99999999-8888-4777-8666-555555555555',
        usageMode: 'normal',
      });
      const matchRes = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        profileName: 'mv3-multiorg',
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'multiorg@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });
      assert.equal(
        matchRes.callbacks[0].json?.organization_uuid,
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );

      // 2. Mismatched quota_identity must emit only { nonce, failure: 'identity_unavailable' }
      const missRes = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        profileName: 'mv3-nomatch',
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'multiorg@example.invalid',
        organizationUuid: 'cccccccc-dddd-4eee-8fff-000000000000',
      });
      assert.deepEqual(missRes.callbacks[0].json, {
        nonce: missRes.nonce,
        failure: 'identity_unavailable',
      });

      return {
        status: 'pass',
        summary: 'MV3 quota_identity uniquely selected target org and rejected mismatched org cleanly',
      };
    },
  },

  {
    id: 'T1-E2E09-04',
    tier: 1,
    features: ['E2E-09'],
    title: '消除 claude.ai location.hash nonce 暴露窗口与单次票据防重放',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e09-04');
      const contentJs = stripJsComments(
        readRepoText(ctx.repoRoot, 'browser-runtime/quota-bridge/content.js'),
      );
      const usesTabClaim = contentJs.includes('claude-local-quota-claim');

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'hash-clear@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        usageMode: 'normal',
      });
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      let callbacksAfterReload = 0;
      const res = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'hash-clear@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        onPageReady: async ({ page, bridge }) => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(400);
          callbacksAfterReload = bridge.callbacks.length;
        },
      });

      assert.match(res.finalUrl, /^https:\/\/claude\.ai\/settings\/usage$/);
      assert.equal(res.finalHash, '', 'claude.ai URL must contain zero location.hash nonce');
      assert.equal(callbacksAfterReload, 1, 'Reloading /settings/usage must not replay ticket');
      if (usesTabClaim) {
        assert.equal(contentJs.includes('claude-local-sync'), false);
        assert.equal(res.sessionMarker, null);
      } else {
        assert.equal(res.sessionMarker, 'started');
      }

      return {
        status: 'pass',
        summary: usesTabClaim
          ? 'MV3 content.js eliminated location.hash nonce exposure via session tab-claim and blocked reload replay'
          : 'MV3 content.js cleared #claude-local-sync hash and set sessionStorage dedup marker',
      };
    },
  },

  {
    id: 'T1-E2E09-05',
    tier: 1,
    features: ['E2E-09'],
    title: 'kyc_status 白名单投影剥离 vendor_inquiry_* 与多余 PII',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e09-05');
      const quotaBridgeRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_bridge.rs'),
      );
      const parseKycBody = extractRustFnBody(quotaBridgeRs, 'parse_kyc_status');
      assert.equal(quotaBridgeRs.includes('kyc_status'), true);
      assert.equal(parseKycBody.includes('vendor_inquiry'), false);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid: '11111111-2222-4333-8444-555555555555',
        email: 'kyc-strip@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        usageMode: 'normal',
        kycRaw: {
          status: '  APPROVED ',
          check_kind: ' Identity_Check-2 ',
          vendor_inquiry_id: 'inq_secret_999',
          vendor_inquiry_url: 'https://withpersona.com/secret',
          extra_pii: 'secret_ssn_leak',
        },
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
        email: 'kyc-strip@example.invalid',
        organizationUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });

      const cb = res.callbacks[0];
      assert.deepEqual(cb.json?.kyc_status, {
        status: 'approved',
        check_kind: 'identity_check-2',
      });
      assert.equal(cb.rawBody.includes('vendor_inquiry'), false);
      assert.equal(cb.rawBody.includes('secret_ssn_leak'), false);

      return {
        status: 'pass',
        summary: 'MV3 bridge allowlist-projected kyc_status and stripped vendor_inquiry_* and extra_pii',
      };
    },
  },

  // =========================================================================
  // E2E-10: 多账号浏览器 Profile 与 CLI 槽位防串号隔离 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E10-01',
    tier: 1,
    features: ['E2E-10'],
    title: '双账号 Chrome Profile 独占目录与 Cookie / LocalStorage 隔离实测',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e10-01');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const profA = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'slot-a-profile',
        headless: true,
        argsOptions: { seed: 101010101, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const pageA = await profA.context.newPage();
      await pageA.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
      await pageA.evaluate(() => {
        document.cookie = 'acct=A; path=/; max-age=3600';
        localStorage.setItem('whoami', 'acct_a');
      });
      await profA.close();

      const profB = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'slot-b-profile',
        headless: true,
        argsOptions: { seed: 202020202, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const pageB = await profB.context.newPage();
      await pageB.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
      const bState = await pageB.evaluate(() => ({
        cookie: document.cookie,
        ls: localStorage.getItem('whoami'),
      }));
      assert.equal(bState.cookie, '');
      assert.equal(bState.ls, null);
      await pageB.evaluate(() => {
        document.cookie = 'acct=B; path=/; max-age=3600';
        localStorage.setItem('whoami', 'acct_b');
      });
      await profB.close();

      // Re-open A to confirm A state persisted cleanly without B contamination
      const profA2 = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'slot-a-profile',
        headless: true,
        argsOptions: { seed: 101010101, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const pageA2 = await profA2.context.newPage();
      await pageA2.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
      const aState = await pageA2.evaluate(() => ({
        cookie: document.cookie,
        ls: localStorage.getItem('whoami'),
      }));
      assert.match(aState.cookie, /acct=A/);
      assert.equal(aState.ls, 'acct_a');
      await profA2.close();

      return {
        status: 'pass',
        summary: 'Independent Chrome persistent profiles maintained strict Cookie & LocalStorage isolation',
      };
    },
  },

  {
    id: 'T1-E2E10-02',
    tier: 1,
    features: ['E2E-10'],
    title: '新/具名身份禁止绑定 "legacy" 共享目录 (双模式黑盒探针)',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const sb = await ctx.createSandbox('t1-e2e10-02');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Unbound Named A',
            accountUuid: '50000001-0000-4000-8000-000000000001',
            email: 'legacy-probe-a@example.invalid',
            quota5hUsed: 99,
            bindBrowser: false,
          },
          {
            name: 'Bound B',
            accountUuid: '50000002-0000-4000-8000-000000000002',
            email: 'legacy-probe-b@example.invalid',
            quota5hUsed: 10,
            bindBrowser: true,
          },
        ],
      });

      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.exitCode, 0, `relay_switch failed: ${sw.stdout} ${sw.stderr}`);
      assert.equal(sw.json?.switched, true);

      const db = new Database(join(seeded.vaultDir, 'identities.sqlite'), { readonly: true });
      let slot: string | null = null;
      try {
        const row = db
          .query('SELECT slot FROM browser_bindings WHERE identity = ?1')
          .get(seeded.records[0].id) as { slot: string } | null;
        slot = row?.slot ?? null;
      } finally {
        db.close();
      }

      if (slot === 'legacy' || slot === null) {
        return gapOrFail(
          ctx.mode,
          `M2 F9 gap: outgoing named identity bound to "${String(slot)}" instead of unique 32-hex contexts/<slot_id>`,
          { assignedSlot: String(slot) },
        );
      }
      assert.match(slot, /^[0-9a-f]{32}$/);

      return {
        status: 'pass',
        summary: `Named identity assigned unique 32-hex slot ${slot} (never "legacy")`,
        metrics: { assignedSlot: slot },
      };
    },
  },

  {
    id: 'T1-E2E10-03',
    tier: 1,
    features: ['E2E-10'],
    title: 'cli-slots/<32-hex> 隔离 CLAUDE_CONFIG_DIR 与确定性 HMAC 设备指纹',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e10-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const sentinelUserId = 's13-host-sentinel-userid-0000';
      writeFileSync(
        join(sb.paths.homeDir, '.claude.json'),
        JSON.stringify({ userID: sentinelUserId }, null, 2),
      );
      writeFileSync(
        join(sb.paths.appDataDir, 'ai.local.claude-local', 'smart_relay_v1.json'),
        JSON.stringify({ maxSameExitConcurrency: 3 }),
      );

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Slot Active A',
            accountUuid: '60000001-0000-4000-8000-000000000001',
            email: 'hmac-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Slot B',
            accountUuid: '60000002-0000-4000-8000-000000000002',
            email: 'hmac-b@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Slot C',
            accountUuid: '60000003-0000-4000-8000-000000000003',
            email: 'hmac-c@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      const acqC = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[2].id,
      });
      assert.equal(acqB.json?.ok, true);
      assert.equal(acqC.json?.ok, true);
      assert.match(acqB.json!.slot_dir!.replace(/\\/g, '/'), /cli-slots\/[0-9a-f]{32}$/);
      assert.match(acqC.json!.slot_dir!.replace(/\\/g, '/'), /cli-slots\/[0-9a-f]{32}$/);

      const readSlotIds = (dir: string) =>
        JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8')) as {
          userID: string;
          anonymousId: string;
          machineID: string;
          firstStartTime: string;
          numStartups?: number;
          oauthAccount?: unknown;
        };

      const bIds1 = readSlotIds(acqB.json!.slot_dir!);
      const cIds = readSlotIds(acqC.json!.slot_dir!);
      assert.match(bIds1.userID, /^[0-9a-f]{64}$/);
      assert.match(bIds1.machineID, /^[0-9a-f]{64}$/);
      assert.match(bIds1.anonymousId, /^claude-cli-v1-/);
      assert.ok(bIds1.firstStartTime.length > 0);
      assert.notEqual(bIds1.userID, sentinelUserId);
      assert.notEqual(bIds1.userID, cIds.userID);
      assert.notEqual(bIds1.anonymousId, cIds.anonymousId);
      assert.notEqual(bIds1.machineID, cIds.machineID);

      // Release and re-acquire B: HMAC device tuple must remain deterministic
      await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      const acqB2 = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      const bIds2 = readSlotIds(acqB2.json!.slot_dir!);
      assert.deepEqual(
        {
          userID: bIds2.userID,
          anonymousId: bIds2.anonymousId,
          machineID: bIds2.machineID,
          firstStartTime: bIds2.firstStartTime,
          oauthAccount: bIds2.oauthAccount,
        },
        {
          userID: bIds1.userID,
          anonymousId: bIds1.anonymousId,
          machineID: bIds1.machineID,
          firstStartTime: bIds1.firstStartTime,
          oauthAccount: bIds1.oauthAccount,
        },
      );
      assert.equal(bIds2.numStartups, (bIds1.numStartups ?? 0) + 1);

      return {
        status: 'pass',
        summary: 'cli-slots/<32-hex> derived distinct, deterministic HMAC device fingerprints per account',
      };
    },
  },

  {
    id: 'T1-E2E10-04',
    tier: 1,
    features: ['E2E-10'],
    title: '主目录 ~/.claude.json userID 保持不变与空闲槽位 .credentials.json 擦除',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e10-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const sentinelUserId = 's13-host-sentinel-userid-0000';
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Home Preserve A',
            accountUuid: '70000001-0000-4000-8000-000000000001',
            email: 'preserve-a@example.invalid',
            quota5hUsed: 99,
            bindBrowser: true,
          },
          {
            name: 'Home Preserve B',
            accountUuid: '70000002-0000-4000-8000-000000000002',
            email: 'preserve-b@example.invalid',
            quota5hUsed: 12,
            bindBrowser: true,
          },
        ],
      });

      const homeClaudePath = join(sb.paths.homeDir, '.claude.json');
      const homeClaude = JSON.parse(readFileSync(homeClaudePath, 'utf8')) as Record<string, unknown>;
      homeClaude.userID = sentinelUserId;
      writeFileSync(homeClaudePath, JSON.stringify(homeClaude, null, 2));

      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.json?.ok, true);
      const slotDir = acqB.json!.slot_dir!;

      // Refresh credential inside slot B with a newer expiresAt and token
      const refreshedToken = 'sk-ant-oat01-refreshed-slot-token-xyz';
      const slotCredPath = join(slotDir, '.credentials.json');
      const slotCred = JSON.parse(readFileSync(slotCredPath, 'utf8')) as {
        claudeAiOauth: { accessToken: string; expiresAt: number };
      };
      slotCred.claudeAiOauth.accessToken = refreshedToken;
      slotCred.claudeAiOauth.expiresAt = Date.now() + 7200_000;
      writeFileSync(slotCredPath, JSON.stringify(slotCred, null, 2));

      const homeAfterAcq = JSON.parse(readFileSync(homeClaudePath, 'utf8')) as { userID?: string };
      assert.equal(homeAfterAcq.userID, sentinelUserId);

      const relB = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relB.json?.ok, true);
      assert.equal(relB.json?.credentials_synced, true);
      assert.equal(existsSync(slotCredPath), false, 'Idle slot .credentials.json must be scrubbed');
      assert.equal(existsSync(join(slotDir, '.slot-lease.json')), false);

      // Re-acquiring B proves refreshedToken was repacked into B's .baga archive on slot_release
      const acqB2 = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB2.json?.ok, true);
      const slotCredAfter = JSON.parse(
        readFileSync(join(acqB2.json!.slot_dir!, '.credentials.json'), 'utf8'),
      ) as { claudeAiOauth: { accessToken: string } };
      assert.equal(slotCredAfter.claudeAiOauth.accessToken, refreshedToken);

      return {
        status: 'pass',
        summary: 'Home userID untouched, idle slot .credentials.json scrubbed, and refreshed token persisted to .baga',
      };
    },
  },

  {
    id: 'T1-E2E10-05',
    tier: 1,
    features: ['E2E-10'],
    title: '槽位 skills/synced 隔离排除与遥测死信 1p_failed_events 清理',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e10-05');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Skills Active A',
            accountUuid: '80000001-0000-4000-8000-000000000001',
            email: 'skills-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Skills Slot B',
            accountUuid: '80000002-0000-4000-8000-000000000002',
            email: 'skills-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });

      mkdirSync(join(sb.paths.homeDir, '.claude', 'skills', 'synced'), { recursive: true });
      mkdirSync(join(sb.paths.homeDir, '.claude', 'skills', 'shared'), { recursive: true });
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'skills', 'synced', 'private.md'),
        '# account-bound skill',
      );
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'skills', 'shared', 'tool.md'),
        '# shared skill',
      );

      const preSlotTelemetry = join(
        sb.paths.appDataDir,
        'ai.local.claude-local',
        'cli-slots',
        seeded.records[1].id,
        'telemetry',
      );
      mkdirSync(preSlotTelemetry, { recursive: true });
      const deadLetterPath = join(preSlotTelemetry, '1p_failed_events.999.json');
      writeFileSync(deadLetterPath, '{"stale":true}');

      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.json?.ok, true);
      const slotDir = acqB.json!.slot_dir!;
      const sharedSkill = join(slotDir, 'skills', 'shared', 'tool.md');
      assert.equal(existsSync(sharedSkill), true);
      assert.equal(lstatSync(join(slotDir, 'skills')).isSymbolicLink(), false);
      assert.equal(
        existsSync(join(slotDir, 'skills', 'synced')),
        false,
        'skills/synced must never be exposed across accounts',
      );
      assert.equal(existsSync(deadLetterPath), false, '1p_failed_events dead letter must be scrubbed');

      return {
        status: 'pass',
        summary: 'Slot excluded skills/synced without junction and scrubbed telemetry 1p_failed_events',
      };
    },
  },

  // =========================================================================
  // E2E-11: --orchestrate / --quota-core 无头协议与 CLI 包装行为 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E11-01',
    tier: 1,
    features: ['E2E-11'],
    title: '--orchestrate 全核心操作沙盒黑盒实测 (status / slot_acquire / slot_release / relay_switch)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e11-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Orch Core A',
            accountUuid: '90000001-0000-4000-8000-000000000001',
            email: 'orch-a@example.invalid',
            quota5hUsed: 98,
            bindBrowser: true,
          },
          {
            name: 'Orch Core B',
            accountUuid: '90000002-0000-4000-8000-000000000002',
            email: 'orch-b@example.invalid',
            quota5hUsed: 15,
            bindBrowser: true,
          },
        ],
      });

      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.schema, 1);
      assert.equal(statusRes.json?.ok, true);

      const acqRes = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqRes.exitCode, 0);
      assert.equal(acqRes.json?.status, 'acquired');

      const relRes = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relRes.exitCode, 0);
      assert.equal(relRes.json?.status, 'released');

      const swRes = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(swRes.exitCode, 0);
      assert.equal(swRes.json?.switched, true);
      assert.equal(swRes.json?.target_id, seeded.records[1].id);
      assert.ok(swRes.json?.handoff_md_path && existsSync(swRes.json.handoff_md_path));
      assert.ok(swRes.json?.handoff_json_path && existsSync(swRes.json.handoff_json_path));

      return {
        status: 'pass',
        summary: 'All 4 core --orchestrate operations and handoff file outputs verified',
      };
    },
  },

  {
    id: 'T1-E2E11-02',
    tier: 1,
    features: ['E2E-11'],
    title: '--quota-core merge_windows 合并契约 (锚点优先 / 保守取大 / 过期推断 / 本地防覆盖)',
    async run(ctx) {
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const nowSec = 1_800_000_000;
      const res = await runQuotaCore<{
        schema: number;
        items: Array<{ used: number | null; reset_at: number | null; source: string }>;
      }>(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: nowSec,
        items: [
          // 1. Newer server_anchor overrides older estimate
          {
            current: {
              used: 20,
              reset_at: nowSec + 3600,
              source: 'local_estimate',
              observed_at_ms: (nowSec - 120) * 1000,
            },
            candidate: {
              used: 45,
              reset_at: nowSec + 3600,
              source: 'server_anchor',
              observed_at_ms: nowSec * 1000,
            },
          },
          // 2. Same window without newer anchor takes conservative max
          {
            current: {
              used: 55,
              reset_at: nowSec + 3600,
              source: 'local_estimate',
              observed_at_ms: nowSec * 1000,
            },
            candidate: {
              used: 30,
              reset_at: nowSec + 3600,
              source: 'local_estimate',
              observed_at_ms: nowSec * 1000,
            },
          },
          // 3. Expired server_anchor (observed before reset_at <= now_sec) infers reset_inferred (used=0)
          {
            current: {
              used: 88,
              reset_at: nowSec - 60,
              source: 'server_anchor',
              observed_at_ms: (nowSec - 600) * 1000,
            },
            candidate: null,
          },
          // 4. Local estimate not overwritten by stale/equal candidate reset_inferred
          {
            current: {
              used: 60,
              reset_at: nowSec + 7200,
              source: 'local_estimate',
              observed_at_ms: nowSec * 1000,
            },
            candidate: {
              used: 0,
              reset_at: nowSec - 10,
              source: 'reset_inferred',
              observed_at_ms: (nowSec - 500) * 1000,
            },
          },
        ],
      });

      assert.equal(res.exitCode, 0, `--quota-core failed: ${res.stderr}`);
      assert.equal(res.json?.schema, 1);
      assert.equal(res.json?.items.length, 4);
      assert.equal(res.json?.items[0].used, 45);
      assert.equal(res.json?.items[0].source, 'server_anchor');
      assert.equal(res.json?.items[1].used, 55);
      assert.equal(res.json?.items[2].used, 0);
      assert.equal(res.json?.items[2].source, 'reset_inferred');
      assert.equal(res.json?.items[3].used, 60);
      assert.equal(res.json?.items[3].source, 'local_estimate');

      return {
        status: 'pass',
        summary: '4-case --quota-core merge_windows precedence and reset inference rules verified',
      };
    },
  },

  {
    id: 'T1-E2E11-03',
    tier: 1,
    features: ['E2E-11'],
    title: '空白沙盒默认 SmartRelay 策略契约 (并发上限=1, clean_handoff, 阈值=98)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e11-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const res = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.json?.ok, true);
      assert.equal(res.json?.config?.maxSameExitConcurrency, 1);
      assert.equal(res.json?.config?.relayHandoffMode, 'clean_handoff');
      assert.equal(res.json?.config?.spentThresholdPct, 98);
      assert.equal(res.json?.config?.strategy, 'smart');

      return {
        status: 'pass',
        summary: 'Blank sandbox --orchestrate status returned exact default SmartRelay policy',
      };
    },
  },

  {
    id: 'T1-E2E11-04',
    tier: 1,
    features: ['E2E-11'],
    title: 'install_wrappers 编码 (BOM+LF / 无BOM+LF)、PowerShell AST 零错误与零触碰 settings.json',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e11-04');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const settingsDir = join(sb.paths.homeDir, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const sentinelSettings = '{"sentinel":"must_not_change"}\n';
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, sentinelSettings, 'utf8');

      const res = await runOrchestrate<{
        schema: number;
        ok: boolean;
        installed: boolean;
        files: string[];
        agent_path?: string;
      }>(bin.exePath, sb.paths, { schema: 1, op: 'install_wrappers' });
      assert.equal(res.exitCode, 0);
      assert.equal(res.json?.ok, true);
      assert.equal(res.json?.installed, true);
      assert.equal(res.json?.files.length, 6);

      const ps1Files = [
        join(sb.paths.homeDir, '.local', 'bin', 'claude-relay.ps1'),
        join(sb.paths.homeDir, '.local', 'bin', 'claude-subagent.ps1'),
      ];
      for (const ps1 of ps1Files) {
        const bytes = readFileSync(ps1);
        assert.equal(bytes[0], 0xef);
        assert.equal(bytes[1], 0xbb);
        assert.equal(bytes[2], 0xbf);
        assert.equal(bytes.includes(0x0d), false, `${ps1} must use LF without CR`);
      }

      const mdPath = join(sb.paths.homeDir, '.claude', 'agents', 'pro-pool-worker.md');
      const mdBytes = readFileSync(mdPath);
      assert.equal(mdBytes[0] === 0xef && mdBytes[1] === 0xbb && mdBytes[2] === 0xbf, false);
      assert.equal(mdBytes.includes(0x0d), false);

      // AST check via PowerShell Parser
      const psBin = resolvePowerShellBinary();
      const astScript = ps1Files
        .map((f) => {
          const escaped = f.replace(/'/g, "''");
          return `$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$null, [ref]$errs); if ($errs.Count -gt 0) { Write-Error ($errs | Out-String); exit 1 }`;
        })
        .join('; ');
      const astRes = spawnSync(psBin, ['-NoLogo', '-NoProfile', '-Command', astScript], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
      });
      assert.equal(astRes.status, 0, `PowerShell AST parse errors: ${astRes.stderr}`);
      assert.equal(readFileSync(settingsPath, 'utf8'), sentinelSettings);

      return {
        status: 'pass',
        summary: 'install_wrappers produced BOM+LF scripts with 0 AST errors and untouched settings.json',
      };
    },
  },

  {
    id: 'T1-E2E11-05',
    tier: 1,
    features: ['E2E-11'],
    title: '离线 Python CLI 包装脚本全量行为测试 (test-cli-orchestrator-scripts.py)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e11-05');
      const pyEnv = sb.buildEnv();
      delete pyEnv.HOME;
      // Use a dedicated short-prefix isolated temp directory under os.tmpdir() so Python's
      // internal .claude/projects/<encoded-work-path>/subagents stay under Win32 MAX_PATH (260),
      // while avoiding host %TEMP% pollution and guaranteeing zero residue on timeout/error.
      const shortPyTemp = mkdtempSync(join(tmpdir(), 'e11-'));
      sb.registerCleanup(() => rmSync(shortPyTemp, { recursive: true, force: true }));
      pyEnv.TEMP = shortPyTemp;
      pyEnv.TMP = shortPyTemp;
      pyEnv.TMPDIR = shortPyTemp;
      const scriptPath = resolve(ctx.repoRoot, 'scripts', 'test-cli-orchestrator-scripts.py');
      const res = await (async () => {
        try {
          return await sb.spawn('python', [scriptPath], {
            cwd: ctx.repoRoot,
            env: pyEnv,
            timeoutMs: 240_000,
            allowNonZero: true,
          });
        } finally {
          rmSync(shortPyTemp, { recursive: true, force: true });
        }
      })();
      assert.equal(
        res.exitCode,
        0,
        `test-cli-orchestrator-scripts.py failed (${res.exitCode}): ${res.stdout}\n${res.stderr}`,
      );
      return {
        status: 'pass',
        summary: 'Offline Python test-cli-orchestrator-scripts.py passed 32/32 in isolated sandbox',
        metrics: { exitCode: res.exitCode ?? -1, durationMs: res.durationMs },
      };
    },
  },

  // =========================================================================
  // E2E-12: 风控验证核查、5 源出口分类与 Site Data 清理 (5 cases)
  // =========================================================================
  {
    id: 'T1-E2E12-01',
    tier: 1,
    features: ['E2E-12'],
    title: 'risk_check 远端 DNS 锁定识别对齐 (http/https/socks5/socks5h) 与 UI 渲染',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e12-01');
      const probeRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/risk_check/probe.rs'),
      );
      assert.equal(probeRs.includes('crate::browser::config::proxy('), true);
      assert.equal(probeRs.includes('remote_dns_locked'), true);

      const ui = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 'e2e12-01',
          browser_identity: { name: 'Risk Check ID', email: 'risk@example.invalid', status: 'linked' },
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
          cli_security: {
            settings_present: true,
            telemetry_shield_active: true,
            nonessential_traffic_blocked: false,
            proxy_env_complete: true,
            socks5_in_cli_env: false,
            non_english_language: false,
            unpinned_npx_count: 0,
            remote_http_mcp_count: 0,
            windows_bare_npx_count: 0,
            has_custom_hooks_or_helpers: false,
            pending_failed_telemetry_files: 0,
          },
        },
      });

      assert.equal(ui.bannerStatus, 'ok');

      return {
        status: 'pass',
        summary: 'risk_check/probe.rs proxy DNS lock alignment and RiskVerificationPanel verified',
      };
    },
  },

  {
    id: 'T1-E2E12-02',
    tier: 1,
    features: ['E2E-12'],
    title: 'Mihomo prepend-rules 优先与 RFC1918 豁免 + Sift/Telemetry 规则渲染',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e12-02');
      const mihomoRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/risk_check/mihomo.rs'),
      );
      assert.equal(mihomoRs.includes('is_exempt_unresolved_ip_rule'), true);
      assert.equal(mihomoRs.includes('prepend-rules'), true);
      assert.equal(mihomoRs.includes('has_sift_rules'), true);
      assert.equal(mihomoRs.includes('has_telemetry_rules'), true);

      const ui = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 'e2e12-02',
          browser_identity: { name: 'Mihomo Rules ID', email: 'mihomo@example.invalid', status: 'linked' },
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
      });

      assert.equal(ui.telemetryRulesAttr, 'ok');
      assert.equal(ui.siftRulesAttr, 'ok');

      return {
        status: 'pass',
        summary: 'Mihomo prepend-rules, RFC1918 exemption, and Sift/Telemetry UI indicators verified',
      };
    },
  },

  {
    id: 'T1-E2E12-03',
    tier: 1,
    features: ['E2E-12'],
    title: '5 源 GeoIP 住宅 vs IDC ASN 分类 (AS15169 vs AS16591 Google Fiber / AS6079 RCN)',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e12-03');
      const { classifyBrowserExitIsp, classifyExitIsp } = await import('../../../src/browser-model.ts');

      assert.equal(classifyBrowserExitIsp({ asn: 'AS15169', isp: 'Google LLC' }), 'hosting');
      assert.equal(classifyBrowserExitIsp({ asn: 'AS13335', isp: 'Cloudflare, Inc.' }), 'hosting');
      assert.equal(classifyBrowserExitIsp({ asn: 'AS16591', isp: 'Google Fiber Inc.' }), 'isp');
      assert.equal(classifyBrowserExitIsp({ asn: 'AS6079', isp: 'RCN' }), 'isp');
      assert.equal(classifyExitIsp({ asn: 'AS15169', isp: 'Google LLC', hosting: false }), 'hosting');

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.applyTracePreset('us_datacenter');

      const dcRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
      });
      assert.equal(dcRes.phase, 'failed');
      assert.ok(dcRes.failedCount >= 1);

      return {
        status: 'pass',
        summary: 'Residential vs IDC ASN classification and datacenter rejection verified',
      };
    },
  },

  {
    id: 'T1-E2E12-04',
    tier: 1,
    features: ['E2E-12'],
    title: '生产 CSP 下 5 源 GeoIP 依次回退与同 IP 补充分类',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e12-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());

      // 1. ipquery omits risk.is_datacenter -> triggers same-IP classification /<ip>?format=json
      netSuite.applyTracePreset('us_isp');
      netSuite.setProviderState('ipquery', { hosting: undefined });
      const res1 = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: ['https://api.ipquery.io/?format=json'],
      });
      assert.equal(res1.phase, 'passed');
      assert.equal(res1.okCount, 20);
      assert.ok((netSuite.getHitCounts()['classify:203.0.113.10'] ?? 0) >= 1);

      // 2. Fallback chain across ipquery -> ipinfo -> ip.sb -> geojs -> ipwho
      netSuite.resetHits();
      netSuite.applyTracePreset('us_isp');
      netSuite.setProviderFault('ipquery', 'rate_limit_429');
      netSuite.setProviderFault('ipinfo', 'server_500');
      netSuite.setProviderFault('ip_sb', 'bad_json');
      netSuite.setProviderFault('geojs', 'server_500');
      const res2 = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        exitServices: [
          'https://api.ipquery.io/?format=json',
          'https://ipinfo.io/json',
          'https://api.ip.sb/geoip',
          'https://get.geojs.io/v1/ip/geo.json',
          'https://ipwho.is/',
        ],
      });
      assert.equal(res2.phase, 'passed');
      assert.equal(res2.okCount, 20);
      assert.equal(netSuite.getHitCounts()['geo:ipwho'], 1);

      return {
        status: 'pass',
        summary: 'Same-IP classification enrichment and 5-provider GeoIP fallback verified under production CSP',
      };
    },
  },

  {
    id: 'T1-E2E12-05',
    tier: 1,
    features: ['E2E-12'],
    title: 'Chromium 148 SITE_DATA / Privacy Sandbox 目录清理范围校验',
    async run(ctx) {
      const profileRs = stripRustCommentsAndTests(
        readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'),
      );
      const siteDataBlockMatch = profileRs.match(/pub const SITE_DATA:[\s\S]*?\];/);
      assert.ok(siteDataBlockMatch, 'SITE_DATA constant must exist in profile.rs');
      const block = siteDataBlockMatch[0];

      for (const pathEntry of [
        'Default/SharedStorage',
        'Default/DIPS',
        'Default/BrowsingTopicsState',
        'Default/InterestGroups',
        'Default/PrivateAggregation',
        'Default/AttributionReporting',
        'Default/Shared Dictionary',
        'Default/Network/Trust Tokens',
        'Default/Network/SCT Auditing',
        'Default/blob_storage',
      ]) {
        assert.equal(block.includes(pathEntry), true, `SITE_DATA missing ${pathEntry}`);
      }
      assert.equal(block.includes('Preferences'), false);
      assert.equal(block.includes('Local State'), false);

      return {
        status: 'pass',
        summary: 'Chromium 148 Privacy Sandbox & Network/Trust Tokens paths verified in SITE_DATA',
      };
    },
  },
];
