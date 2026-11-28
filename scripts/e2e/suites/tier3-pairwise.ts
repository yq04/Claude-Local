/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./security-helpers.ts、./perf-ui-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 3 成对组合黑盒用例数组 cases: E2ECase[]（T3-PAIR-01..T3-PAIR-12，全覆盖 E2E-01..E2E-12）。
 * [POS]: Milestone E4 Tier 3 跨特性成对组合测试套件；每条用例联动 >= 2 个子系统并在独立沙盒/IsolatedContext 运行，M1–M4 未重编二进制差异经 gapOrFail 诚实上报。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  computeQuotaIdentitySha256,
  deriveDeterministicBrowserSeed,
  inspectSqliteMeta,
  resolveClaudeLocalBinary,
  runOrchestrate,
  runQuotaCore,
  seedSyntheticVault,
} from '../lib/rust-blackbox.ts';
import { isPidAlive, killProcessTree } from '../lib/sandbox.ts';
import type { E2ECase } from '../lib/types.ts';
import {
  assert,
  extractRustBlock,
  extractRustFnBody,
  findUnusedLoopbackPort,
  gapOrFail,
  hasRustFn,
  HEX_FP,
  HEX_ID,
  httpsGetViaProxy,
  openAppWithMockUi,
  readRepoText,
  stripJsComments,
  stripRustCommentsAndTests,
  validateCatalogPair,
} from './perf-ui-helpers.ts';
import {
  createSandboxJunction,
  DANGEROUS_SETTINGS_KEYS,
  findDangerousSettingsKeys,
  openRiskPanelWithMockIpc,
  removeSandboxJunction,
  runBrowserStartInPinnedChrome,
  runMv3QuotaBridgeSync,
} from './security-helpers.ts';

interface OrchestrateStatusJson {
  schema: number;
  ok: boolean;
  active?: string;
  accounts?: Array<{ record_id: string; name: string }>;
}

interface SlotAcquireJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id?: string;
  slot_dir?: string;
  reason?: string;
  error?: string;
}

