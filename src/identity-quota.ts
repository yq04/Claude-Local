/**
 * [INPUT]: Bounded local quota values, observed window reset timestamps and an explicit clock.
 * [OUTPUT]: Independent quota-window presentation and conservative account recommendation eligibility.
 * [POS]: Pure frontend quota model; no network, ledger writes or account operations.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export type QuotaInput = {quota_5h_used?: number | null; quota_5h_reset_at?: number | null; quota_7d_used?: number | null; quota_7d_reset_at?: number | null; quota_source?: 'server_anchor' | 'local_estimate' | 'unknown' | null};

export function formatCompactEta(resetSec: number | null | undefined, nowSec: number) {
  if (!resetSec || resetSec <= nowSec) return '';
  const mins = Math.max(1, Math.floor((resetSec - nowSec) / 60));
  const d = Math.floor(mins / 1440),
    h = Math.floor((mins % 1440) / 60),
    m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
export function formatResetClock(resetSec: number | null | undefined, includeDate: boolean) {
  if (!resetSec) return '';
  const dt = new Date(resetSec * 1000);
  if (!Number.isFinite(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  if (!includeDate) return `${hh}:${mm}`;
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${mo}-${da} ${hh}:${mm}`;
}
export function evaluateQuota(item: QuotaInput | null | undefined, nowSec: number) {
  if (!item || (item.quota_5h_used == null && item.quota_7d_used == null)) return null;
  const expired7d = item.quota_7d_reset_at != null && nowSec >= item.quota_7d_reset_at;
  const expired5h = item.quota_5h_reset_at != null && nowSec >= item.quota_5h_reset_at;
  const r5 = !expired5h && item.quota_5h_reset_at ? item.quota_5h_reset_at : null;
  const r7 = !expired7d && item.quota_7d_reset_at ? item.quota_7d_reset_at : null;
  const known5h = item.quota_source !== 'unknown' && typeof item.quota_5h_used === 'number' && Number.isFinite(item.quota_5h_used) && !expired5h;
  const known7d = item.quota_source !== 'unknown' && typeof item.quota_7d_used === 'number' && Number.isFinite(item.quota_7d_used) && !expired7d;
  const used5h = known5h ? Math.max(0, Math.min(100, item.quota_5h_used!)) : 0;
  const used7d = known7d ? Math.max(0, Math.min(100, item.quota_7d_used!)) : 0;
  const rem5h = known5h ? 100 - used5h : 0;
  const rem7d = known7d ? 100 - used7d : 0;
  const effectiveRem = Math.min(rem5h, rem7d);
  const level: 'ok' | 'warn' | 'empty' = effectiveRem === 0 ? 'empty' : effectiveRem <= 20 ? 'warn' : 'ok';
  const level5h: 'ok' | 'warn' | 'empty' = rem5h === 0 ? 'empty' : rem5h <= 20 ? 'warn' : 'ok';
  const level7d: 'ok' | 'warn' | 'empty' = rem7d === 0 ? 'empty' : rem7d <= 20 ? 'warn' : 'ok';
  const eta5h = formatCompactEta(r5, nowSec);
  const eta7d = formatCompactEta(r7, nowSec);
  const clock5h = formatResetClock(r5, false);
  const clock7d = formatResetClock(r7, true);
  const primaryEta = rem7d === 0 ? eta7d : eta5h && eta7d ? `${eta5h}/${eta7d}` : eta5h || eta7d;
  const badge = `5h ${known5h ? rem5h + '%' : '?'} · 7d ${known7d ? rem7d + '%' : '?'}${primaryEta ? ` (${primaryEta})` : ''}`;
  const detail = `5h: ${known5h ? rem5h + '%' : '?'}${eta5h ? ` (${eta5h} · ${clock5h})` : ''} | 7d: ${known7d ? rem7d + '%' : '?'}${eta7d ? ` (${eta7d} · ${clock7d})` : ''}`;
  return {rem5h, rem7d, effectiveRem, level, level5h, level7d, primaryEta, badge, detail, used5h, used7d, r5, r7, expired5h, expired7d, known5h, known7d, recommendable: known5h && known7d};
}
