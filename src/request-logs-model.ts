/**
 * [INPUT]: Redacted native per-request log snapshots from `usage_request_logs_read`, locale and privacy preferences.
 * [OUTPUT]: Typed per-request telemetry contract, duration/TPS/precise-USD/timestamp formatters, TPS tier classification, compact model display labels, and privacy-safe formula-neutralized TSV/JSON exporters.
 * [POS]: Pure presentation and export helpers for the Request Logs page; zero native I/O, credentials or network access.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import type {UsagePeriod} from './usage-model';
import {maskDisplayName, maskEmailAddress} from './settings-model';

export type RequestLogSortField = 'time' | 'tokens' | 'output' | 'cost' | 'tps' | 'duration' | 'cache_hit';
export type RequestLogSourceFilter = 'all' | 'main' | 'subagent' | 'slot';
export type RequestLogTimezonePref = 'system' | 'Asia/Shanghai' | 'America/New_York' | 'UTC';

export type RequestLogEntry = {
  id: string;
  event_key: string;
  session_key?: string | null;
  ts: number;
  ts_ms: number;
  ts_precise?: boolean;
  account_id?: string | null;
  account_name?: string | null;
  account_email?: string | null;
  account_plan?: string | null;
  account_current: boolean;
  model: string;
  effort: string;
  speed: string;
  stop_reason: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number | null;
  estimated_cost_usd: number;
  cache_savings_usd: number;
  cache_hit_rate?: number | null;
  duration_ms?: number | null;
  tps?: number | null;
  tool_count: number;
  sidechain: boolean;
  source_kind: string;
  weak: boolean;
};

export type RequestLogsSummary = {
  total_requests: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  total_cache_savings_usd: number;
  avg_cost_usd?: number | null;
  avg_tokens?: number | null;
  timed_requests: number;
  avg_duration_ms?: number | null;
  p95_duration_ms?: number | null;
  avg_tps?: number | null;
  peak_tps?: number | null;
  overall_cache_hit_rate?: number | null;
};

export type RequestLogsAccountOption = {
  id: string;
  name: string;
  email?: string | null;
  plan?: string | null;
  current: boolean;
  requests: number;
};

export type RequestLogsSnapshot = {
  generated_at: number;
  tracking_since?: number | null;
  timezone?: string | null;
  total_count: number;
  page: number;
  page_size: number;
  summary: RequestLogsSummary;
  items: RequestLogEntry[];
  available_accounts: RequestLogsAccountOption[];
  available_models: string[];
  available_efforts: string[];
  has_unattributed: boolean;
  unattributed_count?: number;
  warnings: string[];
};

export type RequestLogsQueryState = {
  period: UsagePeriod;
  accountId: string;
  model: string;
  effort: string;
  sourceFilter: RequestLogSourceFilter;
  sessionKey: string;
  search: string;
  sortBy: RequestLogSortField;
  sortDir: 'desc' | 'asc';
  page: number;
  pageSize: number;
};

export type TpsTier = 'fast' | 'normal' | 'slow' | 'none';

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function formatTps(tps: number | null | undefined, includeUnit = true): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return '—';
  const rounded = tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
  return includeUnit ? `${rounded} tok/s` : rounded;
}

export function classifyTpsTier(tps: number | null | undefined): TpsTier {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return 'none';
  if (tps >= 60) return 'fast';
  if (tps >= 25) return 'normal';
  return 'slow';
}

export function resolveSpeedCostMultiplier(model: string, speed?: string | null): number {
  const m = (model || '').toLowerCase();
  const sp = (speed || '').trim().toLowerCase();
  if (sp === 'ultrafast' && (m.includes('fable-5-2') || m.includes('fable-5.2'))) return 4;
  if (sp === 'fast') {
    if (
      m.includes('fable-5-2') ||
      m.includes('fable-5.2') ||
      m.includes('opus-4-8') ||
      m.includes('opus-4.8') ||
      m.includes('opus-5')
    ) {
      return 2;
    }
    if (
      m.includes('opus-4-6') ||
      m.includes('opus-4.6') ||
      m.includes('opus-4-7') ||
      m.includes('opus-4.7')
    ) {
      return 6;
    }
  }
  return 1;
}

/**
 * Formats per-request API-equivalent USD cost without collapsing sub-cent turns to `$0.00`.
 */
