/**
 * [INPUT]: Tauri 官方 mockIPC、真实身份/浏览器组件与虚构的内存状态。
 * [OUTPUT]: 显式开启的原生调度快照mock、40 个虚构身份、可控在线结果、养号/浏览器选择与运行窗口、IP一致性预检与断路器mock及冻结延迟响应；可切至真实BrowserPanel验证返回CLI时草稿同步，无生产路由。
 * [POS]: 独立测试入口；保留browser结果来源与一次CLI恢复许可，无原生命令/真实目录/账号/网络，生产包不含此入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {createRoot} from 'react-dom/client';
import {mockIPC} from '@tauri-apps/api/mocks';
import {MotionRoot,TooltipProvider} from 'cromma-ui';
import {IdentityPanel} from '../src/identities';
import {initializeNativeWakeupBridge, DEFAULT_AUTO_WAKEUP_CONFIG, type NativeWakeupSnapshot} from '../src/identity-online-quota';
import {BrowserPanel} from '../src/browser';
import type {BrowserIdentity,BrowserState} from '../src/browser-model';
import {defaultPolicy,type IdentityState} from '../src/identity-model';
import type {Scan,CleanResult} from '../src/cleaner-model';
import type {Progress} from '../src/cleaner-activity';
import {setLocale} from '../src/i18n';
import '../src/index.css';
import '../src/style.css';
const id=(number:number)=>number.toString(16).padStart(32,'0');
const fingerprint=(number:number)=>number.toString(16).padStart(64,'0');
const user={present:true,display_name:'Fixture user',email:'fixture@example.invalid',organization:'Fixture team',plan:'Pro',auth_status:'valid',proxy:null,quota_5h_used:35,quota_7d_used:40,unavailable:false,quota_identity:fingerprint(1)};
const summaries=Object.fromEntries(Array.from({length:40},(_,n)=>[id(n+1),{display_name:`Identity ${n+1}`,email:`user${n+1}@example.invalid`,organization:`Org ${n+1}`,plan:n%2===0?'Max 20x':'Pro',auth_status:'valid',proxy:null,quota_5h_used:20,quota_7d_used:30,quota_identity:fingerprint(n+1)}]));
const state:IdentityState={browser:{enabled:true,bound_ids:[]},browser_warning:null,active:id(1),recovery:null,running:true,sessions:[{pid:4201,workspace:'Claude-Local',entrypoint:'VS Code'}],current:{...user},summaries,records:Array.from({length:40},(_,n)=>({id:id(n+1),name:`Identity ${n+1}`,saved_at:1780000000000+n,bytes:2048,policy:{...defaultPolicy}})),warming_cards:[],active_browser_slot:"default"};
const browserMode=new URLSearchParams(location.search).get('panel')==='browser';
const browserState:BrowserState={ui_language:'zh',exit_services:[],region:null,config:{seed:123,proxy:'',follow_machine:true,language:'en-US',timezone:'America/New_York',native_graphics:true},machine:{platform:'macos',version:'fixture',cores:8,timezone:'America/New_York',languages:['en-US'],locale:'en_US',locale_country:'US',location_enabled:false,timezones:['America/New_York']},engine_version:'fixture',engine_ready:true,running:false,profile:'/fixture/profiles/current',identity_linked:true,cache:[],cache_error:'',report:null,report_received_at:null,machine_exit:null,checks:[]};
const cliBrowserConfig={...browserState.config};
const runtime:{slot:string;running:boolean|null;window_open:boolean|null}={slot:'default',running:false,window_open:false};
const cliSlot='cli-fixture-1';
const cliIdentity=():BrowserIdentity=>({linked:true,status:'linked',name:state.current.display_name,email:state.current.email,organization:state.current.organization});
function browserSnapshot(){
 const selected=state.warming_cards?.find(card=>card.slot===state.active_browser_slot);
 return {...structuredClone(browserState),active_browser_slot:state.active_browser_slot,identity:selected?{linked:true,status:'warming',name:selected.name,email:selected.email,organization:null}:cliIdentity(),cli_identity:cliIdentity(),cli_expected_identity:state.current.quota_identity??null};
}
function selectBrowser(slot:string,open:boolean){
 state.active_browser_slot=slot;
 for(const card of state.warming_cards||[])card.browser_active=card.slot===slot;
 Object.assign(runtime,{slot,running:open,window_open:open});
 browserState.running=open;
 if(slot===cliSlot)browserState.config={...cliBrowserConfig};
 else browserState.config.seed=state.warming_cards?.find(card=>card.slot===slot)?.seed??123;
}
const commands:{command:string;args:any}[]=[];
let fail='';
let identityReads=0;
let identityReadAttempts=0;
let identityReadFailures=0;
let quotaRevisionReads=0;
const residue={scans:0,cleanMode:'success',remaining:['fixture-cache','fixture-history','fixture-account','fixture-incomplete']};
const residueItems:Scan['items']=[
 {id:'fixture-cache',path:'/fixture/Claude/Cache',title:'虚构缓存',group:'cache',risk:'safe',impact:'可再生成',bytes:4096,files:2,exact:true,keys:[]},
 {id:'fixture-history',path:'/fixture/.claude/history.jsonl',title:'虚构会话历史',group:'history',risk:'history',impact:'包含历史',bytes:2048,files:1,exact:true,keys:[]},
 {id:'fixture-account',path:'/fixture/.claude.json',title:'虚构登录标识',group:'account',risk:'login',impact:'需重新登录',bytes:128,files:1,exact:true,keys:['oauthAccount','userID']},
 {id:'fixture-incomplete',path:'/fixture/Claude/UnreadableCache',title:'虚构不可完整统计缓存',group:'cache',risk:'safe',impact:'目录统计不完整，拒绝直接清理',bytes:0,files:0,exact:false,keys:[]},
];
type Pending={command:string;args:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void;index:number;runtimeSnapshot?:typeof runtime};
const deferred=new Set<string>(),pending:Pending[]=[];
if((window as any).__deferInitialQuotaRevision)deferred.add('identities_quota_revision');
let batchState:any=null;
let wakeupNative:NativeWakeupSnapshot={schema:1,migrated:false,config:{...DEFAULT_AUTO_WAKEUP_CONFIG},targets:[],lastGlobalWakeupAtMs:0,nextGlobalAtMs:0,accounts:{},status:'disabled',runtime:'unknown'};
const nativeWakeupMode=Boolean((window as any).__enableNativeWakeupTest);

const eventListeners=new Map<number,{event:string;handler:number}>();let nextEventId=1;
function emitFixtureEvent(event:string,payload:unknown){for(const [id,listener] of eventListeners){if(listener.event===event)(window as any).__TAURI_INTERNALS__.runCallback(listener.handler,{event,id,payload});}}
const fixture={commands,state,residue,browser:browserState,runtime,browserBusy:false,quotaRevision:1,onlineResultsById:{} as Record<string,any>,onlineResult:{status:'updated',updated_windows:['5h','7d'],verified_at_ms:Date.now(),retry_at_ms:0},root:null as any,get identityReads(){return identityReads;},get identityReadAttempts(){return identityReadAttempts;},get identityReadFailures(){return identityReadFailures;},get quotaRevisionReads(){return quotaRevisionReads;},get pending(){return pending.map(row=>row.command);},language:setLocale,setFailure:(command:string)=>{fail=command;},recover:()=>{state.recovery=id(1);},
 setRuntime:(patch:Partial<typeof runtime>)=>{Object.assign(runtime,patch);browserState.running=runtime.running===true;},
 updatePassiveQuota:(used:number)=>{Object.assign(state.current,{quota_5h_used:used,quota_5h_source:'server_anchor',quota_5h_observed_at_ms:Date.now()});fixture.quotaRevision++;},
 emitEvent:emitFixtureEvent,
 get wakeup(){return structuredClone(wakeupNative);},
 publishWakeup:(patch:Partial<NativeWakeupSnapshot>)=>{wakeupNative={...wakeupNative,...patch};emitFixtureEvent('wakeup-scheduler-state',structuredClone(wakeupNative));},
 showOtherPage:()=>{fixture.root.render(<div data-testid="other-page">Other page</div>);},
 showBrowserPanel:()=>{fixture.root.render(<MotionRoot><TooltipProvider><div style={{width:740,height:752,margin:'20px auto',border:'1px solid #ddd'}}><BrowserPanel onBusy={value=>{fixture.browserBusy=value;}}/></div></TooltipProvider></MotionRoot>);},
 get batch(){return batchState?structuredClone(batchState):null;},
 remountIdentity:()=>{
  const host=document.getElementById('fixture')!;fixture.root.unmount();fixture.root=createRoot(host);
  fixture.root.render(<MotionRoot><TooltipProvider><div style={{width:740,height:752,margin:'20px auto',border:'1px solid #ddd'}}><IdentityPanel/></div></TooltipProvider></MotionRoot>);
 },
 publishBatchProgress:(accountId:string)=>{
  const batch=pending.find(row=>row.command==='identities_refresh_all_quotas');if(!batch)throw Error('No pending fictional batch');
  if(batchState?.request_id!==batch.args.requestId||batchState.state==='cancelled')return;
  const target=batch.args.targets.find((row:any)=>row.account_id===accountId);if(!target)throw Error('Unknown fictional batch target');
  const result=execute('identities_refresh_quota',{accountId,expectedIdentity:target.expected_identity});
  if(!batchState.results.some((row:any)=>row.account_id===accountId))batchState.results.push({...target,result});
  batchState.completed=batchState.results.length;batchState.state='running';
  emitFixtureEvent('quota-batch-progress',{request_id:batch.args.requestId,...target,result,completed:1,total:batch.args.targets.length});
 },
 defer:(...names:string[])=>{for(const name of names)deferred.add(name);},
 emitProgress:(command:string,event:Progress)=>{
  const entry=pending.find(row=>row.command===command);if(!entry)throw Error(`No pending command: ${command}`);
  const channel=entry.args.onProgress;
  const callback=typeof channel==='string'?Number(channel.replace('__CHANNEL__:','')):channel?.id;
  if(typeof callback!=='number')throw Error(`No progress channel: ${command}`);
  // ----- mockIPC 保留 Channel 对象；用官方回调分发器模拟 Rust 的有序消息包 -----
  (window as any).__TAURI_INTERNALS__.runCallback(callback,{index:entry.index++,message:event});
 },
 release:(command:string,error?:string)=>{
  const at=pending.findIndex(row=>row.command===command);if(at<0)throw Error(`No pending command: ${command}`);
  const [entry]=pending.splice(at,1);
  if(error){entry.reject(Error(error));return;}
  try{entry.resolve(entry.runtimeSnapshot??execute(command,entry.args));}catch(error){entry.reject(error as Error);}
 },
 cancelBatch:()=>{
  if(!batchState)return null;
  if(batchState.state==='queued'||batchState.state==='running'){
   const completeIds=new Set(batchState.results.map((row:any)=>row.account_id));
   for(const target of batchState.targets){if(!completeIds.has(target.account_id))batchState.results.push({...target,result:{status:'not_run'}});}
   batchState.state='cancelled';batchState.completed=batchState.results.filter((row:any)=>row.result.status!=='not_run').length;
  }
  return structuredClone(batchState);
 },
};
Object.assign(window,{identityFixture:fixture});
mockIPC((command,args:any)=>{
 if(!['identities_read','identities_quota_revision','claude_cli_read','monitor_window_state','browser_kill_switch_state'].includes(command))commands.push({command,args});
 if(command==='identities_refresh_all_quotas')batchState={request_id:args.requestId,results:[],completed:0,total:args.targets.length,state:'running',targets:structuredClone(args.targets),started_at_ms:Date.now(),deadline_at_ms:Date.now()+120000};
 if(deferred.delete(command))return new Promise((resolve,reject)=>pending.push({command,args,resolve,reject,index:0,...(command==='browser_runtime_read'?{runtimeSnapshot:structuredClone(runtime)}:{})}));
 return execute(command,args);
});
function execute(command:string,args:any){
 if(command==='identities_read')identityReadAttempts++;
 if(command==='monitor_window_state')return {open:false,always_on_top:true,compact:false};
 if(command==='monitor_window_set_open')return {open:Boolean(args?.open),always_on_top:true,compact:false};
 if(command==='quota_setup_status')return {state:'not_configured',collector_bundled:false,has_statusline:false};
  if(command==='ui_privacy_read')return (window as any).__privacyPreference ?? null;
 if(command==='ui_privacy_write'){(window as any).__privacyPreference=args.masked;return;}
 if(command==='plugin:event|listen'){const id=nextEventId++;eventListeners.set(id,{event:args.event,handler:args.handler});return id;}
 if(command==='plugin:event|unlisten'){eventListeners.delete(args.eventId);return;}
 if(fail===command){fail='';if(command==='identities_read')identityReadFailures++;throw Error('fixture operation failed');}
 if(command==='browser_read')return browserSnapshot();
 if(command==='browser_runtime_read')return structuredClone(runtime);
 if(command==='browser_kill_switch_state')return {enabled:true,triggered:false,reason_code:null,expected_country:null,observed_country:null,triggered_at:null,closed_slots:[]};
 if(command==='browser_kill_switch_dismiss')return {enabled:true,triggered:false,reason_code:null,expected_country:null,observed_country:null,triggered_at:null,closed_slots:[]};
 if(command==='browser_kill_switch_set_enabled')return {enabled:Boolean(args?.enabled),triggered:false,reason_code:null,expected_country:null,observed_country:null,triggered_at:null,closed_slots:[]};
 if(browserMode&&command==='browser_default_read')return {is_default:true,http:'fixture',https:'fixture',installed:true,app:'Claude-Local Browser'};
 if(browserMode&&command==='browser_clear'){browserState.cache=[];return structuredClone(browserState);}
 if(command==='identities_browser'){state.browser.enabled=args.enabled;if(args.enabled&&!state.browser.bound_ids.includes(state.active))state.browser.bound_ids.push(state.active);return structuredClone(state);}
 if(command==='browser_open_usage'||command==='browser_return_to_cli'){
  if(!args.expectedIdentity||args.expectedIdentity!==state.current.quota_identity)throw 'quotaOnline.accountMismatch';
  if(command==='browser_return_to_cli')selectBrowser(cliSlot,true);
  return browserSnapshot();
 }
 if(command==='browser_open_identity_profile')return;
 if(command==='browser_launch'){state.browser_warning=null;selectBrowser(state.active_browser_slot||'default',true);return browserSnapshot();}
 if(command==='identities_read'){identityReads++;return structuredClone(state);}
 if(command==='identities_quota_revision'){quotaRevisionReads++;return String(fixture.quotaRevision);}
 if(command==='identities_quota_batch_state')return args.requestId===null?structuredClone(batchState):batchState?.request_id===args.requestId?structuredClone(batchState):null;
 if(command==='identities_cancel_quota_batch')return fixture.cancelBatch();
 if(command==='identities_refresh_all_quotas'){
  if(batchState?.request_id===args.requestId&&batchState.state==='cancelled')return structuredClone(batchState);
  const results=args.targets.map((target:any,index:number)=>{
   const result=execute('identities_refresh_quota',{accountId:target.account_id,expectedIdentity:target.expected_identity});
   emitFixtureEvent('quota-batch-progress',{request_id:args.requestId,...target,result,completed:index+1,total:args.targets.length});
   return {...target,result};
  });
  batchState={...batchState,results,completed:results.length,total:results.length,state:'completed'};
  return structuredClone(batchState);
 }
 if(command==='identities_refresh_quota'){
  const summary=args.accountId==='current'?state.current:state.summaries[args.accountId];
  if(!summary||!args.expectedIdentity||summary.quota_identity!==args.expectedIdentity)return {status:'account_mismatch'};
  const result=fixture.onlineResultsById[args.accountId]??fixture.onlineResult;
  if(result.status==='updated'){
   Object.assign(summary,{quota_5h_used:25,quota_5h_reset_at:Math.floor(Date.now()/1000)+7200,quota_5h_source:'server_anchor',quota_5h_observed_at_ms:Date.now(),quota_7d_used:45,quota_7d_reset_at:Math.floor(Date.now()/1000)+86400,quota_7d_source:'server_anchor',quota_7d_observed_at_ms:Date.now()});
  }
  return {...result,source:result.source??'oauth',observed_at_ms:result.status==='updated'?Date.now():undefined,retry_at_ms:result.retry_at_ms||Date.now()+60000};
 }
 if(command==='identities_wakeup_state')return structuredClone(wakeupNative);
 if(command==='identities_wakeup_configure'||command==='identities_wakeup_migrate'){
  wakeupNative.config=structuredClone(command==='identities_wakeup_migrate'?args.migration.config:args.config);
  wakeupNative.migrated=true;wakeupNative.runtime='available';wakeupNative.status=wakeupNative.config.enabled?'waiting':'disabled';
  emitFixtureEvent('wakeup-scheduler-state',structuredClone(wakeupNative));return structuredClone(wakeupNative);
 }
 if(command==='identities_wakeup_resume'){
  const account=wakeupNative.accounts[args.expectedIdentity];if(account?.unknown)throw 'wakeup.outcomeUnknown';
  if(account){account.recoveryAllowed=true;if(account.authBlocked&&account.lastStatus==='auth_required')account.backoffUntilMs=null;}emitFixtureEvent('wakeup-scheduler-state',structuredClone(wakeupNative));return structuredClone(wakeupNative);
 }
 if(command==='identities_wakeup_quota_window'){
  const summary=args.accountId==='current'?state.current:state.summaries[args.accountId];
  if(!summary||!args.expectedIdentity||summary.quota_identity!==args.expectedIdentity)return {status:'account_mismatch'};
  const result=fixture.onlineResultsById[args.accountId]??fixture.onlineResult;
  if(nativeWakeupMode&&result.stage!=='scheduler'){
   const account=wakeupNative.accounts[args.expectedIdentity];
   if(account){account.recoveryAllowed=false;account.lastStatus=result.status;if(result.status==='auth_required'){account.authBlocked=true;account.decision='auth_blocked';}}
   emitFixtureEvent('wakeup-scheduler-state',structuredClone(wakeupNative));
  }
  if(result.status==='updated'){
   Object.assign(summary,{quota_5h_used:1,quota_5h_reset_at:Math.floor(Date.now()/1000)+18000,quota_5h_source:'server_anchor',quota_5h_observed_at_ms:Date.now(),quota_7d_used:Math.min(100,Math.max(1,summary.quota_7d_used??10)),quota_7d_reset_at:Math.floor(Date.now()/1000)+604800,quota_7d_source:'server_anchor',quota_7d_observed_at_ms:Date.now()});
   fixture.quotaRevision++;
  }
  return {...result,source:'wakeup_messages',observed_at_ms:result.status==='updated'?Date.now():undefined,wakeup_effect:result.status==='updated'?'new_5h_confirmed':result.wakeup_effect,wakeup_5h_reset_at:result.status==='updated'?summary.quota_5h_reset_at:result.wakeup_5h_reset_at,retry_at_ms:result.retry_at_ms||Date.now()+60000};
 }
 if(command==='identities_sync_subscription'){
  if(!args.expectedIdentity||state.current.quota_identity!==args.expectedIdentity)throw 'quotaOnline.accountMismatch';
  Object.assign(state.current,{billing_date_kind:'next_renewal',billing_date:Math.floor(Date.now()/1000)+86400*20,billing_observed_at_ms:Date.now(),manual_resets_remaining:0,manual_resets_observed_at_ms:Date.now(),subscription_date_source:'browser',subscription_expiry_ymd:null,subscription_recharge_ymd:null});
  return;
 }
 if(command==='identities_set_subscription_expiry'){
  const target=args.accountId==='current'?state.current:(state.summaries[args.accountId]||state.warming_cards?.find((c:any)=>c.id===args.accountId));
  if(!target)throw '身份不存在。';
  if(args.expectedIdentity&&target.quota_identity!==args.expectedIdentity)throw 'quotaOnline.accountMismatch';
  if(!args.expiryYmd&&!args.rechargeYmd){
   Object.assign(target,{billing_date:null,billing_date_kind:null,billing_observed_at_ms:null,subscription_expiry_ymd:null,subscription_recharge_ymd:null,subscription_date_source:null,subscription_expires_at:null});
  }else{
   const exp=args.expiryYmd||args.rechargeYmd;
   const [yy,mm,dd]=String(exp).split('-').map(Number);
   const sec=Math.floor(Date.UTC(yy,mm-1,dd,12,0,0)/1000);
   Object.assign(target,{billing_date:sec,billing_date_kind:'next_renewal',billing_observed_at_ms:Date.now(),subscription_expiry_ymd:exp,subscription_recharge_ymd:args.rechargeYmd||null,subscription_date_source:'manual',subscription_expires_at:sec});
  }
  fixture.quotaRevision++;
  return structuredClone(state);
 }
 if(command==='claude_residue_scan'){
  residue.scans++;
  return {folder:'/fixture',items:structuredClone(residueItems.filter(row=>residue.remaining.includes(row.id))),running:state.running,processes:state.running?[{pid:100,name:'Claude fixture'}]:[],message:'虚构扫描完成',warnings:['虚构警告：部分目录无法完整统计。'],diagnostics:[],org_id:''} satisfies Scan;
 }
 if(command==='claude_residue_clean'){
  const selected=args.ids as string[];
  if(residue.cleanMode==='partial'){
   residue.remaining=residue.remaining.filter(id=>id!==selected[0]);
   return {cleaned:selected.length?1:0,errors:['fixture cleanup partly failed'],completed:false} satisfies CleanResult;
  }
  residue.remaining=residue.remaining.filter(id=>!selected.includes(id));
  return {cleaned:selected.length,errors:[],completed:true} satisfies CleanResult;
 }
 if(command==='claude_cli_read')return {method:'',path:'',version:''};
 if(command==='identities_stop'){state.running=false;state.sessions=[];return {running:false};}
 if(command==='identities_save'){
  const existing=state.records.find(row=>row.id===state.active);
  if(existing){existing.name=args.currentName;existing.saved_at=1780000010000+commands.length;existing.policy={...args.policy};}
  else {const nextId=id(1000+commands.length);state.records.push({id:nextId,name:args.currentName,saved_at:1780000010000+commands.length,bytes:4096,policy:{...args.policy}});state.active=nextId;state.summaries[nextId]={display_name:args.currentName,email:state.current.email,organization:state.current.organization,plan:state.current.plan,auth_status:state.current.auth_status,proxy:state.current.proxy};}
  if(state.browser.enabled&&!state.browser.bound_ids.includes(state.active))state.browser.bound_ids.push(state.active);
  return structuredClone(state);
 }
 if(command==='identities_switch'){
  if(args.recover){state.recovery=null;state.current={...user};return structuredClone(state);}
  if(state.current.present){const existing=state.records.find(row=>row.id===state.active);if(existing){existing.saved_at=1780000010000+commands.length;existing.policy={...args.policy};}else{const nextId=id(1000+commands.length);state.records.push({id:nextId,name:args.currentName,saved_at:1780000010000+commands.length,bytes:4096,policy:{...args.policy}});state.summaries[nextId]={display_name:args.currentName,email:state.current.email,organization:state.current.organization,plan:state.current.plan,auth_status:state.current.auth_status,proxy:state.current.proxy};}}
  if(state.browser.enabled){if(state.active!=='empty'&&!state.browser.bound_ids.includes(state.active))state.browser.bound_ids.push(state.active);if(args.targetId!=='empty'&&!state.browser.bound_ids.includes(args.targetId))state.browser.bound_ids.push(args.targetId);}
  state.active=args.targetId;
  state.current=args.targetId==='empty'?{present:false,display_name:null,email:null,organization:null,plan:null,auth_status:null,proxy:null,unavailable:false}:{...user,display_name:state.records.find(row=>row.id===args.targetId)!.name};
  return structuredClone(state);
 }
 if(command==='identities_rename'){state.records.find(row=>row.id===args.id)!.name=args.value;return structuredClone(state);}
 if(command==='identities_warming_create'){
  state.warming_cards=state.warming_cards||[];
  const count=state.warming_cards.length+1;
  const cardId=id(2000+count);
  const slot=`warming-${cardId.slice(0,8)}`;
  const seed=1000+count;
  const now=Math.floor(Date.now()/1000);
  const newCard:any={
   id:cardId,
   name:args.name,
   email:args.email||null,
   note:args.note||null,
   stage:args.stage,
   created_ymd:args.createdYmd,
   last_warmed_ymd:(args.openMode==='verify'||args.openMode==='claude_ai')?args.createdYmd:null,
   created_at:now,
   updated_at:now,
   slot,
   seed,
   browser_active:true,
   region_summary:'US · America/New_York',
   has_custom_proxy:false,
   subscription_expiry_ymd:null,
   subscription_recharge_ymd:null,
   subscription_date_source:null,
   subscription_expires_at:null,
  };
  for(const c of state.warming_cards)c.browser_active=false;
  state.warming_cards.push(newCard);
  selectBrowser(slot,args.openMode!=='switch_only');
  return structuredClone(state);
 }
 if(command==='identities_warming_update'){
  const card=state.warming_cards?.find((c:any)=>c.id===args.id);
  if(card){card.name=args.name;card.email=args.email||null;card.note=args.note||null;card.stage=args.stage;card.created_ymd=args.createdYmd;if(args.registeredCountry!==undefined)card.registered_country=args.registeredCountry||null;if(args.registeredTimezone!==undefined)card.registered_timezone=args.registeredTimezone||null;card.updated_at=Math.floor(Date.now()/1000);}
  return structuredClone(state);
 }
 if(command==='identities_warming_probe_check'){const card=state.warming_cards?.find((c:any)=>c.id===args.id);const currentCountry=card?.last_probe_country||'US';if(args.lockCurrent&&card){card.registered_country=currentCountry;return {status:'locked_initial',registered_country:card.registered_country,registered_timezone:card?.registered_timezone||'America/New_York',current_country:currentCountry,current_timezone:'America/New_York',message:null,state:structuredClone(state)};}const mismatch=Boolean(card?.registered_country&&card.registered_country!==currentCountry);return {status:mismatch?'mismatch':'matched',registered_country:card?.registered_country||currentCountry,registered_timezone:card?.registered_timezone||'America/New_York',current_country:currentCountry,current_timezone:'America/New_York',message:null,state:structuredClone(state)};}
 if(command==='identities_warming_open'){
  const card=state.warming_cards?.find((c:any)=>c.id===args.id);
  if(card){
   if(args.openMode==='verify'||args.openMode==='claude_ai'){const [yy,mm,dd]=new Date().toISOString().slice(0,10).split('-');card.last_warmed_ymd=`${yy}-${mm}-${dd}`;}
   selectBrowser(card.slot,args.openMode==='switch_only'?runtime.slot===card.slot&&runtime.window_open===true:true);
  }
  return structuredClone(state);
 }
 if(command==='identities_warming_promote'){
  state.warming_cards=(state.warming_cards||[]).filter((c:any)=>c.id!==args.id);
  state.active='empty';state.current={present:false,display_name:null,email:null,organization:null,plan:null,auth_status:null,proxy:null,unavailable:false} as any;
  return structuredClone(state);
 }
 if(command==='identities_warming_delete'){
  state.warming_cards=(state.warming_cards||[]).filter((c:any)=>c.id!==args.id);
  return structuredClone(state);
 }
 if(command==='identities_delete'){
  if(args.id==='current'){state.current={present:false,display_name:null,email:null,organization:null,plan:null,auth_status:null,proxy:null,unavailable:false};state.active='empty';}
  else{state.records=state.records.filter(row=>row.id!==args.id);delete state.summaries[args.id];}
  return structuredClone(state);
 }
 throw Error(`Unexpected fixture command: ${command}`);
}
fixture.root=createRoot(document.getElementById('fixture')!);
fixture.root.render(<MotionRoot><TooltipProvider><div style={{width:740,height:752,margin:'20px auto',border:'1px solid #ddd'}}>{browserMode?<BrowserPanel onBusy={value=>{fixture.browserBusy=value;}}/>:<IdentityPanel/>}</div></TooltipProvider></MotionRoot>);

if(nativeWakeupMode)void initializeNativeWakeupBridge();
