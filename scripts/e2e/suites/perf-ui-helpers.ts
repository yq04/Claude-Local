/**
 * [INPUT]: scripts/e2e/lib/*（chrome-harness, sandbox）与 ./security-helpers.ts（gapOrFail 与词法解析原语）、src/locales/{zh,en}.yaml。
 * [OUTPUT]: 导出 cases: E2ECase[] = []（兼容 run.ts:loadSuites），SharedUiHarness（可轮转与瞬态自愈共享会话：getSharedUiSession / resetSharedUiSession / openAppWithMockUi + 全量 Tauri mockIPC 覆盖与 unhandledCommands 审计）及沙盒 i18n/YAML/AST/Rust 校验器。
 * [POS]: Milestone E3 性能/弹窗/全站排版/双语套件共享辅助模块；严格只写内存/临时沙盒，零宿主机变更与零仓库截图落盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import {
  buildMockIpcShellHtml,
  clearIpcLog,
  emitTauriEvent,
  getIpcCommands,
  launchPinnedChrome,
  openMockedAppPage,
  startViteServer,
  type IsolatedContextHandle,
  type IsolatedContextOptions,
  type MockIpcCommandRecord,
  type PinnedBrowserHandle,
  type ViteHarnessHandle,
} from '../lib/chrome-harness.ts';
import { createSandbox } from '../lib/sandbox.ts';
import type { E2ECase, SandboxHandle } from '../lib/types.ts';
import {
  assert,
  extractRustBlock,
  extractRustFnBody,
  findUnusedLoopbackPort,
  gapOrFail,
  hasRustFn,
  httpsGetViaProxy,
  readRepoText,
  resolvePowerShellBinary,
  stripJsComments,
  stripRustCommentsAndTests,
} from './security-helpers.ts';

export {
  assert,
  extractRustBlock,
  extractRustFnBody,
  findUnusedLoopbackPort,
  gapOrFail,
  hasRustFn,
  httpsGetViaProxy,
  readRepoText,
  resolvePowerShellBinary,
  stripJsComments,
  stripRustCommentsAndTests,
};

// Required by scripts/e2e/run.ts:loadSuites
export const cases: E2ECase[] = [];

export const HEX_ID = (n: number): string => n.toString(16).padStart(32, '0');
export const HEX_FP = (n: number): string => n.toString(16).padStart(64, '0');

export interface UiMockSeed {
  uiLanguage?: 'zh' | 'en';
  privacyMask?: boolean;
  localStorage?: Record<string, string>;
  identities?: Record<string, unknown>;
  browser?: Record<string, unknown>;
  system?: Record<string, unknown>;
  monitor?: {
    window?: Record<string, unknown>;
    running?: boolean;
    clientLabel?: string;
    metrics?: Record<string, unknown>;
  };
  commandErrors?: Record<string, string>;
  deferredCommands?: string[];
  quotaSetupStatus?: Record<string, unknown>;
  syncBehavior?: {
    verifyResetSuccess?: boolean;
    dropUsed7dTo?: number;
    decrementResets?: boolean;
  };
  logsOverride?: {
    empty?: boolean;
    longModelName?: string;
  };
  usageOverride?: {
    empty?: boolean;
    longModelName?: string;
  };
}

function buildUiMockSetupScript(): string {
  return `
    const seed = window.__e2eSeed || {};
    if (seed.localStorage && typeof seed.localStorage === 'object') {
      for (const [k, v] of Object.entries(seed.localStorage)) {
        if (typeof v === 'string') window.localStorage.setItem(k, v);
      }
    }
    const hexId = (n) => Number(n).toString(16).padStart(32, '0');
    const hexFp = (n) => Number(n).toString(16).padStart(64, '0');
    const nowSec = Math.floor(Date.now() / 1000);
    const nowMs = nowSec * 1000;
    const defaultPolicy = {
      skills: true, plugins: true, mcp: true, settings: true,
      projects: true, history: true, cache: false,
    };

    const defaultCurrent = {
      present: true,
      display_name: 'Alpha Workspace',
      email: 'alpha@example.invalid',
      organization: 'Synthetic Org A',
      plan: 'Max 20x',
      auth_status: 'valid',
      proxy: 'http://127.0.0.1:17890',
      unavailable: false,
      quota_identity: hexFp(1),
      quota_source: 'server_anchor',
      quota_observed_at_ms: nowMs - 120000,
      quota_5h_used: 38,
      quota_5h_reset_at: nowSec + 10800,
      quota_5h_source: 'server_anchor',
      quota_5h_observed_at_ms: nowMs - 120000,
      quota_7d_used: 42,
      quota_7d_reset_at: nowSec + 432000,
      quota_7d_source: 'server_anchor',
      quota_7d_observed_at_ms: nowMs - 120000,
      billing_date_kind: 'next_renewal',
      billing_date: nowSec + 18 * 86400,
      billing_observed_at_ms: nowMs - 120000,
      manual_resets_remaining: 1,
      manual_resets_valid_until: nowSec + 43200,
      manual_resets_observed_at_ms: nowMs - 120000,
      subscription_date_source: 'browser',
      kyc_status: 'not_required',
      kyc_observed_at_ms: nowMs - 120000,
    };

    const defaultSummaries = {
      [hexId(1)]: { ...defaultCurrent },
      [hexId(2)]: {
        display_name: 'Beta Workspace',
        email: 'beta@example.invalid',
        organization: 'Synthetic Org B',
        plan: 'Pro',
        auth_status: 'valid',
        proxy: null,
        quota_identity: hexFp(2),
        quota_source: 'server_anchor',
        quota_observed_at_ms: nowMs - 300000,
        quota_5h_used: 20,
        quota_5h_reset_at: nowSec + 14400,
        quota_5h_source: 'server_anchor',
        quota_5h_observed_at_ms: nowMs - 300000,
        quota_7d_used: 25,
        quota_7d_reset_at: nowSec + 345600,
        quota_7d_source: 'server_anchor',
        quota_7d_observed_at_ms: nowMs - 300000,
        manual_resets_remaining: 2,
        manual_resets_valid_until: nowSec + 43200,
        manual_resets_observed_at_ms: nowMs - 300000,
      },
      [hexId(3)]: {
        display_name: 'Gamma Workspace',
        email: 'gamma@example.invalid',
        organization: 'Synthetic Org C',
        plan: 'Max 5x',
        auth_status: 'valid',
        proxy: null,
        quota_identity: hexFp(3),
        quota_source: 'local_estimate',
        quota_observed_at_ms: nowMs - 600000,
        quota_5h_used: 15,
        quota_5h_reset_at: nowSec + 12000,
        quota_7d_used: 18,
        quota_7d_reset_at: nowSec + 500000,
      },
    };

    const defaultIdentities = {
      browser: { enabled: true, bound_ids: [hexId(1), hexId(2)] },
      browser_warning: null,
      active: hexId(1),
      recovery: null,
      running: true,
      cli_running: true,
      sessions: [{ pid: 4201, workspace: 'Claude-Local', entrypoint: 'VS Code' }],
      slot_sessions: {},
      current: defaultCurrent,
      summaries: defaultSummaries,
      records: [
        { id: hexId(1), name: 'Identity 1', saved_at: 1780000001000, bytes: 4096, policy: { ...defaultPolicy } },
        { id: hexId(2), name: 'Identity 2', saved_at: 1780000002000, bytes: 4096, policy: { ...defaultPolicy } },
        { id: hexId(3), name: 'Identity 3', saved_at: 1780000003000, bytes: 4096, policy: { ...defaultPolicy } },
      ],
      warming_cards: [],
      active_browser_slot: 'default',
    };

    const defaultBrowser = {
      ui_language: seed.uiLanguage || 'zh',
      exit_services: [],
      region: { id: 'us-west', label: 'United States', country: 'US', language: 'en-US', locale: 'en_US', timezone: 'America/Los_Angeles' },
      config: {
        seed: 987654,
        proxy: 'http://127.0.0.1:17890',
        follow_machine: false,
        language: 'en-US',
        timezone: 'America/Los_Angeles',
        native_graphics: false,
      },
      machine: {
        platform: 'windows',
        version: '10.0.22631.0',
        cores: 8,
        timezone: 'America/New_York',
        languages: ['en-US'],
        locale: 'en-US',
        locale_country: 'US',
        location_enabled: false,
        timezones: ['America/New_York', 'America/Los_Angeles', 'Asia/Shanghai'],
      },
      engine_version: '148.0.7778.215',
      engine_ready: true,
      running: false,
      profile: 'C:/synthetic/profiles/current',
      identity_linked: true,
      active_browser_slot: 'default',
      identity: { linked: true, status: 'linked', name: 'Alpha Workspace', email: 'alpha@example.invalid', organization: 'Synthetic Org A' },
      cli_identity: { linked: true, status: 'linked', name: 'Alpha Workspace', email: 'alpha@example.invalid', organization: 'Synthetic Org A' },
      cli_expected_identity: hexFp(1),
      cache: [],
      cache_error: '',
      report: null,
      report_received_at: null,
      machine_exit: null,
      checks: [],
    };

    const defaultSystem = {
      platform: 'windows',
      timezone: 'America/New_York',
      timezones: ['America/New_York', 'America/Los_Angeles', 'Asia/Shanghai'],
      automatic_timezone: false,
      languages: ['en-US'],
      location_enabled: false,
      accessibility: true,
    };

    const defaultMonitor = {
      window: {
        open: true,
        alwaysOnTop: true,
        compact: false,
        locked: false,
        clickThrough: false,
        autoHide: false,
        collapsed: false,
        dockedEdge: null,
      },
      running: true,
      clientLabel: 'CLI',
      metrics: {
        available: true,
        tokens5hTotal: 15400,
        tokensPerMin: 280,
        requests5h: 14,
        input5h: 3200,
        output5h: 1800,
        cacheWrite5h: 1400,
        cacheRead5h: 9000,
        cacheHitPct: 81.8,
        latestModel: 'claude-sonnet-4-6',
        latestTurnAtSec: nowSec - 15,
        jsonlRevision: 'rev-1',
      },
    };

    const deepMerge = (base, patch) => {
      if (!patch || typeof patch !== 'object') return base;
      const out = Array.isArray(base) ? [...base] : { ...base };
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
          out[k] = deepMerge(out[k], v);
        } else {
          out[k] = structuredClone(v);
        }
      }
      return out;
    };

    const uiState = {
      uiLanguage: seed.uiLanguage || 'zh',
      privacyMask: typeof seed.privacyMask === 'boolean' ? seed.privacyMask : false,
      appearance: null,
      quotaRevision: 1,
      copied: [],
      identities: deepMerge(defaultIdentities, seed.identities),
      browser: deepMerge(defaultBrowser, seed.browser),
      system: deepMerge(defaultSystem, seed.system),
      monitor: deepMerge(defaultMonitor, seed.monitor),
      wakeup: {
        schema: 1,
        migrated: true,
        config: {
          enabled: false,
          interval_minutes: 60,
          quiet_hours: null,
        },
        targets: [],
        lastGlobalWakeupAtMs: 0,
        nextGlobalAtMs: 0,
        accounts: {},
        status: 'disabled',
        runtime: 'available',
      },
      orchestratorConfig: {
        enabled: false,
        strategy: 'highest_remaining',
        spentThresholdPct: 90,
        maxSameExitConcurrency: 2,
        relayHandoffMode: 'clean',
        cliModel: '',
        cliEffort: '',
        defaultCliModel: '',
        defaultCliEffort: '',
        affinityMode: 'sticky',
        rateLimitMode: 'backoff',
        returnToPreferred: false,
        autoContinueOnRelay: false,
        cooldownMinutes: 30,
        cooldownUntilSec: {},
        slotProxies: {},
      },
      quotaSetupStatus: seed.quotaSetupStatus || { state: 'not_configured', collector_bundled: false, has_statusline: false },
      syncBehavior: seed.syncBehavior || {},
      logsOverride: seed.logsOverride || {},
      usageOverride: seed.usageOverride || {},
    };

    const commandErrors = { ...(seed.commandErrors || {}) };
    const deferredCommands = new Set(seed.deferredCommands || []);
    const pendingResolvers = [];
    const unhandledCommands = [];

    window.__e2eUi = {
      state: uiState,
      commandErrors,
      deferredCommands,
      pendingResolvers,
      unhandledCommands,
      setCommandError(cmd, msg) { commandErrors[cmd] = msg; },
      clearCommandError(cmd) { delete commandErrors[cmd]; },
      deferCommand(cmd) { deferredCommands.add(cmd); },
      releaseDeferred(cmd, rejectMsg) {
        const idx = pendingResolvers.findIndex((p) => p.command === cmd);
        if (idx < 0) return false;
        const [item] = pendingResolvers.splice(idx, 1);
        if (rejectMsg) {
          item.reject(rejectMsg);
        } else {
          item.resolve(executeCommand(item.command, item.args));
        }
        return true;
      },
      setMonitorWindow(patch) {
        Object.assign(uiState.monitor.window, patch);
      },
    };

    function buildUsageSnapshot(args) {
      if (uiState.usageOverride && uiState.usageOverride.empty) {
        const z = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0, reasoning_tokens: null, requests: 0, sessions: 0 };
        return {
          generated_at: nowSec,
          tracking_since: nowSec - 86400,
          timezone: args?.timezone || null,
          granularity: 'day',
          totals: z,
          unattributed: z,
          accounts: [],
          daily: [],
          models: [],
          warnings: [],
          activity: { sessions: 0, active_days: 0 },
        };
      }
      const mkTotals = (i, o, cw, cr, req, sess) => ({
        input_tokens: i, output_tokens: o, cache_creation_tokens: cw, cache_read_tokens: cr,
        total_tokens: i + o + cw + cr, reasoning_tokens: null, requests: req, sessions: sess,
      });
      const t1 = mkTotals(1200, 600, 400, 3800, 18, 2);
      const t2 = mkTotals(800, 400, 200, 2200, 12, 1);
      const total = mkTotals(2000, 1000, 600, 6000, 30, 3);
      const longM = uiState.usageOverride?.longModelName;
      return {
        generated_at: nowSec,
        tracking_since: nowSec - 86400 * 7,
        timezone: args?.timezone || 'America/New_York',
        granularity: 'day',
        totals: total,
        unattributed: mkTotals(100, 50, 0, 150, 2, 1),
        accounts: [
          { id: hexId(1), name: 'Identity 1', email: 'alpha@example.invalid', current: true, totals: t1 },
          { id: hexId(2), name: 'Identity 2', email: 'beta@example.invalid', current: false, totals: t2 },
        ],
        daily: [
          { day: '2026-11-26', totals: t2 },
          { day: '2026-11-27', totals: t1 },
        ],
        models: [
          { model: longM || 'claude-sonnet-4-6', totals: t1, efforts: [{ effort: 'high', totals: t1 }] },
          { model: 'claude-opus-4-6-20260205', totals: t2, efforts: [{ effort: 'medium', totals: t2 }] },
        ],
        warnings: [],
        attribution: { fallback_account_id: hexId(1), fallback_account_name: 'Identity 1', fallback_before: nowSec - 3600, unassigned_requests: 0, unassigned_tokens: 0 },
        activity: { sessions: 3, active_days: 2 },
      };
    }

    function buildLogsSnapshot(args) {
      if (uiState.logsOverride && uiState.logsOverride.empty) {
        return {
          generated_at: nowSec,
          tracking_since: nowSec - 86400,
          timezone: args?.timezone || null,
          total_count: 0,
          page: 1,
          page_size: Number(args?.pageSize || 25),
          summary: {
            total_requests: 0, total_tokens: 0, input_tokens: 0, output_tokens: 0,
            cache_creation_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0,
            total_cache_savings_usd: 0, avg_cost_usd: null, avg_tokens: null,
            timed_requests: 0, avg_duration_ms: null, p95_duration_ms: null,
            avg_tps: null, peak_tps: null, overall_cache_hit_rate: null,
          },
          items: [],
          available_accounts: [],
          available_models: [],
          available_efforts: [],
          has_unattributed: false,
          unattributed_count: 0,
          warnings: [],
        };
      }
      const longM = uiState.logsOverride?.longModelName;
      const items = Array.from({ length: 40 }, (_, idx) => {
        const isUnattr = idx === 2;
        const seq = idx + 1;
        const ts = nowSec - seq * 90;
        return {
          id: 'log-' + String(seq).padStart(4, '0'),
          event_key: 'e2e05log' + String(seq).padStart(4, '0') + '0000111122223333444455556666',
          session_key: '99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa',
          ts,
          ts_ms: ts * 1000 + 250,
          ts_precise: true,
          account_id: isUnattr ? null : idx % 2 === 0 ? hexId(1) : hexId(2),
          account_name: isUnattr ? null : idx % 2 === 0 ? 'Identity 1' : 'Identity 2',
          account_email: isUnattr ? null : idx % 2 === 0 ? 'alpha@example.invalid' : 'beta@example.invalid',
          account_plan: isUnattr ? null : idx % 2 === 0 ? 'Max 20x' : 'Pro',
          account_current: !isUnattr && idx % 2 === 0,
          model: longM && idx === 0 ? longM : (idx % 2 === 0 ? 'claude-opus-4-6-20260205' : 'claude-sonnet-4-6'),
          effort: idx % 2 === 0 ? 'high' : 'medium',
          speed: idx % 2 === 0 ? 'fast' : 'standard',
          stop_reason: 'end_turn',
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_tokens: 200,
          cache_read_tokens: 1800,
          total_tokens: 2700,
          reasoning_tokens: null,
          estimated_cost_usd: 0.042,
          cache_savings_usd: 0.006,
          cache_hit_rate: 0.72,
          duration_ms: 1950,
          tps: 84.5,
          tool_count: 2,
          sidechain: idx % 5 === 0,
          source_kind: idx % 4 === 0 ? 'slot' : 'main',
          weak: false,
        };
      });
      if (args?.sortDir === 'asc') items.reverse();
      const pageSize = Math.min(100, Math.max(10, Number(args?.pageSize || 25)));
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      const page = Math.min(totalPages, Math.max(1, Number(args?.page || 1)));
      const start = (page - 1) * pageSize;
      return {
        generated_at: nowSec,
        tracking_since: nowSec - 86400,
        timezone: args?.timezone || null,
        total_count: items.length,
        page,
        page_size: pageSize,
        summary: {
          total_requests: items.length,
          total_tokens: items.length * 2700,
          input_tokens: items.length * 500,
          output_tokens: items.length * 200,
          cache_creation_tokens: items.length * 200,
          cache_read_tokens: items.length * 1800,
          total_cost_usd: items.length * 0.042,
          total_cache_savings_usd: items.length * 0.006,
          avg_cost_usd: 0.042,
          avg_tokens: 2700,
          timed_requests: items.length,
          avg_duration_ms: 1950,
          p95_duration_ms: 2400,
          avg_tps: 84.5,
          peak_tps: 96.0,
          overall_cache_hit_rate: 0.72,
        },
        items: items.slice(start, start + pageSize),
        available_accounts: [
          { id: hexId(1), name: 'Identity 1', email: 'alpha@example.invalid', plan: 'Max 20x', current: true, requests: 20 },
          { id: hexId(2), name: 'Identity 2', email: 'beta@example.invalid', plan: 'Pro', current: false, requests: 19 },
        ],
        available_models: longM ? [longM, 'claude-opus-4-6-20260205', 'claude-sonnet-4-6'] : ['claude-opus-4-6-20260205', 'claude-sonnet-4-6'],
        available_efforts: ['high', 'medium'],
        has_unattributed: true,
        unattributed_count: 1,
        warnings: [],
      };
    }

    function executeCommand(command, args) {
      if (Object.prototype.hasOwnProperty.call(commandErrors, command)) {
        throw commandErrors[command];
      }
      switch (command) {
        case 'plugin:app|version':
          return '0.4.5';
        case 'ui_language_read':
          return uiState.uiLanguage;
        case 'ui_language_write':
          uiState.uiLanguage = args?.language === 'en' ? 'en' : 'zh';
          uiState.browser.ui_language = uiState.uiLanguage;
          return null;
        case 'ui_privacy_read':
          return uiState.privacyMask;
        case 'ui_privacy_write':
          uiState.privacyMask = Boolean(args?.masked);
          return null;
        case 'ui_appearance_read':
          return uiState.appearance ? structuredClone(uiState.appearance) : null;
        case 'ui_appearance_write':
          uiState.appearance = args?.prefs ? structuredClone(args.prefs) : null;
          return null;
        case 'ui_wallpaper_read':
          return null;
        case 'ui_wallpaper_write':
        case 'ui_wallpaper_clear':
          return null;
        case 'copy_result':
          uiState.copied.push(String(args?.text ?? ''));
          return null;
        case 'identities_read':
          return structuredClone(uiState.identities);
        case 'identities_live_sessions':
          return {
            running: Boolean(uiState.identities.running),
            cli_running: Boolean(uiState.identities.cli_running),
            sessions: structuredClone(uiState.identities.sessions || []),
            slot_sessions: structuredClone(uiState.identities.slot_sessions || {}),
            background_only: Boolean(uiState.identities.background_only),
          };
        case 'identities_quota_revision':
          return String(uiState.quotaRevision);
        case 'identities_quota_batch_state':
          return null;
        case 'identities_wakeup_state':
          return structuredClone(uiState.wakeup);
        case 'identities_wakeup_migrate':
          uiState.wakeup.migrated = true;
          if (args?.migration?.config) uiState.wakeup.config = structuredClone(args.migration.config);
          return structuredClone(uiState.wakeup);
        case 'identities_wakeup_configure':
          if (args?.config) uiState.wakeup.config = structuredClone(args.config);
          return structuredClone(uiState.wakeup);
        case 'identities_orchestrator_state':
          return {
            schema: 1,
            config_persisted: true,
            cli_default_proxy: null,
            active: uiState.identities.active,
            config: structuredClone(uiState.orchestratorConfig),
          };
        case 'identities_orchestrator_configure':
          if (args?.config) uiState.orchestratorConfig = deepMerge(uiState.orchestratorConfig, args.config);
          return {
            schema: 1,
            config_persisted: true,
            cli_default_proxy: null,
            active: uiState.identities.active,
            config: structuredClone(uiState.orchestratorConfig),
          };
        case 'identities_orchestrator_clear_cooldown':
          return null;
        case 'identities_backup_location':
          return { app_data_dir: 'C:/synthetic/ai.local.claude-local', vault_available: true };
        case 'identities_backup_preview':
          return {
            valid: true,
            rescue_available: false,
            saved_identities: uiState.identities.records.length,
            archives: uiState.identities.records.length,
            estimated_bytes: 16384,
            recovery_pending: Boolean(uiState.identities.recovery),
            diagnostics: [],
          };
        case 'identities_backup_open_location':
          return null;
        case 'identities_set_subscription_expiry': {
          const isCur = !args?.accountId || args.accountId === 'current' || args.accountId === uiState.identities.active;
          const target = isCur ? uiState.identities.current : uiState.identities.summaries[args.accountId];
          if (!target) throw '身份不存在。';
          if (args?.expectedIdentity && target.quota_identity !== args.expectedIdentity) {
            throw 'quotaOnline.accountMismatch';
          }
          if (args?.manualPlan !== undefined) {
            target.manual_plan = args.manualPlan || null;
          }
          if (args?.expiryYmd || args?.rechargeYmd) {
            const exp = args.expiryYmd || args.rechargeYmd;
            const [yy, mm, dd] = String(exp).split('-').map(Number);
            const sec = Math.floor(Date.UTC(yy, mm - 1, dd, 12, 0, 0) / 1000);
            Object.assign(target, {
              billing_date: sec,
              billing_date_kind: 'next_renewal',
              billing_observed_at_ms: Date.now(),
              subscription_expiry_ymd: exp,
              subscription_recharge_ymd: args.rechargeYmd || null,
              subscription_date_source: 'manual',
              subscription_expires_at: sec,
            });
          }
          uiState.quotaRevision += 1;
          return structuredClone(uiState.identities);
        }
        case 'identities_sync_subscription': {
          const isCur = !args?.accountId || args.accountId === 'current' || args.accountId === uiState.identities.active;
          const target = isCur ? uiState.identities.current : uiState.identities.summaries[args.accountId];
          if (!target || !args?.expectedIdentity || target.quota_identity !== args.expectedIdentity) {
            throw 'quotaOnline.accountMismatch';
          }
          if (uiState.syncBehavior?.verifyResetSuccess) {
            target.quota_7d_used = uiState.syncBehavior.dropUsed7dTo ?? 12;
            if (uiState.syncBehavior.decrementResets && typeof target.manual_resets_remaining === 'number' && target.manual_resets_remaining > 0) {
              target.manual_resets_remaining -= 1;
            }
          } else {
            Object.assign(target, {
              billing_date_kind: 'next_renewal',
              billing_date: Math.floor(Date.now() / 1000) + 86400 * 21,
              billing_observed_at_ms: Date.now(),
              subscription_date_source: 'browser',
            });
          }
          uiState.quotaRevision += 1;
          return null;
        }
        case 'identities_stop':
          uiState.identities.running = false;
          uiState.identities.cli_running = false;
          uiState.identities.sessions = [];
          return { running: false };
        case 'quota_setup_status':
          return structuredClone(uiState.quotaSetupStatus);
        case 'browser_read':
          return structuredClone(uiState.browser);
        case 'browser_default_read':
          return { is_default: true, http: 'Claude-Local Browser', https: 'Claude-Local Browser', installed: true, app: 'Claude-Local Browser' };
        case 'browser_runtime_read':
          return {
            slot: uiState.identities.active_browser_slot || 'default',
            running: Boolean(uiState.browser.running),
            window_open: Boolean(uiState.browser.running),
          };
        case 'browser_kill_switch_state':
        case 'browser_kill_switch_dismiss':
          return { enabled: true, triggered: false, reason_code: null, expected_country: null, observed_country: null, triggered_at: null, closed_slots: [] };
        case 'browser_kill_switch_set_enabled':
          return { enabled: Boolean(args?.enabled), triggered: false, reason_code: null, expected_country: null, observed_country: null, triggered_at: null, closed_slots: [] };
        case 'browser_open_identity_profile':
          if (!args?.expectedIdentity) throw 'quotaOnline.accountMismatch';
          uiState.browser.running = true;
          return null;
        case 'browser_open_usage':
          if (!args?.expectedIdentity || args.expectedIdentity !== uiState.identities.current.quota_identity) {
            throw 'quotaOnline.accountMismatch';
          }
          uiState.browser.running = true;
          return structuredClone(uiState.browser);
        case 'claude_cli_read':
          return { method: 'native', path: 'C:/synthetic/claude.exe', version: '2.1.304', running: false };
        case 'claude_cli_check':
          return { current: { method: 'native', path: 'C:/synthetic/claude.exe', version: '2.1.304', running: false }, latest_version: '2.1.304', update_available: false };
        case 'claude_residue_scan':
          return { folder: '/synthetic', items: [], running: false, processes: [], message: 'OK', warnings: [], diagnostics: [], org_id: '' };
        case 'system_read':
          return structuredClone(uiState.system);
        case 'network_diagnose_domains':
          return ['claude.ai', 'api.anthropic.com', 'platform.claude.com', 'downloads.claude.ai'].map((domain) => ({
            domain, ok: true, status_code: 200, latency_ms: 28, ip: '203.0.113.10', message: '连接正常',
          }));
        case 'risk_inspect_local_env':
          return {
            browser: {
              proxy_configured: true, proxy_scheme: 'http', proxy_local_port: 17890,
              remote_dns_locked: true, target_country: 'US', target_timezone: 'America/Los_Angeles', target_language: 'en-US',
            },
            mihomo: {
              detected: true, client_kind: 'clash-verge-rev', mixed_port: 7897, allow_lan: false,
              tun_enabled: true, tun_strict_route: true, dns_enabled: true, dns_enhanced_mode: 'fake-ip',
              dns_respect_rules: true, dns_has_remote_doh: true, dns_has_domestic_plain: false,
              dns_has_nameserver_policy: true, has_claude_rules: true, has_persona_rules: true,
              has_sift_rules: true, has_telemetry_rules: true, has_quic_reject: true, has_geoip_cn: true,
              dedicated_listener_port: 17890,
            },
            system: {
              tun_adapter_active: true, secondary_plaintext_dns_active: false,
              lan_ipv4_candidates: ['192.168.10.20'], public_wan_detected: false,
            },
          };
        case 'risk_probe_consistency':
          return {
            claude: { domain: 'claude.ai', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 120, error: null },
            persona: { domain: 'withpersona.com', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 125, error: null },
            unlisted_dns: { domain: 'cloudflare-dns.com', ok: true, country: 'US', colo: 'LAX', ip: '198.51.100.24', latency_ms: 118, error: null },
            exit_isp: { ip: '198.51.100.24', country: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles', isp: 'Synthetic Residential Fiber', hosting: false },
            same_country: true, same_exit_ip: true, unlisted_same_country: true,
          };
        case 'usage_statistics_read':
          return buildUsageSnapshot(args);
        case 'usage_request_logs_read':
          return buildLogsSnapshot(args);
        case 'monitor_window_state':
          return structuredClone(uiState.monitor.window);
        case 'monitor_live_telemetry':
          return {
            window: structuredClone(uiState.monitor.window),
            running: Boolean(uiState.monitor.running),
            clientLabel: uiState.monitor.clientLabel,
            current: structuredClone(uiState.identities.current),
            metrics: structuredClone(uiState.monitor.metrics),
          };
        case 'monitor_window_set_always_on_top':
          uiState.monitor.window.alwaysOnTop = Boolean(args?.alwaysOnTop);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_locked':
          uiState.monitor.window.locked = Boolean(args?.locked);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_click_through':
          uiState.monitor.window.clickThrough = Boolean(args?.clickThrough);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_auto_hide':
          uiState.monitor.window.autoHide = Boolean(args?.autoHide);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_collapsed':
          uiState.monitor.window.collapsed = Boolean(args?.collapsed);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_compact':
          uiState.monitor.window.compact = Boolean(args?.compact);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_set_open':
          uiState.monitor.window.open = Boolean(args?.open);
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_snap_edge':
          uiState.monitor.window.dockedEdge = args?.edge ?? null;
          return structuredClone(uiState.monitor.window);
        case 'monitor_window_start_drag':
          return null;
        default:
          unhandledCommands.push(command);
          return null;
      }
    }

    window.__e2eHandleCommand = async (command, args) => {
      if (deferredCommands.has(command)) {
        return await new Promise((resolve, reject) => {
          pendingResolvers.push({ command, args, resolve, reject });
        });
      }
      return executeCommand(command, args);
    };
  `;
}

export interface SharedUiSession {
  sandbox: SandboxHandle;
  vite: ViteHarnessHandle;
  pinned: PinnedBrowserHandle;
}

const MAX_SHARED_UI_USES = 8;

interface SharedUiEntry {
  repoRoot: string;
  promise: Promise<SharedUiSession>;
  uses: number;
  activeContexts: number;
  retired: boolean;
}

let activeSharedEntry: SharedUiEntry | null = null;

async function disposeSharedEntry(entry: SharedUiEntry): Promise<void> {
  entry.retired = true;
  if (activeSharedEntry === entry) {
    activeSharedEntry = null;
  }
  const session = await entry.promise.catch(() => null);
  if (session) {
    await session.sandbox.cleanup().catch(() => {});
  }
}

function isTransientHarnessNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ERR_NO_BUFFER_SPACE|WSAENOBUFS|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Target page, context or browser has been closed|Browser has been closed/i.test(
    msg,
  );
}

function createSharedUiEntry(repoRoot: string): SharedUiEntry {
  let entry!: SharedUiEntry;
  const promise = (async (): Promise<SharedUiSession> => {
    let sandbox: SandboxHandle | null = null;
    try {
      sandbox = await createSandbox('perf-ui-shared');
      const setupScript = buildUiMockSetupScript();
      const appHtml = buildMockIpcShellHtml({
        entryModule: '/src/main.tsx',
        title: 'Claude-Local',
        windowLabel: 'main',
        setupScript,
      });
      const monitorHtml = buildMockIpcShellHtml({
        entryModule: '/src/main.tsx',
        title: 'Claude-Local Monitor',
        windowLabel: 'monitor',
        setupScript,
      });
      const vite = await startViteServer({
        repoRoot,
        sandbox,
        virtualPages: {
          '/__e2e-app.html': appHtml,
          '/__e2e-monitor.html': monitorHtml,
        },
      });
      const pinned = await launchPinnedChrome({
        repoRoot,
        sandbox,
        headless: true,
        args: ['--disable-gpu'],
      });
      return { sandbox, vite, pinned };
    } catch (err) {
      entry.retired = true;
      if (activeSharedEntry === entry) {
        activeSharedEntry = null;
      }
      await sandbox?.cleanup().catch(() => {});
      throw err;
    }
  })();

  entry = {
    repoRoot,
    promise,
    uses: 0,
    activeContexts: 0,
    retired: false,
  };
  return entry;
}

async function acquireSharedUiEntry(repoRoot: string): Promise<SharedUiEntry> {
  if (
    activeSharedEntry &&
    (activeSharedEntry.repoRoot !== repoRoot ||
      activeSharedEntry.retired ||
      activeSharedEntry.uses >= MAX_SHARED_UI_USES)
  ) {
    const stale = activeSharedEntry;
    stale.retired = true;
    activeSharedEntry = null;
    if (stale.activeContexts === 0) {
      await disposeSharedEntry(stale);
    }
  }
  if (!activeSharedEntry) {
    activeSharedEntry = createSharedUiEntry(repoRoot);
  }
  return activeSharedEntry;
}

export async function getSharedUiSession(repoRoot: string): Promise<SharedUiSession> {
  const entry = await acquireSharedUiEntry(repoRoot);
  return await entry.promise;
}

export async function resetSharedUiSession(): Promise<void> {
  const stale = activeSharedEntry;
  if (!stale) return;
  stale.retired = true;
  activeSharedEntry = null;
  if (stale.activeContexts === 0) {
    await disposeSharedEntry(stale);
  }
}

export interface OpenedUiPageHandle {
  context: BrowserContext;
  page: Page;
  errors: string[];
  pageErrors: string[];
  consoleErrors: string[];
  abortedUrls: string[];
  getIpcCommands: () => Promise<MockIpcCommandRecord[]>;
  clearIpc: () => Promise<void>;
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  getUnhandledCommands: () => Promise<string[]>;
  close: () => Promise<void>;
}

export async function openAppWithMockUi(options: {
  repoRoot: string;
  seed?: UiMockSeed;
  monitorWindow?: boolean;
  contextOptions?: Omit<IsolatedContextOptions, 'allowedUrlPrefixes'>;
}): Promise<OpenedUiPageHandle> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const entry = await acquireSharedUiEntry(options.repoRoot);
    entry.uses += 1;
    entry.activeContexts += 1;

    let isolated: IsolatedContextHandle | null = null;
    try {
      const session = await entry.promise;
      isolated = await session.pinned.newIsolatedContext({
        viewport: options.contextOptions?.viewport ?? { width: 1040, height: 820 },
        locale: options.contextOptions?.locale,
        timezoneId: options.contextOptions?.timezoneId ?? 'America/New_York',
        reducedMotion: options.contextOptions?.reducedMotion ?? 'reduce',
        ignoreHTTPSErrors: options.contextOptions?.ignoreHTTPSErrors ?? true,
        allowedUrlPrefixes: [`${session.vite.baseUrl}/`],
        routeHandler: options.contextOptions?.routeHandler,
      });

      if (options.seed) {
        await isolated.context.addInitScript((seedData: UiMockSeed) => {
          (window as unknown as { __e2eSeed?: UiMockSeed }).__e2eSeed = seedData;
        }, options.seed);
      }

      const targetUrl = options.monitorWindow
        ? `${session.vite.baseUrl}/__e2e-monitor.html?window=monitor`
        : `${session.vite.baseUrl}/__e2e-app.html`;

      const opened = await openMockedAppPage({
        context: isolated.context,
        url: targetUrl,
        timeoutMs: 12_000,
      });

      let handleClosed = false;
      const isoHandle = isolated;
      return {
        context: isoHandle.context,
        page: opened.page,
        errors: opened.errors,
        pageErrors: opened.pageErrors,
        consoleErrors: opened.consoleErrors,
        abortedUrls: isoHandle.abortedUrls,
        getIpcCommands: () => getIpcCommands(opened.page),
        clearIpc: () => clearIpcLog(opened.page),
        emitEvent: (event, payload) => emitTauriEvent(opened.page, event, payload),
        getUnhandledCommands: () =>
          opened.page.evaluate(() => {
            const list = (window as unknown as { __e2eUi?: { unhandledCommands?: string[] } })
              .__e2eUi?.unhandledCommands;
            return Array.isArray(list) ? [...list] : [];
          }),
        close: async () => {
          if (handleClosed) return;
          handleClosed = true;
          try {
            await isoHandle.close();
          } finally {
            entry.activeContexts = Math.max(0, entry.activeContexts - 1);
            if (entry.retired && entry.activeContexts === 0) {
              await disposeSharedEntry(entry);
            }
          }
        },
      };
    } catch (err) {
      await isolated?.close().catch(() => {});
      entry.activeContexts = Math.max(0, entry.activeContexts - 1);
      if (attempt === 0 && isTransientHarnessNetworkError(err)) {
        entry.retired = true;
        if (activeSharedEntry === entry) {
          activeSharedEntry = null;
        }
        if (entry.activeContexts === 0) {
          await disposeSharedEntry(entry);
        }
        continue;
      }
      if (entry.retired && entry.activeContexts === 0) {
        await disposeSharedEntry(entry);
      }
      throw err;
    }
  }

  throw new Error('openAppWithMockUi exhausted retry attempts');
}

// =========================================================================
// E2E-06 Offline/Sandboxed i18n, YAML, TS AST, and Rust Error Key Validators
// =========================================================================

export interface I18nValidationResult {
  ok: boolean;
  errors: string[];
  zhCount: number;
  enCount: number;
  rustKeyCount: number;
  tsCallCount: number;
}

export function extractTemplateSlots(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

export function findDuplicateTopLevelYamlKeys(rawYaml: string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const line of rawYaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^("([^"]+)"|([a-zA-Z0-9_.-]+)):/);
    if (match) {
      const key = match[2] !== undefined ? match[2] : match[3];
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
  }
  return dupes;
}

export function collectFilesRecursive(dir: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFilesRecursive(full, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function validateCatalogPair(zhRaw: string, enRaw: string): {
  errors: string[];
  zh: Record<string, string>;
  en: Record<string, string>;
} {
  const errors: string[] = [];

  for (const [label, raw] of [
    ['zh.yaml', zhRaw],
    ['en.yaml', enRaw],
  ] as const) {
    const dupes = findDuplicateTopLevelYamlKeys(raw);
    if (dupes.length > 0) {
      errors.push(`${label} duplicate top-level keys: ${dupes.join(', ')}`);
    }
  }

  let zh: Record<string, string> = {};
  let en: Record<string, string> = {};
  try {
    zh = (parseYaml(zhRaw) ?? {}) as Record<string, string>;
  } catch (err) {
    errors.push(`zh.yaml parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    en = (parseYaml(enRaw) ?? {}) as Record<string, string>;
  } catch (err) {
    errors.push(`en.yaml parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (errors.length > 0) {
    return { errors, zh, en };
  }

  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  const missingInEn = zhKeys.filter((k) => !Object.hasOwn(en, k));
  const extraInEn = enKeys.filter((k) => !Object.hasOwn(zh, k));
  if (missingInEn.length > 0) {
    errors.push(`Missing keys in en.yaml: ${missingInEn.slice(0, 10).join(', ')}`);
  }
  if (extraInEn.length > 0) {
    errors.push(`Extra keys in en.yaml: ${extraInEn.slice(0, 10).join(', ')}`);
  }

  for (const key of zhKeys) {
    if (!Object.hasOwn(en, key)) continue;
    const enVal = en[key];
    const zhVal = zh[key];
    if (typeof enVal !== 'string' || enVal.length === 0) {
      errors.push(`Empty or non-string en.yaml value for key: ${key}`);
      continue;
    }
    if (typeof zhVal !== 'string' || zhVal.length === 0) {
      errors.push(`Empty or non-string zh.yaml value for key: ${key}`);
      continue;
    }
    const zhSlots = extractTemplateSlots(zhVal);
    const enSlots = extractTemplateSlots(enVal);
    if (JSON.stringify(zhSlots) !== JSON.stringify(enSlots)) {
      errors.push(`Slot mismatch for key "${key}": zh=[${zhSlots.join(',')}] vs en=[${enSlots.join(',')}]`);
    }
    const sanitizedEn = enVal.replaceAll('Claude-Local Browser.app', '');
    if (/[\u3400-\u9fff]/.test(sanitizedEn)) {
      errors.push(`Unexpected CJK in en.yaml value for key "${key}": ${enVal}`);
    }
  }

  return { errors, zh, en };
}

export function scanTsI18nAndJsxCjk(
  srcDir: string,
  zh: Record<string, string>,
): { errors: string[]; callCount: number } {
  const errors: string[] = [];
  let callCount = 0;

  const walkDir = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'locales') continue;
        walkDir(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.includes('.test.') &&
        !entry.name.endsWith('.d.ts') &&
        entry.name !== 'i18n.ts'
      ) {
        const source = readFileSync(full, 'utf8');
        const sf = ts.createSourceFile(
          full,
          source,
          ts.ScriptTarget.Latest,
          true,
          entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node)) {
            const exp = node.expression.getText(sf);
            if ((exp === 't' || exp === 'tRef.current') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
              callCount += 1;
              const key = node.arguments[0].text;
              if (!Object.hasOwn(zh, key)) {
                errors.push(`Missing YAML key "${key}" referenced in ${full}`);
              }
            }
          }
          if (ts.isJsxText(node) && /[\u3400-\u9fff]/.test(node.text)) {
            errors.push(`Hardcoded CJK JSX text in ${full}: ${node.text.trim()}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    }
  };
  walkDir(srcDir);
  return { errors, callCount };
}

export function scanRustNativeErrorKeys(
  rustSrcDir: string,
  zh: Record<string, string>,
  en: Record<string, string>,
): { errors: string[]; keys: string[] } {
  const errors: string[] = [];
  const rsFiles = collectFilesRecursive(rustSrcDir, (n) => n.endsWith('.rs'));
  const keySet = new Set<string>();
  for (const file of rsFiles) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/"((?:quotaOnline|relay\.error|browser\.error)\.[A-Za-z0-9_.]+)"/g)) {
      keySet.add(match[1]);
    }
  }
  const keys = [...keySet].sort();
  for (const key of keys) {
    if (!Object.hasOwn(zh, key)) {
      errors.push(`Rust native error key missing in zh.yaml: ${key}`);
    }
    if (!Object.hasOwn(en, key)) {
      errors.push(`Rust native error key missing in en.yaml: ${key}`);
    } else if (/\{\w+\}/.test(en[key]) || /\{\w+\}/.test(zh[key] ?? '')) {
      errors.push(`Rust native error key contains unsubstituted placeholder without args: ${key}`);
    }
  }
  return { errors, keys };
}

export function validateSandboxedI18nWorkspace(options: {
  zhRaw: string;
  enRaw: string;
  tsSrcDir?: string;
  rustSrcDir?: string;
}): I18nValidationResult {
  const { errors, zh, en } = validateCatalogPair(options.zhRaw, options.enRaw);
  let tsCallCount = 0;
  let rustKeyCount = 0;
  if (options.tsSrcDir) {
    const tsScan = scanTsI18nAndJsxCjk(options.tsSrcDir, zh);
    errors.push(...tsScan.errors);
    tsCallCount = tsScan.callCount;
  }
  if (options.rustSrcDir) {
    const rsScan = scanRustNativeErrorKeys(options.rustSrcDir, zh, en);
    errors.push(...rsScan.errors);
    rustKeyCount = rsScan.keys.length;
  }
  return {
    ok: errors.length === 0,
    errors,
    zhCount: Object.keys(zh).length,
    enCount: Object.keys(en).length,
    rustKeyCount,
    tsCallCount,
  };
}

export function resolveRepoSrcPath(repoRoot: string, ...parts: string[]): string {
  return resolve(repoRoot, ...parts);
}
