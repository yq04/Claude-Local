/**
 * [INPUT]: Isolated Playwright browser and synthetic identities IPC with a controllable local quota revision.
 * [OUTPUT]: Regression for retrying a passive summary read after one transient failure.
 * [POS]: Real IdentityPanel component, synthetic state only; no network or user data.
 * [PROTOCOL]: Keep scripts/CLAUDE.md and tests/CLAUDE.md aligned.
 */
import {strict as assert} from 'node:assert';
import type {Browser} from 'playwright-core';

export async function testIdentityPassive(browser:Browser,base:string){
 const context=await browser.newContext({viewport:{width:1040,height:820},reducedMotion:'reduce'});
 try{
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{(window as any).__deferInitialQuotaRevision=true;});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
   const f=(window as any).identityFixture;
   return f?.identityReads>=1&&f?.pending.includes('identities_quota_revision');
  });
  const value=page.locator('.identity-card.current [data-quota-window="5h"] .identity-quota-value');
  await value.waitFor();
  assert((await value.innerText()).includes('65%'),'the first summary read should show the original synthetic quota');
  await page.evaluate(()=>((window as any).identityFixture.updatePassiveQuota(58)));
  await page.evaluate(()=>((window as any).identityFixture.release('identities_quota_revision')));
  await page.waitForFunction(()=>document.querySelector('.identity-card.current [data-quota-window="5h"] .identity-quota-value')?.textContent?.includes('42'));

  const initialAttempts=await page.evaluate(()=>(window as any).identityFixture.identityReadAttempts);
  await page.evaluate(()=>{
   const f=(window as any).identityFixture;
   f.setFailure('identities_read');
   f.updatePassiveQuota(71);
  });
  await page.waitForFunction(()=>((window as any).identityFixture.identityReadFailures===1));
  const failedAt=await page.evaluate(()=>(window as any).identityFixture.identityReadAttempts);
  assert(failedAt>initialAttempts,'the changed revision should trigger its first summary read');
  await page.waitForFunction(failedReads=>{
   const f=(window as any).identityFixture;
   return f.identityReadAttempts>failedReads&&f.identityReadFailures===1&&f.identityReads>0;
  },failedAt);
  await page.waitForFunction(()=>document.querySelector('.identity-card.current [data-quota-window="5h"] .identity-quota-value')?.textContent?.includes('29'));
  assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_refresh_quota'||row.command==='identities_refresh_all_quotas').length),0,'passive retries must not query online quota');
  assert.equal(errors.length,0,errors.join('\n'));
  return 1;
 }finally{await context.close();}
}
