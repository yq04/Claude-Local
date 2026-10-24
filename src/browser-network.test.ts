/**
 * [INPUT]: 模拟 HTTP 限流、备用服务响应和浏览器出口解析规则。
 * [OUTPUT]: 限流后切换备用服务、非法出口拒绝、ASN/ISP/机房分类与全部失败原因保留的回归检查。
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
  expect(classifyExitIsp(residential)).toBe('isp');
  const datacenter=parseExit({ip:'203.0.113.20',country_code:'US',timezone:'America/New_York',asn:'AS14061',org:'DigitalOcean, LLC'});
  expect(datacenter.asn).toBe('AS14061');
  expect(classifyExitIsp(datacenter)).toBe('hosting');
  const flagged=parseExit({ip:'203.0.113.30',country_code:'US',timezone:'America/New_York',org:'Custom Network',security:{hosting:true}});
  expect(flagged.hosting).toBe(true);
  expect(classifyExitIsp(flagged)).toBe('hosting');
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
