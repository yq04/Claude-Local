/**
 * [INPUT]: Native wakeup snapshot/config, online batch quota targets/progress, connection queue items, and parent action callbacks.
 * [OUTPUT]: Controlled `WakeupModal` dialog (`identity-online-query-dialog`, width 680) wrapping batch quota actions, 5h auto-wakeup settings/per-account controls, and `<IdentityConnections>`.
 * [POS]: Submodule of `src/identities.tsx`; mounts list rows lazily only when `open` is true and preserves `fallbackFocusRef={quotaOpenerRef}`.
 * [PROTOCOL]: Update this header and `src/CLAUDE.md` when changing wakeup modal props or layout.
 */
import {useMemo, type RefObject} from 'react';
import {Button, Checkbox, Switch} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {AppDialog} from '../dialog';
import {IdentityConnections, type IdentityConnectionItem} from '../identity-connections';
import type {IdentityState} from '../identity-model';
import {
  formatBatchProgress,
  formatMinuteOfDay,
  parseMinuteOfDay,
  type AutoWakeupConfig,
  type BatchProgressSummary,
  type NativeWakeupSnapshot,
  type QuotaBatchTarget,
} from '../identity-online-quota';
import {evaluateQuota, formatResetClock} from '../identity-quota';
import {maskDisplayName} from '../settings-model';
import {formatWakeupWait, presentWakeupAccount, type WakeupAnchorVerificationResult} from '../wakeup-presentation';
import type {TranslateFn} from './IdentityCardPrimitives';

export interface WakeupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: IdentityState | null;
  current: IdentityState['current'] | undefined;
  currentName: string;
  quotaTargets: QuotaBatchTarget[];
  staleQuotaTargets: QuotaBatchTarget[];
  batchBusy: boolean;
  batchSummary: BatchProgressSummary;
  actionLocked: boolean;
  busy: boolean;
  loading: boolean;
  unverifiedQuotaTargets: number;
  connectionQueueItems: IdentityConnectionItem[];
  suppressFeedback: boolean;
  quotaFeedbackText: string;
  foregroundAutoRefresh: boolean;
  onForegroundAutoRefreshChange: (checked: boolean) => void;
  autoWakeConfig: AutoWakeupConfig;
  autoWakeState: NativeWakeupSnapshot;
  autoWakeSaving: boolean;
  nativeWakeup: NativeWakeupSnapshot;
  wakeupAnchorMap: Record<string, WakeupAnchorVerificationResult>;
  wakingAccountId: string | null;
  syncingAccountIds: Record<string, boolean>;
  nowSec: number;
  privacyMask: boolean;
  quotaOpenerRef: RefObject<HTMLElement | null>;
  onRefreshAll: (allowBrowserFallback: boolean, requestedTargets?: QuotaBatchTarget[]) => Promise<void>;
  onUpdateAutoWakeConfig: (patch: Partial<AutoWakeupConfig>) => Promise<void>;
  onResumeWakeup: (identity: string) => Promise<void>;
  onWakeSingle: (accountId: string, expectedIdentity: string, isAuto?: boolean) => Promise<boolean>;
  onWakeAllIdle: () => Promise<void>;
  onSyncSubscription: (accountId?: string, expectedIdentity?: string) => Promise<void>;
  onOpenAccountBrowser: (target: QuotaBatchTarget) => Promise<void>;
  t: TranslateFn;
}

