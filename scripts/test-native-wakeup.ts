/**
 * [INPUT]: Explicit fake-native scheduler IPC and the production identity panel/bridge.
 * [OUTPUT]: Migration, pause, controlled recovery and web-query/CLI-wakeup separation with visible admission checks.
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
  await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded',timeout:30000});
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
  await row.getByRole('button',{name:'已允许一次验证',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.commands.filter((r:any)=>r.command==='identities_wakeup_quota_window').length),0);checks++;
  await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.getByRole('button',{name:'自动续杯 · 已开',exact:true}).click();await toggle().waitFor();checks++;

  // One continuous user path: web failure -> open bound profile -> actual
  // batch result from the IPC fixture -> resolved web queue -> CLI auth block.
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;f.state.records=f.state.records.slice(0,1);f.state.running=false;
   f.onlineResult={status:'auth_required',browser_fallback_status:'web_access_denied'};
   f.remountIdentity();
  });
  await page.locator('.wakeup-config-trigger').click();
  await dialog.getByRole('button',{name:'在线查询全部账号',exact:true}).click();
  const queue=dialog.locator('.identity-connection-queue');
  await queue.getByText(/网页额度读取被拒绝（HTTP 403）/).waitFor();
  await queue.getByRole('button',{name:'打开此账号的浏览器资料',exact:true}).click();
  await dialog.getByText(/尚未完成额度验证/).waitFor();
  assert.equal(await queue.count(),1,'opening a profile cannot resolve web quota');
  await page.evaluate(()=>{(window as any).identityFixture.onlineResult={status:'updated',source:'browser',updated_windows:['5h'],verified_at_ms:Date.now()};});
  await queue.getByRole('button',{name:'统一重试待处理（1）',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.identity-connection-queue'));
  assert.equal(await page.evaluate(()=>{
   const f=(window as any).identityFixture;return f.commands.filter((r:any)=>r.command==='identities_refresh_all_quotas').at(-1).args.allowBrowserFallback;
  }),true);
  // Web query resolution updates web quota only; fixture evidence must preserve CLI auth block and permit without false promises
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.wakeup.accounts[(window as any).identityFixture.state.current.quota_identity].authBlocked),true);
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.wakeup.accounts[(window as any).identityFixture.state.current.quota_identity].recoveryAllowed),true);
  checks++;
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;const identity=f.state.current.quota_identity;
   Object.assign(f.state.current,{quota_5h_source:'reset_inferred',quota_5h_reset_at:Math.floor(Date.now()/1000)-100});
   f.onlineResult={status:'auth_required',stage:'messages',reason:'auth_required'};
   const accounts=f.wakeup.accounts;accounts[identity]={...accounts[identity],unknown:false,authBlocked:false,recoveryAllowed:false,backoffUntilMs:null,decision:'not_expired'};
   f.publishWakeup({accounts,nextGlobalAtMs:0});f.remountIdentity();
  });
  await page.locator('.wakeup-config-trigger').click();
  const currentRow=dialog.locator('.identity-wakeup-account-row').first();
  await page.evaluate(()=>{(window as any).identityFixture.onlineResult={status:'cooldown',stage:'scheduler',reason:'backoff_cooldown',retry_at_ms:Date.now()+60000};});
  await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).click();
  await dialog.locator('.identity-online-feedback').getByText(/冷却尚未结束，未发送请求.*仍需等待 \d+ 秒/).waitFor();
  assert.equal(await queue.count(),0);
  await page.evaluate(()=>{(window as any).identityFixture.onlineResult={status:'auth_required',stage:'messages',reason:'auth_required'};});
  await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).click();
  await dialog.locator('.identity-online-feedback').getByText(/CLI 唤醒授权被阻断/).waitFor();
  assert.equal(await queue.count(),0,'CLI/messages authorization must not recreate the web recovery queue');checks++;
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;const accounts=f.wakeup.accounts;const identity=f.state.current.quota_identity;
   accounts[identity]={...accounts[identity],authBlocked:false,decision:'backoff_cooldown',backoffUntilMs:Date.now()+120000};
   f.publishWakeup({accounts,nextGlobalAtMs:Date.now()+180000});
  });
  await currentRow.locator('[data-wakeup-gate="backoff_cooldown"]').getByText(/仍需等待 \d+ 分 \d+ 秒/).waitFor();
  assert.equal(await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).isEnabled(),false);
  assert.notEqual(await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).getAttribute('aria-busy'),'true');checks++;
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;const accounts=f.wakeup.accounts;const identity=f.state.current.quota_identity;
   accounts[identity]={...accounts[identity],authBlocked:true,lastStatus:'auth_required',decision:'auth_blocked'};f.publishWakeup({accounts});
  });
  const resumesBefore=await page.evaluate(()=>(window as any).identityFixture.commands.filter((r:any)=>r.command==='identities_wakeup_resume').length);
  await currentRow.getByRole('button',{name:'允许一次恢复尝试',exact:true}).click();
  await dialog.locator('.identity-online-feedback').getByText(/未更新凭据/).waitFor();
  await currentRow.getByRole('button',{name:'已允许一次验证',exact:true}).waitFor();
  assert.equal(await currentRow.getByRole('button',{name:'已允许一次验证',exact:true}).isEnabled(),false);
  assert.equal(await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).isEnabled(),false,'recovery preserves shared cooldown');
  await page.evaluate(()=>{const f=(window as any).identityFixture;const accounts=f.wakeup.accounts;accounts[f.state.current.quota_identity].backoffUntilMs=null;f.publishWakeup({accounts,nextGlobalAtMs:0});});
  await currentRow.getByRole('button',{name:'唤醒 5h 计时',exact:true}).click();
  await page.waitForFunction(()=>{const f=(window as any).identityFixture;return !f.wakeup.accounts[f.state.current.quota_identity].recoveryAllowed;});
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.commands.filter((r:any)=>r.command==='identities_wakeup_resume').length),resumesBefore+1);
  assert.equal(await queue.count(),0);checks++;

  // Viewport 760 check: verify that long localized auth reasons with local valid + old authblocked fit without horizontal overflow
  await page.setViewportSize({width:760,height:820});
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;const identity=f.state.current.quota_identity;
   f.state.running=false;f.state.current.auth_status='valid';
   Object.assign(f.state.current,{quota_5h_source:'reset_inferred',quota_5h_reset_at:Math.floor(Date.now()/1000)-100});
   const accounts=f.wakeup.accounts;
   accounts[identity]={...accounts[identity],authBlocked:true,lastStatus:'auth_required',decision:'auth_blocked',recoveryAllowed:false,backoffUntilMs:null};
   f.publishWakeup({accounts,nextGlobalAtMs:0});
  });
  await currentRow.getByText('待验证',{exact:true}).waitFor();
  await currentRow.getByText('本地已登录',{exact:true}).waitFor();
  await currentRow.getByText(/本地已登录，但保留着上次 CLI 授权失败；允许一次验证后再确认消息权限。/).waitFor();
  const overflowZh=await dialog.evaluate(dialogEl=>{
   const panel=dialogEl.querySelector('.identity-wakeup-panel') as HTMLElement|null;
   const rowEl=dialogEl.querySelector('.identity-wakeup-account-row') as HTMLElement|null;
   const detailsEl=dialogEl.querySelector('.identity-wakeup-account-details') as HTMLElement|null;
   return {
    dialogOverflow:dialogEl.scrollWidth>dialogEl.clientWidth+1,
    panelOverflow:panel?panel.scrollWidth>panel.clientWidth+1:false,
    rowOverflow:rowEl?rowEl.scrollWidth>rowEl.clientWidth+1:false,
    detailsOverflow:detailsEl?detailsEl.scrollWidth>detailsEl.clientWidth+1:false,
   };
  });
  assert.equal(overflowZh.dialogOverflow,false,'Dialog must not overflow horizontally at viewport 760');
  assert.equal(overflowZh.panelOverflow,false,'Panel must not overflow horizontally at viewport 760');
  assert.equal(overflowZh.rowOverflow,false,'Row must not overflow horizontally at viewport 760');
  assert.equal(overflowZh.detailsOverflow,false,'Details must not overflow horizontally at viewport 760');checks++;

  // Switch to English and verify no horizontal overflow with English long auth reason
  await page.evaluate(()=>(window as any).identityFixture.language('en'));
  await currentRow.getByText('Verification needed',{exact:true}).waitFor();
  await currentRow.getByText('Local login available',{exact:true}).waitFor();
  await currentRow.getByText(/Local login is available, but the previous CLI authorization failure remains/).waitFor();
  const overflowEn=await dialog.evaluate(dialogEl=>{
   const panel=dialogEl.querySelector('.identity-wakeup-panel') as HTMLElement|null;
   const rowEl=dialogEl.querySelector('.identity-wakeup-account-row') as HTMLElement|null;
   const detailsEl=dialogEl.querySelector('.identity-wakeup-account-details') as HTMLElement|null;
   return {
    dialogOverflow:dialogEl.scrollWidth>dialogEl.clientWidth+1,
    panelOverflow:panel?panel.scrollWidth>panel.clientWidth+1:false,
    rowOverflow:rowEl?rowEl.scrollWidth>rowEl.clientWidth+1:false,
    detailsOverflow:detailsEl?detailsEl.scrollWidth>detailsEl.clientWidth+1:false,
   };
  });
  assert.equal(overflowEn.dialogOverflow,false,'Dialog must not overflow horizontally in English at viewport 760');
  assert.equal(overflowEn.panelOverflow,false,'Panel must not overflow horizontally in English at viewport 760');
  assert.equal(overflowEn.rowOverflow,false,'Row must not overflow horizontally in English at viewport 760');
  assert.equal(overflowEn.detailsOverflow,false,'Details must not overflow horizontally in English at viewport 760');checks++;
  await page.evaluate(()=>(window as any).identityFixture.language('zh'));

  assert.deepEqual(errors,[]);return checks;
 }finally{await context.close();}
}
