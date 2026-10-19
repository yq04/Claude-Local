/**
 * [INPUT]: 现有隔离 Playwright 引擎、Vite 本机地址与虚构出口/宿主响应。
 * [OUTPUT]: 顶部身份卡顺序/双语/联动/不匹配/空身份与真实 browser.html 的黄波纹/绿通过/红失败、图片解码、紧凑宽度/高度、未知目标单项黄色待测、重测与双语 DOM 回归。
 * [POS]: 身份 UI 回归共用引擎的伴生页验证，不截图、不调用真实宿主或外网。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';
export async function testBrowserVerification(browser:Browser,base:string) {
 const context=await browser.newContext({locale:'en-US',timezoneId:'America/Los_Angeles'});
 await context.addInitScript(()=>{
  const query=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=(options:PermissionDescriptor)=>options.name==='geolocation'?Promise.resolve({state:'denied'} as PermissionStatus):query(options);
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 let first=true, failure=false, unknown=false, language='zh', reports=0;
 let identity={linked:true,status:'linked',name:'Fixture identity',email:'fixture@example.invalid' as string|null,organization:'Fixture team' as string|null};
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(!url.startsWith(base+'/'))return route.abort();
  if(url===base+'/context'){
   if(first){first=false;await gate;}
   const observed=await page.evaluate(async()=>{
    const high=await (navigator as any).userAgentData?.getHighEntropyValues(['platformVersion','uaFullVersion']);
    return {platform:navigator.platform.toLowerCase().includes('mac')?'macos':navigator.platform==='Win32'?'windows':'linux',version:high?.platformVersion||'',cores:navigator.hardwareConcurrency,engine:high?.uaFullVersion||navigator.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1]||''};
   });
   return route.fulfill({json:{identity,ui_language:language,exit_services:[base+'/fixture-exit'],region:unknown?null:{id:'us-la',country:'US',language:'en-US',locale:'en_US',timezone:'America/Los_Angeles'},config:{follow_machine:false,language:'en-US',timezone:'America/Los_Angeles'},machine:{platform:observed.platform,version:observed.version,cores:observed.cores,timezone:'America/Los_Angeles',languages:['en-US'],locale:'en_US',locale_country:'US',location_enabled:false},engine_version:observed.engine}});
  }
  if(url===base+'/fixture-exit')return route.fulfill({json:{ip:'203.0.113.1',country_code:failure?'JP':'US',city:'Fixture',timezone:'America/Los_Angeles'}});
  if(url===base+'/report'){reports++;return route.fulfill({json:{ok:true}});}
  return route.continue();
 });
 try{
  await page.goto(base+'/browser.html');
  await page.waitForFunction(()=>document.querySelector('[data-verification]')?.getAttribute('data-verification')==='checking');
  assert.equal(await page.locator('.verification-signal i').first().evaluate(node=>getComputedStyle(node).animationName),'verification-ripple');
  release();
  await page.waitForFunction(()=>document.querySelector('[data-verification]')?.getAttribute('data-verification')==='passed');
  assert.equal(await page.locator('.verification-check.failed').count(),0);assert(reports>0);
  const badge=page.getByRole('region',{name:'浏览器身份',exact:true});
  await badge.getByRole('heading',{name:'Fixture identity',exact:true}).waitFor();
  assert.match(await badge.innerText(),/fixture@example.invalid/);assert.match(await badge.innerText(),/身份已联动/);
  assert(await page.evaluate(()=>!!(document.querySelector('.verification-identity')!.compareDocumentPosition(document.querySelector('.verification-banner')!)&Node.DOCUMENT_POSITION_FOLLOWING)));

  await page.waitForFunction(()=>{const img=document.querySelector('.verification-brand img') as HTMLImageElement;return img?.complete&&img.naturalWidth>0;});
  assert(await page.locator('.verification-banner').evaluate(node=>node.getBoundingClientRect().height<=150));
  assert(await page.locator('.browser-start').evaluate(node=>node.getBoundingClientRect().width>=window.innerWidth-40));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-verification]')!).backgroundColor==='rgb(228, 245, 233)');
  failure=true;
  await page.getByRole('button',{name:'重新实测',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-verification]')?.getAttribute('data-verification')==='failed');
  const country=page.locator('.verification-check.failed').filter({has:page.getByRole('heading',{name:'出口国家',exact:true})});
  assert.match(await country.innerText(),/JP/);assert.match(await country.innerText(),/US/);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-verification]')!).backgroundColor==='rgb(255, 241, 240)');
  failure=false;unknown=true;
  await page.getByRole('button',{name:'重新实测',exact:true}).click();
  await page.locator('.verification-check.pending').filter({has:page.getByRole('heading',{name:'出口国家',exact:true})}).waitFor();
  assert.equal(await page.locator('.verification-check.pending').count(),2);
  assert.equal(await page.locator('.verification-check.failed').count(),0);
  assert.equal(await page.locator('.verification-check.pending').first().getByLabel('尚未核验',{exact:true}).innerText(),'—');
  unknown=false;language='en';
  await page.getByRole('button',{name:'重新实测',exact:true}).click();
  await page.getByRole('heading',{name:'Checks passed',exact:true}).waitFor();
  await page.getByRole('button',{name:'Run check',exact:true}).waitFor();
  assert.match(await page.locator('.verification-identity').innerText(),/Identity linked/);
  identity={linked:true,status:'mismatch',name:'Archived identity A',email:null,organization:null};
  await page.getByRole('button',{name:'Run check',exact:true}).click();
  await page.locator('.verification-identity').getByText('Identity out of sync',{exact:true}).waitFor();
  assert.equal(await page.locator('.verification-identity').getAttribute('data-identity'),'mismatch');
  assert.equal(await page.locator('.verification-identity').getByText('fixture@example.invalid',{exact:true}).count(),0);
  identity={linked:true,status:'empty',name:'',email:null,organization:null};
  await page.getByRole('button',{name:'Run check',exact:true}).click();
  await page.locator('.verification-identity').getByRole('heading',{name:'Empty identity',exact:true}).waitFor();
  identity={linked:false,status:'unlinked',name:'',email:null,organization:null};
  await page.getByRole('button',{name:'Run check',exact:true}).click();
  await page.locator('.verification-identity').getByText('Not linked',{exact:true}).waitFor();
  assert.equal(await page.locator('.verification-identity.linked').count(),0);

  return 7;
 } finally {release();await context.close();}
}