export function formatPreciseUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${new Intl.NumberFormat('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2}).format(usd)}`;
}

export function shortHash(hash: string | null | undefined, length = 8): string {
  if (!hash || typeof hash !== 'string') return '—';
  const clean = hash.trim();
  if (!clean) return '—';
  return `#${clean.slice(0, Math.max(4, length))}`;
}

/**
 * Strips the verbose `claude-` prefix and trailing 8-digit release date for dense table display.
 */
export function compactModelLabel(model: string): string {
  const trimmed = (model || '').trim();
  if (!trimmed || trimmed === 'unknown') return trimmed || 'unknown';
  return trimmed
    .replace(/^claude-/i, '')
    .replace(/-\d{8}$/, '');
}

const LOGS_TZ_STORAGE_KEY = 'claude-local:logs-timezone';
const ALLOWED_TZ_PREFS: readonly RequestLogTimezonePref[] = ['system', 'Asia/Shanghai', 'America/New_York', 'UTC'];

export function readLogsTimezonePref(): RequestLogTimezonePref {
  try {
    const raw = window.localStorage.getItem(LOGS_TZ_STORAGE_KEY);
    if (raw && (ALLOWED_TZ_PREFS as readonly string[]).includes(raw)) {
      return raw as RequestLogTimezonePref;
    }
  } catch {
    // ignore storage errors
  }
  return 'system';
}

export function writeLogsTimezonePref(pref: RequestLogTimezonePref): void {
  try {
    window.localStorage.setItem(LOGS_TZ_STORAGE_KEY, pref);
  } catch {
    // ignore storage errors
  }
}

export function formatTimezoneBadge(timezone: string | null | undefined, tsMs?: number): string {
  const tz = (timezone || '').trim();
  const sample = new Date(tsMs && Number.isFinite(tsMs) && tsMs > 0 ? tsMs : Date.now());
  try {
    const shortNameParts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
      ...(tz ? {timeZone: tz} : {}),
    }).formatToParts(sample);
    const shortOffsetParts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'shortOffset',
      ...(tz ? {timeZone: tz} : {}),
    }).formatToParts(sample);
    const shortName = shortNameParts.find(p => p.type === 'timeZoneName')?.value ?? '';
    const rawOffset = (shortOffsetParts.find(p => p.type === 'timeZoneName')?.value ?? '').replace(/^GMT/, 'UTC');
    if (tz === 'UTC' || shortName === 'UTC') return 'UTC';
    if (tz === 'Asia/Shanghai') return 'UTC+8';
    if (shortName && rawOffset && shortName !== rawOffset && !shortName.startsWith('GMT') && !shortName.startsWith('UTC')) {
      return `${shortName} (${rawOffset})`;
    }
    return rawOffset || shortName || tz || 'Local';
  } catch {
    return tz || 'Local';
  }
}

export type PaginationToken = number | 'ellipsis';

