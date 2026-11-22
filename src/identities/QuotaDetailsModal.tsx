/**
 * [INPUT]: Selected `quotaDetails` target, active/saved identity summaries, subscription/reset/KYC metadata, and native `quota_setup_status` / app version IPCs.
 * [OUTPUT]: Controlled `QuotaDetailsModal` dialog (`quota-details-dialog`, width 600) showing 5h/7d windows, burn ETA, Fable pool, weekly pace, plan/expiry/reset/KYC facts, diagnostic copy, and action footer.
 * [POS]: Submodule of `src/identities.tsx`; preserves `restoreFocus={!suppressQuotaRestoreFocus}` focus handoff to `WakeupModal` and `expiryEditor`.
 * [PROTOCOL]: Update this header and `src/CLAUDE.md` when changing QuotaDetails modal props or DOM structure.
 */
import {useEffect, useState} from 'react';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {Button, Disclosure} from 'cromma-ui';
import type {ActivityController} from '../cleaner-activity';
import {formatBytes} from '../cleaner-model';
import {AppDialog} from '../dialog';
import {serializeIdentityDiagnostic} from '../identity-diagnostics';
import {formatObservationAge, quotaObservationAge} from '../identity-list';
import type {IdentityState, IdentitySubscriptionMetadata} from '../identity-model';
import {formatSubscriptionAndResets, formatYmdAsShortMd, type QuotaBatchTarget} from '../identity-online-quota';
import {evaluateQuota, formatCompactEta, formatResetClock} from '../identity-quota';
import {maskDisplayName, maskEmailAddress} from '../settings-model';
import {computeWindowBurnEta, formatTruthfulPercent, normalizePlanSlug} from '../smart-relay-model';
import {
  copyTextWithClipboardFallback,
  QuotaWindow,
  type QuotaFeedbackEntry,
  type QuotaSetupStatus,
  type TranslateFn,
} from './IdentityCardPrimitives';

export interface QuotaDetailsTarget {
  id: string;
  name: string;
  expectedIdentity: string | null;
}

export interface QuotaDetailsModalProps {
  quotaDetails: QuotaDetailsTarget | null;
  state: IdentityState | null;
  current: IdentityState['current'] | undefined;
  suppressQuotaRestoreFocus: boolean;
  busy: boolean;
  loading: boolean;
  manualSyncing: boolean;
  batchBusy: boolean;
  wakingAccountId: string | null;
  syncingAccountIds: Record<string, boolean>;
  quotaFeedbackText: string;
  smartRelaySpentThresholdPct: number;
  nowSec: number;
  quotaDisplay: 'remaining' | 'used';
  privacyMask: boolean;
  locale: string;
  activity: ActivityController;
  setShowCleanroomBar: (show: boolean) => void;
  onQuotaFeedback: (entry: QuotaFeedbackEntry) => void;
  onClose: () => void;
  onRefreshLocal: () => void;
  onWakeSingle: (accountId: string, expectedIdentity: string) => void;
  onCalibrateOnline: () => void;
  onOpenAccountBrowser: (target: QuotaBatchTarget, openMode?: 'usage' | 'claude_ai') => void;
  onOpenUsagePage: () => void;
  onSyncSubscription: (accountId?: string, expectedIdentity?: string, verifyReset?: boolean) => void;
  onOpenExpiryEditor: (
    accountId: string,
    label: string,
    meta: (IdentitySubscriptionMetadata & {
      quota_identity?: string | null;
      email?: string | null;
      plan?: string | null;
      subscription_expires_at?: number | null;
    }) | null | undefined,
  ) => void;
  t: TranslateFn;
}

