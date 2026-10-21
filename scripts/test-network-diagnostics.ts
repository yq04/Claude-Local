/**
 * [INPUT]: 隔离 Playwright 引擎、Vite 与网络页虚构 IPC。
 * [OUTPUT]: 隐藏固定推广链接、稳定双语按钮、精简提示词、复制失败/恢复及无导航回归，并保留四域名诊断/原因/空结果拒绝。
 * [POS]: 共用 UI 回归的功能证明，不截图或访问外部服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';
function assertCompactPrompt(prompt:string) {
 const lines=prompt.trim().split(/\r?\n/).filter(line=>line.trim());
 assert.ok(lines.length>=4&&lines.length<=8,'The prompt must remain a short task brief rather than a configuration template');
 for(const intent of [/iKuuu/i,/Kookeey/i,/Clash Verge Rev/i,/SOCKS5/i,/dialer-proxy/,/TUN/i,/DNS/i,/备份|back\s?up/i,/回环|本地回调|loopback|localhost/i,/版本|version/i,/验证|verif|check/i,/回滚|roll\s?back|restore/i])assert.match(prompt,intent);
 assert.match(prompt,/美国.*静态.*(?:住宅|家宽)|US static residential/i);
 assert.doesNotMatch(prompt,/function\s+main|tcp-concurrent|mixed-port|7890|proxy-providers|listeners\s*:|rules\s*[:=]|<PASSWORD>|<USERNAME>/i,'The brief must not embed scripts, fixed ports, credential forms or node rules');
}
export async function testNetworkDiagnostics(browser:Browser,base:string) {
 const context=await browser.newContext();
 const externalRequests:string[]=[];
 await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();externalRequests.push(route.request().url());return route.abort();});
 await context.addInitScript(()=>localStorage.setItem('claude-local.kookeey-referral.v1','https://legacy.example.invalid/referral'));
 const page=await context.newPage();page.setDefaultTimeout(10000);
 let popups=0;page.on('popup',()=>{popups++;});
 try{
  await page.goto(base+'/tests/network.html');
  await page.getByRole('heading',{name:'Claude 服务连通性',exact:true}).waitFor();
  const panel=page.locator('.domain-diagnostics'),rows=panel.locator('.domain-diagnostics-item');
  assert.equal(await panel.getAttribute('data-status'),'idle');assert.equal(await rows.count(),4);
  assert.deepEqual(await page.evaluate(()=>(window as any).networkFixture.commands),[]);
  assert.equal(await page.locator('a,.network-steps,.skill-install,.coding-tabs,.page-subtitle-pill').count(),0);
  assert.equal(await panel.getByRole('button').count(),1);
  // 校验按部就班三步卡片（iKuuu 专线、Kookeey 家宽、AI 自动配置提示词）
  const cards=page.locator('.network-action-card');
  assert.equal(await cards.count(),3);
  for(const card of await cards.all()){
   assert.equal(await card.getByRole('button').count(),1);
   assert.doesNotMatch(await card.evaluate(node=>node.outerHTML),/ikuuu\.top|kookeey\.com|uXqM|14151075|legacy\.example\.invalid/i,'Referral URLs and invitation codes must stay out of card text and attributes');
  }
  assert.equal(await page.locator('.network-page input,.network-page textarea,.network-prompt-preview').count(),0);
  const beforeCopyUrl=page.url();
  for(const [index,name] of [[0,'复制链接'],[1,'复制链接'],[2,'复制提示词']] as const){
   const button=cards.nth(index).getByRole('button',{name,exact:true});
   const beforeCopy=await page.evaluate(()=>(window as any).networkFixture.copied.length);
   await button.click();
   await page.waitForFunction(count=>(window as any).networkFixture.copied.length===count+1,beforeCopy);
   await page.locator('.network-copy-status[role="status"]').filter({hasText:index===2?'已复制提示词':'已复制'}).waitFor();
   assert.equal(await button.innerText(),name,'Copy success must preserve the action label');
  }
  const copied=await page.evaluate(()=>(window as any).networkFixture.copied as string[]);
  assert.equal(copied[0],'https://ikuuu.top/auth/register?code=uXqM');
  assert.equal(copied[1],'https://www.kookeey.com/?aff=14151075');
  assertCompactPrompt(copied[2]);
  assert.equal(page.url(),beforeCopyUrl);assert.equal(popups,0);assert.deepEqual(externalRequests,[],'Copy actions must not navigate to referral destinations');
  for(const fallback of ['rejected','missing']){
   await page.evaluate(fallback=>{(window as any).networkFixture.setCopyFailure(true);Object.defineProperty(navigator,'clipboard',{configurable:true,value:fallback==='missing'?undefined:{writeText:async()=>{throw Error('fixture clipboard denied');}}});},fallback);
   await cards.first().getByRole('button',{name:'复制链接',exact:true}).click();
   await page.locator('.network-copy-status[role="alert"]').filter({hasText:'复制失败，请重试。'}).waitFor();
   assert.equal(await page.locator('.network-copy-status[role="status"]').count(),0,'A failed native and fallback copy must not report success');
   assert.equal((await page.evaluate(()=>(window as any).networkFixture.copied as string[])).length,3);
   assert.equal(await cards.first().getByRole('button',{name:'复制链接',exact:true}).count(),1);
  }
  await page.evaluate(()=>(window as any).networkFixture.setCopyFailure(false));
  await cards.first().getByRole('button',{name:'复制链接',exact:true}).click();
  await page.locator('.network-copy-status[role="status"]').filter({hasText:'已复制'}).waitFor();
  assert.equal(await page.locator('.network-copy-status[role="alert"]').count(),0,'A later successful copy must clear its previous error');
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
  assert.equal(await cards.nth(0).getByRole('button',{name:'Copy link',exact:true}).count(),1);
  assert.equal(await cards.nth(1).getByRole('button',{name:'Copy link',exact:true}).count(),1);
  const copyPrompt=cards.nth(2).getByRole('button',{name:'Copy prompt',exact:true});
  const beforeEnglishCopy=await page.evaluate(()=>(window as any).networkFixture.copied.length);
  await copyPrompt.click();
  await page.waitForFunction(count=>(window as any).networkFixture.copied.length===count+1,beforeEnglishCopy);
  await page.locator('.network-copy-status[role="status"]').filter({hasText:/copied/i}).waitFor();
  assert.equal(await copyPrompt.innerText(),'Copy prompt');
  assertCompactPrompt(await page.evaluate(()=>(window as any).networkFixture.copied.at(-1)));
  await page.evaluate(()=>(window as any).networkFixture.setCopyFailure(true));
  await cards.first().getByRole('button',{name:'Copy link',exact:true}).click();
  await page.locator('.network-copy-status[role="alert"]').filter({hasText:'Copy failed. Try again.'}).waitFor();
  assert.equal(await page.locator('.network-copy-status[role="status"]').count(),0);
  for(const card of await cards.all())assert.doesNotMatch(await card.evaluate(node=>node.outerHTML),/ikuuu\.top|kookeey\.com|uXqM|14151075|legacy\.example\.invalid/i);
  assert.match(await panel.locator('.domain-outcome').innerText(),/Check failed/);
  await panel.getByRole('button',{name:'Check again',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>(window as any).networkFixture.commands),Array(5).fill('network_diagnose_domains'));
  assert.equal(page.url(),beforeCopyUrl);assert.equal(popups,0);assert.deepEqual(externalRequests,[]);
  return 12;
 } finally {await context.close();}
}
