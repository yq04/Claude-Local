/**
 * [INPUT]: Redacted native usage aggregates and the current local calendar/locale.
 * [OUTPUT]: Typed accounting/activity contract (including optional per-account models), four-part token composition, family-first model & thinking-depth effort sorting, official API USD cost/cache-savings estimation (including Mythos preview/5.2/5.1), peak bucket label formatting, cache-rate/K-M-B formatting, calendar series and elapsed-period averages/peaks.
 * [POS]: Pure usage presentation helpers; no identity files, credentials or network access.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export type UsagePeriod = 'all' | 'today' | 'yesterday' | 'week' | 'month';
export type UsageTotals = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  reasoning_tokens: number | null;
  requests: number;
  /** Distinct recorded session IDs; absent in older snapshots. */
  sessions?: number;
};
export type UsageAccount = {id: string; name: string; email: string | null; current: boolean; totals: UsageTotals; models?: UsageModel[]};
export type UsageDay = {day: string; totals: UsageTotals; future?: boolean; start_at?: number; end_at?: number};
export type UsageAttributionConfig = {
  fallback_account_id: string | null;
  fallback_account_name: string | null;
  fallback_before?: number;
  unassigned_requests: number;
  unassigned_tokens: number;
};
export type UsageEffort = {
  effort: string;
  totals: UsageTotals;
};
export type UsageModel = {
  model: string;
  totals: UsageTotals;
  efforts?: UsageEffort[];
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
  models: UsageModel[];
  warnings: string[];
  attribution?: UsageAttributionConfig;
  /** Scoped distinct sessions and local calendar days with recorded usage. */
  activity?: {sessions: number; active_days: number};
};
export type ModelApiPricing = {
  inputPerM: number;
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
};
export type UsageCostEstimate = {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  costUsd: number;
  cacheSavingsUsd: number;
  savingsRate: number | null;
  cacheReuseRatio: number | null;
};

export function detectModelFamily(model: string): {key: 'opus' | 'sonnet' | 'fable' | 'haiku' | 'other'; label: string | null} {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return {key: 'opus', label: 'Opus'};
  if (lower.includes('fable') || lower.includes('mythos')) {
    return {key: 'fable', label: lower.includes('mythos') ? 'Mythos' : 'Fable'};
  }
  if (lower.includes('sonnet')) return {key: 'sonnet', label: 'Sonnet'};
  if (lower.includes('haiku')) return {key: 'haiku', label: 'Haiku'};
  return {key: 'other', label: null};
}

const MODEL_FAMILY_ORDER: Record<ReturnType<typeof detectModelFamily>['key'], number> = {
  fable: 0,
  opus: 1,
  sonnet: 2,
  haiku: 3,
  other: 4,
};

export function sortUsageModels(models: readonly UsageModel[]): UsageModel[] {
  return [...models].sort((a, b) => {
    const familyDiff =
      MODEL_FAMILY_ORDER[detectModelFamily(a.model).key] -
      MODEL_FAMILY_ORDER[detectModelFamily(b.model).key];
    if (familyDiff !== 0) return familyDiff;
    const tokenDiff = b.totals.total_tokens - a.totals.total_tokens;
    if (tokenDiff !== 0) return tokenDiff;
    return a.model.localeCompare(b.model);
  });
}

