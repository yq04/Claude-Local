/**
 * [INPUT]: Isolated browser, controlled clock, locale-catalog labels and account-bound fictional persistent batch IPC.
 * [OUTPUT]: Default local-only sync, menu-opened online dialog, all-account target selection, remount recovery, cancellation and passive observation checks.
 * [POS]: Focused identity quota integration tests; synthetic IPC only, with no user data, native operations or external requests.
 * [PROTOCOL]: Keep scripts/CLAUDE.md and the fictional fixture aligned.
 */
import {strict as assert} from 'node:assert';
import {mkdir} from 'node:fs/promises';
import type {Browser} from 'playwright-core';

export async function testIdentityBatch(browser:Browser,base:string){
 const context=await browser.newContext({viewport:{width:1040,height:820},reducedMotion:'reduce'});
 try{
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{
   (window as any).__quotaForeground=true;
   Object.defineProperty(document,'hasFocus',{value:()=>Boolean((window as any).__quotaForeground),configurable:true});
   Object.defineProperty(document,'hidden',{get:()=>!(window as any).__quotaForeground,configurable:true});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-10-23T18:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-23T18:00:01Z'));
  await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean((window as any).identityFixture?.identityReads));
  await page.evaluate(async()=>{
   const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({reduceMotion:true});
   await prefs.synchronizePrivacyPreference(false);
   (window as any).identityFixture.state.records=(window as any).identityFixture.state.records.slice(0,3);
  });
  const label=(key:string)=>page.evaluate(async key=>(await import('/src/i18n.ts')).translate(key),key);
  const localLabel=await label('identityCard.localQuotaSync');
  const local=page.getByRole('button',{name:localLabel,exact:true});
  await local.click();
  const batches=()=>page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_all_quotas'));
  const current=page.locator('.identity-card.current');
  const onlineReads=()=>page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>['identities_refresh_quota','identities_refresh_all_quotas'].includes(row.command)));
  const queryOnlineLabel=await label('identityCard.queryOnlineNow');
  const onlineMenuLabel=await label('identityCard.onlineQuery');
  const openOnline=async()=>{
   if(await page.getByRole('dialog').count())return;
   await page.getByRole('button',{name:await label('identityCard.quotaMoreActions'),exact:true}).click();
   await page.getByRole('menuitem',{name:onlineMenuLabel,exact:true}).click();
   await page.getByRole('dialog').waitFor();
  };
  const closeOnline=async()=>{
   if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:await label('关闭弹窗'),exact:true}).click();
  };
  assert.equal((await batches()).length,0);
  assert.equal(await page.getByRole('button',{name:queryOnlineLabel,exact:true}).count(),0,'Online controls stay out of the default identity page');
  assert.equal(await page.getByText(await label('identityCard.localQuotaGuide'),{exact:true}).count(),0,'The redundant local quota guide is absent');
  assert.equal(await page.getByText(await label('identityCard.onlineQueryDescription'),{exact:true}).count(),0,'The redundant online explanation is absent');
  assert.equal(await page.getByRole('switch',{name:await label('identityCard.foregroundAutoRefresh'),exact:true}).count(),0,'The online polling toggle is hidden while the dialog is closed');
  assert.equal(await current.locator('.identity-card-status').count(),0,'No retained online status decorates a fresh mount');
  assert.equal(await current.locator('.identity-sub-resets-block').count(),0,'Cards omit missing subscription/reset data instead of showing an empty-data placeholder');
  await page.clock.runFor(7000);
  assert.equal((await onlineReads()).length,0,'Local refresh and passive polling never start online requests');
  await openOnline();
  assert.equal((await batches()).length,0,'Opening the online dialog does not start a request');
  const auto=page.getByRole('switch',{name:await label('identityCard.foregroundAutoRefresh'),exact:true});
  const refreshAllLabel=queryOnlineLabel;
  assert.equal(await auto.isChecked(),false);
  assert.equal(await current.locator('h3 .identity-plan-pill').textContent(),'Pro');
  let checks=1;

  await closeOnline();
  assert.equal(await page.locator('.identity-search-row').count(),0,'The identity search/sort row is removed');
  assert.equal(await page.getByRole('combobox').count(),0,'The identity page has no replacement sorting control');
  assert.deepEqual(await page.locator('.identity-card h3[data-identity-name] > strong').allTextContents(),['Identity 1','Identity 2','Identity 3'],'Current identity is pinned and saved identities keep native record order');
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_refresh_all_quotas'));
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('identities_refresh_all_quotas'));
  const request=(await batches()).at(-1).args;
  assert.equal(request.targets.length,3,'All identities must be queried once, excluding the duplicate active backup');
  assert.equal(request.allowBrowserFallback,true);assert.match(request.requestId,/^[0-9a-f]{32}$/);
  assert.deepEqual(request.targets.map((row:any)=>row.account_id).sort(),['00000000000000000000000000000002','00000000000000000000000000000003','current']);
  await page.evaluate(()=>{const f=(window as any).identityFixture;f.publishBatchProgress('current');f.publishBatchProgress('current');});
  await current.locator('[data-quota-window="5h"]').getByText('75%',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.pending.includes('identities_refresh_all_quotas')),true);
  await page.getByRole('button',{name:/查询 1\/3/}).waitFor();
  await closeOnline();
  await page.locator('.identity-batch-task-compact').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0,'Closing the online dialog leaves the native batch running and keeps the page available');
  assert.equal(await current.locator('.identity-quota-open').isEnabled(),true,'Closing the online dialog keeps local quota details available');
  await openOnline();
  await page.evaluate(()=>(window as any).identityFixture.release('identities_refresh_all_quotas'));
  await page.getByRole('button',{name:refreshAllLabel,exact:true}).waitFor();
  await closeOnline();
  const saved=page.locator('.identity-card').filter({has:page.getByRole('heading',{name:'Identity 2',exact:true})});
  await saved.locator('[data-quota-window="5h"]').getByText('75%',{exact:true}).waitFor();
  checks++;

  const observed=await page.evaluate(()=>(window as any).identityFixture.state.summaries['00000000000000000000000000000002'].quota_5h_observed_at_ms);

  const beforeRecovery=(await batches()).length;
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_refresh_all_quotas'));
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('identities_refresh_all_quotas'));
  const recoveredRequest=(await batches()).at(-1).args.requestId;
  await page.evaluate(()=>(window as any).identityFixture.remountIdentity());
  await page.getByRole('dialog').waitFor({state:'detached'});
  await page.locator('.identity-batch-task-compact').getByRole('button',{name:'取消查询',exact:true}).waitFor();
  assert.equal((await batches()).length,beforeRecovery+1,'remount recovers the native task instead of starting another batch');
  await page.evaluate(requestId=>{
   const f=(window as any).identityFixture;const target=f.batch.targets.find((row:any)=>row.account_id==='current');
   f.emitEvent('quota-batch-progress',{request_id:'f'.repeat(32),...target,result:{status:'auth_required'},completed:1,total:f.batch.total});
   f.emitEvent('quota-batch-progress',{request_id:requestId,account_id:'current',expected_identity:'e'.repeat(64),result:{status:'auth_required'},completed:1,total:f.batch.total});
  },recoveredRequest);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.identity-card.current .identity-card-status').count(),0,'Online results never decorate the default identity card');
  await page.locator('.identity-batch-task-compact').getByRole('button',{name:'取消查询',exact:true}).click();
  await page.waitForFunction(()=>{
   const batch=(window as any).identityFixture.batch;
   return batch?.request_id&&batch.state==='cancelled'&&batch.results.length===batch.targets.length;
  });
  const cancelled=await page.evaluate(()=>(window as any).identityFixture.batch);
  assert.equal(cancelled.request_id,recoveredRequest);
  assert.equal(cancelled.results.filter((row:any)=>row.result.status==='not_run').length,cancelled.targets.length);
  const onlineCountAfterCancel=await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_quota').length);
  await page.evaluate(()=>(window as any).identityFixture.release('identities_refresh_all_quotas'));
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_quota').length),onlineCountAfterCancel,'cancellation does not let queued synthetic targets run later');
  checks++;

  await page.evaluate(()=>(window as any).identityFixture.defer('identities_refresh_all_quotas'));
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('identities_refresh_all_quotas'));
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;f.state.summaries['00000000000000000000000000000003'].quota_identity='f'.repeat(64);
  });
  await closeOnline();
  await local.click();
  await page.waitForFunction(()=>((window as any).identityFixture.batch as any)?.state==='cancelled');
  assert.equal(await page.locator('.identity-batch-task-compact').getByRole('button',{name:'取消查询',exact:true}).count(),0,'target-set changes leave the old task terminal in the UI');
  await page.evaluate(()=>(window as any).identityFixture.release('identities_refresh_all_quotas'));
  checks++;

  await page.evaluate((observed)=>{(window as any).identityFixture.onlineResultsById['00000000000000000000000000000002']={status:'cooldown',reason:'auth_required',retry_scope:'oauth',last_observed_at_ms:observed,retry_at_ms:Date.now()+60000};},observed);
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  await closeOnline();
  assert.equal(await saved.locator('.identity-card-status').count(),0,'Online cooldowns never decorate the identity card');
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.summaries['00000000000000000000000000000002'].quota_5h_observed_at_ms),observed);
  assert.match(await saved.locator('[data-quota-window="5h"]').innerText(),/75%/);
  await page.evaluate(()=>(window as any).identityFixture.onlineResultsById['00000000000000000000000000000002']={status:'rate_limited',reason:'rate_limited',retry_scope:'all',retry_at_ms:Date.now()+60000});
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  await closeOnline();
  assert.equal(await saved.locator('.identity-card-status').count(),0,'Online failures stay out of the identity card');
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.summaries['00000000000000000000000000000002'].quota_5h_observed_at_ms),observed,'server-wide 429 cannot replace a recent observation');
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).some(row=>['identities_switch','identities_stop','identities_refresh_quota'].includes(row.command))),false);
  checks++;

  // Mixed synthetic batch: successes stay in process history but the recovery queue only
  // exposes the two accounts that need an explicit login or route repair.
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;
   if(!f.state.records.some((row:any)=>row.id==='00000000000000000000000000000004')){
    f.state.records.push({id:'00000000000000000000000000000004',name:'Identity 4',saved_at:1780000000003,bytes:2048,policy:{...f.state.records[0].policy}});
   }
   f.state.summaries['00000000000000000000000000000003'].quota_identity='0000000000000000000000000000000000000000000000000000000000000003';
   f.state.records=f.state.records.slice(0,4);
   f.onlineResultsById={
    current:{status:'updated',updated_windows:['5h','7d']},
    '00000000000000000000000000000002':{status:'cached'},
    '00000000000000000000000000000003':{status:'auth_required'},
    '00000000000000000000000000000004':{status:'route_unavailable',reason:'unsupported_proxy',stage:'route',route_mode:'account_proxy'},
   };
  });
  await local.click();
  const batchesBeforeQueue=(await batches()).length;
  await openOnline(); await page.getByRole('button',{name:refreshAllLabel,exact:true}).click();
  const queue=page.locator('.identity-connection-queue');
  await queue.waitFor();
  const queueRows=queue.locator('li');
  assert.equal(await queueRows.count(),2,`Two successes must be retained invisibly, not duplicated as recovery rows; rows=${JSON.stringify(await queueRows.allInnerTexts())}; batch=${JSON.stringify(await page.evaluate(()=>(window as any).identityFixture.batch))}`);
  assert.match(await queueRows.nth(0).innerText(),/Identity 3/);
  assert.match(await queueRows.nth(1).innerText(),/Identity 4/);
  const loginRow=queue.locator('li[data-connection-issue="login"]');
  assert.equal(await loginRow.getByRole('button').count(),1,'Only the account needing sign-in gets a browser action');
  await loginRow.getByRole('button').click();
  const browserOpen=await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='browser_open_identity_profile').at(-1));
  assert.equal(browserOpen.args.accountId,'00000000000000000000000000000003');
  assert.equal(browserOpen.args.expectedIdentity,await page.evaluate(()=>(window as any).identityFixture.state.summaries['00000000000000000000000000000003'].quota_identity),'The frozen fingerprint must follow the selected account');
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).some(row=>['identities_switch','identities_stop'].includes(row.command))),false);

  await page.evaluate(()=>{
   const f=(window as any).identityFixture;
   f.onlineResultsById['00000000000000000000000000000003']={status:'cooldown',reason:'auth_required',retry_scope:'oauth',retry_at_ms:Date.now()+60000};
   f.onlineResultsById['00000000000000000000000000000004']={status:'network_error'};
  });
  await queue.locator('.identity-connection-heading button').click();
  await page.waitForFunction(count=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_all_quotas').length===count+2,batchesBeforeQueue);
  const retryBatch=(await batches()).at(-1).args;
  assert.deepEqual(retryBatch.targets.map((row:any)=>row.account_id).sort(),[
   '00000000000000000000000000000003','00000000000000000000000000000004',
  ],'Unified retry submits only pending accounts, excluding the two successes');
  await page.evaluate(()=>(window as any).identityFixture.remountIdentity());
  assert.equal(await page.getByRole('dialog').count(),0,'Remount does not force-open the online dialog');
  assert.equal(await page.locator('.identity-card .identity-card-status').count(),0);
  await openOnline();
  await page.locator('.identity-connection-queue li').first().waitFor();
  assert.equal(await page.locator('.identity-connection-queue li').count(),2,'The retry queue survives an IdentityPanel remount');
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;
   f.state.summaries['00000000000000000000000000000003'].quota_identity='f'.repeat(64);
  });
  await closeOnline();
  await local.click();
  await openOnline();
  await page.waitForFunction(()=>document.querySelectorAll('.identity-connection-queue li').length===1);
  assert.equal(await page.locator('.identity-connection-queue li').first().getAttribute('data-connection-issue'),'retry');
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='browser_open_identity_profile').length),1,'A stale fingerprint cannot trigger a second account browser action');
  checks++;

  await page.evaluate(()=>(window as any).identityFixture.onlineResultsById={});
  const before=(await batches()).length;
  await auto.click();
  await page.waitForFunction(count=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_all_quotas').length===count,before+1);
  assert.equal((await batches()).at(-1).args.allowBrowserFallback,false,'Automatic refresh cannot navigate browsers');
  await closeOnline();
  await page.clock.runFor(360001);
  assert.equal((await batches()).length,before+1,'Closing the dialog turns off automatic refresh and leaves no hidden polling');
  await openOnline();
  assert.equal(await auto.isChecked(),false,'Reopening the dialog does not restore the prior polling opt-in');
  checks++;

  // A local passive observation appears without any online request.
  await closeOnline();
  const onlineBeforeLocal=(await batches()).length;
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;
   Object.assign(f.state.current,{quota_5h_used:31,quota_5h_observed_at_ms:Date.now()});f.quotaRevision++;
  });
  await page.clock.runFor(2100);
  await current.locator('[data-quota-window="5h"]').getByText('69%',{exact:true}).waitFor();
  assert.equal((await batches()).length,onlineBeforeLocal);
  checks++;

  for(const locale of ['zh','en']){
   await page.evaluate(async locale=>{
    (window as any).identityFixture.language(locale);
    const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({privacyMask:locale==='en'});
   },locale);
   const geometry=await page.locator('.identity-card').evaluateAll(cards=>cards.map(card=>{
    const box=card.getBoundingClientRect(),footer=card.querySelector('.identity-card-footer')!.getBoundingClientRect();
    const meta=card.querySelector('.identity-sub-resets-block')?.getBoundingClientRect();
    return {width:box.width,height:box.height,overflow:card.scrollWidth>card.clientWidth,footerBottom:footer.bottom,cardBottom:box.bottom,metaBottom:meta?.bottom??null,footerTop:footer.top};
   }));
   for(const box of geometry){assert.equal(box.width,180);assert.equal(box.height,286);assert.equal(box.overflow,false);if(box.metaBottom!==null)assert.ok(box.metaBottom<=box.footerTop+1);assert.ok(box.footerBottom<=box.cardBottom-2);}
   for(const button of await page.locator('.identity-card-footer button').all())assert.ok(await button.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
   if(locale==='en')assert.equal(await page.getByText('fixture@example.invalid',{exact:true}).count(),0);
  }
  assert.deepEqual(errors,[]);checks++;
  await mkdir('.local/preview/identity-quota',{recursive:true});
  await page.screenshot({path:'.local/preview/identity-quota/unified-en-private.png'});
  return checks;
 }finally{await context.close();}
}
