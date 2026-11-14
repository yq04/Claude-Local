/**
 * [INPUT]: 当前已筛选的本地用量快照、序列桶、成本与单会话均耗折算、活动主题与双语翻译函数。
 * [OUTPUT]: 零外部依赖的高清 2x Retina Token 消耗截图（支持「数据概览」与「趋势全图」双模式，含顶对齐 2×2 KPI 卡与单次均耗/防截断换行的副标题、对齐占比列与 2×2 微型统计网格的模型分布卡、防标题重叠截断与时区安全峰值标签，一键写入剪贴板或下载 PNG）。
 * [POS]: 用量分析的纯前端视觉导出工具；仅消费现有内存快照，不发起 IPC 请求或访问剪贴板历史。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  cacheHitRate,
  detectModelFamily,
  estimateTotalsCostUsd,
  formatTurnsPerSession,
  formatUsdCost,
  formatUsageNumber,
  formatUsagePeakBucketLabel,
  sortUsageModels,
  summarizeSessionEfficiency,
  summarizeUsageTrend,
  tokenComposition,
  type UsageCostEstimate,
  type UsageDay,
  type UsagePeriod,
  type UsageSnapshot,
} from './usage-model';

export type UsageScreenshotMode = 'overview' | 'trend';
export type UsageScreenshotAction = 'copy' | 'download';

export type UsageScreenshotOptions = {
  mode: UsageScreenshotMode;
  action: UsageScreenshotAction;
  snapshot: UsageSnapshot;
  series: UsageDay[];
  costBreakdown: UsageCostEstimate;
  period: UsagePeriod;
  periodLabel: string;
  rangeLabel: string | null;
  accountLabel: string;
  locale: 'zh' | 'en';
  t: (key: string, params?: Record<string, string | number>) => string;
};

export type UsageScreenshotResult = {
  mode: UsageScreenshotMode;
  copied: boolean;
  downloaded: boolean;
  width: number;
  height: number;
  dataUrl: string;
};

function formatShareText(tokens: number, share: number, locale: 'zh' | 'en'): string {
  if (tokens > 0 && share > 0 && share < 0.001) return '<0.1%';
  if (share > 0.999 && share < 1) return '99.9%';
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(share);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillStrokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed + '…';
}

function packSubItemLines(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  maxWidth: number,
  maxLines = 2,
): string[] {
  const lines: string[] = [];
  for (const rawItem of items) {
    const item = rawItem.trim();
    if (!item) continue;
    if (lines.length === 0) {
      lines.push(item);
      continue;
    }
    const lastIdx = lines.length - 1;
    const candidate = `${lines[lastIdx]} · ${item}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      lines[lastIdx] = candidate;
    } else if (lines.length < maxLines) {
      lines.push(item);
    } else {
      lines[lastIdx] = candidate;
    }
  }
  return lines.map(line => truncateText(ctx, line, maxWidth));
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (ctx.measureText(trimmed).width <= maxWidth) return [trimmed];
  const tokens = trimmed.match(/[A-Za-z0-9$€£¥.,:%+/×()-]+|\s+|./gu) ?? [trimmed];
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\s+$/.test(tok)) {
      if (current) current += ' ';
      continue;
    }
    const candidate = current + tok;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length + 1 < maxLines) {
      lines.push(current.trimEnd());
      current = tok;
    } else {
      current = `${current}${tokens.slice(i).join('')}`.trim();
      break;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.slice(0, maxLines).map(line => truncateText(ctx, line, maxWidth));
}

function drawModelStatPair(
  ctx: CanvasRenderingContext2D,
  edgeX: number,
  y: number,
  align: 'left' | 'right',
  first: { text: string; font: string; color: string },
  second: { text: string; font: string; color: string },
  gap = 3.5,
) {
  ctx.font = first.font;
  const w1 = ctx.measureText(first.text).width;
  ctx.font = second.font;
  const w2 = ctx.measureText(second.text).width;
  const startX = align === 'left' ? edgeX : edgeX - (w1 + gap + w2);
  ctx.font = first.font;
  ctx.fillStyle = first.color;
  ctx.fillText(first.text, startX, y);
  ctx.font = second.font;
  ctx.fillStyle = second.color;
  ctx.fillText(second.text, startX + w1 + gap, y);
}

export function renderUsageScreenshotCanvas(options: UsageScreenshotOptions): HTMLCanvasElement {
  const {
    mode,
    snapshot,
    series,
    costBreakdown,
    period,
    periodLabel,
    rangeLabel,
    accountLabel,
    locale,
    t,
  } = options;

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const scale = 2;
  const width = 880;
  const height = mode === 'trend' ? 720 : 356;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(scale, scale);

  const palette = isDark
    ? {
        bg: '#14161d',
        panel: '#1d2029',
        subCard: '#252935',
        border: '#323746',
        fg: '#f3f1ec',
        muted: '#a3a7b5',
        accent: '#e07b54',
        accentSoft: 'rgba(224, 123, 84, 0.16)',
        input: '#6ea2e8',
        output: '#9e82d8',
        cacheWrite: '#df9f49',
        cacheRead: '#4bb28a',
        grid: 'rgba(255, 255, 255, 0.08)',
      }
    : {
        bg: '#f5f1e8',
        panel: '#fdfbf7',
        subCard: '#f4efe5',
        border: '#ded7ca',
        fg: '#181816',
        muted: '#6c675e',
        accent: '#c96442',
        accentSoft: 'rgba(201, 100, 66, 0.12)',
        input: '#4a78b8',
        output: '#7858b2',
        cacheWrite: '#c8872c',
        cacheRead: '#2f8b67',
        grid: 'rgba(24, 24, 22, 0.08)',
      };

  const fontSans = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const fontMono = '"Cascadia Mono", Consolas, monospace';

  // Background
  fillStrokeRoundRect(ctx, 0, 0, width, height, 18, palette.bg, palette.border);

  // Header bar
  fillStrokeRoundRect(ctx, 20, 18, width - 40, 44, 12, palette.panel, palette.border);
  fillStrokeRoundRect(ctx, 32, 29, 8, 22, 4, palette.accent);

  ctx.fillStyle = palette.fg;
  ctx.font = `700 15px ${fontSans}`;
  ctx.textBaseline = 'middle';
  const titleText = `Claude-Local · ${t('usage.title')}`;
  ctx.fillText(titleText, 48, 40);
  const titleRight = 48 + ctx.measureText(titleText).width + 20;

  const scopeMeta = [
    `${t('usage.accountFilter')}: ${accountLabel}`,
    periodLabel,
    rangeLabel,
    snapshot.timezone || null,
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.font = `500 11.5px ${fontSans}`;
  ctx.fillStyle = palette.muted;
  const maxMetaWidth = Math.max(120, width - 36 - titleRight);
  const truncatedMeta = truncateText(ctx, scopeMeta, maxMetaWidth);
  ctx.fillText(truncatedMeta, width - 36 - ctx.measureText(truncatedMeta).width, 40);

  // Overview Section (y = 74, h = 262)
  const overviewY = 74;
  const overviewH = 262;
  const leftW = 456;
  const rightX = 20 + leftW + 12;
  const rightW = width - 20 - rightX;

  // Left Total Token Card
  fillStrokeRoundRect(ctx, 20, overviewY, leftW, overviewH, 14, palette.panel, palette.border);

  ctx.fillStyle = palette.muted;
  ctx.font = `600 12.5px ${fontSans}`;
  ctx.fillText(t('usage.total'), 38, overviewY + 26);

  const avgTokPerReq =
    snapshot.totals.requests > 0
      ? formatUsageNumber(Math.round(snapshot.totals.total_tokens / snapshot.totals.requests), locale, true)
      : null;
  const reqPillText = `${formatUsageNumber(snapshot.totals.requests, locale, true)} ${t('usage.requests')}${
    avgTokPerReq ? ` · ${t('usage.avgTokensPerRequest', { avg: avgTokPerReq })}` : ''
  }`;
  ctx.font = `500 11px ${fontSans}`;
  const reqPillW = Math.min(264, ctx.measureText(reqPillText).width + 18);
  fillStrokeRoundRect(ctx, 20 + leftW - 18 - reqPillW, overviewY + 14, reqPillW, 24, 12, palette.subCard, palette.border);
  ctx.fillStyle = palette.muted;
  ctx.fillText(truncateText(ctx, reqPillText, reqPillW - 16), 20 + leftW - 18 - reqPillW + 9, overviewY + 26);

  // Hero Total Value
  const heroTotal = formatUsageNumber(snapshot.totals.total_tokens, locale, true);
  ctx.fillStyle = palette.fg;
  ctx.font = `700 36px ${fontSans}`;
  ctx.fillText(heroTotal, 38, overviewY + 68);
  const heroValW = ctx.measureText(heroTotal).width;
  ctx.fillStyle = palette.muted;
  ctx.font = `600 13px ${fontSans}`;
  ctx.fillText(t('usage.tokens'), 38 + heroValW + 8, overviewY + 74);

  // Activity pills (Active Days / Sessions) aligned right on Hero row
  const actPills: string[] = [];
  if (typeof snapshot.activity?.active_days === 'number') {
    actPills.push(`${formatUsageNumber(snapshot.activity.active_days, locale)} ${t('usage.activeDays')}`);
  }
  if (typeof snapshot.activity?.sessions === 'number') {
    actPills.push(`${formatUsageNumber(snapshot.activity.sessions, locale)} ${t('usage.sessions')}`);
  }
  if (actPills.length > 0) {
    ctx.font = `500 11px ${fontSans}`;
    let pillRightX = 20 + leftW - 18;
    for (let i = actPills.length - 1; i >= 0; i--) {
      const pText = actPills[i];
      const pw = ctx.measureText(pText).width + 16;
      if (pillRightX - pw > 38 + heroValW + 56) {
        fillStrokeRoundRect(ctx, pillRightX - pw, overviewY + 56, pw, 22, 11, palette.subCard, palette.border);
        ctx.fillStyle = palette.muted;
        ctx.fillText(pText, pillRightX - pw + 8, overviewY + 67);
        pillRightX -= pw + 6;
      }
    }
  }

  // 4-part Composition Bar
  const compItems = tokenComposition(snapshot.totals);
  const barX = 38;
  const barY = overviewY + 98;
  const barW = leftW - 36;
  const barH = 10;
  fillStrokeRoundRect(ctx, barX, barY, barW, barH, 5, palette.subCard);

  const kindColor: Record<string, string> = {
    input: palette.input,
    output: palette.output,
    cacheWrite: palette.cacheWrite,
    cacheRead: palette.cacheRead,
  };
  const kindCost: Record<string, number> = {
    input: costBreakdown.inputCostUsd,
    output: costBreakdown.outputCostUsd,
    cacheWrite: costBreakdown.cacheWriteCostUsd,
    cacheRead: costBreakdown.cacheReadCostUsd,
  };
  const kindLabel: Record<string, string> = {
    input: t('usage.input'),
    output: t('usage.output'),
    cacheWrite: t('usage.cacheWrite'),
    cacheRead: t('usage.cacheRead'),
  };

  let curBarX = barX;
  for (const item of compItems) {
    if (item.share <= 0) continue;
    const segW = Math.max(3, item.share * barW);
    const clampedW = Math.min(segW, barX + barW - curBarX);
    if (clampedW > 0) {
      fillStrokeRoundRect(ctx, curBarX, barY, clampedW, barH, 3, kindColor[item.kind]);
      curBarX += clampedW;
    }
  }

  // 2x2 Composition Subcards
  const gridY = overviewY + 120;
  const cellW = (barW - 10) / 2;
  const cellH = 56;
  compItems.forEach((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = barX + col * (cellW + 10);
    const cy = gridY + row * (cellH + 10);
    fillStrokeRoundRect(ctx, cx, cy, cellW, cellH, 10, palette.subCard, palette.border);

    // Colored dot
    ctx.beginPath();
    ctx.arc(cx + 14, cy + 18, 4, 0, Math.PI * 2);
    ctx.fillStyle = kindColor[item.kind];
    ctx.fill();

    // Label
    ctx.fillStyle = palette.muted;
    ctx.font = `600 11.5px ${fontSans}`;
    ctx.fillText(kindLabel[item.kind], cx + 24, cy + 18);

    // Share %
    const shareStr = formatShareText(item.tokens, item.share, locale);
    ctx.font = `600 11px ${fontMono}`;
    const shareW = ctx.measureText(shareStr).width;
    ctx.fillText(shareStr, cx + cellW - 12 - shareW, cy + 18);

    // Token value
    const tokStr = formatUsageNumber(item.tokens, locale, true);
    ctx.fillStyle = palette.fg;
    ctx.font = `700 16px ${fontSans}`;
    ctx.fillText(tokStr, cx + 12, cy + 41);

    // Bucket USD Cost
    const costStr = `≈ ${formatUsdCost(kindCost[item.kind], true)}`;
    ctx.fillStyle = palette.muted;
    ctx.font = `500 11px ${fontMono}`;
    const costW = ctx.measureText(costStr).width;
    ctx.fillText(costStr, cx + cellW - 12 - costW, cy + 41);
  });

  // Right 2x2 KPI Cards
  const isHourly = period === 'today' || period === 'yesterday';
  const elapsedBuckets = series.filter(d => !d.future);
  const hasHourlyIntervals =
    isHourly &&
    elapsedBuckets.length > 0 &&
    elapsedBuckets.every(
      d =>
        d.start_at != null &&
        d.end_at != null &&
        Number.isFinite(d.start_at) &&
        Number.isFinite(d.end_at) &&
        d.end_at > d.start_at,
    );
  const elapsedUnits = hasHourlyIntervals
    ? elapsedBuckets.reduce((sum, d) => sum + (d.end_at! - d.start_at!) / 3600, 0)
    : elapsedBuckets.length;
  const avgBucketCost = elapsedUnits > 0 ? costBreakdown.costUsd / elapsedUnits : null;
  const trendSummary = summarizeUsageTrend(series);
  const dominantModel = [...(snapshot.models ?? [])].sort(
    (a, b) => b.totals.total_tokens - a.totals.total_tokens,
  )[0]?.model;
  const primaryModel = dominantModel ?? sortUsageModels(snapshot.models ?? [])[0]?.model;
  const peakBucketCost = trendSummary.peak
    ? estimateTotalsCostUsd(trendSummary.peak.totals, primaryModel).costUsd
    : 0;
  const peakLabel = trendSummary.peak?.day
    ? formatUsagePeakBucketLabel(trendSummary.peak.day, isHourly)
    : '';
  const hit = cacheHitRate(snapshot.totals);
  const hitStr =
    hit === null
      ? '—'
      : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(hit);

  const avgCostPerReq =
    snapshot.totals.requests > 0 ? costBreakdown.costUsd / snapshot.totals.requests : null;
  const sessionEff = summarizeSessionEfficiency(
    snapshot.totals,
    snapshot.activity,
    costBreakdown.costUsd,
  );

  const kpiCards: {
    title: string;
    value: string;
    subItems?: string[];
    fallback: string;
  }[] = [
    {
      title: t('usage.estimatedCost'),
      value: formatUsdCost(costBreakdown.costUsd, costBreakdown.costUsd >= 10_000),
      subItems:
        costBreakdown.costUsd > 0
          ? [
              t('usage.costOutputSub', { cost: formatUsdCost(costBreakdown.outputCostUsd, true) }),
              t('usage.costCacheSub', {
                cost: formatUsdCost(costBreakdown.cacheWriteCostUsd + costBreakdown.cacheReadCostUsd, true),
              }),
              ...(avgCostPerReq != null
                ? [t('usage.avgCostPerRequest', { cost: formatUsdCost(avgCostPerReq) })]
                : []),
            ]
          : undefined,
      fallback: t('usage.estimatedCostHint'),
    },
    {
      title: t('usage.sessionCost'),
      value:
        sessionEff.avgSessionCostUsd != null
          ? formatUsdCost(sessionEff.avgSessionCostUsd, sessionEff.avgSessionCostUsd >= 10_000)
          : '—',
      subItems:
        sessionEff.avgTurnsPerSession != null && sessionEff.avgOutputPerSession != null
          ? [
              t('usage.sessionTurnsSub', {
                turns: formatTurnsPerSession(sessionEff.avgTurnsPerSession, locale),
              }),
              t('usage.sessionOutputSub', {
                output: formatUsageNumber(sessionEff.avgOutputPerSession, locale, true),
              }),
            ]
          : undefined,
      fallback:
        snapshot.totals.requests > 0
          ? t('usage.sessionCostUnavailable')
          : t('usage.sessionCostHint'),
    },
    {
      title: t('usage.cacheHit'),
      value: hitStr,
      subItems:
        costBreakdown.cacheReuseRatio != null
          ? [
              t('usage.cacheReuseRatioSub', { ratio: costBreakdown.cacheReuseRatio.toFixed(1) }),
              t('usage.cacheReadSub', {
                read: formatUsageNumber(snapshot.totals.cache_read_tokens, locale, true),
              }),
            ]
          : undefined,
      fallback: t('usage.cacheHitHint'),
    },
    {
      title: t(isHourly ? 'usage.hourlyCostPace' : 'usage.dailyCostPace'),
      value: avgBucketCost != null ? formatUsdCost(avgBucketCost, avgBucketCost >= 10_000) : '—',
      subItems:
        peakBucketCost > 0 && peakLabel
          ? [t('usage.pacePeakCostSub', { cost: formatUsdCost(peakBucketCost, true) }), peakLabel]
          : undefined,
      fallback: t('usage.paceHint'),
    },
  ];

  const kpiW = (rightW - 10) / 2;
  const kpiH = (overviewH - 10) / 2;
  const kpiTextW = kpiW - 28;
  kpiCards.forEach((kpi, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const kx = rightX + col * (kpiW + 10);
    const ky = overviewY + row * (kpiH + 10);
    fillStrokeRoundRect(ctx, kx, ky, kpiW, kpiH, 14, palette.panel, palette.border);

    ctx.fillStyle = palette.muted;
    ctx.font = `600 12px ${fontSans}`;
    ctx.fillText(truncateText(ctx, kpi.title, kpiTextW), kx + 14, ky + 22);

    ctx.fillStyle = palette.fg;
    ctx.font = `700 24px ${fontSans}`;
    ctx.fillText(truncateText(ctx, kpi.value, kpiTextW), kx + 14, ky + 55);

    ctx.fillStyle = palette.muted;
    ctx.font = `500 10.5px ${fontSans}`;
    const subLines = kpi.subItems?.length
      ? packSubItemLines(ctx, kpi.subItems, kpiTextW, 2)
      : wrapTextLines(ctx, kpi.fallback, kpiTextW, 2);
    subLines.forEach((line, lineIdx) => {
      ctx.fillText(line, kx + 14, ky + 87 + lineIdx * 16);
    });
  });

  if (mode === 'trend') {
    const bottomY = overviewY + overviewH + 14;
    const bottomH = height - bottomY - 18;
    const trendW = 520;
    const modelsX = 20 + trendW + 12;
    const modelsW = width - 20 - modelsX;

    // Bottom-Left: Usage Trend Card
    fillStrokeRoundRect(ctx, 20, bottomY, trendW, bottomH, 14, palette.panel, palette.border);
    fillStrokeRoundRect(ctx, 36, bottomY + 17, 4, 16, 2, palette.accent);
    ctx.fillStyle = palette.fg;
    ctx.font = `700 14px ${fontSans}`;
    ctx.fillText(t('usage.daily'), 48, bottomY + 25);

    const summaryBoxes = [
      {
        label: t(isHourly ? 'usage.averageHour' : 'usage.averageDay'),
        val: `${formatUsageNumber(trendSummary.average, locale, true)} ${t('usage.tokens')}`,
      },
      {
        label: t(isHourly ? 'usage.peakHour' : 'usage.peakDay'),
        val: trendSummary.peak
          ? `${formatUsageNumber(trendSummary.peak.totals.total_tokens, locale, true)} (${formatUsagePeakBucketLabel(trendSummary.peak.day, isHourly)})`
          : '—',
      },
      {
        label: t('usage.outputThroughput'),
        val: `${formatUsageNumber(snapshot.totals.output_tokens, locale, true)} ${t('usage.tokens')}`,
      },
    ];
    const sBoxW = (trendW - 36 - 16) / 3;
    summaryBoxes.forEach((box, idx) => {
      const bx = 36 + idx * (sBoxW + 8);
      const by = bottomY + 44;
      fillStrokeRoundRect(ctx, bx, by, sBoxW, 50, 10, palette.subCard, palette.border);
      ctx.fillStyle = palette.muted;
      ctx.font = `500 10.5px ${fontSans}`;
      ctx.fillText(truncateText(ctx, box.label, sBoxW - 16), bx + 10, by + 16);
      ctx.fillStyle = palette.fg;
      ctx.font = `700 14px ${fontSans}`;
      ctx.fillText(truncateText(ctx, box.val, sBoxW - 16), bx + 10, by + 36);
    });

    // Area Chart
    const chartX = 76;
    const chartY = bottomY + 112;
    const chartW = trendW - 96;
    const chartH = bottomH - 142;
    const elapsed = series.filter(d => !d.future);
    const maxVal = Math.max(1, ...elapsed.map(d => d.totals.total_tokens));

    // Horizontal grid lines
    for (let i = 0; i <= 3; i++) {
      const gy = chartY + (chartH * i) / 3;
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartX, gy);
      ctx.lineTo(chartX + chartW, gy);
      ctx.stroke();

      const tickVal = Math.round((maxVal * (3 - i)) / 3);
      ctx.fillStyle = palette.muted;
      ctx.font = `500 10px ${fontMono}`;
      const tickStr = formatUsageNumber(tickVal, locale, true);
      ctx.fillText(tickStr, chartX - 8 - ctx.measureText(tickStr).width, gy);
    }

    if (elapsed.length > 0) {
      const ptX = (idx: number) =>
        elapsed.length === 1 ? chartX + chartW / 2 : chartX + (idx * chartW) / (elapsed.length - 1);
      const ptY = (tokens: number) => chartY + chartH - (tokens / maxVal) * chartH;

      // Area fill
      ctx.beginPath();
      ctx.moveTo(ptX(0), chartY + chartH);
      elapsed.forEach((d, idx) => ctx.lineTo(ptX(idx), ptY(d.totals.total_tokens)));
      ctx.lineTo(ptX(elapsed.length - 1), chartY + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
      grad.addColorStop(0, isDark ? 'rgba(224, 123, 84, 0.36)' : 'rgba(201, 100, 66, 0.28)');
      grad.addColorStop(1, 'rgba(201, 100, 66, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      elapsed.forEach((d, idx) => {
        if (idx === 0) ctx.moveTo(ptX(idx), ptY(d.totals.total_tokens));
        else ctx.lineTo(ptX(idx), ptY(d.totals.total_tokens));
      });
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // X-axis first/middle/last labels
      const indices = Array.from(new Set([0, Math.floor((elapsed.length - 1) / 2), elapsed.length - 1]));
      ctx.fillStyle = palette.muted;
      ctx.font = `500 10px ${fontMono}`;
      for (const idx of indices) {
        const raw = elapsed[idx].day;
        const lbl = raw.includes('T') ? raw.slice(11, 16) : raw.slice(5);
        const lw = ctx.measureText(lbl).width;
        ctx.fillText(lbl, Math.min(chartX + chartW - lw, Math.max(chartX, ptX(idx) - lw / 2)), chartY + chartH + 14);
      }
    }

    // Bottom-Right: Model Distribution Card
    fillStrokeRoundRect(ctx, modelsX, bottomY, modelsW, bottomH, 14, palette.panel, palette.border);
    fillStrokeRoundRect(ctx, modelsX + 16, bottomY + 17, 4, 16, 2, palette.accent);
    ctx.fillStyle = palette.fg;
    ctx.font = `700 14px ${fontSans}`;
    ctx.fillText(`${t('usage.models')} (${snapshot.models.length})`, modelsX + 28, bottomY + 25);

    const topModels = sortUsageModels(snapshot.models).slice(0, 3);
    const mLeftX = modelsX + 24;
    const mBarW = modelsW - 48;
    const mRightX = mLeftX + mBarW;
    const mCardH = 92;
    const statLabelFont = `500 10.5px ${fontSans}`;
    const statValueFont = `600 10.5px ${fontSans}`;
    const shareFont = `500 10.5px ${fontMono}`;
    const tokenFont = `700 12px ${fontSans}`;

    ctx.font = shareFont;
    const shareColW = Math.max(
      36,
      ...topModels.map(m => {
        const mShare = snapshot.totals.total_tokens > 0 ? m.totals.total_tokens / snapshot.totals.total_tokens : 0;
        return ctx.measureText(formatShareText(m.totals.total_tokens, mShare, locale)).width;
      }),
    );

    topModels.forEach((model, idx) => {
      const my = bottomY + 44 + idx * 100;
      fillStrokeRoundRect(ctx, modelsX + 14, my, modelsW - 28, mCardH, 10, palette.subCard, palette.border);

      const family = detectModelFamily(model.model);
      const modelShare = snapshot.totals.total_tokens > 0 ? model.totals.total_tokens / snapshot.totals.total_tokens : 0;
      const modelCost = estimateTotalsCostUsd(model.totals, model.model);
      const rawName = model.model === 'unknown' ? t('usage.unknownModel') : model.model;

      const shareStr = formatShareText(model.totals.total_tokens, modelShare, locale);
      ctx.font = shareFont;
      ctx.fillStyle = palette.muted;
      ctx.fillText(shareStr, mRightX - ctx.measureText(shareStr).width, my + 17.5);

      const tokStr = formatUsageNumber(model.totals.total_tokens, locale, true);
      ctx.font = tokenFont;
      const tokW = ctx.measureText(tokStr).width;
      ctx.fillStyle = palette.fg;
      ctx.fillText(tokStr, mRightX - shareColW - 6 - tokW, my + 17);

      const maxTitleW = Math.max(80, mBarW - tokW - 6 - shareColW - 10);
      ctx.fillStyle = palette.fg;
      ctx.font = tokenFont;
      ctx.fillText(
        truncateText(ctx, family.label ? `[${family.label}] ${rawName}` : rawName, maxTitleW),
        mLeftX,
        my + 17,
      );

      // Model share bar
      fillStrokeRoundRect(ctx, mLeftX, my + 29, mBarW, 5, 2.5, palette.panel);
      if (modelShare > 0) {
        fillStrokeRoundRect(ctx, mLeftX, my + 29, Math.max(4, mBarW * modelShare), 5, 2.5, palette.accent);
      }

      // 2x2 micro-stats grid (Est. Cost / Output / Turns / Cache Hit) aligned to mBarW
      const mHit = cacheHitRate(model.totals);
      const mHitStr =
        mHit == null
          ? '—'
          : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
              style: 'percent',
              maximumFractionDigits: 1,
            }).format(mHit);

      drawModelStatPair(
        ctx,
        mLeftX,
        my + 47,
        'left',
        { text: t('usage.modelStatEstLabel'), font: statLabelFont, color: palette.muted },
        { text: formatUsdCost(modelCost.costUsd, modelCost.costUsd >= 10_000), font: statValueFont, color: palette.fg },
      );
      drawModelStatPair(
        ctx,
        mRightX,
        my + 47,
        'right',
        { text: t('usage.modelStatOutputLabel'), font: statLabelFont, color: palette.muted },
        { text: formatUsageNumber(model.totals.output_tokens, locale, true), font: statValueFont, color: palette.fg },
      );
      drawModelStatPair(
        ctx,
        mLeftX,
        my + 63,
        'left',
        { text: formatUsageNumber(model.totals.requests, locale, true), font: statValueFont, color: palette.fg },
        { text: t('usage.modelStatTurnsUnit'), font: statLabelFont, color: palette.muted },
      );
      drawModelStatPair(
        ctx,
        mRightX,
        my + 63,
        'right',
        { text: t('usage.modelStatHitLabel'), font: statLabelFont, color: palette.muted },
        { text: mHitStr, font: statValueFont, color: palette.fg },
      );

      // 4-color composition track
      fillStrokeRoundRect(ctx, mLeftX, my + 77, mBarW, 4, 2, palette.panel);
      let mx = mLeftX;
      for (const seg of tokenComposition(model.totals)) {
        if (seg.share <= 0) continue;
        const sw = Math.min(Math.max(2, seg.share * mBarW), mRightX - mx);
        if (sw > 0) {
          fillStrokeRoundRect(ctx, mx, my + 77, sw, 4, 2, kindColor[seg.kind]);
          mx += sw;
        }
      }
    });
  }

  return canvas;
}

function triggerPngDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.click();
}

export async function captureUsageScreenshot(
  options: UsageScreenshotOptions,
): Promise<UsageScreenshotResult> {
  const canvas = renderUsageScreenshotCanvas(options);
  const dataUrl = canvas.toDataURL('image/png');
  const datePart = new Date(options.snapshot.generated_at * 1000).toISOString().slice(0, 10);
  const filename = `claude-local-usage-${options.mode}-${datePart}.png`;

  const record = {
    mode: options.mode,
    action: options.action,
    width: canvas.width,
    height: canvas.height,
    dataUrl,
  };
  if (typeof window !== 'undefined') {
    (window as unknown as { __lastUsageScreenshot?: typeof record }).__lastUsageScreenshot = record;
    const fixture = (window as unknown as { usageFixture?: { screenshots?: (typeof record)[] } }).usageFixture;
    if (fixture) {
      fixture.screenshots = fixture.screenshots ?? [];
      fixture.screenshots.push(record);
    }
  }

  if (options.action === 'download') {
    triggerPngDownload(dataUrl, filename);
    return {
      mode: options.mode,
      copied: false,
      downloaded: true,
      width: canvas.width,
      height: canvas.height,
      dataUrl,
    };
  }

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (blob && typeof navigator !== 'undefined' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return {
        mode: options.mode,
        copied: true,
        downloaded: false,
        width: canvas.width,
        height: canvas.height,
        dataUrl,
      };
    } catch {
      // Fall through to PNG download if clipboard image write is blocked by the environment.
    }
  }

  triggerPngDownload(dataUrl, filename);
  return {
    mode: options.mode,
    copied: false,
    downloaded: true,
    width: canvas.width,
    height: canvas.height,
    dataUrl,
  };
}