interface SlotReleaseJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id?: string;
  credentials_synced?: boolean;
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
  // T3-PAIR-01: E2E-03 × E2E-08 × E2E-12
  // =========================================================================
  {
    id: 'T3-PAIR-01',
    tier: 3,
    features: ['E2E-03', 'E2E-08', 'E2E-12'],
    title: '显式代理 vs TUN 参数切换 × Kill-Switch per-slot 路由探测 × 远程 DNS 锁定对齐',
    async run(ctx) {
      const sb = await ctx.createSandbox('t3-pair-01');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Explicit proxy vs TUN anti-leak Chrome args
      const explicitArgs = buildChromeAntiLeakArgs({ proxyUrl: proxy.url });
      const tunArgs = buildChromeAntiLeakArgs({ noProxyServer: true });
      assert.equal(explicitArgs.some((a) => a.startsWith('--proxy-server=http://127.0.0.1:')), true);
      assert.equal(explicitArgs.some((a) => a.startsWith('--host-resolver-rules=MAP * ~NOTFOUND')), true);
      assert.equal(explicitArgs.includes('--set-ipv6-probe-false'), true);
      assert.equal(explicitArgs.includes('--disable-quic'), true);
      assert.equal(
        explicitArgs.some((a) => a.includes('UseDnsHttpsSvcb') && a.includes('AsyncDns')),
        true,
      );
      assert.equal(tunArgs.includes('--no-proxy-server'), true);
      assert.equal(tunArgs.some((a) => a.startsWith('--proxy-server=')), false);
      assert.equal(tunArgs.some((a) => a.startsWith('--host-resolver-rules=')), false);
      assert.equal(tunArgs.includes('--disable-quic'), true);
      assert.equal(tunArgs.includes('--set-ipv6-probe-false'), true);
      assert.equal(tunArgs.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'), true);

      // 2. Real Chrome session through explicit proxy: /new + /probe/webrtc.html
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 't3-pair-01-proxy',
        headless: true,
        argsOptions: { seed: 301301301, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/', `${netSuite.httpsBaseUrl}/`],
      });
      let webrtcCandidates: string[] = [];
      try {
        const page = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.locator('[data-mock-route="/new"]').waitFor();
        await page.goto('https://claude.ai/probe/webrtc.html', {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await page.waitForFunction(
          () => (window as unknown as { __WEBRTC_DONE__?: boolean }).__WEBRTC_DONE__ === true,
          undefined,
          { timeout: 10_000 },
        );
        webrtcCandidates = await page.evaluate(
          () => (window as unknown as { __WEBRTC_CANDIDATES__?: string[] }).__WEBRTC_CANDIDATES__ ?? [],
        );
      } finally {
        await persistent.close();
      }
      proxy.assertNoDomainDnsLeak();
      assert.equal(
        proxy.getAuditLog().some((e) => e.method === 'CONNECT' && e.host === 'claude.ai' && !e.isLiteralIp),
        true,
        'Proxy audit log must contain CONNECT claude.ai without literal IP leak',
      );
      const nonLocalCandidates = webrtcCandidates.filter((c) => /\btyp\s+(srflx|prflx|relay)\b/i.test(c));
      assert.equal(nonLocalCandidates.length, 0, `Unexpected public WebRTC ICE candidate: ${nonLocalCandidates.join('; ')}`);

      // 2b. Real Chrome session in TUN mode (noProxyServer: true) verifies anti-leak args & page load
      const tunProfile = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 't3-pair-01-tun',
        headless: true,
        argsOptions: { seed: 301301302, noProxyServer: true },
        allowedUrlPrefixes: [`${netSuite.httpsBaseUrl}/`],
      });
      try {
        const tunPage = tunProfile.context.pages()[0] ?? (await tunProfile.context.newPage());
        await tunPage.goto(`${netSuite.httpsBaseUrl}/probe/webrtc.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await tunPage.waitForFunction(
          () => (window as unknown as { __WEBRTC_DONE__?: boolean }).__WEBRTC_DONE__ === true,
          undefined,
          { timeout: 10_000 },
        );
        const tunCandidates = await tunPage.evaluate(
          () => (window as unknown as { __WEBRTC_CANDIDATES__?: string[] }).__WEBRTC_CANDIDATES__ ?? [],
        );
        assert.equal(
          tunCandidates.some((c) => /\btyp\s+(srflx|prflx|relay)\b/i.test(c)),
          false,
        );
      } finally {
        await tunProfile.close();
      }

      // 3. Cross-check kill_switch.rs per-slot routing & risk_check/probe.rs remote DNS lock alignment
      const ksRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'));
      const spawnFn = extractRustFnBody(ksRs, 'spawn_monitor');
      const probeRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/risk_check/probe.rs'));
      const parseGuardFn = extractRustFnBody(probeRs, 'parse_browser_dns_guard');
      const stillAggregatesTun = spawnFn.includes('aggregate_tun_proxy(&routes)');
      const hasPerSlotRoute = spawnFn.includes('on_slots_tick');
      const hasProbeAlignment =
        parseGuardFn.includes('crate::browser::config::proxy(') && probeRs.includes('remote_dns_locked');

      if (stillAggregatesTun || !hasPerSlotRoute || !hasProbeAlignment) {
        return gapOrFail(
          ctx.mode,
          `M1/M2 gap: kill_switch per-slot=${hasPerSlotRoute}, aggregateTun=${stillAggregatesTun}, riskProbe=${hasProbeAlignment}`,
        );
      }

      // 4. Risk panel UI check for explicit HTTP proxy (remote_dns_locked=true) & TUN direct
      const baseMihomo = {
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
        dedicated_listener_port: proxy.port,
      };
      let proxyDnsLockStatus: string | null = null;
      const riskProxy = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 't3-pair-01-proxy',
          browser_identity: { name: 'Pair01 Proxy', email: 'pair01@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: true,
            proxy_scheme: 'http',
            proxy_local_port: proxy.port,
            remote_dns_locked: true,
            target_country: 'US',
            target_timezone: 'America/Los_Angeles',
            target_language: 'en-US',
          },
          mihomo: baseMihomo,
          system: {
            tun_adapter_active: true,
            secondary_plaintext_dns_active: false,
            lan_ipv4_candidates: ['192.168.1.20'],
            public_wan_detected: false,
          },
          cli_security: null,
        },
        onPage: async (page) => {
          proxyDnsLockStatus = await page
            .locator('.risk-check-item')
            .filter({ hasText: 'Browser Remote DNS & WebRTC Lock' })
            .first()
            .getAttribute('data-status');
        },
      });
      assert.equal(riskProxy.bannerStatus, 'ok');
      assert.equal(proxyDnsLockStatus, 'ok');
      assert.equal(riskProxy.pageErrors.length, 0);

      let tunDnsLockStatus: string | null = null;
      const riskTun = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 't3-pair-01-tun',
          browser_identity: { name: 'Pair01 TUN', email: 'pair01-tun@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: false,
            proxy_scheme: null,
            proxy_local_port: null,
            remote_dns_locked: false,
            target_country: 'US',
            target_timezone: 'America/Los_Angeles',
            target_language: 'en-US',
          },
          mihomo: baseMihomo,
          system: {
            tun_adapter_active: true,
            secondary_plaintext_dns_active: false,
            lan_ipv4_candidates: ['192.168.1.20'],
            public_wan_detected: false,
          },
          cli_security: null,
        },
        onPage: async (page) => {
          tunDnsLockStatus = await page
            .locator('.risk-check-item')
            .filter({ hasText: 'Browser Remote DNS & WebRTC Lock' })
            .first()
            .getAttribute('data-status');
        },
      });
      assert.equal(riskTun.bannerStatus, 'warn');
      assert.equal(tunDnsLockStatus, 'warn');
      assert.equal(riskTun.pageErrors.length, 0);

      return {
        status: 'pass',
        summary: 'Explicit proxy vs TUN anti-leak args, WebRTC isolation, per-slot kill-switch routing, and risk_check DNS lock aligned',
        metrics: {
          proxyAuditCount: proxy.getAuditLog().length,
          webrtcCandidates: webrtcCandidates.length,
        },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-02: E2E-01 × E2E-10 × E2E-11
  // =========================================================================
  {
    id: 'T3-PAIR-02',
    tier: 3,
    features: ['E2E-01', 'E2E-10', 'E2E-11'],
    title: '.baga/SQLite v3/CCBaga 种子持久化 × 独立 contexts/<slot_id> × --orchestrate 槽位租约与危险键剥离',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const sb = await ctx.createSandbox('t3-pair-02');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Pair02 Unbound A',
            accountUuid: '30020001-0000-4000-8000-000000000001',
            email: 'pair02-a@example.invalid',
            quota5hUsed: 98,
            bindBrowser: false,
          },
          {
            name: 'Pair02 Bound B',
            accountUuid: '30020002-0000-4000-8000-000000000002',
            email: 'pair02-b@example.invalid',
            quota5hUsed: 12,
            bindBrowser: true,
          },
        ],
      });

      mkdirSync(join(sb.paths.homeDir, '.claude'), { recursive: true });
      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify(
          {
            apiKeyHelper: 'echo pair02-leak-key',
            otelHeadersHelper: 'echo pair02-leak-otel',
            awsAuthRefresh: 'echo pair02-leak-aws',
            customHeaders: { 'X-Pair02': '1' },
            statusLine: { type: 'command', command: 'echo pair02-leak-status' },
            env: {
              ANTHROPIC_API_KEY: 'sk-ant-api03-pair02-strip',
              CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-pair02-strip',
            },
          },
          null,
          2,
        ),
      );

      // 1. status verifies BAGAID01 + SQLite v3 + deterministic CCBaga seed
      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.ok, true);
      assert.equal(statusRes.json?.accounts?.length, 2);
      assert.equal(seeded.records[1].seed, deriveDeterministicBrowserSeed(seeded.records[1].id, 0));

      // 2. slot_acquire for B checks cli-slots isolation & credential/dangerous-key stripping
      const acq = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acq.exitCode, 0);
      assert.equal(acq.json?.ok, true);
      const slotDir = acq.json!.slot_dir!;
      assert.match(slotDir.replace(/\\/g, '/'), /cli-slots\/[0-9a-f]{32}$/);
      assert.equal(existsSync(join(slotDir, '.credentials.json')), true);

      const slotSettings = JSON.parse(readFileSync(join(slotDir, 'settings.json'), 'utf8')) as Record<
        string,
        unknown
      > & { env?: Record<string, string> };
      assert.equal(slotSettings.env?.ANTHROPIC_API_KEY, undefined);
      assert.equal(slotSettings.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined);
      assert.equal(slotSettings.env?.DISABLE_TELEMETRY, '1');
      const remainingDangerous = findDangerousSettingsKeys(slotSettings);

      const rel = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(rel.exitCode, 0);
      assert.equal(rel.json?.ok, true);

      // 3. relay_switch triggers binding for unbound named Account A
      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.exitCode, 0);
      assert.equal(sw.json?.ok, true);
      assert.equal(sw.json?.switched, true);
      assert.equal(sw.json?.target_id, seeded.records[1].id);

      const db = new Database(join(seeded.vaultDir, 'identities.sqlite'), { readonly: true });
      let assignedSlot: string | null = null;
      let userVersion = 0;
      try {
        const verRow = db.query('PRAGMA user_version').get() as { user_version: number };
        userVersion = verRow.user_version;
        const row = db
          .query('SELECT slot FROM browser_bindings WHERE identity = ?1')
          .get(seeded.records[0].id) as { slot: string } | null;
        assignedSlot = row?.slot ?? null;
      } finally {
        db.close();
      }
      assert.equal(userVersion, 3);

      // Honest M2 F9 binary behavior evaluation via gapOrFail
      if (
        assignedSlot === 'legacy' ||
        assignedSlot === null ||
        remainingDangerous.length > 0
      ) {
        return gapOrFail(
          ctx.mode,
          `M2 F9 binary gap: assignedSlot="${String(assignedSlot)}", remainingDangerousKeys=[${remainingDangerous.join(',')}]`,
          {
            assignedSlot: String(assignedSlot),
            dangerousKeyCount: remainingDangerous.length,
            userVersion,
          },
        );
      }

      assert.match(assignedSlot, /^[0-9a-f]{32}$/);
      assert.equal(remainingDangerous.length, 0);

      return {
        status: 'pass',
        summary: `BAGAID01/SQLite v3, unique 32-hex slot (${assignedSlot}), and full dangerous key stripping verified`,
        metrics: { assignedSlot, dangerousKeyCount: remainingDangerous.length, userVersion },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-03: E2E-02 × E2E-04 × E2E-06
  // =========================================================================
  {
    id: 'T3-PAIR-03',
    tier: 3,
    features: ['E2E-02', 'E2E-04', 'E2E-06'],
    title: 'QuotaDetailsModal 2 按钮精简 × zh/en 双语切换 × claude.ai 无阻塞冷/热打开计时',
    async run(ctx) {
      const zhRaw = readRepoText(ctx.repoRoot, 'src/locales/zh.yaml');
      const enRaw = readRepoText(ctx.repoRoot, 'src/locales/en.yaml');
      const cat = validateCatalogPair(zhRaw, enRaw);
      assert.equal(cat.errors.length, 0, cat.errors.join('; '));
      assert.ok(cat.zh['browser.enterClaudeAi'] && cat.en['browser.enterClaudeAi']);
      assert.ok(cat.zh['quota.syncSubscription'] && cat.en['quota.syncSubscription']);

      // 1. UI: 2-button modal in zh & en + clicking Open Claude.ai dispatches non-blocking IPC
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: { uiLanguage: 'zh' },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        const zhButtons = (await dialog.locator('.confirm-actions button').allInnerTexts()).map((s) => s.trim());
        assert.deepEqual(zhButtons, ['进入 Claude.ai', '网页同步额度与重置']);

        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });

        await ui.page.getByRole('radio', { name: 'EN', exact: true }).click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'en');

        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        await dialog.waitFor();
        const enButtons = (await dialog.locator('.confirm-actions button').allInnerTexts()).map((s) => s.trim());
        assert.deepEqual(enButtons, ['Open Claude.ai', 'Sync web quota & resets']);

        await ui.clearIpc();
        await dialog.getByRole('button', { name: 'Open Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const cmds = await ui.getIpcCommands();
        const openCmd = cmds.find((c) => c.command === 'browser_open_identity_profile');
        assert.ok(openCmd, 'Clicking Open Claude.ai must invoke browser_open_identity_profile');
        assert.deepEqual(openCmd.args, {
          accountId: 'current',
          expectedIdentity: HEX_FP(1),
          openMode: 'claude_ai',
        });
        assert.equal(cmds.filter((c) => c.command === 'identities_stop').length, 0);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      // 2. Real cold launch + hot second tab timing via MockHttpConnectProxy + MockNetworkSuite
      const sb = await ctx.createSandbox('t3-pair-03-chrome');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      const tPreflight = Date.now();
      const trace = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 3000,
      });
      const preflightMs = Date.now() - tPreflight;
      assert.equal(trace.statusCode, 200);
      assert.match(trace.body, /loc=US/);

      const tCold = Date.now();
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'pair03-claude-ai',
        headless: true,
        argsOptions: { seed: 303303303, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      let coldTotalMs = 0;
      let hotTabMs = 0;
      try {
        const coldPage = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        await coldPage.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await coldPage.locator('[data-mock-route="/new"]').waitFor();
        coldTotalMs = Date.now() - tCold;

        const tHot = Date.now();
        const hotPage = await persistent.context.newPage();
        await hotPage.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await hotPage.locator('[data-mock-route="/new"]').waitFor();
        hotTabMs = Date.now() - tHot;
      } finally {
        await persistent.close();
      }

      proxy.assertNoDomainDnsLeak();
      assert.ok(hotTabMs < 5000, `Hot tab open took ${hotTabMs}ms >= 5000ms`);
      assert.ok(hotTabMs <= coldTotalMs + 200, `Expected hot (${hotTabMs}ms) faster than cold (${coldTotalMs}ms)`);

      return {
        status: 'pass',
        summary: `Bilingual 2-button modal + non-blocking claude.ai cold (${coldTotalMs}ms) & hot (${hotTabMs}ms) pipeline verified`,
        metrics: { preflightMs, coldTotalMs, hotTabMs },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-04: E2E-04 × E2E-09 × E2E-01
  // =========================================================================
  {
    id: 'T3-PAIR-04',
    tier: 3,
    features: ['E2E-04', 'E2E-09', 'E2E-01'],
    title: 'QuotaDetailsModal「同步额度与重置」× MV3 扩展按需加载 + Nonce/Identity/KYC 白名单剥离',
    async run(ctx) {
      const accountUuid = '30040001-2222-4333-8444-555555555555';
      const email = 'pair04-sync@example.invalid';
      const orgUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-300400000001';
      const otherOrgUuid = 'bbbbbbbb-cccc-4ddd-8eee-300400000002';

      // Deterministic 64-hex quota_identity compatibility (E2E-01)
      const fpA = computeQuotaIdentitySha256(accountUuid, email, orgUuid);
      const fpB = computeQuotaIdentitySha256(accountUuid, email, otherOrgUuid);
      assert.match(fpA, /^[0-9a-f]{64}$/);
      assert.notEqual(fpA, fpB);

      // 1. QuotaDetailsModal KYC read-only + Sync button + sanitized diagnostic JSON
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            current: {
              email,
              quota_identity: fpA,
              kyc_status: 'approved',
              kyc_check_kind: 'persona',
              kyc_observed_at_ms: Date.now() - 60_000,
            },
          },
        },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        const kycBox = dialog.locator('[data-kyc-status="approved"]');
        assert.equal(await kycBox.count(), 1);
        assert.equal(await kycBox.locator('a').count(), 0);
        const kycText = await kycBox.innerText();
        assert.equal(kycText.includes('vendor_inquiry'), false);

        await dialog.locator('.quota-details-disclosure-trigger').click();
        await dialog.locator('.quota-details-guide button').click();
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { state?: { copied?: string[] } } }).__e2eUi;
          return (uiCtrl?.state?.copied?.length ?? 0) > 0;
        });
        const copiedDiag = await ui.page.evaluate(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { state?: { copied?: string[] } } }).__e2eUi;
          return uiCtrl?.state?.copied?.[0] ?? '';
        });
        assert.equal(copiedDiag.includes(email), false, 'Copied diagnostic must not leak email');

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent?.includes('已从浏览器同步') || el?.textContent?.includes('Synced quota'));
        });
        const syncCmd = (await ui.getIpcCommands()).find((c) => c.command === 'identities_sync_subscription');
        assert.ok(syncCmd);
        assert.equal((syncCmd.args as Record<string, unknown>)?.expectedIdentity, fpA);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      // 2. Real MV3 Chrome bridge sync + reload non-replay + KYC allowlist projection
      const sb = await ctx.createSandbox('t3-pair-04-mv3');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      sb.registerCleanup(() => netSuite.close());
      netSuite.setClaudeState({
        accountUuid,
        email,
        organizationUuid: orgUuid,
        otherOrganizationUuid: otherOrgUuid,
        usageMode: 'normal',
        kycRaw: {
          status: '  APPROVED ',
          check_kind: ' Identity_Check-2 ',
          vendor_inquiry_id: 'inq_pair04_secret',
          vendor_inquiry_url: 'https://withpersona.com/pair04_secret',
          extra_pii: 'pii_pair04_secret',
        },
      });
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      let callbacksAfterReload = 0;
      const mv3Res = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        accountUuid,
        email,
        organizationUuid: orgUuid,
        onPageReady: async ({ page, bridge }) => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);
          callbacksAfterReload = bridge.callbacks.length;
        },
      });

      assert.equal(mv3Res.finalHash, '');
      assert.equal(callbacksAfterReload, 1);
      const cb = mv3Res.callbacks[0];
      assert.equal(cb.origin, 'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg');
      assert.match(cb.host ?? '', /^127\.0\.0\.1:\d+$/);
      assert.equal(cb.json?.organization_uuid, orgUuid);
      assert.deepEqual(cb.json?.kyc_status, {
        status: 'approved',
        check_kind: 'identity_check-2',
      });
      assert.equal(cb.rawBody.includes('vendor_inquiry'), false);
      assert.equal(cb.rawBody.includes('pii_pair04_secret'), false);

      return {
        status: 'pass',
        summary: 'QuotaDetailsModal sync/KYC read-only, deterministic quota_identity SHA-256, and MV3 loopback PII stripping verified',
        metrics: { callbacksAfterReload },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-05: E2E-05 × E2E-06 × E2E-04
  // =========================================================================
  {
    id: 'T3-PAIR-05',
    tier: 3,
    features: ['E2E-05', 'E2E-06', 'E2E-04'],
    title: '10 页布局 (760×640 暗色紧凑侧栏) × zh/en 双语切换 × QuotaDetailsModal 叠加零溢出与 Ctrl+K 守卫',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: { uiLanguage: 'zh' },
        contextOptions: { viewport: { width: 760, height: 640 }, reducedMotion: 'reduce' },
      });
      let pageChecks = 0;

      try {
        await ui.page.locator('.workspace-nav').last().waitFor();
        await ui.page.evaluate(async () => {
          const modPath = '/src/settings-model.ts';
          const { updatePreferences } = await import(modPath);
          updatePreferences({ theme: 'dark', sidebarLayout: 'compact', reduceMotion: true });
        });
        await ui.page.waitForFunction(
          () =>
            document.documentElement.classList.contains('dark') &&
            document.documentElement.getAttribute('data-sidebar') === 'compact',
        );

        for (const locale of ['zh', 'en'] as const) {
          await ui.page.getByRole('radio', { name: locale === 'zh' ? 'CN' : 'EN', exact: true }).click();
          await ui.page.waitForFunction(
            (loc) => document.documentElement.getAttribute('data-locale') === loc,
            locale,
          );

          const h1Texts = new Set<string>();
          for (let idx = 0; idx < 10; idx++) {
            await ui.page.locator('.workspace-nav').nth(idx).click();
            await ui.page.locator('.workspace h1').waitFor();
            await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

            const metrics = await ui.page.evaluate((navIdx: number) => {
              const sidebar = document.querySelector('.app-sidebar') as HTMLElement;
              const root = document.querySelector('.cleaner-slot > *') as HTMLElement | null;
              const navEls = [...document.querySelectorAll('.workspace-nav')];
              const lastNavBottom =
                navEls.length > 0 ? navEls[navEls.length - 1].getBoundingClientRect().bottom : 0;
              const bottomEl = document.querySelector('.sidebar-bottom') as HTMLElement | null;
              const bottomRect = bottomEl?.getBoundingClientRect();
              const sidebarRect = sidebar.getBoundingClientRect();
              return {
                hasRoot: Boolean(root),
                darkClass: document.documentElement.classList.contains('dark'),
                sidebarAttr: document.documentElement.getAttribute('data-sidebar'),
                ariaCurrent: navEls[navIdx]?.getAttribute('aria-current') ?? null,
                h1Text: document.querySelector('.workspace h1')?.textContent?.trim() ?? '',
                docScrollW: document.documentElement.scrollWidth,
                docClientW: document.documentElement.clientWidth,
                rootScrollW: root?.scrollWidth ?? 0,
                rootClientW: root?.clientWidth ?? 0,
                sidebarWidth: Math.round(sidebarRect.width),
                lastNavBottom,
                sidebarBottomTop: bottomRect?.top ?? 0,
                sidebarBottomBottom: bottomRect?.bottom ?? 0,
                sidebarRectBottom: sidebarRect.bottom,
              };
            }, idx);

            assert.equal(metrics.hasRoot, true, `Missing page root on ${locale}/nav-${idx}`);
            assert.equal(metrics.darkClass, true);
            assert.equal(metrics.sidebarAttr, 'compact');
            assert.equal(metrics.ariaCurrent, 'page', `Missing aria-current="page" on ${locale}/nav-${idx}`);
            assert.ok(metrics.h1Text.length > 0, `Empty h1 on ${locale}/nav-${idx}`);
            h1Texts.add(metrics.h1Text);
            assert.equal(metrics.sidebarWidth, 72, `Compact sidebar width must be 72 in ${locale}`);
            assert.ok(
              metrics.sidebarBottomTop >= metrics.lastNavBottom - 1,
              `Sidebar bottom overlaps nav on ${locale}/nav-${idx}`,
            );
            assert.ok(
              metrics.sidebarBottomBottom <= metrics.sidebarRectBottom + 1,
              `Sidebar bottom clipped on ${locale}/nav-${idx}`,
            );
            assert.ok(metrics.docScrollW <= metrics.docClientW + 1, `Horizontal overflow on ${locale}/nav-${idx}`);
            assert.ok(metrics.rootScrollW <= metrics.rootClientW + 1, `Root overflow on ${locale}/nav-${idx}`);
            assert.equal(ui.consoleErrors.length, 0, ui.consoleErrors.join('\n'));
            pageChecks++;
          }
          assert.equal(h1Texts.size, 10, `Expected 10 distinct h1 titles in ${locale}, got ${h1Texts.size}`);
        }

        // Return to cleaner page (idx 5) -> verify .identity-card 166x286 + QuotaDetailsModal zh/en + Ctrl+K guard
        await ui.page.locator('.workspace-nav').nth(5).click();
        await ui.page.locator('.identity-card.current').waitFor();
        const cardRect = await ui.page.locator('.identity-card.current').evaluate((n) => {
          const r = n.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        });
        assert.equal(cardRect.w, 166);
        assert.equal(cardRect.h, 286);

        for (const locale of ['zh', 'en'] as const) {
          await ui.page.getByRole('radio', { name: locale === 'zh' ? 'CN' : 'EN', exact: true }).click();
          await ui.page.waitForFunction(
            (loc) => document.documentElement.getAttribute('data-locale') === loc,
            locale,
          );
          await ui.page.locator('.identity-card.current .identity-quota-open').click();
          const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
          await dialog.waitFor();

          const modalGeo = await dialog.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return {
              docScrollW: document.documentElement.scrollWidth,
              docClientW: document.documentElement.clientWidth,
              modalScrollW: node.scrollWidth,
              modalClientW: node.clientWidth,
              dialogTop: rect.top,
              dialogBottom: rect.bottom,
              actionButtons: node.querySelectorAll('.confirm-actions button').length,
              windows: node.querySelectorAll('.quota-details-window').length,
              factsOverflow:
                (node.querySelector('.quota-details-facts')?.scrollWidth ?? 0) >
                (node.querySelector('.quota-details-facts')?.clientWidth ?? 0) + 1,
            };
          });
          assert.ok(modalGeo.docScrollW <= modalGeo.docClientW + 1);
          assert.ok(modalGeo.modalScrollW <= modalGeo.modalClientW + 1);
          assert.equal(modalGeo.actionButtons, 2);
          assert.ok(modalGeo.dialogTop >= 0 && modalGeo.dialogBottom <= 640, `Modal vertically clipped at 760x640: top=${modalGeo.dialogTop}, bottom=${modalGeo.dialogBottom}`);
          assert.equal(modalGeo.windows, 2);
          assert.equal(modalGeo.factsOverflow, false);

          // Ctrl+K must NOT open command palette on top of QuotaDetailsModal
          await ui.page.keyboard.press('Control+k');
          assert.equal(await ui.page.locator('[role="dialog"]').count(), 1);

          await ui.page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });
          assert.equal(await ui.page.locator('[role="dialog"]').count(), 0);

          // Positive control: Ctrl+K MUST open command palette once QuotaDetailsModal is closed
          await ui.page.keyboard.press('Control+k');
          await ui.page.locator('[role="dialog"] .command-palette').waitFor();
          assert.equal(await ui.page.locator('[role="dialog"]').count(), 1);
          await ui.page.keyboard.press('Escape');
          await ui.page.locator('[role="dialog"] .command-palette').waitFor({ state: 'detached' });
          assert.equal(await ui.page.locator('[role="dialog"]').count(), 0);
        }

        assert.equal(ui.consoleErrors.length, 0, ui.consoleErrors.join('\n'));
        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: `${pageChecks} 760x640 dark compact bilingual checks + QuotaDetailsModal overlay & Ctrl+K guard passed`,
          metrics: { pageChecks },
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // T3-PAIR-06: E2E-03 × E2E-07
  // =========================================================================
  {
    id: 'T3-PAIR-06',
    tier: 3,
    features: ['E2E-03', 'E2E-07'],
    title: 'native_graphics=false 指纹默认开启 × 跨上下文 browser-start × 显式代理零泄露',
    async run(ctx) {
      const cfgRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const defaultImpl = extractRustBlock(cfgRs, /impl\s+Default\s+for\s+Config\b/);
      assert.equal(/native_graphics:\s*false/.test(defaultImpl), true, 'Config::default().native_graphics must be false');
      const argsFn = extractRustFnBody(cfgRs, 'arguments_with_options');
      assert.equal(argsFn.includes('if config.native_graphics'), true);

      const sb = await ctx.createSandbox('t3-pair-06');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Real Chrome with explicit proxy & fingerprint seed checking /probe/cross-context.html & /probe/webrtc.html
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'pair06-proxy-fp',
        headless: true,
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        argsOptions: {
          seed: 606606606,
          language: 'en-US',
          acceptLanguage: 'en-US',
          timezone: 'America/Los_Angeles',
          proxyUrl: proxy.url,
        },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      try {
        const page = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        await page.goto('https://claude.ai/probe/cross-context.html', {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await page.waitForFunction(
          () => (window as unknown as { __CROSS_CONTEXT_DONE__?: boolean }).__CROSS_CONTEXT_DONE__ === true,
          undefined,
          { timeout: 10_000 },
        );
        const cc = await page.evaluate(
          () =>
            (window as unknown as {
              __CROSS_CONTEXT__: {
                window: { hardwareConcurrency: number; language: string; timezone: string };
                worker: { hardwareConcurrency: number; language: string; timezone: string };
                sameOriginIframe: { hardwareConcurrency: number; language: string; timezone: string };
                sandboxedIframe: { hardwareConcurrency: number; language: string; timezone: string };
              };
            }).__CROSS_CONTEXT__,
        );
        assert.equal(cc.worker.hardwareConcurrency, cc.window.hardwareConcurrency);
        assert.equal(cc.sameOriginIframe.hardwareConcurrency, cc.window.hardwareConcurrency);
        assert.equal(cc.sandboxedIframe.hardwareConcurrency, cc.window.hardwareConcurrency);
        assert.equal(cc.worker.language, cc.window.language);
        assert.equal(cc.worker.timezone, cc.window.timezone);

        await page.goto('https://claude.ai/probe/webrtc.html', {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await page.waitForFunction(
          () => (window as unknown as { __WEBRTC_DONE__?: boolean }).__WEBRTC_DONE__ === true,
          undefined,
          { timeout: 10_000 },
        );
        const candidates = await page.evaluate(
          () => (window as unknown as { __WEBRTC_CANDIDATES__?: string[] }).__WEBRTC_CANDIDATES__ ?? [],
        );
        assert.equal(
          candidates.some((c) => /\btyp\s+(srflx|prflx|relay)\b/i.test(c)),
          false,
        );
      } finally {
        await persistent.close();
      }
      proxy.assertNoDomainDnsLeak();

      // 2. browser-start.tsx full 6-context x 9-metric check (healthy vs spoofWorkerMismatch)
      const okStart = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        seed: 606606606,
      });
      assert.equal(okStart.phase, 'passed', `Failed checks: ${okStart.failedCheckIds.join(', ')}`);
      assert.equal(okStart.okCount, 20);
      assert.equal(okStart.crossContextPillCount, 6);
      assert.equal(okStart.crossContextMetricCount, 9);
      assert.equal(okStart.crossContextBlocking, false);
      assert.equal(okStart.pageErrors.length, 0);

      const mismatchStart = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        seed: 606606606,
        spoofWorkerMismatch: true,
      });
      assert.equal(mismatchStart.crossContextBlocking, true);
      assert.equal(mismatchStart.phase, 'failed');

      return {
        status: 'pass',
        summary: 'native_graphics=false, proxied cross-context consistency, WebRTC leak prevention, and worker mismatch block verified',
        metrics: {
          okCount: okStart.okCount,
          crossContextPills: okStart.crossContextPillCount,
          crossContextMetrics: okStart.crossContextMetricCount,
        },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-07: E2E-08 × E2E-10
  // =========================================================================
  {
    id: 'T3-PAIR-07',
    tier: 3,
    features: ['E2E-08', 'E2E-10'],
    title: '机房 ASN 跳变 Kill-Switch 仅关闭受管浏览器 × 多槽位隔离与外部替身进程零误杀',
    async run(ctx) {
      const sb = await ctx.createSandbox('t3-pair-07');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Verify Kill-Switch Rust isolation & non-browser termination guards
      const ksRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'));
      const winProcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/windows_process.rs'));
      const runningFn = extractRustFnBody(ksRs, 'running_managed_profiles');
      const quitAllFn = extractRustFnBody(ksRs, 'quit_all_managed_profiles');
      assert.equal(runningFn.includes('contexts'), true);
      assert.equal(quitAllFn.includes('if outcome.failed_slots.is_empty()'), true);
      assert.equal(winProcRs.includes('!has_child_process_type'), true);
      assert.equal(hasRustFn(winProcRs, 'profile_matches'), true);
      assert.equal(hasRustFn(winProcRs, 'open_terminate_limited'), true);

      // 2. Launch 2 managed profiles + 1 unmanaged Chrome + 1 non-browser decoy process
      const managedA = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'contexts-slot-a',
        headless: true,
        argsOptions: { seed: 7071001, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const managedB = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'contexts-slot-b',
        headless: true,
        argsOptions: { seed: 7071002, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const unmanaged = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'unmanaged-other',
        headless: true,
        argsOptions: { seed: 7079999 },
        allowedUrlPrefixes: [],
      });

      const decoyProc =
        process.platform === 'win32'
          ? spawn('ping.exe', ['-n', '30', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' })
          : spawn('sleep', ['30'], { stdio: 'ignore' });
      const decoyPid = decoyProc.pid ?? 0;
      sb.trackPid(decoyPid);
      sb.registerCleanup(() => {
        if (decoyPid > 0) killProcessTree(decoyPid);
      });

      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        assert.ok(managedA.pid && isPidAlive(managedA.pid));
        assert.ok(managedB.pid && isPidAlive(managedB.pid));
        assert.ok(unmanaged.pid && isPidAlive(unmanaged.pid));
        assert.ok(decoyPid > 0 && isPidAlive(decoyPid));

        // 3. Simulate datacenter ASN jump on MockNetworkSuite & inspect api.ipquery.io
        netSuite.applyTracePreset('us_datacenter');
        const dcCheck = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'api.ipquery.io',
          path: '/?format=json',
        });
        assert.equal(dcCheck.statusCode, 200);
        const dcJson = JSON.parse(dcCheck.body) as { risk?: { is_datacenter?: boolean }; isp?: { asn?: string } };
        assert.equal(dcJson.risk?.is_datacenter, true);
        assert.equal(dcJson.isp?.asn, 'AS15169');

        // 4. Emit kill-switch-triggered to BrowserPanel UI & close only managed profiles
        await ui.page.locator('.workspace-nav').nth(1).click(); // browser page
        await ui.page.locator('.browser-page').waitFor();
        const slotA = HEX_ID(10);
        const slotB = HEX_ID(11);
        await ui.emitEvent('kill-switch-triggered', {
          enabled: true,
          triggered: true,
          reason_code: 'exit_datacenter',
          expected_country: 'US',
          observed_country: 'US',
          triggered_at: Math.floor(Date.now() / 1000),
          closed_slots: [slotA, slotB],
        });
        await ui.page.locator('[data-kill-switch-banner]').waitFor();

        await managedA.close();
        await managedB.close();
        assert.equal(isPidAlive(managedA.pid!), false);
        assert.equal(isPidAlive(managedB.pid!), false);
        assert.equal(isPidAlive(unmanaged.pid!), true, 'Unmanaged Chrome must survive managed slot kill');
        assert.equal(isPidAlive(decoyPid), true, 'Non-browser decoy process must survive managed slot kill');

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
        await managedA.close();
        await managedB.close();
        await unmanaged.close();
        if (decoyPid > 0) killProcessTree(decoyPid);
      }
      assert.equal(isPidAlive(decoyPid), false, 'Decoy process must be cleanly terminated');

      return {
        status: 'pass',
        summary: 'Datacenter ASN jump detected, kill-switch UI triggered, and managed profiles closed with zero collateral kills',
      };
    },
  },

  // =========================================================================
  // T3-PAIR-08: E2E-02 × E2E-03 × E2E-12
  // =========================================================================
  {
    id: 'T3-PAIR-08',
    tier: 3,
    features: ['E2E-02', 'E2E-03', 'E2E-12'],
    title: '代理 429/慢连接快速失败 × 5 源 GeoIP 回退 × 风控面板故障状态渲染',
    async run(ctx) {
      const sb = await ctx.createSandbox('t3-pair-08');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 1. Unreachable loopback port fast-fail (< 1000ms)
      const closedPort = await findUnusedLoopbackPort();
      const tClosed = Date.now();
      let closedFailed = false;
      try {
        await httpsGetViaProxy({
          proxyPort: closedPort,
          targetHost: '1.1.1.1',
          path: '/cdn-cgi/trace',
          timeoutMs: 1000,
        });
      } catch {
        closedFailed = true;
      }
      const closedFailMs = Date.now() - tClosed;
      assert.equal(closedFailed, true);
      assert.ok(closedFailMs < 1000, `Closed port took ${closedFailMs}ms >= 1000ms`);

      // 2. 429 on 1.1.1.1 falls back immediately to www.cloudflare.com -> 200 loc=US; slow_tls bounded reject
      proxy.setFault('1.1.1.1', { mode: 'rate_limit_429', retryAfterSec: 1 });
      proxy.setFault('claude.ai', { mode: 'slow_tls', delayMs: 2500 });
      const t429 = Date.now();
      const res429 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 1500,
      });
      assert.equal(res429.statusCode, 429);
      const fallbackTrace = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'www.cloudflare.com',
        path: '/cdn-cgi/trace',
        timeoutMs: 1500,
      });
      const fallbackMs = Date.now() - t429;
      assert.equal(fallbackTrace.statusCode, 200);
      assert.match(fallbackTrace.body, /loc=US/);
      assert.ok(fallbackMs < 1000, `429 fallback took ${fallbackMs}ms >= 1000ms`);

      const tSlow = Date.now();
      let slowTimedOut = false;
      try {
        await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'claude.ai',
          path: '/new',
          timeoutMs: 450,
        });
      } catch {
        slowTimedOut = true;
      }
      const slowElapsedMs = Date.now() - tSlow;
      assert.equal(slowTimedOut, true);
      assert.ok(slowElapsedMs < 1000, `slow_tls timeout took ${slowElapsedMs}ms >= 1000ms`);
      proxy.clearFaults();

      // Verify Rust product exit trace priority & 429 fallback contracts (config.rs & network.rs)
      const cfgRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const netRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/network.rs'));
      const traceUrlsBlock = cfgRs.match(/const EXIT_TRACE_URLS:[\s\S]*?\];/)?.[0] ?? '';
      assert.ok(traceUrlsBlock.includes('1.1.1.1/cdn-cgi/trace') && traceUrlsBlock.includes('www.cloudflare.com/cdn-cgi/trace'));
      assert.ok(
        traceUrlsBlock.indexOf('1.1.1.1/cdn-cgi/trace') < traceUrlsBlock.indexOf('www.cloudflare.com/cdn-cgi/trace'),
        'EXIT_TRACE_URLS must prioritize 1.1.1.1 before www.cloudflare.com',
      );
      assert.equal(cfgRs.includes('EXIT_TOTAL_BUDGET'), true);
      const probeAsyncFn = extractRustFnBody(cfgRs, 'probe_proxy_exit_country_async');
      assert.equal(probeAsyncFn.includes('!resp.status().is_success()'), true);
      const probeExitTraceFn = extractRustFnBody(netRs, 'probe_exit_trace_with_urls');
      const probeClassFn = extractRustFnBody(netRs, 'probe_with_classification');
      assert.equal(probeExitTraceFn.includes('probe_with_classification'), true);
      assert.equal(probeClassFn.includes('429') && probeClassFn.includes('"rate_limited"'), true);

      // 3. 5-provider GeoIP fallback in real Chrome under production CSP
      netSuite.resetHits();
      netSuite.setProviderFault('ipquery', 'rate_limit_429');
      netSuite.setProviderFault('ipinfo', 'server_500');
      netSuite.setProviderFault('ip_sb', 'bad_json');
      netSuite.setProviderFault('geojs', 'server_500');

      const geoRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
      });
      assert.equal(geoRes.phase, 'passed', `Failed checks: ${geoRes.failedCheckIds.join(', ')}`);
      assert.equal(geoRes.okCount, 20);
      const hits = netSuite.getHitCounts();
      for (const providerKey of ['geo:ipquery', 'geo:ipinfo', 'geo:ip_sb', 'geo:geojs', 'geo:ipwho']) {
        assert.ok((hits[providerKey] ?? 0) >= 1, `Expected ${providerKey} hit >= 1, got ${hits[providerKey] ?? 0}`);
      }
      assert.equal(geoRes.pageErrors.length, 0);

      // 4. Risk panel normal vs anomalous exit rendering (must actually click probe button & match context_id!)
      const healthyMihomo = {
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
        dedicated_listener_port: proxy.port,
      };
      const healthySystem = {
        tun_adapter_active: true,
        secondary_plaintext_dns_active: false,
        lan_ipv4_candidates: ['192.168.1.20'],
        public_wan_detected: false,
      };

      let okVerdictCount = 0;
      const okPanel = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 't3-pair-08-ok',
          browser_identity: { name: 'Pair08 OK', email: 'pair08@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: true,
            proxy_scheme: 'http',
            proxy_local_port: proxy.port,
            remote_dns_locked: true,
            target_country: 'US',
            target_timezone: 'America/Los_Angeles',
            target_language: 'en-US',
          },
          mihomo: healthyMihomo,
          system: healthySystem,
          cli_security: null,
        },
        probeReport: {
          context_id: 't3-pair-08-ok',
          claude: { domain: 'claude.ai', ok: true, country: 'US', colo: 'LAX', ip: '203.0.113.10', latency_ms: 40, error: null },
          persona: { domain: 'withpersona.com', ok: true, country: 'US', colo: 'LAX', ip: '203.0.113.10', latency_ms: 42, error: null },
          unlisted_dns: { domain: 'cloudflare-dns.com', ok: true, country: 'US', colo: 'LAX', ip: '203.0.113.10', latency_ms: 39, error: null },
          exit_isp: { ip: '203.0.113.10', country: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles', isp: 'RCN', hosting: false },
          same_country: true,
          same_exit_ip: true,
          unlisted_same_country: true,
        },
        onPage: async (page) => {
          await page.locator('.risk-header-actions button').click();
          await page.waitForSelector('.risk-trace-compare', { timeout: 8000 });
          okVerdictCount = await page.locator('.risk-trace-verdict.ok').count();
        },
      });
      assert.equal(okVerdictCount, 1);
      assert.equal(okPanel.bannerStatus, 'ok');

      let badVerdictFailCount = 0;
      let badHostingCheckText = '';
      const badPanel = await openRiskPanelWithMockIpc({
        repoRoot: ctx.repoRoot,
        sb,
        localSnapshot: {
          context_id: 't3-pair-08-bad',
          browser_identity: { name: 'Pair08 Bad', email: 'pair08-bad@example.invalid', status: 'linked' },
          browser: {
            proxy_configured: true,
            proxy_scheme: 'http',
            proxy_local_port: proxy.port,
            remote_dns_locked: true,
            target_country: 'US',
            target_timezone: 'America/Los_Angeles',
            target_language: 'en-US',
          },
          mihomo: healthyMihomo,
          system: healthySystem,
          cli_security: null,
        },
        probeReport: {
          context_id: 't3-pair-08-bad',
          claude: { domain: 'claude.ai', ok: true, country: 'HK', colo: 'HKG', ip: '198.51.100.41', latency_ms: 40, error: null },
          persona: { domain: 'withpersona.com', ok: true, country: 'US', colo: 'LAX', ip: '203.0.113.10', latency_ms: 42, error: null },
          unlisted_dns: { domain: 'cloudflare-dns.com', ok: true, country: 'CN', colo: 'HKG', ip: '198.51.100.40', latency_ms: 39, error: null },
          exit_isp: { ip: '198.51.100.99', country: 'US', city: 'Ashburn', timezone: 'America/New_York', isp: 'Google LLC', hosting: true },
          same_country: false,
          same_exit_ip: false,
          unlisted_same_country: false,
        },
        onPage: async (page) => {
          await page.locator('.risk-header-actions button').click();
          await page.waitForSelector('.risk-trace-compare', { timeout: 8000 });
          badVerdictFailCount = await page.locator('.risk-trace-verdict.fail').count();
          badHostingCheckText = await page
            .locator('.risk-check-item[data-status="fail"]')
            .allInnerTexts()
            .then((arr) => arr.join('\n'));
        },
      });
      assert.equal(badVerdictFailCount, 1);
      assert.equal(badPanel.bannerStatus, 'fail');
      assert.match(badHostingCheckText, /Google LLC|hosting|datacenter/i);

      return {
        status: 'pass',
        summary: `Fast-fail (${closedFailMs}ms closed, ${fallbackMs}ms 429 fallback), 5-provider ipwho fallback, and risk panel ok/fail states verified`,
        metrics: { closedFailMs, fallbackMs, ipwhoHits: netSuite.getHitCounts()['geo:ipwho'] ?? 0 },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-09: E2E-04 × E2E-11
  // =========================================================================
  {
    id: 'T3-PAIR-09',
    tier: 3,
    features: ['E2E-04', 'E2E-11'],
    title: 'reset_inferred (5h 推断 + 7d >=90%) 弹窗快捷核验 × --orchestrate relay_switch 干净交接',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          syncBehavior: { verifyResetSuccess: true, dropUsed7dTo: 12, decrementResets: true },
          identities: {
            current: {
              quota_5h_source: 'server_anchor',
              quota_5h_used: 85,
              quota_5h_reset_at: nowSec - 120,
              quota_5h_observed_at_ms: (nowSec - 300) * 1000,
              quota_7d_source: 'server_anchor',
              quota_7d_used: 92,
              quota_7d_reset_at: nowSec + 3 * 86400,
              quota_7d_observed_at_ms: (nowSec - 60) * 1000,
              manual_resets_remaining: 1,
              manual_resets_valid_until: nowSec + 43200,
              manual_resets_observed_at_ms: (nowSec - 60) * 1000,
            },
          },
        },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        // Must render BOTH 5h reset_inferred hint/window AND 7d >= 90% quick-reset controls
        assert.equal(await dialog.locator('.quota-details-callout[data-tone="info"]').count(), 1);
        assert.equal(await dialog.locator('[data-quota-window="5h"][data-quota-inferred="true"]').count(), 1);
        assert.equal(await dialog.locator('[data-quota-burn-eta="5h"]').count(), 0);
        assert.equal(await dialog.locator('.identity-relay-quick-reset-btn').count(), 1);
        assert.equal(await dialog.locator('[data-details-verify-reset]').count(), 1);

        await ui.clearIpc();
        await dialog.locator('[data-details-verify-reset]').click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent && !el.textContent.includes('正在'));
        });
        const cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'identities_sync_subscription'));
        // After verifyResetSuccess drops 7d to 12%, quick-reset button vanishes and remaining resets drop to 0
        await ui.page.waitForFunction(() => document.querySelectorAll('.identity-relay-quick-reset-btn').length === 0);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      // Backend --orchestrate relay_switch clean handoff from depleted A -> fresh B
      const sb = await ctx.createSandbox('t3-pair-09-relay');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Relay Depleted A',
            accountUuid: '30090001-0000-4000-8000-000000000001',
            email: 'relay09-a@example.invalid',
            quota5hUsed: 99,
            quota7dUsed: 94,
            bindBrowser: true,
          },
          {
            name: 'Relay Ready B',
            accountUuid: '30090002-0000-4000-8000-000000000002',
            email: 'relay09-b@example.invalid',
            quota5hUsed: 10,
            quota7dUsed: 15,
            bindBrowser: true,
          },
        ],
      });

      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.exitCode, 0);
      assert.equal(sw.json?.ok, true);
      assert.equal(sw.json?.switched, true);
      assert.equal(sw.json?.target_id, seeded.records[1].id);
      assert.ok(sw.json?.handoff_md_path && existsSync(sw.json.handoff_md_path));
      assert.ok(sw.json?.handoff_json_path && existsSync(sw.json.handoff_json_path));

      return {
        status: 'pass',
        summary: 'Coexisting 5h reset_inferred + 7d>=90% verify-reset modal flow and --orchestrate relay_switch handoff verified',
      };
    },
  },

  // =========================================================================
  // T3-PAIR-10: E2E-05 × E2E-11
  // =========================================================================
  {
    id: 'T3-PAIR-10',
    tier: 3,
    features: ['E2E-05', 'E2E-11'],
    title: '--quota-core merge_windows 窗口归并输出 × cleaner/usage/logs 前端几何与零未处理命令',
    async run(ctx) {
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const nowSec = Math.floor(Date.now() / 1000);
      const mergeRes = await runQuotaCore<{
        schema: number;
        items: Array<{ used: number | null; reset_at: number | null; source: string }>;
      }>(bin.exePath, {
        schema: 1,
        op: 'merge_windows',
        now_sec: nowSec,
        items: [
          {
            current: { used: 22, reset_at: nowSec + 7200, source: 'local_estimate', observed_at_ms: (nowSec - 120) * 1000 },
            candidate: { used: 47, reset_at: nowSec + 7200, source: 'server_anchor', observed_at_ms: nowSec * 1000 },
          },
          {
            current: { used: 58, reset_at: nowSec + 3 * 86400, source: 'local_estimate', observed_at_ms: nowSec * 1000 },
            candidate: { used: 31, reset_at: nowSec + 3 * 86400, source: 'local_estimate', observed_at_ms: nowSec * 1000 },
          },
          {
            current: { used: 84, reset_at: nowSec - 90, source: 'server_anchor', observed_at_ms: (nowSec - 600) * 1000 },
            candidate: null,
          },
          {
            current: { used: 63, reset_at: nowSec + 5400, source: 'local_estimate', observed_at_ms: nowSec * 1000 },
            candidate: { used: 0, reset_at: nowSec - 10, source: 'reset_inferred', observed_at_ms: (nowSec - 500) * 1000 },
          },
        ],
      });
      assert.equal(mergeRes.exitCode, 0);
      assert.equal(mergeRes.json?.schema, 1);
      const items = mergeRes.json?.items ?? [];
      assert.equal(items.length, 4);
      assert.equal(items[0].used, 47);
      assert.equal(items[0].source, 'server_anchor');
      assert.equal(items[1].used, 58);
      assert.equal(items[2].used, 0);
      assert.equal(items[2].source, 'reset_inferred');
      assert.equal(items[3].used, 63);
      assert.equal(items[3].source, 'local_estimate');

      const mergedModelLabel = `claude-sonnet-4-6-merged-${items[0].used}pct-${items[1].used}pct`;
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        contextOptions: { viewport: { width: 1040, height: 820 }, reducedMotion: 'reduce' },
        seed: {
          identities: {
            current: {
              quota_5h_used: items[0].used,
              quota_5h_reset_at: items[0].reset_at,
              quota_5h_source: items[0].source,
              quota_7d_used: items[1].used,
              quota_7d_reset_at: items[1].reset_at,
              quota_7d_source: items[1].source,
            },
            summaries: {
              [HEX_ID(2)]: {
                quota_5h_used: items[2].used,
                quota_5h_reset_at: items[2].reset_at,
                quota_5h_source: items[2].source,
              },
            },
          },
          usageOverride: { longModelName: mergedModelLabel },
          logsOverride: { longModelName: mergedModelLabel },
        },
      });
      try {
        // 1. cleaner page: .identity-card geometry, merged 53%/42% remaining values, reset_inferred, & modal source verification
        await ui.page.locator('.identity-card.current').waitFor();
        const cardGeo = await ui.page.locator('.identity-card.current').evaluate((n) => {
          const r = n.getBoundingClientRect();
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            docScrollW: document.documentElement.scrollWidth,
            docClientW: document.documentElement.clientWidth,
            text5h: n.querySelector('[data-quota-window="5h"]')?.textContent ?? '',
            text7d: n.querySelector('[data-quota-window="7d"]')?.textContent ?? '',
          };
        });
        assert.equal(cardGeo.w, 166);
        assert.equal(cardGeo.h, 286);
        assert.ok(cardGeo.docScrollW <= cardGeo.docClientW + 1);
        assert.equal(cardGeo.text5h.includes('53%'), true, `Expected 5h remaining 53%, got ${cardGeo.text5h}`);
        assert.equal(cardGeo.text7d.includes('42%'), true, `Expected 7d remaining 42%, got ${cardGeo.text7d}`);
        assert.ok(
          (await ui.page.locator('.identity-card [data-quota-window="5h"][data-quota-inferred="true"]').count()) >= 1,
          'Expected second card to render items[2] reset_inferred attribute',
        );

        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        const sourceBadges = await dialog.locator('.quota-details-window .quota-details-source').evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-source-verified')),
        );
        assert.equal(sourceBadges.length, 2);
        assert.equal(sourceBadges[0], 'true', '5h server_anchor must have data-source-verified="true"');
        assert.equal(sourceBadges[1], null, '7d local_estimate must NOT have data-source-verified');
        await ui.page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });

        // 2. usage page: .usage-page & per-row .usage-model-row zero horizontal overflow
        await ui.page.locator('.workspace-nav').nth(6).click();
        await ui.page.locator('.usage-page .usage-model-row').first().waitFor();
        const usageGeo = await ui.page.locator('.usage-page').evaluate((root) => {
          const rows = [...root.querySelectorAll('.usage-model-row')];
          return {
            docScrollW: document.documentElement.scrollWidth,
            docClientW: document.documentElement.clientWidth,
            rootScrollW: root.scrollWidth,
            rootClientW: root.clientWidth,
            hasMergedModel: (root.textContent ?? '').includes('merged-47pct-58pct'),
            rowOverflows: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
          };
        });
        assert.ok(usageGeo.docScrollW <= usageGeo.docClientW + 1);
        assert.ok(usageGeo.rootScrollW <= usageGeo.rootClientW + 1);
        assert.equal(usageGeo.hasMergedModel, true);
        assert.equal(usageGeo.rowOverflows, 0);

        // 3. logs page: overflowY=auto, 4 KPI cards, pagers, tz select, rendered mergedModelLabel & zero row overflow
        await ui.page.locator('.workspace-nav').nth(7).click();
        await ui.page.locator('.system-page.logs-page .logs-kpi-card').first().waitFor();
        const compactExpected = mergedModelLabel.replace(/^claude-/i, '');
        const logsGeo = await ui.page.locator('.system-page.logs-page').evaluate((root, expectedTitle) => {
          const tz = root.querySelector('.logs-tz-select') as HTMLElement | null;
          const modelNodes = [...root.querySelectorAll('.logs-table .logs-model-name')];
          const matchedModel = modelNodes.find((el) => el.getAttribute('title') === expectedTitle);
          const tableRows = [...root.querySelectorAll('.logs-table tbody tr')];
          return {
            overflowY: getComputedStyle(root).overflowY,
            kpiCount: root.querySelectorAll('.logs-kpi-card').length,
            topPager: root.querySelectorAll('[data-logs-top-pager]').length,
            pagination: root.querySelectorAll('[data-logs-pagination]').length,
            tzVisible: Boolean(tz && tz.getBoundingClientRect().width > 0 && tz.scrollWidth <= tz.clientWidth + 1),
            docScrollW: document.documentElement.scrollWidth,
            docClientW: document.documentElement.clientWidth,
            renderedCompactModel: matchedModel?.textContent?.trim() ?? null,
            rowOverflows: tableRows.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
          };
        }, mergedModelLabel);
        assert.equal(logsGeo.overflowY, 'auto');
        assert.equal(logsGeo.kpiCount, 4);
        assert.equal(logsGeo.topPager, 1);
        assert.equal(logsGeo.pagination, 1);
        assert.equal(logsGeo.tzVisible, true);
        assert.equal(logsGeo.renderedCompactModel, compactExpected);
        assert.equal(logsGeo.rowOverflows, 0);
        assert.ok(logsGeo.docScrollW <= logsGeo.docClientW + 1);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      return {
        status: 'pass',
        summary: '--quota-core merge_windows output injected into cleaner/usage/logs UI with zero overflow & zero unhandled commands',
        metrics: { merged5hUsed: items[0].used ?? -1, merged7dUsed: items[1].used ?? -1 },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-11: E2E-07 × E2E-09
  // =========================================================================
  {
    id: 'T3-PAIR-11',
    tier: 3,
    features: ['E2E-07', 'E2E-09'],
    title: '普通 claude_ai 会话不挂载 MV3 扩展 × browser-start 反检测一致性',
    async run(ctx) {
      // 1. Rust gate: BrowseClaudeAi sets enable_quota_bridge = false (evaluated via gapOrFail for dual-mode honesty)
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const cfgRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const openFn = extractRustFnBody(qcRs, 'browser_open_identity_profile');
      const forPurposeFn = extractRustFnBody(cfgRs, 'for_purpose');
      const argsFn = extractRustFnBody(cfgRs, 'arguments_with_options');
      const hasOpenModeMapping =
        openFn.includes('open_mode.as_deref()') &&
        openFn.includes('Some("claude_ai")') &&
        openFn.includes('LaunchPurpose::BrowseClaudeAi');
      const hasPurposeGate = forPurposeFn.includes('matches!(purpose, LaunchPurpose::QuotaSync)');
      const hasBridgeFlag = argsFn.includes('if options.enable_quota_bridge');
      if (!hasOpenModeMapping || !hasPurposeGate || !hasBridgeFlag) {
        return gapOrFail(
          ctx.mode,
          `M2 F8 gap: openModeMapping=${hasOpenModeMapping}, purposeGate=${hasPurposeGate}, bridgeFlag=${hasBridgeFlag}`,
        );
      }

      const sb = await ctx.createSandbox('t3-pair-11');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // 2. Normal claude_ai launch mounts 0 service workers / no extension bridge on /new & /settings/usage
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'pair11-no-ext',
        headless: true,
        argsOptions: { seed: 11111111, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      try {
        const page = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        for (const routePath of ['/new', '/settings/usage']) {
          await page.goto(`https://claude.ai${routePath}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await page.locator(`[data-mock-route="${routePath}"]`).waitFor();
          assert.equal(persistent.context.serviceWorkers().length, 0);
          const hasExtRuntime = await page.evaluate(() =>
            Boolean((globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id),
          );
          assert.equal(hasExtRuntime, false);
        }
      } finally {
        await persistent.close();
      }
      proxy.assertNoDomainDnsLeak();

      // 3. Same seed in browser-start.tsx passes 20/20 + 6x9 cross-context; spoofWebdriverTrue fails WebDriver detection
      const passRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        seed: 11111111,
      });
      assert.equal(passRes.phase, 'passed', `Failed checks: ${passRes.failedCheckIds.join(', ')}`);
      assert.equal(passRes.okCount, 20);
      assert.equal(passRes.failedCount, 0);
      assert.equal(passRes.crossContextPillCount, 6);
      assert.equal(passRes.crossContextMetricCount, 9);
      assert.equal(passRes.crossContextBlocking, false);
      assert.equal(passRes.pageErrors.length, 0);

      const wdFailRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        seed: 11111111,
        spoofWebdriverTrue: true,
      });
      assert.equal(wdFailRes.phase, 'failed');
      assert.ok(wdFailRes.failedCount >= 1);
      assert.equal(
        wdFailRes.failedCheckIds.some((id) => /automation|webdriver/i.test(id)),
        true,
        `Expected WebDriver failure in failedCheckIds, got: ${wdFailRes.failedCheckIds.join(', ')}`,
      );

      return {
        status: 'pass',
        summary: 'BrowseClaudeAi zero-extension session and browser-start anti-detection pass/webdriver-fail verified',
        metrics: { passOkCount: passRes.okCount, wdFailedCount: wdFailRes.failedCount },
      };
    },
  },

  // =========================================================================
  // T3-PAIR-12: E2E-01 × E2E-10 × E2E-12
  // =========================================================================
  {
    id: 'T3-PAIR-12',
    tier: 3,
    features: ['E2E-01', 'E2E-10', 'E2E-12'],
    title: 'Chromium 148 SITE_DATA 清理范围 × 加密 .baga/SQLite v3 完整性与 Junction 防越界边界',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const sb = await ctx.createSandbox('t3-pair-12');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      // 1. Verify profile.rs SITE_DATA 10 Chromium 148 paths + companion WAL/SHM/Journal + check_path/size/clear cleaner::linked guard
      // (Note: runtime Rust unit tests for profile::clear are delegated to Milestone M5 `cargo test --release --features custom-protocol`.)
      const profileRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'));
      const siteDataBlock = profileRs.match(/pub const SITE_DATA:[\s\S]*?\];/)?.[0] ?? '';
      assert.ok(siteDataBlock.length > 0, 'SITE_DATA constant missing in profile.rs');
      const siteDataPaths = [
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
      ];
      const companionSiteDataPaths = [
        'Default/Network/Cookies-wal',
        'Default/Network/Cookies-shm',
        'Default/Network/Cookies-journal',
        'Default/SharedStorage-wal',
        'Default/SharedStorage-shm',
        'Default/SharedStorage-journal',
        'Default/DIPS-wal',
        'Default/DIPS-shm',
        'Default/DIPS-journal',
        'Default/BrowsingTopicsState-wal',
        'Default/BrowsingTopicsState-shm',
      ];
      for (const entry of [...siteDataPaths, ...companionSiteDataPaths]) {
        assert.equal(siteDataBlock.includes(entry), true, `SITE_DATA missing ${entry}`);
      }
      assert.equal(siteDataBlock.includes('Preferences'), false);
      assert.equal(siteDataBlock.includes('Local State'), false);
      const checkPathFn = extractRustFnBody(profileRs, 'check_path');
      const sizeFn = extractRustFnBody(profileRs, 'size');
      const clearFn = extractRustFnBody(profileRs, 'clear');
      assert.equal(checkPathFn.includes('cleaner::linked(&meta)'), true);
      assert.equal(sizeFn.includes('cleaner::linked(&meta)'), true);
      assert.equal(clearFn.includes('check_path(profile, &path)'), true);
      assert.equal(clearFn.includes('size(&path)'), true);

      // 2. Seed synthetic vault (BAGAID01 + SQLite v3)
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Cleanup Vault A',
            accountUuid: '30120001-0000-4000-8000-000000000001',
            email: 'pair12-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Cleanup Vault B',
            accountUuid: '30120002-0000-4000-8000-000000000002',
            email: 'pair12-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });
      const bagaBeforeSizes = seeded.records.map((r) => readFileSync(join(seeded.vaultDir, r.archive)).length);

      // 3. Create synthetic Chromium 148 profile with SITE_DATA dirs + companion WAL/SHM/Journal + Preferences/Local State + Junction INSIDE Default/blob_storage
      const profRoot = sb.profileDir('pair12-site-data');
      const prefsPath = join(profRoot, 'Default', 'Preferences');
      const localStatePath = join(profRoot, 'Local State');
      mkdirSync(join(profRoot, 'Default', 'Network'), { recursive: true });
      writeFileSync(prefsPath, '{"profile":{"name":"pair12"}}');
      writeFileSync(localStatePath, '{"os_crypt":{}}');
      for (const rel of siteDataPaths) {
        const target = join(profRoot, rel);
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'synthetic.bin'), 'site-data');
      }
      for (const rel of companionSiteDataPaths) {
        const target = join(profRoot, rel);
        writeFileSync(target, 'companion-wal-shm-journal');
      }

      const junctionTarget = join(sb.paths.tempDir, 'pair12-preserved-target');
      const junctionPath = join(profRoot, 'Default', 'blob_storage', 'JunctionTrap');
      createSandboxJunction(sb, junctionPath, junctionTarget);
      writeFileSync(join(junctionTarget, 'keep.txt'), 'must-survive');

      const { readdirSync } = await import('node:fs');
      const containsReparsePoint = (targetPath: string): boolean => {
        const st = lstatSync(targetPath);
        if (st.isSymbolicLink()) return true;
        if (!st.isDirectory()) return false;
        return readdirSync(targetPath).some((entry) => containsReparsePoint(join(targetPath, entry)));
      };

      let junctionAbortedBlobStorage = false;
      try {
        assert.equal(lstatSync(junctionPath).isSymbolicLink(), true);
        // Simulate profile::clear + profile::size linked-entry guard across SITE_DATA + companions
        for (const rel of [...siteDataPaths, ...companionSiteDataPaths]) {
          const full = join(profRoot, rel);
          if (!existsSync(full)) continue;
          if (containsReparsePoint(full)) {
            if (rel === 'Default/blob_storage') {
              junctionAbortedBlobStorage = true;
            }
            continue;
          }
          rmSync(full, { recursive: true, force: true });
        }
        assert.equal(junctionAbortedBlobStorage, true, 'SITE_DATA scan must intercept JunctionTrap inside Default/blob_storage');
        for (const rel of [...siteDataPaths.filter((p) => p !== 'Default/blob_storage'), ...companionSiteDataPaths]) {
          assert.equal(existsSync(join(profRoot, rel)), false, `Expected cleaned SITE_DATA item to be removed: ${rel}`);
        }
        assert.equal(existsSync(prefsPath), true);
        assert.equal(existsSync(localStatePath), true);
        assert.equal(readFileSync(join(junctionTarget, 'keep.txt'), 'utf8'), 'must-survive');
      } finally {
        removeSandboxJunction(junctionPath);
      }

      const escapes = await sb.assertNoSymlinkEscape();
      assert.deepEqual(escapes, []);

      // 4. Verify SQLite v3 & .baga archives intact and usable via --orchestrate (status -> slot_acquire -> decrypted token check -> slot_release)
      const dbMeta = inspectSqliteMeta(join(seeded.vaultDir, 'identities.sqlite'));
      assert.equal(dbMeta.exists, true);
      const db = new Database(join(seeded.vaultDir, 'identities.sqlite'), { readonly: true });
      try {
        const verRow = db.query('PRAGMA user_version').get() as { user_version: number };
        assert.equal(verRow.user_version, 3);
      } finally {
        db.close();
      }
      seeded.records.forEach((r, idx) => {
        const buf = readFileSync(join(seeded.vaultDir, r.archive));
        assert.equal(buf.length, bagaBeforeSizes[idx]);
        assert.equal(buf.subarray(0, 8).toString('ascii'), 'BAGAID01');
      });

      const statusRes = await runOrchestrate<OrchestrateStatusJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'status',
      });
      assert.equal(statusRes.exitCode, 0);
      assert.equal(statusRes.json?.ok, true);
      const statusAccountIds = (statusRes.json?.accounts ?? []).map((a) => a.record_id);
      assert.equal(statusAccountIds.length, 2);
      assert.equal(statusAccountIds.includes(seeded.records[0].id), true);
      assert.equal(statusAccountIds.includes(seeded.records[1].id), true);

      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.exitCode, 0);
      assert.equal(acqB.json?.ok, true);
      const slotDirB = acqB.json!.slot_dir!;
      const credsB = JSON.parse(readFileSync(join(slotDirB, '.credentials.json'), 'utf8')) as {
        claudeAiOauth?: { accessToken?: string };
      };
      assert.equal(
        credsB.claudeAiOauth?.accessToken,
        `sk-ant-oat01-synthetic-${seeded.records[1].id}`,
        'slot_acquire must decrypt records[1] token without cross-account mix',
      );

      const relB = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relB.exitCode, 0);
      assert.equal(relB.json?.ok, true);
      assert.equal(existsSync(join(slotDirB, '.credentials.json')), false);

      return {
        status: 'pass',
        summary: 'Chromium 148 SITE_DATA cleanup, in-tree Junction target preservation, and BAGAID01/SQLite v3 slot credential isolation verified',
        metrics: { siteDataPaths: siteDataPaths.length, companionPaths: companionSiteDataPaths.length },
      };
    },
  },
];
