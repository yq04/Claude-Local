/**
 * [INPUT]: Tauri 本机应用版本与共享 YAML 界面语言。
 * [OUTPUT]: 侧栏只读的本机版本号徽章；读取失败保持静默，不发起更新检查或网络请求。
 * [POS]: Claude-Local 的静态版本呈现，不参与任务锁、下载、安装或重启。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect,useState} from 'react';
import {getVersion} from '@tauri-apps/api/app';
import {useI18n} from './i18n';

export function LocalEdition(){
  const {t}=useI18n();
  const [version,setVersion]=useState('');
  useEffect(()=>{
    let live=true;
    void getVersion().then(value=>{if(live)setVersion(value);}).catch(()=>{});
    return()=>{live=false;};
  },[]);
  return <div className="local-edition" role="group" aria-label={t('localEdition.info')}>
    {version&&<small>{t('localEdition.version',{version})}</small>}
  </div>;
}
