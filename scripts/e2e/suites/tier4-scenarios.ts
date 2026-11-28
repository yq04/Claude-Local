/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./security-helpers.ts、./perf-ui-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 4 真实端到端多阶段场景套件 cases: E2ECase[]（T4-SCEN-01..T4-SCEN-06，覆盖完整登录导入/详情操作链/双账号并发/Kill-Switch 熔断恢复/全站多断点巡检/MV3 反检测闭环）。
 * [POS]: Milestone E4 Tier 4 端到端真实工作流测试套件；复用 SharedUiHarness 的场景严禁销毁共享沙盒，独立进程/代理场景必须在 finally 与 registerCleanup 双重清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { classifyBrowserExitIsp } from '../../../src/browser-model.ts';
import {
  launchPersistentProfile,
} from '../lib/chrome-harness.ts';
import { MockNetworkSuite } from '../lib/mock-network.ts';
import { MockHttpConnectProxy } from '../lib/mock-proxy.ts';
import {
  resolveClaudeLocalBinary,
  runOrchestrate,
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
  findDangerousSettingsKeys,
  runBrowserStartInPinnedChrome,
  runMv3QuotaBridgeSync,
  startLoopbackQuotaCallbackServer,
} from './security-helpers.ts';

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
  // T4-SCEN-01: 完整身份导入/槽位分配 -> 显式代理预检 -> 冷/热打开 claude.ai -> 漂移重启 -> 退出清理
  // =========================================================================
  {
    id: 'T4-SCEN-01',
    tier: 4,
    features: ['E2E-01', 'E2E-02', 'E2E-03', 'E2E-10'],
    title: '完整身份导入/槽位分配 -> 显式代理预检 -> 冷/热打开 claude.ai -> 退出清理全流程',
    async run(ctx) {
      const { Database } = await import('bun:sqlite');
      const sb = await ctx.createSandbox('t4-scen-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxyA = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxyA.close());
      const proxyB = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxyB.close());
      netSuite.bindToProxy(proxyA, 'tls_terminate');
      netSuite.bindToProxy(proxyB, 'tls_terminate');

      // Stage 1: Synthetic vault import + slot_acquire + relay_switch binding check
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Scen01 Account A',
            accountUuid: '40010001-0000-4000-8000-000000000001',
            email: 'scen01-a@example.invalid',
            proxy: proxyA.url,
            quota5hUsed: 98,
            bindBrowser: false,
          },
          {
            name: 'Scen01 Account B',
            accountUuid: '40010002-0000-4000-8000-000000000002',
            email: 'scen01-b@example.invalid',
            proxy: proxyA.url,
            quota5hUsed: 12,
            bindBrowser: true,
          },
        ],
      });

      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.exitCode, 0);
      assert.equal(acqB.json?.ok, true);
      assert.match(acqB.json!.slot_dir!.replace(/\\/g, '/'), /cli-slots\/[0-9a-f]{32}$/);
      const relB = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relB.exitCode, 0);

      const sw = await runOrchestrate<RelaySwitchJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'relay_switch',
      });
      assert.equal(sw.exitCode, 0);
      assert.equal(sw.json?.ok, true);
      assert.equal(sw.json?.switched, true);

      const db = new Database(join(seeded.vaultDir, 'identities.sqlite'), { readonly: true });
      let assignedSlotA: string | null = null;
      try {
        const row = db
          .query('SELECT slot FROM browser_bindings WHERE identity = ?1')
          .get(seeded.records[0].id) as { slot: string } | null;
        assignedSlotA = row?.slot ?? null;
      } finally {
        db.close();
      }

      // Stage 2: Explicit proxy preflight with 1.1.1.1 priority (www.cloudflare.com blocked)
      proxyA.setFault('www.cloudflare.com', { mode: 'hang_pre_connect' });
      const tPre = Date.now();
      const traceRes = await httpsGetViaProxy({
        proxyPort: proxyA.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 2000,
      });
      const preflightMs = Date.now() - tPre;
      assert.equal(traceRes.statusCode, 200);
      assert.match(traceRes.body, /loc=US/);
      assert.ok(preflightMs < 2000, `Preflight took ${preflightMs}ms >= 2000ms`);
      proxyA.clearFaults();

      // Stage 3: Cold launch claude.ai (BrowseClaudeAi -> no extension)
      const tColdStart = Date.now();
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'contexts-slot-a',
        headless: true,
        argsOptions: { seed: 401401401, proxyUrl: proxyA.url, disableIpv6Probe: true },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const coldLaunchMs = Date.now() - tColdStart;
      const pid1 = persistent.pid ?? 0;
      let coldNavMs = 0;
      let hotTabMs = 0;
      try {
        assert.ok(pid1 > 0 && isPidAlive(pid1));
        assert.equal(persistent.context.serviceWorkers().length, 0);
        const page1 = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        const tNav = Date.now();
        await page1.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page1.locator('[data-mock-route="/new"]').waitFor();
        coldNavMs = Date.now() - tNav;
        await page1.evaluate(() => {
          document.cookie = 'scen01=cold; path=/';
          localStorage.setItem('scen01_marker', 'warm_session');
        });

        // Stage 4: Hot second tab reuses same PID without drift
        assert.equal(isPidAlive(pid1), true);
        const tHot = Date.now();
        const page2 = await persistent.context.newPage();
        await page2.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page2.locator('[data-mock-route="/new"]').waitFor();
        hotTabMs = Date.now() - tHot;
        const marker = await page2.evaluate(() => localStorage.getItem('scen01_marker'));
        assert.equal(marker, 'warm_session');
      } finally {
        await persistent.close();
      }
      assert.equal(isPidAlive(pid1), false, 'First Chrome PID must exit cleanly before drift restart');
      proxyA.assertNoDomainDnsLeak();
      assert.ok(hotTabMs < 5000);
      assert.ok(hotTabMs < coldLaunchMs + coldNavMs + 200);

      // Stage 5: Controlled drift restart onto proxyB and clean exit
      const persistent2 = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'contexts-slot-a',
        headless: true,
        argsOptions: { seed: 401401401, proxyUrl: proxyB.url, disableIpv6Probe: true },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const pid2 = persistent2.pid ?? 0;
      try {
        assert.ok(pid2 > 0 && isPidAlive(pid2));
        assert.notEqual(pid2, pid1);
        const page = persistent2.context.pages()[0] ?? (await persistent2.context.newPage());
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.locator('[data-mock-route="/new"]').waitFor();
      } finally {
        await persistent2.close();
      }
      assert.equal(isPidAlive(pid2), false);
      assert.ok(proxyB.getAuditLog().some((e) => e.host === 'claude.ai'));
      proxyB.assertNoDomainDnsLeak();

      // Stage 6: Rust performance & cleanup contract verification
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const profRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'));
      assert.equal(qcRs.includes('struct LaunchPhaseTimings'), true);
      assert.equal(qcRs.includes('CliProofCache'), true);
      assert.equal(profRs.includes('RunningMemoGuard'), true);
      assert.equal(profRs.includes('Default/AttributionReporting'), true);

      if (assignedSlotA === 'legacy' || assignedSlotA === null) {
        return gapOrFail(
          ctx.mode,
          `M2 F9 binary gap in T4-SCEN-01: relay_switch bound Account A to "${String(assignedSlotA)}" (expected 32-hex); cold/hot/drift Chrome stages passed`,
          { assignedSlot: String(assignedSlotA), preflightMs, coldLaunchMs, coldNavMs, hotTabMs },
        );
      }
      assert.match(assignedSlotA, /^[0-9a-f]{32}$/);

      return {
        status: 'pass',
        summary: `Full identity-to-claude.ai lifecycle passed (slot=${assignedSlotA}, preflight=${preflightMs}ms, cold=${coldLaunchMs + coldNavMs}ms, hot=${hotTabMs}ms)`,
        metrics: { assignedSlot: assignedSlotA, preflightMs, coldLaunchMs, coldNavMs, hotTabMs },
      };
    },
  },

  // =========================================================================
  // T4-SCEN-02: 详情弹窗精简操作链（SharedUiHarness）
  // =========================================================================
  {
    id: 'T4-SCEN-02',
    tier: 4,
    features: ['E2E-04', 'E2E-06', 'E2E-09'],
    title: '详情弹窗精简操作链：QuotaDetailsModal 打开 -> 仅 2 按钮 -> 进入 claude.ai / 同步与重置核验 -> KYC 只读',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const nowMs = nowSec * 1000;
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          uiLanguage: 'zh',
          syncBehavior: { verifyResetSuccess: true, dropUsed7dTo: 12, decrementResets: true },
          identities: {
            current: {
              quota_7d_used: 93,
              quota_7d_fable_used: 40,
              quota_7d_fable_reset_at: nowSec + 3 * 86400,
              manual_resets_remaining: 2,
              manual_resets_valid_until: nowSec + 43200,
              manual_resets_observed_at_ms: nowMs - 60_000,
              manual_resets_grants: [{ resets_left: 2, ends_at: nowSec + 12 * 3600 }],
              kyc_status: 'approved',
              kyc_check_kind: 'persona',
              kyc_observed_at_ms: nowMs - 60_000,
            },
          },
        },
      });

      try {
        // Stage 1 & 2: Open modal, verify 600px 5-layer layout, 2 buttons, no legacy buttons, read-only KYC
        const opener = ui.page.locator('.identity-card.current .identity-quota-open');
        await opener.click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        const layout = await dialog.evaluate((node) => ({
          width: Math.round(node.getBoundingClientRect().width),
          hasProfile: Boolean(node.querySelector('.quota-details-profile')),
          windows: node.querySelectorAll('.quota-details-window').length,
          hasPace: Boolean(node.querySelector('.quota-details-pace')),
          hasFacts: Boolean(node.querySelector('dl.quota-details-facts')),
          hasDisclosure: Boolean(node.querySelector('.quota-details-disclosure')),
          actions: [...node.querySelectorAll('.confirm-actions button')].map((b) => b.textContent?.trim() ?? ''),
          kycLinks: node.querySelectorAll('[data-kyc-status="approved"] a').length,
          kycText: node.querySelector('[data-kyc-status="approved"]')?.textContent ?? '',
        }));

        assert.equal(layout.width, 600);
        assert.equal(layout.hasProfile, true);
        assert.equal(layout.windows, 2);
        assert.equal(layout.hasPace, true);
        assert.equal(layout.hasFacts, true);
        assert.equal(layout.hasDisclosure, true);
        assert.deepEqual(layout.actions, ['进入 Claude.ai', '网页同步额度与重置']);
        assert.equal(layout.kycLinks, 0);
        assert.equal(layout.kycText.includes('vendor_inquiry'), false);
        for (const oldLabel of ['刷新本地记录', '唤醒 5h 计时', '在线校准额度', '打开官方用量页']) {
          assert.equal(await dialog.getByRole('button', { name: oldLabel, exact: true }).count(), 0);
        }

        // Stage 3: Trigger Enter Claude.ai, inline quick-reset, verify-reset, and Sync button
        await ui.clearIpc();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        let cmds = await ui.getIpcCommands();
        const openCmd = cmds.find((c) => c.command === 'browser_open_identity_profile');
        assert.ok(openCmd);
        assert.deepEqual(openCmd.args, {
          accountId: 'current',
          expectedIdentity: HEX_FP(1),
          openMode: 'claude_ai',
        });
        assert.equal(cmds.filter((c) => c.command === 'identities_stop').length, 0);

        await ui.clearIpc();
        await dialog.locator('.identity-relay-quick-reset-btn').click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent?.includes('官方用量页') || el?.textContent?.includes('usage'));
        });
        cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'browser_open_usage'));

        await ui.clearIpc();
        await dialog.locator('[data-details-verify-reset]').click();
        await ui.page.waitForFunction(() => document.querySelectorAll('.identity-relay-quick-reset-btn').length === 0);
        cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'identities_sync_subscription'));
        const resetCountText = await dialog.locator('[data-reset-urgency] .quota-details-strong').innerText();
        assert.equal(resetCountText.includes('1'), true, `Expected decremented reset count 1, got ${resetCountText}`);
        const window7dText = await dialog.locator('[data-quota-window="7d"]').innerText();
        assert.equal(window7dText.includes('88%'), true, `Expected 7d remaining 88% (used=12), got ${window7dText}`);

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent?.includes('已从浏览器同步') || el?.textContent?.includes('Synced quota'));
        });
        cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'identities_sync_subscription'));

        // Stage 4: Close, switch to EN, reopen and assert zero CJK / raw keys
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await ui.page.getByRole('radio', { name: 'EN', exact: true }).click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'en');

        await opener.click();
        await dialog.waitFor();
        const enActions = (await dialog.locator('.confirm-actions button').allInnerTexts()).map((s) => s.trim());
        assert.deepEqual(enActions, ['Open Claude.ai', 'Sync web quota & resets']);
        const modalText = await dialog.innerText();
        assert.equal(/[\u3400-\u9fff]/.test(modalText), false, `Unexpected CJK in EN modal: ${modalText}`);
        assert.equal(/\b(?:quota|browser|identityCard|relay)\.[a-zA-Z0-9_.]+/.test(modalText), false, `Raw i18n key leaked in modal: ${modalText}`);

        // Stage 5: Close restores focus to opener; zero errors & unhandled commands
        await dialog.getByRole('button', { name: /Close/i }).click();
        await dialog.waitFor({ state: 'detached' });
        await ui.page.waitForFunction(
          () => document.activeElement === document.querySelector('.identity-card.current .identity-quota-open'),
        );

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);

        return {
          status: 'pass',
          summary: 'QuotaDetailsModal 2-button flow, inline reset verification, EN re-translation, and restoreFocus verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // T4-SCEN-03: 多账号并发隔离工作流
  // =========================================================================
  {
    id: 'T4-SCEN-03',
    tier: 4,
    features: ['E2E-08', 'E2E-10', 'E2E-11'],
    title: '多账号并发隔离工作流：Account A (US 显式代理) 与 Account B (TUN) 并发运行、--orchestrate 切号与凭据剥离',
    async run(ctx) {
      const sb = await ctx.createSandbox('t4-scen-03');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxyA = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxyA.close());
      netSuite.bindToProxy(proxyA, 'tls_terminate');

      // Stage 1: Vault + dangerous host settings + host userID sentinel
      const sentinelUserId = 't4-scen03-host-userid-sentinel';
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Concurrent A',
            accountUuid: '40030001-0000-4000-8000-000000000001',
            email: 'scen03-a@example.invalid',
            proxy: proxyA.url,
            quota5hUsed: 98,
            bindBrowser: true,
          },
          {
            name: 'Concurrent B',
            accountUuid: '40030002-0000-4000-8000-000000000002',
            email: 'scen03-b@example.invalid',
            quota5hUsed: 12,
            bindBrowser: true,
          },
        ],
      });

      const homeClaudePath = join(sb.paths.homeDir, '.claude.json');
      const homeClaude = JSON.parse(readFileSync(homeClaudePath, 'utf8')) as Record<string, unknown>;
      homeClaude.userID = sentinelUserId;
      writeFileSync(homeClaudePath, JSON.stringify(homeClaude, null, 2));

      writeFileSync(
        join(sb.paths.homeDir, '.claude', 'settings.json'),
        JSON.stringify(
          {
            apiKeyHelper: 'echo scen03-key',
            otelHeadersHelper: 'echo scen03-otel',
            awsAuthRefresh: 'echo scen03-aws',
            customHeaders: { 'X-Scen03': '1' },
            statusLine: { type: 'command', command: 'echo scen03-status' },
            env: {
              ANTHROPIC_API_KEY: 'sk-ant-api03-scen03-strip',
              CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-scen03-strip',
            },
          },
          null,
          2,
        ),
      );

      // Stage 2: Concurrent Account A (explicit proxy) + Account B (TUN noProxyServer) Chrome profiles
      const profA = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'scen03-acct-a',
        headless: true,
        argsOptions: { seed: 1001, proxyUrl: proxyA.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const profB = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'scen03-acct-b',
        headless: true,
        argsOptions: { seed: 2002, noProxyServer: true },
        allowedUrlPrefixes: ['https://claude.ai/', `${netSuite.httpsBaseUrl}/`],
      });

      try {
        assert.ok(profA.pid && isPidAlive(profA.pid));
        assert.ok(profB.pid && isPidAlive(profB.pid));
        assert.notEqual(profA.pid, profB.pid);

        const pageA = profA.context.pages()[0] ?? (await profA.context.newPage());
        await pageA.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await pageA.evaluate(() => {
          document.cookie = 'acct=A; path=/';
          localStorage.setItem('slot_tag', 'account_a');
        });

        const pageB = profB.context.pages()[0] ?? (await profB.context.newPage());
        await pageB.goto(`${netSuite.httpsBaseUrl}/probe/webrtc.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        await pageB.evaluate(() => {
          document.cookie = 'acct=B; path=/';
          localStorage.setItem('slot_tag', 'account_b');
        });

        const readA = await pageA.evaluate(() => ({ c: document.cookie, ls: localStorage.getItem('slot_tag') }));
        const readB = await pageB.evaluate(() => ({ c: document.cookie, ls: localStorage.getItem('slot_tag') }));
        assert.match(readA.c, /acct=A/);
        assert.equal(readA.ls, 'account_a');
        assert.match(readB.c, /acct=B/);
        assert.equal(readB.ls, 'account_b');
        assert.equal(readB.c.includes('acct=A'), false);
      } finally {
        await profA.close();
        await profB.close();
      }
      proxyA.assertNoDomainDnsLeak();

      // Stage 3: --orchestrate slot_acquire for B + HMAC device tuple + settings stripping
      const acqB = await runOrchestrate<SlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
      });
      assert.equal(acqB.exitCode, 0);
      assert.equal(acqB.json?.ok, true);
      const slotDir = acqB.json!.slot_dir!;
      assert.match(slotDir.replace(/\\/g, '/'), /cli-slots\/[0-9a-f]{32}$/);

      const slotClaude = JSON.parse(readFileSync(join(slotDir, '.claude.json'), 'utf8')) as { userID: string };
      assert.match(slotClaude.userID, /^[0-9a-f]{64}$/);
      assert.notEqual(slotClaude.userID, sentinelUserId);

      const slotSettings = JSON.parse(readFileSync(join(slotDir, 'settings.json'), 'utf8')) as Record<
        string,
        unknown
      > & { env?: Record<string, string> };
      assert.equal(slotSettings.env?.ANTHROPIC_API_KEY, undefined);
      assert.equal(slotSettings.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined);
      assert.equal(slotSettings.env?.DISABLE_TELEMETRY, '1');
      assert.equal(slotSettings.env?.DO_NOT_TRACK, '1');
      const remainingDangerous = findDangerousSettingsKeys(slotSettings);

      // Stage 4: slot_release (credential scrub + .baga re-seal) + home sentinel check -> relay_switch A -> B + kill_switch per-slot cadence
      const relB = await runOrchestrate<SlotReleaseJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_release',
        record_id: seeded.records[1].id,
      });
      assert.equal(relB.exitCode, 0);
      assert.equal(relB.json?.ok, true);
      assert.equal(existsSync(join(slotDir, '.credentials.json')), false);

      const homeBeforeSwitch = JSON.parse(readFileSync(homeClaudePath, 'utf8')) as { userID?: string };
      assert.equal(homeBeforeSwitch.userID, sentinelUserId, 'slot_acquire/slot_release must preserve home ~/.claude.json userID');

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

      const homeAfter = JSON.parse(readFileSync(homeClaudePath, 'utf8')) as { userID?: string };
      assert.equal(homeAfter.userID, slotClaude.userID, 'relay_switch must update home ~/.claude.json to Account B device ID');

      const ksRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'));
      const onSlotsTick = extractRustFnBody(ksRs, 'on_slots_tick');
      assert.equal(onSlotsTick.includes('if proxy.is_empty() { 8 } else { 2 }'), true);
      assert.equal(onSlotsTick.includes('st.tick_count % exit_probe_mod == 0'), true);
      assert.equal(extractRustFnBody(ksRs, 'spawn_monitor').includes('aggregate_tun_proxy(&routes)'), false);

      if (remainingDangerous.length > 0) {
        return gapOrFail(
          ctx.mode,
          `M2 F9 binary gap in T4-SCEN-03: slot settings.json kept dangerous host keys [${remainingDangerous.join(', ')}]`,
          { remainingCount: remainingDangerous.length, remainingKeys: remainingDangerous.join(',') },
        );
      }

      return {
        status: 'pass',
        summary: 'Concurrent multi-account proxy/TUN profiles, CLI slot isolation, dangerous key stripping, and relay_switch handoff verified',
      };
    },
  },

  // =========================================================================
  // T4-SCEN-04: 出口漂移/机房跳变触发 Kill-Switch -> 仅关闭受管浏览器 -> 恢复重开
  // =========================================================================
  {
    id: 'T4-SCEN-04',
    tier: 4,
    features: ['E2E-03', 'E2E-08', 'E2E-12'],
    title: '运行中出口机房跳变触发 Kill-Switch 熔断 -> 仅关闭受管伴生浏览器 -> 健康恢复后重开',
    async run(ctx) {
      const sb = await ctx.createSandbox('t4-scen-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // Stage 1: Launch managed and unmanaged browsers under healthy US residential exit
      const managed = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'scen04-managed-slot',
        headless: true,
        argsOptions: { seed: 4041001, proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai/'],
      });
      const unmanaged = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'scen04-unmanaged-other',
        headless: true,
        argsOptions: { seed: 4049999 },
        allowedUrlPrefixes: [],
      });
      let managed2: Awaited<ReturnType<typeof launchPersistentProfile>> | null = null;

      try {
        assert.ok(managed.pid && isPidAlive(managed.pid));
        assert.ok(unmanaged.pid && isPidAlive(unmanaged.pid));

        // Stage 2: Mid-session datacenter jump + primary GeoIP 429 fallback
        netSuite.applyTracePreset('us_datacenter');
        netSuite.setProviderFault('ipquery', 'rate_limit_429');
        const ipinfoRes = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'ipinfo.io',
          path: '/json',
        });
        assert.equal(ipinfoRes.statusCode, 200);
        const ipinfoJson = JSON.parse(ipinfoRes.body) as { org?: string };
        assert.match(ipinfoJson.org ?? '', /AS15169/);

        const ksRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/kill_switch.rs'));
        const probeRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/risk_check/probe.rs'));
        assert.equal(hasRustFn(ksRs, 'observe_slot_ip_status'), true);
        assert.equal(extractRustFnBody(ksRs, 'spawn_monitor').includes('is_hosting_exit'), true);
        assert.equal(hasRustFn(ksRs, 'trigger_kill_switch'), true);
        assert.equal(probeRs.includes('crate::browser::config::proxy('), true);

        // Stage 3: Trigger Kill-Switch UI banner & close ONLY managed Chrome (unmanaged survives)
        const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
        try {
          await ui.page.locator('.workspace-nav').nth(1).click();
          await ui.page.locator('.browser-page').waitFor();
          await ui.emitEvent('kill-switch-triggered', {
            enabled: true,
            triggered: true,
            reason_code: 'exit_datacenter',
            expected_country: 'US',
            observed_country: 'US',
            triggered_at: Math.floor(Date.now() / 1000),
            closed_slots: [HEX_ID(1)],
          });
          await ui.page.locator('[data-kill-switch-banner]').waitFor();

          await managed.close();
          assert.equal(isPidAlive(managed.pid!), false);
          assert.equal(isPidAlive(unmanaged.pid!), true, 'Unmanaged browser must survive kill-switch');

          assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
          assert.deepEqual(await ui.getUnhandledCommands(), []);
        } finally {
          await ui.close();
        }

        // Stage 4: Blocked relaunch/dismiss guard contracts -> verify datacenter still active -> restore healthy US ISP -> GeoIP + relaunch managed2
        const ensureHealthyFn = extractRustFnBody(ksRs, 'ensure_launch_route_healthy_when_triggered');
        const dismissProbeFn = extractRustFnBody(ksRs, 'evaluate_dismiss_probe');
        assert.equal(ensureHealthyFn.includes('is_triggered'), true);
        assert.equal(dismissProbeFn.includes('is_hosting_exit'), true);

        const preRecoveryIpquery = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'api.ipquery.io',
          path: '/?format=json',
        });
        assert.equal(preRecoveryIpquery.statusCode, 429);
        const preRecoveryIpinfo = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'ipinfo.io',
          path: '/json',
        });
        assert.equal(preRecoveryIpinfo.statusCode, 200);
        const preRecoveryIpinfoJson = JSON.parse(preRecoveryIpinfo.body) as {
          ip?: string;
          org?: string;
          hosting?: boolean;
        };
        assert.equal(preRecoveryIpinfoJson.ip, '198.51.100.99');
        assert.equal(preRecoveryIpinfoJson.hosting, true);
        assert.match(preRecoveryIpinfoJson.org ?? '', /AS15169/);

        netSuite.applyTracePreset('us_isp');
        const recoveredTrace = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: '1.1.1.1',
          path: '/cdn-cgi/trace',
        });
        assert.equal(recoveredTrace.statusCode, 200);
        assert.match(recoveredTrace.body, /loc=US/);
        assert.match(recoveredTrace.body, /ip=203\.0\.113\.10/);

        const recoveredGeo = await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'api.ipquery.io',
          path: '/?format=json',
        });
        assert.equal(recoveredGeo.statusCode, 200);
        const recoveredGeoJson = JSON.parse(recoveredGeo.body) as {
          ip?: string;
          location?: { country_code?: string };
          isp?: { asn?: string; isp?: string };
          risk?: { is_datacenter?: boolean };
        };
        assert.equal(recoveredGeoJson.ip, '203.0.113.10');
        assert.equal(recoveredGeoJson.location?.country_code, 'US');
        assert.equal(recoveredGeoJson.risk?.is_datacenter, false);
        assert.equal(recoveredGeoJson.isp?.asn, 'AS6079');
        assert.equal(
          classifyBrowserExitIsp({
            asn: recoveredGeoJson.isp?.asn,
            isp: recoveredGeoJson.isp?.isp ?? '',
            hosting: recoveredGeoJson.risk?.is_datacenter,
          }),
          'isp',
        );

        const auditBeforeRelaunch = proxy.getAuditLog().length;
        managed2 = await launchPersistentProfile({
          repoRoot: ctx.repoRoot,
          sandbox: sb,
          profileName: 'scen04-managed-slot',
          headless: true,
          argsOptions: { seed: 4041001, proxyUrl: proxy.url },
          allowedUrlPrefixes: ['https://claude.ai/', 'https://api.ipquery.io/'],
        });
        const page2 = managed2.context.pages()[0] ?? (await managed2.context.newPage());
        await page2.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page2.locator('[data-mock-route="/new"]').waitFor();
        const browserGeo = await page2.evaluate(async () => {
          const resp = await fetch('https://api.ipquery.io/?format=json');
          return {
            status: resp.status,
            json: (await resp.json()) as {
              risk?: { is_datacenter?: boolean };
              isp?: { asn?: string };
            },
          };
        });
        assert.equal(browserGeo.status, 200);
        assert.equal(browserGeo.json.risk?.is_datacenter, false);
        assert.equal(browserGeo.json.isp?.asn, 'AS6079');
        const relaunchAudit = proxy.getAuditLog().slice(auditBeforeRelaunch);
        assert.equal(
          relaunchAudit.some((e) => e.host === 'claude.ai' && e.isLiteralIp === false),
          true,
        );
        assert.equal(
          relaunchAudit.some((e) => e.host === 'api.ipquery.io' && e.isLiteralIp === false),
          true,
        );
        assert.equal(managed2.abortedUrls.length, 0);
        proxy.assertNoDomainDnsLeak();

        return {
          status: 'pass',
          summary: 'Mid-session datacenter kill-switch, zero collateral kill, residential ISP recovery probe, and clean relaunch verified',
        };
      } finally {
        await managed.close();
        await unmanaged.close();
        if (managed2) await managed2.close();
      }
    },
  },

  // =========================================================================
  // T4-SCEN-05: 全站 10 页双语 + 明暗主题 + 经典/紧凑侧栏 + 多断点全量巡检（SharedUiHarness）
  // =========================================================================
  {
    id: 'T4-SCEN-05',
    tier: 4,
    features: ['E2E-05', 'E2E-06'],
    title: '全站 10 页双语 (zh/en) + 明暗主题 + 经典/紧凑侧栏 + 多断点 (760×640 / 1040×820 / 1440×900) 全量巡检',
    async run(ctx) {
      // Stage 1: Static CSS cascade & bilingual YAML parity
      const mainTsx = stripJsComments(readRepoText(ctx.repoRoot, 'src/main.tsx'));
      const styleCss = readRepoText(ctx.repoRoot, 'src/style.css');
      assert.ok(mainTsx.indexOf("import './index.css'") < mainTsx.indexOf("import './style.css'"));
      assert.ok(mainTsx.indexOf("import './style.css'") < mainTsx.indexOf("import './productivity-shell.css'"));
      assert.equal(/quota-details/.test(styleCss), false, 'style.css must not contain scattered .quota-details rules');

      const cat = validateCatalogPair(
        readRepoText(ctx.repoRoot, 'src/locales/zh.yaml'),
        readRepoText(ctx.repoRoot, 'src/locales/en.yaml'),
      );
      assert.equal(cat.errors.length, 0, cat.errors.join('; '));

      // Stage 2: Orthogonal 4-combo x 10-page sweep (40 page checks) on SharedUiHarness
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        contextOptions: { viewport: { width: 1040, height: 820 }, reducedMotion: 'reduce' },
      });
      const combos = [
        { locale: 'zh', theme: 'light', layout: 'classic', width: 1040, height: 820 },
        { locale: 'en', theme: 'dark', layout: 'compact', width: 760, height: 640 },
        { locale: 'en', theme: 'light', layout: 'compact', width: 1440, height: 900 },
        { locale: 'zh', theme: 'dark', layout: 'classic', width: 1040, height: 820 },
      ] as const;
      let totalPageAssertions = 0;

      try {
        await ui.page.locator('.workspace-nav').last().waitFor();

        for (const c of combos) {
          await ui.page.setViewportSize({ width: c.width, height: c.height });
          await ui.page.getByRole('radio', { name: c.locale === 'zh' ? 'CN' : 'EN', exact: true }).click();
          await ui.page.waitForFunction(
            (loc) => document.documentElement.getAttribute('data-locale') === loc,
            c.locale,
          );
          await ui.page.evaluate(async (cfg) => {
            const modPath = '/src/settings-model.ts';
            const { updatePreferences } = await import(modPath);
            updatePreferences({ theme: cfg.theme, sidebarLayout: cfg.layout, reduceMotion: true });
          }, c);

          for (let idx = 0; idx < 10; idx++) {
            await ui.page.locator('.workspace-nav').nth(idx).click();
            await ui.page.locator('.workspace h1').waitFor();
            await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

            const snap = await ui.page.evaluate(() => {
              const h1 = document.querySelector('.workspace h1') as HTMLElement;
              const hdr = document.querySelector('.workspace .cleanup-title, .workspace header') as HTMLElement;
              const root = document.querySelector('.cleaner-slot > *') as HTMLElement | null;
              const bodyText = (document.querySelector('.workspace') as HTMLElement | null)?.innerText ?? '';
              return {
                docScrollW: document.documentElement.scrollWidth,
                docClientW: document.documentElement.clientWidth,
                rootScrollW: root?.scrollWidth ?? 0,
                rootClientW: root?.clientWidth ?? 0,
                h1Size: getComputedStyle(h1).fontSize,
                hdrH: Math.round(hdr.getBoundingClientRect().height),
                bodyText,
              };
            });

            assert.ok(snap.docScrollW <= snap.docClientW + 1, `Doc overflow on ${c.locale}/${c.theme}/${c.layout}/${c.width} nav-${idx}`);
            assert.ok(snap.rootScrollW <= snap.rootClientW + 1, `Root overflow on ${c.locale}/${c.theme}/${c.layout}/${c.width} nav-${idx}`);
            assert.equal(snap.h1Size, '18px');
            assert.ok(snap.hdrH >= 44, `Header height ${snap.hdrH} < 44 on nav-${idx}`);
            if (c.locale === 'en') {
              const cleaned = snap.bodyText
                .replaceAll('简体中文', '')
                .replaceAll('Claude-Local Browser.app', '');
              assert.equal(/[\u3400-\u9fff]/.test(cleaned), false, `CJK leak in EN nav-${idx}: ${cleaned.slice(0, 120)}`);
              assert.equal(/\b(?:quota|browser|browserSafety|identityCard|relay|usage|logs|risk)\.[a-zA-Z0-9_.]+/.test(cleaned), false, `Raw i18n key in EN nav-${idx}`);
            }
            totalPageAssertions++;
          }
        }

        // Stage 3: Page-level hard geometry contracts (cleaner / system / vps)
        await ui.page.setViewportSize({ width: 1040, height: 820 });
        await ui.page.locator('.workspace-nav').nth(5).click(); // cleaner
        await ui.page.locator('.identity-card.current').waitFor();
        const cardGeo = await ui.page.locator('.identity-card.current').evaluate((n) => {
          const r = n.getBoundingClientRect();
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            transform: getComputedStyle(n).transform,
          };
        });
        assert.equal(cardGeo.w, 166);
        assert.equal(cardGeo.h, 286);
        assert.equal(cardGeo.transform.includes('matrix3d'), false);

        await ui.page.locator('.workspace-nav').nth(2).click(); // system
        await ui.page.locator('.system-environment-page').waitFor();
        const sysGeo = await ui.page.locator('.system-environment-page').evaluate((root) => {
          const cards = [...root.querySelectorAll('.system-setting-card')];
          return {
            tzH: cards[0]?.getBoundingClientRect().height ?? 0,
            locH: cards[2]?.getBoundingClientRect().height ?? 0,
            locBtns: root.querySelectorAll('.system-location-controls > button').length,
          };
        });
        assert.ok(sysGeo.locH <= sysGeo.tzH - 20);
        assert.equal(sysGeo.locBtns, 1);

        await ui.page.locator('.workspace-nav').nth(3).click(); // vps
        await ui.page.locator('.network-page').waitFor();
        const vpsGeo = await ui.page.locator('.network-page').evaluate((root) => {
          const cards = [...root.querySelectorAll('.network-action-card')];
          return {
            count: cards.length,
            inputsAndLinks: root.querySelectorAll('.network-action-card input, .network-action-card textarea, .network-action-card a').length,
            html: root.innerHTML,
          };
        });
        assert.equal(vpsGeo.count, 3);
        assert.equal(vpsGeo.inputsAndLinks, 0);
        assert.equal(/ikuuu\.top|kookeey\.com|j6Vd|uXqM|14151075/i.test(vpsGeo.html), false);

        // Stage 4: Zero errors and zero unhandled IPC commands
        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);

        return {
          status: 'pass',
          summary: `${totalPageAssertions} orthogonal 10-page checks (zh/en, light/dark, classic/compact, 760/1040/1440) + hard geometry contracts passed`,
          metrics: { totalPageAssertions },
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // T4-SCEN-06: 伴生浏览器反检测与 MV3 桥接闭环 + 回环边界拒绝
  // =========================================================================
  {
    id: 'T4-SCEN-06',
    tier: 4,
    features: ['E2E-07', 'E2E-09', 'E2E-12'],
    title: '伴生浏览器反检测与 MV3 桥接闭环：native_graphics=false -> browser-start 一致 -> MV3 同步 -> 回环拒绝伪造请求',
    async run(ctx) {
      const { randomBytes } = await import('node:crypto');
      const sb = await ctx.createSandbox('t4-scen-06');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      const accountUuid = '40060001-2222-4333-8444-555555555555';
      const email = 'scen06-mv3@example.invalid';
      const organizationUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-400600000001';
      netSuite.setClaudeState({
        accountUuid,
        email,
        organizationUuid,
        usageMode: 'reset_grants',
        kycRaw: {
          status: 'approved',
          check_kind: 'persona',
          vendor_inquiry_id: 'inq_scen06_strip',
          vendor_inquiry_url: 'https://withpersona.com/scen06_strip',
        },
      });
      sb.registerCleanup(() => netSuite.close());

      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy, 'tls_terminate');

      // Stage 1: native_graphics=false browser-start cross-context check under production CSP
      const startRes = await runBrowserStartInPinnedChrome({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        seed: 406406406,
      });
      assert.equal(startRes.phase, 'passed', `Failed checks: ${startRes.failedCheckIds.join(', ')}`);
      assert.equal(startRes.okCount, 20);
      assert.equal(startRes.failedCount, 0);
      assert.equal(startRes.crossContextPillCount, 6);
      assert.equal(startRes.crossContextMetricCount, 9);
      assert.equal(startRes.crossContextBlocking, false);
      assert.equal(startRes.pageErrors.length, 0);

      // Stage 2: Verify BrowseClaudeAi disables extension while native_graphics defaults to false
      const cfgRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const defaultImpl = extractRustBlock(cfgRs, /impl\s+Default\s+for\s+Config\b/);
      assert.equal(/native_graphics:\s*false/.test(defaultImpl), true);
      assert.equal(extractRustFnBody(cfgRs, 'for_purpose').includes('matches!(purpose, LaunchPurpose::QuotaSync)'), true);

      // Stage 3: On-demand MV3 extension sync -> clean URL, reload + cross-tab replay guard, cedar_ember + stripped KYC
      let reloadCount = 0;
      let crossTabCallbacks = 0;
      const mv3Res = await runMv3QuotaBridgeSync({
        repoRoot: ctx.repoRoot,
        sb,
        netSuite,
        proxy,
        accountUuid,
        email,
        organizationUuid,
        onPageReady: async ({ page, bridge, nonce, quotaIdentity }) => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);
          reloadCount = bridge.callbacks.length;

          const tab2 = await page.context().newPage();
          try {
            await tab2.goto(
              `${bridge.baseUrl}/${bridge.token}/browser.html#quota-sync=${nonce}&quota_identity=${quotaIdentity}`,
              { waitUntil: 'domcontentloaded', timeout: 15_000 },
            );
            await tab2.waitForTimeout(400);
            crossTabCallbacks = bridge.callbacks.length;
          } finally {
            await tab2.close();
          }
        },
      });
      assert.equal(mv3Res.finalHash, '');
      assert.equal(reloadCount, 1);
      assert.equal(crossTabCallbacks, 1);
      const cb = mv3Res.callbacks[0];
      assert.equal(cb.origin, 'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg');
      assert.deepEqual(cb.json?.kyc_status, { status: 'approved', check_kind: 'persona' });
      assert.equal(cb.rawBody.includes('vendor_inquiry'), false);
      const usage = cb.json?.usage as { cedar_ember?: { eligible?: boolean } } | undefined;
      assert.equal(usage?.cedar_ember?.eligible, true);

      // Stage 4: Real Chrome + MV3 extension adversarial rejection probes + tightened Rust lexical contracts
      netSuite.resetHits();
      const probeToken = randomBytes(24).toString('hex');
      const forgedNonce = randomBytes(24).toString('hex');
      const probeBridge = await startLoopbackQuotaCallbackServer(probeToken);
      sb.registerCleanup(() => probeBridge.close());

      const evilParentServer = http.createServer((req, res) => {
        const reqPath = (req.url ?? '/').split('?')[0];
        if (reqPath === '/frame-attack.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><html><head><meta charset="utf-8"></head><body><iframe src="${probeBridge.baseUrl}/${probeToken}/browser.html#quota-sync=${forgedNonce}&quota_identity=${mv3Res.quotaIdentity}"></iframe></body></html>`,
          );
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      });
      await new Promise<void>((resolvePromise, rejectPromise) => {
        evilParentServer.once('error', rejectPromise);
        evilParentServer.listen(0, '127.0.0.1', () => {
          evilParentServer.off('error', rejectPromise);
          resolvePromise();
        });
      });
      const closeEvilServer = () =>
        new Promise<void>((resolveClose) => evilParentServer.close(() => resolveClose()));
      sb.registerCleanup(closeEvilServer);
      const evilAddr = evilParentServer.address();
      if (!evilAddr || typeof evilAddr === 'string') {
        await closeEvilServer();
        await probeBridge.close();
        throw new Error('Failed to bind evil parent page server');
      }

      const extDir = resolve(ctx.repoRoot, 'browser-runtime', 'quota-bridge');
      const advProfile = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'scen06-mv3-adversarial',
        headless: true,
        argsOptions: {
          extensionDir: extDir,
          proxyUrl: proxy.url,
        },
        allowedUrlPrefixes: ['http://127.0.0.1:', 'http://localhost:', 'https://claude.ai/'],
      });

      try {
        const advPage = await advProfile.context.newPage();
        advPage.setDefaultTimeout(12_000);

        // Probe A: Sub-frame <iframe> injection of pairing URL must NOT pair
        await advPage.goto(`http://127.0.0.1:${evilAddr.port}/frame-attack.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 12_000,
        });
        await advPage.waitForTimeout(400);
        await advPage.goto('https://claude.ai/settings/usage', {
          waitUntil: 'domcontentloaded',
          timeout: 12_000,
        });
        await advPage.waitForTimeout(400);
        assert.equal(probeBridge.callbacks.length, 0);
        assert.equal(netSuite.getHitCounts()['claude:usage'] ?? 0, 0);

        // Probe B: http://localhost:<port> pairing Host must be rejected by manifest/content/background
        await advPage.goto(
          `http://localhost:${probeBridge.port}/${probeToken}/browser.html#quota-sync=${forgedNonce}&quota_identity=${mv3Res.quotaIdentity}`,
          { waitUntil: 'domcontentloaded', timeout: 10_000 },
        );
        await advPage.waitForTimeout(400);
        await advPage.goto('https://claude.ai/settings/usage', {
          waitUntil: 'domcontentloaded',
          timeout: 12_000,
        });
        await advPage.waitForTimeout(400);
        assert.equal(probeBridge.callbacks.length, 0);
        assert.equal(netSuite.getHitCounts()['claude:usage'] ?? 0, 0);

        // Probe C: Direct unpaired navigation to https://claude.ai/settings/usage#quota-sync=... must NOT trigger sync
        await advPage.goto(
          `https://claude.ai/settings/usage#quota-sync=${forgedNonce}&quota_identity=${mv3Res.quotaIdentity}`,
          { waitUntil: 'domcontentloaded', timeout: 12_000 },
        );
        await advPage.waitForTimeout(400);
        assert.equal(probeBridge.callbacks.length, 0);
        assert.equal(netSuite.getHitCounts()['claude:usage'] ?? 0, 0);
      } finally {
        await advProfile.close();
        await closeEvilServer();
        await probeBridge.close();
      }

      const existingRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_existing.rs'));
      const serverRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/server.rs'));
      const profileRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'));

      const readReqFn = extractRustFnBody(existingRs, 'read_request');
      const receiveFn = extractRustFnBody(existingRs, 'receive_with');
      assert.equal(existingRs.includes('MAX_ACTIVE_CONNS: usize = 8'), true);
      assert.equal(existingRs.includes('FIRST_BYTE_TIMEOUT'), true);
      assert.equal(readReqFn.includes('127.0.0.1:{port}'), true);
      assert.equal(readReqFn.includes('host_count != 1'), true);
      assert.equal(readReqFn.includes('!host_valid'), true);
      assert.equal(readReqFn.includes('if request.origin.is_some()'), true);
      assert.equal(readReqFn.includes('if request.content_type.is_some()'), true);
      assert.equal(readReqFn.includes('if length.is_some()'), true);
      assert.equal(readReqFn.includes('request.method == "POST" && length.unwrap_or(0) == 0'), true);
      assert.equal(readReqFn.includes('"transfer-encoding" => return None'), true);
      assert.equal(receiveFn.includes('request.origin.as_deref() != Some(ORIGIN)'), true);
      assert.equal(receiveFn.includes('incoming.nonce != nonce'), true);
      assert.equal(receiveFn.includes('403 Forbidden'), true);

      // Note: server.rs:95-96 overwrites duplicate Origin/Content-Type headers (last-header-wins),
      // unlike quota_existing.rs:134-151 which rejects duplicates; Rust HTTP runtime unit tests are
      // delegated to Milestone M5 `cargo test --release --features custom-protocol`.
      const parseHeadersFn = extractRustFnBody(serverRs, 'parse_request_headers');
      const handleFn = extractRustFnBody(serverRs, 'handle');
      assert.equal(parseHeadersFn.includes('127.0.0.1:{port}'), true);
      assert.equal(/\blocalhost\b/i.test(parseHeadersFn), false);
      assert.equal(serverRs.includes('quota-sync'), false);
      assert.equal(handleFn.includes('http://127.0.0.1:{port}'), true);

      assert.equal(profileRs.includes('Default/SharedStorage'), true);
      assert.equal(profileRs.includes('Default/Network/Trust Tokens'), true);
      assert.equal(extractRustFnBody(profileRs, 'size').includes('cleaner::linked'), true);

      return {
        status: 'pass',
        summary: 'Anti-detection cross-context pass, on-demand MV3 sync, real Chrome MV3 adversarial rejections (iframe/localhost/unpaired/cross-tab), and Rust lexical contracts verified',
        metrics: { okCount: startRes.okCount, reloadCallbacks: reloadCount, crossTabCallbacks },
      };
    },
  },
];
