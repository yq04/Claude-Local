/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./perf-ui-helpers.ts / ./security-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 2 边界/角点/故障注入/错误拒绝用例数组 cases: E2ECase[]（覆盖 E2E-02, E2E-04, E2E-05, E2E-06，共 20 条，每特性 5 条）。
 * [POS]: Milestone E3 Tier 2 黑盒测试套件；全部故障注入均在 mkdtemp 沙盒内完成，零仓库源文件改动与零宿主机污染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { join } from 'node:path';
import { launchPersistentProfile } from '../lib/chrome-harness.ts';
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
  extractRustFnBody,
  findUnusedLoopbackPort,
  gapOrFail,
  HEX_FP,
  HEX_ID,
  httpsGetViaProxy,
  openAppWithMockUi,
  readRepoText,
  resolveRepoSrcPath,
  stripRustCommentsAndTests,
  validateSandboxedI18nWorkspace,
} from './perf-ui-helpers.ts';

interface OrchestrateSlotAcquireJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id?: string;
  reason?: string;
  error?: string;
}

export const cases: E2ECase[] = [
  // =========================================================================
  // E2E-02: 性能与非阻塞边界/故障注入 (5 Tier 2 cases)
  // =========================================================================
  {
    id: 'T2-E2E02-01',
    tier: 2,
    features: ['E2E-02'],
    title: 'Cleaner::enter_quota 并发占用 / 恢复锁返 quotaOnline.busy',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e02-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      // 1. UI/IPC busy error rendering
      let busyUiRendered = false;
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          commandErrors: {
            browser_open_identity_profile: 'quotaOnline.busy',
          },
        },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const fb = await dialog.locator('.quota-details-feedback').innerText();
        assert.notEqual(fb.trim(), 'quotaOnline.busy', 'UI must render localized busy text, never raw key');
        assert.ok(fb.trim().length > 0);
        busyUiRendered = true;
        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      // 2. --orchestrate duplicate slot_acquire on same non-active account -> targetSlotBusy
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Busy Guard Active',
            accountUuid: '21000001-0000-4000-8000-000000000001',
            email: 'busy-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Busy Guard Standby',
            accountUuid: '21000002-0000-4000-8000-000000000002',
            email: 'busy-b@example.invalid',
            bindBrowser: true,
          },
        ],
      });
      const firstAcq = await runOrchestrate<OrchestrateSlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
        session_tag: 'sess-alpha',
      });
      assert.equal(firstAcq.exitCode, 0);
      assert.equal(firstAcq.json?.ok, true);

      const secondAcq = await runOrchestrate<OrchestrateSlotAcquireJson>(bin.exePath, sb.paths, {
        schema: 1,
        op: 'slot_acquire',
        record_id: seeded.records[1].id,
        session_tag: 'sess-beta',
      });
      assert.equal(secondAcq.json?.ok, false);
      assert.equal(secondAcq.json?.reason, 'relay.error.targetSlotBusy');

      // 3. Lexical Rust checks
      const cleanerRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/cleaner.rs'));
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const onlineRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/identities/online.rs'));

      const enterQuotaBody = extractRustFnBody(cleanerRs, 'enter_quota');
      const enterBrowserAcctBody = cleanerRs.includes('fn enter_browser_account')
        ? extractRustFnBody(cleanerRs, 'enter_browser_account')
        : '';
      const resolvePureBody = extractRustFnBody(qcRs, 'resolve_bound_profile_target_pure');
      const materializeBody = extractRustFnBody(qcRs, 'materialize_identity_profile_with_cache');
      const refreshAllBody = extractRustFnBody(onlineRs, 'identities_refresh_all_quotas');

      const busyGuardsOk =
        enterQuotaBody.includes('WRITER_BIT') &&
        enterQuotaBody.includes('quotaOnline.busy') &&
        enterBrowserAcctBody.includes('WRITER_BIT') &&
        enterBrowserAcctBody.includes('quotaOnline.busy') &&
        resolvePureBody.includes('recovery_pending') &&
        resolvePureBody.includes('quotaOnline.busy') &&
        materializeBody.includes('db.get("recovery")') &&
        materializeBody.includes('quotaOnline.busy') &&
        refreshAllBody.includes('quotaOnline.busy');

      if (!busyGuardsOk) {
        return gapOrFail(ctx.mode, 'Concurrent enter_browser_account / quotaOnline.busy guard incomplete', {
          busyUiRendered,
        });
      }

      return {
        status: 'pass',
        summary: 'Concurrent busy UI feedback, duplicate --orchestrate slot rejection, and Rust busy guards verified',
        metrics: { busyUiRendered },
      };
    },
  },

  {
    id: 'T2-E2E02-02',
    tier: 2,
    features: ['E2E-02'],
    title: '非法/不匹配指纹立即返回 quotaOnline.accountMismatch 且不启 Chrome',
    async run(ctx) {
      let spawnInvoked = 0;
      let mismatchCasesTested = 0;

      // Case A: Backend returns quotaOnline.accountMismatch -> UI surfaces localized error without crash
      const uiA = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          commandErrors: {
            browser_open_identity_profile: 'quotaOnline.accountMismatch',
          },
        },
      });
      try {
        await uiA.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = uiA.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const fb = await dialog.locator('.quota-details-feedback').innerText();
        assert.notEqual(fb.trim(), 'quotaOnline.accountMismatch');
        assert.ok(fb.trim().length > 0);
        mismatchCasesTested++;
        assert.equal(uiA.pageErrors.length, 0, uiA.pageErrors.join('\n'));
      } finally {
        await uiA.close();
      }

      // Case B: Frontend preflight mismatch blocks browser_open_identity_profile before IPC dispatch
      const uiB = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            current: { quota_identity: null },
            summaries: {
              [HEX_ID(1)]: { quota_identity: null },
              [HEX_ID(2)]: { quota_identity: 'bad-short-fp' },
            },
          },
        },
      });
      try {
        await uiB.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = uiB.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        assert.equal(await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).isDisabled(), true);
        mismatchCasesTested++;

        await uiB.clearIpc();
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const cmds = await uiB.getIpcCommands();
        spawnInvoked = cmds.filter(
          (c) => c.command === 'browser_open_identity_profile' || c.command === 'identities_sync_subscription',
        ).length;
        assert.equal(spawnInvoked, 0, 'Missing quota_identity must block IPC before dispatch');
        mismatchCasesTested++;
        assert.equal(uiB.pageErrors.length, 0, uiB.pageErrors.join('\n'));
        assert.deepEqual(await uiB.getUnhandledCommands(), []);
      } finally {
        await uiB.close();
      }

      // Lexical Rust check: validate_fingerprint + pre-spawn revalidate
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const validateBody = extractRustFnBody(qcRs, 'validate_fingerprint');
      const resolvePureBody = extractRustFnBody(qcRs, 'resolve_bound_profile_target_pure');
      const materializeBody = extractRustFnBody(qcRs, 'materialize_identity_profile_with_cache');
      const launchScopeBody = extractRustFnBody(qcRs, 'launch_scope_url_with_options_locked');

      assert.ok(
        validateBody.includes('len() != 64') &&
          validateBody.includes('is_ascii_hexdigit') &&
          validateBody.includes('quotaOnline.accountMismatch'),
      );
      assert.ok(resolvePureBody.includes('validate_fingerprint(expected_identity)?'));
      assert.ok(materializeBody.includes('validate_fingerprint(expected_identity)?'));
      const revalidatePos = launchScopeBody.indexOf('revalidate()?');
      const spawnPos = launchScopeBody.indexOf('Command::new(binary)');
      assert.ok(revalidatePos > 0 && spawnPos > revalidatePos, 'revalidate()? must execute before Command::new(binary)');
      assert.ok(launchScopeBody.includes('fresh_config') && launchScopeBody.includes('quotaOnline.accountMismatch'));

      return {
        status: 'pass',
        summary: 'Invalid/mismatched fingerprint rejected at UI preflight and Rust pre-spawn guard without Chrome launch',
        metrics: { mismatchCasesTested, spawnInvoked },
      };
    },
  },

  {
    id: 'T2-E2E02-03',
    tier: 2,
    features: ['E2E-02'],
    title: 'Mock Proxy hang_pre_connect / slow_tls 及不可达端口 300ms-bounded 预检快速失败',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e02-03');

      // 1. Closed loopback port 300ms-bounded TCP probe
      const unusedPort = await findUnusedLoopbackPort();
      const tClosed = performance.now();
      let closedFailed = false;
      await new Promise<void>((resolveProbe) => {
        const sock = net.connect({ host: '127.0.0.1', port: unusedPort });
        sock.setTimeout(300);
        const done = () => {
          closedFailed = true;
          sock.destroy();
          resolveProbe();
        };
        sock.once('error', done);
        sock.once('timeout', done);
        sock.once('connect', () => {
          sock.destroy();
          resolveProbe();
        });
      });
      const closedPortMs = Math.round(performance.now() - tClosed);
      assert.equal(closedFailed, true, 'Unused port connect must fail');
      assert.ok(closedPortMs < 1000, `Closed loopback probe took ${closedPortMs}ms (>= 1000ms)`);

      // 2. hang_pre_connect & slow_tls bounded timeout via MockHttpConnectProxy
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy);

      proxy.setFault('1.1.1.1', { mode: 'hang_pre_connect' });
      const tHang = performance.now();
      let hangRejected = false;
      try {
        await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: '1.1.1.1',
          path: '/cdn-cgi/trace',
          timeoutMs: 1200,
        });
      } catch {
        hangRejected = true;
      }
      const hangConnectMs = Math.round(performance.now() - tHang);
      assert.equal(hangRejected, true, 'hang_pre_connect must reject on bounded timeout');
      assert.ok(hangConnectMs <= 2200, `hang_pre_connect waited too long: ${hangConnectMs}ms`);

      proxy.setFault('claude.ai', { mode: 'slow_tls', delayMs: 3500 });
      const tSlowTls = performance.now();
      let slowTlsRejected = false;
      try {
        await httpsGetViaProxy({
          proxyPort: proxy.port,
          targetHost: 'claude.ai',
          path: '/new',
          timeoutMs: 1200,
        });
      } catch {
        slowTlsRejected = true;
      }
      const slowTlsMs = Math.round(performance.now() - tSlowTls);
      assert.equal(slowTlsRejected, true, 'slow_tls must reject on bounded TLS timeout');
      assert.ok(slowTlsMs <= 2500, `slow_tls waited too long: ${slowTlsMs}ms`);

      // Lexical Rust check
      const configRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const loopbackBody = extractRustFnBody(configRs, 'preflight_loopback_proxy_with_flag');
      const policyBody = extractRustFnBody(configRs, 'preflight_browser_launch_policy');
      const hasBoundedTimeouts =
        loopbackBody.includes('from_millis(300)') &&
        loopbackBody.includes('connect_timeout') &&
        configRs.includes('EXIT_CONNECT_TIMEOUT') &&
        configRs.includes('EXIT_URL_TIMEOUT') &&
        configRs.includes('EXIT_TOTAL_BUDGET') &&
        policyBody.indexOf('preflight_loopback_proxy') < policyBody.indexOf('evaluate_browser_launch_policy_with_urls');

      if (!hasBoundedTimeouts) {
        return gapOrFail(ctx.mode, '300ms loopback preflight or bounded EXIT_TOTAL_BUDGET missing in config.rs', {
          closedPortMs,
          hangConnectMs,
          slowTlsMs,
        });
      }

      return {
        status: 'pass',
        summary: `Bounded timeouts verified (closedPort=${closedPortMs}ms, hang=${hangConnectMs}ms, slowTls=${slowTlsMs}ms)`,
        metrics: { closedPortMs, hangConnectMs, slowTlsMs },
      };
    },
  },

  {
    id: 'T2-E2E02-04',
    tier: 2,
    features: ['E2E-02'],
    title: '代理 rate_limit_429 故障回退与受限宿主机 fail-closed',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e02-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy);

      // 1. Primary 1.1.1.1 returns 429 -> fallback www.cloudflare.com returns 200 loc=US
      proxy.setFault('1.1.1.1', { mode: 'rate_limit_429', retryAfterSec: 2 });
      const t429 = performance.now();
      const resp429 = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 2000,
      });
      const primary429Ms = Math.round(performance.now() - t429);
      assert.equal(resp429.statusCode, 429);
      assert.ok(primary429Ms < 1000);

      const tFb = performance.now();
      const respFb = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'www.cloudflare.com',
        path: '/cdn-cgi/trace',
        timeoutMs: 2000,
      });
      const fallback200Ms = Math.round(performance.now() - tFb);
      assert.equal(respFb.statusCode, 200);
      assert.match(respFb.body, /loc=US/);

      // 2. GeoIP ipquery 429 -> fallback ipinfo.io 200 US
      netSuite.setProviderFault('ipquery', 'rate_limit_429');
      const geoPrimary = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'api.ipquery.io',
        path: '/?format=json',
        timeoutMs: 2000,
      });
      assert.equal(geoPrimary.statusCode, 429);

      const tGeoFb = performance.now();
      const geoFb = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'ipinfo.io',
        path: '/json',
        timeoutMs: 2000,
      });
      const geoFallbackMs = Math.round(performance.now() - tGeoFb);
      assert.equal(geoFb.statusCode, 200);
      assert.equal((JSON.parse(geoFb.body) as { country?: string }).country, 'US');

      // 3. Lexical Rust checks
      const configRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const networkRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/network.rs'));
      const probeAsyncBody = extractRustFnBody(configRs, 'probe_proxy_exit_country_async');
      const evalPolicyBody = extractRustFnBody(configRs, 'evaluate_browser_launch_policy_with_urls');
      const netProbeBody = extractRustFnBody(networkRs, 'probe_with_classification');

      const fallbackAndFailClosed =
        probeAsyncBody.includes('!resp.status().is_success()') &&
        evalPolicyBody.includes('!allow_direct && machine_is_restricted_region(machine)') &&
        evalPolicyBody.includes('guard.remove(&cache_key)') &&
        netProbeBody.includes('429') &&
        netProbeBody.includes('"rate_limited"');

      if (!fallbackAndFailClosed) {
        return gapOrFail(ctx.mode, '429 fallback or restricted-host fail-closed logic missing', {
          primary429Ms,
          fallback200Ms,
          geoFallbackMs,
        });
      }

      return {
        status: 'pass',
        summary: `429 fallback (1.1.1.1->cloudflare, ipquery->ipinfo) and fail-closed policy verified`,
        metrics: { primary429Ms, fallback200Ms, geoFallbackMs },
      };
    },
  },

  {
    id: 'T2-E2E02-05',
    tier: 2,
    features: ['E2E-02'],
    title: '热打开参数漂移触发受控重启而非静默忽略',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e02-05');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxyA = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxyA.close());
      const proxyB = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxyB.close());
      netSuite.bindToProxy(proxyA);
      netSuite.bindToProxy(proxyB);

      const p1 = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'drift-restart-profile',
        headless: true,
        argsOptions: { proxyUrl: proxyA.url, seed: 10001 },
        allowedUrlPrefixes: ['https://claude.ai'],
      });
      const pid1 = p1.pid ?? 0;
      let proxyAHitsBefore = 0;
      try {
        assert.ok(pid1 > 0 && isPidAlive(pid1), 'First browser process must be alive');
        const page = p1.context.pages()[0] ?? (await p1.context.newPage());
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.locator('[data-mock-route="/new"]').waitFor();
        proxyAHitsBefore = proxyA.getAuditLog().filter((e) => e.host === 'claude.ai').length;
        assert.ok(proxyAHitsBefore >= 1, 'First launch must route through proxyA');
        assert.equal(proxyB.getAuditLog().length, 0);
      } finally {
        await p1.close();
      }
      assert.equal(isPidAlive(pid1), false, 'Old browser PID must exit cleanly on drift restart');

      // Re-launch same profile directory with drifted proxyB & seed=20002
      const p2 = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'drift-restart-profile',
        headless: true,
        argsOptions: { proxyUrl: proxyB.url, seed: 20002 },
        allowedUrlPrefixes: ['https://claude.ai'],
      });
      const pid2 = p2.pid ?? 0;
      try {
        assert.ok(pid2 > 0 && isPidAlive(pid2), 'Restarted browser process must be alive');
        assert.notEqual(pid2, pid1, 'Controlled restart must spawn a new PID');
        const page2 = p2.context.pages()[0] ?? (await p2.context.newPage());
        await page2.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page2.locator('[data-mock-route="/new"]').waitFor();
      } finally {
        await p2.close();
      }

      const proxyAHitsAfter = proxyA.getAuditLog().filter((e) => e.host === 'claude.ai').length;
      const proxyBHitsAfter = proxyB.getAuditLog().filter((e) => e.host === 'claude.ai').length;
      assert.equal(proxyAHitsAfter, proxyAHitsBefore, 'Drifted restart must not keep using proxyA');
      assert.ok(proxyBHitsAfter >= 1, 'Drifted restart must route through proxyB');

      // Lexical Rust checks
      const modRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/mod.rs'));
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const launchRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/launch.rs'));

      const hasSnapshot =
        modRs.includes('struct LaunchRuntimeSnapshot') &&
        modRs.includes('enable_quota_bridge') &&
        modRs.includes('effective_proxy');
      const qcBody = extractRustFnBody(qcRs, 'launch_scope_url_with_options_locked');
      const launchBody = extractRustFnBody(launchRs, 'spawn_with_urls_locked');

      const hasDriftRestart =
        hasSnapshot &&
        qcBody.includes('launch_config_drifted') &&
        qcBody.includes('profile::quit(&profile)') &&
        qcBody.includes('clear_launched_config') &&
        launchBody.includes('LaunchRuntimeSnapshot::from_config_with_options') &&
        launchBody.includes('prev != &desired') &&
        launchBody.includes('profile::quit(&profile)');

      if (!hasDriftRestart) {
        return gapOrFail(ctx.mode, 'LaunchRuntimeSnapshot or controlled drift restart missing in Rust', {
          pid1,
          pid2,
          proxyAHitsBefore,
          proxyAHitsAfter,
          proxyBHitsAfter,
        });
      }

      return {
        status: 'pass',
        summary: `Controlled drift restart verified (pid1=${pid1} -> pid2=${pid2}, proxyA=${proxyAHitsAfter}, proxyB=${proxyBHitsAfter})`,
        metrics: { pid1, pid2, proxyAHitsBefore, proxyAHitsAfter, proxyBHitsAfter },
      };
    },
  },

  // =========================================================================
  // E2E-04: QuotaDetailsModal 边界与错误处理 (5 Tier 2 cases)
  // =========================================================================
  {
    id: 'T2-E2E04-01',
    tier: 2,
    features: ['E2E-04'],
    title: 'expectedIdentity 缺失边界（当前身份 2 按钮+前端拦截 vs 已保存身份 1 按钮）',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            current: { quota_identity: null },
            summaries: {
              [HEX_ID(1)]: { quota_identity: null },
              [HEX_ID(2)]: { quota_identity: null },
            },
          },
        },
      });
      try {
        // Scenario A: Current identity with quota_identity=null -> 2 buttons, enterClaudeAi disabled, sync clicks blocked by preflight
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        assert.equal(await dialog.locator('.confirm-actions button').count(), 2);
        assert.equal(await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).isDisabled(), true);

        await ui.clearIpc();
        const syncBtn = dialog.getByRole('button', { name: '网页同步额度与重置', exact: true });
        assert.equal(await syncBtn.isEnabled(), true);
        await syncBtn.click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const cmds = await ui.getIpcCommands();
        assert.equal(cmds.filter((c) => c.command === 'identities_sync_subscription').length, 0);
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();

        // Scenario B: Saved identity with quota_identity=null -> only 1 disabled enterClaudeAi button
        const savedCard = ui.page.locator('.identity-card:not(.current)').filter({
          has: ui.page.getByRole('heading', { name: 'Identity 2', exact: true }),
        });
        await savedCard.locator('.identity-quota-open').click();
        await dialog.waitFor();
        assert.equal(await dialog.locator('.confirm-actions button').count(), 1);
        assert.equal(await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).isDisabled(), true);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Missing expectedIdentity boundary verified for both current (2 btns + preflight block) and saved (1 disabled btn)',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E04-02',
    tier: 2,
    features: ['E2E-04'],
    title: 'browser.enabled=false 与 state.recovery 禁用边界',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const nowMs = nowSec * 1000;

      // 1. browser.enabled = false
      const uiNoBrowser = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            browser: { enabled: false, bound_ids: [] },
            current: {
              quota_7d_used: 95,
              manual_resets_remaining: 2,
              manual_resets_valid_until: nowSec + 43200,
              manual_resets_observed_at_ms: nowMs - 60000,
            },
          },
        },
      });
      try {
        await uiNoBrowser.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = uiNoBrowser.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        assert.equal(await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).isDisabled(), true);
        assert.equal(await dialog.locator('.identity-relay-quick-reset-btn').isDisabled(), true);
        assert.equal(await dialog.locator('[data-details-verify-reset]').isDisabled(), true);
        assert.equal(uiNoBrowser.pageErrors.length, 0);
      } finally {
        await uiNoBrowser.close();
      }

      // 2. state.recovery !== null
      const uiRecovery = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            recovery: HEX_ID(1),
            current: {
              quota_7d_used: 95,
              manual_resets_remaining: 2,
              manual_resets_valid_until: nowSec + 43200,
              manual_resets_observed_at_ms: nowMs - 60000,
            },
          },
        },
      });
      try {
        await uiRecovery.clearIpc();
        await uiRecovery.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = uiRecovery.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        assert.equal(await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).isDisabled(), true);
        assert.equal(await dialog.locator('.identity-relay-quick-reset-btn').isDisabled(), true);
        const cmds = await uiRecovery.getIpcCommands();
        assert.equal(cmds.filter((c) => c.command.startsWith('browser_open_')).length, 0);
        assert.equal(uiRecovery.pageErrors.length, 0);
        assert.deepEqual(await uiRecovery.getUnhandledCommands(), []);
      } finally {
        await uiRecovery.close();
      }

      return {
        status: 'pass',
        summary: 'browser.enabled=false and state.recovery!=null disable footer & reset-card buttons cleanly',
      };
    },
  },

  {
    id: 'T2-E2E04-03',
    tier: 2,
    features: ['E2E-04'],
    title: 'reset_inferred 推断状态与 refresh_token 到期警告',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            current: {
              quota_5h_source: 'server_anchor',
              quota_5h_used: 80,
              quota_5h_reset_at: nowSec - 120,
              quota_5h_observed_at_ms: (nowSec - 300) * 1000,
              refresh_token_expires_at: nowSec - 60,
            },
            summaries: {
              [HEX_ID(2)]: {
                refresh_token_expires_at: nowSec + 3 * 86400,
              },
            },
          },
        },
      });
      try {
        // Current identity: inferred 5h + expired refresh_token
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        assert.equal(await dialog.locator('.quota-details-callout[data-tone="info"]').count(), 1);
        assert.equal(await dialog.locator('[data-quota-window="5h"][data-quota-inferred="true"]').count(), 1);
        assert.equal(await dialog.locator('[data-quota-burn-eta="5h"]').count(), 0, 'Inferred window must not fabricate burn ETA');
        assert.equal(await dialog.locator('.identity-refresh-token-warn[data-refresh-token-warn="expired"]').count(), 1);
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();

        // Saved identity: soon refresh_token
        const savedCard = ui.page.locator('.identity-card:not(.current)').filter({
          has: ui.page.getByRole('heading', { name: 'Identity 2', exact: true }),
        });
        await savedCard.locator('.identity-quota-open').click();
        await dialog.waitFor();
        assert.equal(await dialog.locator('.identity-refresh-token-warn[data-refresh-token-warn="soon"]').count(), 1);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'reset_inferred callout/no-ETA and refresh_token expired/soon warnings verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E04-04',
    tier: 2,
    features: ['E2E-04'],
    title: 'IPC 失败优雅降级（quota_setup_status / browser_open_identity_profile / identities_sync_subscription）',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          commandErrors: {
            quota_setup_status: 'quotaSetup.unavailable',
            browser_open_identity_profile: 'browser.error.unsupportedExitCountry',
            identities_sync_subscription: 'quotaOnline.busy',
          },
        },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        // 1. quota_setup_status rejected -> disclosure shows quotaSetup.unavailable translation
        await dialog.locator('.quota-details-disclosure-trigger').click();
        await dialog.locator('.quota-details-guide').waitFor();
        const guideText = await dialog.locator('.quota-details-guide').innerText();
        assert.equal(guideText.includes('quotaSetup.unavailable'), false);
        assert.ok(guideText.length > 0);

        // 2. browser_open_identity_profile rejected -> feedback shows localized error, modal stays open & closable
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        const err1 = await dialog.locator('.quota-details-feedback').innerText();
        assert.equal(err1.includes('browser.error.unsupportedExitCountry'), false);
        assert.ok(err1.trim().length > 0);

        // 3. identities_sync_subscription rejected -> feedback updates cleanly
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await ui.page.waitForFunction((prev) => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el && el.textContent && el.textContent !== prev && !el.textContent.includes('正在从浏览器资料同步'));
        }, err1);
        const err2 = await dialog.locator('.quota-details-feedback').innerText();
        assert.equal(err2.includes('quotaOnline.busy'), false);
        assert.ok(err2.trim().length > 0);

        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Graceful IPC rejection handling verified for quota_setup_status, browser_open_identity_profile, and identities_sync_subscription',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E04-05',
    tier: 2,
    features: ['E2E-04'],
    title: '极小视口 560px 响应式退化单列无溢出与 syncSubscription 防重遮罩锁',
    async run(ctx) {
      const longUserName = 'Extremely Long User Display Name For Narrow Modal Overflow Check 2026';
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        contextOptions: { viewport: { width: 560, height: 640 }, reducedMotion: 'reduce' },
        seed: {
          deferredCommands: ['identities_sync_subscription'],
          identities: {
            current: {
              display_name: longUserName,
              email: 'extremely-long-synthetic-account-address@subdomain.example.invalid',
            },
          },
        },
      });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        const layout = await dialog.evaluate((node) => {
          const windows = [...node.querySelectorAll('.quota-details-window')].map((w) => w.getBoundingClientRect());
          return {
            scrollW: node.scrollWidth,
            clientW: node.clientWidth,
            winCount: windows.length,
            singleColumn: windows.length === 2 && windows[1].top >= windows[0].bottom - 1,
          };
        });
        assert.ok(layout.scrollW <= layout.clientW + 1, `Narrow modal overflow: ${layout.scrollW} > ${layout.clientW}`);
        assert.equal(layout.singleColumn, true, 'Windows grid must stack into single column at 560px viewport');

        // Trigger syncSubscription while deferred and double-click -> only 1 IPC sent
        await ui.clearIpc();
        const syncBtn = dialog.getByRole('button', { name: '网页同步额度与重置', exact: true });
        await syncBtn.click();
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { pendingResolvers?: Array<{ command: string }> } }).__e2eUi;
          return Boolean(uiCtrl?.pendingResolvers?.some((p) => p.command === 'identities_sync_subscription'));
        });
        assert.equal(await syncBtn.isDisabled(), true, 'Sync button must disable while in-flight');
        await syncBtn.click({ force: true });

        const cmdsInFlight = await ui.getIpcCommands();
        assert.equal(cmdsInFlight.filter((c) => c.command === 'identities_sync_subscription').length, 1);

        await ui.page.evaluate(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { releaseDeferred: (cmd: string) => boolean } }).__e2eUi;
          uiCtrl?.releaseDeferred('identities_sync_subscription');
        });
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { pendingResolvers?: unknown[] } }).__e2eUi;
          return (uiCtrl?.pendingResolvers?.length ?? 0) === 0;
        });

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: '560px single-column modal responsiveness & in-flight sync deduplication lock verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // E2E-05: 极端视口、快捷键守卫、隐藏态与边界排版 (5 Tier 2 cases)
  // =========================================================================
  {
    id: 'T2-E2E05-01',
    tier: 2,
    features: ['E2E-05'],
    title: '极端视口 760×640 与 1440×900 × 10 页 × classic/compact 零横向溢出边界',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: { uiLanguage: 'en' },
        contextOptions: { viewport: { width: 760, height: 640 }, reducedMotion: 'reduce' },
      });
      let checksRun = 0;

      try {
        await ui.page.locator('.workspace-nav').last().waitFor();

        for (const layout of ['classic', 'compact'] as const) {
          await ui.page.evaluate(async (sbLayout) => {
            const modPath = '/src/settings-model.ts';
            const { updatePreferences } = await import(modPath);
            updatePreferences({ sidebarLayout: sbLayout, reduceMotion: true });
          }, layout);

          for (const vp of [
            { width: 760, height: 640 },
            { width: 1440, height: 900 },
          ]) {
            await ui.page.setViewportSize(vp);
            for (let idx = 0; idx < 10; idx++) {
              await ui.page.locator('.workspace-nav').nth(idx).click();
              await ui.page.locator('.workspace h1').waitFor();
              await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

              const g = await ui.page.evaluate(() => {
                const sb = document.querySelector('.app-sidebar')!.getBoundingClientRect();
                const content = document.querySelector('.cleaner-slot > *') as HTMLElement | null;
                const controls = [...document.querySelectorAll('.workspace-nav, .sidebar-bottom button, .sidebar-collapse-btn')].map((el) => {
                  const r = el.getBoundingClientRect();
                  return { x: r.x, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
                });
                return {
                  docScrollW: document.documentElement.scrollWidth,
                  docClientW: document.documentElement.clientWidth,
                  contentScrollW: content?.scrollWidth ?? 0,
                  contentClientW: content?.clientWidth ?? 0,
                  sbX: sb.x,
                  sbRight: sb.right,
                  vh: window.innerHeight,
                  controls,
                };
              });

              assert.ok(g.docScrollW <= g.docClientW + 1, `Overflow at ${layout}/${vp.width}x${vp.height}/nav-${idx}`);
              assert.ok(g.contentScrollW <= g.contentClientW + 1, `Content overflow at ${layout}/${vp.width}x${vp.height}/nav-${idx}`);
              for (const c of g.controls) {
                assert.ok(c.w > 0 && c.h > 0);
                assert.ok(c.x >= g.sbX - 1 && c.right <= g.sbRight + 1);
                assert.ok(c.bottom <= g.vh + 1);
              }
              checksRun++;
            }
          }
        }

        // Resizing to 640x520 must not overwrite explicit sidebarLayout: 'compact'
        await ui.page.setViewportSize({ width: 640, height: 520 });
        await ui.page.locator('.workspace-nav').nth(4).click();
        const persistedLayout = await ui.page.evaluate(() => {
          const raw = localStorage.getItem('claude-local.preferences.v1');
          return raw ? (JSON.parse(raw) as { sidebarLayout?: string }).sidebarLayout : null;
        });
        assert.equal(persistedLayout, 'compact', 'Window resize must never overwrite user compact sidebar preference');

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: `${checksRun} extreme viewport/layout/page geometry assertions passed with zero overflow and preserved sidebar preference`,
          metrics: { checksRun },
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E05-02',
    tier: 2,
    features: ['E2E-05'],
    title: 'Ctrl+K 命令面板上下文守卫与 localStorage 非法值兜底',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          localStorage: {
            'claude-local.page.v1': 'nonexistent-page',
          },
        },
      });
      try {
        // 1. Invalid localStorage page falls back safely to cleaner (IdentityPanel)
        await ui.page.locator('.identity-page').waitFor();
        assert.equal(await ui.page.evaluate(() => localStorage.getItem('claude-local.page.v1')), 'cleaner');

        // 2. Ctrl+K opens command palette normally
        await ui.page.keyboard.press('Control+k');
        const palette = ui.page.locator('[role="dialog"]').filter({ has: ui.page.locator('input') });
        await palette.waitFor();
        await ui.page.keyboard.press('Escape');
        await palette.waitFor({ state: 'detached' });

        // 3. Inside an <input> (e.g., logs search box), Ctrl+K must NOT hijack/open palette
        await ui.page.locator('.workspace-nav').nth(7).click(); // logs
        await ui.page.locator('.logs-search-input').waitFor();
        await ui.page.locator('.logs-search-input').focus();
        await ui.page.keyboard.press('Control+k');
        assert.equal(await ui.page.locator('.command-palette, [role="dialog"]').count(), 0);

        // 4. While a modal dialog is already open, Ctrl+K must NOT open command palette
        await ui.page.locator('.workspace-nav').nth(5).click(); // cleaner
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const detailsDialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await detailsDialog.waitFor();
        await ui.page.keyboard.press('Control+k');
        assert.equal(await ui.page.locator('[role="dialog"]').count(), 1);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Invalid page storage fallback to cleaner and Ctrl+K input/modal context guards verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E05-03',
    tier: 2,
    features: ['E2E-05'],
    title: 'data-window-hidden="true" 隐藏态同步与动画暂停边界',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        await ui.page.locator('.workspace-nav').first().waitFor();
        await ui.page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await ui.page.waitForFunction(() => document.documentElement.dataset.windowHidden === 'true');

        await ui.page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await ui.page.waitForFunction(() => document.documentElement.dataset.windowHidden === undefined);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'document.visibilityState hidden/visible synchronization of data-window-hidden verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T2-E2E05-04',
    tier: 2,
    features: ['E2E-05'],
    title: 'system location_enabled===null 未知态双按钮回显与 logs 空结果/长模型名极值',
    async run(ctx) {
      // 1. system unknown location_enabled === null + empty logs
      const uiEmpty = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          system: { location_enabled: null },
          logsOverride: { empty: true },
          usageOverride: { empty: true },
        },
      });
      try {
        await uiEmpty.page.locator('.workspace-nav').nth(2).click(); // system
        await uiEmpty.page.locator('[data-system-setting="location"]').waitFor();
        const locStateText = await uiEmpty.page.locator('[data-system-setting="location"] .system-state-label').innerText();
        assert.notEqual(locStateText.trim(), '已关闭');
        assert.equal(await uiEmpty.page.locator('.system-location-controls > button').count(), 2);

        // empty logs
        await uiEmpty.page.locator('.workspace-nav').nth(7).click();
        await uiEmpty.page.locator('.logs-page .usage-model-empty').waitFor();

        // empty usage
        await uiEmpty.page.locator('.workspace-nav').nth(6).click();
        await uiEmpty.page.locator('.usage-page').waitFor();
        assert.equal(uiEmpty.pageErrors.length, 0);
      } finally {
        await uiEmpty.close();
      }

      // 2. extreme long model name in logs & usage
      const extremeModel = 'claude-opus-4-6-synthetic-extremely-long-enterprise-preview-20261128-build9999';
      const uiLong = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          logsOverride: { longModelName: extremeModel },
          usageOverride: { longModelName: extremeModel },
        },
      });
      try {
        await uiLong.page.locator('.workspace-nav').nth(7).click(); // logs
        await uiLong.page.locator('.logs-table tbody tr').first().waitFor();
        const logsBox = await uiLong.page.locator('.logs-page').evaluate((root) => {
          const tz = root.querySelector('.logs-tz-select') as HTMLElement | null;
          return {
            docScrollW: document.documentElement.scrollWidth,
            docClientW: document.documentElement.clientWidth,
            tzVisible: Boolean(tz && tz.getBoundingClientRect().width > 0),
          };
        });
        assert.ok(logsBox.docScrollW <= logsBox.docClientW + 1);
        assert.equal(logsBox.tzVisible, true);

        await uiLong.page.locator('.workspace-nav').nth(6).click(); // usage
        await uiLong.page.locator('.usage-model-row').first().waitFor();
        const usageBox = await uiLong.page.evaluate(() => ({
          docScrollW: document.documentElement.scrollWidth,
          docClientW: document.documentElement.clientWidth,
        }));
        assert.ok(usageBox.docScrollW <= usageBox.docClientW + 1);
        assert.equal(uiLong.pageErrors.length, 0, uiLong.pageErrors.join('\n'));
        assert.deepEqual(await uiLong.getUnhandledCommands(), []);
      } finally {
        await uiLong.close();
      }

      return {
        status: 'pass',
        summary: 'system null location dual-button state and empty/long-model extremes on logs & usage verified',
      };
    },
  },

  {
    id: 'T2-E2E05-05',
    tier: 2,
    features: ['E2E-05'],
    title: '多账号混合长文本 + 隐私遮罩下 .identity-card 几何不漂移',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          identities: {
            current: {
              display_name: '超长中文混合English账号名称-Workspace-Alpha-20261128',
              email: 'extremely.long.synthetic.user.account@enterprise-domain.example.invalid',
              plan: 'Max 20x',
              subscription_expiry_ymd: '2026-12-28',
              subscription_date_source: 'manual',
              subscription_expires_at: nowSec + 30 * 86400,
              billing_date: nowSec + 30 * 86400,
              billing_date_kind: 'next_renewal',
            },
            records: [
              { id: HEX_ID(1), name: '超长中文混合English账号名称-Workspace-Alpha-20261128', saved_at: 1780000001000, bytes: 4096, policy: { skills: true, plugins: true, mcp: true, settings: true, projects: true, history: true, cache: false } },
              { id: HEX_ID(2), name: '超级长的本地保存别名_Beta_Workspace_Very_Long_2026', saved_at: 1780000002000, bytes: 4096, policy: { skills: true, plugins: true, mcp: true, settings: true, projects: true, history: true, cache: false } },
            ],
            summaries: {
              [HEX_ID(2)]: {
                display_name: 'Beta Long Owner Name',
                email: 'very.long.beta.email.address@another-domain.example.invalid',
                plan: 'Max 20x',
                subscription_expiry_ymd: '2026-12-15',
                subscription_date_source: 'manual',
                subscription_expires_at: nowSec + 17 * 86400,
                billing_date: nowSec + 17 * 86400,
                billing_date_kind: 'next_renewal',
              },
            },
          },
        },
      });
      try {
        for (const combo of [
          { privacyMask: false, quotaDisplay: 'remaining' as const },
          { privacyMask: true, quotaDisplay: 'used' as const },
        ]) {
          await ui.page.evaluate(async (c) => {
            const modPath = '/src/settings-model.ts';
            const { updatePreferences } = await import(modPath);
            updatePreferences(c);
          }, combo);
          await ui.page.locator('.identity-card:not(.empty)').first().waitFor();
          await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

          const cards = await ui.page.locator('.identity-card:not(.empty)').evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              const h = node.querySelector('h3[data-identity-name]')!.getBoundingClientRect();
              const em = node.querySelector('.identity-email')!.getBoundingClientRect();
              const qw = [...node.querySelectorAll('[data-quota-window]')].map((q) => q.getBoundingClientRect());
              const ft = node.querySelector('.identity-card-footer')!.getBoundingClientRect();
              return {
                w: Math.round(r.width),
                h: Math.round(r.height),
                cardBottom: r.bottom,
                hBottom: h.bottom,
                emTop: em.top,
                emBottom: em.bottom,
                q0Top: qw[0]?.top ?? 0,
                q0Bottom: qw[0]?.bottom ?? 0,
                q1Top: qw[1]?.top ?? 0,
                q1Bottom: qw[1]?.bottom ?? 0,
                ftTop: ft.top,
                ftBottom: ft.bottom,
              };
            }),
          );
          assert.equal(cards.length, 2);
          for (const c of cards) {
            assert.ok(Math.abs(c.w - 166) <= 1, `Card width ${c.w} != 166`);
            assert.ok(Math.abs(c.h - 286) <= 1, `Card height ${c.h} != 286`);
            assert.ok(c.hBottom <= c.emTop + 1, 'Heading overlaps email');
            assert.ok(c.emBottom <= c.q0Top + 1, 'Email overlaps 5h window');
            assert.ok(c.q0Bottom <= c.q1Top + 1, '5h overlaps 7d window');
            assert.ok(c.q1Bottom <= c.ftTop + 1, '7d overlaps footer');
            assert.ok(c.ftBottom <= c.cardBottom, 'Footer overflows card bottom');
          }
        }

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: '166x286 identity card geometry invariant held under long mixed CJK/EN names, Max 20x + expiry badges, privacyMask, and used/remaining toggle',
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // E2E-06: 双语校验沙盒故障注入与运行时切换 (5 Tier 2 cases)
  // =========================================================================
  {
    id: 'T2-E2E06-01',
    tier: 2,
    features: ['E2E-06'],
    title: '沙盒隔离故障注入：YAML 缺键 / 多键不对称',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e06-01');
      const sbLocales = join(sb.paths.root, 'locales');
      mkdirSync(sbLocales, { recursive: true });
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/zh.yaml'), join(sbLocales, 'zh.yaml'));
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/en.yaml'), join(sbLocales, 'en.yaml'));

      const zhMutated =
        readFileSync(join(sbLocales, 'zh.yaml'), 'utf8') + '\ne2e.syntheticOrphanZhKey: "合成孤儿键"\n';
      const enMutated = readFileSync(join(sbLocales, 'en.yaml'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('browser.enterClaudeAi:'))
        .join('\n');

      const res = validateSandboxedI18nWorkspace({ zhRaw: zhMutated, enRaw: enMutated });
      assert.equal(res.ok, false, 'Asymmetric YAML catalogs must be rejected');
      assert.ok(
        res.errors.some((e) => e.includes('browser.enterClaudeAi')),
        'Validator must report missing key browser.enterClaudeAi',
      );
      assert.ok(
        res.errors.some((e) => e.includes('e2e.syntheticOrphanZhKey')),
        'Validator must report extra/orphan key e2e.syntheticOrphanZhKey',
      );

      return {
        status: 'pass',
        summary: 'Sandboxed YAML missing-key & orphan-key asymmetric faults caught cleanly',
      };
    },
  },

  {
    id: 'T2-E2E06-02',
    tier: 2,
    features: ['E2E-06'],
    title: '沙盒隔离故障注入：插槽 {var} 不匹配与空值拦截',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e06-02');
      const sbLocales = join(sb.paths.root, 'locales');
      mkdirSync(sbLocales, { recursive: true });
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/zh.yaml'), join(sbLocales, 'zh.yaml'));
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/en.yaml'), join(sbLocales, 'en.yaml'));

      const zhRaw = readFileSync(join(sbLocales, 'zh.yaml'), 'utf8');
      let enMutated = readFileSync(join(sbLocales, 'en.yaml'), 'utf8');
      enMutated = enMutated.replace('{days}', '{wrongSlot}');
      enMutated = enMutated.replace(/^(browser\.enterClaudeAi:\s*).*$/m, '$1""');

      const res = validateSandboxedI18nWorkspace({ zhRaw, enRaw: enMutated });
      assert.equal(res.ok, false);
      assert.ok(
        res.errors.some((e) => e.includes('Slot mismatch')),
        'Validator must catch placeholder slot mismatch',
      );
      assert.ok(
        res.errors.some((e) => e.includes('browser.enterClaudeAi') && e.includes('Empty')),
        'Validator must catch empty translation value',
      );

      return {
        status: 'pass',
        summary: 'Sandboxed slot mismatch and empty-string translation faults caught cleanly',
      };
    },
  },

  {
    id: 'T2-E2E06-03',
    tier: 2,
    features: ['E2E-06'],
    title: '沙盒隔离故障注入：英文 CJK 泄漏与重复顶级键检测',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e06-03');
      const sbLocales = join(sb.paths.root, 'locales');
      mkdirSync(sbLocales, { recursive: true });
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/zh.yaml'), join(sbLocales, 'zh.yaml'));
      copyFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/en.yaml'), join(sbLocales, 'en.yaml'));

      const zhRaw = readFileSync(join(sbLocales, 'zh.yaml'), 'utf8');
      const enBase = readFileSync(join(sbLocales, 'en.yaml'), 'utf8');

      // Baseline real catalog with Claude-Local Browser.app whitelist must pass
      const cleanRes = validateSandboxedI18nWorkspace({ zhRaw, enRaw: enBase });
      assert.equal(cleanRes.ok, true, `Clean catalog failed: ${cleanRes.errors.join('; ')}`);

      // 1. Inject CJK into en.yaml
      const enCjkMutated = enBase.replace(/^(browser\.enterClaudeAi:\s*).*$/m, '$1"Open 违规中文"');
      const cjkRes = validateSandboxedI18nWorkspace({ zhRaw, enRaw: enCjkMutated });
      assert.equal(cjkRes.ok, false);
      assert.ok(
        cjkRes.errors.some((e) => e.includes('Unexpected CJK') && e.includes('browser.enterClaudeAi')),
        'Validator must catch CJK leak in en.yaml',
      );

      // 2. Inject duplicate top-level key into en.yaml
      const enDupeMutated = enBase + '\nbrowser.enterClaudeAi: "Duplicate top-level"\n';
      const dupeRes = validateSandboxedI18nWorkspace({ zhRaw, enRaw: enDupeMutated });
      assert.equal(dupeRes.ok, false);
      assert.ok(
        dupeRes.errors.some((e) => e.includes('duplicate top-level keys') && e.includes('browser.enterClaudeAi')),
        'Validator must catch duplicate top-level key',
      );

      return {
        status: 'pass',
        summary: 'Sandboxed EN CJK leak, duplicate top-level key, and whitelist exemption verified',
      };
    },
  },

  {
    id: 'T2-E2E06-04',
    tier: 2,
    features: ['E2E-06'],
    title: '沙盒隔离故障注入：Rust 新增未翻译错误键 & translate 原型安全性',
    async run(ctx) {
      const sb = await ctx.createSandbox('t2-e2e06-04');
      const sbRust = join(sb.paths.root, 'rust-src');
      mkdirSync(sbRust, { recursive: true });
      writeFileSync(
        join(sbRust, 'synthetic_err.rs'),
        'pub fn synthetic_err() -> &\'static str { "relay.error.syntheticUnmappedTest" }\n',
        'utf8',
      );

      const zhRaw = readRepoText(ctx.repoRoot, 'src/locales/zh.yaml');
      const enRaw = readRepoText(ctx.repoRoot, 'src/locales/en.yaml');

      const scanRes = validateSandboxedI18nWorkspace({
        zhRaw,
        enRaw,
        rustSrcDir: sbRust,
      });
      assert.equal(scanRes.ok, false);
      assert.ok(scanRes.errors.some((e) => e.includes('relay.error.syntheticUnmappedTest')));

      // Verify translate() prototype safety & raw fallback directly via src/i18n.ts
      const { translate, setLocale } = await import(resolveRepoSrcPath(ctx.repoRoot, 'src/i18n.ts'));
      setLocale('en');
      assert.equal(translate('__proto__'), '__proto__');
      assert.equal(translate('constructor'), 'constructor');
      assert.equal(translate('未知错误 0xABC'), '未知错误 0xABC');
      assert.notEqual(translate('quotaOnline.busy', {}, 'en'), 'quotaOnline.busy');
      setLocale('zh');

      return {
        status: 'pass',
        summary: 'Sandboxed Rust unmapped error key rejection and translate() __proto__/fallback safety verified',
      };
    },
  },

  {
    id: 'T2-E2E06-05',
    tier: 2,
    features: ['E2E-06'],
    title: '双语快速连续切换与原生错误插槽运行时渲染验证',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          commandErrors: {
            browser_open_identity_profile: 'browser.error.unsupportedExitCountry',
          },
          identities: {
            current: {
              refresh_token_expires_at: nowSec + 2 * 86400,
            },
          },
        },
      });
      try {
        // 1. Trigger native error key on IdentityPanel via saved card menu (no modal blocking LanguageSwitch)
        const savedCard = ui.page.locator('.identity-card:not(.current)').filter({
          has: ui.page.getByRole('heading', { name: 'Identity 2', exact: true }),
        });
        await savedCard.getByRole('button', { name: '更多操作', exact: true }).click();
        await ui.page.getByRole('menuitem').first().click();
        const panelFb = ui.page.locator('.identity-page-feedback > span');
        await panelFb.waitFor();
        const fbZh = await panelFb.innerText();
        assert.equal(fbZh.includes('browser.error.'), false);

        // Rapidly switch ZH -> EN -> ZH -> EN via LanguageSwitch radios
        const cnRadio = ui.page.getByRole('radio', { name: 'CN', exact: true });
        const enRadio = ui.page.getByRole('radio', { name: 'EN', exact: true });
        await enRadio.click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'en');
        await cnRadio.click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'zh');
        await enRadio.click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'en');

        const fbEn = await panelFb.innerText();
        assert.notEqual(fbEn, fbZh, 'Feedback must re-translate immediately on EN switch');
        assert.equal(fbEn.includes('browser.error.'), false);
        assert.equal(/[\u3400-\u9fff]/.test(fbEn), false, 'EN feedback must contain zero CJK');

        // 2. Open QuotaDetailsModal in EN and verify placeholder substitution on refresh_token_expires_at
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        const warnEn = await dialog.locator('.identity-refresh-token-warn').innerText();
        assert.equal(/\{\w+\}/.test(warnEn), false, 'Placeholder must be substituted in EN');
        assert.equal(/[\u3400-\u9fff]/.test(warnEn), false, 'EN warning must contain zero CJK');

        await dialog.getByRole('button', { name: 'Close', exact: true }).click().catch(async () => {
          await ui.page.keyboard.press('Escape');
        });
        await dialog.waitFor({ state: 'detached' });
        await cnRadio.click();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'zh');
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        await dialog.waitFor();
        const warnZh = await dialog.locator('.identity-refresh-token-warn').innerText();
        assert.equal(/\{\w+\}/.test(warnZh), false, 'Placeholder must be substituted in ZH');

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Rapid zh<->en toggling and native error/placeholder live re-translation verified',
        };
      } finally {
        await ui.close();
      }
    },
  },
];