const EFFORT_DEPTH_ORDER: Record<string, number> = {
  max: 0,
  xhigh: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function sortUsageEfforts(efforts: readonly UsageEffort[]): UsageEffort[] {
  return [...efforts].sort((a, b) => {
    const rankA = EFFORT_DEPTH_ORDER[a.effort.toLowerCase()] ?? 5;
    const rankB = EFFORT_DEPTH_ORDER[b.effort.toLowerCase()] ?? 5;
    if (rankA !== rankB) return rankA - rankB;
    const tokenDiff = b.totals.total_tokens - a.totals.total_tokens;
    if (tokenDiff !== 0) return tokenDiff;
    return a.effort.localeCompare(b.effort);
  });
}

/**
 * Resolves official Anthropic API per-1M-token USD pricing aligned with the Claude Code qHr catalog.
 */
export function resolveModelPricing(model?: string | null): ModelApiPricing {
  const lower = (model ?? '').toLowerCase();
  if (lower.includes('haiku')) {
    if (lower.includes('haiku-5-5') || lower.includes('haiku-5.5')) {
      return {inputPerM: 0.10, outputPerM: 0.50, cacheWritePerM: 0.125, cacheReadPerM: 0.01};
    }
    if (lower.includes('3-5-haiku') || lower.includes('3.5-haiku')) {
      return {inputPerM: 0.80, outputPerM: 4.00, cacheWritePerM: 1.00, cacheReadPerM: 0.08};
    }
    return {inputPerM: 1.00, outputPerM: 5.00, cacheWritePerM: 1.25, cacheReadPerM: 0.10};
  }
  if (lower.includes('opus')) {
    if (lower.includes('opus-5-5') || lower.includes('opus-5.5')) {
      return {inputPerM: 4.00, outputPerM: 20.00, cacheWritePerM: 5.00, cacheReadPerM: 0.20};
    }
    if (
      lower.includes('opus-4-5') || lower.includes('opus-4.5') ||
      lower.includes('opus-4-6') || lower.includes('opus-4.6') ||
      lower.includes('opus-4-7') || lower.includes('opus-4.7') ||
      lower.includes('opus-4-8') || lower.includes('opus-4.8') ||
      lower.includes('opus-5')
    ) {
      return {inputPerM: 5.00, outputPerM: 25.00, cacheWritePerM: 6.25, cacheReadPerM: 0.50};
    }
    return {inputPerM: 15.00, outputPerM: 75.00, cacheWritePerM: 18.75, cacheReadPerM: 1.50};
  }
  if (lower.includes('fable') || lower.includes('mythos')) {
    if (lower.includes('mythos-preview')) {
      return {inputPerM: 25.00, outputPerM: 125.00, cacheWritePerM: 31.25, cacheReadPerM: 2.50};
    }
    if (
      lower.includes('fable-5-2') || lower.includes('fable-5.2') ||
      lower.includes('mythos-5-2') || lower.includes('mythos-5.2')
    ) {
      return {inputPerM: 8.00, outputPerM: 40.00, cacheWritePerM: 10.00, cacheReadPerM: 0.20};
    }
    if (
      lower.includes('fable-5-1') || lower.includes('fable-5.1') ||
      lower.includes('mythos-5-1') || lower.includes('mythos-5.1')
    ) {
      return {inputPerM: 10.00, outputPerM: 50.00, cacheWritePerM: 12.50, cacheReadPerM: 0.25};
    }
    return {inputPerM: 10.00, outputPerM: 50.00, cacheWritePerM: 12.50, cacheReadPerM: 1.00};
  }
  if (lower.includes('sonnet-5-5') || lower.includes('sonnet-5.5')) {
    return {inputPerM: 2.00, outputPerM: 10.00, cacheWritePerM: 2.50, cacheReadPerM: 0.10};
  }
  if (lower.includes('sonnet-5')) {
    return {inputPerM: 2.00, outputPerM: 10.00, cacheWritePerM: 2.50, cacheReadPerM: 0.20};
  }
  return {inputPerM: 3.00, outputPerM: 15.00, cacheWritePerM: 3.75, cacheReadPerM: 0.30};
}

export function estimateTotalsCostUsd(totals: UsageTotals, model?: string | null): UsageCostEstimate {
  const rate = resolveModelPricing(model);
  const inputCostUsd = (totals.input_tokens * rate.inputPerM) / 1_000_000;
  const outputCostUsd = (totals.output_tokens * rate.outputPerM) / 1_000_000;
  const cacheWriteCostUsd = (totals.cache_creation_tokens * rate.cacheWritePerM) / 1_000_000;
  const cacheReadCostUsd = (totals.cache_read_tokens * rate.cacheReadPerM) / 1_000_000;
  const costUsd = inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd;
  const cacheSavingsUsd = Math.max(0, totals.cache_read_tokens * (rate.inputPerM - rate.cacheReadPerM)) / 1_000_000;
  const grossUncached = costUsd + cacheSavingsUsd;
  const savingsRate = grossUncached > 0 && cacheSavingsUsd > 0 ? cacheSavingsUsd / grossUncached : null;
  const cacheReuseRatio = totals.cache_creation_tokens > 0 && totals.cache_read_tokens > 0
    ? totals.cache_read_tokens / totals.cache_creation_tokens
    : null;
  return {
    inputCostUsd,
    outputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    costUsd,
    cacheSavingsUsd,
    savingsRate,
    cacheReuseRatio,
  };
}

export function estimateSnapshotCostUsd(totals?: UsageTotals | null, models?: UsageModel[] | null): UsageCostEstimate {
  if (!totals) {
    return estimateTotalsCostUsd(emptyUsage());
  }
  if (!models?.length) {
    return estimateTotalsCostUsd(totals);
  }
  let inputCostUsd = 0;
  let outputCostUsd = 0;
  let cacheWriteCostUsd = 0;
  let cacheReadCostUsd = 0;
  let cacheSavingsUsd = 0;
  let coveredInput = 0;
  let coveredOutput = 0;
  let coveredWrite = 0;
  let coveredRead = 0;
  for (const row of models) {
    const est = estimateTotalsCostUsd(row.totals, row.model);
    inputCostUsd += est.inputCostUsd;
    outputCostUsd += est.outputCostUsd;
    cacheWriteCostUsd += est.cacheWriteCostUsd;
    cacheReadCostUsd += est.cacheReadCostUsd;
    cacheSavingsUsd += est.cacheSavingsUsd;
    coveredInput += row.totals.input_tokens;
    coveredOutput += row.totals.output_tokens;
    coveredWrite += row.totals.cache_creation_tokens;
    coveredRead += row.totals.cache_read_tokens;
  }
  const remInput = Math.max(0, totals.input_tokens - coveredInput);
  const remOutput = Math.max(0, totals.output_tokens - coveredOutput);
  const remWrite = Math.max(0, totals.cache_creation_tokens - coveredWrite);
  const remRead = Math.max(0, totals.cache_read_tokens - coveredRead);
  if (remInput > 0 || remOutput > 0 || remWrite > 0 || remRead > 0) {
    const remEst = estimateTotalsCostUsd({
      ...emptyUsage(),
      input_tokens: remInput,
      output_tokens: remOutput,
      cache_creation_tokens: remWrite,
      cache_read_tokens: remRead,
      total_tokens: remInput + remOutput + remWrite + remRead,
    });
    inputCostUsd += remEst.inputCostUsd;
    outputCostUsd += remEst.outputCostUsd;
    cacheWriteCostUsd += remEst.cacheWriteCostUsd;
    cacheReadCostUsd += remEst.cacheReadCostUsd;
    cacheSavingsUsd += remEst.cacheSavingsUsd;
  }
  const costUsd = inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd;
  const grossUncached = costUsd + cacheSavingsUsd;
  const savingsRate = grossUncached > 0 && cacheSavingsUsd > 0 ? cacheSavingsUsd / grossUncached : null;
  const cacheReuseRatio = totals.cache_creation_tokens > 0 && totals.cache_read_tokens > 0
    ? totals.cache_read_tokens / totals.cache_creation_tokens
    : null;
  return {
    inputCostUsd,
    outputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    costUsd,
    cacheSavingsUsd,
    savingsRate,
    cacheReuseRatio,
  };
}

export function formatUsdCost(usd: number | null | undefined, compact = false): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  if (compact && usd >= 1_000) {
    return '$' + formatUsageNumber(usd, 'en', true);
  }
  if (usd >= 1_000) {
    return '$' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usd);
  }
  return '$' + usd.toFixed(2);
}

