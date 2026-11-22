/**
 * [INPUT]: Sanitized identity card summaries, quota evaluation models, subscription metadata, privacy preferences and card drag-reorder props.
 * [OUTPUT]: Shared card rail & modal UI primitives (`QuotaWindow`, `IdentityQuota`, `SubscriptionAndResets`, `IdentityName`, `IdentityCard`) and shared identity UI types/comparators.
 * [POS]: Pure presentation primitives & types under `src/identities/`; preserves `166x286` card geometry, accessibility attributes and zero-transform drag styling.
 * [PROTOCOL]: Update this header and `src/CLAUDE.md` when changing primitives or shared identity panel types.
 */
import type {KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {formatSubscriptionAndResets, type SubscriptionExpiryBadge} from '../identity-online-quota';
import {evaluateQuota, formatCompactEta, formatElapsedSinceReset, formatResetClock, type WeeklyPace} from '../identity-quota';
import type {ActiveSession, Identity, IdentitySubscriptionMetadata} from '../identity-model';
import {maskDisplayName} from '../settings-model';
import {formatTruthfulPercent, normalizePlanSlug} from '../smart-relay-model';

export type TranslateFn = (key: string, slots?: Record<string, string | number>) => string;
export type Target = Identity | 'empty' | 'recovery';
export type QuotaSetupStatus = {
  state: 'not_configured' | 'custom_statusline' | 'invalid_settings_path' | 'invalid_settings_json' | 'invalid_statusline';
  collector_bundled: boolean;
  has_statusline: boolean;
};
export type CardFilterKind = 'all' | 'ready' | 'reset_cards' | 'expiring' | 'live';
export type QuotaFeedbackEntry =
  | ''
  | string
  | {key: string; values?: Record<string, string | number>}
  | {render: (tr: TranslateFn) => string};

export interface ExpiryEditorState {
  accountId: string;
  expectedIdentity: string | null;
  label: string;
  email: string | null;
  plan: string | null;
  manualPlan: string;
  initialManualPlan: string;
  rechargeYmd: string;
  expiryYmd: string;
  initialRechargeYmd: string;
  initialExpiryYmd: string;
  browserSyncedShortMd: string | null;
  browserSyncedFullYmd: string | null;
  hasManual: boolean;
  error: string;
}

export function QuotaWindow({
  label,
  used,
  remaining,
  resetAt,
  inferredResetAt = null,
  resetComplete = false,
  inferred = false,
  noLimit = false,
  known,
  level,
  display,
  nowSec,
  pace = null,
  inDialog = false,
  t,
}: {
  label: string;
  used: number;
  remaining: number;
  resetAt: number | null;
  inferredResetAt?: number | null;
  resetComplete?: boolean;
  inferred?: boolean;
  noLimit?: boolean;
  known: boolean;
  level: string;
  display: 'remaining' | 'used';
  nowSec: number;
  pace?: WeeklyPace | null;
  inDialog?: boolean;
  t: TranslateFn;
}) {
  const value = display === 'used' ? used : remaining;
  const reset = resetAt ? formatResetClock(resetAt, true) : '';
  const countdown = formatCompactEta(resetAt, nowSec);
  const inferredClock = inferred && inferredResetAt ? formatResetClock(inferredResetAt, true) : '';
  const inferredElapsed = inferred && inferredResetAt ? formatElapsedSinceReset(inferredResetAt, nowSec) : '';
  const inferredStatusLabel = inferred
    ? t(display === 'used' ? 'identityCard.resetInferredUsed' : 'identityCard.resetInferredRemaining')
    : '';
  const inferredTimeSummary = inferred && inferredClock
    ? (inferredElapsed ? t('identityCard.resetInferredElapsed', {clock: inferredClock, elapsed: inferredElapsed}) : inferredClock)
    : '';
  const resetPrefix = t('identityCard.reset').trim();
  const resetLabel = noLimit
    ? t('quota.unlimitedHint')
    : inferred
      ? label
      : reset ? (resetPrefix ? `${resetPrefix} ${reset}` : reset) : resetComplete ? t('identityCard.windowExpired') : t('identityCard.resetUnavailable');
  const rightMeta = noLimit ? '' : countdown || (inferred ? (inDialog && inferredTimeSummary ? `${label} · ${inferredTimeSummary}` : label) : '');
  const resetTooltip = noLimit
    ? t('quota.unlimitedHint')
    : countdown
      ? `${resetLabel} · ${countdown}`
      : inferred && inferredTimeSummary
        ? `${inferredStatusLabel} · ${inferredTimeSummary}`
        : inferredClock
          ? `${resetLabel} · ${inferredClock}`
          : resetLabel;
  const resetDate = resetAt == null ? null : new Date(resetAt * 1000);
  const resetDateTime = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;
  const paceExpected = pace ? (display === 'used' ? pace.expectedUsedPct : pace.expectedRemPct) : null;
  const clockIcon = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><path d="M8 4.5V8l2.2 1.4" /></svg>;
  const pctText = formatTruthfulPercent(value);
  const ariaLabel = noLimit
    ? `${label} ${t('identityCard.unlimited')}`
    : `${label} ${known ? `${t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')} ${pctText}` : t('identityCard.quotaUnknown')}${inferred ? ` · ${resetLabel}` : ''}`;
  return (
    <div className={`identity-quota-window ${known ? `quota-${level}` : 'quota-unknown'}`} data-quota-window={label} data-quota-inferred={inferred || undefined} data-quota-unlimited={noLimit || undefined} title={inferred ? t('quota.resetInferredHint') : undefined} aria-label={ariaLabel}>
      <div className="identity-quota-copy">
        <strong>{label}</strong>
        <span className="identity-quota-value">{noLimit ? <strong>{t('identityCard.unlimited')}</strong> : known ? <><span>{t(display === 'used' ? 'identityCard.used' : 'identityCard.remaining')}</span>{' '}<strong>{pctText}</strong></> : t('identityCard.unknown')}</span>
      </div>
      <span className={`identity-quota-track ${inferred ? 'quota-track-inferred' : ''}`} role="img" aria-label={noLimit ? t('identityCard.unlimited') : known ? pctText : t('identityCard.quotaUnknown')}>
        {known && <i style={{width: `${noLimit ? 100 : Math.max(0, Math.min(100, value))}%`}} />}
        {known && !noLimit && !inferred && pace && !pace.suppressed && paceExpected !== null && (
          <b
            className={`identity-quota-pace-tick${pace.ahead ? ' ahead' : ''}`}
            style={{left: `${Math.max(2, Math.min(98, paceExpected))}%`}}
            title={t('quota.paceTickLabel', {expected: paceExpected})}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="identity-quota-reset" title={resetTooltip}>
        <span className="identity-quota-reset-label">{noLimit ? resetLabel : reset ? <>{clockIcon}<time className="identity-reset-time" dateTime={resetDateTime} aria-label={resetLabel}>{reset}</time></> : inferred ? <>{clockIcon}<span>—</span></> : resetLabel}</span>
        {rightMeta && <span className="identity-quota-countdown">{rightMeta}</span>}
      </span>
    </div>
  );
}

export function IdentityQuota({
  quota,
  display,
  nowSec,
  inDialog = false,
  t,
  onOpenDetails,
}: {
  quota: ReturnType<typeof evaluateQuota>;
  display: 'remaining' | 'used';
  nowSec: number;
  inDialog?: boolean;
  t: TranslateFn;
  onOpenDetails?: () => void;
}) {
  return (
    <div className="identity-quota-stack identity-quota-open" data-identity-quota tabIndex={0} role="button" aria-label={t('quota.details')} onClick={onOpenDetails} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails?.(); }}}>
      <QuotaWindow label="5h" used={quota?.used5h ?? 0} remaining={quota?.rem5h ?? 0} resetAt={quota?.r5 ?? null} inferredResetAt={quota?.inferredReset5h ?? null} resetComplete={quota?.expired5h} inferred={quota?.inferred5h} noLimit={Boolean(quota?.no5hLimit)} known={quota?.known5h ?? false} level={quota?.level5h ?? 'ok'} display={display} nowSec={nowSec} inDialog={inDialog} t={t} />
      <QuotaWindow label="7d" used={quota?.used7d ?? 0} remaining={quota?.rem7d ?? 0} resetAt={quota?.r7 ?? null} inferredResetAt={quota?.inferredReset7d ?? null} resetComplete={quota?.expired7d} inferred={quota?.inferred7d} known={quota?.known7d ?? false} level={quota?.level7d ?? 'ok'} display={display} nowSec={nowSec} pace={quota?.pace7d ?? null} inDialog={inDialog} t={t} />
    </div>
  );
}

export function SubscriptionAndResets({
  meta,
  locale,
  showBilling = false,
  nowSec,
  t,
}: {
  meta: IdentitySubscriptionMetadata | null | undefined;
  locale: string;
  showBilling?: boolean;
  nowSec?: number;
  t: TranslateFn;
}) {
  const nowMs = typeof nowSec === 'number' ? nowSec * 1000 : Date.now();
  const display = formatSubscriptionAndResets(meta, locale, t, nowMs);
  const billing = showBilling ? display.billing : null;
  // Resets known to have ended are hidden; otherwise the last synced count is shown as-is.
  const manualResets = display.manualResets && !display.manualResets.ended ? display.manualResets : undefined;
  if (!billing && !manualResets) return null;
  const resetUrgency = manualResets && manualResets.usable && manualResets.urgency !== 'normal' ? manualResets.urgency : undefined;
  const resetUrgencyTitle = resetUrgency && manualResets?.realExpiresAt
    ? t('quota.manualResetsExpiringSoon', {countdown: formatCompactEta(manualResets.realExpiresAt, Math.floor(nowMs / 1000))})
    : undefined;
  return (
    <div className="identity-sub-resets-block">
      {billing && (
        <div className="identity-sub-resets-row">
          <strong>{billing.label}</strong>
          <span>{billing.formattedDate}</span>
        </div>
      )}
      {manualResets && (
        <div className="identity-sub-resets-row" data-reset-urgency={resetUrgency} title={resetUrgencyTitle}>
          <strong>{manualResets.label}</strong>
          <span>{t('identityCard.manualResetsCount', {count: manualResets.remaining, v0: manualResets.remaining})}</span>
        </div>
      )}
    </div>
  );
}

export function computeExpiryUrgency(expiry: SubscriptionExpiryBadge | null | undefined, nowSec?: number): 'soon' | 'expired' | undefined {
  if (!expiry || typeof nowSec !== 'number') return undefined;
  const parts = expiry.fullYmd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return undefined;
  const [yy, mm, dd] = parts;
  const endOfDaySec = Math.floor(new Date(yy, mm - 1, dd, 23, 59, 59).getTime() / 1000);
  const delta = endOfDaySec - nowSec;
  if (delta <= 0 && expiry.source !== 'browser') return 'expired';
  if (delta > 0 && delta <= 72 * 3600) return 'soon';
  return undefined;
}

export function IdentityName({
  name,
  email,
  accountName,
  plan,
  expiry = null,
  nowSec,
  onEditExpiry,
  privacyMask,
  saved = false,
  t,
}: {
  name: string;
  email?: string | null;
  accountName?: string | null;
  plan?: string | null;
  expiry?: SubscriptionExpiryBadge | null;
  nowSec?: number;
  onEditExpiry?: () => void;
  privacyMask: boolean;
  saved?: boolean;
  t: TranslateFn;
}) {
  const shownName = maskDisplayName(name, email, privacyMask);
  const description = !privacyMask && accountName && accountName !== name ? `${t('identityCard.accountName')}: ${accountName}` : undefined;
  const hasPlan = Boolean(plan && plan.trim().length > 0);
  const expiryUrgency = computeExpiryUrgency(expiry, nowSec);
  const expiryTooltip = expiry
    ? expiryUrgency === 'expired'
      ? t('identityCard.expiryExpiredTooltip', {expiry: expiry.fullYmd})
      : expiryUrgency === 'soon'
        ? t('identityCard.expirySoonTooltip', {expiry: expiry.fullYmd})
        : expiry.rechargeYmd
          ? t('identityCard.expiryTooltipWithRecharge', {expiry: expiry.fullYmd, recharge: expiry.rechargeYmd})
          : expiry.source === 'browser'
            ? t('identityCard.renewalTooltip', {expiry: expiry.fullYmd})
            : t('identityCard.expiryTooltip', {expiry: expiry.fullYmd})
    : undefined;
  return (
    <h3 className="identity-name-with-label" data-identity-name data-identity-username={!saved || undefined} data-identity-saved-name={saved || undefined} aria-label={shownName} aria-description={description}>
      <strong title={description ? `${shownName}\n${description}` : shownName}>{shownName}</strong>
      {hasPlan && (
        <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(plan)}>
          {plan}
        </span>
      )}
      {expiry && (
        <span
          className={`identity-expiry-tag${onEditExpiry ? ' is-clickable' : ''}`}
          data-identity-expiry
          data-urgency={expiryUrgency}
          role={onEditExpiry ? 'button' : undefined}
          tabIndex={onEditExpiry ? 0 : undefined}
          title={expiryTooltip}
          onClick={onEditExpiry ? e => { e.stopPropagation(); onEditExpiry(); } : undefined}
          onKeyDown={onEditExpiry ? e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onEditExpiry();
            }
          } : undefined}
        >
          {expiry.shortMd}
        </span>
      )}
    </h3>
  );
}

