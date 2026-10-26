/**
 * [INPUT]: 宿主上下文、共用有效时区/语言、版本化浏览器观测与回报状态。
 * [OUTPUT]: 固定指标目录中的通过/失败/未知检查；缺失或旧版报告不能通过。
 * [POS]: 起始页纯核验模型，与 DOM/网络分离；结果只描述已完成的有限测量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {classifyExitIsp, effectiveBrowserTarget, matchesDevice, type BrowserContext, type Report} from './browser-model';
export type VerificationPhase='checking'|'failed'|'passed';
export type VerificationCheck={id:string;label:string;actual:string;expected:string;ok:boolean|null;applicable:boolean};
export const REPORT_SCHEMA_VERSION = 1;
export const REQUIRED_CHECK_IDS = [
 'exit.country','exit.provider','page.timezone','exit.timezone','machine.timezone','page.language',
 'page.languages','machine.language','machine.locale','device.platform','device.cores','browser.version',
 'page.geolocation','machine.location','probe.webrtc','probe.webdriver','probe.graphics','probe.tz-offset',
 'probe.canvas-audio','probe.client-hints',
] as const;
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
  const add=(id:string,label:string,actual:string|number|undefined|null,expected:string|number|undefined|null,ok:boolean|null,applicable=true)=>checks.push({id,label,actual:actual==null||actual===''?'尚未核验':String(actual),expected:expected==null||expected===''?'尚未核验':String(expected),ok:applicable?ok:null,applicable});
  const current=report.schema_version===REPORT_SCHEMA_VERSION;
  const observed=(value:boolean|undefined|null):boolean|null=>current&&(value===true||value===false)?value:null;
  if(!exit)problems.push('无法验证网络出口，请检查连接后重测。');
  add('exit.country','出口国家',exit?.country,region?.country,region&&exit?exit.country===region.country:null);
  const ispKind=classifyExitIsp(exit);
  add('exit.provider','出口 IP 属性',ispKind==='hosting'?'已识别机房特征':ispKind==='isp'?'运营商标记为非机房':'运营商未知', '机房特征识别结果', ispKind==='hosting'?false:ispKind==='isp'?true:null);
  add('page.timezone','网页时区',report.timezone,target.timezone,!!report.timezone&&report.timezone===target.timezone);
  add('exit.timezone','出口时区',exit?.timezone,report.timezone,!!exit?.timezone&&exit.timezone===report.timezone);
  add('machine.timezone','本机时区',machine.timezone,report.timezone,!!machine.timezone&&machine.timezone===report.timezone);
  add('page.language','网页语言',report.language,language,language&&report.language?report.language===language:null);
  const targetIsZh=language.toLowerCase().startsWith('zh');
  const leakedZh=!targetIsZh&&report.languages.some(item=>item.toLowerCase().startsWith('zh'));
  add('page.languages','语言列表纯净度',report.languages.join(', '),targetIsZh?`${language} 序列`:`仅 ${language} 系`,report.languages.length>0&&!leakedZh&&report.languages[0]===language);
  add('machine.language','本机首选语言',first,language,first&&language?first===language||first.startsWith(language+'-')||(config.follow_machine&&first==='en'&&language==='en-US'):null);
  add('machine.locale','本机区域',machine.locale,region?.country,region&&machine.locale_country?machine.locale_country===region.country:null);
  add('device.platform','设备平台 / 版本',`${report.platform} / ${report.platform_version||'—'}`,`${machine.platform} / ${machine.version}`,matchesDevice({...machine,cores:report.cores},report));
  add('device.cores','逻辑 CPU',report.cores,machine.cores,report.cores>0&&report.cores===machine.cores);
  add('browser.version','浏览器实际版本',report.browser_version,context.engine_version,!!report.browser_version&&report.browser_version===context.engine_version);
  add('page.geolocation','网页定位权限',report.geolocation,'denied',report.geolocation==='denied');
  add('machine.location','本机定位',machine.location_enabled==null?'尚未核验':machine.location_enabled?'开启':'关闭','关闭',machine.location_enabled==null?null:machine.location_enabled===false);
  add('probe.webrtc','WebRTC 本地候选',current?report.webrtc_detail:undefined,'无非本地候选',observed(report.webrtc_ok));
  add('probe.webdriver','自动化接口状态',report.webdriver?'navigator.webdriver = true':report.webdriver===false?'navigator.webdriver = false':undefined,'navigator.webdriver = false',current&&report.webdriver!==undefined?report.webdriver===false:null);
  add('probe.graphics','图形接口状态',report.webgl_renderer, 'WebGL 可读取且非已知软件渲染',observed(report.graphics_ok));
  add('probe.tz-offset','时区偏移读取',current?report.tz_offset_detail:undefined,'可比较的偏移值',observed(report.tz_offset_ok));
  add('probe.canvas-audio','Canvas / 音频接口能力',current?report.media_fingerprint_detail:undefined,'Canvas 绘制与音频接口能力',observed(report.media_fingerprint_ok));
  add('probe.client-hints','客户端提示与屏幕',current?report.client_hints_detail:undefined,'桌面端 UA-CH 与有效屏幕信息',observed(report.client_hints_ok));
  if(!current)problems.push('检测报告版本过旧或无法识别，请重新实测。');
 }
 const complete=checks.length===REQUIRED_CHECK_IDS.length&&REQUIRED_CHECK_IDS.every(id=>checks.some(check=>check.id===id&&check.applicable&&check.ok!==null));
 const phase:VerificationPhase=busy?'checking':!problems.length&&complete&&checks.every(check=>check.ok===true)?'passed':'failed';
 return {phase,checks,problems:[...new Set(problems)],failures:checks.filter(check=>check.ok!==true)};
}
