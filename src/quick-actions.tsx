/**
 * [INPUT]: Independent identity/browser/system/CLI reads, shared effective browser target, page icons and locale.
 * [OUTPUT]: Progressive environment overview, scoped failure reasons and six consistent configuration destinations.
 * [POS]: Mounted only on the quick page; actions navigate or refresh, never rotate fingerprints, start browsers or change system settings.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {Button} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {effectiveBrowserTarget, type BrowserState} from './browser-model';
import type {IdentityState} from './identity-model';
import type {Page} from './navigation';
import {pageIcons} from './page-icons';
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

  const busy = [identity, browser, system, cli].some(state => state.pending);
  const status = (state: ReadState<unknown>, value: string) => state.pending ? t('quick.checking') : state.error ? t('quick.unavailable') : value;
  const identityStatus = identity.value?.recovery ? t('quick.recovery') : identity.value?.current.unavailable ? t('quick.unavailable') : t(identity.value?.current.present ? 'quick.identityPresent' : 'quick.identityEmpty');
  const browserStatus = t(browser.value?.engine_ready ? browser.value.running ? 'quick.browserRunning' : 'quick.browserReady' : 'quick.browserMissing');
  const cliStatus = t(cli.value?.method ? cli.value.running ? 'quick.cliRunning' : 'quick.cliInstalled' : 'quick.cliMissing');
  const target = browser.value ? effectiveBrowserTarget(browser.value) : null;
  const linked = browser.value?.identity_linked ?? browser.value?.identity?.linked;
  const snapshots = [
    {key: 'identity', label: t('身份管理'), state: identity, value: identityStatus, detail: identity.value ? t('quick.savedCount', {n: identity.value.records.length}) : '—'},
    {key: 'browser', label: t('浏览环境'), state: browser, value: browserStatus, detail: t(linked == null ? 'quick.unknown' : linked ? 'quick.browserLinked' : 'quick.browserIndependent')},
    {key: 'system', label: t('电脑环境'), state: system, value: system.value?.timezone || t('quick.unknown'), detail: system.value?.languages.join(' · ') || '—'},
    {key: 'cli', label: 'Claude Code CLI', state: cli, value: cliStatus, detail: cli.value?.version || '—'},
  ];
  const failed = snapshots.filter(({state}) => state.error);
  const cards = [
    {page: 'vps', title: '网络环境', description: 'quick.networkHint', action: '前往网络环境'},
    {page: 'cleaner', title: '身份管理', description: 'quick.identityHint', action: '前往身份管理'},
    {page: 'browser', title: '浏览环境', description: 'quick.browserHint', action: '前往浏览器环境'},
    {page: 'system', title: '电脑环境', description: 'quick.systemHint', action: '前往电脑环境'},
    {page: 'usage', title: 'usage.title', description: 'quick.usageHint', action: '查看用量统计'},
    {page: 'settings', title: '软件设置', description: 'quick.settingsHint', action: '前往软件设置'},
  ] as const;
  return <section className="system-page quick-page">
    <header className="cleanup-title quick-header"><h1>{t('快速配置')}</h1><Button variant="secondary" size="small" loading={busy} aria-label={t('quick.refresh')} leftIcon={<Refresh size={15} aria-hidden="true" />} onClick={() => setRevision(value => value + 1)}>{t('quick.refresh')}</Button></header>
    <div className="quick-content">
      <section className="settings-card quick-overview" aria-busy={busy}>
        <div className="quick-overview-heading"><h2>{t('quick.overview')}</h2><span className="settings-meta-pill" role="status">{t(busy ? 'quick.checking' : 'quick.observed')}</span></div>
        <div className="quick-state-grid">
          {snapshots.map(({key, label, state, value, detail}) => <div key={key} data-quick-state={key} data-read-state={state.pending ? 'pending' : state.error ? 'failed' : 'ready'} aria-busy={state.pending}>
            <span>{label}</span><strong>{status(state, value)}</strong><small>{state.pending || state.error ? '—' : detail}</small>
            {state.error && <small className="quick-read-error">{t(state.error)}</small>}
          </div>)}
        </div>
        <div className="quick-target"><span>{t('quick.browserTarget')}</span><strong>{browser.pending ? t('quick.checking') : target ? `${target.timezone} · ${target.language}` : t('quick.unavailable')}</strong>{target && browser.value?.config.follow_machine && <span className="settings-meta-pill">{t('quick.followsMachine')}</span>}<small>{t('quick.targetNote')}</small></div>
        {failed.length > 0 && <div role="alert" className="system-feedback error quick-feedback"><strong>{t('quick.failedChecks', {sections: failed.map(item => item.label).join(' · ')})}</strong><p>{t('quick.partialFailure')}</p></div>}
      </section>
      <div className="settings-group-heading"><span className="settings-group-bar" aria-hidden="true" /><h2>{t('推荐设置流程')}</h2></div>
      <div className="quick-setup-grid">
        {cards.map(({page, title, description, action}) => {
          const Icon = pageIcons[page];
          return <section className="settings-card quick-setup-card" key={page} data-quick-destination={page}>
          <div className="quick-card-title"><span className="settings-icon-badge" aria-hidden="true"><Icon size={19} /></span><h3>{t(title)}</h3></div>
          <p>{t(description)}</p><Button size="small" variant="secondary" onClick={() => onNavigate(page)}>{t(action)}</Button>
        </section>})}
      </div>
    </div>
  </section>;
}
