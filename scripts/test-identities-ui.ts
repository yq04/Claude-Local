/**
 * [INPUT]: Node.js 标准管道、已锁定 playwright-core、固定引擎、Vite 与 tests/ 的虚构 Tauri IPC。
 * [OUTPUT]: 单行本地保存名与长名称重命名、隐私提示、工牌/离线额度、浏览器/网络与清理确认、真实阶段动画及额度重置推定恢复的双语 DOM 验收。
 * [POS]: 发布前无头行为回归；无真实账号/文件修改，不加载原生宿主，不允许外网请求。支持 --quota-reset-only、--passive-only、--wakeup-only、--verification-only 与 --warming-only；养号预览仅存 ignored .local/。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import {resolve,join} from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium, type Locator} from 'playwright-core';
import {testBrowserVerification} from './test-browser-verification.ts';
import {testBrowserProfiles} from './test-browser-profiles.ts';
import {testBrowserCleanup} from './test-browser-cleanup.ts';
import {testNetworkDiagnostics} from './test-network-diagnostics.ts';
import {testClaudeResidue} from './test-claude-residue.ts';
import {testIdentityOperation} from './test-identity-operation.ts';
import {testQuotaReset} from './test-quota-reset.ts';
import {testIdentityOnline} from './test-identity-online.ts';
import {testIdentityPassive} from './test-identity-passive.ts';
import {testNativeWakeup} from './test-native-wakeup.ts';
import {testWarmingUi} from './test-warming-ui.ts';
const warmingOnly=process.argv.includes('--warming-only');
const wakeupOnly=process.argv.includes('--wakeup-only');
const verificationOnly=process.argv.includes('--verification-only');
const quotaResetOnly=process.argv.includes('--quota-reset-only');
const onlineOnly=process.argv.includes('--online-only');
const passiveOnly=process.argv.includes('--passive-only');
const cardsOnly=process.argv.includes('--cards-only');
async function cardAction(card:Locator,name:string){
 await card.getByRole('button',{name:/^(更多操作|More actions)$/}).click();
 await card.page().getByRole('menuitem',{name,exact:true}).click();
}
const engine=process.platform==='darwin'?'Browser.app/Contents/MacOS/Chromium':process.platform==='win32'?'WindowsBrowser/chrome.exe':'LinuxBrowser/chrome';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/src-tauri/**','**/browser-runtime/**','**/releases/**','**/dist/**']}},optimizeDeps:{include:['@tauri-apps/api/mocks']}});
await server.listen();
const address=server.httpServer!.address() as {port:number};
const base=`http://127.0.0.1:${address.port}`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('APPLE_')&&!key.startsWith('TAURI_SIGNING_PRIVATE_KEY'))) as Record<string,string>;
// ----- 临时 HOME/XDG 避免容器环境的只读配置和真实浏览器资料 -----
const temporary=await mkdtemp(join(tmpdir(),'claude-local-ui-'));
for(const name of ['config','cache'])await mkdir(join(temporary,name));
Object.assign(env,{HOME:temporary,XDG_CONFIG_HOME:join(temporary,'config'),XDG_CACHE_HOME:join(temporary,'cache')});
let browser;
try{browser=await chromium.launch({executablePath:resolve('browser-runtime',engine),headless:true,env});}
catch(error){await server.close();await rm(temporary,{recursive:true,force:true});throw error;}
let checks=0;
try{
 if(warmingOnly){
  checks+=await testWarmingUi(browser,base);
  console.log(`${checks} warming UI checks passed; synthetic context only.`);
 }else if(verificationOnly){
  checks+=await testBrowserVerification(browser,base);
  console.log(`${checks} browser verification UI checks passed; synthetic context only.`);
 }else if(wakeupOnly){
  checks+=await testNativeWakeup(browser,base);
  console.log(`${checks} native wakeup bridge UI checks passed; synthetic IPC only.`);
 }else if(passiveOnly){
  checks+=await testIdentityPassive(browser,base);
  console.log(`${checks} passive quota UI checks passed; synthetic IPC only.`);
 }else if(onlineOnly){
  checks+=await testIdentityOnline(browser,base);
  checks+=await testIdentityPassive(browser,base);
  console.log(`${checks} online quota/card UI checks passed; synthetic IPC only.`);
 }else if(quotaResetOnly){
  checks+=await testQuotaReset(browser,base);
  console.log(`${checks} quota reset UI simulation checks passed; no native commands or user data used.`);
 }else{
  const context=await browser.newContext({viewport:{width:1040,height:820},reducedMotion:'no-preference'});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')console.error(message.text());});page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 await page.goto(base+'/tests/identities.html',{waitUntil:'domcontentloaded',timeout:30000});
 await page.evaluate(async()=>{const prefs=await import('/src/settings-model.ts');await prefs.synchronizePrivacyPreference(false);});
 const cards=page.locator('.identity-card');
 await page.getByText('fixture@example.invalid',{exact:true}).waitFor();
 assert.equal(await cards.count(),40);assert.equal(await page.getByRole('button',{name:'新身份',exact:true}).count(),1);
 assert.equal(await page.locator('.identity-switcher').count(),0);
 assert.equal(await page.getByText('上次使用',{exact:true}).count(),0);
 assert.equal(await cards.filter({has:page.getByRole('heading',{name:'Identity 1',exact:true})}).count(),1);
 assert.equal(await page.locator('.identity-card.current h3[data-identity-name] > strong').innerText(),'Identity 1','The current identity must prefer its local saved name');
 assert.equal(await cards.locator('.identity-user-name,.identity-saved-name').count(),0,'Account names must not add a second visible title row');
 assert.match(await page.locator('.identity-library:not(.identity-warming-library) .identity-onboarding-bar').innerText(),/添加新号 3 步法/);checks++;
 const geometry=await cards.evaluateAll(nodes=>nodes.slice(0,3).map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert.equal(geometry[0].y,geometry[2].y);assert(geometry[2].x+geometry[2].width<1040-150);assert(Math.abs(geometry[0].width/geometry[0].height-54/85.6)<.01);checks++;
 assert.equal(await page.getByRole('checkbox',{name:'联动浏览器',exact:true}).isChecked(),true);
 await page.getByRole('checkbox',{name:'联动浏览器',exact:true}).click();
 let linking=page.getByRole('dialog');await linking.waitFor();
 await linking.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await page.getByRole('checkbox',{name:'联动浏览器',exact:true}).isChecked(),true);
 await page.getByRole('checkbox',{name:'联动浏览器',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
 await page.waitForFunction(()=>(window as any).identityFixture.state.browser.enabled===false);
 await page.getByRole('checkbox',{name:'联动浏览器',exact:true}).click();
 linking=page.getByRole('dialog');
 assert.equal(await linking.getByRole('checkbox',{name:'将现有浏览器资料关联给当前身份'}).isChecked(),false);
 await linking.getByRole('button',{name:'确认',exact:true}).click();
 await page.waitForFunction(()=>(window as any).identityFixture.state.browser.enabled===true);checks++;
 const current=page.locator('.identity-card.current');
 const stopsBeforeQuota=await page.evaluate(()=>(window as any).identityFixture.commands.filter((row:any)=>row.command==='identities_stop').length);
 await current.locator('.identity-quota-open').click();
 let quotaDialog=page.getByRole('dialog');
 await quotaDialog.getByText('额度与重置权益',{exact:true}).waitFor();
 assert.equal(await quotaDialog.getByText('可用主动重置次数',{exact:true}).count(),1);
 assert.equal(await quotaDialog.getByRole('button',{name:'打开官方用量页',exact:true}).isEnabled(),true);
 await quotaDialog.getByRole('button',{name:'打开官方用量页',exact:true}).click();
 await quotaDialog.getByText('已在当前身份的浏览器资料中打开官方用量页，请核对网页实际登录账号。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>(window as any).identityFixture.commands.filter((row:any)=>row.command==='identities_stop').length),stopsBeforeQuota);
 await quotaDialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 await cards.nth(1).locator('.identity-quota-open').click();
 quotaDialog=page.getByRole('dialog');
 assert.equal(await quotaDialog.getByRole('button',{name:'打开官方用量页',exact:true}).isEnabled(),false);
 await quotaDialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();checks++;
 await cardAction(current,'直接删除');
 await page.getByRole('alertdialog').getByText('PID 4201',{exact:true}).waitFor();
 await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();checks++;

 const light=await current.evaluate(node=>getComputedStyle(node,'::before').boxShadow);assert.match(light,/67, 228, 132/);
 await page.mouse.move(geometry[0].x+90,geometry[0].y+85);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.identity-card.current')!).transform!=='none');
 assert.equal((await current.evaluate(node=>getComputedStyle(node).transform)).includes('matrix3d'),false);
 await page.mouse.move(10,10);checks++;
 const rail=page.locator('.identity-library:not(.identity-warming-library) .identity-card-rail');
 await rail.hover();await page.mouse.wheel(0,800);
 await page.waitForFunction(()=>document.querySelector('.identity-card-rail')!.scrollLeft>50);
 const mid=await rail.evaluate(node=>node.scrollLeft);assert(mid<801);
 await page.waitForFunction(()=>Math.abs(document.querySelector('.identity-card-rail')!.scrollLeft-800)<3);checks++;
 await rail.evaluate(node=>{node.scrollLeft=0;});
 await page.waitForFunction(()=>document.querySelector('.identity-card-rail')!.scrollLeft<1);
 await page.mouse.move(10,10);
 await cardAction(current,'直接删除');
  let dialog=page.getByRole('alertdialog');await dialog.waitFor();
 assert.match(await dialog.innerText(),/不可撤销/);assert.equal(await dialog.getByRole('button',{name:'确认直接删除'}).isEnabled(),false);
 assert.equal(await dialog.getByRole('button',{name:'取消'}).evaluate(node=>node===document.activeElement),true);
 await page.mouse.click(3,3);assert.equal(await dialog.count(),1);
 await dialog.getByRole('button',{name:'取消'}).click();
 assert.equal(await page.evaluate(()=>((window as any).identityFixture.commands as any[]).filter(row=>row.command==='identities_delete').length),0);checks++;
 assert.match(await current.innerText(),/Pro/i);assert.doesNotMatch(await current.innerText(),/凭据有效|待自动续期|推荐切换/);
 assert.match(await current.locator('[data-quota-window="5h"]').innerText(),/剩余 65%/);
 assert.match(await current.locator('[data-quota-window="7d"]').innerText(),/剩余 60%/);
 const savedSecond=cards.filter({has:page.getByRole('heading',{name:'Identity 2',exact:true})});
 assert.match(await savedSecond.innerText(),/user2@example\.invalid/);
 assert.equal(await savedSecond.locator('.identity-organization').count(),0);
 assert.match(await savedSecond.locator('[data-quota-window="5h"]').innerText(),/剩余 80%/);
 assert.match(await savedSecond.locator('[data-quota-window="7d"]').innerText(),/剩余 70%/);
 assert.equal(await page.getByRole('button',{name:'切到最优号',exact:true}).count(),1);
 await current.getByRole('button',{name:'更新备份',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.match(await dialog.innerText(),/PID 4201/);assert.match(await dialog.innerText(),/Claude-Local/);
 await dialog.getByRole('button',{name:'确认保存备份',exact:true}).click();
 await page.waitForFunction(()=>((window as any).identityFixture.commands as any[]).some(row=>row.command==='identities_save'));
 assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.current.present),true);checks++;
 await page.getByText('保留在工作区',{exact:true}).click();
 await page.getByRole('checkbox',{name:'Skills 与命令'}).uncheck();
 await page.getByRole('button',{name:'新身份',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByLabel('当前身份保存为').fill('First archive');
 await dialog.getByRole('button',{name:'确认暂存并切换'}).click();
 await page.waitForFunction(()=>!(window as any).identityFixture.state.current.present);
 assert.equal(await page.locator('.identity-card.current').count(),0);
 assert.equal(await cards.first().getByRole('heading').innerText(),'新身份');
 const request=await page.evaluate(()=>((window as any).identityFixture.commands as any[]).find(row=>row.command==='identities_switch').args);
 assert.equal(request.policy.skills,false);assert.equal(request.targetId,'empty');assert.equal(request.currentName,'First archive');checks++;
 const target=page.locator('.identity-card:not(.current)').filter({has:page.getByRole('heading',{name:'Identity 3',exact:true})});
 await target.getByRole('button',{name:'切换',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认暂存并切换'}).click();await page.locator('.identity-card.current').getByRole('heading',{name:'Identity 3',exact:true}).waitFor();checks++;
 assert.equal(await target.count(),0);checks++;
 const bound=cards.filter({has:page.getByRole('heading',{name:'Identity 1',exact:true})});
 await cardAction(bound,'删除');
 const browserDeletion=page.getByRole('alertdialog');
 assert.equal(await browserDeletion.getByRole('checkbox',{name:'同时永久删除关联浏览器资料'}).isChecked(),false);
 await browserDeletion.getByRole('button',{name:'取消',exact:true}).click();checks++;
 const other=page.locator('.identity-card:not(.current)').filter({has:page.getByRole('heading',{name:'Identity 4',exact:true})});
 const beforeRename=await other.evaluate(node=>{const card=node.getBoundingClientRect(),heading=node.querySelector('h3')!.getBoundingClientRect(),email=node.querySelector('.identity-email')!.getBoundingClientRect();return {width:card.width,height:card.height,headingHeight:heading.height,emailOffset:email.top-card.top};});
 const renamedLabel='Renamed fixture — synthetic long local account archive name';
 await cardAction(other,'重命名');
 await page.getByRole('dialog').getByRole('textbox',{name:'身份名称'}).fill(renamedLabel);
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 const renamed=cards.filter({has:page.getByRole('heading',{name:renamedLabel,exact:true})});await renamed.waitFor();
 const renamedTitle=renamed.locator('h3[data-identity-name] > strong');
 assert.equal(await renamedTitle.innerText(),renamedLabel);
 assert.match(await renamedTitle.getAttribute('title')||'',/Identity 4/);
 assert.match(await renamed.locator('h3[data-identity-name]').getAttribute('aria-description')||'',/Identity 4/);
 assert.equal(await renamed.locator('.identity-user-name,.identity-saved-name').count(),0);
 assert.equal(await renamed.locator('.identity-email').count(),1);
 const afterRename=await renamed.evaluate(node=>{const card=node.getBoundingClientRect(),heading=node.querySelector('h3')!.getBoundingClientRect(),email=node.querySelector('.identity-email')!.getBoundingClientRect(),title=getComputedStyle(node.querySelector('h3 > strong')!);return {width:card.width,height:card.height,headingHeight:heading.height,emailOffset:email.top-card.top,whiteSpace:title.whiteSpace,overflow:title.overflow,textOverflow:title.textOverflow};});
 assert.deepEqual({width:afterRename.width,height:afterRename.height},{width:180,height:286});
 assert.equal(afterRename.headingHeight,beforeRename.headingHeight,'A long rename must not grow the title row');
 assert.equal(afterRename.emailOffset,beforeRename.emailOffset,'Renaming must not push the email or quota content down');
 assert.equal(afterRename.whiteSpace,'nowrap');assert.equal(afterRename.overflow,'hidden');assert.equal(afterRename.textOverflow,'ellipsis');
 const renamedSummary=await page.evaluate(()=>(window as any).identityFixture.state.summaries['00000000000000000000000000000004']);
 assert.equal(renamedSummary.display_name,'Identity 4','Renaming a local archive must preserve its account metadata');
 await page.evaluate(async()=>{const {updatePreferences}=await import('/src/settings-model.ts');updatePreferences({privacyMask:true});});
 await page.waitForFunction(label=>{const heading=Array.from(document.querySelectorAll('h3[data-identity-name]')).find(node=>node.querySelector('strong')?.textContent===label);return heading&&!heading.getAttribute('aria-description')?.includes('Identity 4');},renamedLabel);
 assert.equal((await renamedTitle.getAttribute('title')||'').includes('Identity 4'),false);
 assert.equal((await renamed.locator('h3[data-identity-name]').getAttribute('aria-description')||'').includes('Identity 4'),false);
 assert.equal((await renamed.locator('.identity-email').getAttribute('title')||'').includes('user4@example.invalid'),false);
 await page.evaluate(async()=>{const {updatePreferences}=await import('/src/settings-model.ts');updatePreferences({privacyMask:false});});
 checks++;
 await cardAction(renamed,'删除');dialog=page.getByRole('alertdialog');
 await dialog.getByRole('checkbox',{name:'我知道此操作无法撤销'}).check();
 await dialog.getByRole('button',{name:'确认直接删除'}).click();await renamed.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.current.present),true);checks++;
 await page.evaluate(()=>{(window as any).identityFixture.language('en');});
 await page.getByRole('button',{name:'New identity',exact:true}).waitFor();assert.match(await page.locator('.identity-library:not(.identity-warming-library) .identity-onboarding-bar').innerText(),/Add a new account in 3 steps/);checks++;
 await page.evaluate(()=>{(window as any).identityFixture.setFailure('identities_switch');});
 await page.getByRole('button',{name:'New identity',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Archive & switch'}).click();
 await page.getByText(/fixture operation failed/).first().waitFor();assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.current.present),true);checks++;
 await page.evaluate(()=>{(window as any).identityFixture.recover();});
 await page.getByRole('button',{name:await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('identityCard.localQuotaSync')),exact:true}).click();
 await page.getByRole('button',{name:'Restore previous identity',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Restore'}).click();
 await page.waitForFunction(()=>(window as any).identityFixture.state.recovery===null);checks++;
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.mouse.move(10,10);await page.waitForTimeout(250);
 const before=await current.getAttribute('style');await current.hover();await page.waitForTimeout(150);
 assert.equal(await current.getAttribute('style'),before);checks++;
 await cardAction(current,'Delete permanently');dialog=page.getByRole('alertdialog');
 await dialog.getByRole('checkbox',{name:'I understand this cannot be undone'}).check();
 const count=await page.evaluate(()=>(window as any).identityFixture.state.records.length);
 await dialog.getByRole('button',{name:'Confirm deletion',exact:true}).click();
 await current.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.records.length),count);checks++;
 assert.equal(errors.length,0,errors.join('\n'));
 if(!cardsOnly){
 checks+=await testBrowserVerification(browser,base);
 checks+=await testBrowserCleanup(browser,base);
 checks+=await testNetworkDiagnostics(browser,base);
 checks+=await testClaudeResidue(browser,base);
 checks+=await testIdentityOperation(browser,base);
 checks+=await testBrowserProfiles(resolve('browser-runtime',engine),base,temporary,env);
 }
  checks+=await testQuotaReset(browser,base);
  console.log(`${checks} identity, browser, network and quota reset UI simulation checks passed; no native commands or user data used.`);
 }
}finally{await browser.close();await server.close();await rm(temporary,{recursive:true,force:true});}