export function sameStringArrays(a?: readonly string[] | null, b?: readonly string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function sameActiveSessions(a: readonly ActiveSession[], b: readonly ActiveSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].pid !== b[i].pid ||
      a[i].entrypoint !== b[i].entrypoint ||
      a[i].workspace !== b[i].workspace ||
      Boolean(a[i].background) !== Boolean(b[i].background) ||
      !sameStringArrays(a[i].child_shells, b[i].child_shells)
    ) {
      return false;
    }
  }
  return true;
}

export function sameSlotSessions(
  a?: Record<string, ActiveSession[]>,
  b?: Record<string, ActiveSession[]>,
): boolean {
  const aKeys = Object.keys(a ?? {}).filter(k => (a![k]?.length ?? 0) > 0).sort();
  const bKeys = Object.keys(b ?? {}).filter(k => (b![k]?.length ?? 0) > 0).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i] || !sameActiveSessions(a![key], b![key])) {
      return false;
    }
  }
  return true;
}

export function canQueryLiveSessions(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & {
    __TAURI_INTERNALS__?: {metadata?: unknown};
    identityFixture?: {supportsLiveSessions?: boolean};
  };
  return Boolean(win.__TAURI_INTERNALS__?.metadata) || Boolean(win.identityFixture?.supportsLiveSessions);
}

