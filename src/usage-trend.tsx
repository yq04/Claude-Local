/**
 * [INPUT]: Hourly or daily local totals, future-hour markers and the shared locale.
 * [OUTPUT]: Compact responsive total-token area chart with keyboard/pointer exact-value tooltips.
 * [POS]: Usage analytics visualization; one metric and one theme accent, no synthetic trends.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useId, useRef, useState} from 'react';
import {useI18n} from './i18n';
import {formatUsageNumber, type UsageDay} from './usage-model';

export function UsageTrend({days, hourly = false, timezone}: {days: UsageDay[]; hourly?: boolean; timezone?: string}) {
  const {t, locale} = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const [active, setActive] = useState<number | null>(null);
  const fillId = useId().replaceAll(':', '');
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(300, entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [days]);
  const height = 224, left = 58, right = width - 16, top = 18, bottom = 185;
  const largest = days.reduce((maximum, day) => day.future ? maximum : Math.max(maximum, day.totals.total_tokens), 4);
  const magnitude = 10 ** Math.floor(Math.log10(largest / 4));
  const step = ([1, 2, 2.5, 5, 10].find(value => value >= largest / 4 / magnitude) ?? 10) * magnitude;
  const maximum = step * 4;
  const points = days.map((day, index) => ({
    x: days.length === 1 ? (left + right) / 2 : left + index / (days.length - 1) * (right - left),
    y: bottom - day.totals.total_tokens / maximum * (bottom - top),
  }));
  const recordedPoints = points.filter((_, index) => !days[index].future);
  const line = recordedPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = recordedPoints.length ? `${line} L${recordedPoints[recordedPoints.length - 1].x},${bottom} L${recordedPoints[0].x},${bottom} Z` : '';
  const activeIndex = active != null && active < days.length ? active : null;
  const selected = activeIndex == null ? null : days[activeIndex];
  const firstFuture = days.findIndex(day => day.future);
  const futureStart = firstFuture > 0 ? (points[firstFuture - 1].x + points[firstFuture].x) / 2 : null;
  const bucketLabel = (day: UsageDay) => {
    if (!hourly) return new Date(`${day.day}T12:00:00`).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {month: 'numeric', day: 'numeric'});
    if (day.start_at != null) return new Date(day.start_at * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {hour: '2-digit', minute: '2-digit', ...(timezone ? {timeZone: timezone} : {})});
    return day.day.slice(11, 16);
  };
  const fullLabel = (day: UsageDay) => {
    if (!hourly) return day.day;
    if (day.start_at != null && day.end_at != null) {
      const opts: Intl.DateTimeFormatOptions = {hour: '2-digit', minute: '2-digit', ...(timezone ? {timeZone: timezone} : {})};
      const start = new Date(day.start_at * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {...opts, timeZoneName: 'short'});
      const end = new Date(day.end_at * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', opts);
      return `${day.day.slice(0, 10)} ${start}–${end}`;
    }
    return `${day.day.slice(0, 10)} ${t('usage.hourRange', {start: day.day.slice(11, 16), end: `${String(Number(day.day.slice(11, 13)) + 1).padStart(2, '0')}:00`})}`;
  };
  const dateIndexes = days.length ? [...new Set(hourly ? [0, Math.round((days.length - 1) / 3), Math.round((days.length - 1) * 2 / 3), days.length - 1] : [0, Math.round((days.length - 1) / 3), Math.round((days.length - 1) * 2 / 3), days.length - 1])] : [];
  const chartLabel = t(hourly ? 'usage.hourly' : 'usage.daily');
  return <div className="usage-trend" ref={container} role="group" aria-label={chartLabel} tabIndex={0} data-usage-granularity={hourly ? 'hour' : 'day'} data-usage-bucket-count={days.length} onBlur={() => setActive(null)} onKeyDown={event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : Math.max(0, Math.min(days.length - 1, (index ?? days.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
  }}>
    {selected && activeIndex != null && <div className="usage-trend-tooltip" role="status" style={{left: Math.max(108, Math.min(width - 108, points[activeIndex].x))}}><span>{fullLabel(selected)}</span>{selected.future ? <strong>{t('usage.future')}</strong> : <><strong>{formatUsageNumber(selected.totals.total_tokens, locale, true)} <small>{t('usage.total')}</small></strong><span>{formatUsageNumber(selected.totals.total_tokens, locale)} Token</span>{selected.totals.requests > 0 && <small className="usage-tooltip-meta">{t('usage.responseCount', {n: formatUsageNumber(selected.totals.requests, locale, true)})} · {t('usage.output')} {formatUsageNumber(selected.totals.output_tokens, locale, true)}</small>}</>}</div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chartLabel} data-usage-total-chart="true" onPointerLeave={() => setActive(null)} onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width * width;
      const index = days.length === 1 ? 0 : Math.round((x - left) / (right - left) * (days.length - 1));
      setActive(Math.max(0, Math.min(days.length - 1, index)));
    }}>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--usage-total)" stopOpacity="0.23" /><stop offset="100%" stopColor="var(--usage-total)" stopOpacity="0.02" /></linearGradient></defs>
      {futureStart != null && <g><rect className="usage-future-region" x={futureStart} y={top} width={right - futureStart} height={bottom - top} />{right - futureStart > 90 && <text className="usage-axis-label" x={(futureStart + right) / 2} y={top + 19} textAnchor="middle">{t('usage.future')}</text>}</g>}
      {[0, 1, 2, 3, 4].map(tick => {
        const y = bottom - tick / 4 * (bottom - top);
        return <g key={tick}><line className="usage-grid-line" x1={left} y1={y} x2={right} y2={y} /><text className="usage-axis-label" x={left - 12} y={y + 4} textAnchor="end">{formatUsageNumber(step * tick, locale, true)}</text></g>;
      })}
      <path d={area} fill={`url(#${fillId})`} />
      <path className="usage-total-line" d={line} fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {(recordedPoints.length === 1 || activeIndex != null) && !selected?.future && <circle className="usage-total-point" cx={points[activeIndex ?? 0]?.x} cy={points[activeIndex ?? 0]?.y} r={5} strokeWidth={2.5} />}
      {activeIndex != null && <line className="usage-total-guide" x1={points[activeIndex].x} y1={top} x2={points[activeIndex].x} y2={bottom} />}
      {dateIndexes.map(index => <text className="usage-axis-label" key={index} x={points[index].x} y={height - 13} textAnchor={days.length === 1 ? 'middle' : index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}>{bucketLabel(days[index])}</text>)}
    </svg>
  </div>;
}