export const emptyUsage = (): UsageTotals => ({input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 0, reasoning_tokens: null, requests: 0});
export type UsageTokenKind = 'input' | 'output' | 'cacheWrite' | 'cacheRead';
/** These counters are disjoint; reasoning is already part of output. */
export function tokenComposition(totals: UsageTotals): {kind: UsageTokenKind; tokens: number; share: number}[] {
  return ([['input', totals.input_tokens], ['output', totals.output_tokens], ['cacheWrite', totals.cache_creation_tokens], ['cacheRead', totals.cache_read_tokens]] as const)
    .map(([kind, tokens]) => ({kind, tokens, share: totals.total_tokens > 0 ? tokens / totals.total_tokens : 0}));
}
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
export function formatUsagePeakBucketLabel(day: string, isHourly: boolean): string {
  if (!day) return '';
  if (isHourly) {
    return day.includes('T') ? day.slice(11, 16) : day.slice(-5);
  }
  return day.includes('T') ? day.slice(5, 10) : day.slice(-5);
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
  if (period === 'today' || period === 'yesterday') {
    const actualHourly = chronological.filter(row => row.start_at != null && row.end_at != null);
    if (actualHourly.length) {
      const clock = generatedAt ?? now.getTime() / 1000;
      return actualHourly.map(row => ({...row, future: period === 'today' && row.start_at! > clock}));
    }
    const targetDate = period === 'yesterday' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12) : now;
    const day = localDayKey(targetDate);
    return Array.from({length: 24}, (_, hour) => {
      const key = `${day}T${String(hour).padStart(2, '0')}:00`;
      return {...(byDay.get(key) ?? {day: key, totals: emptyUsage()}), future: period === 'today' && hour > now.getHours()};
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
