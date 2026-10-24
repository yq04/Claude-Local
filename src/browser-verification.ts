/**
 * [INPUT]: 宿主上下文、共用有效时区/语言、真实浏览器观测、回传/连接状态与检测阶段。
 * [OUTPUT]: 每项的实际值、目标值、明确失败原因和红/黄/绿状态；涵盖出口国家/ISP 纯净度、时区、语言列表纯净度、硬件渲染、WebRTC 防泄漏与反自动化特征。
 * [POS]: 起始页的纯核验模型，与 DOM/网络分离，沿用宿主的时区、语言及设备规则。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {classifyExitIsp, effectiveBrowserTarget, matchesDevice, type BrowserContext, type Report} from './browser-model';
export type VerificationPhase='checking'|'failed'|'passed';
export type VerificationCheck={label:string;actual:string;expected:string;ok:boolean|null};
export const REPORT_MAX_AGE_MS = 10 * 60 * 1000;
export function verifyBrowser(context:BrowserContext|null,report:Report|null,linked:boolean,error:string,busy:boolean,reportedAt?:number|null) {
 const checks:VerificationCheck[]=[];
 const problems:string[]=[];
 if(error)problems.push(error);
 if(report?.error)problems.push(report.error);
 if(!linked&&!busy)problems.push('与 Claude-Local的连接已断开，请在清理器内重新打开实测页。');
 if(!context?.region&&!busy)problems.push('请先在主应用选择目标地区。');
 if(!report&&!busy&&!error)problems.push('尚未取得完整检测结果。');
 if(reportedAt && (Date.now() - reportedAt > REPORT_MAX_AGE_MS)) problems.push('检测结果已超过 10 分钟（已过时），请点击「重新实测」更新。');
 if(context&&report){
  const {machine,region,config}=context, exit=report.exit;
  const target=effectiveBrowserTarget(context);
  const first=machine.languages[0]||'';
  const language=target.language;
  const add=(label:string,actual:string|number|undefined|null,expected:string|number|undefined|null,ok:boolean|null)=>checks.push({label,actual:actual==null||actual===''?'尚未核验':String(actual),expected:expected==null||expected===''?'尚未核验':String(expected),ok});
  if(!exit)problems.push('无法验证网络出口，请检查连接后重测。');
  add('出口国家',exit?.country,region?.country,region&&exit?exit.country===region.country:null);
  const ispKind=classifyExitIsp(exit);
  if(ispKind!=='unknown'){
   const ispSummary=[exit?.asn,exit?.isp].filter(Boolean).join(' · ');
   add('出口 IP 属性',ispKind==='hosting'?`IDC 机房 (${ispSummary||'高风控'})`:`ISP 原生特征 (${ispSummary||'正常'})`,'ISP 原生特征 / 非高危机房',ispKind==='isp');
  }
  add('网页时区',report.timezone,target.timezone,!!report.timezone&&report.timezone===target.timezone);
  add('出口时区',exit?.timezone,report.timezone,!!exit?.timezone&&exit.timezone===report.timezone);
  add('本机时区',machine.timezone,report.timezone,!!machine.timezone&&machine.timezone===report.timezone);
  add('网页语言',report.language,language,language&&report.language?report.language===language:null);
  if(Array.isArray(report.languages)&&report.languages.length>1&&language){
   const targetIsZh=language.toLowerCase().startsWith('zh');
   const leakedZh=!targetIsZh&&report.languages.some(item=>item.toLowerCase().startsWith('zh'));
   add('语言列表纯净度',report.languages.join(', '),targetIsZh?`${language} 序列`:`仅 ${language} 系（无中文残留）`,!leakedZh&&report.languages[0]===language);
  }
  add('本机首选语言',first,language,first&&language?first===language||first.startsWith(language+'-')||(config.follow_machine&&first==='en'&&language==='en-US'):null);
  add('本机区域',machine.locale,region?.country,region&&machine.locale_country?machine.locale_country===region.country:null);
  add('设备平台 / 版本',`${report.platform} / ${report.platform_version||'—'}`,`${machine.platform} / ${machine.version}`,matchesDevice({...machine,cores:report.cores},report));
  add('逻辑 CPU',report.cores,machine.cores,report.cores>0&&report.cores===machine.cores);
  add('浏览器实际版本',report.browser_version,context.engine_version,!!report.browser_version&&report.browser_version===context.engine_version);
  add('网页定位权限',report.geolocation,'denied',report.geolocation==='denied');
  add('本机定位',machine.location_enabled==null?'尚未核验':machine.location_enabled?'开启':'关闭','关闭',machine.location_enabled==null?null:machine.location_enabled===false);
  if(report.webrtc_ok!==undefined){
   add('WebRTC 泄漏防护',report.webrtc_detail||(report.webrtc_ok?'无公网/内网 IP 泄漏':'检出候选 IP 泄漏'),'无公网/内网 IP 泄漏',report.webrtc_ok);
  }
  if(report.webdriver!==undefined){
   add('反自动化特征',report.webdriver?'navigator.webdriver = true':'navigator.webdriver = false','navigator.webdriver = false',report.webdriver===false);
  }
  if(report.graphics_ok!==undefined){
   add('硬件图形渲染',report.webgl_renderer||(report.graphics_ok?'真实硬件 GPU':'软件渲染 / 缺失'),'真实硬件 WebGL / Canvas',report.graphics_ok);
  }
 }
 const phase:VerificationPhase=busy?'checking':!problems.length&&checks.length>0&&checks.every(check=>check.ok)?'passed':'failed';
 return {phase,checks,problems:[...new Set(problems)],failures:checks.filter(check=>!check.ok)};
}
