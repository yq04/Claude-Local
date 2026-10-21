// [INPUT]: Synthetic token counters and fixed local calendar dates.
// [OUTPUT]: Cache denominator, precise counters, calendar spans and elapsed-only trend summary regressions.
// [POS]: Pure presentation tests; no runtime identities or browser profiles.
// [PROTOCOL]: Keep tests proportional to the usage presentation contract.
import {expect, test} from 'bun:test';
import {cacheHitRate, dailySeries, emptyUsage, formatUsageNumber, summarizeUsageTrend} from './usage-model';

test('cache hits include creation and uncached prompt tokens in the denominator', () => {
  expect(cacheHitRate({...emptyUsage(), input_tokens: 20, cache_creation_tokens: 20, cache_read_tokens: 60})).toBe(0.6);
  expect(cacheHitRate({...emptyUsage(), output_tokens: 500})).toBeNull();
});
test('zero, missing reasoning and large token values stay distinct', () => {
  expect(formatUsageNumber(0, 'en')).toBe('0');
  expect(formatUsageNumber(null, 'en')).toBe('—');
  expect(formatUsageNumber(1234567, 'en')).toBe('1,234,567');
});
test('compact usage uses consistent K/M/B suffixes in both locales, including rounded boundaries', () => {
  for (const locale of ['zh', 'en']) {
    expect(formatUsageNumber(1250, locale, true)).toBe('1.25K');
    expect(formatUsageNumber(1234567, locale, true)).toBe('1.23M');
    expect(formatUsageNumber(1250000000, locale, true)).toBe('1.25B');
    expect(formatUsageNumber(999999, locale, true)).toBe('1M');
    expect(formatUsageNumber(0, locale, true)).toBe('0');
  }
});
test('daily trends include calendar gaps without truncating the source counters', () => {
  const rows = [{day: '2026-10-19', totals: {...emptyUsage(), total_tokens: 42}}];
  const week = dailySeries(rows, 'week', new Date(2026, 9, 20, 12));
  expect(week.map(row => row.day)).toEqual(['2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20']);
  expect(week.map(row => row.totals.total_tokens)).toEqual([0,0,0,0,0,42,0]);
  expect(dailySeries(rows, 'all', new Date(2026, 9, 20, 12))).toHaveLength(2);
  expect(dailySeries(rows, 'month', new Date(2026, 9, 20, 12))).toHaveLength(30);
  expect(rows[0].totals.total_tokens).toBe(42);
});

test('today uses distinct hourly buckets and excludes future hours from the recorded trend', () => {
  const rows = [{day: '2026-10-20T03:00', totals: {...emptyUsage(), total_tokens: 90}}];
  const hours = dailySeries(rows, 'today', new Date(2026, 9, 20, 4, 35));
  expect(hours).toHaveLength(24);
  expect(hours[3].totals.total_tokens).toBe(90);
  expect(hours[4].future).toBe(false);
  expect(hours[5].future).toBe(true);
  expect(hours.filter(row => !row.future)).toHaveLength(5);
  expect(hours.at(-1)?.day).toBe('2026-10-20T23:00');
});

test('all-time spans every day from the oldest record, including history older than 30 days', () => {
  const rows = [{day: '2026-08-01', totals: {...emptyUsage(), total_tokens: 70}}];
  const series = dailySeries(rows, 'all', new Date(2026, 9, 20, 12));
  expect(series).toHaveLength(81);
  expect(series[0].day).toBe('2026-08-01');
  expect(series.at(-1)?.day).toBe('2026-10-20');
  expect(series.reduce((sum, row) => sum + row.totals.total_tokens, 0)).toBe(70);
  expect(dailySeries([], 'all', new Date(2026, 9, 20, 12))).toHaveLength(1);
});

test('trend averages include elapsed gaps and exclude future hours, including their counters', () => {
  const rows = [
    {day: '2026-10-20T00:00', totals: {...emptyUsage(), total_tokens: 120}},
    {day: '2026-10-20T01:00', totals: emptyUsage()},
    {day: '2026-10-20T02:00', totals: {...emptyUsage(), total_tokens: 900}, future: true},
  ];
  expect(summarizeUsageTrend(rows)).toEqual({average: 60, peak: rows[0]});
  expect(summarizeUsageTrend([])).toEqual({average: null, peak: null});
  expect(summarizeUsageTrend([{day: '2026-10-20', totals: emptyUsage()}])).toEqual({average: 0, peak: null});
});
