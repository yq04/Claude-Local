/**
 * [INPUT]: The currently rendered aggregate snapshot, selected scope and privacy-safe display aliases.
 * [OUTPUT]: Formula-safe TSV (with summary and per-account USD cost & cache savings) and privacy-masked Markdown summary card containing scoped usage totals, per-request token/cost averages, cost/cache efficiency, top models, and elapsed time buckets.
 * [POS]: Pure export formatter; never reads files, identities, paths or request content.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {maskDisplayName, maskEmailAddress} from './settings-model';
import {
  cacheHitRate,
  estimateSnapshotCostUsd,
  estimateTotalsCostUsd,
  formatUsageNumber,
  formatUsdCost,
  type UsageDay,
  type UsagePeriod,
  type UsageSnapshot,
} from './usage-model';

export type UsageReport = UsageSnapshot;

export interface UsageExportOptions {
  period?: UsagePeriod;
  periodLabel?: string;
  rangeLabel?: string;
  accountId?: string | null;
  accountLabel?: string;
  accountEmail?: string | null;
  accountIsAll?: boolean;
  timezone?: string;
  privacyMask?: boolean;
  privacy?: boolean;
  days?: UsageDay[];
  generatedLabel?: string;
  coverageLabel?: string;
  productLabel?: string;
  locale?: 'zh' | 'en';
  costUsd?: string;
  cacheSavedUsd?: string;
  cacheHitPct?: string;
  cacheMultiplier?: string;
}

function safeCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const row = (cells: unknown[]) => cells.map(safeCell).join('\t');

function maskEmbeddedEmails(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, match =>
    maskEmailAddress(match, true),
  );
}

function resolveMarkdownScopeLabel(
  report: UsageReport,
  options: UsageExportOptions,
  locale: 'zh' | 'en',
): string {
  const privacyMask = Boolean(options.privacyMask ?? options.privacy ?? false);
  const matched =
    options.accountId && options.accountId !== 'all'
      ? report.accounts?.find(acc => acc.id === options.accountId)
      : undefined;
  const isAll =
    options.accountIsAll ??
    (!options.accountId &&
      (!options.accountLabel ||
        options.accountLabel === 'all' ||
        options.accountLabel === '全部' ||
        options.accountLabel === '全部账号' ||
        options.accountLabel.toLowerCase() === 'all accounts'));

  const defaultAll = locale === 'en' ? 'All accounts' : '全部账号';
  const defaultSingle = locale === 'en' ? 'Selected account' : '所选账号';
  const rawLabel =
    options.accountLabel ||
    matched?.name ||
    matched?.email ||
    (isAll ? defaultAll : defaultSingle);

  if (!privacyMask) {
    return rawLabel;
  }
  const emailHint = options.accountEmail ?? matched?.email ?? null;
  const masked = maskDisplayName(rawLabel, emailHint, true);
  return maskEmbeddedEmails(masked || defaultSingle);
}

export function formatUsageMarkdownSummary(
  report: UsageReport | null | undefined,
  options: UsageExportOptions & {
    locale?: 'zh' | 'en';
    costUsd?: string;
    cacheSavedUsd?: string;
    cacheHitPct?: string;
    cacheMultiplier?: string;
  } = {},
): string {
  if (!report) return '';
  const locale: 'zh' | 'en' = options.locale === 'en' ? 'en' : 'zh';
  const isEn = locale === 'en';
  const totals = report.totals;
  const models = [...(report.models ?? [])].sort(
    (a, b) => b.totals.total_tokens - a.totals.total_tokens,
  );
  const costEst = estimateSnapshotCostUsd(totals, models);
  const costText = options.costUsd || formatUsdCost(costEst.costUsd);
  const savedText = options.cacheSavedUsd || formatUsdCost(costEst.cacheSavingsUsd);
  const rawHit = cacheHitRate(totals);
  const hitText =
    options.cacheHitPct ||
    (rawHit == null ? '—' : `${(rawHit * 100).toFixed(1)}%`);
  const reuseText =
    options.cacheMultiplier ||
    (costEst.cacheReuseRatio != null ? `${costEst.cacheReuseRatio.toFixed(1)}×` : '');

  const scopeLabel = resolveMarkdownScopeLabel(report, options, locale);
  const periodText =
    options.rangeLabel && options.periodLabel
      ? `${options.periodLabel} (${options.rangeLabel})`
      : options.rangeLabel || options.periodLabel || options.period || (isEn ? 'All time' : '全部时间');
  const tzText = options.timezone || report.timezone || 'Local';
  const fmtInt = (n: number) => formatUsageNumber(n, locale, false);
  const fmtCompact = (n: number) => formatUsageNumber(n, locale, true);
  const fmtShare = (part: number, whole: number) =>
    whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%';
  const avgTokensPerReq =
    totals.requests > 0 ? Math.round(totals.total_tokens / totals.requests) : null;
  const avgCostPerReq =
    totals.requests > 0 ? formatUsdCost(costEst.costUsd / totals.requests) : null;

  const lines: string[] = [
    isEn ? '### Claude-Local Usage Summary' : '### Claude-Local 用量统计简报',
    '',
    isEn
      ? `- **Scope**: ${scopeLabel} · **Period**: ${periodText} · **Timezone**: ${tzText}`
      : `- **统计范围**：${scopeLabel} · **统计周期**：${periodText} · **时区**：${tzText}`,
    isEn
      ? `- **Total Tokens**: **${fmtCompact(totals.total_tokens)}** (${fmtInt(totals.total_tokens)}) · **Requests**: ${fmtInt(totals.requests)}${avgTokensPerReq != null ? ` · **Avg/Req**: ${fmtCompact(avgTokensPerReq)} tok/req` : ''}`
      : `- **总 Token**：**${fmtCompact(totals.total_tokens)}**（${fmtInt(totals.total_tokens)}） · **去重响应**：${fmtInt(totals.requests)}${avgTokensPerReq != null ? ` · **单次均值**：${fmtCompact(avgTokensPerReq)} tok/次` : ''}`,
    isEn
      ? `- **Token Breakdown**: Input ${fmtCompact(totals.input_tokens)} (${fmtShare(totals.input_tokens, totals.total_tokens)}) · Output ${fmtCompact(totals.output_tokens)} (${fmtShare(totals.output_tokens, totals.total_tokens)}) · Cache Write ${fmtCompact(totals.cache_creation_tokens)} (${fmtShare(totals.cache_creation_tokens, totals.total_tokens)}) · Cache Read ${fmtCompact(totals.cache_read_tokens)} (${fmtShare(totals.cache_read_tokens, totals.total_tokens)})`
      : `- **四类构成**：未缓存输入 ${fmtCompact(totals.input_tokens)} (${fmtShare(totals.input_tokens, totals.total_tokens)}) · 输出 ${fmtCompact(totals.output_tokens)} (${fmtShare(totals.output_tokens, totals.total_tokens)}) · 缓存写入 ${fmtCompact(totals.cache_creation_tokens)} (${fmtShare(totals.cache_creation_tokens, totals.total_tokens)}) · 缓存读取 ${fmtCompact(totals.cache_read_tokens)} (${fmtShare(totals.cache_read_tokens, totals.total_tokens)})`,
    isEn
      ? `- **Est. API Cost**: **${costText}**${avgCostPerReq != null ? ` (${avgCostPerReq}/req)` : ''} · **Cache Savings**: **${savedText}** · **Cache Hit Rate**: **${hitText}**${reuseText ? ` (${reuseText})` : ''}`
      : `- **API 等效花费**：**${costText}**${avgCostPerReq != null ? `（单次 ${avgCostPerReq}/次）` : ''} · **缓存节省**：**${savedText}** · **缓存命中率**：**${hitText}**${reuseText ? `（复用 ${reuseText}）` : ''}`,
  ];

  if (models.length > 0) {
    lines.push('');
    lines.push(
      isEn
        ? '| Model | Tokens | Share | Est. Cost |'
        : '| 模型 | Token | 占比 | 等效花费 |',
    );
    lines.push('| :--- | ---: | ---: | ---: |');
    for (const rowModel of models.slice(0, 5)) {
      const mCost = estimateTotalsCostUsd(rowModel.totals, rowModel.model);
      const mShare = fmtShare(rowModel.totals.total_tokens, totals.total_tokens);
      const mName =
        rowModel.model === 'unknown'
          ? isEn
            ? 'Unknown'
            : '未识别模型'
          : rowModel.model;
      lines.push(
        `| \`${mName}\` | ${fmtCompact(rowModel.totals.total_tokens)} | ${mShare} | ${formatUsdCost(mCost.costUsd)} |`,
      );
    }
  }

  return lines.join('\n');
}

export function buildUsageTsv(input: {snapshot: UsageSnapshot; period: UsagePeriod; periodLabel: string; accountLabel: string; accountIsAll: boolean; timezone: string; privacy: boolean; days: UsageDay[]; generatedLabel: string; coverageLabel: string; productLabel: string; labels: {metadata: string; summary: string; daily: string; time: string; total: string; input: string; output: string; cacheWrite: string; cacheRead: string; requests: string; sessions?: string; activeDays?: string; estimatedCost?: string; cacheSavings?: string; accounts?: string; account: string; period: string; timezone: string; generated: string; coverage: string}}): string {
  const {snapshot, labels} = input;
  const models = [...(snapshot.models ?? [])].sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
  const primaryModel = models[0]?.model;
  const summaryCost = estimateSnapshotCostUsd(snapshot.totals, models);
  const costHeader = labels.estimatedCost ?? 'estimated_cost_usd';
  const savingsHeader = labels.cacheSavings ?? 'cache_savings_usd';
  const out = [
    row([input.productLabel, labels.metadata]),
    row([labels.generated, input.generatedLabel]),
    row([labels.period, input.periodLabel]),
    row([labels.timezone, input.timezone]),
    row([labels.coverage, input.coverageLabel]),
    '',
    row([labels.summary]),
    row([labels.account, labels.total, labels.input, labels.output, labels.cacheWrite, labels.cacheRead, labels.requests, ...(labels.sessions ? [labels.sessions] : []), ...(labels.activeDays ? [labels.activeDays] : []), costHeader, savingsHeader]),
    row([input.privacy && !input.accountIsAll ? labels.account : input.accountLabel, snapshot.totals.total_tokens, snapshot.totals.input_tokens, snapshot.totals.output_tokens, snapshot.totals.cache_creation_tokens, snapshot.totals.cache_read_tokens, snapshot.totals.requests, ...(labels.sessions ? [snapshot.activity?.sessions ?? snapshot.totals.sessions ?? ''] : []), ...(labels.activeDays ? [snapshot.activity?.active_days ?? ''] : []), summaryCost.costUsd.toFixed(4), summaryCost.cacheSavingsUsd.toFixed(4)]),
  ];
  if (snapshot.accounts.length > 0) {
    const accountsSection = labels.accounts ?? '# accounts';
    out.push(
      '',
      row([accountsSection, labels.account, labels.total, labels.input, labels.output, labels.cacheWrite, labels.cacheRead, labels.requests, costHeader, savingsHeader]),
    );
    for (const acc of snapshot.accounts) {
      const accCost = estimateTotalsCostUsd(acc.totals, primaryModel);
      const accName = input.privacy
        ? maskEmbeddedEmails(maskDisplayName(acc.name, acc.email, true) || labels.account)
        : acc.name;
      out.push(
        row([
          accountsSection,
          accName,
          acc.totals.total_tokens,
          acc.totals.input_tokens,
          acc.totals.output_tokens,
          acc.totals.cache_creation_tokens,
          acc.totals.cache_read_tokens,
          acc.totals.requests,
          accCost.costUsd.toFixed(4),
          accCost.cacheSavingsUsd.toFixed(4),
        ]),
      );
    }
  }
  out.push(
    '',
    row([labels.daily, labels.time, labels.total, labels.input, labels.output, labels.cacheWrite, labels.cacheRead, labels.requests]),
  );
  for (const day of input.days) if (!day.future) out.push(row([labels.daily, day.day, day.totals.total_tokens, day.totals.input_tokens, day.totals.output_tokens, day.totals.cache_creation_tokens, day.totals.cache_read_tokens, day.totals.requests]));
  return out.join('\r\n');
}
