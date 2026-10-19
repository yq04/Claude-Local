/**
 * [INPUT]: A 品牌图、Laper Landing 壳/侧栏视觉参数、Cromma UI、共享 YAML 界面语言、身份/浏览器/系统页面及快捷操作、网络资源入口与只读本地版本标识。
 * [OUTPUT]: Claude-Local 品牌与暖灰/橙色侧栏：傻瓜设置置顶，分隔线后为网络环境、Claude 身份管理、浏览器环境、电脑环境和使用说明；本地版标识与语言切换固定底部，不挂载更新器。
 * [POS]: 独立产品编排层；默认身份页并记住安全页面枚举，任务运行时锁定导航，完成后重新挂载高级页面以刷新快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Panel, NavButton, MotionRoot, TooltipProvider } from 'cromma-ui';
import { ShieldCheck as IdentityIcon, HomeDefault as HomeIcon, WindowBrowser as BrowserIcon, Settings01 as SettingsIcon, Share01 as NetworkIcon, FolderDefault as HelpIcon } from 'cromma-ui/pika';
import { Fragment, useState, useEffect } from 'react';
import {useI18n} from "./i18n";
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IdentityPanel } from './identities';
import { BrowserPanel } from './browser';
import { SystemPanel } from './system';
import { useQuickActions } from './quick-actions';
import { VpsPanel } from './vps';
import { LanguageSwitch } from './language-switch';
import { LocalEdition } from './local-edition';
import {readPage,rememberPage,type Page} from './navigation';
import { HelpPanel } from './help';
import appLogo from '../assets/claude-local-mark.svg';
import './index.css';
import './style.css';
const titles: Record<Page, string> = { quick: '傻瓜设置', cleaner: 'Claude 身份管理', browser: '浏览器环境', system: '电脑环境', vps: '网络环境', help: '使用说明' };
const icons: Record<Page, typeof HomeIcon> = { quick: HomeIcon, cleaner: IdentityIcon, browser: BrowserIcon, system: SettingsIcon, vps: NetworkIcon, help: HelpIcon };
function App() {
    const {t}=useI18n();
    const [emptyRequested,setEmptyRequested]=useState(false);
    const [page, setPage] = useState<Page>(readPage), [revision, setRevision] = useState(0), [advancedBusy, setAdvancedBusy] = useState(false);
    const quick = useQuickActions(() => setPage('quick'), () => setRevision(v => v + 1),()=>{setEmptyRequested(true);setRevision(v=>v+1);setPage("cleaner");});
    const locked = quick.busy || advancedBusy;
    useEffect(()=>{rememberPage(page);},[page]);
    return <><div className="drag-strip" onMouseDown={e => { if (e.button === 0)
        void getCurrentWindow().startDragging(); }}/><div className="app-shell"><aside className="app-sidebar">
    <div className="app-brand"><img src={appLogo} width={32} height={32} alt="" draggable={false} className="rounded-xl"/><div className="app-brand-copy"><strong>{t('localEdition.brand')}</strong><span>{t('localEdition.subtitle')}</span></div></div>
    <nav aria-label={t("主要页面")}>{(['quick', 'vps', 'cleaner', 'browser', 'system', 'help'] as const).map(p => { const Icon = icons[p]; return <Fragment key={p}>{(p==='vps'||p==='help')&&<hr className="nav-divider"/>}<NavButton className="workspace-nav" active={page === p} aria-current={page === p ? "page" : undefined} disabled={locked} icon={<Icon size={18} aria-hidden="true"/>} onClick={() => {setEmptyRequested(false);setPage(p);}}>{t(titles[p])}</NavButton></Fragment>; })}</nav>
    <div className="sidebar-bottom"><LocalEdition/><LanguageSwitch /></div>
  </aside><Panel frame className="workspace"><fieldset disabled={advancedBusy} className={`cleaner-slot quick-fieldset ${page !== 'quick' ? 'page-hidden' : ''}`}>{quick.content}</fieldset>
    {page === 'cleaner' && <div className="cleaner-slot"><IdentityPanel key={revision} initialEmpty={emptyRequested} onBusy={setAdvancedBusy}/></div>}{page === 'browser' && <div className="cleaner-slot"><BrowserPanel key={revision} onBusy={setAdvancedBusy}/></div>}{page === 'system' && <div className="cleaner-slot"><SystemPanel key={revision} onBusy={setAdvancedBusy}/></div>}{page === 'vps' && <div className="cleaner-slot"><VpsPanel/></div>}{page === 'help' && <div className="cleaner-slot"><HelpPanel/></div>}
  </Panel></div></>;
}
createRoot(document.getElementById('app')!).render(<MotionRoot><TooltipProvider delayDuration={600} skipDelayDuration={300}><App /></TooltipProvider></MotionRoot>);
