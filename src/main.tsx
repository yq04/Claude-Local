/**
 * [INPUT]: A 品牌图、Cockpit Tools / CC Switch 座舱壳与侧栏参数、Cromma UI、共享页面图标与 YAML 界面语言、身份/浏览器/系统/设置页面及快捷操作、网络资源入口与只读本地版本标识。
 * [OUTPUT]: Claude-Local 品牌与可折叠座舱侧栏：紧凑态标志与展开按钮分层，底部语言和版本分区显示；主导航全四字标头（快速配置/网络环境/身份管理/用量分析/浏览环境/电脑环境/使用说明/软件设置）与页面路由按产品页面组织。
 * [POS]: 独立产品编排层；默认身份页并记住安全页面枚举，任务运行时锁定导航；快速配置仅按需挂载、读取状态和导航。根 MotionRoot 读取「减少动画」偏好，页面切换只用 Cromma MOTION.base 淡入，不另写动画参数。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Panel, NavButton, MotionRoot, TooltipProvider, MOTION, motion} from 'cromma-ui';
import {Fragment, useState, useEffect} from 'react';
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
import {updatePreferences, usePreferences} from './settings-model';
import appLogo from '../assets/claude-local-mark.svg';
import './index.css';
import './style.css';
import './usage-statistics.css';

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
  const locked = advancedBusy;
  useEffect(() => {
    rememberPage(page);
  }, [page]);

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
            {(['quick', 'vps', 'cleaner', 'usage', 'browser', 'system', 'help', 'settings'] as const).map(p => {
              const Icon = icons[p];
              return (
                <Fragment key={p}>
                  {(p === 'vps' || p === 'help') && <hr className="nav-divider" />}
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
            <LocalEdition />
            <LanguageSwitch />
          </div>
        </aside>
        <Panel frame className="workspace">
          <motion.div key={page} className="cleaner-slot" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} transition={MOTION.base}>
            {page === 'quick' && <QuickSetupPanel onNavigate={setPage} />}
            {page === 'cleaner' && <IdentityPanel onBusy={setAdvancedBusy} />}
            {page === 'browser' && <BrowserPanel onBusy={setAdvancedBusy} />}
            {page === 'usage' && <UsageStatisticsPanel />}
            {page === 'system' && <SystemPanel onBusy={setAdvancedBusy} />}
            {page === 'vps' && <VpsPanel />}
            {page === 'help' && <HelpPanel />}
            {page === 'settings' && <SettingsPanel onNavigate={setPage} />}
          </motion.div>
        </Panel>
      </div>
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