export function WakeupModal({
  open,
  onOpenChange,
  state,
  current,
  currentName,
  quotaTargets,
  staleQuotaTargets,
  batchBusy,
  batchSummary,
  actionLocked,
  busy,
  loading,
  unverifiedQuotaTargets,
  connectionQueueItems,
  suppressFeedback,
  quotaFeedbackText,
  foregroundAutoRefresh,
  onForegroundAutoRefreshChange,
  autoWakeConfig,
  autoWakeState,
  autoWakeSaving,
  nativeWakeup,
  wakeupAnchorMap,
  wakingAccountId,
  syncingAccountIds,
  nowSec,
  privacyMask,
  quotaOpenerRef,
  onRefreshAll,
  onUpdateAutoWakeConfig,
  onResumeWakeup,
  onWakeSingle,
  onWakeAllIdle,
  onSyncSubscription,
  onOpenAccountBrowser,
  t,
}: WakeupModalProps) {
  const nowMs = nowSec * 1000;
  const wakeupAccountRows = useMemo(() => {
    if (!open) return [];
    return quotaTargets.map(target => {
      const row = state?.records.find(record => record.id === target.account_id);
      const summary = target.account_id === 'current' ? current : state?.summaries?.[target.account_id];
      const label = target.account_id === 'current' ? currentName : row?.name ?? t('quotaOnline.unknownAccount');
      const q = evaluateQuota(summary, nowSec);
      const runtime = autoWakeState.accounts[target.expected_identity];
      const view = presentWakeupAccount({
        runtime,
        authStatus: summary?.auth_status,
        expired: Boolean(q?.inferred5h || q?.expired5h),
        activeWindow: Boolean(q?.r5 && q.r5 > nowSec),
        runningCli: target.account_id === 'current' && Boolean(state?.running),
        excluded: autoWakeConfig.excludedIdentities.includes(target.expected_identity),
        weeklyBlocked: Boolean(q?.known7d && q.rem7d <= 5),
        snapshotReady: nativeWakeup.migrated && nativeWakeup.status !== 'loading',
        storageError: nativeWakeup.status === 'storage_error',
        nextGlobalAtMs: nativeWakeup.nextGlobalAtMs,
        nowMs,
      });
      return {
        target,
        label: maskDisplayName(label, summary?.email, privacyMask),
        runtime,
        view,
        canWakeManual: Boolean(q?.inferred5h || q?.expired5h),
      };
    });
  }, [
    open,
    quotaTargets,
    state?.records,
    state?.summaries,
    state?.running,
    current,
    currentName,
    t,
    nowSec,
    nowMs,
    autoWakeState.accounts,
    autoWakeConfig.excludedIdentities,
    nativeWakeup.migrated,
    nativeWakeup.status,
    nativeWakeup.nextGlobalAtMs,
    privacyMask,
  ]);
  const wakeableCount = useMemo(() => wakeupAccountRows.filter(item => item.view.canWake).length, [wakeupAccountRows]);

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('identityCard.onlineQuery')}
      width={680}
      className="identity-online-query-dialog"
      fallbackFocusRef={quotaOpenerRef}
    >
      {open ? (
        <div className="identity-online-query-body">
          <div className="identity-online-query-controls">
            <Button
              variant="secondary"
              size="small"
              disabled={actionLocked || batchBusy || loading}
              loading={batchBusy}
              leftIcon={<Refresh aria-hidden size={16} className={batchBusy ? 'spin' : ''} />}
              title={t('quotaOnline.browserFallbackHint')}
              onClick={() => void onRefreshAll(true)}
            >
              {batchBusy && batchSummary.total > 0
                ? t('quotaOnline.queryingCount', {completed: batchSummary.completed, total: batchSummary.total})
                : t('identityCard.queryOnlineNow')}
            </Button>
            <Button
              variant="secondary"
              size="small"
              data-query-stale-unknown
              disabled={actionLocked || batchBusy || loading || staleQuotaTargets.length === 0}
              onClick={() => void onRefreshAll(true, staleQuotaTargets)}
            >
              {`${t('quotaOnline.queryStaleUnknown')} (${staleQuotaTargets.length})`}
            </Button>
            <label className="identity-auto-refresh-toggle" title={t('identityCard.foregroundAutoRefreshHint')}>
              <Switch
                checked={foregroundAutoRefresh}
                onCheckedChange={checked => onForegroundAutoRefreshChange(checked)}
                aria-label={t('identityCard.foregroundAutoRefresh')}
              />
              <span>{t('identityCard.foregroundAutoRefresh')}</span>
            </label>
          </div>

          <section className="identity-wakeup-panel" aria-labelledby="identity-wakeup-title">
            <div className="identity-wakeup-head">
              <div className="identity-wakeup-title-block">
                <h3 id="identity-wakeup-title">{t('wakeup.panelTitle')}</h3>
                <p>{t('wakeup.panelDesc')}</p>
                <p>{t('wakeup.applicationOnly')}</p>
                {nativeWakeup.status === 'scope_changed' && <p role="status">{t('wakeup.scopeChanged')}</p>}
                {nativeWakeup.status === 'storage_error' && <p role="status">{t('wakeup.stateSaveFailed')}</p>}
                {nativeWakeup.status === 'runtime_unavailable' && <p role="status">{t('wakeup.runtimeUnavailable')}</p>}
              </div>
              <div className="identity-wakeup-head-actions">
                {wakeableCount > 0 && (
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={actionLocked || batchBusy || loading || wakingAccountId !== null || autoWakeSaving}
                    loading={wakingAccountId !== null}
                    onClick={() => void onWakeAllIdle()}
                  >
                    {t('wakeup.wakeAllIdle', {count: wakeableCount})}
                  </Button>
                )}
                <label className="identity-auto-refresh-toggle wakeup-master-switch">
                  <Switch
                    checked={autoWakeConfig.enabled}
                    disabled={autoWakeSaving || nativeWakeup.status === 'loading' || nativeWakeup.status === 'storage_error'}
                    onCheckedChange={checked => onUpdateAutoWakeConfig({enabled: checked})}
                    aria-label={t('wakeup.enableSwitch')}
                  />
                  <span>{t('wakeup.enableSwitch')}</span>
                </label>
              </div>
            </div>

            <div className="identity-wakeup-config-grid">
              <div className="identity-wakeup-time-row">
                <Checkbox
                  label={t('wakeup.timeWindowSwitch')}
                  checked={autoWakeConfig.useTimeWindow}
                  onCheckedChange={checked => onUpdateAutoWakeConfig({useTimeWindow: checked === true})}
                />
                <div className="identity-wakeup-time-inputs">
                  <input
                    type="time"
                    className="wakeup-time-input"
                    disabled={!autoWakeConfig.useTimeWindow}
                    value={formatMinuteOfDay(autoWakeConfig.startMinute)}
                    onChange={e => onUpdateAutoWakeConfig({startMinute: parseMinuteOfDay(e.target.value, autoWakeConfig.startMinute)})}
                    aria-label="wakeup-start-time"
                  />
                  <span className="wakeup-time-sep">{t('wakeup.timeTo')}</span>
                  <input
                    type="time"
                    className="wakeup-time-input"
                    disabled={!autoWakeConfig.useTimeWindow}
                    value={formatMinuteOfDay(autoWakeConfig.endMinute)}
                    onChange={e => onUpdateAutoWakeConfig({endMinute: parseMinuteOfDay(e.target.value, autoWakeConfig.endMinute)})}
                    aria-label="wakeup-end-time"
                  />
                </div>
                <div className="identity-wakeup-presets">
                  <button
                    type="button"
                    className={`wakeup-preset-chip${autoWakeConfig.useTimeWindow && autoWakeConfig.startMinute === 480 && autoWakeConfig.endMinute === 1380 ? ' active' : ''}`}
                    onClick={() => onUpdateAutoWakeConfig({useTimeWindow: true, startMinute: 480, endMinute: 1380})}
                  >
                    {t('wakeup.presetDay')}
                  </button>
                  <button
                    type="button"
                    className={`wakeup-preset-chip${autoWakeConfig.useTimeWindow && autoWakeConfig.startMinute === 540 && autoWakeConfig.endMinute === 1140 ? ' active' : ''}`}
                    onClick={() => onUpdateAutoWakeConfig({useTimeWindow: true, startMinute: 540, endMinute: 1140})}
                  >
                    {t('wakeup.presetWork')}
                  </button>
                  <button
                    type="button"
                    className={`wakeup-preset-chip${!autoWakeConfig.useTimeWindow ? ' active' : ''}`}
                    onClick={() => onUpdateAutoWakeConfig({useTimeWindow: false})}
                  >
                    {t('wakeup.presetAllDay')}
                  </button>
                </div>
              </div>

              <div className="identity-wakeup-prewarm-row">
                <span>{t('wakeup.prewarmLabel')}</span>
                <div className="identity-wakeup-presets">
                  {[30, 40, 50].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      className={`wakeup-preset-chip${autoWakeConfig.prewarmThresholdPct === pct ? ' active' : ''}`}
                      onClick={() => onUpdateAutoWakeConfig({prewarmThresholdPct: pct})}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="identity-wakeup-antiban">{t('wakeup.antiBanNote')}</p>

            {wakeupAccountRows.length > 0 && (
              <div className="identity-wakeup-account-list">
                {wakeupAccountRows.map(({target, label, canWakeManual, runtime, view}) => {
                  const anchorInfo = wakeupAnchorMap[target.expected_identity.toLowerCase()];
                  return (
                    <div className="identity-wakeup-account-row" key={target.account_id} data-wakeup-state={view.stateKey}>
                      <div className="identity-wakeup-account-head">
                        <span className="identity-wakeup-account-name">{label}</span>
                        <span className={`identity-wakeup-status-pill tone-${view.tone}`}>{t(view.stateKey)}</span>
                        {anchorInfo && (
                          <span
                            className={`identity-wakeup-status-pill tone-${anchorInfo.status === 'advanced_new_cycle' ? 'ok' : 'warn'}`}
                            data-wakeup-anchor={anchorInfo.status}
                          >
                            {t(anchorInfo.labelKey)}
                          </span>
                        )}
                        <span className="identity-wakeup-local-auth">{t(view.localAuthKey)}</span>
                      </div>
                      <div className="identity-wakeup-account-actions">
                        <Button variant="secondary" size="small" disabled={autoWakeSaving || actionLocked || batchBusy}
                          onClick={() => void onUpdateAutoWakeConfig({excludedIdentities: autoWakeConfig.excludedIdentities.includes(target.expected_identity) ? autoWakeConfig.excludedIdentities.filter(id => id !== target.expected_identity) : [...autoWakeConfig.excludedIdentities, target.expected_identity]})}>
                          {t(autoWakeConfig.excludedIdentities.includes(target.expected_identity) ? 'wakeup.resume' : 'wakeup.pause')}
                        </Button>
                        {view.showRecovery && <Button variant="secondary" size="small" disabled={actionLocked || batchBusy || !view.canRecover}
                          onClick={() => void onResumeWakeup(target.expected_identity)}>{t(view.recoveryGranted ? 'wakeup.recoveryReadyLabel' : 'wakeup.recoverOnce')}</Button>}
                        {canWakeManual && <Button variant="secondary" size="small"
                          disabled={actionLocked || batchBusy || loading || wakingAccountId !== null || autoWakeSaving || !view.canWake}
                          loading={wakingAccountId === target.account_id}
                          onClick={() => void onWakeSingle(target.account_id, target.expected_identity, false)}>{t('wakeup.wakeNow')}</Button>}
                        <Button
                          variant="secondary"
                          size="small"
                          loading={Boolean(syncingAccountIds[target.account_id])}
                          disabled={actionLocked || batchBusy || busy || Boolean(syncingAccountIds[target.account_id]) || loading || !state?.browser.enabled}
                          onClick={() => void onSyncSubscription(target.account_id, target.expected_identity)}
                        >
                          {t('quota.syncSubscription')}
                        </Button>
                      </div>
                      <div className="identity-wakeup-account-details" data-wakeup-gate={view.block ?? undefined}>
                        <p>{t(view.detailKey)}{view.waitUntilMs && <> {formatWakeupWait((view.waitUntilMs - nowMs) / 1000, t)}</>}
                          {view.scheduledAtMs && !view.waitUntilMs && <> {t('wakeup.nextPlanAt', {time: formatResetClock(Math.floor(view.scheduledAtMs / 1000), false)})}</>}
                        </p>
                        <div className="identity-wakeup-account-meta">
                          <span>{t(`wakeup.capability.${runtime?.capability || 'unknown'}`)}</span>
                          {runtime?.lastAttemptAtMs && <span>{t('wakeup.lastAttemptAt', {time: formatResetClock(Math.floor(runtime.lastAttemptAtMs / 1000), false)})}</span>}
                          {(runtime?.unusedStreak ?? 0) > 0 && <span>{t('wakeup.streakBadge', {count: runtime!.unusedStreak})}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <IdentityConnections
            items={connectionQueueItems}
            busy={batchBusy || busy || loading || !!state?.recovery}
            t={t}
            onOpen={target => void onOpenAccountBrowser(target)}
            onRetry={targets => void onRefreshAll(true, targets)}
          />
          {!suppressFeedback && (quotaFeedbackText || batchSummary.completed > 0) && (
            <p className="identity-online-feedback" role="status">
              {quotaFeedbackText ? quotaFeedbackText : formatBatchProgress(batchSummary, t)}
              {unverifiedQuotaTargets > 0 && <> · {t('quotaOnline.unverifiedTargets', {count: unverifiedQuotaTargets})}</>}
            </p>
          )}
        </div>
      ) : null}
    </AppDialog>
  );
}
