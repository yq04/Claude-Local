/**
 * [INPUT]: Synthetic per-request log entries, edge-case numeric values and privacy-mask flags.
 * [OUTPUT]: Offline unit regressions for duration/TPS/precise-USD/timestamp formatting, model label compaction, TPS tiering and sanitized TSV/JSON exports.
 * [POS]: Unit test suite for request-logs-model; zero native calls or user files.
 * [PROTOCOL]: Keep all fixtures synthetic.
 */
import {describe, expect, test} from 'bun:test';
import {
  buildPaginationRange,
  buildRequestLogsJson,
  buildRequestLogsTsv,
  classifyTpsTier,
  compactModelLabel,
  formatDurationMs,
  formatLogTimeFull,
  formatLogTimeShort,
  formatPreciseUsd,
  formatTimezoneBadge,
  formatTps,
  resolveSpeedCostMultiplier,
  shortHash,
  type RequestLogEntry,
} from './request-logs-model';

const sampleEntry = (overrides: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
  id: 'a1b2c3d4e5f6',
  event_key: 'a1b2c3d4e5f60000111122223333444455556666777788889999aaaabbbbcccc',
  session_key: '99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa',
  ts: 1_761_386_402,
  ts_ms: 1_761_386_402_500,
  account_id: '0123456789abcdef0123456789abcdef',
  account_name: '=Alice',
  account_email: 'alice@example.invalid',
  account_plan: 'Pro',
  account_current: true,
  model: 'claude-opus-4-6-20260205',
  effort: 'high',
  speed: 'fast',
  stop_reason: 'tool_use',
  input_tokens: 500,
  output_tokens: 200,
  cache_creation_tokens: 200,
  cache_read_tokens: 1800,
  total_tokens: 2700,
  reasoning_tokens: null,
  estimated_cost_usd: 0.054321,
  cache_savings_usd: 0.0081,
  cache_hit_rate: 0.72,
  duration_ms: 2500,
  tps: 80.0,
  tool_count: 2,
  sidechain: false,
  source_kind: 'main',
  weak: false,
  ...overrides,
});

