/**
 * [INPUT]: Independent identity/browser/system/CLI reads, page icons, locale and local refresh event.
 * [OUTPUT]: Shared 4-column telemetry strip (.env-telemetry-strip with pure in-memory pool readiness, Reset Card count & active subagent slots from identities_read), scoped failure feedback and compact 2-column workbench action grid across eight destinations.
 * [POS]: Mounted only on the quick page; actions navigate or refresh guarded reads, never rotate fingerprints, start browsers or change system settings.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {Button} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {usePageRefresh} from './app-events';
import type {BrowserState} from './browser-model';
import type {IdentityState} from './identity-model';
import type {Page} from './navigation';
import {pageIcons} from './page-icons';
import {
  evaluateSmartRelay,
  getSmartRelayConfig,
  summarizeRelayPool,
  type RelayAccountInput,
} from './smart-relay-model';
import './quick-setup.css';

type SystemSnapshot = {timezone: string; languages: string[]};
type CliSnapshot = {method: string; version: string; running: boolean};
type ReadState<T> = {value: T | null; pending: boolean; error: string | null};
const unread = {value: null, pending: true, error: null};

export function QuickSetupPanel({onNavigate}: {onNavigate: (page: Page) => void}) {
  const {t} = useI18n();
  const [revision, setRevision] = useState(0);
  const [identity, setIdentity] = useState<ReadState<IdentityState>>(unread);
  const [browser, setBrowser] = useState<ReadState<BrowserState>>(unread);
  const [system, setSystem] = useState<ReadState<SystemSnapshot>>(unread);
  const [cli, setCli] = useState<ReadState<CliSnapshot>>(unread);
  const busy = [identity, browser, system, cli].some(state => state.pending);
  usePageRefresh(() => { if (!busy) setRevision(value => value + 1); });
  useEffect(() => {
    let live = true;
    function read<T>(command: string, set: Dispatch<SetStateAction<ReadState<T>>>) {
      set(unread);
      void invoke<T>(command).then(value => {
        if (live) set({value, pending: false, error: null});
      }, reason => {
        const message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
        if (live) set({value: null, pending: false, error: message || 'quick.readFailed'});
      });
    }
    read('identities_read', setIdentity);
    read('browser_read', setBrowser);
    read('system_read', setSystem);
    read('claude_cli_read', setCli);
    return () => { live = false; };
  }, [revision]);

  const status = (state: ReadState<unknown>, value: string) => state.pending ? t('quick.checking') : state.error ? t('quick.unavailable') : value;
  const identityStatus = identity.value?.recovery ? t('quick.recovery') : identity.value?.current.unavailable ? t('quick.unavailable') : t(identity.value?.current.present ? 'quick.identityPresent' : 'quick.identityEmpty');
  const browserStatus = t(browser.value?.engine_ready ? browser.value.running ? 'quick.browserRunning' : 'quick.browserReady' : 'quick.browserMissing');
  const cliStatus = t(cli.value?.method ? cli.value.running ? 'quick.cliRunning' : 'quick.cliInstalled' : 'quick.cliMissing');
  const linked = browser.value?.identity_linked ?? browser.value?.identity?.linked;
  const identityDetail = (() => {
    const idVal = identity.value;
    if (!idVal) return '—';
    const base = t('quick.savedCount', {n: idVal.records.length});
    const nowSec = Math.floor(Date.now() / 1000);
    const savedRows = idVal.records.filter(row => !idVal.current.present || row.id !== idVal.active);
    const poolAccounts: RelayAccountInput[] = [
      ...(idVal.current.present
        ? [
            {
              id: idVal.active || 'current',
              name: idVal.current.display_name || 'Current',
              email: idVal.current.email,
              plan: idVal.current.plan,
              auth_status: idVal.current.auth_status,
              subscription_expires_at: idVal.current.subscription_expires_at,
              isCurrent: true,
              listIndex: 0,
              summary: idVal.current,
            },
          ]
        : []),
      ...savedRows.map((row, idx) => {
        const sum = idVal.summaries?.[row.id];
        return {
          id: row.id,
          name: row.name,
          email: sum?.email,
          plan: sum?.plan,
          auth_status: sum?.auth_status,
          subscription_expires_at: sum?.subscription_expires_at,
          isCurrent: false,
          listIndex: idx + 1,
          summary: sum,
        };
      }),
    ];
    const poolSummary = summarizeRelayPool(
      evaluateSmartRelay(poolAccounts, getSmartRelayConfig(), nowSec).candidates,
      nowSec,
    );
    const activeSlotCount = Object.values(idVal.slot_sessions ?? {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0,
    );
    const extras: string[] = [];
    if (poolAccounts.length > 1 && poolSummary.readyCount > 0) {
      extras.push(t('quick.poolReadyShort', {ready: poolSummary.readyCount, total: poolSummary.includedCount}));
    }
    if (poolSummary.totalManualResetsRemaining > 0) {
      extras.push(t('relay.resetCardBadge', {count: poolSummary.totalManualResetsRemaining}));
    }
    if (activeSlotCount > 0) {
      extras.push(t('relay.slotLiveCount', {count: activeSlotCount}));
    }
    return extras.length > 0 ? `${base} · ${extras.join(' · ')}` : base;
  })();
  const snapshots = [
    {key: 'browser', label: t('浏览环境'), state: browser, value: browserStatus, detail: t(linked == null ? 'quick.unknown' : linked ? 'quick.browserLinked' : 'quick.browserIndependent')},
    {key: 'system', label: t('电脑环境'), state: system, value: system.value?.timezone || t('quick.unknown'), detail: system.value?.languages.join(' · ') || '—'},
    {key: 'identity', label: t('身份管理'), state: identity, value: identityStatus, detail: identityDetail},
    {key: 'cli', label: 'Claude Code CLI', state: cli, value: cliStatus, detail: cli.value?.version || '—'},
  ];
  const failed = snapshots.filter(({state}) => state.error);
  const cards = [
    {page: 'browser', title: '浏览环境', description: 'quick.browserHint', action: '前往浏览器环境'},
    {page: 'system', title: '电脑环境', description: 'quick.systemHint', action: '前往电脑环境'},
    {page: 'vps', title: '网络环境', description: 'quick.networkHint', action: '前往网络环境'},
    {page: 'risk', title: '风控验证', description: 'quick.riskHint', action: 'quick.riskAction'},
    {page: 'cleaner', title: '身份管理', description: 'quick.identityHint', action: '前往身份管理'},
    {page: 'cleaner', title: 'quick.troubleshootCard', description: 'quick.troubleshootHint', action: 'quick.troubleshootAction', target: 'residue'},
    {page: 'usage', title: 'usage.title', description: 'quick.usageHint', action: '查看用量统计'},
    {page: 'settings', title: '软件设置', description: 'quick.settingsHint', action: '前往软件设置'},
  ] as const;
  return <section className="system-page quick-page">
    <header className="cleanup-title quick-header"><h1>{t('快速配置')}</h1><Button variant="secondary" size="small" loading={busy} aria-label={t('quick.refresh')} leftIcon={<Refresh size={15} aria-hidden="true" />} onClick={() => setRevision(value => value + 1)}>{t('quick.refresh')}</Button></header>
    <div className="quick-content">
      <section className="settings-card quick-overview" aria-busy={busy}>
        <h2 className="sr-only">{t('quick.overview')}</h2>
        <div className="env-telemetry-strip quick-state-grid">
          {snapshots.map(({key, label, state, value, detail}) => {
            const readState = state.pending ? 'pending' : state.error ? 'failed' : 'ready';
            const displayValue = status(state, value);
            const displayDetail = state.pending || state.error ? '—' : detail;
            return <div key={key} className="env-telemetry-cell quick-telemetry-cell" data-quick-state={key} data-read-state={readState} aria-busy={state.pending}>
              <div className="env-telemetry-head quick-telemetry-head">
                <span className={`env-status-dot quick-status-dot is-${readState}`} aria-hidden="true" />
                <span className="env-telemetry-label quick-telemetry-label">{label}</span>
              </div>
              <strong title={displayValue}>{displayValue}</strong>
              <small title={state.pending || state.error ? '' : detail}>{displayDetail}</small>
              {state.error && <small className="quick-read-error" title={t(state.error)}>{t(state.error)}</small>}
            </div>;
          })}
        </div>
        {failed.length > 0 && <div role="alert" className="system-feedback error quick-feedback"><strong>{t('quick.failedChecks', {sections: failed.map(item => item.label).join(' · ')})}</strong><p>{t('quick.partialFailure')}</p></div>}
      </section>
      <div className="settings-group-heading quick-group-heading"><span className="settings-group-bar" aria-hidden="true" /><h2>{t('推荐设置流程')}</h2></div>
      <div className="quick-setup-grid">
        {cards.map(card => {
          const Icon = pageIcons[card.page];
          const isResidueTarget = 'target' in card && card.target === 'residue';
          return <section className="settings-card quick-setup-card" key={isResidueTarget ? 'residue' : card.page} data-quick-destination={card.page}>
          <span className="settings-icon-badge quick-card-icon" aria-hidden="true"><Icon size={16} /></span>
          <div className="quick-card-copy">
            <h3>{t(card.title)}</h3>
            <p title={t(card.description)}>{t(card.description)}</p>
          </div>
          <Button size="small" variant="secondary" className="quick-card-action" onClick={() => {
            onNavigate(card.page);
            if (isResidueTarget) {
              window.setTimeout(() => {
                const el = document.querySelector('.claude-residue');
                if (el instanceof HTMLElement) {
                  const smooth = document.documentElement.dataset.reduceMotion !== 'true';
                  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
                  el.focus();
                }
              }, 100);
            }
          }}>{t(card.action)}</Button>
        </section>;
        })}
      </div>
    </div>
  </section>;
}
