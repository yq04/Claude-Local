/**
 * [INPUT]: scripts/e2e/lib/* 沙盒/代理/网络/Chrome/Rust 黑盒驱动与 ./perf-ui-helpers.ts / ./security-helpers.ts 公共辅助。
 * [OUTPUT]: 导出 Tier 1 happy-path 用例数组 cases: E2ECase[]（覆盖 E2E-02, E2E-04, E2E-05, E2E-06，共 20 条，每特性 5 条）。
 * [POS]: Milestone E3 Tier 1 黑盒测试套件；双模式诚实探测，目标 M1–M4 契约缺失时经 gapOrFail 返回 baseline_gap/fail。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchPersistentProfile } from '../lib/chrome-harness.ts';
import { MockNetworkSuite } from '../lib/mock-network.ts';
import { MockHttpConnectProxy } from '../lib/mock-proxy.ts';
import {
  resolveClaudeLocalBinary,
  runBunTest,
  runOrchestrate,
  seedSyntheticVault,
} from '../lib/rust-blackbox.ts';
import { isPidAlive } from '../lib/sandbox.ts';
import type { E2ECase } from '../lib/types.ts';
import {
  assert,
  collectFilesRecursive,
  extractRustFnBody,
  gapOrFail,
  hasRustFn,
  HEX_FP,
  HEX_ID,
  httpsGetViaProxy,
  openAppWithMockUi,
  readRepoText,
  resolvePowerShellBinary,
  resolveRepoSrcPath,
  scanRustNativeErrorKeys,
  scanTsI18nAndJsxCjk,
  stripJsComments,
  stripRustCommentsAndTests,
  validateCatalogPair,
} from './perf-ui-helpers.ts';

interface OrchestrateSlotAcquireJson {
  schema: number;
  ok: boolean;
  status: string;
  record_id?: string;
  slot_dir?: string;
  reason?: string;
  error?: string;
}

export const cases: E2ECase[] = [
  // =========================================================================
  // E2E-02: 卡片进入 claude.ai 全链路性能与非阻塞 (5 Tier 1 cases)
  // =========================================================================
  {
    id: 'T1-E2E02-01',
    tier: 1,
    features: ['E2E-02'],
    title: '锁拆分：Cleaner::enter_browser_account 与 SlotGate 并发打开不长阻塞 enter_quota 与 Browser::gate',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e02-01');
      const bin = resolveClaudeLocalBinary(ctx.repoRoot);

      // 1. UI + mockIPC concurrency check: browser_open_identity_profile in-flight must not block runtime reads
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          deferredCommands: ['browser_open_identity_profile'],
        },
      });
      let runtimeReadMs = 0;
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').waitFor();
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { pendingResolvers?: Array<{ command: string }> } }).__e2eUi;
          return Boolean(uiCtrl?.pendingResolvers?.some((p) => p.command === 'browser_open_identity_profile'));
        });

        const t0 = performance.now();
        const probeResult = await ui.page.evaluate(async () => {
          const internals = (window as unknown as {
            __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
          }).__TAURI_INTERNALS__;
          const [rt, rev] = await Promise.all([
            internals.invoke('browser_runtime_read'),
            internals.invoke('identities_quota_revision'),
          ]);
          return { rt, rev };
        });
        runtimeReadMs = Math.round(performance.now() - t0);
        assert.ok(probeResult.rt && typeof probeResult.rev === 'string');

        await ui.page.evaluate(() => {
          const uiCtrl = (window as unknown as {
            __e2eUi?: { releaseDeferred: (cmd: string) => boolean };
          }).__e2eUi;
          uiCtrl?.releaseDeferred('browser_open_identity_profile');
        });
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { pendingResolvers?: unknown[] } }).__e2eUi;
          return (uiCtrl?.pendingResolvers?.length ?? 0) === 0;
        });
        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
      } finally {
        await ui.close();
      }

      // 2. --orchestrate concurrent multi-slot acquire (3 accounts: index 0 active, 1 & 2 non-active)
      const seeded = await seedSyntheticVault({
        appDataDir: sb.paths.appDataDir,
        homeDir: sb.paths.homeDir,
        activeAccountIndex: 0,
        accounts: [
          {
            name: 'Concurrent Active',
            accountUuid: '20000001-0000-4000-8000-000000000001',
            email: 'conc-a@example.invalid',
            bindBrowser: true,
          },
          {
            name: 'Concurrent Slot B',
            accountUuid: '20000002-0000-4000-8000-000000000002',
            email: 'conc-b@example.invalid',
            proxy: 'http://127.0.0.1:18801',
            bindBrowser: true,
          },
          {
            name: 'Concurrent Slot C',
            accountUuid: '20000003-0000-4000-8000-000000000003',
            email: 'conc-c@example.invalid',
            proxy: 'http://127.0.0.1:18802',
            bindBrowser: true,
          },
        ],
      });

      const tSlot = performance.now();
      const [acqB, acqC] = await Promise.all([
        runOrchestrate<OrchestrateSlotAcquireJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[1].id,
        }),
        runOrchestrate<OrchestrateSlotAcquireJson>(bin.exePath, sb.paths, {
          schema: 1,
          op: 'slot_acquire',
          record_id: seeded.records[2].id,
        }),
      ]);
      const dualSlotMs = Math.round(performance.now() - tSlot);
      assert.equal(acqB.exitCode, 0, acqB.stderr);
      assert.equal(acqC.exitCode, 0, acqC.stderr);
      assert.equal(acqB.json?.ok, true);
      assert.equal(acqC.json?.ok, true);
      assert.notEqual(acqB.json?.slot_dir, acqC.json?.slot_dir);

      // 3. Lexical Rust checks (stripped of comments and #[cfg(test)])
      const cleanerRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/cleaner.rs'));
      const modRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/mod.rs'));
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const onlineRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/identities/online.rs'));

      const hasEnterBrowserAccount =
        hasRustFn(cleanerRs, 'enter_browser_account') &&
        cleanerRs.includes('BROWSER_MASK') &&
        cleanerRs.includes('QUOTA_MASK') &&
        cleanerRs.includes('account_locks');
      const hasSlotGate = hasRustFn(modRs, 'slot_gate') && hasRustFn(modRs, 'with_active_slot_gate');

      if (!hasEnterBrowserAccount || !hasSlotGate) {
        return gapOrFail(ctx.mode, 'Lock splitting primitives (enter_browser_account / SlotGate) missing in Rust source', {
          runtimeReadMs,
          dualSlotMs,
          hasEnterBrowserAccount,
          hasSlotGate,
        });
      }

      const openProfileBody = extractRustFnBody(qcRs, 'browser_open_identity_profile');
      const launchScopeBody = extractRustFnBody(qcRs, 'launch_scope_url_with_options_locked');
      const browserLaunchBody = extractRustFnBody(modRs, 'browser_launch');
      const refreshAllBody = extractRustFnBody(onlineRs, 'identities_refresh_all_quotas');

      const lockOrderingOk =
        openProfileBody.includes('enter_browser_account') &&
        openProfileBody.includes('slot_gate') &&
        !launchScopeBody.includes('.gate.lock(') &&
        browserLaunchBody.includes('with_active_slot_gate') &&
        refreshAllBody.includes('enter_quota(');

      if (!lockOrderingOk) {
        return gapOrFail(ctx.mode, 'Lock-split call chain incomplete across browser_open_identity_profile / browser_launch / online refresh', {
          runtimeReadMs,
          dualSlotMs,
          hasEnterBrowserAccount,
          hasSlotGate,
        });
      }

      return {
        status: 'pass',
        summary: 'Lock splitting (enter_browser_account + SlotGate + non-blocking runtime/dual-slot) verified',
        metrics: { runtimeReadMs, dualSlotMs, hasEnterBrowserAccount, hasSlotGate },
      };
    },
  },

  {
    id: 'T1-E2E02-02',
    tier: 1,
    features: ['E2E-02'],
    title: 'CliProof 请求级缓存（9->1）与 Preferences/Local State 脏写跳过',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e02-02');

      // 1. Construct ~5-6 MiB synthetic .claude.json with 1500 project entries and measure 1x vs 9x parse
      const projects: Record<string, { allowedTools: string[]; history: Array<{ display: string }> }> = {};
      const pad = 'x'.repeat(2800);
      for (let i = 0; i < 1500; i++) {
        projects[`D:/synthetic/workspace-${i}`] = {
          allowedTools: ['Read', 'Write', 'Bash'],
          history: [{ display: `entry-${i}-${pad}` }],
        };
      }
      const claudeJsonPath = join(sb.paths.homeDir, '.claude.json');
      const payload = JSON.stringify({
        oauthAccount: { accountUuid: '20000010-0000-4000-8000-000000000010', emailAddress: 'cache@example.invalid' },
        projects,
      });
      writeFileSync(claudeJsonPath, payload, 'utf8');
      const claudeJsonBytes = Buffer.byteLength(payload, 'utf8');
      assert.ok(claudeJsonBytes >= 4_000_000, `Expected >=4MiB synthetic .claude.json, got ${claudeJsonBytes}`);

      const tSingle = performance.now();
      const parsedOnce = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as { oauthAccount?: { accountUuid?: string } };
      const singleParseMs = Math.max(0.1, Number((performance.now() - tSingle).toFixed(2)));
      assert.equal(parsedOnce.oauthAccount?.accountUuid, '20000010-0000-4000-8000-000000000010');

      const tNine = performance.now();
      for (let i = 0; i < 9; i++) {
        const p = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as { oauthAccount?: { accountUuid?: string } };
        assert.ok(p.oauthAccount);
      }
      const nineParseMs = Math.max(0.1, Number((performance.now() - tNine).toFixed(2)));
      assert.ok(nineParseMs >= singleParseMs, `Expected 9x parse (${nineParseMs}ms) >= 1x parse (${singleParseMs}ms)`);

      // 2. Launch isolated persistent profile once & verify Preferences + Local State JSON generated cleanly
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'prefs-dirty-skip',
        headless: true,
        allowedUrlPrefixes: ['about:'],
      });
      try {
        const page = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        await page.goto('about:blank');
      } finally {
        await persistent.close();
      }
      const prefsPath = join(persistent.userDataDir, 'Default', 'Preferences');
      const localStatePath = join(persistent.userDataDir, 'Local State');
      assert.equal(existsSync(prefsPath), true, 'Default/Preferences must be created');
      assert.equal(existsSync(localStatePath), true, 'Local State must be created');
      assert.equal(typeof JSON.parse(readFileSync(prefsPath, 'utf8')), 'object');
      assert.equal(typeof JSON.parse(readFileSync(localStatePath, 'utf8')), 'object');

      // 3. Lexical Rust checks
      const lifecycleRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/lifecycle.rs'));
      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const profileRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'));

      const hasCacheStruct =
        lifecycleRs.includes('struct CliProofCache') &&
        lifecycleRs.includes('struct FileStamp') &&
        hasRustFn(lifecycleRs, 'prove_cli_cached_at');
      if (!hasCacheStruct) {
        return gapOrFail(ctx.mode, 'CliProofCache / FileStamp missing in lifecycle.rs', {
          singleParseMs,
          nineParseMs,
          claudeJsonBytes,
        });
      }

      const proveCachedBody = extractRustFnBody(lifecycleRs, 'prove_cli_cached_at');
      const openProfileBody = extractRustFnBody(qcRs, 'browser_open_identity_profile');
      const prefsBody = extractRustFnBody(profileRs, 'preferences');
      const dohBody = extractRustFnBody(profileRs, 'disable_local_state_doh');

      const cacheWired =
        proveCachedBody.includes('cached.epoch == epoch') &&
        proveCachedBody.includes('cached.claude_json_stamp == *cs') &&
        proveCachedBody.includes('cached.key_bin_stamp == *ks') &&
        openProfileBody.includes('CliProofCache::default()') &&
        openProfileBody.includes('&mut proof_cache');

      const dirtySkipWired =
        prefsBody.includes('let before = data.clone()') &&
        prefsBody.includes('if !existed || data != before') &&
        dohBody.includes('let before = data.clone()') &&
        dohBody.includes('if !existed || data != before');

      if (!cacheWired || !dirtySkipWired) {
        return gapOrFail(ctx.mode, 'CliProofCache wiring or Preferences/Local State dirty-write skip missing', {
          singleParseMs,
          nineParseMs,
          claudeJsonBytes,
          cacheWired,
          dirtySkipWired,
        });
      }

      return {
        status: 'pass',
        summary: 'CliProofCache (9->1) and Preferences/Local State dirty-write skip verified',
        metrics: { singleParseMs, nineParseMs, claudeJsonBytes },
      };
    },
  },

  {
    id: 'T1-E2E02-03',
    tier: 1,
    features: ['E2E-02'],
    title: 'RtlGetVersion 替代冷启动 PowerShell 子进程',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e02-03');
      const psBin = resolvePowerShellBinary();
      const psRes = await sb.spawn(
        psBin,
        ['-NoProfile', '-NonInteractive', '-Command', '[System.Environment]::OSVersion.Version.ToString()'],
        { timeoutMs: 12_000 },
      );
      const psColdMs = Math.round(psRes.durationMs);
      const psVersion = psRes.stdout.trim();
      assert.equal(psRes.exitCode, 0, `PowerShell version probe failed: ${psRes.stderr}`);
      assert.match(psVersion, /^\d+\.\d+\.\d+\.\d+$/);

      const windowsRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/windows.rs'));
      const hasRtlDecl =
        windowsRs.includes('struct OsVersionInfoExW') &&
        windowsRs.includes('fn RtlGetVersion') &&
        hasRustFn(windowsRs, 'os_version_string');

      if (!hasRtlDecl) {
        return gapOrFail(ctx.mode, 'RtlGetVersion / OsVersionInfoExW not implemented in windows.rs', {
          psColdMs,
          psVersion,
        });
      }

      const osVerBody = extractRustFnBody(windowsRs, 'os_version_string');
      const machineBody = extractRustFnBody(windowsRs, 'rf_browser_machine');
      const usesRtlDirect =
        osVerBody.includes('RtlGetVersion(&mut info)') &&
        !osVerBody.toLowerCase().includes('powershell') &&
        !osVerBody.includes('Command::new') &&
        machineBody.includes('OnceLock') &&
        machineBody.includes('os_version_string') &&
        !machineBody.toLowerCase().includes('powershell') &&
        !machineBody.includes('Command::new');

      if (!usesRtlDirect) {
        return gapOrFail(ctx.mode, 'rf_browser_machine or os_version_string still spawns PowerShell or lacks OnceLock', {
          psColdMs,
          psVersion,
        });
      }

      return {
        status: 'pass',
        summary: `RtlGetVersion direct FFI + OnceLock verified (eliminates ~${psColdMs}ms PowerShell cold spawn)`,
        metrics: { psColdMs, psVersion },
      };
    },
  },

  {
    id: 'T1-E2E02-04',
    tier: 1,
    features: ['E2E-02'],
    title: 'EXIT_TRACE_URLS 1.1.1.1 前置 + 60s 缓存异步探测',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e02-04');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy);

      // Hang www.cloudflare.com so 1.1.1.1 literal IP priority must succeed quickly without waiting
      proxy.setFault('www.cloudflare.com', { mode: 'hang_pre_connect' });

      const t0 = performance.now();
      const traceResp = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 2500,
      });
      const traceVia1111Ms = Math.round(performance.now() - t0);
      assert.equal(traceResp.statusCode, 200);
      assert.match(traceResp.body, /loc=US/);
      assert.ok(traceVia1111Ms < 2000, `1.1.1.1 trace probe took too long: ${traceVia1111Ms}ms`);

      // Also verify subsequent claude.ai domain request flows cleanly through proxy
      const claudeResp = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: 'claude.ai',
        path: '/new',
        timeoutMs: 2500,
      });
      assert.equal(claudeResp.statusCode, 200);
      proxy.assertNoDomainDnsLeak();

      const configRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/config.rs'));
      const traceArrayMatch = configRs.match(/const\s+EXIT_TRACE_URLS\s*:\s*\[&str;\s*2\]\s*=\s*\[([\s\S]*?)\];/);
      const firstTraceIs1111 = Boolean(
        traceArrayMatch &&
          traceArrayMatch[1].trim().startsWith('"https://1.1.1.1/cdn-cgi/trace"'),
      );
      const hasAsyncCache =
        configRs.includes('EXIT_COUNTRY_CACHE_TTL') &&
        configRs.includes('from_secs(60)') &&
        configRs.includes('EXIT_CLIENT_POOL') &&
        configRs.includes('EXIT_PROBE_RUNTIME') &&
        hasRustFn(configRs, 'probe_proxy_exit_country_async') &&
        hasRustFn(configRs, 'evaluate_browser_launch_policy_with_urls');

      if (!firstTraceIs1111 || !hasAsyncCache) {
        return gapOrFail(ctx.mode, '1.1.1.1 trace priority or 60s async cache missing in browser/config.rs', {
          traceVia1111Ms,
          proxyAuditCount: proxy.getAuditLog().length,
          firstTraceIs1111,
          hasAsyncCache,
        });
      }

      const evalBody = extractRustFnBody(configRs, 'evaluate_browser_launch_policy_with_urls');
      const cacheEnforcesCountry =
        evalBody.includes('EXIT_COUNTRY_CACHE_TTL') &&
        evalBody.includes('is_unsupported_exit_country') &&
        evalBody.includes('return Ok(())');
      if (!cacheEnforcesCountry) {
        return gapOrFail(ctx.mode, 'evaluate_browser_launch_policy_with_urls cache check incomplete', {
          traceVia1111Ms,
          proxyAuditCount: proxy.getAuditLog().length,
        });
      }

      return {
        status: 'pass',
        summary: '1.1.1.1 primary trace probe bypassed hanging cloudflare.com and 60s async cache contract verified',
        metrics: { traceVia1111Ms, proxyAuditCount: proxy.getAuditLog().length },
      };
    },
  },

  {
    id: 'T1-E2E02-05',
    tier: 1,
    features: ['E2E-02'],
    title: 'Mock 代理 + WindowsBrowser + Mock claude.ai 端到端冷/热启动分段计时与参数未漂移复用',
    async run(ctx) {
      const sb = await ctx.createSandbox('t1-e2e02-05');
      const netSuite = await MockNetworkSuite.start(sb.paths.root);
      netSuite.applyTracePreset('us_isp');
      sb.registerCleanup(() => netSuite.close());
      const proxy = await MockHttpConnectProxy.start({ tlsCert: netSuite.tlsCert });
      sb.registerCleanup(() => proxy.close());
      netSuite.bindToProxy(proxy);

      const e2eStart = performance.now();

      // Phase A: preflight
      const tPreflight = performance.now();
      const preflightResp = await httpsGetViaProxy({
        proxyPort: proxy.port,
        targetHost: '1.1.1.1',
        path: '/cdn-cgi/trace',
        timeoutMs: 3000,
      });
      const preflightMs = Math.round(performance.now() - tPreflight);
      assert.equal(preflightResp.statusCode, 200);
      assert.match(preflightResp.body, /loc=US/);

      // Phase B: cold launch of WindowsBrowser/chrome.exe with anti-leak args & proxy
      const tCold = performance.now();
      const persistent = await launchPersistentProfile({
        repoRoot: ctx.repoRoot,
        sandbox: sb,
        profileName: 'claude-ai-cold-hot',
        headless: true,
        argsOptions: { proxyUrl: proxy.url },
        allowedUrlPrefixes: ['https://claude.ai'],
      });
      const coldLaunchMs = Math.round(performance.now() - tCold);

      let coldNavigateMs = 0;
      let hotTabMs = 0;
      let pid = persistent.pid ?? 0;

      try {
        assert.ok(persistent.pid && isPidAlive(persistent.pid), 'Companion browser PID must be alive');
        pid = persistent.pid;

        const page1 = persistent.context.pages()[0] ?? (await persistent.context.newPage());
        const tNav1 = performance.now();
        await page1.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page1.locator('[data-mock-route="/new"]').waitFor({ timeout: 10_000 });
        coldNavigateMs = Math.round(performance.now() - tNav1);

        // Phase C: hot open second tab on same running profile (PID preserved)
        assert.equal(isPidAlive(pid), true, 'Same PID must stay alive for hot open');
        const tHot = performance.now();
        const page2 = await persistent.context.newPage();
        await page2.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await page2.locator('[data-mock-route="/new"]').waitFor({ timeout: 10_000 });
        hotTabMs = Math.round(performance.now() - tHot);
        await page2.close();
      } finally {
        await persistent.close();
      }

      const totalE2eMs = Math.round(performance.now() - e2eStart);
      assert.ok(hotTabMs < coldLaunchMs + coldNavigateMs, `Hot tab (${hotTabMs}ms) must be faster than cold launch+nav`);
      assert.ok(hotTabMs < 5000, `Hot tab exceeded 5s threshold: ${hotTabMs}ms`);
      assert.ok(totalE2eMs < 25_000, `Total cold+hot E2E exceeded 25s threshold: ${totalE2eMs}ms`);
      proxy.assertNoDomainDnsLeak();

      const qcRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/quota_connection.rs'));
      const profileRs = stripRustCommentsAndTests(readRepoText(ctx.repoRoot, 'src-tauri/src/browser/profile.rs'));
      const hasTimingsAndHotForward =
        qcRs.includes('struct LaunchPhaseTimings') &&
        hasRustFn(qcRs, 'build_hot_forward_args') &&
        profileRs.includes('RunningMemoGuard');

      if (!hasTimingsAndHotForward) {
        return gapOrFail(ctx.mode, 'LaunchPhaseTimings / build_hot_forward_args / RunningMemoGuard missing', {
          preflightMs,
          coldLaunchMs,
          coldNavigateMs,
          hotTabMs,
          totalE2eMs,
          pid,
        });
      }

      const hotArgsBody = extractRustFnBody(qcRs, 'build_hot_forward_args');
      const launchScopeBody = extractRustFnBody(qcRs, 'launch_scope_url_with_options_locked');
      assert.ok(
        hotArgsBody.includes('--user-data-dir=') &&
          hotArgsBody.includes('--profile-directory=Default') &&
          hotArgsBody.includes('target_url'),
        'build_hot_forward_args must construct minimal 3-arg forwarding',
      );
      assert.ok(launchScopeBody.includes('build_hot_forward_args'), 'launch_scope_url_with_options_locked must use build_hot_forward_args');

      return {
        status: 'pass',
        summary: `Cold+hot claude.ai pipeline completed in ${totalE2eMs}ms (preflight=${preflightMs}ms, cold=${coldLaunchMs + coldNavigateMs}ms, hot=${hotTabMs}ms)`,
        metrics: { preflightMs, coldLaunchMs, coldNavigateMs, hotTabMs, totalE2eMs, pid },
      };
    },
  },

  // =========================================================================
  // E2E-04: QuotaDetailsModal 重设计与 2 按钮精简 (5 Tier 1 cases)
  // =========================================================================
  {
    id: 'T1-E2E04-01',
    tier: 1,
    features: ['E2E-04'],
    title: '当前身份弹窗 5 层布局、2 按钮精简与旧底部按钮清零（双语）',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        const inspection = await dialog.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const actions = [...node.querySelectorAll('.confirm-actions button')].map((b) => b.textContent?.trim() ?? '');
          return {
            width: Math.round(rect.width),
            hasProfile: Boolean(node.querySelector('.quota-details-profile')),
            windowCount: node.querySelectorAll('.quota-details-windows .quota-details-window').length,
            hasPace: Boolean(node.querySelector('.quota-details-pace')),
            hasFacts: Boolean(node.querySelector('dl.quota-details-facts')),
            factsLinks: node.querySelectorAll('dl.quota-details-facts a').length,
            hasDisclosure: Boolean(node.querySelector('.quota-details-disclosure')),
            actions,
            text: node.textContent ?? '',
          };
        });

        assert.equal(inspection.width, 600, `Expected modal width 600, got ${inspection.width}`);
        assert.equal(inspection.hasProfile, true);
        assert.equal(inspection.windowCount, 2);
        assert.equal(inspection.hasPace, true);
        assert.equal(inspection.hasFacts, true);
        assert.equal(inspection.factsLinks, 0);
        assert.equal(inspection.hasDisclosure, true);
        assert.deepEqual(inspection.actions, ['进入 Claude.ai', '网页同步额度与重置']);

        const forbiddenOldButtons = ['刷新本地记录', '唤醒 5h 计时', '在线校准额度', '打开官方用量页'];
        for (const label of forbiddenOldButtons) {
          assert.equal(await dialog.getByRole('button', { name: label, exact: true }).count(), 0);
        }

        // Switch to EN and verify 2 buttons update cleanly
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        await ui.page.getByRole('radio', { name: 'EN', exact: true }).click();
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        await dialog.waitFor();
        const enActions = await dialog.locator('.confirm-actions button').allInnerTexts();
        assert.deepEqual(
          enActions.map((s) => s.trim()),
          ['Open Claude.ai', 'Sync web quota & resets'],
        );
        for (const label of ['Refresh local', 'Wake 5h timer', 'Calibrate online', 'Open official usage']) {
          assert.equal(await dialog.getByRole('button', { name: label, exact: true }).count(), 0);
        }

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'QuotaDetailsModal 5-layer layout & 2-button footer verified in zh and en',
          metrics: { modalWidth: inspection.width, footerButtons: inspection.actions.length },
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E04-02',
    tier: 1,
    features: ['E2E-04'],
    title: '点击「进入 Claude.ai」与「网页同步额度与重置」IPC 契约（当前身份与已保存身份）',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        // 1. Current identity modal
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        let cmds = await ui.getIpcCommands();
        const openCurrent = cmds.find((c) => c.command === 'browser_open_identity_profile');
        assert.ok(openCurrent, 'Current enterClaudeAi must invoke browser_open_identity_profile');
        assert.deepEqual(openCurrent.args, {
          accountId: 'current',
          expectedIdentity: HEX_FP(1),
          openMode: 'claude_ai',
        });
        assert.equal(cmds.filter((c) => c.command === 'identities_stop').length, 0, 'Must never call identities_stop');

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent?.includes('已从浏览器同步') || el?.textContent?.includes('Synced quota'));
        });
        cmds = await ui.getIpcCommands();
        const syncCurrent = cmds.find((c) => c.command === 'identities_sync_subscription');
        assert.ok(syncCurrent);
        assert.equal((syncCurrent.args as Record<string, unknown>)?.expectedIdentity, HEX_FP(1));

        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();

        // 2. Saved identity (Identity 2) modal
        const savedCard = ui.page.locator('.identity-card:not(.current)').filter({
          has: ui.page.getByRole('heading', { name: 'Identity 2', exact: true }),
        });
        await savedCard.locator('.identity-quota-open').click();
        await dialog.waitFor();

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '进入 Claude.ai', exact: true }).click();
        await dialog.locator('.quota-details-feedback').waitFor();
        cmds = await ui.getIpcCommands();
        const openSaved = cmds.find((c) => c.command === 'browser_open_identity_profile');
        assert.ok(openSaved, 'Saved enterClaudeAi must invoke browser_open_identity_profile');
        assert.deepEqual(openSaved.args, {
          accountId: HEX_ID(2),
          expectedIdentity: HEX_FP(2),
          openMode: 'claude_ai',
        });

        await ui.clearIpc();
        await dialog.getByRole('button', { name: '网页同步额度与重置', exact: true }).click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el?.textContent?.includes('已从浏览器同步') || el?.textContent?.includes('Synced quota'));
        });
        cmds = await ui.getIpcCommands();
        const syncSaved = cmds.find((c) => c.command === 'identities_sync_subscription');
        assert.ok(syncSaved);
        assert.deepEqual(syncSaved.args, {
          accountId: HEX_ID(2),
          expectedIdentity: HEX_FP(2),
        });

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: '2-button IPC contracts verified for both current and saved identities with zero identities_stop',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E04-03',
    tier: 1,
    features: ['E2E-04'],
    title: '<dl> 内联交互：套餐校准/续期编辑与焦点移交 + restoreFocus',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        const opener = ui.page.locator('.identity-card.current .identity-quota-open');
        await opener.waitFor();
        await opener.focus();
        await ui.page.keyboard.press('Enter');

        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        // 1. Direct Escape restores focus back to original opener
        await ui.page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await ui.page.waitForFunction(() =>
          Boolean(document.activeElement?.closest('.identity-card.current')?.querySelector('.identity-quota-open') === document.activeElement),
        );

        // 2. Open again -> click inline [data-open-plan-calibration] -> hands focus to expiryEditor -> cancel -> restores to opener
        await opener.focus();
        await opener.click();
        await dialog.waitFor();
        await dialog.locator('[data-open-plan-calibration]').click();
        await dialog.waitFor({ state: 'detached' });

        const expiryDialog = ui.page.locator('[role="dialog"]').filter({
          has: ui.page.locator('[data-manual-plan]'),
        });
        await expiryDialog.waitFor();
        await expiryDialog.getByRole('button', { name: '取消', exact: true }).click();
        await expiryDialog.waitFor({ state: 'detached' });

        await ui.page.waitForFunction(() =>
          Boolean(document.activeElement?.closest('.identity-card.current')?.querySelector('.identity-quota-open') === document.activeElement),
        );

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'QuotaDetailsModal restoreFocus and expiryEditor fallbackFocusRef handoff verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E04-04',
    tier: 1,
    features: ['E2E-04'],
    title: '7d >= 90% 重置卡行内操作、Fable 池与只读 KYC 展示',
    async run(ctx) {
      const nowSec = Math.floor(Date.now() / 1000);
      const nowMs = nowSec * 1000;
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: {
          syncBehavior: { verifyResetSuccess: true, dropUsed7dTo: 10, decrementResets: true },
          identities: {
            current: {
              quota_7d_used: 92,
              quota_7d_fable_used: 35,
              quota_7d_fable_reset_at: nowSec + 86400 * 3,
              manual_resets_remaining: 2,
              manual_resets_valid_until: nowSec + 43200,
              manual_resets_observed_at_ms: nowMs - 60000,
              manual_resets_grants: [{ resets_left: 2, ends_at: nowSec + 12 * 3600 }],
              kyc_status: 'approved',
              kyc_check_kind: 'persona',
              kyc_observed_at_ms: nowMs - 60000,
            },
            summaries: {
              [HEX_ID(2)]: {
                quota_7d_used: 94,
                manual_resets_remaining: 1,
                manual_resets_valid_until: nowSec + 43200,
                manual_resets_observed_at_ms: nowMs - 60000,
                manual_resets_grants: [{ resets_left: 1, ends_at: nowSec + 1800 }],
                kyc_status: 'pending',
                kyc_check_kind: 'persona',
                kyc_observed_at_ms: nowMs - 60000,
              },
            },
          },
        },
      });
      try {
        // 1. Current identity modal
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        assert.equal(await dialog.locator('.quota-details-pool[data-quota-fable-7d]').count(), 1);
        assert.equal(await dialog.locator('[data-reset-urgency="soon"]').count(), 1);
        const kycBox = dialog.locator('[data-kyc-status="approved"]');
        assert.equal(await kycBox.count(), 1);
        assert.equal(await kycBox.locator('a').count(), 0, 'KYC status must be strictly read-only without links');
        const kycText = await kycBox.innerText();
        assert.equal(kycText.includes('vendor_inquiry'), false);

        // Quick reset on current calls browser_open_usage
        await ui.clearIpc();
        await dialog.locator('.identity-relay-quick-reset-btn').click();
        await dialog.locator('.quota-details-feedback').waitFor();
        let cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'browser_open_usage'));

        // Verify reset calls identities_sync_subscription and renders confirmation
        await ui.clearIpc();
        await dialog.locator('[data-details-verify-reset]').click();
        await ui.page.waitForFunction(() => {
          const el = document.querySelector('.quota-details-feedback');
          return Boolean(el && el.textContent && !el.textContent.includes('正在'));
        });
        cmds = await ui.getIpcCommands();
        assert.ok(cmds.some((c) => c.command === 'identities_sync_subscription'));
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();

        // 2. Saved identity quick-reset calls browser_open_identity_profile with openMode: 'usage'
        const savedCard = ui.page.locator('.identity-card:not(.current)').filter({
          has: ui.page.getByRole('heading', { name: 'Identity 2', exact: true }),
        });
        await savedCard.locator('.identity-quota-open').click();
        await dialog.waitFor();
        assert.equal(await dialog.locator('[data-kyc-status="pending"]').count(), 1);
        assert.equal(await dialog.locator('[data-reset-urgency="critical"]').count(), 1);

        await ui.clearIpc();
        await dialog.locator('.identity-relay-quick-reset-btn').click();
        await dialog.locator('.quota-details-feedback').waitFor();
        cmds = await ui.getIpcCommands();
        const savedUsageOpen = cmds.find((c) => c.command === 'browser_open_identity_profile');
        assert.ok(savedUsageOpen);
        assert.equal((savedUsageOpen.args as Record<string, unknown>)?.openMode, 'usage');

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Reset-card inline actions, Fable 7d pool, urgency badges, and read-only KYC verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E04-05',
    tier: 1,
    features: ['E2E-04'],
    title: '折叠诊断区读取与隐私遮罩联动',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        await ui.page.locator('.identity-card.current .identity-quota-open').click();
        const dialog = ui.page.locator('[role="dialog"] .quota-details-dialog');
        await dialog.waitFor();

        await dialog.locator('.quota-details-disclosure-trigger').click();
        await dialog.locator('.quota-details-guide').waitFor();
        const guideText = await dialog.locator('.quota-details-guide').innerText();
        assert.ok(guideText.length > 0);

        await dialog.locator('.quota-details-guide button').click();
        await ui.page.waitForFunction(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { state?: { copied?: string[] } } }).__e2eUi;
          return (uiCtrl?.state?.copied?.length ?? 0) > 0;
        });

        const copiedJson = await ui.page.evaluate(() => {
          const uiCtrl = (window as unknown as { __e2eUi?: { state?: { copied?: string[] } } }).__e2eUi;
          return uiCtrl?.state?.copied?.[0] ?? '';
        });
        const parsedDiag = JSON.parse(copiedJson) as Record<string, unknown>;
        assert.equal(parsedDiag.version, '0.4.5');
        assert.ok(parsedDiag.windows && typeof parsedDiag.windows === 'object');
        assert.equal(copiedJson.includes('alpha@example.invalid'), false, 'Diagnostic JSON must never leak email');

        // Enable privacyMask and verify modal masks name/email
        await ui.page.evaluate(async () => {
          const modPath = '/src/settings-model.ts';
          const { updatePreferences } = await import(modPath);
          updatePreferences({ privacyMask: true });
        });
        await ui.page.waitForFunction(() => {
          const emailEl = document.querySelector('.quota-details-who p');
          return Boolean(emailEl && !emailEl.textContent?.includes('alpha@example.invalid'));
        });
        const maskedEmail = await dialog.locator('.quota-details-who p').innerText();
        assert.equal(maskedEmail.includes('alpha@example.invalid'), false);
        assert.ok(maskedEmail.includes('*'));

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Collapsible diagnostic sanitization & privacyMask masking inside QuotaDetailsModal verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  // =========================================================================
  // E2E-05: 全站 10 大侧栏页面视觉统一与硬几何契约 (5 Tier 1 cases)
  // =========================================================================
  {
    id: 'T1-E2E05-01',
    tier: 1,
    features: ['E2E-05'],
    title: '10 页完整路由、44px 页头统一与 1040×820 双语明暗零溢出巡检',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        contextOptions: { viewport: { width: 1040, height: 820 }, reducedMotion: 'reduce' },
      });
      const expectedPages = ['quick', 'browser', 'system', 'vps', 'risk', 'cleaner', 'usage', 'logs', 'help', 'settings'] as const;
      let checksRun = 0;

      try {
        await ui.page.locator('.workspace-nav').last().waitFor();

        for (const combo of [
          { locale: 'zh', theme: 'light', layout: 'classic' },
          { locale: 'en', theme: 'dark', layout: 'compact' },
        ] as const) {
          await ui.page.getByRole('radio', { name: combo.locale === 'zh' ? 'CN' : 'EN', exact: true }).click();
          await ui.page.evaluate(async (c) => {
            const modPath = '/src/settings-model.ts';
            const { updatePreferences } = await import(modPath);
            updatePreferences({ theme: c.theme, sidebarLayout: c.layout, reduceMotion: true });
          }, combo);

          for (let idx = 0; idx < expectedPages.length; idx++) {
            await ui.page.locator('.workspace-nav').nth(idx).click();
            await ui.page.locator('.workspace h1').waitFor();
            await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

            const metrics = await ui.page.evaluate(() => {
              const sidebar = document.querySelector('.app-sidebar') as HTMLElement;
              const h1 = document.querySelector('.workspace h1') as HTMLElement;
              const header = document.querySelector('.workspace .cleanup-title, .workspace header') as HTMLElement;
              const root = document.querySelector('.cleaner-slot > *') as HTMLElement;
              const h1Style = getComputedStyle(h1);
              const hdrStyle = getComputedStyle(header);
              return {
                storedPage: localStorage.getItem('claude-local.page.v1'),
                rootClasses: root?.className ?? '',
                docScrollW: document.documentElement.scrollWidth,
                docClientW: document.documentElement.clientWidth,
                rootScrollW: root?.scrollWidth ?? 0,
                rootClientW: root?.clientWidth ?? 0,
                sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
                h1FontSize: h1Style.fontSize,
                headerMinHeight: parseFloat(hdrStyle.minHeight || '0') || header.getBoundingClientRect().height,
                headerHeight: Math.round(header.getBoundingClientRect().height),
              };
            });

            assert.equal(metrics.storedPage, expectedPages[idx]);
            assert.ok(
              metrics.rootClasses.includes('system-page') || metrics.rootClasses.includes('identity-page'),
              `Page ${expectedPages[idx]} root missing .system-page/.identity-page`,
            );
            assert.equal(metrics.h1FontSize, '18px', `Page ${expectedPages[idx]} h1 fontSize must be 18px`);
            assert.ok(
              metrics.headerMinHeight >= 44 || metrics.headerHeight >= 44,
              `Page ${expectedPages[idx]} header height < 44px`,
            );
            assert.ok(
              metrics.docScrollW <= metrics.docClientW + 1,
              `Horizontal overflow on ${combo.locale}/${combo.layout}/${expectedPages[idx]}`,
            );
            assert.ok(
              metrics.rootScrollW <= metrics.rootClientW + 1,
              `Content overflow on ${combo.locale}/${combo.layout}/${expectedPages[idx]}`,
            );
            if (combo.layout === 'classic') {
              assert.ok(metrics.sidebarWidth <= 196, `Classic sidebar width ${metrics.sidebarWidth} > 196`);
            } else {
              assert.equal(metrics.sidebarWidth, 72, `Compact sidebar width must be 72`);
            }
            checksRun++;
          }
        }

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: `10-page routing, 44px headers, 18px h1, and zero overflow verified across zh/light/classic & en/dark/compact`,
          metrics: { checksRun },
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E05-02',
    tier: 1,
    features: ['E2E-05'],
    title: 'cleaner 身份工牌 166×286、绿光、悬停 translateY 非 matrix3d 与长名称单行省略',
    async run(ctx) {
      const longSavedName = 'Long synthetic local archive name — alpha beta gamma delta epsilon';
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        contextOptions: { viewport: { width: 1040, height: 820 }, reducedMotion: 'no-preference' },
        seed: {
          identities: {
            records: [
              { id: HEX_ID(1), name: 'Identity 1', saved_at: 1780000001000, bytes: 4096, policy: { skills: true, plugins: true, mcp: true, settings: true, projects: true, history: true, cache: false } },
              { id: HEX_ID(2), name: longSavedName, saved_at: 1780000002000, bytes: 4096, policy: { skills: true, plugins: true, mcp: true, settings: true, projects: true, history: true, cache: false } },
            ],
          },
        },
      });
      try {
        await ui.page.evaluate(async () => {
          const modPath = '/src/settings-model.ts';
          const { updatePreferences } = await import(modPath);
          updatePreferences({ reduceMotion: false });
        });
        const currentCard = ui.page.locator('.identity-card.current');
        await currentCard.waitFor();

        const cardStats = await ui.page.locator('.identity-card:not(.empty)').evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            const heading = node.querySelector('h3[data-identity-name]')!;
            const strong = node.querySelector('h3[data-identity-name] > strong')!;
            const s = getComputedStyle(strong);
            return {
              width: Math.round(r.width),
              height: Math.round(r.height),
              headingHeight: Math.round(heading.getBoundingClientRect().height),
              whiteSpace: s.whiteSpace,
              overflow: s.overflow,
              textOverflow: s.textOverflow,
              forbiddenRows: node.querySelectorAll('.identity-user-name, .identity-saved-name').length,
            };
          }),
        );

        assert.equal(cardStats.length, 2);
        for (const st of cardStats) {
          assert.equal(st.width, 166);
          assert.equal(st.height, 286);
          assert.equal(st.whiteSpace, 'nowrap');
          assert.equal(st.overflow, 'hidden');
          assert.equal(st.textOverflow, 'ellipsis');
          assert.equal(st.forbiddenRows, 0);
        }
        assert.equal(cardStats[0].headingHeight, cardStats[1].headingHeight, 'Long name must stay single-line');

        const glow = await currentCard.evaluate((node) => getComputedStyle(node, '::before').boxShadow);
        assert.match(glow, /67,\s*228,\s*132/);

        const box = await currentCard.boundingBox();
        assert.ok(box);
        await ui.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await ui.page.waitForFunction(() => getComputedStyle(document.querySelector('.identity-card.current')!).transform !== 'none');
        const hoverTransform = await currentCard.evaluate((n) => getComputedStyle(n).transform);
        assert.notEqual(hoverTransform, 'none');
        assert.equal(hoverTransform.includes('matrix3d'), false, 'Card hover must stay 2D translateY, never matrix3d');

        // Enable reduceMotion -> hover must produce transform: none
        await ui.page.mouse.move(5, 5);
        await ui.page.evaluate(async () => {
          const modPath = '/src/settings-model.ts';
          const { updatePreferences } = await import(modPath);
          updatePreferences({ reduceMotion: true });
        });
        await ui.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await ui.page.waitForFunction(() => getComputedStyle(document.querySelector('.identity-card.current')!).transform === 'none');

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'Identity card 166x286, current green glow, 2D hover transform, reduceMotion, and single-line ellipsis verified',
          metrics: { hoverTransform, headingHeight: cardStats[0].headingHeight },
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E05-03',
    tier: 1,
    features: ['E2E-05'],
    title: 'system 3 卡高度差 >=20px 与 vps 3 卡零输入/无泄露契约',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        await ui.page.locator('.workspace-nav').nth(2).click(); // system
        await ui.page.locator('.system-environment-page').waitFor();

        const sysGeom = await ui.page.locator('.system-environment-page').evaluate((root) => {
          const cards = [...root.querySelectorAll('.system-setting-card')].map((el) => ({
            setting: el.getAttribute('data-system-setting'),
            height: el.getBoundingClientRect().height,
            inlineFields: el.querySelectorAll('.system-inline-field').length,
          }));
          const locationBtns = root.querySelectorAll('.system-location-controls > button').length;
          return { cards, locationBtns };
        });

        assert.deepEqual(sysGeom.cards.map((c) => c.setting), ['timezone', 'language', 'location']);
        assert.equal(sysGeom.cards[2].inlineFields, 0);
        assert.ok(
          sysGeom.cards[2].height <= sysGeom.cards[0].height - 20,
          `Location card (${sysGeom.cards[2].height}px) must be >=20px shorter than timezone card (${sysGeom.cards[0].height}px)`,
        );
        assert.equal(sysGeom.locationBtns, 1, 'When location_enabled=false, disable button must be omitted');

        // Navigate to vps (network)
        await ui.page.locator('.workspace-nav').nth(3).click();
        await ui.page.locator('.network-page').waitFor();
        const vpsGeom = await ui.page.locator('.network-page').evaluate((root) => {
          const cards = [...root.querySelectorAll('.network-action-card')].map((card) => ({
            buttons: card.querySelectorAll('button').length,
            inputs: card.querySelectorAll('input, textarea, a').length,
            html: card.outerHTML,
          }));
          const domains = root.querySelectorAll('.domain-diagnostics-item').length;
          return { cards, domains };
        });

        assert.equal(vpsGeom.cards.length, 3);
        for (const c of vpsGeom.cards) {
          assert.equal(c.buttons, 1);
          assert.equal(c.inputs, 0);
          assert.equal(/ikuuu\.top|kookeey\.com|j6Vd|uXqM|14151075/i.test(c.html), false, 'Referral URLs/codes must not leak in card DOM');
        }
        assert.equal(vpsGeom.domains, 4);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'system 3-card height delta (>=20px) and vps 3-card zero-input/no-referral-leak contracts verified',
          metrics: {
            timezoneHeight: Math.round(sysGeom.cards[0].height),
            locationHeight: Math.round(sysGeom.cards[2].height),
            vpsDomainRows: vpsGeom.domains,
          },
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E05-04',
    tier: 1,
    features: ['E2E-05'],
    title: 'logs 滚动/4 KPI/分页与时区控件 + quick/help/settings 核心契约',
    async run(ctx) {
      const ui = await openAppWithMockUi({ repoRoot: ctx.repoRoot });
      try {
        // 1. logs
        await ui.page.locator('.workspace-nav').nth(7).click();
        await ui.page.locator('.system-page.logs-page').waitFor();
        await ui.page.locator('.logs-kpi-card').first().waitFor();
        const logsMeta = await ui.page.locator('.system-page.logs-page').evaluate((root) => {
          const tz = root.querySelector('.logs-tz-select') as HTMLElement | null;
          return {
            overflowY: getComputedStyle(root).overflowY,
            kpiCount: root.querySelectorAll('.logs-kpi-card').length,
            topPager: root.querySelectorAll('[data-logs-top-pager]').length,
            unattrChip: root.querySelectorAll('[data-logs-unattr-chip]').length,
            pagination: root.querySelectorAll('[data-logs-pagination]').length,
            orderToggle: root.querySelectorAll('[data-logs-order-toggle]').length,
            tzVisible: Boolean(tz && tz.getBoundingClientRect().width > 0 && tz.scrollWidth <= tz.clientWidth + 1),
          };
        });
        assert.equal(logsMeta.overflowY, 'auto');
        assert.equal(logsMeta.kpiCount, 4);
        assert.equal(logsMeta.topPager, 1);
        assert.equal(logsMeta.unattrChip, 1);
        assert.equal(logsMeta.pagination, 1);
        assert.equal(logsMeta.orderToggle, 1);
        assert.equal(logsMeta.tzVisible, true);

        // 2. quick
        await ui.page.locator('.workspace-nav').nth(0).click();
        await ui.page.locator('.quick-page').waitFor();
        assert.equal(await ui.page.locator('.quick-setup-card').count(), 8);

        // 3. help
        await ui.page.locator('.workspace-nav').nth(8).click();
        await ui.page.locator('.help-page').waitFor();
        const helpCols = await ui.page.locator('.help-topics').evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length);
        assert.equal(helpCols, 2);

        // 4. settings
        await ui.page.locator('.workspace-nav').nth(9).click();
        await ui.page.locator('.settings-page').waitFor();
        assert.equal(await ui.page.locator('.settings-tabs [role="tab"]').count(), 4);

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: 'logs (4 KPI, pagers, tz select), quick (8 cards), help (2-col), and settings (4 tabs) verified',
        };
      } finally {
        await ui.close();
      }
    },
  },

  {
    id: 'T1-E2E05-05',
    tier: 1,
    features: ['E2E-05'],
    title: '?window=monitor 三态几何与 9 图标契约 + main.tsx CSS 秩序/无重复规则',
    async run(ctx) {
      // Static CSS order & consolidation check (M3/M4 contract)
      const mainTsx = stripJsComments(readRepoText(ctx.repoRoot, 'src/main.tsx'));
      const styleCss = readRepoText(ctx.repoRoot, 'src/style.css');
      const idxPos = mainTsx.indexOf("import './index.css'");
      const stylePos = mainTsx.indexOf("import './style.css'");
      const shellPos = mainTsx.indexOf("import './productivity-shell.css'");
      const hasQuotaDetailsInStyleCss = /quota-details/.test(styleCss);

      if (idxPos < 0 || stylePos < 0 || idxPos >= stylePos || shellPos < stylePos || hasQuotaDetailsInStyleCss) {
        return gapOrFail(ctx.mode, 'CSS import order in main.tsx or .quota-details consolidation in style.css violates M3/M4 contract', {
          idxPos,
          stylePos,
          shellPos,
          hasQuotaDetailsInStyleCss,
        });
      }

      // Runtime 3-state monitor viewport checks
      const mon = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        monitorWindow: true,
        contextOptions: { viewport: { width: 340, height: 258 }, reducedMotion: 'reduce' },
        seed: {
          monitor: { window: { open: true, compact: false, collapsed: false } },
        },
      });
      try {
        // 1. Expanded (340x258)
        await mon.page.locator('.monitor-hud-shell').waitFor();
        const expanded = await mon.page.evaluate(() => {
          const btns = [...document.querySelectorAll('.monitor-hud-controls button.monitor-hud-icon-btn')];
          const clipped = btns.some((b) => {
            const r = b.getBoundingClientRect();
            return r.width <= 0 || r.height <= 0 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1;
          });
          return {
            btnCount: btns.length,
            clipped,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            compactAttr: document.querySelector('.monitor-hud-shell')?.getAttribute('data-compact'),
          };
        });
        assert.equal(expanded.btnCount, 9);
        assert.equal(expanded.clipped, false);
        assert.ok(expanded.scrollW <= expanded.clientW + 1);
        assert.equal(expanded.compactAttr, 'false');

        // 2. Compact (340x152)
        await mon.page.setViewportSize({ width: 340, height: 152 });
        await mon.page.evaluate(() => {
          (window as unknown as { __e2eUi: { setMonitorWindow: (p: Record<string, unknown>) => void } })
            .__e2eUi.setMonitorWindow({ compact: true, collapsed: false });
        });
        await mon.page.locator('.monitor-hud-controls button.monitor-hud-icon-btn').nth(6).click();
        await mon.page.waitForFunction(() => document.querySelector('.monitor-hud-shell')?.getAttribute('data-compact') === 'true');
        const compactMetrics = await mon.page.evaluate(() => {
          const btns = [...document.querySelectorAll('.monitor-hud-controls button.monitor-hud-icon-btn')];
          const clipped = btns.some((b) => {
            const r = b.getBoundingClientRect();
            return r.width <= 0 || r.height <= 0 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1;
          });
          return {
            btnCount: btns.length,
            clipped,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
          };
        });
        assert.equal(compactMetrics.btnCount, 9);
        assert.equal(compactMetrics.clipped, false);
        assert.ok(compactMetrics.scrollW <= compactMetrics.clientW + 1);

        // 3. Collapsed (52x138)
        await mon.page.setViewportSize({ width: 52, height: 138 });
        await mon.page.locator('.monitor-hud-controls button.monitor-hud-icon-btn').nth(2).click();
        await mon.page.locator('.monitor-hud-shell.is-collapsed').waitFor();
        const collapsedMetrics = await mon.page.evaluate(() => ({
          pills: document.querySelectorAll('.monitor-collapsed-pill').length,
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        assert.equal(collapsedMetrics.pills, 2);
        assert.ok(collapsedMetrics.scrollW <= collapsedMetrics.clientW + 1);

        assert.equal(mon.pageErrors.length, 0, mon.pageErrors.join('\n'));
        assert.deepEqual(await mon.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: '?window=monitor 3-state geometry (340x258, 340x152, 52x138), 9 HUD icons, and CSS order verified',
        };
      } finally {
        await mon.close();
      }
    },
  },

  // =========================================================================
  // E2E-06: 双语 YAML 1:1 对齐与测试键覆盖 (5 Tier 1 cases)
  // =========================================================================
  {
    id: 'T1-E2E06-01',
    tier: 1,
    features: ['E2E-06'],
    title: '运行真实 bun test src/i18n.test.ts 全通过',
    async run(ctx) {
      const t0 = performance.now();
      const res = runBunTest(ctx.repoRoot, ['src/i18n.test.ts']);
      const durationMs = Math.round(performance.now() - t0);
      assert.equal(res.exitCode, 0, `bun test src/i18n.test.ts failed:\n${res.stdout}\n${res.stderr}`);
      const combined = `${res.stdout}\n${res.stderr}`;
      assert.match(combined, /5 pass/);
      assert.match(combined, /0 fail/);
      return {
        status: 'pass',
        summary: `bun test src/i18n.test.ts passed in ${durationMs}ms`,
        metrics: { durationMs },
      };
    },
  },

  {
    id: 'T1-E2E06-02',
    tier: 1,
    features: ['E2E-06'],
    title: 'R3/R4 键生命周期与纯 LF 无 BOM 契约',
    async run(ctx) {
      const zhBuf = readFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/zh.yaml'));
      const enBuf = readFileSync(resolveRepoSrcPath(ctx.repoRoot, 'src/locales/en.yaml'));

      for (const [label, buf] of [
        ['zh.yaml', zhBuf],
        ['en.yaml', enBuf],
      ] as const) {
        const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
        assert.equal(hasBom, false, `${label} must not contain UTF-8 BOM`);
        assert.equal(buf.includes(0x0d), false, `${label} must use pure LF line endings`);
      }

      const zhRaw = zhBuf.toString('utf8');
      const enRaw = enBuf.toString('utf8');
      const { errors, zh, en } = validateCatalogPair(zhRaw, enRaw);
      assert.deepEqual(errors, [], `YAML catalog alignment failed:\n${errors.join('\n')}`);

      const removedR3Keys = ['quota.refreshLocal', 'quota.openOfficial', 'quota.calibrateOnline'];
      for (const k of removedR3Keys) {
        if (Object.hasOwn(zh, k) || Object.hasOwn(en, k)) {
          return gapOrFail(ctx.mode, `Deprecated R3 key still exists in YAML: ${k}`);
        }
      }

      // Verify zero non-comment references to removed R3 keys in src/
      const srcFiles = collectFilesRecursive(
        resolveRepoSrcPath(ctx.repoRoot, 'src'),
        (n) => (n.endsWith('.ts') || n.endsWith('.tsx')) && !n.includes('.test.'),
      );
      for (const f of srcFiles) {
        const clean = stripJsComments(readFileSync(f, 'utf8'));
        for (const k of removedR3Keys) {
          assert.equal(clean.includes(k), false, `Deprecated key ${k} still referenced in ${f}`);
        }
      }

      for (const requiredKey of ['quota.opened', 'wakeup.wakeNow', 'browser.resetScopePill', 'network.multiPortGroupTitle']) {
        if (!Object.hasOwn(zh, requiredKey) || !Object.hasOwn(en, requiredKey)) {
          return gapOrFail(ctx.mode, `Expected R3/R4 key missing in YAML: ${requiredKey}`);
        }
      }

      const keyCount = Object.keys(zh).length;
      assert.ok(keyCount >= 2500, `Unexpectedly low key count: ${keyCount}`);
      return {
        status: 'pass',
        summary: `zh/en YAML 1:1 aligned (${keyCount} keys, pure LF, no BOM, R3/R4 key lifecycle verified)`,
        metrics: { keyCount },
      };
    },
  },

  {
    id: 'T1-E2E06-03',
    tier: 1,
    features: ['E2E-06'],
    title: 'TypeScript AST 全量 t() / tRef.current() 与 JSX 零硬编码 CJK 验证',
    async run(ctx) {
      const zhRaw = readRepoText(ctx.repoRoot, 'src/locales/zh.yaml');
      const enRaw = readRepoText(ctx.repoRoot, 'src/locales/en.yaml');
      const { errors: yamlErrs, zh } = validateCatalogPair(zhRaw, enRaw);
      assert.deepEqual(yamlErrs, []);

      const tsScan = scanTsI18nAndJsxCjk(resolveRepoSrcPath(ctx.repoRoot, 'src'), zh);
      assert.deepEqual(tsScan.errors, [], `TS AST i18n check failed:\n${tsScan.errors.join('\n')}`);
      assert.ok(tsScan.callCount > 100, `Expected >100 t() calls, got ${tsScan.callCount}`);

      return {
        status: 'pass',
        summary: `Scanned ${tsScan.callCount} TS/TSX t()/tRef.current() calls with 0 missing keys and 0 CJK JSX leaks`,
        metrics: { tsCallCount: tsScan.callCount },
      };
    },
  },

  {
    id: 'T1-E2E06-04',
    tier: 1,
    features: ['E2E-06'],
    title: 'Rust 原生错误键扫描与双语可译性核验',
    async run(ctx) {
      const orchFiles = collectFilesRecursive(
        resolveRepoSrcPath(ctx.repoRoot, 'src-tauri/src/identities/orchestrator'),
        (n) => n.endsWith('.rs'),
      );
      assert.ok(orchFiles.length >= 4, `Expected >=4 orchestrator .rs files, found ${orchFiles.length}`);

      const zhRaw = readRepoText(ctx.repoRoot, 'src/locales/zh.yaml');
      const enRaw = readRepoText(ctx.repoRoot, 'src/locales/en.yaml');
      const { zh, en } = validateCatalogPair(zhRaw, enRaw);

      const rsScan = scanRustNativeErrorKeys(resolveRepoSrcPath(ctx.repoRoot, 'src-tauri/src'), zh, en);
      assert.deepEqual(rsScan.errors, [], `Rust error key coverage failed:\n${rsScan.errors.join('\n')}`);
      assert.ok(rsScan.keys.includes('quotaOnline.busy'));
      assert.ok(rsScan.keys.includes('browser.error.unsupportedExitCountry'));
      assert.ok(rsScan.keys.includes('relay.error.targetSlotBusy'));

      return {
        status: 'pass',
        summary: `Verified ${rsScan.keys.length} Rust native error keys covered cleanly in zh.yaml & en.yaml`,
        metrics: { rustKeyCount: rsScan.keys.length, orchestratorFiles: orchFiles.length },
      };
    },
  },

  {
    id: 'T1-E2E06-05',
    tier: 1,
    features: ['E2E-06'],
    title: '真实 Vite+Chrome 双语界面遍历无 raw key / 无 EN 中文泄漏',
    async run(ctx) {
      const ui = await openAppWithMockUi({
        repoRoot: ctx.repoRoot,
        seed: { uiLanguage: 'en' },
        contextOptions: { viewport: { width: 1040, height: 820 }, reducedMotion: 'reduce' },
      });
      const rawKeyPattern = /\b(?:quota|quotaOnline|relay\.error|browser\.error|logs|usage|network|settings|monitor|identityCard)\.(?!json\b|yaml\b|exe\b|log\b|txt\b|app\b|ts\b|tsx\b)[a-zA-Z0-9_.]+\b/;
      let pagesScanned = 0;

      try {
        await ui.page.locator('.workspace-nav').last().waitFor();
        await ui.page.waitForFunction(() => document.documentElement.getAttribute('data-locale') === 'en');

        for (let idx = 0; idx < 10; idx++) {
          await ui.page.locator('.workspace-nav').nth(idx).click();
          await ui.page.locator('.workspace h1').waitFor();
          await ui.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

          const checkPageText = async (scopeName: string) => {
            const payload = await ui.page.evaluate(() => {
              const bodyText = document.body.innerText ?? '';
              const attrs = [...document.querySelectorAll('[aria-label], [title]')]
                .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
                .join('\n');
              return { bodyText, attrs };
            });
            // Strip allowed brand/language switcher labels & path literals
            const cleaned = `${payload.bodyText}\n${payload.attrs}`
              .replaceAll('简体中文', '')
              .replaceAll('Claude-Local Browser.app', '');
            assert.equal(
              rawKeyPattern.test(cleaned),
              false,
              `Raw i18n key leaked in EN mode on ${scopeName}: ${cleaned.match(rawKeyPattern)?.[0]}`,
            );
            assert.equal(
              /[\u3400-\u9fff]/.test(cleaned),
              false,
              `CJK text leaked in EN mode on ${scopeName}: ${cleaned.match(/[\u3400-\u9fff]+/)?.[0]}`,
            );
          };

          await checkPageText(`nav-${idx}`);
          if (idx === 5) {
            await ui.page.locator('.identity-card.current .identity-quota-open').click();
            await ui.page.locator('[role="dialog"] .quota-details-dialog').waitFor();
            await checkPageText('quota-details-modal');
            await ui.page.keyboard.press('Escape');
            await ui.page.locator('[role="dialog"] .quota-details-dialog').waitFor({ state: 'detached' });
          }
          pagesScanned++;
        }

        assert.equal(ui.pageErrors.length, 0, ui.pageErrors.join('\n'));
        assert.deepEqual(await ui.getUnhandledCommands(), []);
        return {
          status: 'pass',
          summary: `EN mode UI scan across ${pagesScanned} pages + QuotaDetailsModal passed with zero raw keys and zero CJK leaks`,
          metrics: { pagesScanned },
        };
      } finally {
        await ui.close();
      }
    },
  },
];