export function buildPaginationRange(currentPage: number, totalPages: number): PaginationToken[] {
  const total = Math.max(1, Math.trunc(totalPages));
  const current = Math.min(Math.max(1, Math.trunc(currentPage)), total);
  if (total <= 7) {
    return Array.from({length: total}, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', total];
  }
  if (current >= total - 3) {
    return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
}

export function formatLogTimeShort(
  tsMs: number,
  locale: 'zh' | 'en',
  timezone?: string | null,
  referenceYear?: number | null,
): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '—';
  try {
    const dt = new Date(tsMs);
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      ...(timezone ? {timeZone: timezone} : {}),
    };
    const parts = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', opts).formatToParts(dt);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const yearStr = get('year');
    const showYear = referenceYear != null && yearStr !== '' && Number(yearStr) !== referenceYear;
    const prefix = showYear ? `${yearStr}-` : '';
    return `${prefix}${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return new Date(tsMs).toISOString().slice(5, 19).replace('T', ' ');
  }
}

export function formatLogTimeFull(
  tsMs: number,
  locale: 'zh' | 'en',
  timezone?: string | null,
  includeMs = true,
): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '—';
  const msPart = String(Math.abs(Math.trunc(tsMs)) % 1000).padStart(3, '0');
  try {
    const dt = new Date(tsMs);
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      ...(timezone ? {timeZone: timezone} : {}),
    };
    const parts = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', opts).formatToParts(dt);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const base = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    return includeMs ? `${base}.${msPart}` : base;
  } catch {
    return new Date(tsMs).toISOString();
  }
}

function escapeTsvCell(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  let text = String(raw);
  // Neutralize spreadsheet formula prefixes (=, +, -, @, leading tab/CR)
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[\t\r\n"]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildRequestLogsTsv(
  items: readonly RequestLogEntry[],
  options: {privacyMask: boolean; locale: 'zh' | 'en'; timezone?: string | null},
): string {
  const header = [
    'timestamp',
    'request_hash',
    'session_hash',
    'account',
    'plan',
    'source',
    'model',
    'effort',
    'speed',
    'stop_reason',
    'tool_calls',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'cache_write_tokens',
    'cache_read_tokens',
    'cache_hit_pct',
    'duration_ms',
    'output_tps',
    'estimated_cost_usd',
    'cache_savings_usd',
  ];
  const lines = [header.join('\t')];
  for (const row of items) {
    const accountLabel = row.account_name
      ? maskDisplayName(row.account_name, row.account_email ?? null, options.privacyMask)
      : 'unattributed';
    const sourceLabel =
      row.source_kind === 'slot'
        ? row.sidechain
          ? 'slot+subagent'
          : 'slot'
        : row.sidechain
          ? 'subagent'
          : 'main';
    lines.push(
      [
        formatLogTimeFull(row.ts_ms, options.locale, options.timezone, row.ts_precise !== false),
        row.event_key.slice(0, 12),
        row.session_key ? row.session_key.slice(0, 12) : '',
        accountLabel,
        row.account_plan ?? '',
        sourceLabel,
        row.model,
        row.effort,
        row.speed,
        row.stop_reason,
        row.tool_count,
        row.total_tokens,
        row.input_tokens,
        row.output_tokens,
        row.cache_creation_tokens,
        row.cache_read_tokens,
        row.cache_hit_rate != null ? (row.cache_hit_rate * 100).toFixed(1) : '',
        row.duration_ms ?? '',
        row.tps != null ? row.tps.toFixed(1) : '',
        row.estimated_cost_usd.toFixed(6),
        row.cache_savings_usd.toFixed(6),
      ]
        .map(escapeTsvCell)
        .join('\t'),
    );
  }
  return lines.join('\n');
}

export function buildRequestLogsJson(
  items: readonly RequestLogEntry[],
  options: {privacyMask: boolean},
): string {
  const sanitized = items.map(row => ({
    id: row.id,
    session: row.session_key ? row.session_key.slice(0, 12) : null,
    timestamp_ms: row.ts_ms,
    account: row.account_name
      ? maskDisplayName(row.account_name, row.account_email ?? null, options.privacyMask)
      : null,
    account_email:
      row.account_email && !options.privacyMask
        ? row.account_email
        : row.account_email
          ? maskEmailAddress(row.account_email, true)
          : null,
    plan: row.account_plan ?? null,
    source:
      row.source_kind === 'slot'
        ? row.sidechain
          ? 'slot+subagent'
          : 'slot'
        : row.sidechain
          ? 'subagent'
          : 'main',
    model: row.model,
    effort: row.effort || null,
    speed: row.speed || null,
    stop_reason: row.stop_reason || null,
    tool_count: row.tool_count,
    tokens: {
      total: row.total_tokens,
      input: row.input_tokens,
      output: row.output_tokens,
      cache_write: row.cache_creation_tokens,
      cache_read: row.cache_read_tokens,
      reasoning: row.reasoning_tokens ?? null,
    },
    cache_hit_rate: row.cache_hit_rate ?? null,
    duration_ms: row.duration_ms ?? null,
    output_tps: row.tps ?? null,
    estimated_cost_usd: Number(row.estimated_cost_usd.toFixed(6)),
    cache_savings_usd: Number(row.cache_savings_usd.toFixed(6)),
  }));
  return JSON.stringify(sanitized, null, 2);
}
