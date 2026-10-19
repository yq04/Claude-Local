/**
 * [INPUT]: 文件残留白名单扫描/快照清理命令、身份页任务锁与刷新信号、共享确认窗与卡片下统一进度通道。
 * [OUTPUT]: 当前 Claude 文件的逐项路径/规模/影响预览，默认只选完整缓存，明确确认后直接清理并复查。
 * [POS]: 身份管理的文件维护区域；不访问钥匙串，路径和字段名之外的文件正文不进入界面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect,useState} from 'react';
import {Button,Checkbox} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {invoke} from '@tauri-apps/api/core';
import {AppDialog} from './dialog';
import type {ActivityController} from './cleaner-activity';
import {deselectItems,effectiveItems,formatBytes,riskLabels,type CleanResult,type Scan} from './cleaner-model';
import {useI18n} from './i18n';

export function ClaudeResiduePanel({activity,blocked,revision,onBusy,onChanged}:{activity:ActivityController;blocked:boolean;revision:number;onBusy:(busy:boolean)=>void;onChanged:()=>Promise<void>}){
 const {t}=useI18n();
 const [scan,setScan]=useState<Scan|null>(null),[ids,setIds]=useState<string[]>([]);
 const [action,setAction]=useState<'scan'|'clean'|null>(null),[review,setReview]=useState(false),[accepted,setAccepted]=useState(false);
 const [error,setError]=useState('');
 const items=scan?.items??[],available=items.filter(item=>item.exact);
 const selected=effectiveItems(items,ids),all=effectiveItems(available,available.map(item=>item.id));
 const bytes=(rows:typeof items)=>rows.reduce((sum,item)=>sum+item.bytes,0);
 const locked=blocked||!!action;
 useEffect(()=>{onBusy(!!action||review);return()=>onBusy(false);},[action,review,onBusy]);
 useEffect(()=>{setScan(null);setIds([]);setError('');},[revision]);

 async function check(){
  if(locked)return;
  setAction('scan');setError('');setScan(null);setIds([]);
  try{
   const next=await invoke<Scan>('claude_residue_scan',{onProgress:activity.start('scan','检查残留')});
   setScan(next);setIds(next.items.filter(item=>item.risk==='safe'&&item.exact).map(item=>item.id));
   activity.finish(true,next.message);
  }catch(e){setError(String(e));activity.finish(false,String(e));}finally{setAction(null);}
 }
 async function clean(){
  if(!review||!accepted||action||!selected.length)return;
  const chosen=selected.map(item=>item.id);
  setReview(false);setAction('clean');setError('');setScan(null);setIds([]);
  const onProgress=activity.start('clean','清理所选文件');
  let failure='',cleaned=0;
  try{
   await invoke('identities_stop',{onProgress:activity.channel()});
   const result=await invoke<CleanResult>('claude_residue_clean',{ids:chosen,onProgress});
   cleaned=result.cleaned;
   if(!result.completed||result.errors.length)failure=result.errors.join('\n')||'清理未完成，请检查剩余文件。';
  }catch(e){failure=String(e);}
  // ----- 无论成功或部分删除都重扫；新结果不沿用旧选择，也不自动再次执行 -----
  try{setScan(await invoke<Scan>('claude_residue_scan',{onProgress:activity.channel('verify')}));}
  catch(e){failure=[failure,String(e)].filter(Boolean).join('\n');}
  try{await onChanged();}catch(e){failure=[failure,String(e)].filter(Boolean).join('\n');}
  setError(failure);activity.finish(!failure,failure||`已清理 ${cleaned} 项。`);setAction(null);
 }

 return <section className="claude-residue" aria-label={t('Claude 文件残留')}>
  <div className="identity-section-head"><div><h2>{t('Claude 文件残留')}</h2><span className="identity-caption" role="status">{action==='scan'?t('正在检查文件…'):action==='clean'?t('正在处理…'):scan?t('{v0} 项 · {v1}',{v0:all.length,v1:formatBytes(bytes(all))}):t('尚未检查')}</span></div><Button variant="secondary" size="small" disabled={locked} loading={action==='scan'} leftIcon={<Refresh aria-hidden size={15}/>} onClick={()=>void check()}>{t(scan?'重新检查':'检查残留')}</Button></div>
  {error&&<p role="alert" className="cleanup-feedback error">{t(error)}</p>}
  {scan&&<>
   {scan.warnings.length>0&&<details className="claude-residue-warnings"><summary>{t('{v0} 条扫描提示',{v0:scan.warnings.length})}</summary><ul>{scan.warnings.map((warning,i)=><li key={i}>{t(warning)}</li>)}</ul></details>}
   {items.length===0?<div className="claude-residue-empty" role="status">{t(scan.warnings.length?'部分路径未能检查，请查看扫描提示。':'未发现白名单内的可清理文件。')}</div>:<>
    <div className="claude-residue-toolbar"><Checkbox label={t('全选可清理项')} checked={available.length>0&&available.every(item=>ids.includes(item.id))} indeterminate={ids.length>0&&!available.every(item=>ids.includes(item.id))} disabled={locked||available.length===0} onCheckedChange={checked=>setIds(checked?available.map(item=>item.id):[])}/><span>{t('已选 {v0} 项',{v0:selected.length})}</span></div>
    <ul className="claude-residue-list">{items.map(item=><li key={item.id} className={`claude-residue-row${!item.exact?' unavailable':''}`}>
     <Checkbox aria-label={`${t(item.title)} · ${item.path}`} checked={ids.includes(item.id)} disabled={locked||!item.exact} onCheckedChange={checked=>setIds(old=>checked?[...old,item.id]:deselectItems(items,old,[item.id]))}/>
     <div className="claude-residue-file"><div className="claude-residue-file-title"><strong>{t(item.title)}</strong><span className={`claude-residue-risk ${item.risk}`}>{t(item.exact?riskLabels[item.risk]||item.risk:'统计不完整')}</span></div><code>{item.path}</code>{item.keys.length>0&&<span className="claude-residue-fields">{t('仅移除字段')} <code>{item.keys.join(', ')}</code></span>}<span className="claude-residue-impact">{t(item.impact)}</span></div>
     <div className="claude-residue-size">{item.exact?<><strong>{formatBytes(item.bytes)}</strong><span>{t('{v0} 个文件',{v0:item.files})}</span></>:<span>—</span>}</div>
    </li>)}</ul>
    <div className="claude-residue-footer"><span>{t('个人设置、Skills、暂存身份和浏览器资料保留；不访问钥匙串。')}</span><Button variant="ink" size="small" disabled={locked||!selected.length} onClick={()=>{setAccepted(false);setReview(true);}}>{t('清理所选')}</Button></div>
   </>}
  </>}
  <AppDialog alert className="identity-delete-alert" open={review} onOpenChange={open=>{if(!action)setReview(open);}} title={t('清理所选文件')} description={t('将结束 Claude 进程，直接删除所选文件或列出的配置字段，不创建备份。')} footer={<><Button variant="secondary" data-dialog-cancel onClick={()=>setReview(false)}>{t('取消')}</Button><Button variant="ink" className="identity-delete-button" disabled={!accepted||!!action||!selected.length} onClick={()=>void clean()}>{t('确认清理')}</Button></>}>
   <div className="identity-confirm"><div className="identity-delete-warning"><span aria-hidden="true">!</span><strong>{t('警告：此操作不可撤销，不会创建新备份。')}</strong></div>
    <div className="identity-confirm-keep"><span>{t('删除范围')}</span><strong>{t('{v0} 项 · {v1}',{v0:selected.length,v1:formatBytes(bytes(selected))})}</strong></div>
    <ul className="claude-residue-review">{selected.map(item=><li key={item.id}><strong>{t(item.title)}</strong><code>{item.path}</code>{item.keys.length>0&&<span>{t('仅移除字段')} <code>{item.keys.join(', ')}</code></span>}</li>)}</ul>
    {selected.some(item=>item.risk==='login')&&<p>{t('所选登录数据会被移除，需要重新登录。')}</p>}
    {selected.some(item=>item.risk==='history'||item.risk==='backup')&&<p>{t('所选历史或备份将永久删除。')}</p>}
    <Checkbox label={t('我知道此操作无法撤销')} checked={accepted} onCheckedChange={setAccepted}/>
   </div>
  </AppDialog>
 </section>;
}
