/**
 * [INPUT]: 共享界面语言状态、宿主读写命令、View Transitions 平滑过渡辅助与 Cromma SegmentedControl。
 * [OUTPUT]: 侧栏底部的 CN / EN 分段单选，成功写入后平滑刷新界面，失败保留原语言并展示错误。
 * [POS]: 唯一语言写入入口；偏好由宿主持久化，并由实测页心跳读取。选择行为与外观复用 Cromma 原语。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {SegmentedControl} from 'cromma-ui';
import {useI18n,setLocale,type Locale} from './i18n';
import {startSmoothTransition} from './settings-model';
import {postMonitorBusMessage} from './floating-monitor-model';
export function LanguageSwitch(){
  const {locale,t}=useI18n();
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let live=true;void invoke<Locale>('ui_language_read').then(next=>{if(live)setLocale(next);}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[]);
  async function change(next:Locale){if(busy||next===locale)return;setBusy(true);setError('');try{await invoke('ui_language_write',{language:next});startSmoothTransition(()=>setLocale(next));postMonitorBusMessage({type:'language-updated',language:next});}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <><SegmentedControl className="language-switch" itemClassName="language-switch-item" size="small" aria-label={t('界面语言')} value={locale} disabled={busy} onValueChange={value=>void change(value)} items={[{value:'zh',label:'CN',title:t('简体中文')},{value:'en',label:'EN',title:'English'}]}/>{error&&<p className="system-feedback error" role="alert">{t(error)}</p>}</>;
}