describe('request-logs-model', () => {
  test('formats durations cleanly across ms, s, minutes and invalid values', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(undefined)).toBe('—');
    expect(formatDurationMs(-5)).toBe('—');
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(420)).toBe('420 ms');
    expect(formatDurationMs(2540)).toBe('2.54 s');
    expect(formatDurationMs(14_820)).toBe('14.8 s');
    expect(formatDurationMs(75_000)).toBe('1m 15s');
  });

  test('formats TPS and classifies visual speed tiers accurately', () => {
    expect(formatTps(null)).toBe('—');
    expect(formatTps(0)).toBe('—');
    expect(formatTps(18.44)).toBe('18.4 tok/s');
    expect(formatTps(128.6)).toBe('129 tok/s');
    expect(formatTps(64.2, false)).toBe('64.2');

    expect(classifyTpsTier(null)).toBe('none');
    expect(classifyTpsTier(0)).toBe('none');
    expect(classifyTpsTier(19.9)).toBe('slow');
    expect(classifyTpsTier(25)).toBe('normal');
    expect(classifyTpsTier(59.9)).toBe('normal');
    expect(classifyTpsTier(60)).toBe('fast');
  });

  test('formats precise micro-dollar costs without collapsing sub-cent turns', () => {
    expect(formatPreciseUsd(null)).toBe('—');
    expect(formatPreciseUsd(-1)).toBe('—');
    expect(formatPreciseUsd(0)).toBe('$0.00');
    expect(formatPreciseUsd(0.00004)).toBe('<$0.0001');
    expect(formatPreciseUsd(0.0042)).toBe('$0.0042');
    expect(formatPreciseUsd(0.0825)).toBe('$0.083');
    expect(formatPreciseUsd(2.456)).toBe('$2.46');
    expect(formatPreciseUsd(1234.5)).toBe('$1,234.50');
    expect(resolveSpeedCostMultiplier('claude-opus-4-6', 'fast')).toBe(6);
    expect(resolveSpeedCostMultiplier('claude-opus-5-5', 'fast')).toBe(2);
    expect(resolveSpeedCostMultiplier('claude-fable-5-2', 'ultrafast')).toBe(4);
    expect(resolveSpeedCostMultiplier('claude-sonnet-4-6', 'fast')).toBe(1);
    expect(resolveSpeedCostMultiplier('claude-opus-4-6', 'standard')).toBe(1);
  });

  test('compacts model labels and formats hashes & timestamps safely', () => {
    expect(compactModelLabel('claude-opus-4-6-20260205')).toBe('opus-4-6');
    expect(compactModelLabel('claude-sonnet-4-6')).toBe('sonnet-4-6');
    expect(compactModelLabel('unknown')).toBe('unknown');
    expect(shortHash('abcdef1234567890')).toBe('#abcdef12');
    expect(shortHash(null)).toBe('—');

    expect(formatLogTimeShort(1_761_386_402_500, 'en', 'UTC')).toBe('10-25 10:00:02');
    expect(formatLogTimeShort(1_761_386_402_500, 'en', 'UTC', 2026)).toBe('2025-10-25 10:00:02');
    expect(formatLogTimeShort(1_761_386_402_500, 'en', 'UTC', 2025)).toBe('10-25 10:00:02');
    // Midnight must always format as 00:xx:xx (h23), never 24:xx:xx
    expect(formatLogTimeShort(Date.UTC(2026, 10, 2, 5, 22, 33), 'en', 'America/New_York')).toBe('11-02 00:22:33');
    expect(formatLogTimeFull(1_761_386_402_500, 'en', 'UTC')).toBe('2025-10-25 10:00:02.500');
    expect(formatLogTimeFull(1_761_386_402_500, 'en', 'UTC', false)).toBe('2025-10-25 10:00:02');
    expect(formatLogTimeShort(0, 'zh', 'UTC')).toBe('—');

    expect(formatTimezoneBadge('UTC')).toBe('UTC');
    expect(formatTimezoneBadge('Asia/Shanghai')).toBe('UTC+8');
    expect(formatTimezoneBadge('America/New_York', Date.UTC(2026, 9, 25, 14, 0, 0))).toBe('EDT (UTC-4)');
    expect(formatTimezoneBadge('America/New_York', Date.UTC(2026, 10, 25, 8, 0, 0))).toBe('EST (UTC-5)');

    expect(buildPaginationRange(1, 1)).toEqual([1]);
    expect(buildPaginationRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPaginationRange(1, 2315)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 2315]);
    expect(buildPaginationRange(50, 2315)).toEqual([1, 'ellipsis', 49, 50, 51, 'ellipsis', 2315]);
    expect(buildPaginationRange(2315, 2315)).toEqual([1, 'ellipsis', 2311, 2312, 2313, 2314, 2315]);
  });

  test('TSV export neutralizes formula prefixes and honors privacyMask', () => {
    const tsvUnmasked = buildRequestLogsTsv([sampleEntry()], {
      privacyMask: false,
      locale: 'en',
      timezone: 'UTC',
    });
    const rowsUnmasked = tsvUnmasked.split('\n');
    expect(rowsUnmasked.length).toBe(2);
    expect(rowsUnmasked[1]).toContain("'=Alice");
    expect(rowsUnmasked[1]).toContain('80.0');
    expect(rowsUnmasked[1]).toContain('0.054321');

    const tsvMasked = buildRequestLogsTsv([sampleEntry({account_name: 'alice@example.invalid'})], {
      privacyMask: true,
      locale: 'zh',
      timezone: 'UTC',
    });
    expect(tsvMasked).not.toContain('alice@example.invalid');
  });

  test('JSON export masks account identity when privacyMask is true and keeps telemetry intact', () => {
    const raw = buildRequestLogsJson(
      [
        sampleEntry({account_name: 'Alice Dev', account_email: 'alice@example.invalid'}),
        sampleEntry({id: 'slot-sub-1', source_kind: 'slot', sidechain: true}),
      ],
      {privacyMask: true},
    );
    expect(raw).not.toContain('alice@example.invalid');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].output_tps).toBe(80);
    expect(parsed[0].duration_ms).toBe(2500);
    expect(parsed[0].tool_count).toBe(2);
    expect(parsed[1].source).toBe('slot+subagent');
  });
});
