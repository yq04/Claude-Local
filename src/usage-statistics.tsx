/**
 * [INPUT]: Native numeric usage aggregates, shared locale and display/privacy preferences.
 * [OUTPUT]: Token-first overview with four-part composition, equivalent API USD cost & cache savings cards, full model distribution with per-model/effort cost, a concise All/account selector, responsive trend/data views and scoped TSV actions.
 * [POS]: Local statistics page; sequential 30-second visible-page/manual refresh, no credential or conversation-body access.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useState, type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Button, Disclosure, Select, Tabs} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {useI18n} from './i18n';
import {usePageRefresh} from './app-events';
import {maskDisplayName, maskEmailAddress, usePreferences} from './settings-model';
import {
  cacheHitRate,
  dailySeries,
  detectModelFamily,
  estimateSnapshotCostUsd,
  estimateTotalsCostUsd,
  formatUsageNumber,
  formatUsdCost,
  summarizeUsageTrend,
  tokenComposition,
  type UsagePeriod,
  type UsageSnapshot,
  type UsageTotals,
} from './usage-model';
import {UsageTrend} from './usage-trend';
import {UsageTrendTable} from './usage-table';
import {buildUsageTsv} from './usage-export';
import {formatTimezoneContext, getDstDayType, maskAccountLabel} from './usage-attribution';

const periods: readonly [UsagePeriod, string][] = [['today', 'usage.today'], ['yesterday', 'usage.yesterday'], ['week', 'usage.week'], ['month', 'usage.month'], ['all', 'usage.allTime']];
const warningKeys: Record<string, string> = {
  partial_scan: 'usage.warning.partial', invalid_records: 'usage.warning.invalid',
  weak_ids: 'usage.warning.weak',
};

function GroupTitle({children, aside}: {children: ReactNode; aside?: ReactNode}) {
  return <div className="settings-group-heading usage-group-heading"><span className="settings-group-bar" aria-hidden="true" /><h2>{children}</h2>{aside && <span className="usage-section-caption">{aside}</span>}</div>;
}

function MetricGlyph({kind}: {kind: 'total' | 'cost' | 'savings' | 'cache' | 'pace'}) {
  return <span className="usage-metric-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'total' ? (
      <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>
    ) : kind === 'cost' ? (
      <><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2a2.6 2.6 0 0 0-2.4-1.4h-1c-1.3 0-2.3.8-2.3 2s1 1.8 2.3 2.1l1.2.3c1.4.3 2.4 1 2.4 2.2 0 1.2-1.1 2.1-2.5 2.1h-1a2.7 2.7 0 0 1-2.5-1.5M12 6.2v11.6" /></>
    ) : kind === 'savings' ? (
      <><path d="M12 3 5 6v6c0 4.5 3 7.9 7 9 4-1.1 7-4.5 7-9V6l-7-3Z" /><path d="m9.5 12.2 1.8 1.8 3.6-3.8" /></>
    ) : kind === 'pace' ? (
      <><path d="M3 12h4l2.6-6 4.8 12 2.6-6H21" /></>
    ) : (
      <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v14c0 4 14 4 14 0V5M5 12c0 4 14 4 14 0" /></>
    )}
  </svg></span>;
}

function TokenComposition({totals, details = false}: {totals: UsageTotals; details?: boolean}) {
  const {t, locale} = useI18n();
  const parts = tokenComposition(totals);
  const number = (value: number, compact = false) => formatUsageNumber(value, locale, compact);
  const share = (value: number) => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {style: 'percent', maximumFractionDigits: 1}).format(value);
  const description = parts.map(part => `${t(`usage.${part.kind}`)}: ${number(part.tokens)} (${share(part.share)})`).join(' · ');
  return <div className={`usage-composition${details ? ' has-details' : ''}`}>
    <div className="usage-composition-track" role="img" aria-label={`${t('usage.composition')}: ${description}`} title={description}>
      {parts.map(part => <span key={part.kind} data-token-kind={part.kind} style={{width: `${Math.min(100, part.share * 100)}%`}} />)}
    </div>
    {details && <dl className="usage-composition-details">{parts.map(part => <div key={part.kind} data-token-kind={part.kind}>
      <dt><i aria-hidden="true" />{t(`usage.${part.kind}`)}</dt>
      <dd title={number(part.tokens)}>{number(part.tokens, true)}<small>{share(part.share)}</small></dd>
    </div>)}</dl>}
  </div>;
}

export function UsageStatisticsPanel() {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const [period, setPeriod] = useState<UsagePeriod>('all');
  const [account, setAccount] = useState('all');
  const [trendView, setTrendView] = useState<'chart' | 'data'>('chart');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{key: string; value: UsageSnapshot} | null>(null);
  const [status, setStatus] = useState<{key: string; busy: boolean; error: string}>({key: '', busy: true, error: ''});
  const [exportStatus, setExportStatus] = useState('');
  const timezone = (() => { try { const value = Intl.DateTimeFormat().resolvedOptions().timeZone; new Intl.DateTimeFormat('en', {timeZone: value}); return value; } catch { return ''; } })();
  const queryKey = `${period}:${account}:${timezone || `offset:${-new Date().getTimezoneOffset()}`}`;
  const snapshot = result?.key === queryKey ? result.value : null;
  const busy = status.key !== queryKey || status.busy;
  const error = status.key === queryKey ? status.error : '';
  usePageRefresh(() => { if (!busy) setRevision(value => value + 1); });
  const num = (value: number | null | undefined, compact = false) => formatUsageNumber(value, locale, compact);
  const percent = (value: number | null) => value == null ? '—' : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {style: 'percent', maximumFractionDigits: 1}).format(value);

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
        const args = {period, accountId: account === 'all' ? null : account, offsetMinutes: -new Date().getTimezoneOffset(), ...(timezone ? {timezone} : {})};
        const value = await invoke<UsageSnapshot>('usage_statistics_read', args);
        if (live) {setResult({key: queryKey, value}); setStatus({key: queryKey, busy: false, error: ''});}
      } catch (reason) {
        if (live) setStatus({key: queryKey, busy: false, error: String(reason)});
      } finally {
        reading = false;
        if (live && isVisible()) timer = window.setTimeout(() => { void refresh(); }, 30_000);
      }
    };
    const visibilityChanged = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => { live = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibilityChanged); };
  }, [period, account, revision, queryKey, timezone]);

  const totals = snapshot?.totals;
  const accounts = result?.value.accounts ?? [];
  const days = dailySeries(snapshot?.daily ?? [], period, snapshot ? new Date(snapshot.generated_at * 1000) : new Date(), snapshot?.generated_at);
  const models = [...(snapshot?.models ?? [])].sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
  const sortedAccounts = [...(snapshot?.accounts ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.totals.total_tokens - a.totals.total_tokens || a.id.localeCompare(b.id));
  const stamp = snapshot ? new Date(snapshot.generated_at * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
  const rate = (value: UsageTotals) => percent(cacheHitRate(value));
  const trend = summarizeUsageTrend(snapshot ? days : []);
  const dateLabel = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'});
  const range = snapshot ? days.length > 1 && days[0].day.slice(0, 10) !== days.at(-1)!.day.slice(0, 10) ? `${dateLabel(days[0].day)} – ${dateLabel(days.at(-1)!.day)}` : dateLabel(days[0].day) : '—';
  const isHourly = period === 'today' || period === 'yesterday';
  const peakLabel = trend.peak ? isHourly ? trend.peak.day.slice(11) : new Date(`${trend.peak.day}T12:00:00`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'short', day: 'numeric'}) : '';
  const selectedAccount = account === 'all' ? t('usage.allAccounts') : prefs.privacyMask ? t('usage.account') : snapshot?.accounts.find(item => item.id === account)?.name ?? t('usage.account');
  const offsetMinutes = -new Date().getTimezoneOffset();
  const offsetZone = `UTC${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`;
  const activeTz = snapshot?.timezone || timezone;
  const timezoneContext = formatTimezoneContext(activeTz);
  const conciseTimezone = (() => {
    if (!activeTz) return offsetZone;
    try {
      const shortName = new Intl.DateTimeFormat('en-US', {
        timeZone: activeTz,
        timeZoneName: 'short',
      }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value;
      if (shortName && shortName !== activeTz) return shortName;
      return offsetZone;
    } catch {
      return offsetZone;
    }
  })();
  const dstType = isHourly ? getDstDayType(days) : null;
  const primaryModel = models[0]?.model;
  const costSummary = estimateSnapshotCostUsd(totals, models);
  const elapsedBuckets = days.filter(d => !d.future);
  const elapsedUnits = (() => {
    if (!elapsedBuckets.length) return 0;
    const hasIntervals = elapsedBuckets.every(d => d.start_at != null && d.end_at != null && Number.isFinite(d.start_at) && Number.isFinite(d.end_at) && d.end_at > d.start_at);
    return hasIntervals ? elapsedBuckets.reduce((sum, d) => sum + (d.end_at! - d.start_at!) / 3600, 0) : elapsedBuckets.length;
  })();
  const avgBucketCostUsd = totals && elapsedUnits > 0 ? costSummary.costUsd / elapsedUnits : null;
  const peakBucketCostUsd = trend.peak ? estimateTotalsCostUsd(trend.peak.totals, primaryModel).costUsd : null;
  const avgOutputTokens = totals && elapsedUnits > 0 ? totals.output_tokens / elapsedUnits : null;

  const makeExport = () => snapshot ? buildUsageTsv({snapshot, period, periodLabel: t(periods.find(([value]) => value === period)?.[1] ?? 'usage.allTime'), accountLabel: selectedAccount, accountIsAll: account === 'all', timezone: snapshot.timezone || timezone || offsetZone, privacy: prefs.privacyMask, days, generatedLabel: new Date(snapshot.generated_at * 1000).toISOString(), coverageLabel: snapshot.tracking_since == null ? t('usage.exportCoverageUnknown') : `${new Date(snapshot.tracking_since * 1000).toISOString()} – ${new Date(snapshot.generated_at * 1000).toISOString()}`, productLabel: 'Claude-Local', labels: {metadata: t('usage.exportTitle'), summary: t('usage.exportSummary'), daily: t('usage.exportBuckets'), time: t('usage.exportTime'), total: t('usage.total'), input: t('usage.input'), output: t('usage.output'), cacheWrite: t('usage.cacheWrite'), cacheRead: t('usage.cacheRead'), requests: t('usage.requests'), sessions: t('usage.sessions'), activeDays: t('usage.activeDays'), account: t('usage.account'), period: t('usage.periodFilter'), timezone: t('usage.exportTimezone'), generated: t('usage.exportGenerated'), coverage: t('usage.exportCoverage')}}) : '';
  const exportTsv = async (download: boolean) => {
    if (!snapshot || busy) return;
    setExportStatus('');
    const contents = makeExport();
    if (download) {
      const url = URL.createObjectURL(new Blob([contents], {type: 'text/tab-separated-values;charset=utf-8'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'claude-local-usage.tsv'; anchor.click(); URL.revokeObjectURL(url);
      setExportStatus(t('usage.exportDownloaded')); return;
    }
    try { await invoke('copy_result', {text: contents}); }
    catch { if (!navigator.clipboard?.writeText) {setExportStatus(t('usage.exportFailed')); return;} try {await navigator.clipboard.writeText(contents);} catch {setExportStatus(t('usage.exportFailed')); return;} }
    setExportStatus(t('usage.exportCopied'));
  };

  return (
    <section className="system-page usage-page">
      <header className="cleanup-title usage-header">
        <h1>{t('usage.title')}</h1>
        <div className="usage-header-actions">
          <span className="usage-update-indicator" role="status">
            <span className={`usage-update-dot${busy ? ' is-busy' : ''}`} aria-hidden="true" />
            {busy ? t('usage.loading') : stamp ? t('usage.updated', {time: stamp}) : t('usage.localOnly')}
          </span>
          <div className="usage-action-group">
            <Button variant="secondary" size="small" disabled={busy || !snapshot} onClick={() => void exportTsv(false)}>{t('usage.copyTsv')}</Button>
            <Button variant="secondary" size="small" disabled={busy || !snapshot} onClick={() => void exportTsv(true)}>{t('usage.downloadTsv')}</Button>
            <Button variant="secondary" size="small" disabled={busy} leftIcon={<Refresh size={15} aria-hidden="true" className={busy ? 'spin' : ''} />} onClick={() => setRevision(value => value + 1)}>{t('usage.refresh')}</Button>
          </div>
        </div>
      </header>
      {exportStatus && <p className="usage-export-status" role="status">{exportStatus}</p>}
      <div className="usage-content">
        <div className="settings-card usage-filter-card">
          <div className="usage-toolbar">
            <div className="usage-period-filter">
              <span className="usage-filter-label">{t('usage.periodFilter')}</span>
              <div className="usage-period-row">
                <Tabs aria-label={t('usage.periodFilter')} className="usage-periods" value={period} onValueChange={value => setPeriod(value as UsagePeriod)} tabs={periods.map(([value, label]) => ({value, label: t(label)}))} />
                <div className="usage-context">
                  <strong title={snapshot?.tracking_since != null ? `${t('usage.coverageHint')}: ${t('usage.trackingSince', {date: dateLabel(new Date(snapshot.tracking_since * 1000).toISOString())})}` : undefined}>{range}</strong>
                  <span className="usage-section-caption usage-tz-caption" title={`${t('usage.activeTimezoneTitle')}: ${timezoneContext} (${offsetZone})`}>{conciseTimezone}</span>
                  {dstType && <span className="usage-section-caption" title={t(dstType === '23h' ? 'usage.dst23Hint' : 'usage.dst25Hint')}>{t(dstType === '23h' ? 'usage.dst23' : 'usage.dst25')}</span>}
                  {(period !== 'all' || account !== 'all') && <Button variant="ghost" size="small" onClick={() => {setPeriod('all'); setAccount('all');}}>{t('usage.resetFilters')}</Button>}
                </div>
              </div>
            </div>
            <div className="usage-account-filter"><span className="usage-filter-label">{t('usage.accountFilter')}</span><Select aria-label={t('usage.accountFilter')} size="small" value={account} onValueChange={setAccount} items={[{value: 'all', label: t('usage.allAccounts')}, ...accounts.map(row => ({value: row.id, label: prefs.privacyMask ? maskAccountLabel(row, true) : row.name}))]} /></div>
          </div>
        </div>

        {error && <p role="alert" className="system-feedback error usage-error">{t('usage.readFailed')} {t(error)}</p>}
        {snapshot?.warnings.some(code => code !== 'attribution_gap') ? <div className="usage-notice" role="status"><span>{[...new Set(snapshot.warnings.filter(code => code !== 'attribution_gap').map(code => t(warningKeys[code] ?? 'usage.warning.partial')))].join(' · ')}</span></div> : null}

        <div className="usage-overview" aria-busy={busy}>
          <section data-usage-metric="total" className="settings-card usage-total-card">
            <div className="usage-metric-heading"><MetricGlyph kind="total" /><span>{t('usage.total')}</span><small>{t('usage.composition')}</small></div>
            <strong className="usage-total-value" title={num(totals?.total_tokens)}>{num(totals?.total_tokens, true)}<small>Token</small></strong>
            {totals ? <TokenComposition totals={totals} details /> : <div className="usage-composition-placeholder">{t('usage.totalHint')}</div>}
            <p className="usage-overview-note">{t('usage.scopeNote')}</p>
          </section>
          <div className="usage-summary">
            <div data-usage-metric="cost" className="settings-card usage-metric" title={totals ? t('usage.costTooltipBreakdown', {input: formatUsdCost(costSummary.inputCostUsd), output: formatUsdCost(costSummary.outputCostUsd), write: formatUsdCost(costSummary.cacheWriteCostUsd), read: formatUsdCost(costSummary.cacheReadCostUsd)}) : t('usage.estimatedCostHint')}>
              <div className="usage-metric-heading"><MetricGlyph kind="cost" /><span>{t('usage.estimatedCost')}</span></div>
              <strong>{totals ? formatUsdCost(costSummary.costUsd) : '—'}</strong>
              <small>{totals && costSummary.costUsd > 0 ? t('usage.costBreakdownSub', {output: formatUsdCost(costSummary.outputCostUsd, true), cache: formatUsdCost(costSummary.cacheWriteCostUsd + costSummary.cacheReadCostUsd, true)}) : t('usage.estimatedCostHint')}</small>
            </div>
            <div data-usage-metric="savings" className="settings-card usage-metric" title={t('usage.cacheSavingsHint')}>
              <div className="usage-metric-heading"><MetricGlyph kind="savings" /><span>{t('usage.cacheSavings')}</span></div>
              <strong title={totals ? formatUsdCost(costSummary.cacheSavingsUsd) : undefined}>{totals ? formatUsdCost(costSummary.cacheSavingsUsd, true) : '—'}</strong>
              <small>{totals && costSummary.savingsRate != null ? t('usage.cacheSavingsRate', {rate: percent(costSummary.savingsRate)}) : t('usage.cacheSavingsHint')}</small>
            </div>
            <div data-usage-metric="cache" className="settings-card usage-metric">
              <div className="usage-metric-heading"><MetricGlyph kind="cache" /><span>{t('usage.cacheHit')}</span></div>
              <strong>{totals ? rate(totals) : '—'}</strong>
              <small>{totals && costSummary.cacheReuseRatio != null ? t('usage.cacheReuseSub', {ratio: costSummary.cacheReuseRatio.toFixed(1)}) : t('usage.cacheHitHint')}</small>
            </div>
            <div data-usage-metric="pace" className="settings-card usage-metric" title={t('usage.paceHint')}>
              <div className="usage-metric-heading"><MetricGlyph kind="pace" /><span>{t(isHourly ? 'usage.hourlyCostPace' : 'usage.dailyCostPace')}</span></div>
              <strong>{totals && avgBucketCostUsd != null ? formatUsdCost(avgBucketCostUsd) : '—'}</strong>
              <small>{trend.peak && peakBucketCostUsd != null && peakLabel ? t('usage.peakCostSub', {cost: formatUsdCost(peakBucketCostUsd), label: peakLabel}) : t('usage.paceHint')}</small>
            </div>
          </div>
        </div>

        {!snapshot && busy && <p className="usage-empty" role="status">{t('usage.firstScan')}</p>}
        {snapshot && !totals?.requests && <div className="usage-empty"><strong>{t('usage.empty')}</strong><span>{t('usage.emptyHint')}</span></div>}
        {snapshot && <>
          <div className="usage-analysis-grid" data-trend-view={trendView}>
          <section className="settings-card usage-chart-card">
            <div className="usage-panel-header"><div><GroupTitle>{t('usage.daily')}</GroupTitle></div><Tabs aria-label={t('usage.trendView')} size="small" value={trendView} onValueChange={value => setTrendView(value as 'chart' | 'data')} tabs={[{value: 'chart', label: t('usage.chartView')}, {value: 'data', label: t('usage.dataView')}]} /></div>
            <div className="usage-chart-summary" title={t('usage.averageHint')}>
              <div><span>{t(isHourly ? 'usage.averageHour' : 'usage.averageDay')}</span><strong title={num(trend.average)}>{num(trend.average, true)}<small>Token</small></strong></div>
              <div><span>{t(isHourly ? 'usage.peakHour' : 'usage.peakDay')}</span><strong title={num(trend.peak?.totals.total_tokens)}>{num(trend.peak?.totals.total_tokens, true)}<small>{peakLabel}</small></strong></div>
              <div><span>{t('usage.outputThroughput')}</span><strong title={num(totals?.output_tokens)}>{num(totals?.output_tokens, true)}<small>{avgOutputTokens != null ? t(isHourly ? 'usage.outputHourlyAvg' : 'usage.outputDailyAvg', {avg: num(Math.round(avgOutputTokens), true)}) : 'Token'}</small></strong></div>
            </div>
            {trendView === 'chart' ? <div className="usage-chart-body"><UsageTrend days={days} hourly={isHourly} timezone={snapshot.timezone} /></div> : <UsageTrendTable key={queryKey} days={days} hourly={isHourly} timezone={snapshot.timezone} />}
            <div className="usage-chart-caption"><span><i aria-hidden="true" />{t('usage.total')}</span><span>{t(trendView === 'chart' ? 'usage.trendHint' : 'usage.tableHint')}</span></div>
          </section>
          <section className="settings-card usage-model-card">
            <div className="usage-panel-header"><div><GroupTitle aside={String(models.length)}>{t('usage.models')}</GroupTitle><p>{t('usage.modelsHint')}</p></div></div>
            <div className="usage-models">
              {models.length ? models.map(row => {
                const family = detectModelFamily(row.model);
                const efforts = row.efforts ?? [];
                const modelCost = estimateTotalsCostUsd(row.totals, row.model);
                return (
                  <div className="usage-model-row" key={row.model} data-model-family={family.key}>
                    <div>
                      <span className="usage-model-title">
                        {family.label && <em className="usage-model-family" data-family={family.key}>{family.label}</em>}
                        <strong title={row.model === 'unknown' ? t('usage.unknownModel') : row.model}>{row.model === 'unknown' ? t('usage.unknownModel') : row.model}</strong>
                      </span>
                      <span title={num(row.totals.total_tokens)}>{num(row.totals.total_tokens, true)}<small>{percent(totals?.total_tokens ? row.totals.total_tokens / totals.total_tokens : 0)}</small></span>
                    </div>
                    <div className="usage-model-track"><span style={{width: `${totals?.total_tokens ? Math.min(100, row.totals.total_tokens / totals.total_tokens * 100) : 0}%`}} /></div>
                    <div className="usage-model-caption">
                      <small>{t('usage.modelCostCaption', {cost: formatUsdCost(modelCost.costUsd), output: num(row.totals.output_tokens, true)})}</small>
                      <small>{t('usage.modelCacheCaption', {rate: rate(row.totals), savings: formatUsdCost(modelCost.cacheSavingsUsd, true)})}</small>
                    </div>
                    <TokenComposition totals={row.totals} />
                    {efforts.length > 0 && (
                      <div className="usage-model-efforts" aria-label={t('usage.effortBreakdown')}>
                        <div className="usage-effort-header">
                          <span>{t('usage.effortBreakdown')}</span>
                          <span>{efforts.map(ef => ef.effort).join(' · ')}</span>
                        </div>
                        <div className="usage-effort-list">
                          {efforts.map(ef => {
                            const efShare = row.totals.total_tokens ? ef.totals.total_tokens / row.totals.total_tokens : 0;
                            const efCost = estimateTotalsCostUsd(ef.totals, row.model);
                            return (
                              <div className="usage-effort-row" key={ef.effort} data-effort={ef.effort}>
                                <div className="usage-effort-top">
                                  <span className="usage-effort-badge" data-effort={ef.effort}>{ef.effort}</span>
                                  <small>{t('usage.effortCost', {cost: formatUsdCost(efCost.costUsd)})}</small>
                                  <strong title={num(ef.totals.total_tokens)}>{num(ef.totals.total_tokens, true)} <small>({percent(efShare)})</small></strong>
                                </div>
                                <div className="usage-effort-track"><span data-effort={ef.effort} style={{width: `${Math.min(100, Math.max(2, efShare * 100))}%`}} /></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }) : <p className="usage-model-empty">{t('usage.noModelData')}</p>}
            </div>
            <div className="usage-model-footer">
              <span>{t('usage.estimatedCost')} <strong>{totals ? formatUsdCost(costSummary.costUsd) : '—'}</strong></span>
              <span>{t('usage.cacheSavings')} <strong>{totals ? formatUsdCost(costSummary.cacheSavingsUsd, true) : '—'}</strong></span>
            </div>
          </section>
          </div>

          <section className="settings-card usage-accounts-card">
            <div className="usage-panel-header"><div><GroupTitle aside={String(sortedAccounts.length)}>{t('usage.accounts')}</GroupTitle></div></div>
            <div className="usage-table-wrap" role="region" aria-label={t('usage.accounts')} tabIndex={0}>
              <table className="usage-table" aria-label={t('usage.accounts')}><thead><tr><th scope="col">{t('usage.account')}</th><th scope="col">{t('usage.total')}</th><th scope="col">{t('usage.estimatedCost')}</th><th scope="col">{t('usage.input')}</th><th scope="col">{t('usage.output')}</th><th scope="col">{t('usage.cacheWrite')}</th><th scope="col">{t('usage.cacheRead')}</th><th scope="col">{t('usage.cacheHit')}</th></tr></thead>
                <tbody>{sortedAccounts.map(row => <tr key={row.id} className={account === row.id ? 'usage-row-selected' : ''}><th scope="row"><button type="button" className="usage-account-name" onClick={() => setAccount(row.id)}><span>{maskDisplayName(row.name, row.email, prefs.privacyMask)}{row.current && <em>{t('usage.current')}</em>}</span>{row.email && <small>{maskEmailAddress(row.email, prefs.privacyMask)}</small>}</button></th><td title={num(row.totals.total_tokens)}>{num(row.totals.total_tokens, true)}</td><td title={formatUsdCost(estimateTotalsCostUsd(row.totals, primaryModel).costUsd)}>{formatUsdCost(estimateTotalsCostUsd(row.totals, primaryModel).costUsd)}</td><td title={num(row.totals.input_tokens)}>{num(row.totals.input_tokens, true)}</td><td title={num(row.totals.output_tokens)}>{num(row.totals.output_tokens, true)}</td><td title={num(row.totals.cache_creation_tokens)}>{num(row.totals.cache_creation_tokens, true)}</td><td title={num(row.totals.cache_read_tokens)}>{num(row.totals.cache_read_tokens, true)}</td><td>{rate(row.totals)}</td></tr>)}
                </tbody>
              </table>
              {!sortedAccounts.length && <p className="usage-model-empty">{t('usage.noAccounts')}</p>}
            </div>
          </section>
        </>}
        <Disclosure className="usage-method settings-card" triggerClassName="usage-method-trigger" summary={t('usage.method')}><div className="usage-method-body"><p>{t('usage.logCounters')}</p><p>{t('usage.totalFormula')}</p><p>{t('usage.cacheFormula')}</p><p>{t('usage.activityMethod')}</p><p>{t('usage.coverageNote')}</p><p>{t('usage.refreshNote')}</p><p>{t('usage.timezoneNote')}</p>{snapshot?.tracking_since != null && <p>{t('usage.trackingSince', {date: dateLabel(new Date(snapshot.tracking_since * 1000).toISOString())})}</p>}</div></Disclosure>
      </div>
    </section>
  );
}
