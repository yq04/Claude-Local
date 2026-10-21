/**
 * [INPUT]: A 品牌图、Cockpit Tools / CC Switch 座舱壳与侧栏参数、Cromma UI、共享 YAML 界面语言、身份/浏览器/系统/设置页面及快捷操作、网络资源入口与只读本地版本标识。
 * [OUTPUT]: Claude-Local 品牌与可折叠座舱侧栏：紧凑态标志与展开按钮分层，底部语言和版本分区显示；主导航全四字标头（快速配置/网络环境/身份管理/用量分析/浏览环境/电脑环境/使用说明/软件设置）与页面路由按产品页面组织。
 * [POS]: 独立产品编排层；默认身份页并记住安全页面枚举，任务运行时锁定导航；快速配置仅按需挂载、读取状态和导航。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Panel, NavButton, MotionRoot, TooltipProvider} from 'cromma-ui';
import {
  ShieldCheck as IdentityIcon,
  HomeDefault as HomeIcon,
  WindowBrowser as BrowserIcon,
  Server as SystemIcon,
  Share01 as NetworkIcon,
  FolderDefault as HelpIcon,
  Settings01 as SettingsIcon,
} from 'cromma-ui/pika';
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
import {HelpPanel} from './help';
import {SettingsPanel} from './settings';
import {UsageStatisticsPanel} from './usage-statistics';
import {updatePreferences, usePreferences} from './settings-model';
import appLogo from '../assets/claude-local-mark.svg';
import './index.css';
import './style.css';
import './usage-statistics.css';

const UsageIcon: typeof HomeIcon = ({size = 18, ...props}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 4v16h16M8 15v-4m5 4V6m5 9V9" />
  </svg>
);

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

const icons: Record<Page, typeof HomeIcon> = {
  quick: HomeIcon,
  cleaner: IdentityIcon,
  usage: UsageIcon,
  browser: BrowserIcon,
  system: SystemIcon,
  vps: NetworkIcon,
  help: HelpIcon,
  settings: SettingsIcon,
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
          {page === 'quick' && <div className="cleaner-slot"><QuickSetupPanel onNavigate={setPage} /></div>}
          {page === 'cleaner' && (
            <div className="cleaner-slot">
              <IdentityPanel onBusy={setAdvancedBusy} />
            </div>
          )}
          {page === 'browser' && (
            <div className="cleaner-slot">
              <BrowserPanel onBusy={setAdvancedBusy} />
            </div>
          )}
          {page === 'usage' && (
            <div className="cleaner-slot">
              <UsageStatisticsPanel />
            </div>
          )}
          {page === 'system' && (
            <div className="cleaner-slot">
              <SystemPanel onBusy={setAdvancedBusy} />
            </div>
          )}
          {page === 'vps' && (
            <div className="cleaner-slot">
              <VpsPanel />
            </div>
          )}
          {page === 'help' && (
            <div className="cleaner-slot">
              <HelpPanel />
            </div>
          )}
          {page === 'settings' && (
            <div className="cleaner-slot">
              <SettingsPanel onNavigate={setPage} />
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(
  <MotionRoot>
    <TooltipProvider delayDuration={600} skipDelayDuration={300}>
      <App />
    </TooltipProvider>
  </MotionRoot>,
);
