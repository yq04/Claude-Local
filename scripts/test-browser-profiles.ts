/**
 * [INPUT]: 已锁定 Chromium/Playwright、临时 HOME 和独立资料目录。
 * [OUTPUT]: 两套真实持久浏览器资料的 Cookie/LocalStorage 隔离、重开保留与空资料回归。
 * [POS]: 身份浏览器资料边界的集成证明；仅虚构数据和本机页面，不截图、不访问外网/真实账号。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
export async function testBrowserProfiles(executablePath:string,base:string,temporary:string,env:Record<string,string>) {
 const origin=base+'/profile-fixture';
 const open=async(name:string,seed:number)=>{
  const context=await chromium.launchPersistentContext(join(temporary,'profiles',name),{executablePath,headless:true,env,args:[`--fingerprint=${seed}`,'--use-mock-keychain','--password-store=basic']});
  await context.route('**/*',route=>route.request().url()===origin?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated profile fixture</title>'}):route.abort());
  const page=await context.newPage();await page.goto(origin);return {context,page};
 };
 let live:Awaited<ReturnType<typeof open>>|undefined;
 try {
  live=await open('A 空间',1001);
  await live.context.addCookies([{url:base,name:'fixture-account',value:'A',expires:Math.floor(Date.now()/1000)+3600}]);
  await live.page.evaluate(()=>localStorage.setItem('fixture-account','A'));
  await live.context.close();live=undefined;
  live=await open('B',2002);
  assert.equal(await live.page.evaluate(()=>localStorage.getItem('fixture-account')),null);
  assert.equal((await live.context.cookies(base)).some(cookie=>cookie.name==='fixture-account'),false);
  await live.page.evaluate(()=>localStorage.setItem('fixture-account','B'));
  await live.context.close();live=undefined;
  live=await open('A 空间',1001);
  assert.equal(await live.page.evaluate(()=>localStorage.getItem('fixture-account')),'A');
  assert.equal((await live.context.cookies(base)).find(cookie=>cookie.name==='fixture-account')?.value,'A');
  await live.context.close();live=undefined;
  live=await open('empty-fresh',3003);
  assert.equal(await live.page.evaluate(()=>localStorage.getItem('fixture-account')),null);
  assert.equal((await live.context.cookies(base)).length,0);
  return 3;
 } finally {await live?.context.close();}
}
