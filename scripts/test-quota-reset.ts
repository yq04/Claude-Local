/**
 * [INPUT]: 现有隔离 Playwright 引擎、Vite 本机地址与 tests/identities.html 的虚构 Tauri IPC。
 * [OUTPUT]: 闲置到期推定恢复（无额外 IPC/无虚构倒计时）、周额度与缺失/本地估计独立性、弹窗推定来源说明、双语 180×286 卡片几何与新真实观测覆盖 6 组核心 GUI 检查。
 * [POS]: 身份 UI 额度重置与推定恢复的无头行为回归；按钮标签按当前目录文案解析，独立 context + clock，不截图、不调用真实宿主或外网，try/finally 保证 context 关闭。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';

export async function testQuotaReset(browser:Browser,base:string) {
 const context=await browser.newContext({viewport:{width:1040,height:820},reducedMotion:'reduce'});
 try {
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const now=2_000_000_000;
  await page.clock.install({time:new Date(now*1000)});
  await page.clock.pauseAt(new Date((now+1)*1000));
  await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>Boolean((window as any).identityFixture?.identityReads));
  await page.evaluate(async now=>{
   const prefs=await import('/src/settings-model.ts');await prefs.synchronizePrivacyPreference(false);
   const state=(window as any).identityFixture.state;
   state.records=state.records.slice(0,4);
   Object.assign(state.current,{quota_5h_source:'server_anchor',quota_5h_used:100,quota_5h_reset_at:now+2,quota_5h_observed_at_ms:(now-100)*1000,quota_7d_source:'server_anchor',quota_7d_used:46,quota_7d_reset_at:now+86400,quota_7d_observed_at_ms:(now-100)*1000});
   Object.assign(state.summaries[state.records[1].id],{quota_5h_source:'unknown',quota_5h_used:null,quota_5h_reset_at:null});
   Object.assign(state.summaries[state.records[2].id],{quota_5h_source:'reset_inferred',quota_5h_used:0,quota_5h_reset_at:now-20,quota_5h_observed_at_ms:(now-100)*1000});
   Object.assign(state.summaries[state.records[3].id],{quota_5h_source:'local_estimate',quota_5h_used:100,quota_5h_reset_at:now+2,quota_5h_observed_at_ms:(now-100)*1000});
  },now);
  const localQuotaSyncLabel=()=>page.evaluate(async()=>(await import('/src/i18n.ts')).translate('identityCard.localQuotaSync'));
  await page.getByRole('button',{name:await localQuotaSyncLabel(),exact:true}).click();
  const cards=page.locator('.identity-card');
  const current5h=cards.first().locator('[data-quota-window="5h"]');
  await current5h.getByText('0%',{exact:true}).waitFor();
  let checks=1;

  const reads=await page.evaluate(()=>(window as any).identityFixture.identityReads);
  await page.clock.runFor(3000);
  await current5h.getByText('100%',{exact:true}).waitFor();
  assert.equal(await current5h.getAttribute('data-quota-inferred'),'true');
  assert.equal(await current5h.locator('time').count(),0);
  await current5h.locator('.identity-quota-reset-label').getByText('5h',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.identityReads),reads);
  checks++;

  assert.match(await cards.first().locator('[data-quota-window="7d"]').innerText(),/54%/);
  assert.match(await cards.nth(1).locator('[data-quota-window="5h"]').innerText(),/未知/);
  assert.match(await cards.nth(2).locator('[data-quota-window="5h"]').innerText(),/100%/);
  assert.match(await cards.nth(3).locator('[data-quota-window="5h"]').innerText(),/未知/);
  checks++;

  const size=await cards.first().boundingBox();assert(size);assert.equal(size.width,180);assert.equal(size.height,286);
  await cards.first().locator('.identity-quota-open').click();
  const dialog=page.getByRole('dialog');
  await dialog.getByText('按已过重置时间推定',{exact:true}).waitFor();
  assert.match(await dialog.innerText(),/其他设备/);
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_stop').length),0);
  checks++;

  await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.evaluate(()=>(window as any).identityFixture.language('en'));
  await current5h.locator('.identity-quota-reset-label').getByText('5h',{exact:true}).waitFor();
  const enSize=await cards.first().boundingBox();assert(enSize);assert.equal(enSize.height,286);
  checks++;

  await page.evaluate(now=>Object.assign((window as any).identityFixture.state.current,{quota_5h_source:'server_anchor',quota_5h_used:23,quota_5h_reset_at:now+18000,quota_5h_observed_at_ms:(now+3)*1000}),now);
  await page.getByRole('button',{name:await localQuotaSyncLabel(),exact:true}).click();
  await current5h.getByText('77%',{exact:true}).waitFor();
  assert.equal(await current5h.getAttribute('data-quota-inferred'),null);
  assert.equal(await current5h.locator('time').count(),1);
  checks++;

  assert.deepEqual(errors,[]);
  return checks;
 } finally {
  await context.close();
 }
}