export function normalizeNativeErrorKey(err: unknown): string {
  return String(err).replace(/^Error:\s*/i, '').trim();
}

export async function copyTextWithClipboardFallback(text: string): Promise<boolean> {
  try {
    await invoke('copy_result', {text});
    return true;
  } catch {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

// ----- 工牌保留清晰文字与 CSS 阴影悬停，不用 3D 变换栅格化文字 -----
export function IdentityCard({
  className,
  children,
  label,
  title,
  running,
  reorderId,
  isDragging,
  dragOffsetX = 0,
  dragTiltDeg = 0,
  dragHandleLabel,
  onDragStart,
  onDragKeyDown,
}: {
  className: string;
  children: ReactNode;
  label?: string;
  title?: string;
  running?: boolean;
  reorderId?: string;
  isDragging?: boolean;
  dragOffsetX?: number;
  dragTiltDeg?: number;
  dragHandleLabel?: string;
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const dragStyle = isDragging
    ? {transform: `translate3d(${dragOffsetX}px, -4px, 0) scale(1.025) rotate(${dragTiltDeg}deg)`}
    : undefined;
  return (
    <article
      className={className}
      aria-label={label}
      title={title}
      data-running={running !== undefined ? (running ? 'true' : 'false') : undefined}
      data-reorder-card-id={reorderId}
      style={dragStyle}
    >
      {reorderId && (
        <div
          className="identity-card-drag-handle"
          data-card-drag-handle
          title={dragHandleLabel}
          aria-label={dragHandleLabel}
          tabIndex={0}
          onPointerDown={onDragStart}
          onKeyDown={onDragKeyDown}
        />
      )}
      {children}
    </article>
  );
}
