/**
 * [INPUT]: 注入 HTTP 地理/分类响应、限流/超时/错误及合成 IPv4/IPv6。
 * [OUTPUT]: 地理备援、同 IP 严格布尔补充分类、32KiB上限和故障不覆盖地理结果的回归。
 * [POS]: 网络规则验证；不访问外网、不启动浏览器、不修改用户资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,expect} from 'bun:test';
import {parseExit,probeBrowserExit} from './browser-network';
import {classifyExitIsp} from './browser-model';
test('主服务限流后经同一浏览器请求备用服务',async()=>{
  const calls:string[]=[];
  const request=(async(url:string)=>{calls.push(String(url));return calls.length===1?new Response('',{status:429}):Response.json({ip:'203.0.113.1',country_code:'US',timezone:'America/New_York',org:'fixture'});});
  const exit=await probeBrowserExit(['https://primary.test/','https://backup.test/json/'],request);
  expect(calls.length).toBe(2);expect(exit.timezone).toBe('America/New_York');expect(exit.ip).toBe('203.0.113.1');
});
test('无效 IP 与失败响应不能被当作核验成功，保留 HTTP 原因',async()=>{
  expect(()=>parseExit({success:true,ip:'999.2.3.4',country_code:'US'})).toThrow();
  expect(()=>parseExit({success:false,ip:'203.0.113.1',country_code:'US'})).toThrow();
  for(const invalid of ['2001:db8::1]:80/evil','2001:db8::1]?x=1','2001:db8::1]#frag','[::1]@evil.test'])expect(()=>parseExit({ip:invalid,country_code:'JP'})).toThrow();
  expect(parseExit({ip:'2001:db8::1',country_code:'JP',timezone:'Asia/Tokyo'}).ip).toBe('2001:db8::1');
  const request=(async()=>new Response('',{status:429}));
  await expect(probeBrowserExit(['https://primary.test/','https://backup.test/'],request)).rejects.toThrow('HTTP 429');
});

test('出口解析提取 ASN 与机房 hosting 标识并区分 ISP 宽带与 IDC 机房',()=>{
  const residential=parseExit({ip:'203.0.113.10',country_code:'US',timezone:{id:'America/Los_Angeles'},connection:{asn:7922,isp:'Comcast Cable Communications'}});
  expect(residential.asn).toBe('AS7922');
  expect(classifyExitIsp(residential)).toBe('unknown');
  expect(classifyExitIsp({...residential,hosting:false})).toBe('isp');
  expect(classifyExitIsp({...residential,isp:'',asn:undefined,hosting:false})).toBe('isp');
  const datacenter=parseExit({ip:'203.0.113.20',country_code:'US',timezone:'America/New_York',asn:'AS14061',org:'DigitalOcean, LLC'});
  expect(datacenter.asn).toBe('AS14061');
  expect(classifyExitIsp(datacenter)).toBe('hosting');
  const flagged=parseExit({ip:'203.0.113.30',country_code:'US',timezone:'America/New_York',org:'Custom Network',security:{hosting:true}});
  expect(flagged.hosting).toBe(true);
  expect(classifyExitIsp(flagged)).toBe('hosting');
});

const classifier='https://api.ipquery.io/';
const baseExit={ip:'203.0.113.10',country_code:'JP',city:'Tokyo',timezone:'Asia/Tokyo',connection:{asn:12345,isp:'Unlisted fixture carrier'}};
test('缺少机房字段时沿浏览器路由补充同 IP 分类并保留地理数据',async()=>{
  const calls:{url:string;options?:RequestInit}[]=[];
  const request=async(url:string,options?:RequestInit)=>{
    calls.push({url,options});
    return Response.json(calls.length===1?baseExit:{ip:baseExit.ip,risk:{is_datacenter:false},location:{country_code:'US'},isp:{org:'Ignored'}});
  };
  const exit=await probeBrowserExit(['https://primary.test/'],request,classifier);
  expect(calls.map(c=>c.url)).toEqual(['https://primary.test/',`${classifier}${baseExit.ip}?format=json`]);
  expect(calls[1].options).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
  expect(calls[1].options?.signal).toBeInstanceOf(AbortSignal);
  expect(exit).toMatchObject({ip:baseExit.ip,country:'JP',city:'Tokyo',timezone:'Asia/Tokyo',isp:'Unlisted fixture carrier',asn:'AS12345',hosting:false,hosting_source:'ipquery'});
  expect(exit.hosting_error).toBeUndefined();
  expect(classifyExitIsp(exit)).toBe('isp');
});
test('明确机房标识不再查询，缺少分类目录的旧调用不新增请求',async()=>{
  for(const hosting of [true,false,undefined]){
    let calls=0;
    const exit=await probeBrowserExit(['https://primary.test/'],async()=>{calls++;return Response.json({...baseExit,hosting});},hosting===undefined?undefined:classifier);
    expect(calls).toBe(1);expect(exit.hosting).toBe(hosting);expect(exit.hosting_source).toBeUndefined();
  }
});
test('分类只接受相同 IPv6 地址与布尔字段',async()=>{
  let calls=0;
  const exit=await probeBrowserExit(['https://primary.test/'],async()=>Response.json(++calls===1?{...baseExit,ip:'2001:db8::1'}:{ip:'2001:0db8:0000:0000:0000:0000:0000:0001',risk:{is_datacenter:true}}),classifier);
  expect(exit.ip).toBe('2001:db8::1');expect(exit.hosting).toBe(true);expect(exit.hosting_source).toBe('ipquery');
});
test('分类故障仅留下受控原因，保留地理成功且不更换服务重试',async()=>{
  const cases:[()=>Response|Promise<Response>,string][]=[
    [()=>new Response('private external body',{status:429}),'rate_limited'],
    [()=>new Response('private external body',{status:503}),'http_error'],
    [()=>{throw new DOMException('private timeout message','TimeoutError');},'timeout'],
    [()=>{throw new TypeError('CORS private external message');},'network_error'],
    [()=>new Response('malformed private external body'),'invalid_response'],
    [()=>Response.json({ip:'203.0.113.11',risk:{is_datacenter:false}}),'ip_mismatch'],
    [()=>Response.json({ip:baseExit.ip,risk:{is_datacenter:'false'}}),'invalid_response'],
    [()=>Response.json({ip:baseExit.ip,risk:{}}),'invalid_response'],
    [()=>new Response('x'.repeat(32769)),'response_too_large'],
  ];
  for(const [reply,code] of cases){
    let calls=0;
    const exit=await probeBrowserExit(['https://primary.test/','https://unused.test/'],async()=>++calls===1?Response.json(baseExit):reply(),classifier);
    expect(calls).toBe(2);expect(exit).toMatchObject({ip:baseExit.ip,country:'JP',timezone:'Asia/Tokyo',hosting_error:code});
    expect(exit.hosting).toBeUndefined();expect(exit.hosting_source).toBeUndefined();expect(classifyExitIsp(exit)).toBe('unknown');
    expect(JSON.stringify(exit)).not.toContain('private');
  }
});

// ----- Windows 原生网页回报不能落入 Mac 分支或以错误版本通过 -----
test('Windows 设备核验接受真实 Win32，拒绝其他平台、CPU 与版本', async () => {
    const {matchesDevice}=await import('./browser-model');
    const machine={platform:'windows',version:'10.0.26100',cores:4};
    const report={platform:'Win32',platform_version:'10.0.26100',cores:4};
    expect(matchesDevice(machine,report)).toBe(true);
    expect(matchesDevice(machine,{...report,platform:'MacIntel'})).toBe(false);
    expect(matchesDevice(machine,{...report,platform:'Darwin'})).toBe(false);
    expect(matchesDevice(machine,{...report,cores:8})).toBe(false);
    expect(matchesDevice(machine,{...report,platform_version:'15.0.0'})).toBe(false);
});
