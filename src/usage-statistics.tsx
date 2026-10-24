/**
 * [INPUT]: Native numeric usage aggregates, shared locale and display/privacy preferences.
 * [OUTPUT]: Label-sized account filters, fallback-attributed metrics, responsive trend/model panels and sortable time-bucket views; period and chart/data switches use Cromma Tabs, the method note uses Disclosure.
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
import {cacheHitRate, dailySeries, formatUsageNumber, summarizeUsageTrend, type UsagePeriod, type UsageSnapshot, type UsageTotals} from './usage-model';
import {UsageTrend} from './usage-trend';
import {UsageTrendTable} from './usage-table';
import {buildUsageTsv} from './usage-export';
import {formatTimezoneContext, getDstDayType, maskAccountLabel, previewAttributionScope} from './usage-attribution';

const periods: readonly [UsagePeriod, string][] = [['today', 'usage.today'], ['week', 'usage.week'], ['month', 'usage.month'], ['all', 'usage.allTime']];
const warningKeys: Record<string, string> = {
  partial_scan: 'usage.warning.partial', invalid_records: 'usage.warning.invalid',
  weak_ids: 'usage.warning.weak',
};

function GroupTitle({children, aside}: {children: ReactNode; aside?: ReactNode}) {
  return <div className="settings-group-heading usage-group-heading"><span className="settings-group-bar" aria-hidden="true" /><h2>{children}</h2>{aside && <span className="usage-section-caption">{aside}</span>}</div>;
}

function MetricGlyph({kind}: {kind: 'total' | 'input' | 'output' | 'cache'}) {
  return <span className="usage-metric-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'total' ? <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></> : kind === 'input' ? <><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></> : kind === 'output' ? <><path d="M12 16V4m-4 4 4-4 4 4M5 17v4h14v-4" /></> : <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v14c0 4 14 4 14 0V5M5 12c0 4 14 4 14 0" /></>}
  </svg></span>;
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
  const [pendingTargetId, setPendingTargetId] = useState('');
  const [attributionBusy, setAttributionBusy] = useState(false);
  const [attributionFeedback, setAttributionFeedback] = useState<{type: 'success' | 'error'; message: string} | null>(null);
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
  const peakLabel = trend.peak ? period === 'today' ? trend.peak.day.slice(11) : new Date(`${trend.peak.day}T12:00:00`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'short', day: 'numeric'}) : '';
  const selectedAccount = account === 'all' ? t('usage.allAccounts') : prefs.privacyMask ? t('usage.account') : snapshot?.accounts.find(item => item.id === account)?.name ?? t('usage.allAccounts');
  const offsetMinutes = -new Date().getTimezoneOffset();
  const offsetZone = `UTC${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`;
  const handleSetAttribution = async (targetId: string) => {
    if (!targetId || attributionBusy) return;
    setAttributionBusy(true);
    setAttributionFeedback(null);
    try {
      await invoke('usage_attribution_set', {accountId: targetId});
      setAttributionFeedback({type: 'success', message: t('usage.attributionApplied')});
      setPendingTargetId('');
      setRevision(value => value + 1);
    } catch (err) {
      setAttributionFeedback({type: 'error', message: t('usage.attributionFailed') + ': ' + String(err)});
    } finally {
      setAttributionBusy(false);
    }
  };

  const handleClearAttribution = async () => {
    if (attributionBusy) return;
    setAttributionBusy(true);
    setAttributionFeedback(null);
    try {
      await invoke('usage_attribution_clear');
      setAttributionFeedback({type: 'success', message: t('usage.attributionCleared')});
      setPendingTargetId('');
      setRevision(value => value + 1);
    } catch (err) {
      setAttributionFeedback({type: 'error', message: t('usage.attributionFailed') + ': ' + String(err)});
    } finally {
      setAttributionBusy(false);
    }
  };

  const timezoneContext = formatTimezoneContext(snapshot?.timezone || timezone);
  const dstType = period === 'today' ? getDstDayType(days) : null;
  const previewScope = previewAttributionScope(snapshot?.attribution, pendingTargetId, accounts);

  const makeExport = () => snapshot ? buildUsageTsv({snapshot, period, periodLabel: t(periods.find(([value]) => value === period)?.[1] ?? 'usage.allTime'), accountLabel: selectedAccount, accountIsAll: account === 'all', timezone: snapshot.timezone || timezone || offsetZone, privacy: prefs.privacyMask, days, generatedLabel: new Date(snapshot.generated_at * 1000).toISOString(), coverageLabel: snapshot.tracking_since == null ? t('usage.exportCoverageUnknown') : `${new Date(snapshot.tracking_since * 1000).toISOString()} – ${new Date(snapshot.generated_at * 1000).toISOString()}`, productLabel: 'Claude-Local', labels: {metadata: t('usage.exportTitle'), summary: t('usage.exportSummary'), daily: t('usage.exportBuckets'), time: t('usage.exportTime'), total: t('usage.total'), input: t('usage.input'), output: t('usage.output'), cacheWrite: t('usage.cacheWrite'), cacheRead: t('usage.cacheRead'), requests: t('usage.requests'), account: t('usage.account'), period: t('usage.periodFilter'), timezone: t('usage.exportTimezone'), generated: t('usage.exportGenerated'), coverage: t('usage.exportCoverage')}}) : '';
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
          <span role="status">{busy ? t('usage.loading') : stamp ? t('usage.updated', {time: stamp}) : t('usage.localOnly')}</span>
          <Button variant="secondary" size="small" disabled={busy || !snapshot} onClick={() => void exportTsv(false)}>{t('usage.copyTsv')}</Button>
          <Button variant="secondary" size="small" disabled={busy || !snapshot} onClick={() => void exportTsv(true)}>{t('usage.downloadTsv')}</Button>
          <Button variant="secondary" size="small" disabled={busy} leftIcon={<Refresh size={15} aria-hidden="true" className={busy ? 'spin' : ''} />} onClick={() => setRevision(value => value + 1)}>{t('usage.refresh')}</Button>
        </div>
      </header>
      {exportStatus && <p className="usage-export-status" role="status">{exportStatus}</p>}
      <div className="usage-content">
        <div className="settings-card usage-filter-card">
        <div className="usage-toolbar">
          <div className="usage-period-filter"><span className="usage-filter-label">{t('usage.periodFilter')}</span>
          <Tabs aria-label={t('usage.periodFilter')} className="usage-periods" value={period} onValueChange={value => setPeriod(value as UsagePeriod)} tabs={periods.map(([value, label]) => ({value, label: t(label)}))} />
          </div>
          <div className="usage-account-filter"><span className="usage-filter-label">{t('usage.accountFilter')}</span><Select aria-label={t('usage.accountFilter')} size="small" value={account} onValueChange={setAccount} items={[{value: 'all', label: t('usage.allAccounts')}, ...accounts.map(row => ({value: row.id, label: prefs.privacyMask ? maskAccountLabel(row, true) : row.name}))]} /></div>
        </div>
        <div className="usage-filter-footer">
          <div className="usage-context">
            <strong>{range}</strong>
            <span className="usage-section-caption" title={t('usage.activeTimezoneTitle')}>{timezoneContext}</span>
            {dstType && <span className="usage-section-caption" title={t(dstType === '23h' ? 'usage.dst23Hint' : 'usage.dst25Hint')}>{t(dstType === '23h' ? 'usage.dst23' : 'usage.dst25')}</span>}
            {snapshot?.tracking_since != null && <span className="usage-section-caption" title={t('usage.coverageHint')}>{t('usage.trackingSince', {date: dateLabel(new Date(snapshot.tracking_since * 1000).toISOString())})}</span>}
          </div>
          {(period !== 'all' || account !== 'all') && <Button variant="ghost" size="small" onClick={() => {setPeriod('all'); setAccount('all');}}>{t('usage.resetFilters')}</Button>}
        </div>
        </div>

        <div className="settings-card usage-attribution-card">
          <div className="usage-attribution-head">
            <div className="usage-attribution-copy">
              <strong>{t('usage.attributionTitle')}</strong>
              <span className="usage-attribution-desc">{t('usage.attributionDesc')}</span>
            </div>
            {snapshot?.attribution?.fallback_account_id ? (
              <Button variant="ghost" size="small" disabled={busy || attributionBusy} onClick={() => void handleClearAttribution()}>{t('usage.attributionClear')}</Button>
            ) : null}
          </div>

          {snapshot?.attribution?.fallback_account_id ? (
            <div className="usage-attribution-body">
              <div>
                <span>{t('usage.attributionCurrentAccount')}: </span>
                <strong>{prefs.privacyMask ? maskAccountLabel({id: snapshot.attribution.fallback_account_id, name: snapshot.attribution.fallback_account_name || snapshot.attribution.fallback_account_id}, true) : (snapshot.attribution.fallback_account_name || snapshot.attribution.fallback_account_id)}</strong>
                <span className="usage-attribution-scope">
                  {t('usage.attributionCoveredScope', {requests: num(snapshot.attribution.unassigned_requests, true), tokens: num(snapshot.attribution.unassigned_tokens, true)})}
                </span>
              </div>
              <div className="usage-attribution-actions">
                <Select aria-label={t('usage.attributionChange')} size="small" value="" onValueChange={(id) => { if (id && id !== snapshot.attribution?.fallback_account_id) void handleSetAttribution(id); }} items={[{value: '', label: t('usage.attributionChange')}, ...accounts.filter(a => a.id !== snapshot.attribution?.fallback_account_id).map(a => ({value: a.id, label: prefs.privacyMask ? maskAccountLabel(a, true) : a.name}))]} />
              </div>
            </div>
          ) : (
            <div className="usage-attribution-body">
              <div className="usage-attribution-copy">
                <span>
                  {snapshot?.attribution?.unassigned_requests
                    ? t('usage.attributionUnassignedAvailable', {requests: num(snapshot.attribution.unassigned_requests, true), tokens: num(snapshot.attribution.unassigned_tokens, true)})
                    : t('usage.attributionNoUnassigned')}
                </span>
                {previewScope && (
                  <small className="usage-attribution-preview">
                    {t('usage.attributionPreviewPrompt', {account: previewScope.targetName, requests: num(previewScope.requests, true), tokens: num(previewScope.tokens, true)})}
                  </small>
                )}
              </div>
              <div className="usage-attribution-actions">
                <Select aria-label={t('usage.attributionSelectAccount')} size="small" value={pendingTargetId} onValueChange={setPendingTargetId} items={[{value: '', label: t('usage.attributionSelectPlaceholder')}, ...accounts.map(a => ({value: a.id, label: prefs.privacyMask ? maskAccountLabel(a, true) : a.name}))]} />
                <Button variant="secondary" size="small" disabled={!pendingTargetId || busy || attributionBusy} onClick={() => void handleSetAttribution(pendingTargetId)}>{t('usage.attributionConfirm')}</Button>
              </div>
            </div>
          )}
          {attributionFeedback && (
            <p className={`usage-attribution-feedback ${attributionFeedback.type === 'error' ? 'error' : ''}`}>{attributionFeedback.message}</p>
          )}
        </div>

        {error && <p role="alert" className="system-feedback error usage-error">{t('usage.readFailed')} {t(error)}</p>}
        {snapshot?.warnings.some(code => code !== 'attribution_gap') ? <div className="usage-notice" role="status"><span>{[...new Set(snapshot.warnings.filter(code => code !== 'attribution_gap').map(code => t(warningKeys[code] ?? 'usage.warning.partial')))].join(' · ')}</span></div> : null}

        <div className="usage-summary" aria-busy={busy}>
          {([
            ['usage.total', totals?.total_tokens, 'usage.totalHint', 'total'],
            ['usage.input', totals?.input_tokens, 'usage.inputHint', 'input'],
            ['usage.output', totals?.output_tokens, 'usage.outputHint', 'output'],
          ] as const).map(([label, value, hint, kind]) => <div key={label} data-usage-metric={kind} className="settings-card usage-metric"><div className="usage-metric-heading"><MetricGlyph kind={kind} /><span>{t(label)}</span></div><strong title={num(value)}>{num(value, true)}</strong><small>{t(hint)}</small></div>)}
          <div data-usage-metric="cache" className="settings-card usage-metric"><div className="usage-metric-heading"><MetricGlyph kind="cache" /><span>{t('usage.cacheHit')}</span></div><strong>{totals ? rate(totals) : '—'}</strong><small>{t('usage.cacheHitHint')}</small></div>
        </div>

        <div className="settings-card usage-details">
          <div><span>{t('usage.requests')}</span><strong title={num(totals?.requests)}>{num(totals?.requests, true)}</strong></div>
          <div><span>{t('usage.cacheWrite')}</span><strong title={num(totals?.cache_creation_tokens)}>{num(totals?.cache_creation_tokens, true)}</strong></div>
          <div><span>{t('usage.cacheRead')}</span><strong title={num(totals?.cache_read_tokens)}>{num(totals?.cache_read_tokens, true)}</strong></div>
        </div>

        {!snapshot && busy && <p className="usage-empty" role="status">{t('usage.firstScan')}</p>}
        {snapshot && !totals?.requests && <div className="usage-empty"><strong>{t('usage.empty')}</strong><span>{t('usage.emptyHint')}</span></div>}
        {snapshot && <>
          <div className="usage-analysis-grid" data-trend-view={trendView}>
          <section className="settings-card usage-chart-card">
            <div className="usage-panel-header"><div><GroupTitle>{t('usage.daily')}</GroupTitle><p>{period === 'today' ? t('usage.hourly') : period === 'all' ? t('usage.fullHistory') : t('usage.localDays')}</p></div><Tabs aria-label={t('usage.trendView')} size="small" value={trendView} onValueChange={value => setTrendView(value as 'chart' | 'data')} tabs={[{value: 'chart', label: t('usage.chartView')}, {value: 'data', label: t('usage.dataView')}]} /></div>
            <div className="usage-chart-summary" title={t('usage.averageHint')}><div><span>{t(period === 'today' ? 'usage.averageHour' : 'usage.averageDay')}</span><strong title={num(trend.average)}>{num(trend.average, true)}<small>Token</small></strong></div><div><span>{t(period === 'today' ? 'usage.peakHour' : 'usage.peakDay')}</span><strong title={num(trend.peak?.totals.total_tokens)}>{num(trend.peak?.totals.total_tokens, true)}<small>{peakLabel}</small></strong></div></div>
            {trendView === 'chart' ? <div className="usage-chart-body"><UsageTrend days={days} hourly={period === 'today'} timezone={snapshot.timezone} /></div> : <UsageTrendTable key={queryKey} days={days} hourly={period === 'today'} timezone={snapshot.timezone} />}
            <div className="usage-chart-caption"><span><i aria-hidden="true" />{t('usage.total')}</span><span>{t(trendView === 'chart' ? 'usage.trendHint' : 'usage.tableHint')}</span></div>
          </section>
          <section className="settings-card usage-model-card">
            <div className="usage-panel-header"><div><GroupTitle aside={String(models.length)}>{t('usage.models')}</GroupTitle><p>{t('usage.topModels')}</p></div></div>
            <div className="usage-models">
              {models.length ? models.slice(0, 6).map(row => <div className="usage-model-row" key={row.model}><div><strong title={row.model === 'unknown' ? t('usage.unknownModel') : row.model}>{row.model === 'unknown' ? t('usage.unknownModel') : row.model}</strong><span title={num(row.totals.total_tokens)}>{num(row.totals.total_tokens, true)}</span></div><div className="usage-model-track"><span style={{width: `${totals?.total_tokens ? Math.min(100, row.totals.total_tokens / totals.total_tokens * 100) : 0}%`}} /></div><div className="usage-model-caption"><small>{t('usage.responseCount', {n: num(row.totals.requests, true)})}</small><small>{t('usage.modelShare', {share: percent(totals?.total_tokens ? row.totals.total_tokens / totals.total_tokens : 0)})}</small></div></div>) : <p className="usage-model-empty">{t('usage.noModelData')}</p>}
            </div>
          </section>
          </div>

          <section className="settings-card usage-accounts-card">
            <div className="usage-panel-header"><div><GroupTitle aside={String(sortedAccounts.length)}>{t('usage.accounts')}</GroupTitle></div></div>
            <div className="usage-table-wrap" role="region" aria-label={t('usage.accounts')} tabIndex={0}>
              <table className="usage-table" aria-label={t('usage.accounts')}><thead><tr><th scope="col">{t('usage.account')}</th><th scope="col">{t('usage.total')}</th><th scope="col">{t('usage.input')}</th><th scope="col">{t('usage.output')}</th><th scope="col">{t('usage.cacheRead')}</th><th scope="col">{t('usage.cacheHit')}</th></tr></thead>
                <tbody>{sortedAccounts.map(row => <tr key={row.id} className={account === row.id ? 'usage-row-selected' : ''}><th scope="row"><button type="button" className="usage-account-name" onClick={() => setAccount(row.id)}><span>{maskDisplayName(row.name, row.email, prefs.privacyMask)}{row.current && <em>{t('usage.current')}</em>}</span>{row.email && <small>{maskEmailAddress(row.email, prefs.privacyMask)}</small>}</button></th><td title={num(row.totals.total_tokens)}>{num(row.totals.total_tokens, true)}</td><td title={num(row.totals.input_tokens)}>{num(row.totals.input_tokens, true)}</td><td title={num(row.totals.output_tokens)}>{num(row.totals.output_tokens, true)}</td><td title={num(row.totals.cache_read_tokens)}>{num(row.totals.cache_read_tokens, true)}</td><td>{rate(row.totals)}</td></tr>)}</tbody>
              </table>
              {!sortedAccounts.length && <p className="usage-model-empty">{t('usage.noAccounts')}</p>}
            </div>
          </section>
        </>}
        <Disclosure className="usage-method settings-card" triggerClassName="usage-method-trigger" summary={t('usage.method')}><div className="usage-method-body"><p>{t('usage.logCounters')}</p><p>{t('usage.totalFormula')}</p><p>{t('usage.cacheFormula')}</p><p>{t('usage.timezoneNote')}</p></div></Disclosure>
      </div>
    </section>
  );
}
