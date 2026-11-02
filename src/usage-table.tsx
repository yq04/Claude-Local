/**
 * [INPUT]: Hourly or daily numeric usage buckets, future markers, optional primary model and the shared locale.
 * [OUTPUT]: Sortable, ten-row paginated period details with compact counters, cache write/hit rate, equivalent USD cost and exact-value titles.
 * [POS]: Pure usage presentation; future hours are excluded and view changes make no native requests.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useState} from 'react';
import {useI18n} from './i18n';
import {
  cacheHitRate,
  estimateTotalsCostUsd,
  formatUsageNumber,
  formatUsdCost,
  type UsageDay,
} from './usage-model';

export type SortField = 'day' | 'total_tokens' | 'cost' | 'requests';
const pageSize = 10;

export function UsageTrendTable({days, hourly = false, timezone, primaryModel}: {days: UsageDay[]; hourly?: boolean; timezone?: string; primaryModel?: string}) {
  const {t, locale} = useI18n();
  const [sort, setSort] = useState<{key: SortField; descending: boolean}>({key: 'day', descending: true});
  const [page, setPage] = useState(0);
  const rows = days.filter(day => !day.future).sort((a, b) => {
    const time = a.start_at != null && b.start_at != null ? a.start_at - b.start_at : a.day.localeCompare(b.day);
    const comparison =
      sort.key === 'day'
        ? time
        : sort.key === 'cost'
          ? estimateTotalsCostUsd(a.totals, primaryModel).costUsd - estimateTotalsCostUsd(b.totals, primaryModel).costUsd
          : a.totals[sort.key] - b.totals[sort.key];
    return comparison ? comparison * (sort.descending ? -1 : 1) : (b.start_at ?? 0) - (a.start_at ?? 0) || b.day.localeCompare(a.day);
  });
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage(value => Math.min(value, pages - 1)), [pages]);

  const selectSort = (key: SortField) => {
    setSort(value => ({key, descending: value.key === key ? !value.descending : true}));
    setPage(0);
  };
  const header = (key: SortField, label: string) => {
    const active = sort.key === key;
    return <th scope="col" aria-sort={active ? sort.descending ? 'descending' : 'ascending' : 'none'}>
      <button type="button" className={`usage-sort-button${active ? ' is-active' : ''}`} title={t('usage.sortColumn', {column: label})} onClick={() => selectSort(key)}>
        {label}<svg className="usage-sort-icon" width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 5 3-3 3 3" opacity={active && !sort.descending ? 1 : 0.3} />
          <path d="m3 9 3 3 3-3" opacity={active && sort.descending ? 1 : 0.3} />
        </svg>
      </button>
    </th>;
  };
  const periodLabel = (day: UsageDay) => {
    if (!hourly) return new Date(`${day.day.slice(0, 10)}T12:00:00`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'});
    if (day.start_at != null && day.end_at != null) {
      const opts: Intl.DateTimeFormatOptions = {hour: '2-digit', minute: '2-digit', ...(timezone ? {timeZone: timezone} : {})};
      const start = new Date(day.start_at * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {...opts, timeZoneName: 'short'});
      const end = new Date(day.end_at * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', opts);
      return `${start} – ${end}`;
    }
    return t('usage.hourRange', {start: day.day.slice(11, 16), end: `${String(Number(day.day.slice(11, 13)) + 1).padStart(2, '0')}:00`});
  };
  const valueCell = (value: number) => <td title={formatUsageNumber(value, locale)}>{formatUsageNumber(value, locale, true)}</td>;

  return <div className="usage-trend-table">
    {rows.length ? <>
      <div className="usage-data-scroll" tabIndex={0} role="region" aria-label={t('usage.periodTable')}>
        <table className="usage-data-table" aria-label={t('usage.periodTable')}>
          <thead><tr>{header('day', t('usage.time'))}{header('total_tokens', t('usage.total'))}{header('cost', t('usage.estimatedCost'))}<th scope="col">{t('usage.input')}</th><th scope="col">{t('usage.output')}</th><th scope="col">{t('usage.cacheWrite')}</th><th scope="col">{t('usage.cacheRead')}</th><th scope="col">{t('usage.cacheHit')}</th>{header('requests', t('usage.requests'))}</tr></thead>
          <tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => {
            const costUsd = estimateTotalsCostUsd(row.totals, primaryModel).costUsd;
            const hit = cacheHitRate(row.totals);
            return <tr key={row.start_at ?? row.day}>
              <th scope="row" title={row.day}>{periodLabel(row)}</th>{valueCell(row.totals.total_tokens)}<td title={formatUsdCost(costUsd)}>{formatUsdCost(costUsd)}</td>{valueCell(row.totals.input_tokens)}{valueCell(row.totals.output_tokens)}{valueCell(row.totals.cache_creation_tokens)}{valueCell(row.totals.cache_read_tokens)}<td>{hit == null ? '—' : `${Math.round(hit * 100)}%`}</td>{valueCell(row.totals.requests)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="usage-pagination">
        <span role="status">{t('usage.pageInfo', {page: currentPage + 1, pages, count: formatUsageNumber(rows.length, locale)})}</span>
        <div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('usage.previousPage')}</button><button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>{t('usage.nextPage')}</button></div>
      </div>
    </> : <p className="usage-model-empty" role="status">{t('usage.noPeriodData')}</p>}
  </div>;
}
