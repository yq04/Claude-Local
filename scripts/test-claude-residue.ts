/**
 * [INPUT]: 隔离 Playwright 引擎、真实身份页与仅内存的残留 IPC 样本。
 * [OUTPUT]: 显式扫描、精确默认选择、不可逆确认、最小删除清单、失败重扫和双语 DOM 验收。
 * [POS]: 身份页残留操作的安全边界回归；不截图、不读取本机文件或钥匙串。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser,Page} from 'playwright-core';

type Command={command:string;args:{ids?:string[]}};
async function commands(page:Page) {
 return page.evaluate(()=>((window as any).identityFixture.commands as Command[]).filter(row=>['identities_stop','claude_residue_clean'].includes(row.command)));
}
async function confirm(page:Page) {
 const dialog=page.getByRole('alertdialog',{name:'清理所选文件',exact:true});
 await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).check();
 await dialog.getByRole('button',{name:'确认清理',exact:true}).click();
}
export async function testClaudeResidue(browser:Browser,base:string) {
 const context=await browser.newContext();
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let checks=0;
 try {
  await page.goto(base+'/tests/identities.html');
  const panel=page.locator('.claude-residue');
  const scan=()=>panel.getByRole('button',{name:/^(检查残留|重新检查)$/});
  const clean=()=>panel.getByRole('button',{name:'清理所选',exact:true});
  const cache=()=>panel.getByRole('checkbox',{name:/^虚构缓存 · /});
  const history=()=>panel.getByRole('checkbox',{name:/^虚构会话历史 · /});
  const account=()=>panel.getByRole('checkbox',{name:/^虚构登录标识 · /});
  const incomplete=()=>panel.getByRole('checkbox',{name:/^虚构不可完整统计缓存 · /});
  await scan().waitFor();
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.residue.scans),0);
  assert.deepEqual(await commands(page),[]);checks++;

  await scan().click();await cache().waitFor();
  assert.equal(await cache().isChecked(),true);
  assert.equal(await history().isChecked(),false);assert.equal(await account().isChecked(),false);
  assert.equal(await incomplete().isChecked(),false);assert.equal(await incomplete().isDisabled(),true);
  await panel.locator('.claude-residue-warnings-trigger').click();
  assert.match(await panel.innerText(),/虚构警告：部分目录无法完整统计/);
  assert.match(await panel.innerText(),/oauthAccount/);checks++;

  await clean().click();
  let dialog=page.getByRole('alertdialog',{name:'清理所选文件',exact:true});await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await dialog.getByRole('button',{name:'确认清理',exact:true}).isDisabled(),true);
  assert.deepEqual(await commands(page),[]);
  await page.mouse.click(3,3);assert.equal(await dialog.count(),1);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.deepEqual(await commands(page),[]);checks++;

  await history().check();await account().check();await clean().click();
  dialog=page.getByRole('alertdialog',{name:'清理所选文件',exact:true});
  assert.match(await dialog.innerText(),/所选登录数据会被移除，需要重新登录/);
  assert.match(await dialog.innerText(),/所选历史或备份将永久删除/);
  assert.match(await dialog.innerText(),/不可撤销/);
  const readsBefore=await page.evaluate(()=>(window as any).identityFixture.identityReads);
  await confirm(page);
  await page.waitForFunction(()=>{
   const fixture=(window as any).identityFixture;return fixture.residue.scans===2&&fixture.identityReads>1;
  });
  await incomplete().waitFor();
  const calls=await commands(page);
  assert.deepEqual(calls.map(row=>row.command),['identities_stop','claude_residue_clean']);
  assert.deepEqual(calls[1].args.ids?.slice().sort(),['fixture-account','fixture-cache','fixture-history']);
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.identityReads)>readsBefore,true);
  assert.equal(await panel.getByRole('checkbox').evaluateAll(nodes=>nodes.filter(node=>node.getAttribute('aria-checked')==='true'||('checked' in node&&(node as HTMLInputElement).checked)).length),0);
  assert.equal(await clean().isDisabled(),true);checks++;

  // ----- 部分失败必须保留错误，并用新扫描替换已执行的计划 -----
  await page.evaluate(()=>{
   const fixture=(window as any).identityFixture;
   fixture.residue.remaining=['fixture-cache','fixture-history','fixture-account','fixture-incomplete'];
   fixture.residue.cleanMode='partial';
  });
  await scan().click();await cache().waitFor();await history().check();await clean().click();
  const scansBefore=await page.evaluate(()=>(window as any).identityFixture.residue.scans);
  await confirm(page);
  await page.waitForFunction(before=>(window as any).identityFixture.residue.scans>before,scansBefore);
  await panel.getByRole('alert').filter({hasText:'fixture cleanup partly failed'}).first().waitFor();
  assert.equal(await cache().count(),0);assert.equal(await history().isChecked(),false);
  assert.equal(await clean().isDisabled(),true);checks++;

  // ----- 扫描失败后不得继续使用旧 ID 清单 -----
  await page.evaluate(()=>(window as any).identityFixture.setFailure('claude_residue_scan'));
  await scan().click();
  await panel.getByRole('alert').filter({hasText:'fixture operation failed'}).first().waitFor();
  assert.equal(await panel.getByRole('checkbox').count(),0);
  if(await clean().count())assert.equal(await clean().isDisabled(),true);
  assert.equal((await commands(page)).filter(row=>row.command==='claude_residue_clean').length,2);checks++;

  // ----- 进程停止失败不能执行删除，仍要重新读回当前状态 -----
  await page.evaluate(()=>{
   const fixture=(window as any).identityFixture;
   fixture.residue.remaining=['fixture-cache','fixture-history','fixture-account','fixture-incomplete'];
   fixture.residue.cleanMode='success';
  });
  await scan().click();await cache().waitFor();
  const scansBeforeStop=await page.evaluate(()=>(window as any).identityFixture.residue.scans);
  await page.evaluate(()=>(window as any).identityFixture.setFailure('identities_stop'));
  await clean().click();await confirm(page);
  await page.waitForFunction(before=>(window as any).identityFixture.residue.scans>before,scansBeforeStop);
  await panel.getByRole('alert').filter({hasText:'fixture operation failed'}).first().waitFor();
  assert.equal((await commands(page)).filter(row=>row.command==='claude_residue_clean').length,2);
  assert.equal(await cache().isChecked(),false);checks++;

  await page.evaluate(()=>(window as any).identityFixture.language('en'));
  await panel.getByRole('button',{name:'Check again',exact:true}).waitFor();
  await cache().check();await panel.getByRole('button',{name:'Clean selected',exact:true}).click();
  dialog=page.getByRole('alertdialog',{name:'Clean selected files',exact:true});await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await dialog.getByRole('button',{name:'Confirm cleanup',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();checks++;
  assert.deepEqual(errors,[]);
  return checks;
 } finally {await context.close();}
}
