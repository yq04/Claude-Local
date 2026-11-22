/**
 * [INPUT]: Smart Relay pool evaluation, slot/browser proxy alignment, CLI launcher/wrapper controls, and parent relay/browser/verification callbacks.
 * [OUTPUT]: Controlled `SmartRelayModal` dialog (`identity-relay-dialog`, width 720) with pool summary, account rows, per-slot proxy editors, routing strategy controls, and CLI handoff/toolchain controls.
 * [POS]: Submodule of `src/identities.tsx`; preserves single-axis layout, `.identity-relay-banner-actions`, `.identity-relay-awaiting-pill`, and `{open ? (...) : null}` lazy mount.
 * [PROTOCOL]: Update this header and `src/CLAUDE.md` when changing Smart Relay modal props or DOM structure.
 */
import {useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Button, Checkbox, Switch} from 'cromma-ui';
import {AppDialog} from '../dialog';
import {formatCompactEta} from '../identity-quota';
import type {Identity, IdentityState} from '../identity-model';
import type {QuotaBatchTarget} from '../identity-online-quota';
import {toCliHttpProxy} from '../risk-model';
import {maskDisplayName} from '../settings-model';
import {
  buildSubagentMarkdownTemplate,
  canSyncNativeSmartRelay,
  clearAccountCooldown,
  computeResetCardExpiryUrgency,
  findSameExitClusterWarning,
  flushNativeSmartRelaySync,
  formatLaunchDirChip,
  formatTruthfulPercent,
  isSlotBrowserProxyAligned,
  normalizePlanSlug,
  RELAY_AFFINITY_MODES,
  RELAY_CLI_EFFORTS,
  RELAY_CLI_MODELS,
  RELAY_HANDOFF_MODES,
  RELAY_RATE_LIMIT_MODES,
  RELAY_SPENT_THRESHOLDS,
  RELAY_STRATEGIES,
  relayCliModelDisplayLabel,
  removeRelayLaunchDir,
  resetSmartRelayConfig,
  syncNativeSmartRelayConfigIfLive,
  updateSmartRelayConfig,
  validateSlotHttpProxy,
  type HandoffSummary,
  type RelayCandidate,
  type RelayEvaluation,
  type RelayPoolSummary,
  type SmartRelayConfig,
} from '../smart-relay-model';
import {copyTextWithClipboardFallback, normalizeNativeErrorKey, type QuotaFeedbackEntry, type TranslateFn} from './IdentityCardPrimitives';

export interface SmartRelayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: IdentityState | null;
  current: IdentityState['current'] | undefined;
  active: Identity | undefined;
  smartRelay: SmartRelayConfig;
  cliDefaultProxy: string | null | undefined;
  relayEval: RelayEvaluation;
  relayPoolSummary: RelayPoolSummary;
  sameExitCluster: ReturnType<typeof findSameExitClusterWarning>;
  relayRecommendedSaved: {
    row: Identity;
    effectiveRem: number;
    inferred: boolean;
    isPreferred: boolean;
  } | null;
  recentLaunchDirs: string[];
  launchRelayBusy: boolean;
  launchCwdDraft: string;
  onLaunchCwdDraftChange: (value: string) => void;
  onLaunchRelayTerminal: (
    explicitCwd?: string,
    onRelayFeedback?: (fb: {text: string; isError?: boolean} | null) => void,
  ) => Promise<void>;
  blocked: boolean;
  busy: boolean;
  batchBusy: boolean;
  loading: boolean;
  syncingAccountIds: Record<string, boolean>;
  nowSec: number;
  privacyMask: boolean;
  quotaDisplay: 'remaining' | 'used';
  onCommitRelayBrowserState: (nextState: IdentityState) => void;
  onQuotaFeedback: (entry: QuotaFeedbackEntry) => void;
  onOpenCurrentUsage: (expectedIdentity: string) => Promise<void>;
  onOpenAccountBrowser: (target: QuotaBatchTarget, openMode?: 'usage' | 'claude_ai') => Promise<void>;
  onVerifyReset: (
    accountId: string | undefined,
    expectedIdentity: string | undefined,
    onRelayFeedback: (fb: {text: string; isError?: boolean}) => void,
  ) => Promise<void>;
  onSwitchCandidate: (row: Identity) => void;
  onOpenSnapshot: () => void;
  t: TranslateFn;
}

