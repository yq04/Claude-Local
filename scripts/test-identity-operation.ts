/**
 * [INPUT]: 隔离 Playwright、真实身份页与可延期 IPC/官方 Channel 回调样本。
 * [OUTPUT]: 卡片下方真实事件进度、未知总量、稳定阶段百分比、空/暂存身份和清理复查/失败 DOM 验收。
 * [POS]: 身份操作动画的数据来源证明；测试显式释放事件，不造时间进度、不截图或调用原生。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser,Page} from 'playwright-core';
import type {Progress} from '../src/cleaner-activity';

async function pending(page:Page,command:string) {
 await page.waitForFunction(command=>(window as any).identityFixture.pending.includes(command),command);
}
async function emit(page:Page,command:string,event:Partial<Progress>&Pick<Progress,'stage'|'message'>) {
 await page.evaluate(({command,event})=>(window as any).identityFixture.emitProgress(command,{status:'running',current:0,total:null,elapsed_ms:1,...event}),{command,event});
}
async function release(page:Page,command:string,error?:string) {
 await page.evaluate(({command,error})=>(window as any).identityFixture.release(command,error),{command,error});
}
export async function testIdentityOperation(browser:Browser,base:string) {
 const context=await browser.newContext();
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let checks=0;
 try {
  await page.goto(base+'/tests/identities.html');
  await page.getByText('fixture@example.invalid',{exact:true}).waitFor();
  const operation=page.locator('.identity-operation');
  const stages=()=>operation.locator('.identity-operation-step').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-stage')));
  assert.equal(await operation.count(),0);
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_stop','identities_switch'));
  await page.getByRole('button',{name:'新身份',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认暂存并切换',exact:true}).click();
  await pending(page,'identities_stop');await operation.waitFor();
  assert.equal(await operation.evaluate(node=>node.previousElementSibling?.classList.contains('identity-card-rail')),true);
  const bar=operation.getByRole('progressbar');
  assert.equal(await bar.getAttribute('aria-valuenow'),null);
  assert.deepEqual(await stages(),['identity']);
  await page.waitForTimeout(250);assert.equal(await bar.getAttribute('aria-valuenow'),null);checks++;

  await emit(page,'identities_stop',{stage:'stop',message:'fixture closing Claude'});
  await operation.getByText('fixture closing Claude').first().waitFor();
  assert.deepEqual(await stages(),['identity','stop']);
  await release(page,'identities_stop');await pending(page,'identities_switch');
  await emit(page,'identities_switch',{stage:'archive',message:'fixture archiving 1 of 4',current:1,total:4});
  await operation.getByText('fixture archiving 1 of 4').first().waitFor();
  assert.equal(await bar.getAttribute('aria-valuenow'),'25');
  await page.waitForTimeout(300);assert.equal(await bar.getAttribute('aria-valuenow'),'25');
  await emit(page,'identities_switch',{stage:'archive',message:'fixture archive checkpoint 1 of 4',current:1,total:4});
  await operation.getByText('fixture archive checkpoint 1 of 4').first().waitFor();
  assert.deepEqual(await stages(),['identity','stop','archive']);
  await emit(page,'identities_switch',{stage:'write',message:'fixture waiting for atomic commit'});
  await operation.getByText('fixture waiting for atomic commit').first().waitFor();
  assert.equal(await bar.getAttribute('aria-valuenow'),null);checks++;
  assert.deepEqual(await stages(),['identity','stop','archive','write']);
  await release(page,'identities_switch');
  await page.waitForFunction(()=>(window as any).identityFixture.state.active==='empty');

  // ----- 暂存身份同样进入卡片下方进度，并仅在完整命令结束后完成 -----
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_switch'));
  const saved=page.locator('.identity-card').filter({has:page.getByRole('heading',{name:'Identity 3',exact:true})});
  await saved.getByRole('button',{name:'切换',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认暂存并切换',exact:true}).click();
  await pending(page,'identities_switch');
  await emit(page,'identities_switch',{stage:'restore',message:'fixture restoring saved identity',current:2,total:8});
  await operation.getByText('fixture restoring saved identity').first().waitFor();
  assert.equal(await bar.getAttribute('aria-valuenow'),'25');
  assert.equal(await operation.count(),1);
  await release(page,'identities_switch');
  await page.waitForFunction(()=>(window as any).identityFixture.state.current.present);checks++;

  // ----- 清理和复查共用同一进度块；清理返回不等于整项操作已完成 -----
  const residue=page.locator('.claude-residue');
  await residue.getByRole('button',{name:'检查残留',exact:true}).click();
  await residue.getByRole('checkbox',{name:/^虚构缓存 · /}).waitFor();
  await page.evaluate(()=>(window as any).identityFixture.defer('claude_residue_clean','claude_residue_scan'));
  await residue.getByRole('button',{name:'清理所选',exact:true}).click();
  let dialog=page.getByRole('alertdialog',{name:'清理所选文件',exact:true});
  await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).check();
  await dialog.getByRole('button',{name:'确认清理',exact:true}).click();
  await pending(page,'claude_residue_clean');
  await emit(page,'claude_residue_clean',{stage:'clean',message:'fixture cleaning 1 of 2',current:1,total:2});
  await operation.getByText('fixture cleaning 1 of 2').first().waitFor();
  assert.equal(await bar.getAttribute('aria-valuenow'),'50');
  assert.equal(await residue.locator('.identity-operation').count(),0);
  assert.equal(await operation.count(),1);
  await release(page,'claude_residue_clean');await pending(page,'claude_residue_scan');
  await emit(page,'claude_residue_scan',{stage:'scan',message:'fixture verifying remaining files'});
  await operation.getByText('fixture verifying remaining files').first().waitFor();
  assert.equal(await bar.getAttribute('aria-valuenow'),null);
  assert.equal(await operation.getAttribute('data-status'),'running');
  await release(page,'claude_residue_scan');
  await page.waitForFunction(()=>document.querySelector('.identity-operation')?.getAttribute('data-status')==='ok');checks++;

  // ----- 失败事件与回滚不能被百分比或已完成样式掩盖 -----
  await page.evaluate(()=>(window as any).identityFixture.defer('identities_switch'));
  await page.getByRole('button',{name:'新身份',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认暂存并切换',exact:true}).click();
  await pending(page,'identities_switch');
  await emit(page,'identities_switch',{stage:'archive',status:'error',message:'fixture archive verification failed',current:1,total:4});
  await emit(page,'identities_switch',{stage:'rollback',status:'running',message:'fixture rollback restoring current files'});
  await operation.getByText('fixture rollback restoring current files').first().waitFor();
  assert.notEqual(await operation.getAttribute('data-status'),'ok');
  assert.equal(await bar.getAttribute('aria-valuenow'),null);
  await release(page,'identities_switch','fixture rollback completed after archive failure');
  await operation.getByText('fixture rollback completed after archive failure').first().waitFor();
  assert.equal(await operation.getAttribute('data-status'),'error');
  assert.equal(await operation.locator('.identity-operation-step[data-status="error"]').count()>0,true);
  assert.equal(await operation.locator('.activity-result-symbol').evaluate(node=>getComputedStyle(node).color),'rgb(172, 48, 37)');
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.current.present),true);checks++;
  assert.deepEqual(errors,[]);
  return checks;
 } finally {await context.close();}
}
