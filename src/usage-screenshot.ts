/**
 * [INPUT]: 当前已筛选的本地用量快照、序列桶、成本/节省折算、活动主题与双语翻译函数。
 * [OUTPUT]: 零外部依赖的高清 2x Retina Token 消耗截图（支持「数据概览」与「趋势全图」双模式，一键写入剪贴板或下载 PNG）。
 * [POS]: 用量分析的纯前端视觉导出工具；仅消费现有内存快照，不发起 IPC 请求或访问剪贴板历史。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  cacheHitRate,
  detectModelFamily,
  estimateTotalsCostUsd,
  formatUsdCost,
  formatUsageNumber,
  sortUsageModels,
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
  const metaWidth = ctx.measureText(scopeMeta).width;
  ctx.fillText(scopeMeta, Math.max(240, width - 36 - metaWidth), 40);

  // Overview Section (y = 74, h = 262)
  const overviewY = 74;
  const overviewH = 262;
  const leftW = 472;
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
  const reqPillW = Math.min(280, ctx.measureText(reqPillText).width + 18);
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
  const avgBucketCost = elapsedBuckets.length > 0 ? costBreakdown.costUsd / elapsedBuckets.length : 0;
  const trendSummary = summarizeUsageTrend(series);
  const peakTokens = trendSummary.peak?.totals?.total_tokens ?? 0;
  const peakBucketCost =
    peakTokens > 0 && snapshot.totals.total_tokens > 0
      ? costBreakdown.costUsd * (peakTokens / snapshot.totals.total_tokens)
      : 0;
  const peakLabel = trendSummary.peak?.day ? trendSummary.peak.day.slice(-5) : '';
  const hit = cacheHitRate(snapshot.totals);
  const hitStr =
    hit === null
      ? '—'
      : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(hit);

  const costSubBase = t('usage.costBreakdownSub', {
    output: formatUsdCost(costBreakdown.outputCostUsd, true),
    cache: formatUsdCost(costBreakdown.cacheWriteCostUsd + costBreakdown.cacheReadCostUsd, true),
  });

  const kpiCards = [
    {
      title: t('usage.estimatedCost'),
      value: formatUsdCost(costBreakdown.costUsd, costBreakdown.costUsd >= 10_000),
      sub: costBreakdown.costUsd > 0 ? costSubBase : t('usage.estimatedCostHint'),
    },
    {
      title: t('usage.cacheSavings'),
      value: formatUsdCost(costBreakdown.cacheSavingsUsd, true),
      sub:
        costBreakdown.savingsRate != null
          ? t('usage.cacheSavingsRate', {
              rate: new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
                style: 'percent',
                maximumFractionDigits: 1,
              }).format(costBreakdown.savingsRate),
            })
          : t('usage.cacheSavingsHint'),
    },
    {
      title: t('usage.cacheHit'),
      value: hitStr,
      sub:
        costBreakdown.cacheReuseRatio != null
          ? t('usage.cacheReuseSub', {
              ratio: costBreakdown.cacheReuseRatio.toFixed(1),
              read: formatUsageNumber(snapshot.totals.cache_read_tokens, locale, true),
            })
          : t('usage.cacheHitHint'),
    },
    {
      title: t(isHourly ? 'usage.hourlyCostPace' : 'usage.dailyCostPace'),
      value: formatUsdCost(avgBucketCost, avgBucketCost >= 10_000),
      sub:
        peakBucketCost > 0 && peakLabel
          ? t('usage.peakCostSub', {
              cost: formatUsdCost(peakBucketCost, true),
              label: peakLabel,
            })
          : t('usage.paceHint'),
    },
  ];

  const kpiW = (rightW - 10) / 2;
  const kpiH = (overviewH - 10) / 2;
  kpiCards.forEach((kpi, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const kx = rightX + col * (kpiW + 10);
    const ky = overviewY + row * (kpiH + 10);
    fillStrokeRoundRect(ctx, kx, ky, kpiW, kpiH, 14, palette.panel, palette.border);

    ctx.fillStyle = palette.muted;
    ctx.font = `600 12px ${fontSans}`;
    ctx.fillText(truncateText(ctx, kpi.title, kpiW - 24), kx + 14, ky + 24);

    ctx.fillStyle = palette.fg;
    ctx.font = `700 24px ${fontSans}`;
    ctx.fillText(truncateText(ctx, kpi.value, kpiW - 24), kx + 14, ky + 62);

    ctx.fillStyle = palette.muted;
    ctx.font = `500 10.5px ${fontSans}`;
    ctx.fillText(truncateText(ctx, kpi.sub, kpiW - 24), kx + 14, ky + 98);
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
          ? `${formatUsageNumber(trendSummary.peak.totals.total_tokens, locale, true)} (${trendSummary.peak.day.slice(-5)})`
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
    topModels.forEach((model, idx) => {
      const my = bottomY + 46 + idx * 96;
      fillStrokeRoundRect(ctx, modelsX + 14, my, modelsW - 28, 86, 10, palette.subCard, palette.border);

      const family = detectModelFamily(model.model);
      const modelShare = snapshot.totals.total_tokens > 0 ? model.totals.total_tokens / snapshot.totals.total_tokens : 0;
      const modelCost = estimateTotalsCostUsd(model.totals, model.model);
      const rawName = model.model === 'unknown' ? t('usage.unknownModel') : model.model;

      ctx.fillStyle = palette.fg;
      ctx.font = `700 12px ${fontSans}`;
      ctx.fillText(
        truncateText(ctx, family.label ? `[${family.label}] ${rawName}` : rawName, modelsW - 140),
        modelsX + 24,
        my + 20,
      );

      const mRightStr = `${formatUsageNumber(model.totals.total_tokens, locale, true)} (${formatShareText(
        model.totals.total_tokens,
        modelShare,
        locale,
      )})`;
      ctx.font = `600 11px ${fontMono}`;
      ctx.fillStyle = palette.fg;
      ctx.fillText(mRightStr, modelsX + modelsW - 24 - ctx.measureText(mRightStr).width, my + 20);

      // Model share bar
      const mBarW = modelsW - 48;
      fillStrokeRoundRect(ctx, modelsX + 24, my + 34, mBarW, 6, 3, palette.panel);
      if (modelShare > 0) {
        fillStrokeRoundRect(ctx, modelsX + 24, my + 34, Math.max(4, mBarW * modelShare), 6, 3, palette.accent);
      }

      // Model cost & cache line
      const mSubStr = `${t('usage.modelCostCaption', {
        cost: formatUsdCost(modelCost.costUsd, true),
        output: formatUsageNumber(model.totals.output_tokens, locale, true),
      })} · ${t('usage.cacheSavings')} ${formatUsdCost(modelCost.cacheSavingsUsd, true)}`;
      ctx.fillStyle = palette.muted;
      ctx.font = `500 10.5px ${fontSans}`;
      ctx.fillText(truncateText(ctx, mSubStr, mBarW), modelsX + 24, my + 56);

      // 4-color composition track
      let mx = modelsX + 24;
      for (const seg of tokenComposition(model.totals)) {
        if (seg.share <= 0) continue;
        const sw = Math.min(Math.max(2, seg.share * mBarW), modelsX + 24 + mBarW - mx);
        if (sw > 0) {
          fillStrokeRoundRect(ctx, mx, my + 70, sw, 4, 2, kindColor[seg.kind]);
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
