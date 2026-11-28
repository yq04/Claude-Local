/**
 * [INPUT]: Native per-request telemetry from `usage_request_logs_read`, shared locale, privacy preferences and optional account focus callback.
 * [OUTPUT]: Searchable, filterable, sortable and paginated Request Logs workspace (`RequestLogsPanel`) with filtered KPI strip (requests, API-equivalent USD cost, weighted output TPS, avg/P95 duration & cache hit), right-aligned numeric tabular log list (including TPS column alignment), click-to-inspect Request Inspector modal (with one-click session isolation & account card jump) and TSV/JSON export.
 * [POS]: Local per-request observability page; sequential 30-second visible-page refresh, zero raw prompts/paths/credentials or network requests.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {type FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {DropdownMenu} from 'radix-ui';
import {Button, Disclosure, Select, Tabs} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {useI18n} from './i18n';
import {usePageRefresh} from './app-events';
import {AppDialog} from './dialog';
import {maskDisplayName, maskEmailAddress, usePreferences} from './settings-model';
import {normalizePlanSlug} from './smart-relay-model';
import {
  detectModelFamily,
  estimateTotalsCostUsd,
  formatUsageNumber,
  formatUsdCost,
  tokenComposition,
  type UsagePeriod,
  type UsageTotals,
} from './usage-model';
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
  readLogsTimezonePref,
  resolveSpeedCostMultiplier,
  shortHash,
  writeLogsTimezonePref,
  type RequestLogEntry,
  type RequestLogSortField,
  type RequestLogSourceFilter,
  type RequestLogsSnapshot,
  type RequestLogTimezonePref,
} from './request-logs-model';

const PERIODS: readonly [UsagePeriod, string][] = [
  ['today', 'usage.today'],
  ['yesterday', 'usage.yesterday'],
  ['week', 'usage.week'],
  ['month', 'usage.month'],
  ['all', 'usage.allTime'],
];

const PAGE_SIZES = [25, 50, 100] as const;

const WARNING_KEYS: Record<string, string> = {
  partial_scan: 'usage.warning.partial',
  invalid_records: 'usage.warning.invalid',
  weak_ids: 'usage.warning.weak',
};

const logsSnapshotCache = new Map<string, RequestLogsSnapshot>();
const LOGS_CACHE_LIMIT = 16;
function rememberLogsSnapshot(key: string, value: RequestLogsSnapshot) {
  if (!logsSnapshotCache.has(key) && logsSnapshotCache.size >= LOGS_CACHE_LIMIT) {
    const oldest = logsSnapshotCache.keys().next().value;
    if (oldest !== undefined) logsSnapshotCache.delete(oldest);
  }
  logsSnapshotCache.delete(key);
  logsSnapshotCache.set(key, value);
}

function KpiGlyph({kind}: {kind: 'requests' | 'cost' | 'tps' | 'latency'}) {
  return (
    <span className="logs-kpi-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'requests' ? (
          <>
            <path d="M4 6h16M4 12h16M4 18h10" />
          </>
        ) : kind === 'cost' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M14.8 9.2a2.6 2.6 0 0 0-2.4-1.4h-1c-1.3 0-2.3.8-2.3 2s1 1.8 2.3 2.1l1.2.3c1.4.3 2.4 1 2.4 2.2 0 1.2-1.1 2.1-2.5 2.1h-1a2.7 2.7 0 0 1-2.5-1.5M12 6.2v11.6" />
          </>
        ) : kind === 'tps' ? (
          <>
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
          </>
        )}
      </svg>
    </span>
  );
}

function entryToTotals(entry: RequestLogEntry): UsageTotals {
  return {
    input_tokens: entry.input_tokens,
    output_tokens: entry.output_tokens,
    cache_creation_tokens: entry.cache_creation_tokens,
    cache_read_tokens: entry.cache_read_tokens,
    total_tokens: entry.total_tokens,
    reasoning_tokens: entry.reasoning_tokens ?? null,
    requests: 1,
  };
}

export function RequestLogsPanel({onFocusAccount}: {onFocusAccount?: (accountId: string) => void} = {}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();

  const [period, setPeriod] = useState<UsagePeriod>('week');
  const [accountId, setAccountId] = useState('all');
  const [model, setModel] = useState('all');
  const [effort, setEffort] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<RequestLogSourceFilter>('all');
  const [sessionKey, setSessionKey] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<RequestLogSortField>('time');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [tzPref, setTzPref] = useState<RequestLogTimezonePref>(readLogsTimezonePref);
  const [jumpDraft, setJumpDraft] = useState('');
  const [revision, setRevision] = useState(0);

  const [result, setResult] = useState<{key: string; value: RequestLogsSnapshot} | null>(null);
  const [status, setStatus] = useState<{key: string; busy: boolean; error: string}>({key: '', busy: true, error: ''});
  const [exportStatus, setExportStatus] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<RequestLogEntry | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const exportTimerRef = useRef<number | null>(null);
  const copyIdTimerRef = useRef<number | null>(null);
  const tableCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === search) return;
    const timer = window.setTimeout(() => {
      setSearch(trimmed);
      setPage(1);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchDraft, search]);

  useEffect(() => () => {
    if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
    if (copyIdTimerRef.current) window.clearTimeout(copyIdTimerRef.current);
  }, []);

  const systemTimezone = useMemo(() => {
    try {
      const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
      new Intl.DateTimeFormat('en', {timeZone: value});
      return value;
    } catch {
      return '';
    }
  }, []);

  const effectiveTimezone = tzPref === 'system' ? systemTimezone : tzPref;

  const queryKey = [
    period,
    accountId,
    model,
    effort,
    sourceFilter,
    sessionKey,
    search,
    sortBy,
    sortDir,
    page,
    pageSize,
    effectiveTimezone || `offset:${-new Date().getTimezoneOffset()}`,
  ].join('|');

  const snapshot =
    result?.key === queryKey
      ? result.value
      : (logsSnapshotCache.get(queryKey) ?? result?.value ?? null);
  const busy = status.key !== queryKey || status.busy;
  const isTransitioning =
    snapshot !== null && busy && result?.key !== queryKey && !logsSnapshotCache.has(queryKey);
  const error = status.key === queryKey ? status.error : '';

  usePageRefresh(() => {
    if (!busy) setRevision(v => v + 1);
  });

  useEffect(() => {
    let live = true;
    let reading = false;
    let timer: number | undefined;
    const isVisible = () => document.visibilityState !== 'hidden';

    const refresh = async () => {
      window.clearTimeout(timer);
      if (!live || reading || !isVisible()) return;
      reading = true;
      setStatus({key: queryKey, busy: true, error: ''});
      try {
        const value = await invoke<RequestLogsSnapshot>('usage_request_logs_read', {
          period,
          accountId: accountId === 'all' ? null : accountId,
          model: model === 'all' ? null : model,
          effort: effort === 'all' ? null : effort,
          sourceFilter: sourceFilter === 'all' ? null : sourceFilter,
          sessionKey: sessionKey || null,
          search: search || null,
          sortBy,
          sortDir,
          page,
          pageSize,
          offsetMinutes: -new Date().getTimezoneOffset(),
          ...(effectiveTimezone ? {timezone: effectiveTimezone} : {}),
        });
        if (live) {
          rememberLogsSnapshot(queryKey, value);
          setResult({key: queryKey, value});
          setStatus({key: queryKey, busy: false, error: ''});
          if (value.page > 0 && value.page !== page) {
            setPage(value.page);
          }
        }
      } catch (reason) {
        if (live) {
          setStatus({key: queryKey, busy: false, error: String(reason)});
        }
      } finally {
        reading = false;
        if (live && isVisible()) {
          timer = window.setTimeout(() => {
            void refresh();
          }, 30_000);
        }
      }
    };

    const visibilityChanged = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') void refresh();
    };

    void refresh();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      live = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [queryKey, period, accountId, model, effort, sourceFilter, sessionKey, search, sortBy, sortDir, page, pageSize, revision, effectiveTimezone]);

  const num = (value: number | null | undefined, compact = false) =>
    formatUsageNumber(value, locale, compact);
  const percent = (value: number | null | undefined) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(value);

  const activeTz = snapshot?.timezone || effectiveTimezone || null;
  const activeTzBadge = useMemo(
    () => formatTimezoneBadge(activeTz, snapshot?.generated_at ? snapshot.generated_at * 1000 : undefined),
    [activeTz, snapshot?.generated_at],
  );
  const systemTzShort = useMemo(() => formatTimezoneBadge(systemTimezone), [systemTimezone]);
  const referenceYear = useMemo(() => {
    const sampleMs = snapshot?.generated_at ? snapshot.generated_at * 1000 : Date.now();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        ...(activeTz ? {timeZone: activeTz} : {}),
      }).formatToParts(new Date(sampleMs));
      const yr = Number(parts.find(p => p.type === 'year')?.value);
      return Number.isFinite(yr) && yr > 0 ? yr : new Date().getFullYear();
    } catch {
      return new Date().getFullYear();
    }
  }, [snapshot?.generated_at, activeTz]);

  const stamp = snapshot
    ? new Date(snapshot.generated_at * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        ...(activeTz ? {timeZone: activeTz} : {}),
      })
    : '';
  const trackingSinceLabel =
    snapshot?.tracking_since != null
      ? new Date(snapshot.tracking_since * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          ...(activeTz ? {timeZone: activeTz} : {}),
        })
      : '';

  const hasActiveFilters =
    period !== 'week' ||
    accountId !== 'all' ||
    model !== 'all' ||
    effort !== 'all' ||
    sourceFilter !== 'all' ||
    sessionKey !== '' ||
    searchDraft !== '';

  const resetFilters = () => {
    setPeriod('week');
    setAccountId('all');
    setModel('all');
    setEffort('all');
    setSourceFilter('all');
    setSessionKey('');
    setSearchDraft('');
    setSearch('');
    setSortBy('time');
    setSortDir('desc');
    setPage(1);
    setJumpDraft('');
  };

  const selectSort = (field: RequestLogSortField) => {
    if (sortBy === field) {
      setSortDir(dir => (dir === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const sortHeader = (field: RequestLogSortField, label: string, align: 'left' | 'center' | 'right' = 'right') => {
    const active = sortBy === field;
    const descending = sortDir === 'desc';
    const alignClass =
      align === 'left'
        ? 'logs-col-align-left'
        : align === 'right'
          ? 'logs-col-align-right'
          : undefined;
    return (
      <th
        scope="col"
        className={alignClass}
        aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className={`usage-sort-button${active ? ' is-active' : ''}`}
          title={t('usage.sortColumn', {column: label})}
          onClick={() => selectSort(field)}
        >
          {label}
          <svg
            className="usage-sort-icon"
            width="12"
            height="14"
            viewBox="0 0 12 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 5 3-3 3 3" opacity={active && !descending ? 1 : 0.3} />
            <path d="m3 9 3 3 3-3" opacity={active && descending ? 1 : 0.3} />
          </svg>
        </button>
      </th>
    );
  };

  const flashExportStatus = (msg: string) => {
    setExportStatus(msg);
    if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
    exportTimerRef.current = window.setTimeout(() => setExportStatus(''), 2600);
  };

  const copyText = async (contents: string): Promise<boolean> => {
    try {
      await invoke('copy_result', {text: contents});
      return true;
    } catch {
      if (!navigator.clipboard?.writeText) return false;
      try {
        await navigator.clipboard.writeText(contents);
        return true;
      } catch {
        return false;
      }
    }
  };

  const exportTsv = async (mode: 'copy' | 'download') => {
    if (!snapshot || !snapshot.items.length || busy) return;
    const contents = buildRequestLogsTsv(snapshot.items, {
      privacyMask: prefs.privacyMask,
      locale: locale === 'en' ? 'en' : 'zh',
      timezone: activeTz,
    });
    if (mode === 'copy') {
      const ok = await copyText(contents);
      flashExportStatus(t(ok ? 'logs.tsvCopied' : 'usage.exportFailed'));
      return;
    }
    try {
      const blob = new Blob([contents], {type: 'text/tab-separated-values;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `claude-local-request-logs-${period}-p${snapshot.page}.tsv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      flashExportStatus(t('logs.tsvDownloaded'));
    } catch {
      flashExportStatus(t('usage.exportFailed'));
    }
  };

  const exportJson = async () => {
    if (!snapshot || !snapshot.items.length || busy) return;
    const contents = buildRequestLogsJson(snapshot.items, {privacyMask: prefs.privacyMask});
    const ok = await copyText(contents);
    flashExportStatus(t(ok ? 'logs.jsonCopied' : 'usage.exportFailed'));
  };

  const unattributedCount = snapshot?.unattributed_count ?? 0;

  const accountOptions = useMemo(() => {
    const opts = [{value: 'all', label: t('logs.allAccounts')}];
    for (const acc of snapshot?.available_accounts ?? []) {
      const display = maskDisplayName(acc.name, acc.email ?? null, prefs.privacyMask);
      opts.push({
        value: acc.id,
        label: acc.current ? `${display} · ${t('usage.current')}` : display,
      });
    }
    if (snapshot?.has_unattributed || unattributedCount > 0 || accountId === 'unattributed') {
      opts.push({
        value: 'unattributed',
        label:
          unattributedCount > 0
            ? t('logs.unattributedOption', {count: formatUsageNumber(unattributedCount, locale)})
            : t('logs.unattributed'),
      });
    }
    if (accountId !== 'all' && !opts.some(o => o.value === accountId)) {
      opts.push({value: accountId, label: shortHash(accountId, 8)});
    }
    return opts;
  }, [snapshot?.available_accounts, snapshot?.has_unattributed, unattributedCount, accountId, prefs.privacyMask, locale, t]);

  const modelOptions = useMemo(() => {
    const opts = [{value: 'all', label: t('logs.allModels')}];
    for (const m of snapshot?.available_models ?? []) {
      opts.push({
        value: m,
        label: m === 'unknown' ? t('usage.unknownModel') : compactModelLabel(m),
      });
    }
    if (model !== 'all' && !opts.some(o => o.value === model)) {
      opts.push({
        value: model,
        label: model === 'unknown' ? t('usage.unknownModel') : compactModelLabel(model),
      });
    }
    return opts;
  }, [snapshot?.available_models, model, t]);

  const effortOptions = useMemo(() => {
    const opts = [{value: 'all', label: t('logs.allEfforts')}];
    for (const ef of snapshot?.available_efforts ?? []) {
      opts.push({value: ef, label: ef});
    }
    if (effort !== 'all' && effort !== 'none' && !opts.some(o => o.value === effort)) {
      opts.push({value: effort, label: effort});
    }
    opts.push({value: 'none', label: t('logs.effortNone')});
    return opts;
  }, [snapshot?.available_efforts, effort, t]);

  const sourceOptions = useMemo(
    () => [
      {value: 'all', label: t('logs.sourceAll')},
      {value: 'main', label: t('logs.sourceMain')},
      {value: 'subagent', label: t('logs.sourceSubagent')},
      {value: 'slot', label: t('logs.sourceSlot')},
    ],
    [t],
  );

  const tzOptions = useMemo(
    () => [
      {value: 'system', label: t('logs.tzSystem', {tz: systemTzShort})},
      {value: 'Asia/Shanghai', label: t('logs.tzBeijing')},
      {value: 'America/New_York', label: t('logs.tzUsEast')},
      {value: 'UTC', label: t('logs.tzUtc')},
    ],
    [systemTzShort, t],
  );

  const summary = snapshot?.summary;
  const items = snapshot?.items ?? [];
  const totalCount = snapshot?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageTokens = useMemo(() => buildPaginationRange(currentPage, totalPages), [currentPage, totalPages]);
  const rangeFrom = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeTo = Math.min(totalCount, currentPage * pageSize);

  const goToPage = (nextPage: number, scrollToTable = false) => {
    const clamped = Math.min(Math.max(1, Math.trunc(nextPage)), totalPages);
    setPage(clamped);
    setJumpDraft('');
    if (scrollToTable) {
      tableCardRef.current?.scrollIntoView({block: 'start'});
    }
  };

  const submitJumpPage = (e: FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(jumpDraft.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    goToPage(parsed, true);
  };

  const sourceLabel = (entry: RequestLogEntry) => {
    if (entry.source_kind === 'slot' && entry.sidechain) {
      return `${t('logs.sourceSlot')} · ${t('logs.sourceSubagent')}`;
    }
    if (entry.source_kind === 'slot') return t('logs.sourceSlot');
    if (entry.sidechain) return t('logs.sourceSubagent');
    return t('logs.sourceMain');
  };

  const stopReasonLabel = (raw: string) => {
    if (!raw) return '—';
    const key = `logs.stopReason.${raw}`;
    const translated = t(key);
    return translated === key ? raw : translated;
  };

  const selectedCostBreakdown = selectedEntry
    ? (() => {
        const base = estimateTotalsCostUsd(entryToTotals(selectedEntry), selectedEntry.model);
        const mult = resolveSpeedCostMultiplier(selectedEntry.model, selectedEntry.speed);
        return {
          ...base,
          inputCostUsd: base.inputCostUsd * mult,
          outputCostUsd: base.outputCostUsd * mult,
          cacheWriteCostUsd: base.cacheWriteCostUsd * mult,
          cacheReadCostUsd: base.cacheReadCostUsd * mult,
          costUsd: base.costUsd * mult,
          cacheSavingsUsd: base.cacheSavingsUsd * mult,
        };
      })()
    : null;
  const selectedParts = selectedEntry ? tokenComposition(entryToTotals(selectedEntry)) : [];
  const selectedTotalThroughput =
    selectedEntry && selectedEntry.duration_ms && selectedEntry.duration_ms >= 100
      ? (selectedEntry.total_tokens / (selectedEntry.duration_ms / 1000))
      : null;
  const selectedEndTzBadge = selectedEntry ? formatTimezoneBadge(activeTz, selectedEntry.ts_ms) : activeTzBadge;
  const selectedStartMs =
    selectedEntry && selectedEntry.duration_ms != null
      ? Math.max(0, selectedEntry.ts_ms - selectedEntry.duration_ms)
      : null;
  const selectedStartTzBadge =
    selectedStartMs != null ? formatTimezoneBadge(activeTz, selectedStartMs) : null;

  return (
    <section className="system-page logs-page">
      <header className="cleanup-title logs-header">
        <h1>{t('logs.title')}</h1>
        <div className="usage-header-actions">
          <span className="usage-update-indicator" role="status">
            <span className={`usage-update-dot${busy ? ' is-busy' : ''}`} aria-hidden="true" />
            <span>{busy ? t('usage.loading') : stamp ? t('usage.updated', {time: stamp}) : t('usage.localOnly')}</span>
          </span>
          <div className="usage-action-group">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  size="small"
                  variant="secondary"
                  className="usage-export-trigger"
                  disabled={!items.length || busy}
                  aria-label={t('usage.exportMore')}
                  title={t('usage.exportMore')}
                >
                  {t('usage.exportMore')} ▾
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="identity-menu-content usage-export-menu" align="end" sideOffset={5}>
                  <DropdownMenu.Item className="identity-menu-item" onSelect={() => void exportTsv('copy')}>
                    {t('logs.copyTsv')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="identity-menu-item" onSelect={() => void exportTsv('download')}>
                    {t('logs.downloadTsv')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="identity-menu-separator" />
                  <DropdownMenu.Item className="identity-menu-item" onSelect={() => void exportJson()}>
                    {t('logs.copyJson')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Button
              size="small"
              variant="secondary"
              disabled={busy}
              leftIcon={<Refresh size={15} aria-hidden="true" className={busy ? 'spin' : ''} />}
              onClick={() => setRevision(v => v + 1)}
            >
              {t('usage.refresh')}
            </Button>
          </div>
        </div>
      </header>

      <div className="logs-content">
        {exportStatus && (
          <p className="usage-export-status" role="status">
            {exportStatus}
          </p>
        )}

        <div className="settings-card logs-filter-card">
          <div className="logs-filter-row">
            <Tabs
              aria-label={t('usage.periodFilter')}
              className="usage-periods"
              value={period}
              onValueChange={v => {
                setPeriod(v as UsagePeriod);
                setPage(1);
              }}
              tabs={PERIODS.map(([value, key]) => ({value, label: t(key)}))}
            />

            <div className="logs-filter-controls">
              <div className="logs-select-wrap">
                <Select
                  size="small"
                  value={accountId}
                  onValueChange={v => {
                    setAccountId(v);
                    setPage(1);
                  }}
                  aria-label={t('usage.accountFilter')}
                  items={accountOptions}
                />
              </div>
              <div className="logs-select-wrap">
                <Select
                  size="small"
                  value={model}
                  onValueChange={v => {
                    setModel(v);
                    setPage(1);
                  }}
                  aria-label={t('logs.modelFilter')}
                  items={modelOptions}
                />
              </div>
              <div className="logs-select-wrap">
                <Select
                  size="small"
                  value={sourceFilter}
                  onValueChange={v => {
                    setSourceFilter(v as RequestLogSourceFilter);
                    setPage(1);
                  }}
                  aria-label={t('logs.sourceFilter')}
                  items={sourceOptions}
                />
              </div>
              <div className="logs-select-wrap">
                <Select
                  size="small"
                  value={effort}
                  onValueChange={v => {
                    setEffort(v);
                    setPage(1);
                  }}
                  aria-label={t('logs.effortFilter')}
                  items={effortOptions}
                />
              </div>
            </div>
          </div>

          <div className="logs-search-row">
            <div className="logs-search-box">
              <span className="logs-search-icon" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7.5" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </span>
              <input
                type="text"
                className="logs-search-input"
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder={t('logs.searchPlaceholder')}
                aria-label={t('logs.searchPlaceholder')}
                maxLength={64}
              />
              {searchDraft && (
                <button
                  type="button"
                  className="logs-search-clear"
                  aria-label={t('logs.clearSearch')}
                  onClick={() => {
                    setSearchDraft('');
                    setSearch('');
                    setPage(1);
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {sessionKey && (
              <span className="logs-session-chip" data-logs-session-filter>
                <span>{t('logs.sessionFilterActive', {hash: shortHash(sessionKey)})}</span>
                <button
                  type="button"
                  aria-label={t('logs.clearSessionFilter')}
                  onClick={() => {
                    setSessionKey('');
                    setPage(1);
                  }}
                >
                  ×
                </button>
              </span>
            )}

            {unattributedCount > 0 && (
              <button
                type="button"
                className={`logs-unattr-chip${accountId === 'unattributed' ? ' is-active' : ''}`}
                data-logs-unattr-chip
                title={t('logs.unattributedNote')}
                onClick={() => {
                  setAccountId(prev => (prev === 'unattributed' ? 'all' : 'unattributed'));
                  setPage(1);
                }}
              >
                <span className="logs-unattr-dot" aria-hidden="true" />
                <span>{t('logs.unattributedChip', {count: num(unattributedCount)})}</span>
              </button>
            )}

            <div className="logs-search-meta">
              <div className="logs-select-wrap logs-tz-select" title={t('logs.tzHint')}>
                <Select
                  size="small"
                  value={tzPref}
                  onValueChange={v => {
                    const next = v as RequestLogTimezonePref;
                    setTzPref(next);
                    writeLogsTimezonePref(next);
                    setPage(1);
                  }}
                  aria-label={t('logs.tzFilter')}
                  items={tzOptions}
                />
              </div>
              {hasActiveFilters && (
                <Button size="small" variant="secondary" onClick={resetFilters}>
                  {t('usage.resetFilters')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {accountId === 'unattributed' && (
          <div className="logs-info-banner" role="note" data-logs-unattr-note>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" />
              <path d="M12 10v6" />
              <circle cx="12" cy="7.2" r="0.6" fill="currentColor" />
            </svg>
            <span>{t('logs.unattributedNote')}</span>
          </div>
        )}

        {error && (
          <p className="banner-error usage-error" role="alert">
            {t('logs.readFailed')}
          </p>
        )}

        {!snapshot && busy ? (
          <div className="usage-empty" role="status">
            <strong>{t('usage.firstScan')}</strong>
            <span>{t('usage.localOnly')}</span>
          </div>
        ) : (
          <>
            <div className="logs-kpi-grid">
              <div className="settings-card logs-kpi-card">
                <div className="logs-kpi-head">
                  <KpiGlyph kind="requests" />
                  <span>{t('logs.kpiRequests')}</span>
                </div>
                <strong className="logs-kpi-value" title={num(summary?.total_requests ?? 0)}>
                  {num(summary?.total_requests ?? 0)}
                </strong>
                <div className="logs-kpi-sub">
                  <span className="logs-kpi-sub-item">
                    {t('logs.kpiTotalTokens')} <b>{num(summary?.total_tokens ?? 0, true)}</b>
                  </span>
                  {summary?.avg_tokens != null && (
                    <span className="logs-kpi-sub-item">
                      {t('logs.kpiAvgTokens', {tokens: num(Math.round(summary.avg_tokens), true)})}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-card logs-kpi-card">
                <div className="logs-kpi-head">
                  <KpiGlyph kind="cost" />
                  <span>{t('logs.kpiCost')}</span>
                </div>
                <strong className="logs-kpi-value" title={formatPreciseUsd(summary?.total_cost_usd ?? 0)}>
                  {formatUsdCost(summary?.total_cost_usd ?? 0)}
                </strong>
                <div className="logs-kpi-sub">
                  {summary?.avg_cost_usd != null && (
                    <span className="logs-kpi-sub-item">
                      {t('logs.kpiAvgCost', {cost: formatPreciseUsd(summary.avg_cost_usd)})}
                    </span>
                  )}
                  {(summary?.total_cache_savings_usd ?? 0) > 0 && (
                    <span className="logs-kpi-sub-item">
                      {t('logs.kpiCacheSaved', {cost: formatUsdCost(summary?.total_cache_savings_usd ?? 0, true)})}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-card logs-kpi-card">
                <div className="logs-kpi-head">
                  <KpiGlyph kind="tps" />
                  <span>{t('logs.kpiAvgTps')}</span>
                </div>
                <strong className="logs-kpi-value">
                  {formatTps(summary?.avg_tps)}
                </strong>
                <div className="logs-kpi-sub">
                  <span className="logs-kpi-sub-item">
                    {t('logs.kpiPeakTps')} <b>{formatTps(summary?.peak_tps, false)}</b>
                  </span>
                  <span className="logs-kpi-sub-item">
                    {t('logs.kpiTimedCount', {count: num(summary?.timed_requests ?? 0, true)})}
                  </span>
                </div>
              </div>

              <div className="settings-card logs-kpi-card">
                <div className="logs-kpi-head">
                  <KpiGlyph kind="latency" />
                  <span>{t('logs.kpiAvgLatency')}</span>
                </div>
                <strong className="logs-kpi-value">
                  {formatDurationMs(summary?.avg_duration_ms)}
                </strong>
                <div className="logs-kpi-sub">
                  <span className="logs-kpi-sub-item">
                    P95 <b>{formatDurationMs(summary?.p95_duration_ms)}</b>
                  </span>
                  <span className="logs-kpi-sub-item">
                    {t('usage.cacheHit')} <b>{percent(summary?.overall_cache_hit_rate)}</b>
                  </span>
                </div>
              </div>
            </div>

            <section
              className={`settings-card logs-table-card${isTransitioning ? ' is-loading' : ''}`}
              aria-busy={busy}
              ref={tableCardRef}
            >
              <div className="logs-table-bar">
                <div className="logs-table-bar-left">
                  <span className="logs-range-text" role="status">
                    {totalCount > 0
                      ? t('logs.rangeInfo', {
                          from: num(rangeFrom),
                          to: num(rangeTo),
                          count: num(totalCount),
                        })
                      : t('logs.empty')}
                  </span>
                  <span className="logs-tz-badge" title={`${activeTz || 'Local'} · ${t('logs.tzHint')}`}>
                    {activeTzBadge}
                  </span>
                  <button
                    type="button"
                    className={`logs-order-toggle${sortBy === 'time' ? ' is-active' : ''}`}
                    data-logs-order-toggle
                    onClick={() => {
                      if (sortBy === 'time') {
                        setSortDir(dir => (dir === 'desc' ? 'asc' : 'desc'));
                      } else {
                        setSortBy('time');
                        setSortDir('desc');
                      }
                      setPage(1);
                    }}
                  >
                    {sortBy === 'time' && sortDir === 'asc' ? `↑ ${t('logs.sortOldest')}` : `↓ ${t('logs.sortNewest')}`}
                  </button>
                </div>

                {totalPages > 1 && (
                  <div className="logs-quick-pager" data-logs-top-pager>
                    <button
                      type="button"
                      className="logs-page-btn"
                      disabled={currentPage <= 1}
                      aria-label={t('logs.firstPage')}
                      title={t('logs.firstPage')}
                      onClick={() => goToPage(1)}
                    >
                      «
                    </button>
                    <button
                      type="button"
                      className="logs-page-btn"
                      disabled={currentPage <= 1}
                      aria-label={t('usage.previousPage')}
                      title={t('usage.previousPage')}
                      onClick={() => goToPage(currentPage - 1)}
                    >
                      ‹
                    </button>
                    <span className="logs-quick-pager-pos">
                      {num(currentPage)} / {num(totalPages)}
                    </span>
                    <button
                      type="button"
                      className="logs-page-btn"
                      disabled={currentPage >= totalPages}
                      aria-label={t('usage.nextPage')}
                      title={t('usage.nextPage')}
                      onClick={() => goToPage(currentPage + 1)}
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      className="logs-page-btn"
                      disabled={currentPage >= totalPages}
                      aria-label={t('logs.lastPage')}
                      title={t('logs.lastPage')}
                      onClick={() => goToPage(totalPages)}
                    >
                      »
                    </button>
                  </div>
                )}
              </div>

              <div className="logs-table-wrap" role="region" aria-label={t('logs.tableLabel')} tabIndex={0}>
                <table className="logs-table" aria-label={t('logs.tableLabel')}>
                  <colgroup>
                    <col className="logs-col-time" />
                    <col className="logs-col-account" />
                    <col className="logs-col-model" />
                    <col className="logs-col-tokens" />
                    <col className="logs-col-cache" />
                    <col className="logs-col-duration" />
                    <col className="logs-col-tps" />
                    <col className="logs-col-cost" />
                  </colgroup>
                  <thead>
                    <tr>
                      {sortHeader('time', t('usage.time'), 'left')}
                      <th scope="col" className="logs-col-align-left">{t('usage.account')}</th>
                      <th scope="col" className="logs-col-align-left">{t('logs.colModel')}</th>
                      {sortHeader('tokens', t('logs.colTokens'), 'right')}
                      {sortHeader('cache_hit', t('logs.colCache'), 'right')}
                      {sortHeader('duration', t('logs.colDuration'), 'right')}
                      {sortHeader('tps', t('logs.colTps'), 'right')}
                      {sortHeader('cost', t('logs.colCost'), 'right')}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(entry => {
                      const family = detectModelFamily(entry.model);
                      const tpsTier = classifyTpsTier(entry.tps);
                      const isLegacyTiming = entry.ts_precise === false;
                      const displayModel =
                        entry.model === 'unknown' ? t('usage.unknownModel') : compactModelLabel(entry.model);
                      const displayAccount = entry.account_name
                        ? maskDisplayName(entry.account_name, entry.account_email ?? null, prefs.privacyMask)
                        : null;
                      const rowTzBadge = formatTimezoneBadge(activeTz, entry.ts_ms);
                      const fullTimeTooltip = `${formatLogTimeFull(entry.ts_ms, locale === 'en' ? 'en' : 'zh', activeTz, !isLegacyTiming)} ${rowTzBadge}${isLegacyTiming ? ` · ${t('logs.legacyTimingHint')}` : ''}`;
                      return (
                        <tr
                          key={entry.event_key}
                          tabIndex={0}
                          onClick={() => setSelectedEntry(entry)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedEntry(entry);
                            }
                          }}
                        >
                          <td className="logs-col-align-left">
                            <div className="logs-time-cell">
                              <span
                                className="logs-time-main"
                                title={fullTimeTooltip}
                              >
                                {formatLogTimeShort(entry.ts_ms, locale === 'en' ? 'en' : 'zh', activeTz, referenceYear)}
                              </span>
                              <span className="logs-time-sub">
                                <span>{shortHash(entry.event_key, 6)}</span>
                                {entry.source_kind === 'slot' && (
                                  <span className="logs-source-badge" data-source="slot">{t('logs.sourceSlotShort')}</span>
                                )}
                                {entry.sidechain && (
                                  <span className="logs-source-badge" data-source="subagent">{t('logs.sourceSubagentShort')}</span>
                                )}
                                {isLegacyTiming && (
                                  <span className="logs-source-badge" data-source="archived" title={t('logs.legacyTimingHint')}>
                                    {t('logs.legacyTimingBadge')}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="logs-col-align-left">
                            <div className="logs-account-cell">
                              {displayAccount ? (
                                <span className="logs-account-row">
                                  <span
                                    className="logs-account-name"
                                    title={prefs.privacyMask ? undefined : entry.account_name ?? undefined}
                                  >
                                    {displayAccount}
                                  </span>
                                  {entry.account_plan && (
                                    <span
                                      className="identity-plan-pill"
                                      data-plan-tier={normalizePlanSlug(entry.account_plan)}
                                    >
                                      {entry.account_plan}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="logs-account-unattr" title={t('logs.unattributedNote')}>
                                  {t('logs.unattributed')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="logs-col-align-left">
                            <div className="logs-model-cell">
                              <span className="logs-model-primary">
                                {family.label && (
                                  <em className="usage-model-family" data-family={family.key}>
                                    {family.label}
                                  </em>
                                )}
                                <span className="logs-model-name" title={entry.model}>
                                  {displayModel}
                                </span>
                              </span>
                              {(entry.effort || entry.speed || entry.tool_count > 0) && (
                                <span className="logs-model-tags">
                                  {entry.effort && (
                                    <span className="usage-effort-badge" data-effort={entry.effort}>
                                      {entry.effort}
                                    </span>
                                  )}
                                  {entry.speed && entry.speed !== 'standard' && (
                                    <span className="logs-mini-pill" data-speed={entry.speed}>
                                      {entry.speed}
                                    </span>
                                  )}
                                  {entry.tool_count > 0 && (
                                    <span className="logs-mini-pill" data-tools="true">
                                      {t('logs.toolsBadge', {count: entry.tool_count})}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className="logs-col-align-right"
                            title={`${num(entry.total_tokens)} · ${t('usage.input')} ${num(entry.input_tokens)} · ${t('usage.output')} ${num(entry.output_tokens)} · ${t('usage.cacheWrite')} ${num(entry.cache_creation_tokens)} · ${t('usage.cacheRead')} ${num(entry.cache_read_tokens)}`}
                          >
                            <div className="logs-tokens-cell">
                              <span className="logs-tokens-total">{num(entry.total_tokens, true)}</span>
                              <span className="logs-tokens-io">
                                {t('usage.output')} {num(entry.output_tokens, true)}
                              </span>
                            </div>
                          </td>
                          <td
                            className="logs-col-align-right"
                            title={`${t('usage.cacheWrite')}: ${num(entry.cache_creation_tokens, true)} · ${t('usage.cacheRead')}: ${num(entry.cache_read_tokens, true)}`}
                          >
                            {percent(entry.cache_hit_rate)}
                          </td>
                          <td
                            className="logs-col-align-right"
                            title={entry.duration_ms == null && isLegacyTiming ? t('logs.legacyTimingHint') : undefined}
                          >
                            {entry.duration_ms != null ? (
                              <span>{formatDurationMs(entry.duration_ms)}</span>
                            ) : (
                              <span className="logs-muted-dash">—</span>
                            )}
                          </td>
                          <td className="logs-col-align-right">
                            {entry.tps != null ? (
                              <span className="logs-tps-pill" data-tier={tpsTier}>
                                {formatTps(entry.tps, false)}
                              </span>
                            ) : (
                              <span className="logs-muted-dash">—</span>
                            )}
                          </td>
                          <td className="logs-cost-cell logs-col-align-right" title={formatPreciseUsd(entry.estimated_cost_usd)}>
                            {formatPreciseUsd(entry.estimated_cost_usd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!items.length && (
                  <p className="usage-model-empty" role="status">
                    {t('logs.empty')}
                  </p>
                )}
              </div>

              {totalCount > 0 && (
                <div className="logs-pagination" data-logs-pagination>
                  <span className="logs-pagination-info" role="status">
                    {t('logs.pageInfo', {
                      count: num(totalCount),
                      page: num(currentPage),
                      pages: num(totalPages),
                    })}
                  </span>
                  <div className="logs-pagination-controls">
                    <div className="logs-page-size">
                      <span>{t('logs.perPage')}</span>
                      <Select
                        size="small"
                        value={String(pageSize)}
                        onValueChange={v => {
                          setPageSize(Number(v));
                          setPage(1);
                          setJumpDraft('');
                          tableCardRef.current?.scrollIntoView({block: 'start'});
                        }}
                        aria-label={t('logs.perPage')}
                        items={PAGE_SIZES.map(n => ({value: String(n), label: String(n)}))}
                      />
                    </div>

                    <div className="logs-pager-buttons" role="navigation" aria-label={t('logs.tableLabel')}>
                      <button
                        type="button"
                        className="logs-page-btn"
                        disabled={currentPage <= 1}
                        title={t('logs.firstPage')}
                        aria-label={t('logs.firstPage')}
                        onClick={() => goToPage(1, true)}
                      >
                        «
                      </button>
                      <button
                        type="button"
                        className="logs-page-btn"
                        disabled={currentPage <= 1}
                        onClick={() => goToPage(currentPage - 1, true)}
                      >
                        {t('usage.previousPage')}
                      </button>
                      {pageTokens.map((token, idx) =>
                        token === 'ellipsis' ? (
                          <span key={`e-${idx}`} className="logs-page-ellipsis" aria-hidden="true">
                            …
                          </span>
                        ) : (
                          <button
                            key={token}
                            type="button"
                            className={`logs-page-btn${token === currentPage ? ' is-current' : ''}`}
                            aria-current={token === currentPage ? 'page' : undefined}
                            onClick={() => goToPage(token, true)}
                          >
                            {token}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        className="logs-page-btn"
                        disabled={currentPage >= totalPages}
                        onClick={() => goToPage(currentPage + 1, true)}
                      >
                        {t('usage.nextPage')}
                      </button>
                      <button
                        type="button"
                        className="logs-page-btn"
                        disabled={currentPage >= totalPages}
                        title={t('logs.lastPage')}
                        aria-label={t('logs.lastPage')}
                        onClick={() => goToPage(totalPages, true)}
                      >
                        »
                      </button>
                    </div>

                    {totalPages > 1 && (
                      <form className="logs-page-jump" onSubmit={submitJumpPage}>
                        <label htmlFor="logs-jump-input">{t('logs.jumpToPage')}</label>
                        <input
                          id="logs-jump-input"
                          type="number"
                          min={1}
                          max={totalPages}
                          inputMode="numeric"
                          className="logs-page-jump-input"
                          placeholder={String(currentPage)}
                          aria-label={t('logs.jumpPageLabel')}
                          value={jumpDraft}
                          onChange={e => setJumpDraft(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="logs-page-btn"
                          disabled={!jumpDraft.trim()}
                        >
                          {t('logs.jumpConfirm')}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        <Disclosure
          className="usage-method settings-card"
          triggerClassName="usage-method-trigger"
          summary={t('logs.methodTitle')}
        >
          <div className="usage-method-body">
            <p>{t('logs.methodTiming')}</p>
            <p>{t('logs.methodTps')}</p>
            <p>{t('logs.methodCost')}</p>
            <p>{t('logs.methodAttribution')}</p>
            {trackingSinceLabel && <p>{t('usage.trackingSince', {date: trackingSinceLabel})}</p>}
            <p>{t('logs.methodPrivacy')}</p>
            {snapshot?.warnings.some(code => code !== 'attribution_gap') && (
              <p>
                {[
                  ...new Set(
                    snapshot.warnings
                      .filter(code => code !== 'attribution_gap')
                      .map(code => t(WARNING_KEYS[code] ?? 'usage.warning.partial')),
                  ),
                ].join(' · ')}
              </p>
            )}
          </div>
        </Disclosure>
      </div>

      <AppDialog
        open={selectedEntry !== null}
        onOpenChange={open => {
          if (!open) {
            setSelectedEntry(null);
            setCopiedId(false);
          }
        }}
        title={t('logs.detailTitle')}
        description={
          selectedEntry
            ? `${selectedEntry.model === 'unknown' ? t('usage.unknownModel') : selectedEntry.model} · ${formatLogTimeFull(selectedEntry.ts_ms, locale === 'en' ? 'en' : 'zh', activeTz, selectedEntry.ts_precise !== false)} ${selectedEndTzBadge}`
            : undefined
        }
        width={620}
        footer={
          <Button variant="secondary" onClick={() => setSelectedEntry(null)}>
            {t('关闭弹窗')}
          </Button>
        }
      >
        {selectedEntry && (
          <div className="logs-detail-grid">
            <div className="logs-detail-perf">
              <div className="logs-detail-perf-card">
                <span>{t('usage.estimatedCost')}</span>
                <strong>{formatPreciseUsd(selectedEntry.estimated_cost_usd)}</strong>
              </div>
              <div className="logs-detail-perf-card">
                <span>{t('logs.colTps')}</span>
                <strong>{formatTps(selectedEntry.tps)}</strong>
              </div>
              <div className="logs-detail-perf-card">
                <span>{t('logs.colDuration')}</span>
                <strong>{formatDurationMs(selectedEntry.duration_ms)}</strong>
              </div>
              <div className="logs-detail-perf-card">
                <span>{t('usage.cacheHit')}</span>
                <strong>{percent(selectedEntry.cache_hit_rate)}</strong>
              </div>
            </div>

            <div className="logs-detail-meta">
              <div className="logs-detail-field">
                <span>{t('logs.detailEndTime')}</span>
                <div className="logs-detail-field-row">
                  <strong className="logs-detail-mono">
                    {formatLogTimeFull(
                      selectedEntry.ts_ms,
                      locale === 'en' ? 'en' : 'zh',
                      activeTz,
                      selectedEntry.ts_precise !== false,
                    )}
                  </strong>
                  <span className="logs-tz-badge">{selectedEndTzBadge}</span>
                </div>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailStartTime')}</span>
                <div className="logs-detail-field-row">
                  <strong
                    className="logs-detail-mono"
                    title={selectedEntry.ts_precise === false ? t('logs.legacyTimingHint') : undefined}
                  >
                    {selectedStartMs != null
                      ? formatLogTimeFull(
                          selectedStartMs,
                          locale === 'en' ? 'en' : 'zh',
                          activeTz,
                          selectedEntry.ts_precise !== false,
                        )
                      : '—'}
                  </strong>
                  {selectedStartTzBadge && (
                    <span className="logs-tz-badge">{selectedStartTzBadge}</span>
                  )}
                </div>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailRequestHash')}</span>
                <div className="logs-detail-field-row">
                  <strong className="logs-detail-mono">{shortHash(selectedEntry.event_key, 12)}</strong>
                  <button
                    type="button"
                    className="logs-detail-link-btn"
                    onClick={() => {
                      void copyText(selectedEntry.event_key).then(ok => {
                        if (ok) {
                          setCopiedId(true);
                          if (copyIdTimerRef.current) window.clearTimeout(copyIdTimerRef.current);
                          copyIdTimerRef.current = window.setTimeout(() => setCopiedId(false), 1800);
                        }
                      });
                    }}
                  >
                    {t(copiedId ? 'logs.copied' : 'logs.copyHash')}
                  </button>
                </div>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailSessionHash')}</span>
                <div className="logs-detail-field-row">
                  <strong className="logs-detail-mono">
                    {selectedEntry.session_key ? shortHash(selectedEntry.session_key, 12) : '—'}
                  </strong>
                  {selectedEntry.session_key && (
                    <button
                      type="button"
                      className="logs-detail-link-btn"
                      onClick={() => {
                        setSessionKey(selectedEntry.session_key!);
                        setPage(1);
                        setSelectedEntry(null);
                      }}
                    >
                      {t('logs.filterThisSession')}
                    </button>
                  )}
                </div>
              </div>

              <div className="logs-detail-field">
                <span>{t('usage.account')}</span>
                <div className="logs-detail-field-row">
                  <strong title={prefs.privacyMask ? undefined : selectedEntry.account_name ?? undefined}>
                    {selectedEntry.account_name
                      ? maskDisplayName(
                          selectedEntry.account_name,
                          selectedEntry.account_email ?? null,
                          prefs.privacyMask,
                        )
                      : t('logs.unattributed')}
                  </strong>
                  {selectedEntry.account_id && onFocusAccount && (
                    <button
                      type="button"
                      className="logs-detail-link-btn"
                      onClick={() => {
                        const targetId = selectedEntry.account_id!;
                        setSelectedEntry(null);
                        onFocusAccount(targetId);
                      }}
                    >
                      {t('usage.focusCardBtn')}
                    </button>
                  )}
                </div>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailAccountEmail')}</span>
                <strong title={prefs.privacyMask ? undefined : selectedEntry.account_email ?? undefined}>
                  {selectedEntry.account_email
                    ? maskEmailAddress(selectedEntry.account_email, prefs.privacyMask)
                    : '—'}
                </strong>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailSource')}</span>
                <strong>{sourceLabel(selectedEntry)}</strong>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailStopReason')}</span>
                <strong className="logs-detail-mono">{stopReasonLabel(selectedEntry.stop_reason)}</strong>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailEffortSpeed')}</span>
                <strong>
                  {[selectedEntry.effort || '—', selectedEntry.speed || 'standard'].join(' / ')}
                </strong>
              </div>

              <div className="logs-detail-field">
                <span>{t('logs.detailToolsThroughput')}</span>
                <strong>
                  {t('logs.toolsBadge', {count: selectedEntry.tool_count})}
                  {selectedTotalThroughput != null
                    ? ` · ${formatTps(selectedTotalThroughput)}`
                    : ''}
                </strong>
              </div>
            </div>

            {!selectedEntry.account_id && (
              <p className="logs-detail-note" role="note">
                {t('logs.unattributedNote')}
              </p>
            )}
            {selectedEntry.ts_precise === false && (
              <p className="logs-detail-note" role="note">
                {t('logs.legacyTimingHint')}
              </p>
            )}

            <div className="logs-detail-tokens">
              <div className="logs-detail-tokens-head">
                <span>
                  {t('usage.total')}: {num(selectedEntry.total_tokens)}
                </span>
                <span>
                  {t('logs.kpiCacheSaved', {cost: formatPreciseUsd(selectedEntry.cache_savings_usd)})}
                </span>
              </div>
              <div className="usage-composition-track" aria-hidden="true">
                {selectedParts.map(part => (
                  <span
                    key={part.kind}
                    data-token-kind={part.kind}
                    style={{width: `${Math.min(100, part.share * 100)}%`}}
                  />
                ))}
              </div>
              <div className="logs-detail-tokens-grid">
                <div className="logs-detail-bucket" data-token-kind="input">
                  <span><i aria-hidden="true" />{t('usage.input')}</span>
                  <strong>
                    {num(selectedEntry.input_tokens)}
                    {selectedCostBreakdown && (
                      <small>{formatPreciseUsd(selectedCostBreakdown.inputCostUsd)}</small>
                    )}
                  </strong>
                </div>
                <div className="logs-detail-bucket" data-token-kind="output">
                  <span><i aria-hidden="true" />{t('usage.output')}</span>
                  <strong>
                    {num(selectedEntry.output_tokens)}
                    {selectedCostBreakdown && (
                      <small>{formatPreciseUsd(selectedCostBreakdown.outputCostUsd)}</small>
                    )}
                  </strong>
                </div>
                <div className="logs-detail-bucket" data-token-kind="cacheWrite">
                  <span><i aria-hidden="true" />{t('usage.cacheWrite')}</span>
                  <strong>
                    {num(selectedEntry.cache_creation_tokens)}
                    {selectedCostBreakdown && (
                      <small>{formatPreciseUsd(selectedCostBreakdown.cacheWriteCostUsd)}</small>
                    )}
                  </strong>
                </div>
                <div className="logs-detail-bucket" data-token-kind="cacheRead">
                  <span><i aria-hidden="true" />{t('usage.cacheRead')}</span>
                  <strong>
                    {num(selectedEntry.cache_read_tokens)}
                    {selectedCostBreakdown && (
                      <small>{formatPreciseUsd(selectedCostBreakdown.cacheReadCostUsd)}</small>
                    )}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </AppDialog>
    </section>
  );
}
