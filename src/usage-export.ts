/**
 * [INPUT]: The currently rendered aggregate snapshot, selected scope and privacy-safe display aliases.
 * [OUTPUT]: Formula-safe TSV containing scoped usage totals, optional recorded activity and elapsed time buckets with privacy-safe account aliases.
 * [POS]: Pure export formatter; never reads files, identities, paths or request content.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import type {UsageDay, UsagePeriod, UsageSnapshot} from './usage-model';

function safeCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const row = (cells: unknown[]) => cells.map(safeCell).join('\t');

export function buildUsageTsv(input: {snapshot: UsageSnapshot; period: UsagePeriod; periodLabel: string; accountLabel: string; accountIsAll: boolean; timezone: string; privacy: boolean; days: UsageDay[]; generatedLabel: string; coverageLabel: string; productLabel: string; labels: {metadata: string; summary: string; daily: string; time: string; total: string; input: string; output: string; cacheWrite: string; cacheRead: string; requests: string; sessions?: string; activeDays?: string; account: string; period: string; timezone: string; generated: string; coverage: string}}): string {
  const {snapshot, labels} = input;
  const out = [
    row([input.productLabel, labels.metadata]),
    row([labels.generated, input.generatedLabel]),
    row([labels.period, input.periodLabel]),
    row([labels.timezone, input.timezone]),
    row([labels.coverage, input.coverageLabel]),
    '',
    row([labels.summary]),
    row([labels.account, labels.total, labels.input, labels.output, labels.cacheWrite, labels.cacheRead, labels.requests, ...(labels.sessions ? [labels.sessions] : []), ...(labels.activeDays ? [labels.activeDays] : [])]),
    row([input.privacy && !input.accountIsAll ? labels.account : input.accountLabel, snapshot.totals.total_tokens, snapshot.totals.input_tokens, snapshot.totals.output_tokens, snapshot.totals.cache_creation_tokens, snapshot.totals.cache_read_tokens, snapshot.totals.requests, ...(labels.sessions ? [snapshot.activity?.sessions ?? snapshot.totals.sessions ?? ''] : []), ...(labels.activeDays ? [snapshot.activity?.active_days ?? ''] : [])]),
    '',
    row([labels.daily, labels.time, labels.total, labels.input, labels.output, labels.cacheWrite, labels.cacheRead, labels.requests]),
  ];
  for (const day of input.days) if (!day.future) out.push(row([labels.daily, day.day, day.totals.total_tokens, day.totals.input_tokens, day.totals.output_tokens, day.totals.cache_creation_tokens, day.totals.cache_read_tokens, day.totals.requests]));
  return out.join('\r\n');
}
