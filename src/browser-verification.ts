/**
 * [INPUT]: 宿主上下文、共用有效时区/语言、真实浏览器观测、回传/连接状态与检测阶段。
 * [OUTPUT]: 每项的实际值、目标值、明确失败原因和红/黄/绿状态；未知值单项保持待测，语言按有效配置、区域按规范化国家核验。
 * [POS]: 起始页的纯核验模型，与 DOM/网络分离，沿用宿主的时区、语言及设备规则。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {effectiveBrowserTarget, matchesDevice, type BrowserContext, type Report} from './browser-model';
export type VerificationPhase='checking'|'failed'|'passed';
export type VerificationCheck={label:string;actual:string;expected:string;ok:boolean|null};
export function verifyBrowser(context:BrowserContext|null,report:Report|null,linked:boolean,error:string,busy:boolean) {
 const checks:VerificationCheck[]=[];
 const problems:string[]=[];
 if(error)problems.push(error);
 if(report?.error)problems.push(report.error);
 if(!linked&&!busy)problems.push('与 Claude-Local的连接已断开，请在清理器内重新打开实测页。');
 if(!context?.region&&!busy)problems.push('请先在主应用选择目标地区。');
 if(!report&&!busy&&!error)problems.push('尚未取得完整检测结果。');
 if(context&&report){
  const {machine,region,config}=context, exit=report.exit;
  const target=effectiveBrowserTarget(context);
  const first=machine.languages[0]||'';
  const language=target.language;
  const add=(label:string,actual:string|number|undefined|null,expected:string|number|undefined|null,ok:boolean|null)=>checks.push({label,actual:actual==null||actual===''?'尚未核验':String(actual),expected:expected==null||expected===''?'尚未核验':String(expected),ok});
  if(!exit)problems.push('无法验证网络出口，请检查连接后重测。');
  add('出口国家',exit?.country,region?.country,region&&exit?exit.country===region.country:null);
  add('网页时区',report.timezone,target.timezone,!!report.timezone&&report.timezone===target.timezone);
  add('出口时区',exit?.timezone,report.timezone,!!exit?.timezone&&exit.timezone===report.timezone);
  add('本机时区',machine.timezone,report.timezone,!!machine.timezone&&machine.timezone===report.timezone);
  add('网页语言',report.language,language,language&&report.language?report.language===language:null);
  add('本机首选语言',first,language,first&&language?first===language||first.startsWith(language+'-')||(config.follow_machine&&first==='en'&&language==='en-US'):null);
  add('本机区域',machine.locale,region?.country,region&&machine.locale_country?machine.locale_country===region.country:null);
  add('设备平台 / 版本',`${report.platform} / ${report.platform_version||'—'}`,`${machine.platform} / ${machine.version}`,matchesDevice({...machine,cores:report.cores},report));
  add('逻辑 CPU',report.cores,machine.cores,report.cores>0&&report.cores===machine.cores);
  add('浏览器实际版本',report.browser_version,context.engine_version,!!report.browser_version&&report.browser_version===context.engine_version);
  add('网页定位权限',report.geolocation,'denied',report.geolocation==='denied');
  add('本机定位',machine.location_enabled==null?'尚未核验':machine.location_enabled?'开启':'关闭','关闭',machine.location_enabled==null?null:machine.location_enabled===false);
 }
 const phase:VerificationPhase=busy?'checking':!problems.length&&checks.length>0&&checks.every(check=>check.ok)?'passed':'failed';
 return {phase,checks,problems:[...new Set(problems)],failures:checks.filter(check=>!check.ok)};
}
