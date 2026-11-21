/**
 * [INPUT]: Shell navigation, active-page refresh, page icons, quota/plan evaluation and explicit identity/SmartRelay/handoff actions; saved identities are read only when opened.
 * [OUTPUT]: Grouped keyboard-searchable command dialog (Pages / Quick Actions / Saved Identities) with page icons, current-page & active-identity badges, semantic plan/quota/slot pills, privacy-filtered labels and roving selection.
 * [POS]: Product shell command surface; it never switches identities or writes local/native data.
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
import {useEffect, useId, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {Button, Input} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {
  filterCommandItems,
  firstEnabledCommandIndex,
  lastEnabledCommandIndex,
  stepEnabledCommandIndex,
  type CommandItem,
} from './command-model';
import {maskDisplayName, usePreferences} from './settings-model';
import {evaluateQuota} from './identity-quota';
import {formatTruthfulPercent, normalizePlanSlug} from './smart-relay-model';
import {pageIcons} from './page-icons';
import type {IdentityState} from './identity-model';
import type {Page} from './navigation';

const pages: readonly Page[] = ['quick', 'vps', 'risk', 'cleaner', 'usage', 'browser', 'system', 'help', 'settings'];
const pageTitles: Record<Page, string> = {
  quick: '快速配置',
  cleaner: '身份管理',
  usage: 'usage.title',
  browser: '浏览环境',
  system: '电脑环境',
  vps: '网络环境',
  risk: '风控验证',
  help: '使用说明',
  settings: '软件设置',
};
const refreshable = new Set<Page>(['cleaner', 'quick', 'browser', 'system', 'risk', 'usage']);

type PaletteGroup = 'pages' | 'actions' | 'identities';

type PaletteAction = CommandItem & {
  group: PaletteGroup;
} & (
    | {kind: 'navigate'; page: Page; isCurrentPage: boolean}
    | {kind: 'refresh'}
    | {kind: 'handoff'}
    | {kind: 'smart-relay'}
    | {
        kind: 'identity';
        identityId: string;
        plan: string | null;
        quotaLabel: string;
        slotCount: number;
        isCurrentIdentity: boolean;
      }
  );

export function CommandPalette({
  open,
  onOpenChange,
  page,
  locked,
  onNavigate,
  onRefresh,
  onOpenHandoff,
  onReviewIdentity,
  onOpenSmartRelay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: Page;
  locked: boolean;
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
  onOpenHandoff: () => void;
  onReviewIdentity: (identityId: string) => void;
  onOpenSmartRelay?: () => void;
}) {
  const {t} = useI18n();
  const {privacyMask, quotaDisplay} = usePreferences();
  const inputId = useId();
  const optionPrefix = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [identityState, setIdentityState] = useState<IdentityState | null>(null);
  const [identityRead, setIdentityRead] = useState<'idle' | 'loading' | 'failed' | 'ready'>('idle');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    let live = true;
    setIdentityRead('loading');
    void invoke<IdentityState>('identities_read').then(
      value => {
        if (live) {
          setIdentityState(value);
          setIdentityRead('ready');
        }
      },
      () => {
        if (live) {
          setIdentityState(null);
          setIdentityRead('failed');
        }
      },
    );
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const commands = useMemo<PaletteAction[]>(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const items: PaletteAction[] = pages.map(target => ({
      id: `page-${target}`,
      group: 'pages',
      kind: 'navigate',
      page: target,
      isCurrentPage: target === page,
      label: t(pageTitles[target]),
      keywords: [target],
      disabled: locked,
    }));
    if (refreshable.has(page)) {
      items.push({
        id: 'refresh',
        group: 'actions',
        kind: 'refresh',
        label: t('commandPalette.refreshCurrent'),
        keywords: [t(pageTitles[page]), 'refresh'],
        disabled: locked,
      });
    }
    if (onOpenSmartRelay) {
      items.push({
        id: 'smart-relay',
        group: 'actions',
        kind: 'smart-relay',
        label: t('commandPalette.openSmartRelay'),
        keywords: ['relay', 'smart', 'rotation', t('relay.dialogTitle')],
        disabled: locked,
      });
    }
    items.push({
      id: 'handoff',
      group: 'actions',
      kind: 'handoff',
      label: t('handoff.title'),
      keywords: ['handoff', 'notes'],
      disabled: locked,
    });
    if (identityState) {
      for (const identity of identityState.records) {
        const summary = identityState.summaries[identity.id];
        const label = maskDisplayName(identity.name, summary?.email, privacyMask) || t('commandPalette.unnamedIdentity');
        const isCurrentIdentity = Boolean(identityState.current.present && identity.id === identityState.active);
        const q = evaluateQuota(summary, nowSec);
        const quotaLabel =
          q && q.known5h
            ? q.no5hLimit
              ? `7d ${formatTruthfulPercent(quotaDisplay === 'used' ? q.used7d : q.rem7d)}`
              : `5h ${formatTruthfulPercent(quotaDisplay === 'used' ? q.used5h : q.rem5h)}`
            : '';
        const slotCount = identityState.slot_sessions?.[identity.id]?.length ?? 0;
        const keywords = [t('commandPalette.reviewIdentity'), ...(summary?.plan ? [summary.plan] : [])];
        items.push({
          id: `identity-${identity.id}`,
          group: 'identities',
          kind: 'identity',
          identityId: identity.id,
          label,
          plan: summary?.plan ?? null,
          quotaLabel,
          slotCount,
          isCurrentIdentity,
          keywords,
          disabled: locked || isCurrentIdentity,
        });
      }
    }
    return items;
  }, [identityState, locked, onOpenSmartRelay, page, privacyMask, quotaDisplay, t]);

  const visible = useMemo(() => filterCommandItems(commands, query), [commands, query]);
  useEffect(() => {
    setActiveIndex(firstEnabledCommandIndex(visible));
  }, [visible, query]);
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${optionPrefix}option-${activeIndex}`)?.scrollIntoView({block: 'nearest'});
  }, [activeIndex, optionPrefix, visible.length]);

  function choose(item: PaletteAction | undefined) {
    if (!item || item.disabled) return;
    if (item.kind === 'navigate') onNavigate(item.page);
    else if (item.kind === 'refresh') onRefresh();
    else if (item.kind === 'smart-relay') onOpenSmartRelay?.();
    else if (item.kind === 'handoff') onOpenHandoff();
    else onReviewIdentity(item.identityId);
    onOpenChange(false);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => stepEnabledCommandIndex(visible, index, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => stepEnabledCommandIndex(visible, index, -1));
    } else if (event.key === 'Home' && visible.length) {
      event.preventDefault();
      setActiveIndex(firstEnabledCommandIndex(visible));
    } else if (event.key === 'End' && visible.length) {
      event.preventDefault();
      setActiveIndex(lastEnabledCommandIndex(visible));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(visible[activeIndex]);
    }
  }

  const groupLabelKey: Record<PaletteGroup, string> = {
    pages: 'commandPalette.groupPages',
    actions: 'commandPalette.groupActions',
    identities: 'commandPalette.groupIdentities',
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('commandPalette.title')}
      description={t('commandPalette.description')}
      width={560}
      className="command-palette-dialog"
      restoreFocus={false}
    >
      <div className="command-palette">
        <label className="sr-only" htmlFor={inputId}>
          {t('commandPalette.search')}
        </label>
        <Input
          ref={input}
          id={inputId}
          autoComplete="off"
          placeholder={t('commandPalette.search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={optionPrefix + 'list'}
          aria-activedescendant={activeIndex >= 0 ? `${optionPrefix}option-${activeIndex}` : undefined}
        />
        <div id={optionPrefix + 'list'} className="command-palette-list" role="listbox" aria-label={t('commandPalette.results')}>
          {visible.map((item, index) => {
            const prevGroup = index > 0 ? visible[index - 1]?.group : null;
            const showGroupHeader = item.group !== prevGroup;
            const PageIcon = item.kind === 'navigate' ? pageIcons[item.page] : null;
            return (
              <div key={item.id} role="presentation">
                {showGroupHeader && (
                  <div className="command-palette-group-label" aria-hidden="true">
                    {t(groupLabelKey[item.group])}
                  </div>
                )}
                <button
                  id={`${optionPrefix}option-${index}`}
                  className="command-palette-option"
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={index === activeIndex}
                  disabled={item.disabled}
                  onMouseEnter={() => {
                    if (!item.disabled) setActiveIndex(index);
                  }}
                  onClick={() => choose(item)}
                >
                  <span className="command-palette-option-main">
                    {PageIcon && (
                      <span className="command-palette-option-icon" aria-hidden="true">
                        <PageIcon size={15} />
                      </span>
                    )}
                    <span className="command-palette-option-label">{item.label}</span>
                    {item.kind === 'identity' && item.plan && (
                      <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(item.plan)}>
                        {item.plan}
                      </span>
                    )}
                    {item.kind === 'identity' && item.slotCount > 0 && (
                      <span className="command-palette-badge is-current">
                        {item.slotCount > 1
                          ? t('relay.slotLiveCount', {count: item.slotCount})
                          : t('relay.slotLiveBadge')}
                      </span>
                    )}
                  </span>
                  <span className="command-palette-option-meta">
                    {item.kind === 'navigate' &&
                      (item.isCurrentPage ? (
                        <span className="command-palette-badge is-current">{t('commandPalette.currentPage')}</span>
                      ) : (
                        <small>{t('commandPalette.goTo')}</small>
                      ))}
                    {item.kind === 'refresh' && <small>{t('commandPalette.refresh')}</small>}
                    {(item.kind === 'handoff' || item.kind === 'smart-relay') && <small>{t('commandPalette.open')}</small>}
                    {item.kind === 'identity' && (
                      <>
                        {item.quotaLabel && <small>{item.quotaLabel}</small>}
                        {item.isCurrentIdentity ? (
                          <span className="command-palette-badge is-current">{t('identityCard.statusActive')}</span>
                        ) : (
                          <small>{t('commandPalette.reviewIdentity')}</small>
                        )}
                      </>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
          {!visible.length && <p className="command-palette-empty">{t('commandPalette.empty')}</p>}
        </div>
        {identityRead === 'loading' && (
          <p className="command-palette-hint" role="status">
            {t('commandPalette.readingIdentities')}
          </p>
        )}
        {identityRead === 'failed' && (
          <p className="command-palette-hint" role="status">
            {t('commandPalette.identitiesUnavailable')}
          </p>
        )}
        <div className="command-palette-footer">
          <span className="command-palette-kbds">
            <kbd>↑↓</kbd>
            <kbd>Enter</kbd>
            <kbd>Esc</kbd>
            <span>{t('commandPalette.keyboardHint')}</span>
          </span>
          <Button size="small" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('关闭弹窗')}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
