/**
 * [INPUT]: Shell navigation, active-page refresh and explicit identity/handoff actions; saved identities are read only when opened.
 * [OUTPUT]: Keyboard-searchable command dialog with privacy-filtered saved identity labels and roving selection.
 * [POS]: Product shell command surface; it never switches identities or writes local/native data.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useId, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {Button, Input} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {filterCommandItems, clampActiveIndex, type CommandItem} from './command-model';
import {maskDisplayName, usePreferences} from './settings-model';
import type {IdentityState} from './identity-model';
import type {Page} from './navigation';

const pages: readonly Page[] = ['quick', 'vps', 'cleaner', 'usage', 'browser', 'system', 'help', 'settings'];
const pageTitles: Record<Page, string> = {
  quick: '快速配置', cleaner: '身份管理', usage: 'usage.title', browser: '浏览环境',
  system: '电脑环境', vps: '网络环境', help: '使用说明', settings: '软件设置',
};
const refreshable = new Set<Page>(['cleaner', 'quick', 'browser', 'system', 'usage']);

type PaletteAction = CommandItem & (
  | {kind: 'navigate'; page: Page}
  | {kind: 'refresh'}
  | {kind: 'handoff'}
  | {kind: 'identity'; identityId: string}
);

export function CommandPalette({open, onOpenChange, page, locked, onNavigate, onRefresh, onOpenHandoff, onReviewIdentity}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: Page;
  locked: boolean;
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
  onOpenHandoff: () => void;
  onReviewIdentity: (identityId: string) => void;
}) {
  const {t} = useI18n();
  const {privacyMask} = usePreferences();
  const inputId = useId();
  const optionPrefix = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [identityState, setIdentityState] = useState<IdentityState | null>(null);
  const [identityRead, setIdentityRead] = useState<'idle'|'loading'|'failed'|'ready'>('idle');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    let live = true;
    setIdentityRead('loading');
    void invoke<IdentityState>('identities_read').then(value => {
      if (live) {setIdentityState(value); setIdentityRead('ready');}
    }, () => {
      if (live) {setIdentityState(null); setIdentityRead('failed');}
    });
    return () => {live = false; window.cancelAnimationFrame(frame);};
  }, [open]);

  const commands = useMemo<PaletteAction[]>(() => {
    const navigation: PaletteAction[] = pages.map(target => ({
      id: `page-${target}`, kind: 'navigate', page: target, label: t(pageTitles[target]), keywords: [target], disabled: locked,
    }));
    if (refreshable.has(page)) navigation.push({id: 'refresh', kind: 'refresh', label: t('commandPalette.refreshCurrent'), keywords: [t(pageTitles[page]), 'refresh'], disabled: locked});
    navigation.push({id: 'handoff', kind: 'handoff', label: t('handoff.title'), keywords: ['handoff', 'notes'], disabled: locked});
    if (identityState) {
      for (const identity of identityState.records) {
        const summary = identityState.summaries[identity.id];
        const label = maskDisplayName(identity.name, summary?.email, privacyMask) || t('commandPalette.unnamedIdentity');
        navigation.push({id: `identity-${identity.id}`, kind: 'identity', identityId: identity.id, label, keywords: [t('commandPalette.reviewIdentity')], disabled: locked || identity.id === identityState.active});
      }
    }
    return navigation;
  }, [identityState, locked, page, privacyMask, t]);
  const visible = useMemo(() => filterCommandItems(commands, query), [commands, query]);
  useEffect(() => {setActiveIndex(visible.length ? 0 : -1);}, [visible.length, query]);
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${optionPrefix}option-${activeIndex}`)?.scrollIntoView({block: 'nearest'});
  }, [activeIndex, optionPrefix, visible.length]);

  function choose(item: PaletteAction | undefined) {
    if (!item || item.disabled) return;
    onOpenChange(false);
    if (item.kind === 'navigate') onNavigate(item.page);
    else if (item.kind === 'refresh') onRefresh();
    else if (item.kind === 'handoff') onOpenHandoff();
    else onReviewIdentity(item.identityId);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {event.preventDefault(); setActiveIndex(index => clampActiveIndex(index + 1, visible.length));}
    else if (event.key === 'ArrowUp') {event.preventDefault(); setActiveIndex(index => clampActiveIndex(index < 0 ? 0 : index - 1, visible.length));}
    else if (event.key === 'Home' && visible.length) {event.preventDefault(); setActiveIndex(0);}
    else if (event.key === 'End' && visible.length) {event.preventDefault(); setActiveIndex(visible.length - 1);}
    else if (event.key === 'Enter') {event.preventDefault(); choose(visible[activeIndex]);}
  }

  return <AppDialog open={open} onOpenChange={onOpenChange} title={t('commandPalette.title')} description={t('commandPalette.description')} width={560} className="command-palette-dialog">
    <div className="command-palette">
      <label className="sr-only" htmlFor={inputId}>{t('commandPalette.search')}</label>
      <Input ref={input} id={inputId} autoComplete="off" placeholder={t('commandPalette.search')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onInputKeyDown} role="combobox" aria-expanded="true" aria-controls={optionPrefix + 'list'} aria-activedescendant={activeIndex >= 0 ? `${optionPrefix}option-${activeIndex}` : undefined} />
      <div id={optionPrefix + 'list'} className="command-palette-list" role="listbox" aria-label={t('commandPalette.results')}>
        {visible.map((item, index) => <button
          key={item.id}
          id={`${optionPrefix}option-${index}`}
          className="command-palette-option"
          type="button"
          tabIndex={-1}
          role="option"
          aria-selected={index === activeIndex}
          disabled={item.disabled}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(item)}
        ><span>{item.label}</span>{item.kind === 'navigate' && <small>{t('commandPalette.goTo')}</small>}{item.kind === 'refresh' && <small>{t('commandPalette.refresh')}</small>}{item.kind === 'handoff' && <small>{t('commandPalette.open')}</small>}{item.kind === 'identity' && <small>{t('commandPalette.reviewIdentity')}</small>}</button>)}
        {!visible.length && <p className="command-palette-empty">{t('commandPalette.empty')}</p>}
      </div>
      {identityRead === 'loading' && <p className="command-palette-hint" role="status">{t('commandPalette.readingIdentities')}</p>}
      {identityRead === 'failed' && <p className="command-palette-hint" role="status">{t('commandPalette.identitiesUnavailable')}</p>}
      <div className="command-palette-footer"><span>{t('commandPalette.keyboardHint')}</span><Button size="small" variant="secondary" onClick={() => onOpenChange(false)}>{t('关闭弹窗')}</Button></div>
    </div>
  </AppDialog>;
}
