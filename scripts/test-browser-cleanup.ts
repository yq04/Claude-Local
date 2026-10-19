/**
 * [INPUT]: 隔离 Playwright、真实 BrowserPanel 和现有身份测试入口的内存浏览器模式。
 * [OUTPUT]: 无缓存也可全清理、默认取消/强制勾选、精确 IPC 参数、真实事件进度、失败与双语 DOM 验收。
 * [POS]: 浏览器删除确认边界；不调用原生、不读写真实资料、不截图、不访问外网。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import type {Browser,Page} from 'playwright-core';
async function calls(page:Page) {
 return page.evaluate(()=>((window as any).identityFixture.commands as {command:string;args:Record<string,unknown>}[]).filter(row=>row.command==='browser_clear'));
}
export async function testBrowserCleanup(browser:Browser,base:string) {
 const context=await browser.newContext();
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let checks=0;
 try {
  await page.goto(base+'/tests/identities.html?panel=browser');
  const clear=()=>page.getByRole('button',{name:'全清理',exact:true});
  await clear().waitFor();
  assert.equal(await clear().isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'一键清理缓存',exact:true}).isDisabled(),true);
  assert.equal((await calls(page)).length,0);checks++;
  await clear().click();
  let dialog=page.getByRole('alertdialog',{name:'全清理浏览器',exact:true});await dialog.waitFor();
  assert.match(await dialog.innerText(),/密码与密钥、书签、历史、扩展、设置和缓存/);
  assert.match(await dialog.innerText(),/其他身份的浏览器资料和身份保险库不受影响/);
  assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await dialog.getByRole('button',{name:'确认全清理',exact:true}).isDisabled(),true);
  await page.mouse.click(2,2);assert.equal(await dialog.count(),1);
  await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).check();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await calls(page)).length,0);checks++;

  // ----- 勾选不能沿用；没有缓存项目不妨碍用户删除密码等其他资料 -----
  await clear().click();dialog=page.getByRole('alertdialog');
  assert.equal(await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).isChecked(),false);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(()=>(window as any).identityFixture.defer('browser_clear'));
  await clear().click();dialog=page.getByRole('alertdialog');
  await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).check();
  await dialog.getByRole('button',{name:'确认全清理',exact:true}).click();
  await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('browser_clear'));
  const requested=await calls(page);assert.equal(requested.length,1);
  assert.equal(requested[0].args.includeSiteData,true);assert.equal(requested[0].args.resetProfile,true);
  assert.equal(await clear().isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'刷新状态',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>(window as any).identityFixture.browserBusy),true);checks++;
  const activity=page.locator('.cleanup-activity');
  await page.evaluate(()=>(window as any).identityFixture.emitProgress('browser_clear',{stage:'browser',status:'running',message:'fixture removing current profile 1 of 4',current:1,total:4,elapsed_ms:1}));
  await activity.getByText('fixture removing current profile 1 of 4').first().waitFor();
  assert.equal(await activity.getByRole('progressbar').getAttribute('aria-valuenow'),'25');
  await page.waitForTimeout(250);
  assert.equal(await activity.getByRole('progressbar').getAttribute('aria-valuenow'),'25');
  await page.evaluate(()=>(window as any).identityFixture.release('browser_clear'));
  await page.waitForFunction(()=>document.querySelector('.cleanup-activity')?.getAttribute('data-status')==='ok');
  await activity.getByText('当前身份的浏览器资料已全清理，未保留副本。',{exact:true}).waitFor();checks++;

  // ----- 失败保留实际结果；重试仍须重新确认 -----
  await page.evaluate(()=>(window as any).identityFixture.setFailure('browser_clear'));
  await clear().click();dialog=page.getByRole('alertdialog');
  await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销',exact:true}).check();
  await dialog.getByRole('button',{name:'确认全清理',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'fixture operation failed'}).first().waitFor();
  assert.equal(await activity.getAttribute('data-status'),'error');
  assert.equal(await clear().isEnabled(),true);checks++;

  // ----- 仅缓存操作继续沿用窄参数，不得升级为资料重置 -----
  await page.evaluate(()=>{(window as any).identityFixture.browser.cache=[{path:'/fixture/profiles/current/Default/Cache',bytes:1024,login:false}];});
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();
  await page.getByRole('button',{name:'一键清理缓存',exact:true}).click();
  await page.waitForFunction(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='browser_clear').length===3);
  const cacheOnly=(await calls(page))[2].args;
  assert.equal(cacheOnly.includeSiteData,false);assert.equal('resetProfile' in cacheOnly,false);checks++;

  await page.evaluate(()=>(window as any).identityFixture.language('en'));
  await page.getByRole('button',{name:'Clear all browser data',exact:true}).click();
  dialog=page.getByRole('alertdialog',{name:'Clear all browser data',exact:true});await dialog.waitFor();
  assert.match(await dialog.innerText(),/saved passwords and keys, bookmarks, history, extensions, settings and cache/);
  assert.match(await dialog.innerText(),/current identity/);
  assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await dialog.getByRole('button',{name:'Confirm full cleanup',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();checks++;
  assert.deepEqual(errors,[]);
  return checks;
 } finally {await context.close();}
}
