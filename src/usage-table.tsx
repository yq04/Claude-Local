/**
 * [INPUT]: Hourly or daily numeric usage buckets, future markers and the shared locale.
 * [OUTPUT]: Sortable, ten-row paginated period details with compact counters and exact-value titles.
 * [POS]: Pure usage presentation; future hours are excluded and view changes make no native requests.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useState} from 'react';
import {useI18n} from './i18n';
import {formatUsageNumber, type UsageDay} from './usage-model';

type SortKey = 'day' | 'total_tokens' | 'requests';
const pageSize = 10;

export function UsageTrendTable({days, hourly = false, timezone}: {days: UsageDay[]; hourly?: boolean; timezone?: string}) {
  const {t, locale} = useI18n();
  const [sort, setSort] = useState<{key: SortKey; descending: boolean}>({key: 'day', descending: true});
  const [page, setPage] = useState(0);
  const rows = days.filter(day => !day.future).sort((a, b) => {
    const time = a.start_at != null && b.start_at != null ? a.start_at - b.start_at : a.day.localeCompare(b.day);
    const comparison = sort.key === 'day' ? time : a.totals[sort.key] - b.totals[sort.key];
    return comparison ? comparison * (sort.descending ? -1 : 1) : (b.start_at ?? 0) - (a.start_at ?? 0) || b.day.localeCompare(a.day);
  });
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage(value => Math.min(value, pages - 1)), [pages]);

  const selectSort = (key: SortKey) => {
    setSort(value => ({key, descending: value.key === key ? !value.descending : true}));
    setPage(0);
  };
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return <th scope="col" aria-sort={active ? sort.descending ? 'descending' : 'ascending' : 'none'}>
      <button type="button" className="usage-sort-button" title={t('usage.sortColumn', {column: label})} onClick={() => selectSort(key)}>
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
          <thead><tr>{header('day', t('usage.time'))}{header('total_tokens', t('usage.total'))}<th scope="col">{t('usage.input')}</th><th scope="col">{t('usage.output')}</th><th scope="col">{t('usage.cacheRead')}</th>{header('requests', t('usage.requests'))}</tr></thead>
          <tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => <tr key={row.start_at ?? row.day}>
            <th scope="row" title={row.day}>{periodLabel(row)}</th>{valueCell(row.totals.total_tokens)}{valueCell(row.totals.input_tokens)}{valueCell(row.totals.output_tokens)}{valueCell(row.totals.cache_read_tokens)}{valueCell(row.totals.requests)}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="usage-pagination">
        <span role="status">{t('usage.pageInfo', {page: currentPage + 1, pages, count: formatUsageNumber(rows.length, locale)})}</span>
        <div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('usage.previousPage')}</button><button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>{t('usage.nextPage')}</button></div>
      </div>
    </> : <p className="usage-model-empty" role="status">{t('usage.noPeriodData')}</p>}
  </div>;
}