export function QuotaDetailsModal({
  quotaDetails,
  state,
  current,
  suppressQuotaRestoreFocus,
  busy,
  loading,
  manualSyncing,
  batchBusy,
  wakingAccountId,
  syncingAccountIds,
  quotaFeedbackText,
  smartRelaySpentThresholdPct,
  nowSec,
  quotaDisplay,
  privacyMask,
  locale,
  activity,
  setShowCleanroomBar,
  onQuotaFeedback,
  onClose,
  onRefreshLocal,
  onWakeSingle,
  onCalibrateOnline,
  onOpenAccountBrowser,
  onOpenUsagePage,
  onSyncSubscription,
  onOpenExpiryEditor,
  t,
}: QuotaDetailsModalProps) {
  const [quotaSetup, setQuotaSetup] = useState<QuotaSetupStatus | null>(null);
  const [quotaSetupError, setQuotaSetupError] = useState(false);
  const [copyDiagnosticStatus, setCopyDiagnosticStatus] = useState<'copied' | 'failed' | null>(null);
  const [diagnosticVersion, setDiagnosticVersion] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getVersion()
      .then(value => {
        if (live) setDiagnosticVersion(value);
      })
      .catch(() => {
        if (live) setDiagnosticVersion(null);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!quotaDetails) return;
    let live = true;
    setQuotaSetup(null);
    setQuotaSetupError(false);
    void invoke<QuotaSetupStatus>('quota_setup_status').then(
      value => {
        if (live && value && typeof value.state === 'string') setQuotaSetup(value);
        else if (live) setQuotaSetupError(true);
      },
      () => {
        if (live) setQuotaSetupError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [quotaDetails]);

  const detailsAreCurrent = quotaDetails?.id === 'current' || (!!quotaDetails && quotaDetails.id === state?.active);
  const detailsSummary = detailsAreCurrent ? current : quotaDetails ? state?.summaries[quotaDetails.id] : undefined;
  const detailsQuota = evaluateQuota(detailsSummary, nowSec);
  const detailsSavedRecord =
    quotaDetails && quotaDetails.id !== 'current' ? state?.records.find(row => row.id === quotaDetails.id) : undefined;

  async function copyQuotaDiagnostic() {
    if (!quotaDetails) return;
    setCopyDiagnosticStatus(null);
    const value = serializeIdentityDiagnostic({
      version: diagnosticVersion,
      generatedAtMs: Date.now(),
      windows: Object.fromEntries(
        (['5h', '7d'] as const).map(window => {
          const source = detailsSummary?.[`quota_${window}_source`] ?? detailsSummary?.quota_source;
          const observedAtMs =
            detailsSummary?.[`quota_${window}_source`] != null
              ? detailsSummary?.[`quota_${window}_observed_at_ms`]
              : detailsSummary?.quota_observed_at_ms;
          return [window, {source, observedAtMs}];
        }),
      ) as {
        '5h': {source: string | null | undefined; observedAtMs?: number | null};
        '7d': {source: string | null | undefined; observedAtMs?: number | null};
      },
      setup: quotaSetup
        ? {
            state: quotaSetup.state,
            collectorBundled: quotaSetup.collector_bundled,
            hasStatusline: quotaSetup.has_statusline,
          }
        : null,
    });
    const ok = await copyTextWithClipboardFallback(value);
    setCopyDiagnosticStatus(ok ? 'copied' : 'failed');
  }

  return (
    <AppDialog
      open={quotaDetails !== null}
      onOpenChange={open => {
        if (!open && !busy) {
          onClose();
        }
      }}
      title={t('quota.details')}
      width={600}
      className="quota-details-dialog"
      restoreFocus={!suppressQuotaRestoreFocus}
      footer={
        <>
          <Button variant="ghost" size="small" disabled={busy || loading || manualSyncing} onClick={onRefreshLocal}>
            {t('quota.refreshLocal')}
          </Button>
          {(detailsQuota?.inferred5h || detailsQuota?.expired5h) && detailsSummary?.quota_identity && (
            <Button
              variant="ghost"
              size="small"
              loading={wakingAccountId === (detailsAreCurrent ? 'current' : quotaDetails?.id)}
              disabled={busy || loading || batchBusy || wakingAccountId !== null}
              onClick={() => onWakeSingle(detailsAreCurrent ? 'current' : quotaDetails!.id, detailsSummary.quota_identity!)}
            >
              {t('wakeup.wakeNow')}
            </Button>
          )}
          {(detailsQuota?.inferred5h || detailsQuota?.inferred7d) && (
            <Button variant="ghost" size="small" disabled={busy || loading || batchBusy} onClick={onCalibrateOnline}>
              {t('quota.calibrateOnline')}
            </Button>
          )}
          <span className="quota-details-footer-spacer" aria-hidden="true" />
          <Button
            variant="secondary"
            size="small"
            loading={busy}
            disabled={busy || !quotaDetails?.expectedIdentity || !state?.browser.enabled || !!state?.recovery}
            onClick={() => {
              if (!quotaDetails?.expectedIdentity) return;
              onOpenAccountBrowser(
                {
                  account_id: detailsAreCurrent ? 'current' : quotaDetails.id,
                  expected_identity: quotaDetails.expectedIdentity,
                },
                'claude_ai',
              );
            }}
          >
            {t('browser.enterClaudeAi')}
          </Button>
          <Button
            variant="secondary"
            size="small"
            loading={busy}
            disabled={busy || !quotaDetails?.expectedIdentity || !!state?.recovery}
            onClick={() => {
              if (!quotaDetails?.expectedIdentity) return;
              if (detailsAreCurrent) {
                onOpenUsagePage();
              } else {
                onOpenAccountBrowser(
                  {account_id: quotaDetails.id, expected_identity: quotaDetails.expectedIdentity},
                  'usage',
                );
              }
            }}
          >
            {t('quota.openOfficial')}
          </Button>
          {(detailsAreCurrent || !!quotaDetails?.expectedIdentity) && (
            <Button
              variant="primary"
              size="small"
              loading={Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : (quotaDetails?.id ?? '')])}
              disabled={
                busy ||
                loading ||
                !state?.browser.enabled ||
                Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : (quotaDetails?.id ?? '')]) ||
                (!detailsAreCurrent && !quotaDetails?.expectedIdentity)
              }
              onClick={() =>
                onSyncSubscription(
                  detailsAreCurrent ? undefined : quotaDetails?.id,
                  quotaDetails?.expectedIdentity || undefined,
                )
              }
            >
              {t('quota.syncSubscription')}
            </Button>
          )}
        </>
      }
    >
      {(() => {
        const shownName = maskDisplayName(quotaDetails?.name, detailsSummary?.email, privacyMask);
        const plan = detailsSummary?.plan?.trim();
        const initial = (shownName || '?').trim().charAt(0).toUpperCase() || '?';
        const sourceLabel = (window: '5h' | '7d') => {
          const source = detailsQuota?.[window === '5h' ? 'source5h' : 'source7d'];
          const observed =
            detailsSummary?.[`quota_${window}_source`] != null
              ? detailsSummary[`quota_${window}_observed_at_ms`]
              : detailsSummary?.quota_observed_at_ms;
          const age = formatObservationAge(quotaObservationAge(observed, nowSec * 1000));
          const kind = t(
            source === 'server_anchor'
              ? 'quota.sourceShort.server'
              : source === 'local_estimate'
                ? 'quota.sourceShort.estimate'
                : source === 'reset_inferred'
                  ? 'quota.sourceShort.inferred'
                  : 'quota.sourceShort.unverified',
          );
          return {
            kind,
            age: age ? t('identitySearch.age.' + age.unit, {v0: age.value}) : '',
            verified: source === 'server_anchor',
          };
        };
        const windowCard = (window: '5h' | '7d') => {
          const is5h = window === '5h';
          const source = sourceLabel(window);
          const burnEta =
            (!is5h || !detailsQuota?.no5hLimit) &&
            !(is5h ? detailsQuota?.inferred5h : detailsQuota?.inferred7d) &&
            (is5h ? detailsQuota?.known5h : detailsQuota?.known7d)
              ? computeWindowBurnEta(
                  is5h ? detailsQuota?.used5h : detailsQuota?.used7d,
                  is5h ? detailsQuota?.r5 : detailsQuota?.r7,
                  nowSec,
                  is5h ? 5 : 168,
                  smartRelaySpentThresholdPct,
                )
              : null;
          return (
            <article className="quota-details-window" key={window}>
              <QuotaWindow
                label={window}
                used={(is5h ? detailsQuota?.used5h : detailsQuota?.used7d) ?? 0}
                remaining={(is5h ? detailsQuota?.rem5h : detailsQuota?.rem7d) ?? 0}
                resetAt={(is5h ? detailsQuota?.r5 : detailsQuota?.r7) ?? null}
                inferredResetAt={(is5h ? detailsQuota?.inferredReset5h : detailsQuota?.inferredReset7d) ?? null}
                resetComplete={is5h ? detailsQuota?.expired5h : detailsQuota?.expired7d}
                inferred={is5h ? detailsQuota?.inferred5h : detailsQuota?.inferred7d}
                noLimit={is5h ? Boolean(detailsQuota?.no5hLimit) : false}
                known={(is5h ? detailsQuota?.known5h : detailsQuota?.known7d) ?? false}
                level={(is5h ? detailsQuota?.level5h : detailsQuota?.level7d) ?? 'ok'}
                display={quotaDisplay}
                nowSec={nowSec}
                pace={is5h ? null : detailsQuota?.pace7d ?? null}
                inDialog
                t={t}
              />
              {burnEta && (
                <p
                  className={`quota-details-burn-eta${burnEta.hitsBeforeReset ? ' is-warn' : ''}`}
                  data-quota-burn-eta={window}
                >
                  {burnEta.hitsBeforeReset
                    ? t('quota.burnEtaHitsBeforeReset', {
                        rate: burnEta.ratePerHour,
                        eta: formatCompactEta(nowSec + Math.max(60, burnEta.etaToTargetSec ?? 0), nowSec) || '1m',
                      })
                    : t('quota.burnEtaSafeUntilReset', {
                        rate: burnEta.ratePerHour,
                        projected: Math.round(burnEta.projectedEndPct),
                      })}
                </p>
              )}
              <p className="quota-details-source" data-source-verified={source.verified || undefined}>
                <i aria-hidden="true" />
                <span>{source.kind}</span>
                {source.age && <small>{source.age}</small>}
              </p>
            </article>
          );
        };
        const pace = detailsQuota?.pace7d;
        const paceTone = !pace ? null : pace.suppressed ? 'neutral' : pace.ahead ? 'warn' : 'ok';
        const showRiskHint =
          (detailsQuota?.known5h && !detailsQuota.no5hLimit && detailsQuota.used5h >= 85) ||
          (pace && !pace.suppressed && pace.deltaUsedPct >= 15);
        const fableUsed =
          typeof detailsSummary?.quota_7d_fable_used === 'number' && Number.isFinite(detailsSummary.quota_7d_fable_used)
            ? Math.max(0, Math.min(100, detailsSummary.quota_7d_fable_used))
            : null;
        const billingKnown = Boolean(
          detailsSummary?.billing_date &&
            (detailsSummary.billing_date_kind === 'next_renewal' || detailsSummary.billing_date_kind === 'access_until'),
        );
        const subDisplay = formatSubscriptionAndResets(detailsSummary, locale, t, nowSec * 1000);
        const resets = subDisplay.manualResets;
        const resetUrgency = resets && resets.usable && resets.urgency !== 'normal' ? resets.urgency : undefined;
        const resetExpiresAt =
          resets?.usable && resets.remaining > 0 && resets.realExpiresAt ? resets.realExpiresAt : null;
        const resetExpiryClock = (() => {
          if (!resetExpiresAt) return '';
          const clock = formatResetClock(resetExpiresAt, true);
          if (!clock) return '';
          const expYear = new Date(resetExpiresAt * 1000).getFullYear();
          const curYear = new Date(nowSec * 1000).getFullYear();
          return expYear !== curYear ? `${expYear}-${clock}` : clock;
        })();
        const tokenExpiry =
          typeof detailsSummary?.refresh_token_expires_at === 'number' &&
          Number.isFinite(detailsSummary.refresh_token_expires_at) &&
          detailsSummary.refresh_token_expires_at > 0 &&
          detailsSummary.refresh_token_expires_at - nowSec <= 7 * 86400
            ? detailsSummary.refresh_token_expires_at
            : null;
        const isolated = state?.browser.enabled
          ? detailsAreCurrent || (quotaDetails && state.browser.bound_ids.includes(quotaDetails.id))
            ? 'active'
            : 'pending'
          : 'off';
        const kycInfo = (() => {
          const status = typeof detailsSummary?.kyc_status === 'string' ? detailsSummary.kyc_status.trim().toLowerCase() : '';
          if (!status) return null;
          const checkKind =
            typeof detailsSummary?.kyc_check_kind === 'string' &&
            /^[a-z0-9_-]{1,32}$/.test(detailsSummary.kyc_check_kind.trim().toLowerCase())
              ? detailsSummary.kyc_check_kind.trim().toLowerCase()
              : '';
          const kycAge = formatObservationAge(quotaObservationAge(detailsSummary?.kyc_observed_at_ms, nowSec * 1000));
          const observedAge = kycAge ? t('identitySearch.age.' + kycAge.unit, {v0: kycAge.value}) : '';
          if (status === 'not_required') {
            return {status, tone: 'neutral' as const, labelKey: 'quota.kycStatus.notRequired', checkKind, observedAge};
          }
          if (status === 'pending' || status === 'required' || status === 'in_progress') {
            return {status, tone: 'warn' as const, labelKey: 'quota.kycStatus.pending', checkKind, observedAge};
          }
          if (status === 'completed' || status === 'approved' || status === 'verified') {
            return {status, tone: 'ok' as const, labelKey: 'quota.kycStatus.verified', checkKind, observedAge};
          }
          if (status === 'expired') {
            return {status, tone: 'danger' as const, labelKey: 'quota.kycStatus.expired', checkKind, observedAge};
          }
          if (status === 'failed' || status === 'declined') {
            return {status, tone: 'danger' as const, labelKey: 'quota.kycStatus.issue', checkKind, observedAge};
          }
          return null;
        })();
        return (
          <div className="identity-quota-details quota-details">
            <header className="quota-details-profile">
              <span className="quota-details-avatar" aria-hidden="true">{initial}</span>
              <div className="quota-details-who">
                <h3>{shownName}</h3>
                {detailsSummary?.email && <p>{maskEmailAddress(detailsSummary.email, privacyMask)}</p>}
              </div>
              {plan && (
                <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(plan)}>
                  {plan}
                </span>
              )}
              {detailsAreCurrent && <span className="quota-details-current">{t('quota.currentAccount')}</span>}
            </header>

            <section className="quota-details-windows" aria-label={t('quota.windowsHeading')}>
              {windowCard('5h')}
              {windowCard('7d')}
              {fableUsed !== null && (() => {
                const fableResetSec = detailsSummary?.quota_7d_fable_reset_at ?? null;
                const fableEta = formatCompactEta(fableResetSec, nowSec);
                const fableClock = formatResetClock(fableResetSec, true);
                return (
                  <div className="quota-details-pool" data-quota-fable-7d>
                    <span>{t('quota.fable7dLabel')}</span>
                    <strong>{t('quota.fable7dValue', {
                      used: formatTruthfulPercent(fableUsed).replace(/%$/, ''),
                      remaining: formatTruthfulPercent(Math.max(0, 100 - fableUsed)).replace(/%$/, ''),
                    })}</strong>
                    {(fableEta || fableClock) && <small>{fableEta && fableClock ? `${fableClock} · ${fableEta}` : fableEta || fableClock}</small>}
                  </div>
                );
              })()}
            </section>

            {pace && (
              <div className="quota-details-pace" data-tone={paceTone}>
                <span className="quota-details-pace-label">{t('quota.weeklyPace')}</span>
                <span className="quota-details-chip" data-tone={paceTone}>
                  {pace.suppressed
                    ? t('quota.paceChipSuppressed')
                    : pace.ahead
                      ? t('quota.paceChipAhead', {delta: Math.abs(pace.deltaUsedPct)})
                      : t('quota.paceChipBalanced')}
                </span>
                {!pace.suppressed && (
                  <small>{t('quota.paceBaseline', {expected: quotaDisplay === 'used' ? pace.expectedUsedPct : pace.expectedRemPct})}</small>
                )}
              </div>
            )}
            {showRiskHint && <p className="quota-details-callout" data-quota-pace-hint>{t('quota.paceHintShort')}</p>}
            {(detailsQuota?.inferred5h || detailsQuota?.inferred7d) && <p className="quota-details-callout" data-tone="info">{t('quota.resetInferredHint')}</p>}

            <dl className="quota-details-facts">
              <div>
                <dt>{t('identityCard.planCalibrationTitle')}</dt>
                <dd>
                  <span>
                    {detailsSummary?.manual_plan
                      ? t('identityCard.planManualActive', {plan: detailsSummary.manual_plan})
                      : plan || t('identityCard.planAutoDetect')}
                  </span>
                  {quotaDetails && (
                    <button
                      type="button"
                      className="identity-expiry-inline-edit"
                      data-open-plan-calibration
                      disabled={busy || loading || !!state?.recovery}
                      onClick={() => onOpenExpiryEditor(detailsAreCurrent ? 'current' : quotaDetails.id, quotaDetails.name, detailsSummary)}
                    >
                      {t('identityCard.editExpiryShort')}
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt>{subDisplay.billing?.label || t('identityCard.nextRenewal')}</dt>
                <dd>
                  <span>{billingKnown
                    ? new Date(detailsSummary!.billing_date! * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {year: 'numeric', month: 'short', day: 'numeric'})
                    : t('identityCard.notProvided')}</span>
                  {billingKnown && detailsSummary?.subscription_recharge_ymd && (
                    <small>{t('identityCard.rechargedNote', {date: formatYmdAsShortMd(detailsSummary.subscription_recharge_ymd) || detailsSummary.subscription_recharge_ymd})}</small>
                  )}
                  {quotaDetails && (
                    <button
                      type="button"
                      className="identity-expiry-inline-edit"
                      disabled={busy || loading || !!state?.recovery}
                      onClick={() => onOpenExpiryEditor(detailsAreCurrent ? 'current' : quotaDetails.id, quotaDetails.name, detailsSummary)}
                    >
                      {t('identityCard.editExpiryShort')}
                    </button>
                  )}
                </dd>
              </div>
              <div data-reset-urgency={resetUrgency}>
                <dt>{t('quota.resetCount')}</dt>
                <dd>
                  <span className="quota-details-strong">{resets && !resets.ended
                    ? t('identityCard.manualResetsCount', {count: resets.remaining, v0: resets.remaining})
                    : resets?.ended ? t('identityCard.manualResetsEnded') : t('identityCard.notProvided')}</span>
                  {resetUrgency && resetExpiresAt ? (
                    <small className="identity-reset-urgency-badge" data-urgency={resetUrgency}>
                      {t('quota.manualResetsExpiringSoon', {countdown: formatCompactEta(resetExpiresAt, nowSec)})}
                      {resetExpiryClock ? ` · ${resetExpiryClock}` : ''}
                    </small>
                  ) : resetExpiresAt && resetExpiryClock ? (
                    <small>{t('quota.manualResetsValidUntil')} {resetExpiryClock}</small>
                  ) : null}
                  {(resets?.remaining ?? 0) > 0 && (detailsQuota?.used7d ?? 0) >= 90 && quotaDetails?.expectedIdentity && (
                    <>
                      <button
                        type="button"
                        className="identity-relay-quick-reset-btn"
                        disabled={busy || loading || !state?.browser.enabled || !!state?.recovery}
                        onClick={() => {
                          if (detailsAreCurrent && quotaDetails.expectedIdentity) {
                            setShowCleanroomBar(false);
                            void invoke('browser_open_usage', {
                              expectedIdentity: quotaDetails.expectedIdentity,
                              onProgress: activity.start('browser'),
                            }).then(
                              () => {
                                activity.finish(true, 'quota.opened');
                                onQuotaFeedback('quota.opened');
                              },
                              err => {
                                const message = String(err);
                                activity.finish(false, message);
                                onQuotaFeedback(message);
                              },
                            );
                          } else if (quotaDetails.expectedIdentity) {
                            onOpenAccountBrowser(
                              {account_id: quotaDetails.id, expected_identity: quotaDetails.expectedIdentity},
                              'usage',
                            );
                          }
                        }}
                      >
                        {t('relay.goResetBtn')}
                      </button>
                      <button
                        type="button"
                        className="identity-relay-verify-reset-btn"
                        data-details-verify-reset
                        disabled={
                          busy ||
                          loading ||
                          !state?.browser.enabled ||
                          !!state?.recovery ||
                          Boolean(syncingAccountIds[detailsAreCurrent ? 'current' : quotaDetails.id])
                        }
                        onClick={() =>
                          onSyncSubscription(
                            detailsAreCurrent ? undefined : quotaDetails.id,
                            quotaDetails.expectedIdentity || undefined,
                            true,
                          )
                        }
                      >
                        {t('relay.verifyResetBtn')}
                      </button>
                    </>
                  )}
                </dd>
              </div>
              {kycInfo && (
                <div data-kyc-status={kycInfo.status}>
                  <dt>{t('quota.kycStatusLabel')}</dt>
                  <dd>
                    {kycInfo.tone === 'neutral' ? (
                      <span className="quota-details-kyc-note">{t(kycInfo.labelKey)}</span>
                    ) : (
                      <span className="quota-details-chip" data-tone={kycInfo.tone}>{t(kycInfo.labelKey)}</span>
                    )}
                    {(kycInfo.checkKind || kycInfo.observedAge) && (
                      <small className="quota-details-kyc-kind">
                        {[kycInfo.checkKind, kycInfo.observedAge].filter(Boolean).join(' · ')}
                      </small>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>{t('quota.isolationStatus')}</dt>
                <dd>
                  <span className="quota-details-status" data-state={isolated}>
                    {t(isolated === 'active' ? 'quota.isolatedBrowserActive' : isolated === 'pending' ? 'quota.isolatedBrowserPending' : 'quota.isolatedBrowserOff')}
                  </span>
                  {detailsSummary?.proxy && <small>{t('quota.dedicatedProxy')}</small>}
                </dd>
              </div>
              {tokenExpiry !== null && (
                <div className="identity-refresh-token-warn" data-refresh-token-warn={tokenExpiry <= nowSec ? 'expired' : 'soon'}>
                  <dt>{t('quota.refreshTokenWarnTitle')}</dt>
                  <dd><strong>{tokenExpiry <= nowSec
                    ? t('quota.refreshTokenExpired')
                    : t('quota.refreshTokenExpiringSoon', {days: Math.max(1, Math.ceil((tokenExpiry - nowSec) / 86400))})}</strong></dd>
                </div>
              )}
            </dl>

            <Disclosure summary={t('quotaSetup.guideTitle')} className="quota-details-disclosure" triggerClassName="quota-details-disclosure-trigger">
              <div className="identity-confirm quota-details-guide">
                {detailsSavedRecord && (
                  <>
                    <div className="identity-confirm-target">
                      <span>{t('quota.backupArchive')}</span>
                      <strong>{formatBytes(detailsSavedRecord.bytes)}</strong>
                    </div>
                    <div className="identity-confirm-target">
                      <span>{t('quota.savedAt')}</span>
                      <strong>{new Date(detailsSavedRecord.saved_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</strong>
                    </div>
                  </>
                )}
                <div className="identity-confirm-target">
                  <span>{t('quotaSetup.status')}</span>
                  <strong>{t(quotaSetupError ? 'quotaSetup.unavailable' : !quotaSetup ? 'quotaSetup.checking' : 'quotaSetup.' + quotaSetup.state)}</strong>
                </div>
                <p className="identity-quota-note">{t('quotaSetup.guide')}</p>
                <Button variant="secondary" size="small" onClick={() => void copyQuotaDiagnostic()}>{t('identityDiagnostic.copy')}</Button>
                {copyDiagnosticStatus && <p role={copyDiagnosticStatus === 'failed' ? 'alert' : 'status'}>{t(copyDiagnosticStatus === 'copied' ? 'identityDiagnostic.copied' : 'identityDiagnostic.failed')}</p>}
              </div>
            </Disclosure>
            {quotaFeedbackText && <p className="quota-details-feedback" role="status">{quotaFeedbackText}</p>}
            <p className="quota-details-footnote">{t('quota.localOnly')}</p>
          </div>
        );
      })()}
    </AppDialog>
  );
}
