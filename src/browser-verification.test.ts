/**
 * [INPUT]: 跨平台虚构宿主上下文和网页观测。
 * [OUTPUT]: 红/黄/绿状态、失败原因、断连/未知值、目标时区变化与深度防封指标（IDC 机房识别、语言列表中文残留、WebRTC、webdriver、硬件 WebGL）回归。
 * [POS]: 真实页面与纯核验模型的契约测试，不调用原生权限或外部服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,expect} from 'bun:test';
import {REQUIRED_CHECK_IDS,verifyBrowser} from './browser-verification';
import type {BrowserContext,Report} from './browser-model';
const context:BrowserContext={ui_language:'zh',exit_services:[],region:{id:'us-la',label:'LA',country:'US',language:'en-US',locale:'en_US',timezone:'America/Los_Angeles'},config:{seed:1,proxy:'',follow_machine:false,language:'en-US',timezone:'America/Los_Angeles',native_graphics:true},machine:{platform:'windows',version:'10.0.26100',cores:8,timezone:'America/Los_Angeles',languages:['en-US'],locale:'en_US',locale_country:'US',location_enabled:false,timezones:[]},engine_version:'148.0.7778.215'};
const report:Report={schema_version:1,language:'en-US',languages:['en-US'],timezone:'America/Los_Angeles',platform:'Win32',platform_version:'10.0.26100',cores:8,user_agent:'fixture',browser_version:'148.0.7778.215',geolocation:'denied',exit:{ip:'203.0.113.1',country:'US',city:'LA',timezone:'America/Los_Angeles',isp:'fixture',hosting:false},error:'',webrtc_ok:true,webrtc_detail:'local candidates observed',webdriver:false,graphics_ok:true,webgl_renderer:'WebGL device',tz_offset_ok:true,tz_offset_detail:'offset available',media_fingerprint_ok:true,media_fingerprint_detail:'Canvas + AudioContext capability',client_hints_ok:true,client_hints_detail:'desktop hints'};
test('只有全部实测匹配且回传连接有效时才变绿，重测立即变黄',()=>{
 expect(verifyBrowser(context,report,true,'',false).phase).toBe('passed');
 expect(verifyBrowser(context,report,true,'',true).phase).toBe('checking');
 expect(verifyBrowser(context,report,false,'',false).phase).toBe('failed');
 expect(verifyBrowser(context,report,true,'report failed',false).problems).toContain('report failed');
 expect(verifyBrowser(null,null,false,'',false).phase).toBe('failed');
});
test('所有失败都有具体值或原因，未知出口与定位不能显示成功',()=>{
 const result=verifyBrowser({...context,machine:{...context.machine,location_enabled:null}},{...report,cores:4,exit:null,error:'HTTP 429'},true,'',false);
 expect(result.phase).toBe('failed');expect(result.problems).toContain('HTTP 429');
 expect(result.failures.find(row=>row.label==='逻辑 CPU')).toMatchObject({actual:'4',expected:'8'});
 expect(result.failures.find(row=>row.label==='本机定位')?.actual).toBe('尚未核验');
 expect(verifyBrowser({...context,config:{...context.config,timezone:'America/New_York'}},report,true,'',false).phase).toBe('failed');
 for(const [platform,value] of [['macos','MacIntel'],['linux','Linux x86_64']] as const){
  const ctx={...context,machine:{...context.machine,platform}};
  const observed={...report,platform:value};
  expect(verifyBrowser(ctx,observed,true,'',false).phase).toBe('passed');
 }
});

test('跟随机器按有效区域识别台湾并保留简体偏好，不放过实际冲突',()=>{
 const ctx:BrowserContext={...context,region:{id:'tw',label:'Taipei',country:'TW',language:'zh-Hant',locale:'zh_TW',timezone:'Asia/Taipei'},config:{...context.config,follow_machine:true},machine:{...context.machine,timezone:'Asia/Taipei',languages:['zh-Hans-TW','zh-Hant-TW'],locale:'zh_CN@rg=twzzzz',locale_country:'TW'}};
 const observed:Report={...report,language:'zh-Hans-TW',languages:['zh-Hans-TW','zh'],timezone:'Asia/Taipei',exit:{...report.exit!,country:'TW',timezone:'Asia/Taipei'}};
 expect(verifyBrowser(ctx,observed,true,'',false).phase).toBe('passed');
 const scriptMismatch=verifyBrowser(ctx,{...observed,language:'zh-Hant-TW'},true,'',false);
 expect(scriptMismatch.failures.find(row=>row.label==='网页语言')).toMatchObject({ok:false,expected:'zh-Hans-TW'});
 expect(verifyBrowser(ctx,{...observed,exit:{...observed.exit!,country:'CN'}},true,'',false).failures.find(row=>row.label==='出口国家')?.ok).toBe(false);
 expect(verifyBrowser({...ctx,machine:{...ctx.machine,locale_country:'CN'}},observed,true,'',false).failures.find(row=>row.label==='本机区域')?.ok).toBe(false);
 expect(verifyBrowser({...ctx,machine:{...ctx.machine,location_enabled:true}},observed,true,'',false).failures.find(row=>row.label==='本机定位')?.ok).toBe(false);
});
test('目标未知和未读到有效区域保持待测，不能冒充已知冲突或通过',()=>{
 const result=verifyBrowser({...context,region:null},report,true,'',false);
 expect(result.phase).toBe('failed');
 expect(result.checks.find(row=>row.label==='出口国家')?.ok).toBeNull();
 expect(result.checks.find(row=>row.label==='本机区域')?.ok).toBeNull();
 expect(result.checks.find(row=>row.label==='网页语言')?.ok).toBe(true);
 expect(verifyBrowser({...context,machine:{...context.machine,locale_country:''}},report,true,'',false).checks.find(row=>row.label==='本机区域')?.ok).toBeNull();
});
test('手动预设继续检查所选脚本；跟随机器保留原有 en 到 en-US 归一化',()=>{
 const ctx={...context,config:{...context.config,follow_machine:true},machine:{...context.machine,languages:['en']}};
 expect(verifyBrowser(ctx,report,true,'',false).phase).toBe('passed');
 const manual={...context,config:{...context.config,language:'zh-Hant'},machine:{...context.machine,languages:['zh-Hans-TW']}};
 expect(verifyBrowser(manual,{...report,language:'zh-Hans-TW'},true,'',false).checks.find(row=>row.label==='网页语言')?.ok).toBe(false);
});

test('检测结果超过 10 分钟自动判定过时，要求手动重新检测', () => {
 const fresh = Date.now() - 2 * 60 * 1000;
 expect(verifyBrowser(context, report, true, '', false, fresh).phase).toBe('passed');
 const stale = Date.now() - 11 * 60 * 1000;
 const result = verifyBrowser(context, report, true, '', false, stale);
 expect(result.phase).toBe('failed');
 expect(result.problems.some(p => p.includes('10 分钟'))).toBe(true);
});

test('深度防封核验拦截高危 IDC 机房出口、次选中文残留、WebRTC 泄漏、webdriver 暴露与软件渲染', () => {
 const cleanDeep: Report = {
  schema_version: 1,
  ...report,
  languages: ['en-US', 'en'],
  exit: {...report.exit!, isp: 'Comcast Cable', asn: 'AS7922', hosting: false},
  webrtc_ok: true,
  webdriver: false,
  graphics_ok: true,
  webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11)',
  tz_offset_ok: true,
  tz_offset_detail: 'GMT-7 · Intl 与系统时钟一致',
  media_fingerprint_ok: true,
  media_fingerprint_detail: 'Canvas 2D 正常 · 48000Hz',
  client_hints_ok: true,
  client_hints_detail: '1920×1080 · 24-bit · Desktop',
 };
 expect(verifyBrowser(context, cleanDeep, true, '', false).phase).toBe('passed');
 expect(verifyBrowser(context, cleanDeep, true, '', false).checks.length).toBe(REQUIRED_CHECK_IDS.length);

 const idcReport: Report = {...cleanDeep, exit: {...cleanDeep.exit!, isp: 'Choopa, LLC / Vultr', asn: 'AS20473'}};
 expect(verifyBrowser(context, idcReport, true, '', false).failures.find(row => row.label === '出口 IP 属性')?.ok).toBe(false);

 const zhLeakReport: Report = {...cleanDeep, languages: ['en-US', 'zh-CN']};
 expect(verifyBrowser(context, zhLeakReport, true, '', false).failures.find(row => row.label === '语言列表纯净度')?.ok).toBe(false);

 const webrtcLeakReport: Report = {...cleanDeep, webrtc_ok: false, webrtc_detail: '检出公网候选 IP 198.51.100.8'};
 expect(verifyBrowser(context, webrtcLeakReport, true, '', false).failures.find(row => row.id === 'probe.webrtc')?.ok).toBe(false);

 const webdriverReport: Report = {...cleanDeep, webdriver: true};
 expect(verifyBrowser(context, webdriverReport, true, '', false).failures.find(row => row.id === 'probe.webdriver')?.ok).toBe(false);

 const swiftshaderReport: Report = {...cleanDeep, graphics_ok: false, webgl_renderer: 'Google SwiftShader'};
 expect(verifyBrowser(context, swiftshaderReport, true, '', false).failures.find(row => row.id === 'probe.graphics')?.ok).toBe(false);

 const tzSpoofReport: Report = {...cleanDeep, tz_offset_ok: false, tz_offset_detail: 'GMT-7 vs 本地偏移冲突'};
 expect(verifyBrowser(context, tzSpoofReport, true, '', false).failures.find(row => row.id === 'probe.tz-offset')?.ok).toBe(false);

 const canvasTamperReport: Report = {...cleanDeep, media_fingerprint_ok: false, media_fingerprint_detail: 'Canvas 2D 空白或被阻断'};
 expect(verifyBrowser(context, canvasTamperReport, true, '', false).failures.find(row => row.id === 'probe.canvas-audio')?.ok).toBe(false);

 const clientHintsReport: Report = {...cleanDeep, client_hints_ok: false, client_hints_detail: 'UA-CH 移动设备特征冲突'};
 expect(verifyBrowser(context, clientHintsReport, true, '', false).failures.find(row => row.id === 'probe.client-hints')?.ok).toBe(false);
});

test('fixed required IDs block missing, legacy, and unknown results while full current reports pass',()=>{
 const full=verifyBrowser(context,report,true,'',false);
 expect(full.phase).toBe('passed');
 expect(full.checks).toHaveLength(REQUIRED_CHECK_IDS.length);
 const missing=verifyBrowser(context,{...report,client_hints_ok:undefined,client_hints_detail:undefined},true,'',false);
 expect(missing.phase).toBe('incomplete');
 expect(missing.checks.find(x=>x.id==='probe.client-hints')?.ok).toBeNull();
 const old=verifyBrowser(context,{...report,schema_version:undefined},true,'',false);
 expect(old.phase).toBe('failed');
 expect(old.checks.find(x=>x.id==='probe.webrtc')?.ok).toBeNull();
 const unknownIsp=verifyBrowser(context,{...report,exit:{...report.exit!,hosting:undefined,isp:'Unlisted carrier'}},true,'',false);
 expect(unknownIsp.phase).toBe('incomplete');
 expect(unknownIsp.checks.find(x=>x.id==='exit.provider')?.ok).toBeNull();
 const noProbes=verifyBrowser(context,{...report,webrtc_ok:undefined,webdriver:undefined,graphics_ok:undefined,tz_offset_ok:undefined,media_fingerprint_ok:undefined,client_hints_ok:undefined},true,'',false);
 expect(noProbes.phase).toBe('incomplete');
 expect(noProbes.checks.filter(x=>x.id.startsWith('probe.')).every(x=>x.ok===null)).toBe(true);
});

test('20 checks with 18 passed and 2 unknown produces incomplete neutral phase without turning green or red', () => {
 const userScenario = verifyBrowser(context, {
  ...report,
  exit: {...report.exit!, hosting: undefined, isp: 'Unknown ISP'},
  webrtc_ok: null,
  webrtc_detail: '候选收集未完成或接口失败，结果未知',
 }, true, '', false);
 expect(userScenario.phase).toBe('incomplete');
 expect(userScenario.problems).toHaveLength(0);
 expect(userScenario.checks).toHaveLength(20);
 expect(userScenario.checks.filter(c => c.ok === true)).toHaveLength(18);
 expect(userScenario.checks.filter(c => c.ok === null)).toHaveLength(2);
 expect(userScenario.checks.filter(c => c.ok === false)).toHaveLength(0);
 const realFail = verifyBrowser(context, {
  ...report,
  cores: 4,
  exit: {...report.exit!, hosting: undefined, isp: 'Unknown ISP'},
  webrtc_ok: null,
  webrtc_detail: '候选收集未完成或接口失败，结果未知',
 }, true, '', false);
 expect(realFail.phase).toBe('failed');
 expect(realFail.checks.filter(c => c.ok === false)).toHaveLength(1);
});
