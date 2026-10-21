/**
 * [INPUT]: Read-only identity/browser/system/CLI snapshots, shared locale and page navigation.
 * [OUTPUT]: Quick configuration overview with observed state, partial-failure recovery and six configuration destinations.
 * [POS]: Mounted only on the quick page; actions navigate or refresh, never rotate fingerprints, start browsers or change system settings.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {Button} from 'cromma-ui';
import {WindowBrowser, Refresh, ClockDefault, ShieldCheck, Globe, Settings01} from 'cromma-ui/pika';
import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import type {BrowserState} from './browser-model';
import type {IdentityState} from './identity-model';
import type {Page} from './navigation';
import './quick-setup.css';

type SystemSnapshot = {timezone: string; languages: string[]};
type CliSnapshot = {method: string; version: string; running: boolean};
type ReadState<T> = {value: T | null; failed: boolean};
const unread = {value: null, failed: false};
const readState = <T,>(result: PromiseSettledResult<T>): ReadState<T> => result.status === 'fulfilled' ? {value: result.value, failed: false} : {value: null, failed: true};
const UsageIcon: typeof Globe = ({size = 19, ...props}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 4v16h16M8 15v-4m5 4V6m5 9V9" /></svg>;

export function QuickSetupPanel({onNavigate}: {onNavigate: (page: Page) => void}) {
  const {t} = useI18n();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [identity, setIdentity] = useState<ReadState<IdentityState>>(unread);
  const [browser, setBrowser] = useState<ReadState<BrowserState>>(unread);
  const [system, setSystem] = useState<ReadState<SystemSnapshot>>(unread);
  const [cli, setCli] = useState<ReadState<CliSnapshot>>(unread);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void Promise.allSettled([
      invoke<IdentityState>('identities_read'), invoke<BrowserState>('browser_read'),
      invoke<SystemSnapshot>('system_read'), invoke<CliSnapshot>('claude_cli_read'),
    ]).then(([identities, browserState, systemState, cliState]) => {
      if (!live) return;
      setIdentity(readState(identities)); setBrowser(readState(browserState));
      setSystem(readState(systemState)); setCli(readState(cliState));
      setBusy(false);
    });
    return () => { live = false; };
  }, [revision]);

  const failed = [identity, browser, system, cli].some(state => state.failed);
  const status = (state: ReadState<unknown>, value: string) => busy ? t('quick.checking') : state.failed ? t('quick.unavailable') : value;
  const identityStatus = identity.value?.recovery ? t('quick.recovery') : identity.value?.current.unavailable ? t('quick.unavailable') : t(identity.value?.current.present ? 'quick.identityPresent' : 'quick.identityEmpty');
  const browserStatus = t(browser.value?.engine_ready ? browser.value.running ? 'quick.browserRunning' : 'quick.browserReady' : 'quick.browserMissing');
  const cliStatus = t(cli.value?.method ? cli.value.running ? 'quick.cliRunning' : 'quick.cliInstalled' : 'quick.cliMissing');
  const target = browser.value?.config;
  const linked = browser.value?.identity_linked ?? browser.value?.identity?.linked;
  const cards = [
    {page: 'vps', title: '网络环境', description: 'quick.networkHint', action: '前往网络环境', icon: Globe},
    {page: 'cleaner', title: '身份管理', description: 'quick.identityHint', action: '前往身份管理', icon: ShieldCheck},
    {page: 'browser', title: '浏览环境', description: 'quick.browserHint', action: '前往浏览器环境', icon: WindowBrowser},
    {page: 'system', title: '电脑环境', description: 'quick.systemHint', action: '前往电脑环境', icon: ClockDefault},
    {page: 'usage', title: 'usage.title', description: 'quick.usageHint', action: '查看用量统计', icon: UsageIcon},
    {page: 'settings', title: '软件设置', description: 'quick.settingsHint', action: '前往软件设置', icon: Settings01},
  ] as const;
  return <section className="system-page quick-page">
    <header className="cleanup-title quick-header"><h1>{t('快速配置')}</h1><Button variant="secondary" size="small" disabled={busy} leftIcon={<Refresh size={15} aria-hidden="true" />} onClick={() => setRevision(value => value + 1)}>{t('quick.refresh')}</Button></header>
    <div className="quick-content">
      <section className="settings-card quick-overview" aria-busy={busy}>
        <div className="quick-overview-heading"><h2>{t('quick.overview')}</h2><span role="status">{t(busy ? 'quick.checking' : 'quick.observed')}</span></div>
        <div className="quick-state-grid">
          <div data-quick-state="identity"><span>{t('身份管理')}</span><strong>{status(identity, identityStatus)}</strong><small>{identity.value && !busy ? t('quick.savedCount', {n: identity.value.records.length}) : '—'}</small></div>
          <div data-quick-state="browser"><span>{t('浏览环境')}</span><strong>{status(browser, browserStatus)}</strong><small>{browser.value && !busy ? t(linked == null ? 'quick.unknown' : linked ? 'quick.browserLinked' : 'quick.browserIndependent') : '—'}</small></div>
          <div data-quick-state="system"><span>{t('电脑环境')}</span><strong>{status(system, system.value?.timezone || t('quick.unknown'))}</strong><small>{!busy ? system.value?.languages.join(' · ') || '—' : '—'}</small></div>
          <div data-quick-state="cli"><span>Claude Code CLI</span><strong>{status(cli, cliStatus)}</strong><small>{!busy ? cli.value?.version || '—' : '—'}</small></div>
        </div>
        <div className="quick-target"><span>{t('quick.browserTarget')}</span><strong>{busy ? t('quick.checking') : target ? `${target.timezone} · ${target.language}` : t('quick.unavailable')}</strong><small>{t('quick.targetNote')}</small></div>
      </section>
      {failed && !busy && <p role="alert" className="system-feedback error">{t('quick.partialFailure')}</p>}
      <div className="settings-group-heading"><span className="settings-group-bar" aria-hidden="true" /><h2>{t('推荐设置流程')}</h2></div>
      <div className="quick-setup-grid">
        {cards.map(({page, title, description, action, icon: Icon}) => <section className="settings-card quick-setup-card" key={page} data-quick-destination={page}>
          <div className="quick-card-title"><span className="settings-icon-badge" aria-hidden="true"><Icon size={19} /></span><h3>{t(title)}</h3></div>
          <p>{t(description)}</p><Button size="small" variant="secondary" onClick={() => onNavigate(page)}>{t(action)}</Button>
        </section>)}
      </div>
    </div>
  </section>;
}
