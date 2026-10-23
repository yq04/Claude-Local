/**
 * [INPUT]: Redacted native usage aggregates and the current local calendar/locale.
 * [OUTPUT]: Typed accounting contract, cache-rate/K-M-B formatting, calendar series and elapsed-period averages/peaks.
 * [POS]: Pure usage presentation helpers; no identity files, credentials or network access.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export type UsagePeriod = 'all' | 'today' | 'week' | 'month';
export type UsageTotals = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  reasoning_tokens: number | null;
  requests: number;
};
export type UsageAccount = {id: string; name: string; email: string | null; current: boolean; totals: UsageTotals};
export type UsageDay = {day: string; totals: UsageTotals; future?: boolean; start_at?: number; end_at?: number};
export type UsageAttributionConfig = {
  fallback_account_id: string | null;
  fallback_account_name: string | null;
  unassigned_requests: number;
  unassigned_tokens: number;
};
export type UsageSnapshot = {
  generated_at: number;
  tracking_since: number | null;
  totals: UsageTotals;
  unattributed: UsageTotals;
  accounts: UsageAccount[];
  daily: UsageDay[];
  granularity?: 'hour' | 'day';
  timezone?: string;
  models: {model: string; totals: UsageTotals}[];
  warnings: string[];
  attribution?: UsageAttributionConfig;
};
export const emptyUsage = (): UsageTotals => ({input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0, reasoning_tokens: null, requests: 0});
export function cacheHitRate(totals: UsageTotals): number | null {
  const prompt = totals.input_tokens + totals.cache_creation_tokens + totals.cache_read_tokens;
  return prompt > 0 ? totals.cache_read_tokens / prompt : null;
}
export function formatUsageNumber(value: number | null | undefined, locale: string, compact = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (compact && Math.abs(value) >= 1_000) {
    const units = ['K', 'M', 'B'];
    let index = Math.min(2, Math.floor(Math.log10(Math.abs(value)) / 3) - 1);
    let scaled = value / 1_000 ** (index + 1);
    const precision = Math.abs(scaled) < 10 ? 2 : 1;
    if (Math.abs(Number(scaled.toFixed(precision))) >= 1_000 && index < 2) {
      scaled /= 1_000;
      index++;
    }
    return new Intl.NumberFormat('en-US', {useGrouping: false, maximumFractionDigits: Math.abs(scaled) < 10 ? 2 : 1}).format(scaled) + units[index];
  }
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {maximumFractionDigits: 0}).format(value);
}
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Include zero-use elapsed buckets in the average; future hours are never samples. */
export function summarizeUsageTrend(days: UsageDay[]): {average: number | null; peak: UsageDay | null} {
  const elapsed = days.filter(day => !day.future);
  const total = elapsed.reduce((sum, day) => sum + day.totals.total_tokens, 0);
  const peak = elapsed.reduce<UsageDay | null>((highest, day) => day.totals.total_tokens > (highest?.totals.total_tokens ?? 0) ? day : highest, null);
  const hourlyIntervals = elapsed.length > 0 && elapsed.every(day => day.start_at != null && day.end_at != null && Number.isFinite(day.start_at) && Number.isFinite(day.end_at) && day.end_at > day.start_at);
  const durationHours = hourlyIntervals ? elapsed.reduce((sum, day) => sum + (day.end_at! - day.start_at!) / 3600, 0) : elapsed.length;
  return {average: durationHours > 0 ? total / durationHours : null, peak};
}
/** Match the selected calendar span; future hours remain distinguishable from recorded zero use. */
export function dailySeries(rows: UsageDay[], period: UsagePeriod, now = new Date(), generatedAt?: number): UsageDay[] {
  const chronological = [...rows].sort((a, b) => a.start_at != null && b.start_at != null ? a.start_at - b.start_at : a.day.localeCompare(b.day));
  const byDay = new Map(chronological.map(row => [row.day, row]));
  if (period === 'today') {
    const actualHourly = chronological.filter(row => row.start_at != null && row.end_at != null);
    if (actualHourly.length) {
      const clock = generatedAt ?? now.getTime() / 1000;
      return actualHourly.map(row => ({...row, future: row.start_at! > clock}));
    }
    const day = localDayKey(now);
    return Array.from({length: 24}, (_, hour) => {
      const key = `${day}T${String(hour).padStart(2, '0')}:00`;
      return {...(byDay.get(key) ?? {day: key, totals: emptyUsage()}), future: hour > now.getHours()};
    });
  }
  const today = localDayKey(now);
  const earliest = rows.map(row => row.day).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today).sort()[0];
  const start = period === 'all' && earliest ? new Date(`${earliest}T12:00:00`) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0), 12);
  const days: UsageDay[] = [];
  // Calendar increments preserve day boundaries when the UTC offset changes.
  for (let date = new Date(start); localDayKey(date) <= today; date.setDate(date.getDate() + 1)) {
    const day = localDayKey(date);
    days.push(byDay.get(day) ?? {day, totals: emptyUsage()});
  }
  return days;
}