export function SmartRelayModal({
  open,
  onOpenChange,
  state,
  current,
  active,
  smartRelay,
  cliDefaultProxy,
  relayEval,
  relayPoolSummary,
  sameExitCluster,
  relayRecommendedSaved,
  recentLaunchDirs,
  launchRelayBusy,
  launchCwdDraft,
  onLaunchCwdDraftChange,
  onLaunchRelayTerminal,
  blocked,
  busy,
  batchBusy,
  loading,
  syncingAccountIds,
  nowSec,
  privacyMask,
  quotaDisplay,
  onCommitRelayBrowserState,
  onQuotaFeedback,
  onOpenCurrentUsage,
  onOpenAccountBrowser,
  onVerifyReset,
  onSwitchCandidate,
  onOpenSnapshot,
  t,
}: SmartRelayModalProps) {
  const [cliWrappersBusy, setCliWrappersBusy] = useState(false);
  const [cliWrappersFeedback, setCliWrappersFeedback] = useState<{text: string; isError?: boolean} | null>(null);
  const [slotProxyDrafts, setSlotProxyDrafts] = useState<Record<string, string>>({});
  const [slotProxyErrors, setSlotProxyErrors] = useState<Record<string, string>>({});
  const [expandedProxyIds, setExpandedProxyIds] = useState<Record<string, boolean>>({});
  const [syncingBrowserProxyIds, setSyncingBrowserProxyIds] = useState<Record<string, boolean>>({});
  const [browserProxySyncFeedback, setBrowserProxySyncFeedback] = useState<Record<string, {text: string; isError?: boolean}>>({});
  const [latestHandoff, setLatestHandoff] = useState<HandoffSummary | null>(null);
  const focusedSlotProxyIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      focusedSlotProxyIdRef.current = null;
      return;
    }
    focusedSlotProxyIdRef.current = null;
    setCliWrappersFeedback(null);
    setBrowserProxySyncFeedback({});
    setLatestHandoff(null);
    setSlotProxyErrors({});
    setSlotProxyDrafts({...smartRelay.slotProxies});
    setExpandedProxyIds({});
    void syncNativeSmartRelayConfigIfLive();
    if (canSyncNativeSmartRelay()) {
      void invoke<HandoffSummary | null>('identities_latest_handoff')
        .then(res => {
          if (mountedRef.current && res && typeof res === 'object') {
            setLatestHandoff(res);
          }
        })
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSlotProxyDrafts(prev => {
      const focusedId = focusedSlotProxyIdRef.current;
      const next: Record<string, string> = {...smartRelay.slotProxies};
      if (focusedId && Object.prototype.hasOwnProperty.call(prev, focusedId)) {
        next[focusedId] = prev[focusedId];
      }
      return next;
    });
  }, [open, smartRelay.slotProxies]);

  async function openRelayAccountUsage(cand: RelayCandidate): Promise<void> {
    const summary = cand.isCurrent ? current : state?.summaries?.[cand.id];
    const expectedIdentity = summary?.quota_identity;
    if (!expectedIdentity) {
      onQuotaFeedback('browser.cliIdentityUnavailable');
      return;
    }
    if (cand.isCurrent) {
      await onOpenCurrentUsage(expectedIdentity);
      return;
    }
    await onOpenAccountBrowser({account_id: cand.id, expected_identity: expectedIdentity}, 'usage');
  }

  function commitSlotProxy(accountId: string, rawValue: string): void {
    const res = validateSlotHttpProxy(rawValue);
    if (!res.ok) {
      setSlotProxyErrors(prev => ({...prev, [accountId]: res.errorKey || 'relay.proxy.invalidHttp'}));
      return;
    }
    setSlotProxyErrors(prev => {
      if (!(accountId in prev)) return prev;
      const next = {...prev};
      delete next[accountId];
      return next;
    });
    setSlotProxyDrafts(prev => ({...prev, [accountId]: res.normalized}));
    const existing = smartRelay.slotProxies[accountId] ?? '';
    if (existing === res.normalized) return;
    const nextSlotProxies = {...smartRelay.slotProxies};
    if (res.normalized) {
      nextSlotProxies[accountId] = res.normalized;
    } else {
      delete nextSlotProxies[accountId];
    }
    updateSmartRelayConfig({slotProxies: nextSlotProxies});
  }

  function flushPendingSlotProxies(): void {
    let changed = false;
    const nextSlotProxies = {...smartRelay.slotProxies};
    for (const [accountId, draft] of Object.entries(slotProxyDrafts)) {
      const res = validateSlotHttpProxy(draft);
      if (!res.ok) continue;
      const existing = nextSlotProxies[accountId] ?? '';
      if (existing === res.normalized) continue;
      changed = true;
      if (res.normalized) {
        nextSlotProxies[accountId] = res.normalized;
      } else {
        delete nextSlotProxies[accountId];
      }
    }
    if (changed) {
      updateSmartRelayConfig({slotProxies: nextSlotProxies});
    }
  }

  async function syncSlotBrowserProxy(accountId: string): Promise<void> {
    if (!accountId || accountId === 'current' || syncingBrowserProxyIds[accountId]) return;
    setSyncingBrowserProxyIds(prev => ({...prev, [accountId]: true}));
    setBrowserProxySyncFeedback(prev => {
      if (!(accountId in prev)) return prev;
      const next = {...prev};
      delete next[accountId];
      return next;
    });
    try {
      await flushNativeSmartRelaySync();
      const nextState = await invoke<IdentityState>('identities_sync_browser_proxy', {id: accountId});
      if (mountedRef.current && nextState && typeof nextState === 'object') {
        onCommitRelayBrowserState(nextState);
        setBrowserProxySyncFeedback(prev => ({
          ...prev,
          [accountId]: {text: tRef.current('relay.browserSlotSynced')},
        }));
      }
    } catch (err) {
      if (mountedRef.current) {
        const msgKey = normalizeNativeErrorKey(err);
        setBrowserProxySyncFeedback(prev => ({
          ...prev,
          [accountId]: {text: tRef.current(msgKey), isError: true},
        }));
      }
    } finally {
      if (mountedRef.current) {
        setSyncingBrowserProxyIds(prev => {
          const next = {...prev};
          delete next[accountId];
          return next;
        });
      }
    }
  }

  async function installCliWrappers(): Promise<void> {
    if (cliWrappersBusy) return;
    setCliWrappersBusy(true);
    setCliWrappersFeedback(null);
    try {
      const res = await invoke<{agent_path?: string | null} | null>('identities_install_cli_wrappers');
      if (mountedRef.current) {
        const msgKey = res && typeof res === 'object' && res.agent_path ? 'relay.deployCliAndAgentOk' : 'relay.deployCliAndAgentOk';
        setCliWrappersFeedback({text: tRef.current(msgKey)});
      }
    } catch (err) {
      if (mountedRef.current) {
        setCliWrappersFeedback({text: tRef.current(normalizeNativeErrorKey(err)), isError: true});
      }
    } finally {
      if (mountedRef.current) setCliWrappersBusy(false);
    }
  }

  async function copyRelayCommand(): Promise<void> {
    const cmd = smartRelay.autoContinueOnRelay ? 'claude-relay -AutoContinue' : 'claude-relay';
    const ok = await copyTextWithClipboardFallback(cmd);
    if (mountedRef.current) {
      setCliWrappersFeedback(
        ok
          ? {text: tRef.current('relay.copiedRelayCmd', {cmd})}
          : {text: tRef.current('relay.copyFailed'), isError: true},
      );
    }
  }

  async function copySubagentTemplate(): Promise<void> {
    const ok = await copyTextWithClipboardFallback(buildSubagentMarkdownTemplate());
    if (mountedRef.current) {
      setCliWrappersFeedback(
        ok
          ? {text: tRef.current('relay.copiedSubagentTpl')}
          : {text: tRef.current('relay.copyFailed'), isError: true},
      );
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) flushPendingSlotProxies();
        onOpenChange(nextOpen);
      }}
      title={t('relay.dialogTitle')}
      description={t('relay.dialogDesc')}
      width={720}
      className="identity-relay-dialog"
      footer={
        <div className="identity-dialog-footer-spread">
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              resetSmartRelayConfig();
              setSlotProxyDrafts({});
              setSlotProxyErrors({});
            }}
          >
            {t('settings.relayResetBtn')}
          </Button>
          <div className="identity-relay-banner-actions">
            {relayRecommendedSaved && (
              <Button
                variant="secondary"
                size="small"
                disabled={blocked}
                onClick={() => {
                  flushPendingSlotProxies();
                  onOpenChange(false);
                  onSwitchCandidate(relayRecommendedSaved.row);
                }}
              >
                {t('relay.relaySwitchNow', {
                  target: maskDisplayName(
                    relayRecommendedSaved.row.name,
                    state?.summaries?.[relayRecommendedSaved.row.id]?.email,
                    privacyMask,
                  ),
                })}
              </Button>
            )}
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                flushPendingSlotProxies();
                onOpenChange(false);
              }}
            >
              {t('关闭')}
            </Button>
          </div>
        </div>
      }
    >
      {open ? (
        <div className="identity-relay-panel">
          <div className="identity-relay-master-row">
            <div>
              <strong>{t('settings.relayEnableLabel')}</strong>
              <p>{t('settings.relayEnableHint')}</p>
            </div>
            <label className="identity-auto-refresh-toggle">
              <Switch
                checked={smartRelay.enabled}
                onCheckedChange={checked => updateSmartRelayConfig({enabled: checked})}
                aria-label={t('settings.relayEnableLabel')}
              />
            </label>
          </div>

          <div className="identity-relay-pool-summary" data-relay-pool-summary>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.ready')}:</span>
              <strong>{relayPoolSummary.readyCount}/{relayPoolSummary.includedCount}</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.avg5hRem')}:</span>
              <strong>{relayPoolSummary.avg5hRemainingPct}%</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.avg7dRem')}:</span>
              <strong>{relayPoolSummary.avgRem7dPct}%</strong>
            </span>
            <span className="identity-relay-pool-stat">
              <span>{t('relay.pool.manualResets')}:</span>
              <strong>{relayPoolSummary.totalManualResetsRemaining}</strong>
            </span>
            {relayPoolSummary.soonestResetSec && (
              <span className="identity-relay-pool-stat">
                <span>{t('relay.pool.nextReset')}:</span>
                <strong>{formatCompactEta(relayPoolSummary.soonestResetSec, nowSec)}</strong>
              </span>
            )}
            {relayPoolSummary.totalManualResetsRemaining > 0 && smartRelay.strategy !== 'reset_harvest' && (
              <button
                type="button"
                className="identity-relay-harvest-recommend-btn"
                data-relay-recommend-harvest
                onClick={() => updateSmartRelayConfig({enabled: true, strategy: 'reset_harvest'})}
              >
                {t('relay.recommendHarvestChip', {count: relayPoolSummary.totalManualResetsRemaining})}
              </button>
            )}
          </div>

          {current?.present && !active && (
            <div className="identity-unsaved-pool-hint" role="note" data-relay-unsaved-hint>
              <span>{t('identities.unsavedPoolHint')}</span>
              <Button
                variant="secondary"
                size="small"
                disabled={blocked}
                onClick={() => {
                  flushPendingSlotProxies();
                  onOpenChange(false);
                  onOpenSnapshot();
                }}
              >
                {t('identities.unsavedSaveNow')}
              </Button>
            </div>
          )}

          <section className="identity-relay-section" aria-label={t('relay.accountsLabel')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.accountsLabel')}</h3>
              <div className="identity-relay-preferred-controls">
                <label className="identity-relay-return-preferred">
                  <Checkbox
                    label={t('settings.relayPreferredReturnLabel')}
                    checked={smartRelay.returnToPreferred}
                    onCheckedChange={v => updateSmartRelayConfig({returnToPreferred: v === true})}
                  />
                </label>
                {smartRelay.returnToPreferred && (
                  <div
                    className="identity-wakeup-presets identity-relay-return-thresh"
                    role="group"
                    aria-label={t('relay.preferredReturnThresholdLabel')}
                  >
                    {([80, 85, 90] as const).map(pct => (
                      <button
                        key={pct}
                        type="button"
                        data-relay-return-threshold={pct}
                        className={`wakeup-preset-chip${smartRelay.preferredReturnThresholdPct === pct ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({preferredReturnThresholdPct: pct})}
                      >
                        ≤{pct}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {sameExitCluster && (
              <div className="identity-unsaved-pool-hint identity-relay-cluster-hint" role="note" data-relay-exit-cluster-hint>
                <span>
                  {sameExitCluster.clusterCount && sameExitCluster.clusterCount > 1 && sameExitCluster.clusters
                    ? t('relay.sameExitMultiClusterHint', {
                        clusterCount: sameExitCluster.clusterCount,
                        count: sameExitCluster.count,
                        endpoint: sameExitCluster.endpoint,
                        endpoints: sameExitCluster.clusters.map(c => `${c.endpoint} (${c.count})`).join(', '),
                      })
                    : t('relay.sameExitClusterHint', {count: sameExitCluster.count, endpoint: sameExitCluster.endpoint})}
                </span>
              </div>
            )}
            <div className="identity-relay-account-list">
              {[...relayEval.candidates]
                .sort((a, b) => a.listIndex - b.listIndex)
                .map(acc => {
                  const isExcluded = !acc.isIncluded;
                  const isPreferred = smartRelay.preferredAccountId === acc.id;
                  const isRecommendedNext = !acc.isCurrent && relayEval.recommended?.id === acc.id;
                  const used5h = acc.known5h && !acc.no5hLimit ? acc.used5h : 0;
                  const used7d = acc.known7d ? acc.used7d : 0;
                  const shown5hPct = quotaDisplay === 'used' ? acc.used5h : acc.rem5h;
                  const shown7dPct = quotaDisplay === 'used' ? acc.used7d : acc.rem7d;
                  const bar5hWidth = acc.no5hLimit ? 100 : acc.known5h ? Math.min(100, Math.max(4, shown5hPct)) : 0;
                  const bar7dWidth = acc.known7d ? Math.min(100, Math.max(4, shown7dPct)) : 0;
                  const fill5hClass = acc.no5hLimit
                    ? ' is-unlimited'
                    : used5h >= 95
                      ? ' is-empty'
                      : used5h >= 80
                        ? ' is-warn'
                        : '';
                  const fill7dClass = used7d >= 95 ? ' is-empty' : used7d >= 80 ? ' is-warn' : '';
                  const quotaPrefix = t(quotaDisplay === 'used' ? 'identityCard.used' : 'identityCard.remaining');
                  const syncKey = acc.isCurrent ? 'current' : acc.id;
                  const isSyncingAcc = Boolean(syncingAccountIds[syncKey]);
                  const displayLabel = maskDisplayName(acc.name, acc.email, privacyMask);
                  const accSlotSessions = state?.slot_sessions?.[acc.id] ?? [];
                  const accSummary = acc.isCurrent ? current : state?.summaries?.[acc.id];
                  const accIdentity = accSummary?.quota_identity;
                  const cliFallbackHttp = cliDefaultProxy ? toCliHttpProxy(cliDefaultProxy) : '';
                  const summaryHttpProxy = accSummary?.proxy ? toCliHttpProxy(accSummary.proxy) : '';
                  const inheritedCliHttp =
                    cliDefaultProxy !== undefined ? cliFallbackHttp : summaryHttpProxy;
                  const proxyPlaceholder = inheritedCliHttp || 'http://127.0.0.1:7899';
                  const savedSlotProxy = smartRelay.slotProxies[acc.id] ?? '';
                  const effectiveCliProxy = savedSlotProxy || inheritedCliHttp;
                  const slotBrowserProxy =
                    acc.id && acc.id !== 'current' ? state?.slot_browser_proxies?.[acc.id] : undefined;
                  const hasBrowserProxyMismatch = Boolean(
                    slotBrowserProxy && !isSlotBrowserProxyAligned(slotBrowserProxy.proxy, effectiveCliProxy),
                  );
                  const browserSyncFeedback = browserProxySyncFeedback[acc.id];
                  const slotProxyDraft = slotProxyDrafts[acc.id] ?? savedSlotProxy;
                  const slotProxyError = slotProxyErrors[acc.id];
                  const isProxyExpanded = Boolean(expandedProxyIds[acc.id] || slotProxyError);
                  const customEndpointShort = savedSlotProxy
                    ? savedSlotProxy.replace(/^http:\/\//i, '').replace(/^127\.0\.0\.1:/, ':').replace(/^localhost:/, ':')
                    : '';
                  const inheritedPort = inheritedCliHttp.match(/:(\d+)$/)?.[1] ?? '7899';
                  const proxyPillLabel = savedSlotProxy
                    ? t('relay.proxyCustomPill', {endpoint: customEndpointShort})
                    : inheritedCliHttp
                      ? t('relay.proxyInheritedPill', {port: inheritedPort})
                      : t('relay.proxyDefaultPill');
                  const resetTier = computeResetCardExpiryUrgency(
                    acc.earliestResetGrantEndsAt,
                    acc.manualResetsRemaining,
                    nowSec,
                  );
                  const resetGrantEta =
                    acc.earliestResetGrantEndsAt && acc.earliestResetGrantEndsAt > nowSec
                      ? formatCompactEta(acc.earliestResetGrantEndsAt, nowSec)
                      : '';
                  return (
                    <div
                      className={`identity-relay-account-row${isExcluded ? ' is-excluded' : ''}${acc.isCurrent ? ' is-current' : ''}`}
                      key={acc.id}
                    >
                      <div className="identity-relay-account-top">
                        <div className="identity-relay-account-left">
                          <Checkbox
                            label={displayLabel}
                            checked={!isExcluded}
                            onCheckedChange={checked => {
                              const nextExcluded = checked
                                ? smartRelay.excludedAccountIds.filter(id => id !== acc.id)
                                : [...smartRelay.excludedAccountIds, acc.id];
                              updateSmartRelayConfig({excludedAccountIds: nextExcluded});
                            }}
                          />
                          {acc.plan && (
                            <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(acc.plan)}>
                              {acc.plan}
                            </span>
                          )}
                          {acc.isCurrent && <span className="identity-relay-current-badge">{t('relay.currentBadge')}</span>}
                          {isRecommendedNext && (
                            <span className="identity-relay-recommended-pill">{t('relay.recommendedBadge')}</span>
                          )}
                          {accSlotSessions.length > 0 && (
                            <span
                              className="identity-relay-slot-pill"
                              title={accSlotSessions
                                .map(s => `${s.entrypoint}${s.workspace ? ` · ${s.workspace}` : ''} (PID ${s.pid})`)
                                .join('\n')}
                            >
                              <i className="slot-live-dot" aria-hidden="true" />
                              {accSlotSessions.length > 1
                                ? t('relay.slotLiveCount', {count: accSlotSessions.length})
                                : t('relay.slotLiveBadge')}
                            </span>
                          )}
                        </div>
                        <div className="identity-relay-account-right">
                          {acc.awaitingManualReset && (
                            <>
                              <button
                                type="button"
                                className="identity-relay-quick-reset-btn"
                                disabled={busy || batchBusy || loading || !!state?.recovery || !accIdentity}
                                onClick={() => void openRelayAccountUsage(acc)}
                              >
                                {t('relay.goResetBtn')}
                              </button>
                              <button
                                type="button"
                                className="identity-relay-verify-reset-btn"
                                data-relay-verify-reset={acc.id}
                                disabled={busy || batchBusy || loading || !!state?.recovery || !state?.browser.enabled || !accIdentity || isSyncingAcc}
                                onClick={() =>
                                  void onVerifyReset(
                                    acc.isCurrent ? undefined : acc.id,
                                    accIdentity || undefined,
                                    fb => {
                                      if (mountedRef.current) setCliWrappersFeedback(fb);
                                    },
                                  )
                                }
                              >
                                {t('relay.verifyResetBtn')}
                              </button>
                            </>
                          )}
                          {acc.inCooldown && (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              onClick={() => clearAccountCooldown(acc.id)}
                            >
                              {t('relay.clearCooldown')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`identity-relay-proxy-pill${savedSlotProxy ? ' is-custom' : ''}${slotProxyError ? ' is-invalid' : ''}${hasBrowserProxyMismatch ? ' is-mismatch' : ''}`}
                            data-relay-proxy-toggle={acc.id}
                            data-relay-proxy-mismatch={hasBrowserProxyMismatch ? 'true' : undefined}
                            title={
                              hasBrowserProxyMismatch && slotBrowserProxy
                                ? `${t('relay.slotProxyLabel')}: ${effectiveCliProxy || t('relay.browserSlotDirect')} · ${t('relay.browserSlotMismatchHint', {browserProxy: slotBrowserProxy.proxy || t('relay.browserSlotDirect')})}`
                                : `${t('relay.slotProxyLabel')}: ${savedSlotProxy || proxyPlaceholder}`
                            }
                            onClick={() =>
                              setExpandedProxyIds(prev => ({
                                ...prev,
                                [acc.id]: !isProxyExpanded,
                              }))
                            }
                          >
                            {proxyPillLabel}
                            {hasBrowserProxyMismatch && (
                              <span
                                className="identity-relay-proxy-warn-dot"
                                aria-label={t('relay.browserSlotMismatchBadge')}
                              >
                                !
                              </span>
                            )}
                          </button>
                          {isPreferred ? (
                            <button
                              type="button"
                              className="identity-relay-preferred-pill is-clickable"
                              title={t('relay.unsetPreferredTooltip')}
                              aria-label={t('relay.unsetPreferredTooltip')}
                              data-relay-unset-preferred={acc.id}
                              onClick={() => updateSmartRelayConfig({preferredAccountId: null})}
                            >
                              {t('relay.preferredBadge')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              data-relay-set-preferred={acc.id}
                              onClick={() => updateSmartRelayConfig({preferredAccountId: acc.id})}
                            >
                              {t('relay.setPreferred')}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="identity-relay-account-bars">
                        <div className="identity-relay-bars-tracks">
                          <div className="identity-relay-mini-quota">
                            <span>{t('relay.window5hShort')}</span>
                            <div className="identity-relay-mini-track">
                              <div
                                className={`identity-relay-mini-fill${fill5hClass}`}
                                style={{width: `${bar5hWidth}%`}}
                              />
                            </div>
                            <strong>
                              {acc.no5hLimit
                                ? t('identityCard.unlimited')
                                : acc.known5h
                                  ? `${quotaPrefix} ${formatTruthfulPercent(shown5hPct)}`
                                  : '—'}
                            </strong>
                          </div>
                          <div className="identity-relay-account-bars-sep" />
                          <div className="identity-relay-mini-quota">
                            <span>{t('relay.window7dShort')}</span>
                            <div className="identity-relay-mini-track">
                              <div
                                className={`identity-relay-mini-fill${fill7dClass}`}
                                style={{width: `${bar7dWidth}%`}}
                              />
                            </div>
                            <strong>
                              {acc.known7d ? `${quotaPrefix} ${formatTruthfulPercent(shown7dPct)}` : '—'}
                            </strong>
                          </div>
                        </div>
                        {(acc.manualResetsRemaining > 0 ||
                          acc.awaitingManualReset ||
                          acc.inCooldown ||
                          (acc.known5h && !acc.no5hLimit && Math.abs(acc.pace5hDeltaPct) >= 10)) && (
                          <div className="identity-relay-bars-badges">
                            {acc.manualResetsRemaining > 0 && (
                              <span
                                className={`identity-relay-reset-pill${resetTier && resetTier !== 'normal' ? ` tier-${resetTier}` : ''}`}
                                data-reset-tier={resetTier || undefined}
                                title={resetGrantEta ? t('relay.resetCardExpiringTitle', {eta: resetGrantEta}) : undefined}
                              >
                                {t('relay.resetCardBadge', {count: acc.manualResetsRemaining})}
                                {resetTier && resetTier !== 'normal' && resetGrantEta ? ` · ${resetGrantEta}` : ''}
                              </span>
                            )}
                            {acc.awaitingManualReset && (
                              <span className="identity-relay-awaiting-pill">{t('relay.awaitingResetBadge')}</span>
                            )}
                            {acc.inCooldown && (
                              <span className="identity-relay-cooling-pill">{t('relay.coolingBadge')}</span>
                            )}
                            {acc.known5h && !acc.no5hLimit && Math.abs(acc.pace5hDeltaPct) >= 10 && (
                              <span className={`identity-relay-pace-pill${acc.pace5hDeltaPct >= 10 ? ' is-ahead' : ' is-safe'}`}>
                                {t(acc.pace5hDeltaPct >= 10 ? 'relay.paceAheadBadge' : 'relay.paceSafeBadge', {
                                  delta: Math.abs(Math.round(acc.pace5hDeltaPct)),
                                })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {isProxyExpanded && (
                        <div className="identity-relay-account-proxy">
                          <label htmlFor={`relay-slot-proxy-${acc.id}`}>{t('relay.slotProxyLabel')}</label>
                          <input
                            id={`relay-slot-proxy-${acc.id}`}
                            type="text"
                            className={`identity-relay-proxy-input${slotProxyError ? ' is-invalid' : ''}`}
                            placeholder={proxyPlaceholder}
                            value={slotProxyDraft}
                            aria-invalid={slotProxyError ? true : undefined}
                            onChange={e => {
                              const val = e.target.value;
                              setSlotProxyDrafts(prev => ({...prev, [acc.id]: val}));
                              const res = validateSlotHttpProxy(val);
                              if (res.ok) {
                                setSlotProxyErrors(prev => {
                                  if (!(acc.id in prev)) return prev;
                                  const next = {...prev};
                                  delete next[acc.id];
                                  return next;
                                });
                                if (!res.normalized && smartRelay.slotProxies[acc.id]) {
                                  const nextSlotProxies = {...smartRelay.slotProxies};
                                  delete nextSlotProxies[acc.id];
                                  updateSmartRelayConfig({slotProxies: nextSlotProxies});
                                }
                              } else if (/^socks/i.test(val.trim()) || /[\u0000-\u001f\u007f]/.test(val)) {
                                setSlotProxyErrors(prev => ({
                                  ...prev,
                                  [acc.id]: res.errorKey || 'relay.proxy.invalidHttp',
                                }));
                              }
                            }}
                            onFocus={() => {
                              focusedSlotProxyIdRef.current = acc.id;
                            }}
                            onBlur={e => {
                              if (focusedSlotProxyIdRef.current === acc.id) {
                                focusedSlotProxyIdRef.current = null;
                              }
                              commitSlotProxy(acc.id, e.currentTarget.value);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitSlotProxy(acc.id, e.currentTarget.value);
                              }
                            }}
                          />
                          {!slotProxyError && (
                            <button
                              type="button"
                              className="identity-relay-set-preferred"
                              onClick={() => {
                                commitSlotProxy(acc.id, slotProxyDraft);
                                setExpandedProxyIds(prev => ({...prev, [acc.id]: false}));
                              }}
                            >
                              {t('relay.proxyHideBtn')}
                            </button>
                          )}
                          {slotProxyError && (
                            <span className="identity-relay-proxy-error" role="alert">
                              {t(slotProxyError)}
                            </span>
                          )}
                          {slotBrowserProxy && (
                            <div className="identity-relay-browser-slot-row" data-relay-browser-slot={acc.id}>
                              <span className="identity-relay-browser-slot-label">
                                {t('relay.browserSlotLabel', {
                                  proxy: slotBrowserProxy.proxy || t('relay.browserSlotDirect'),
                                })}
                              </span>
                              {hasBrowserProxyMismatch && (
                                <button
                                  type="button"
                                  className="identity-relay-set-preferred identity-relay-browser-sync-btn"
                                  data-relay-sync-browser-proxy={acc.id}
                                  disabled={slotBrowserProxy.running || Boolean(syncingBrowserProxyIds[acc.id])}
                                  title={slotBrowserProxy.running ? t('relay.browserSlotRunningHint') : undefined}
                                  onClick={() => void syncSlotBrowserProxy(acc.id)}
                                >
                                  {syncingBrowserProxyIds[acc.id]
                                    ? t('relay.browserSlotSyncingBtn')
                                    : t('relay.browserSlotSyncBtn')}
                                </button>
                              )}
                              {slotBrowserProxy.running && hasBrowserProxyMismatch && (
                                <span className="identity-relay-browser-running-hint">
                                  {t('relay.browserSlotRunningHint')}
                                </span>
                              )}
                              {browserSyncFeedback && (
                                <span
                                  className={
                                    browserSyncFeedback.isError
                                      ? 'identity-relay-proxy-error'
                                      : 'identity-relay-browser-synced-hint'
                                  }
                                  role={browserSyncFeedback.isError ? 'alert' : 'status'}
                                >
                                  {browserSyncFeedback.text}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="identity-relay-section" aria-label={t('relay.routingSectionTitle')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.routingSectionTitle')}</h3>
            </div>
            <div className="identity-relay-form-rows identity-relay-cli-rows">
              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.routeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_STRATEGIES.map(strategy => (
                      <button
                        key={strategy}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.strategy === strategy ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({strategy})}
                      >
                        {t(`relay.strategy.${strategy}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.strategyDesc.${smartRelay.strategy}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.rateLimitLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_RATE_LIMIT_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.rateLimitMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({rateLimitMode: mode})}
                      >
                        {t(`relay.rateLimit.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.rateLimitDesc.${smartRelay.rateLimitMode}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.affinityLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_AFFINITY_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.affinityMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({affinityMode: mode})}
                      >
                        {t(`relay.affinity.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t(`relay.affinityDesc.${smartRelay.affinityMode}`)}</p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.thresholdLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets identity-relay-threshold-chips">
                    {RELAY_SPENT_THRESHOLDS.map(pct => (
                      <button
                        key={pct}
                        type="button"
                        className={`wakeup-preset-chip${smartRelay.spentThresholdPct === pct ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({spentThresholdPct: pct})}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">{t('relay.thresholdDesc', {pct: smartRelay.spentThresholdPct})}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="identity-relay-section identity-relay-cli-section" aria-label={t('relay.cliSectionTitle')}>
            <div className="identity-relay-section-head">
              <h3>{t('relay.cliSectionTitle')}</h3>
              {latestHandoff?.handoffReason && (
                <span
                  className="identity-relay-handoff-reason-pill"
                  data-relay-handoff-reason={latestHandoff.handoffReason}
                  title={t('relay.handoffReasonTooltip')}
                >
                  {(() => {
                    const reason = latestHandoff.handoffReason;
                    const reasonKeyMap: Record<string, string> = {
                      threshold_reached: 'relay.handoffReason.threshold_reached',
                      rate_limited: 'relay.handoffReason.rate_limited',
                      preferred_recovered: 'relay.handoffReason.preferred_recovered',
                      awaiting_manual_reset: 'relay.handoffReason.awaiting_manual_reset',
                      external_worker_timeout: 'relay.handoffReason.external_worker_timeout',
                      forced_stop: 'relay.handoffReason.forced_stop',
                    };
                    return reasonKeyMap[reason] ? t(reasonKeyMap[reason]) : reason;
                  })()}
                </span>
              )}
            </div>
            <div className="identity-relay-form-rows identity-relay-cli-rows">
              <div className="identity-relay-form-row" data-relay-cli-model-row>
                <span className="identity-relay-form-label">{t('relay.cliModelLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_CLI_MODELS.map(model => (
                      <button
                        key={model || 'follow'}
                        type="button"
                        data-relay-cli-model={model || 'follow'}
                        title={model === 'opusplan' ? t('relay.cliModelOpusPlanDesc') : undefined}
                        className={`wakeup-preset-chip${smartRelay.defaultCliModel === model ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({defaultCliModel: model})}
                      >
                        {relayCliModelDisplayLabel(model, t('relay.cliFollowSettings'))}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.defaultCliModel === 'opusplan' ? 'relay.cliModelOpusPlanDesc' : 'relay.cliModelDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row" data-relay-cli-effort-row>
                <span className="identity-relay-form-label">{t('relay.cliEffortLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    {RELAY_CLI_EFFORTS.map(effort => (
                      <button
                        key={effort || 'follow'}
                        type="button"
                        data-relay-cli-effort={effort || 'follow'}
                        className={`wakeup-preset-chip${smartRelay.defaultCliEffort === effort ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({defaultCliEffort: effort})}
                      >
                        {effort || t('relay.cliFollowSettings')}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.defaultCliEffort === 'max' ? 'relay.cliEffortMaxDesc' : 'relay.cliEffortDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.continuationModeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets">
                    <button
                      type="button"
                      className={`wakeup-preset-chip${!smartRelay.autoContinueOnRelay ? ' active' : ''}`}
                      onClick={() => updateSmartRelayConfig({autoContinueOnRelay: false})}
                    >
                      {t('relay.autoContinueOff')}
                    </button>
                    <button
                      type="button"
                      className={`wakeup-preset-chip${smartRelay.autoContinueOnRelay ? ' active' : ''}`}
                      onClick={() => updateSmartRelayConfig({autoContinueOnRelay: true})}
                    >
                      {t('relay.autoContinueOn')}
                    </button>
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.autoContinueOnRelay ? 'relay.autoContinueOnDesc' : 'relay.autoContinueOffDesc')}
                  </p>
                </div>
              </div>

              <div className="identity-relay-form-row" data-relay-handoff-mode-row>
                <span className="identity-relay-form-label">{t('relay.handoffModeLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-wakeup-presets" role="group" aria-label={t('relay.handoffModeLabel')}>
                    {RELAY_HANDOFF_MODES.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        data-relay-handoff-mode={mode}
                        aria-pressed={smartRelay.relayHandoffMode === mode}
                        className={`wakeup-preset-chip${smartRelay.relayHandoffMode === mode ? ' active' : ''}`}
                        onClick={() => updateSmartRelayConfig({relayHandoffMode: mode})}
                      >
                        {t(mode === 'clean_handoff' ? 'relay.handoffModeClean' : 'relay.handoffModeFork')}
                      </button>
                    ))}
                  </div>
                  <p className="identity-relay-form-desc">
                    {t(smartRelay.relayHandoffMode === 'fork_resume' ? 'relay.handoffModeForkDesc' : 'relay.handoffModeCleanDesc')}
                  </p>
                  {smartRelay.relayHandoffMode === 'fork_resume' && (
                    <div className="identity-unsaved-pool-hint identity-relay-handoff-warn" role="alert" data-relay-handoff-warning>
                      <span>
                        <strong>{t('relay.handoffForkWarnTitle')}</strong>
                        <span>{t('relay.handoffForkWarnDesc')}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.launchTerminalLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-relay-launch-row">
                    <input
                      type="text"
                      className="identity-relay-cwd-input"
                      data-relay-launch-cwd
                      placeholder={t('relay.launchCwdPlaceholder')}
                      aria-label={t('relay.launchCwdPlaceholder')}
                      value={launchCwdDraft}
                      onChange={e => onLaunchCwdDraftChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void onLaunchRelayTerminal(undefined, fb => {
                            if (mountedRef.current) setCliWrappersFeedback(fb);
                          });
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="small"
                      data-launch-relay-cli
                      loading={launchRelayBusy}
                      disabled={launchRelayBusy}
                      onClick={() =>
                        void onLaunchRelayTerminal(undefined, fb => {
                          if (mountedRef.current) setCliWrappersFeedback(fb);
                        })
                      }
                    >
                      {t('relay.launchTerminalBtn')}
                    </Button>
                  </div>
                  {recentLaunchDirs.length > 0 && (
                    <div className="identity-relay-mru-row" data-relay-recent-dirs>
                      <span className="identity-relay-mru-label">{t('relay.launchRecentLabel')}</span>
                      {recentLaunchDirs.map(dir => {
                        const chip = formatLaunchDirChip(dir);
                        return (
                          <span className="identity-relay-mru-chip" key={dir}>
                            <button
                              type="button"
                              className="identity-relay-mru-open"
                              title={dir}
                              disabled={launchRelayBusy}
                              onClick={() => {
                                onLaunchCwdDraftChange(dir);
                                void onLaunchRelayTerminal(dir, fb => {
                                  if (mountedRef.current) setCliWrappersFeedback(fb);
                                });
                              }}
                            >
                              <strong>{chip.leaf}</strong>
                              {chip.parent && <small>{chip.parent}</small>}
                            </button>
                            <button
                              type="button"
                              className="identity-relay-mru-remove"
                              aria-label={t('relay.removeRecentDir')}
                              title={t('relay.removeRecentDir')}
                              onClick={() => removeRelayLaunchDir(dir)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="identity-relay-form-row">
                <span className="identity-relay-form-label">{t('relay.toolchainLabel')}</span>
                <div className="identity-relay-form-body">
                  <div className="identity-relay-cli-actions">
                    <Button
                      variant="secondary"
                      size="small"
                      loading={cliWrappersBusy}
                      disabled={cliWrappersBusy}
                      onClick={() => void installCliWrappers()}
                    >
                      {t('relay.deployCliAndAgentBtn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => void copyRelayCommand()}
                    >
                      {t('relay.copyRelayCmdBtn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => void copySubagentTemplate()}
                    >
                      {t('relay.copySubagentTplBtn')}
                    </Button>
                  </div>
                  {cliWrappersFeedback && (
                    <p
                      className={`identity-relay-cli-feedback${cliWrappersFeedback.isError ? ' is-error' : ''}`}
                      role={cliWrappersFeedback.isError ? 'alert' : 'status'}
                    >
                      {cliWrappersFeedback.text}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppDialog>
  );
}
