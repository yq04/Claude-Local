/**
 * [INPUT]: Claude-Local 品牌与座舱页面、共享页面图标和 YAML 文案、Cromma UI、任务锁与本地刷新/身份确认事件。
 * [OUTPUT]: 可折叠座舱侧栏、Ctrl+K 命令面板、活动页手动刷新入口、手工任务交接，以及八个产品页面。
 * [POS]: 独立产品编排层；命令快捷键尊重输入、模态与任务锁，只读身份列表仅在面板打开时读取；交接字段仅内存保留。根 MotionRoot 读取减少动画偏好。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Panel, NavButton, MotionRoot, TooltipProvider, MOTION, motion} from 'cromma-ui';
import {Fragment, useState, useEffect, useRef} from 'react';
import {useI18n} from './i18n';
import {createRoot} from 'react-dom/client';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {IdentityPanel} from './identities';
import {BrowserPanel} from './browser';
import {SystemPanel} from './system';
import {QuickSetupPanel} from './quick-actions';
import {VpsPanel} from './vps';
import {LanguageSwitch} from './language-switch';
import {LocalEdition} from './local-edition';
import {readPage, rememberPage, type Page} from './navigation';
import {pageIcons as icons} from './page-icons';
import {HelpPanel} from './help';
import {SettingsPanel} from './settings';
import {UsageStatisticsPanel} from './usage-statistics';
import {CommandPalette} from './command-palette';
import {TaskHandoff} from './task-handoff';
import {APP_REFRESH_EVENT, type IdentityReviewRequest} from './app-events';
import {commandPaletteShortcutAction} from './command-model';
import {initializePrivacyPreference, updatePreferences, usePreferences} from './settings-model';
import appLogo from '../assets/claude-local-mark.svg';
import './index.css';
import './style.css';
import './usage-statistics.css';
import './productivity-shell.css';

const titles: Record<Page, string> = {
  quick: '快速配置',
  cleaner: '身份管理',
  usage: 'usage.title',
  browser: '浏览环境',
  system: '电脑环境',
  vps: '网络环境',
  help: '使用说明',
  settings: '软件设置',
};

function App() {
  const {t} = useI18n();
  const prefs = usePreferences();
  const [page, setPage] = useState<Page>(readPage);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [identityReviewRequest, setIdentityReviewRequest] = useState<IdentityReviewRequest | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const paletteOpener = useRef<HTMLElement | null>(null);
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  const restorePaletteFocus = () => window.setTimeout(() => (paletteOpener.current ?? paletteTrigger.current)?.focus(), 0);
  const locked = advancedBusy;
  useEffect(() => {
    rememberPage(page);
  }, [page]);

  useEffect(() => {
    void initializePrivacyPreference();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const action = commandPaletteShortcutAction({
        key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, isComposing: event.isComposing,
        keyCode: event.keyCode, paletteOpen, locked, dialogOpen: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
        editableTarget: target instanceof HTMLElement && (target.isContentEditable || !!target.closest('[contenteditable="true"],input,textarea,select,[role="textbox"]')),
      });
      if (action === 'close') {
        event.preventDefault();
        setPaletteOpen(false);
        restorePaletteFocus();
        return;
      }
      if (action !== 'open') return;
      event.preventDefault();
      paletteOpener.current = event.target instanceof HTMLElement ? event.target : null;
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [locked, paletteOpen]);

  function openIdentityReview(identityId: string) {
    const requestId = requestNonce + 1;
    setRequestNonce(requestId);
    setIdentityReviewRequest({identityId, requestId});
    setPage('cleaner');
  }

  const isCompact = prefs.sidebarLayout === 'compact';

  return (
    <>
      <div
        className="drag-strip"
        onMouseDown={e => {
          if (e.button === 0) void getCurrentWindow().startDragging();
        }}
      />
      <div className={`app-shell${isCompact ? ' sidebar-compact' : ''}`}>
        <aside className="app-sidebar">
          <div className="app-brand">
            <div className="app-brand-mark">
              <img src={appLogo} width={34} height={34} alt="" draggable={false} className="rounded-xl" />
            </div>
            <div className="app-brand-copy">
              <strong>{t('localEdition.brand')}</strong>
              <span>{t('localEdition.subtitle')}</span>
            </div>
            <button
              type="button"
              className="sidebar-collapse-btn"
              aria-label={t(isCompact ? '展开侧边栏' : '收起侧边栏')}
              title={t(isCompact ? '展开侧边栏' : '收起侧边栏')}
              onClick={() => updatePreferences({sidebarLayout: isCompact ? 'classic' : 'compact'})}
            >
              <span aria-hidden="true">{isCompact ? '»' : '«'}</span>
            </button>
          </div>
          <nav aria-label={t('主要页面')}>
            {(['quick', 'browser', 'system', 'vps', 'cleaner', 'usage', 'help', 'settings'] as const).map(p => {
              const Icon = icons[p];
              return (
                <Fragment key={p}>
                  {(p === 'browser' || p === 'cleaner' || p === 'help') && <hr className="nav-divider" />}
                  <NavButton
                    className={`workspace-nav${p === 'help' ? ' nav-utility-first' : ''}${p === 'settings' ? ' nav-settings-item' : ''}`}
                    active={page === p}
                    aria-current={page === p ? 'page' : undefined}
                    disabled={locked}
                    title={t(titles[p])}
                    icon={<Icon size={18} aria-hidden="true" />}
                    onClick={() => {
                      setPage(p);
                    }}
                  >
                    {t(titles[p])}
                  </NavButton>
                </Fragment>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <button ref={paletteTrigger} type="button" className="command-palette-trigger" disabled={locked} aria-label={t('commandPalette.trigger')} aria-keyshortcuts="Control+K Meta+K" title={t('commandPalette.triggerTitle')} onClick={event => {paletteOpener.current = event.currentTarget; setPaletteOpen(true);}}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
              <span>{t('commandPalette.trigger')}</span><kbd>Ctrl K</kbd>
            </button>
            <LocalEdition />
            <LanguageSwitch />
          </div>
        </aside>
        <Panel frame className="workspace">
          <motion.div key={page} className="cleaner-slot" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} transition={MOTION.base}>
            {page === 'quick' && <QuickSetupPanel onNavigate={setPage} />}
            {page === 'cleaner' && <IdentityPanel onBusy={setAdvancedBusy} identityReviewRequest={identityReviewRequest} onIdentityReviewConsumed={requestId => setIdentityReviewRequest(current => current?.requestId === requestId ? null : current)} />}
            {page === 'browser' && <BrowserPanel onBusy={setAdvancedBusy} />}
            {page === 'usage' && <UsageStatisticsPanel />}
            {page === 'system' && <SystemPanel onBusy={setAdvancedBusy} />}
            {page === 'vps' && <VpsPanel />}
            {page === 'help' && <HelpPanel />}
            {page === 'settings' && <SettingsPanel onNavigate={setPage} />}
          </motion.div>
        </Panel>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={open => {
          setPaletteOpen(open);
          if (!open) restorePaletteFocus();
        }}
        page={page}
        locked={locked}
        onNavigate={setPage}
        onRefresh={() => window.setTimeout(() => window.dispatchEvent(new Event(APP_REFRESH_EVENT)), 0)}
        onOpenHandoff={() => window.setTimeout(() => setHandoffOpen(true), 50)}
        onReviewIdentity={openIdentityReview}
      />
      <TaskHandoff open={handoffOpen} onOpenChange={setHandoffOpen} />
    </>
  );
}

function Root() {
  const {reduceMotion} = usePreferences();
  return (
    <MotionRoot reducedMotion={reduceMotion ? 'always' : 'user'}>
      <TooltipProvider delayDuration={600} skipDelayDuration={300}>
        <App />
      </TooltipProvider>
    </MotionRoot>
  );
}

createRoot(document.getElementById('app')!).render(<Root />);
