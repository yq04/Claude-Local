/**
 * [INPUT]: 隔离 Playwright 引擎、Vite 与网络页虚构 IPC。
 * [OUTPUT]: 仅手动诊断、无资源导航，四域名待测/检测中/成功/失败、浏览器质询可达、原因、空结果拒绝和双语 DOM 回归。
 * [POS]: 共用 UI 回归的功能证明，不截图或访问外部服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';
export async function testNetworkDiagnostics(browser:Browser,base:string) {
 const context=await browser.newContext();
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 try{
  await page.goto(base+'/tests/network.html');
  await page.getByRole('heading',{name:'Claude 服务连通性',exact:true}).waitFor();
  const panel=page.locator('.domain-diagnostics'),rows=panel.locator('.domain-diagnostics-item');
  assert.equal(await panel.getAttribute('data-status'),'idle');assert.equal(await rows.count(),4);
  assert.deepEqual(await page.evaluate(()=>(window as any).networkFixture.commands),[]);
  assert.equal(await page.locator('a,.network-steps,.skill-install,.coding-tabs').count(),0);
  assert.equal(await page.getByRole('button').count(),1);
  assert.match(await panel.innerText(),/结果不代表账号可用或已验证公网出口/);
  assert.deepEqual(await panel.locator('.domain-name').allInnerTexts(),['claude.ai','api.anthropic.com','platform.claude.com','downloads.claude.ai']);
  await panel.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.domain-diagnostics')?.getAttribute('data-status')==='checking');
  assert.deepEqual(await page.evaluate(()=>(window as any).networkFixture.commands),['network_diagnose_domains']);
  assert.equal(await panel.locator('.domain-badge.checking').count(),4);
  assert.equal(await panel.getByRole('button',{name:'检测中',exact:true}).isDisabled(),true);
  await page.evaluate(()=>(window as any).networkFixture.finish());
  await page.waitForFunction(()=>document.querySelector('.domain-diagnostics')?.getAttribute('data-status')==='passed');
  assert.equal(await panel.locator('.domain-badge.passed').count(),4);
  assert.match(await panel.locator('.domain-outcome').innerText(),/检测成功/);
  assert.match(await rows.first().innerText(),/HTTP 403.*服务可达，需浏览器验证/);
  for(const mode of ['partial','error','empty','invalid']){
   await page.evaluate(mode=>(window as any).networkFixture.setMode(mode),mode);
   await panel.getByRole('button',{name:'重新检测',exact:true}).click();
   assert.equal(await panel.locator('.domain-badge.passed').count(),0);
   await page.evaluate(()=>(window as any).networkFixture.finish());
   await page.waitForFunction(()=>document.querySelector('.domain-diagnostics')?.getAttribute('data-status')==='failed');
   assert.match(await panel.locator('.domain-outcome').innerText(),/检测失败/);
   if(mode==='partial'){
    assert.equal(await panel.locator('.domain-badge.failed').count(),1);
    assert.match(await panel.locator('.domain-diagnostics-item.failed').innerText(),/HTTP 403.*受到安全拦截或限制/);
   }else assert.match(await panel.locator('.domain-outcome').innerText(),mode==='error'?/fixture connection interrupted/:mode==='invalid'?/检测结果无效/:/部分检测未返回结果/);
  }
  await page.evaluate(()=>(window as any).networkFixture.language('en'));
  await page.getByRole('heading',{name:'Claude service connectivity',exact:true}).waitFor();
  assert.match(await panel.locator('.domain-outcome').innerText(),/Check failed/);
  await panel.getByRole('button',{name:'Check again',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>(window as any).networkFixture.commands),Array(5).fill('network_diagnose_domains'));
  return 8;
 } finally {await context.close();}
}
