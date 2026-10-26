/**
 * [INPUT]: Explicit fake-native scheduler IPC and the production identity panel/bridge.
 * [OUTPUT]: Migration acknowledgement, failed save, page unmount, pause and controlled recovery checks.
 * [POS]: GUI bridge evidence only; native time/transport behavior is tested in wakeup_tests.rs.
 * [PROTOCOL]: Keep scripts/CLAUDE.md aligned; no real account or external network.
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';
export async function testNativeWakeup(browser:Browser,base:string):Promise<number>{
 const context=await browser.newContext({viewport:{width:1040,height:820},reducedMotion:'reduce'});
 try{
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{
   (window as any).__enableNativeWakeupTest=true;
   localStorage.setItem('claude-local:auto-wakeup-config-v1',JSON.stringify({enabled:false,useTimeWindow:false,startMinute:480,endMinute:1380,prewarmThresholdPct:40,excludedIdentities:[]}));
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>(window as any).identityFixture?.wakeup.migrated);
  const toggle=()=>page.getByRole('button',{name:'自动续杯',exact:true});
  await toggle().waitFor();
  assert(await page.evaluate(()=>localStorage.getItem('claude-local:auto-wakeup-config-v1')));
  let checks=1;
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_wakeup_configure'));
  await toggle().click();
  assert.equal(await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).count(),0);
  await page.evaluate(()=>(window as any).identityFixture.release('identities_wakeup_configure'));
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).waitFor();checks++;
  await page.evaluate(()=>(window as any).identityFixture.setFailure('identities_wakeup_configure'));
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).click();
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).waitFor();
  await page.getByText('自动续杯设置未能保存，界面设置未更改。',{exact:true}).waitFor();checks++;
  await page.evaluate(async()=>{
   const f=(window as any).identityFixture;f.showOtherPage();
   const {defaultAccountWakeupRuntime}=await import('/src/identity-online-quota.ts');
   const identity=f.state.current.quota_identity;
   f.publishWakeup({accounts:{[identity]:{...defaultAccountWakeupRuntime(),decision:'scheduled',scheduledAtMs:Date.now()+180000,capability:'http_connect',unknown:false,authBlocked:false,recoveryAllowed:false}}});
  });
  await page.getByTestId('other-page').waitFor();
  await page.evaluate(()=>(window as any).identityFixture.remountIdentity());
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).waitFor();
  const schedulerCounts=await page.evaluate(()=>{
   const c=(window as any).identityFixture.commands;return {reads:c.filter((r:any)=>r.command==='identities_wakeup_state').length,migrations:c.filter((r:any)=>r.command==='identities_wakeup_migrate').length,dispatches:c.filter((r:any)=>r.command==='identities_wakeup_quota_window').length};
  });
  assert.deepEqual(schedulerCounts,{reads:1,migrations:1,dispatches:0});checks++;
  await page.locator('.wakeup-config-trigger').click();
  const dialog=page.getByRole('dialog');
  await dialog.getByText(/仅在本应用运行时有效/).waitFor();
  const row=dialog.locator('.identity-wakeup-account-row').first();
  await row.getByText('支持 HTTP CONNECT',{exact:true}).waitFor();
  await row.getByRole('button',{name:'暂停',exact:true}).click();
  await row.getByRole('button',{name:'恢复',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.wakeup.config.excludedIdentities.length),1);checks++;
  await row.getByRole('button',{name:'恢复',exact:true}).click();
  await row.getByRole('button',{name:'暂停',exact:true}).waitFor();
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;const accounts=f.wakeup.accounts;const identity=f.state.current.quota_identity;
   accounts[identity]={...accounts[identity],authBlocked:true,lastStatus:'auth_required',decision:'auth_blocked'};f.publishWakeup({accounts});
  });
  await row.getByRole('button',{name:'允许一次恢复尝试',exact:true}).click();
  await page.waitForFunction(()=>{const f=(window as any).identityFixture;return f.wakeup.accounts[f.state.current.quota_identity].recoveryAllowed;});
  assert.equal(await page.evaluate(()=>{const f=(window as any).identityFixture;return f.wakeup.accounts[f.state.current.quota_identity].recoveryAllowed;}),true);
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.commands.filter((r:any)=>r.command==='identities_wakeup_quota_window').length),0);checks++;
  await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).click();await toggle().waitFor();checks++;
  assert.deepEqual(errors,[]);return checks;
 }finally{await context.close();}
}
