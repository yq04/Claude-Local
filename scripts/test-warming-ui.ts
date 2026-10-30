/**
 * [INPUT]: 现有隔离 Playwright 引擎、Vite 本机地址与 tests/identities.html 的虚构 Tauri IPC。
 * [OUTPUT]: 养号创建/编辑/浏览器运行状态隔离、冻结CLI返回和用量页、BrowserPanel配置草稿同步、统一数量标签/可读邮箱/精简引导及双语隐私180×286卡片。
 * [POS]: 养号卡专用合成 UI 行为回归；不触碰真实数据/CLI/网络，卡片与空状态预览仅存 ignored .local/tasks/。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {strict as assert} from 'node:assert';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Browser,Locator} from 'playwright-core';

export async function testWarmingUi(browser: Browser, base: string): Promise<number> {
  const context = await browser.newContext({viewport: {width: 1040, height: 820}, reducedMotion: 'reduce'});
  let checks = 0;
  try {
    await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    const presentation:{locale:string;emailColor:string;emailOpacity:string}[]=[];
    page.on('pageerror', e => errors.push(e.message));
    const evidence=resolve('.local/tasks/browser-context-implementation-20261030');
    await mkdir(evidence,{recursive:true});
    const waitRuntime=async(card:Locator,status:string)=>{
      const cardId=await card.getAttribute('data-warming-id');
      await page.waitForFunction(({cardId,status})=>document.querySelector(`[data-warming-id="${cardId}"]`)?.getAttribute('data-browser-runtime')===status,{cardId,status});
    };
    const browserActions=()=>page.evaluate(()=>(window as any).identityFixture.commands.filter((row:any)=>['browser_return_to_cli','browser_open_usage','browser_launch','identities_stop','identities_save','identities_switch'].includes(row.command)));

    const todayYmd = '2026-10-29';
    const fakeNow = new Date('2026-10-29T12:00:00Z');
    await page.clock.install({time: fakeNow});
    await page.clock.pauseAt(new Date(fakeNow.getTime() + 1000));

    await page.goto(base + '/tests/identities.html', {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.waitForFunction(() => Boolean((window as any).identityFixture?.identityReads));

    // 初始关闭隐私模式便于检查字段
    await page.evaluate(async () => {
      const prefs = await import('/src/settings-model.ts');
      await prefs.synchronizePrivacyPreference(false);
    });

    const warmingSection = page.locator('section.identity-warming-library');
    await warmingSection.waitFor();
    const cliBefore = await page.evaluate(() => {
      const {active, current, records} = (window as any).identityFixture.state;
      return {active, current, records};
    });

    // 1. 验证空状态与四步法引导
    assert.equal(await warmingSection.getByRole('heading', {level: 2}).innerText(), '养号');
    assert.match(await warmingSection.locator('[data-card-count="warming"]').innerText(), /0 张养号卡/);
    assert.match(await warmingSection.locator('.identity-onboarding-bar').innerText(), /养号 4 步法/);
    assert.match(await warmingSection.locator('.warming-empty').innerText(), /新建养号卡后/);
    await mkdir(resolve('.local/tasks/warming-polish'), {recursive: true});
    await warmingSection.screenshot({path: resolve('.local/tasks/warming-polish/empty-preview.png')});
    checks++;

    // 2. 创建养号卡表单与调用（验证零 CLI 触碰）
    await warmingSection.locator('[data-warming-create]').click();
    const createDialog = page.getByRole('dialog');
    await createDialog.waitFor();

    await page.locator('#warming-name').fill('Synthetic Free Alpha');
    await page.locator('#warming-email').fill('alpha@example.invalid');
    await page.locator('#warming-note').fill('Test note for Alpha');
    await page.locator('#warming-stage').selectOption('unregistered');
    await page.locator('#warming-created').fill(todayYmd);
    await page.locator('#warming-open-mode').selectOption('switch_only');

    await createDialog.getByRole('button', {name: /创建养号卡|Create warming card/}).click();
    const cardAlpha = warmingSection.locator('article.warming-card[data-warming-stage="unregistered"]').first();
    await cardAlpha.waitFor();
    await waitRuntime(cardAlpha,'closed');
    assert.equal(await cardAlpha.getAttribute('data-browser-active'),'true');
    assert.equal(await cardAlpha.evaluate(node=>node.classList.contains('browser-active')),false,'Selecting a profile must not claim the browser is running');
    checks++;

    // 验证调用命令：有 identities_warming_create，严禁出现 identities_stop/save/switch
    const commandsAfterCreate = await page.evaluate(() => (window as any).identityFixture.commands);
    const createCmd = commandsAfterCreate.find((c: any) => c.command === 'identities_warming_create');
    assert(createCmd, 'identities_warming_create must be recorded');
    assert.equal(createCmd.args.name, 'Synthetic Free Alpha');
    assert.equal(createCmd.args.email, 'alpha@example.invalid');
    assert.equal(createCmd.args.stage, 'unregistered');
    assert.equal(createCmd.args.openMode, 'switch_only');
    const cliStopSaveSwitch = commandsAfterCreate.filter((c: any) => ['identities_stop', 'identities_save', 'identities_switch'].includes(c.command));
    assert.equal(cliStopSaveSwitch.length, 0, 'Warming creation must never invoke CLI stop/save/switch');
    checks++;

    // 3. 待注册阶段主按钮：核验并注册（openMode = verify），仍零 CLI 触碰
    await cardAlpha.locator('[data-warming-open]').click();
    const openCmd = await page.evaluate(() => {
      const cmds = (window as any).identityFixture.commands;
      return cmds.find((c: any) => c.command === 'identities_warming_open');
    });
    assert(openCmd, 'identities_warming_open must be called');
    assert.equal(openCmd.args.openMode, 'verify');
    const cliAfterOpen = await page.evaluate(() => {
      const cmds = (window as any).identityFixture.commands;
      return cmds.filter((c: any) => ['identities_stop', 'identities_save', 'identities_switch'].includes(c.command)).length;
    });
    assert.equal(cliAfterOpen, 0, 'Warming open must never invoke CLI stop/save/switch');
    checks++;

    // External close/reopen changes only lightweight runtime; selection and seed stay stable.
    await waitRuntime(cardAlpha,'running');
    const selectedProfile=await page.evaluate(()=>{
      const f=(window as any).identityFixture;return {slot:f.state.active_browser_slot,seed:f.state.warming_cards[0].seed,reads:f.identityReads};
    });
    for(const [running,windowOpen,status] of [[true,false,'closed'],[true,true,'running'],[null,null,'unknown']] as const){
      await page.evaluate(({running,windowOpen})=>(window as any).identityFixture.setRuntime({running,window_open:windowOpen}),{running,windowOpen});
      await page.clock.runFor(3100);
      await waitRuntime(cardAlpha,status);
      assert.equal(await cardAlpha.getAttribute('data-browser-active'),'true');
      assert.equal(await cardAlpha.evaluate(node=>node.classList.contains('browser-active')),status==='running');
      const profile=await page.evaluate(()=>{
        const f=(window as any).identityFixture;return {slot:f.state.active_browser_slot,seed:f.state.warming_cards[0].seed,reads:f.identityReads};
      });
      assert.deepEqual(profile,selectedProfile,'Runtime refresh must preserve profile/seed and avoid full identity reads');
      if(status!=='running')assert.doesNotMatch(await cardAlpha.locator('.identity-live-badge').innerText(),/^(运行中|Running)$/);
      if(status==='closed')await cardAlpha.screenshot({path:resolve(evidence,'warming-selected-closed.png')});
    }
    await page.evaluate(()=>(window as any).identityFixture.setRuntime({running:true,window_open:true}));
    await page.clock.runFor(3100);
    await waitRuntime(cardAlpha,'running');
    checks++;

    // Returning to Pro is an explicit browser-only action, with no command on cancellation.
    const currentCard=page.locator('.identity-card.current');
    const actionsBeforeReturn=await browserActions();
    for(const locale of ['zh','en']){
      await page.evaluate(locale=>(window as any).identityFixture.language(locale),locale);
      await currentCard.locator('button.identity-menu-trigger').click();
      await page.locator('[data-return-cli-browser]').click();
      const dialog=page.getByRole('alertdialog').filter({has:page.locator('[data-return-cli-dialog]')});
      await dialog.waitFor();
      await dialog.locator('[data-dialog-cancel]').click();
      await dialog.waitFor({state:'detached'});
      assert.deepEqual(await browserActions(),actionsBeforeReturn,'Cancelling return must not invoke browser or CLI actions');
    }
    await page.evaluate(()=>(window as any).identityFixture.language('zh'));
    await currentCard.locator('button.identity-menu-trigger').click();
    await page.locator('[data-return-cli-browser]').click();
    await page.locator('[data-return-cli-confirm]').click();
    await page.waitForFunction(()=>(window as any).identityFixture.state.active_browser_slot==='cli-fixture-1');
    await waitRuntime(cardAlpha,'unknown');
    const returnActions=(await browserActions()).slice(actionsBeforeReturn.length);
    assert.deepEqual(returnActions.map((row:any)=>row.command),['browser_return_to_cli']);
    assert.equal(returnActions[0].args.expectedIdentity,cliBefore.current.quota_identity);
    assert.equal(await cardAlpha.getAttribute('data-browser-active'),'false');
    checks++;

    // Usage freezes current CLI fingerprint; a changed account is rejected before rebinding.
    await cardAlpha.locator('[data-warming-open]').click();
    await waitRuntime(cardAlpha,'running');
    await currentCard.locator('.identity-quota-open').click();
    let usageDialog=page.getByRole('dialog');
    const usageLabel=await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('quota.openOfficial'));
    await page.evaluate(()=>(window as any).identityFixture.defer('browser_open_usage'));
    await usageDialog.getByRole('button',{name:usageLabel,exact:true}).click();
    await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('browser_open_usage'));
    await page.evaluate(()=>{
      const f=(window as any).identityFixture;f.state.current.quota_identity='2'.padStart(64,'0');f.release('browser_open_usage');
    });
    const mismatchLabel=await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('quotaOnline.accountMismatch'));
    await usageDialog.getByText(mismatchLabel,{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.active_browser_slot),selectedProfile.slot);
    const rejectedUsage=(await browserActions()).at(-1);
    assert.equal(rejectedUsage.command,'browser_open_usage');
    assert.equal(rejectedUsage.args.expectedIdentity,cliBefore.current.quota_identity);
    await page.evaluate(expected=>(window as any).identityFixture.state.current.quota_identity=expected,cliBefore.current.quota_identity);
    await usageDialog.getByRole('button',{name:await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('关闭弹窗')),exact:true}).click();
    await currentCard.locator('.identity-quota-open').click();
    usageDialog=page.getByRole('dialog');
    await usageDialog.getByRole('button',{name:usageLabel,exact:true}).click();
    await usageDialog.getByText(await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('quota.opened')),{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>(window as any).identityFixture.state.active_browser_slot),selectedProfile.slot,'Usage opens the frozen CLI profile without replacing the selected warming slot');
    const usageActions=(await browserActions()).slice(actionsBeforeReturn.length);
    assert.deepEqual(usageActions.map((row:any)=>row.command),['browser_return_to_cli','browser_open_usage','browser_open_usage']);
    assert(usageActions.every((row:any)=>row.args.expectedIdentity===cliBefore.current.quota_identity));
    await usageDialog.getByRole('button',{name:await page.evaluate(async()=>(await import('/src/i18n.ts')).translate('关闭弹窗')),exact:true}).click();
    await cardAlpha.locator('[data-warming-open]').click();
    await waitRuntime(cardAlpha,'running');
    assert.deepEqual(await page.evaluate(()=>{
      const {active,current,records}=(window as any).identityFixture.state;return {active,current,records};
    }),cliBefore,'Returning and opening usage must preserve all CLI identity state');
    checks++;

    // 4. 编辑养号卡（名称、阶段、备注）
    await cardAlpha.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="edit"]').click();
    const editDialog = page.getByRole('dialog');
    await editDialog.waitFor();
    await page.locator('#warming-name').fill('Synthetic Free Alpha Renamed');
    await page.locator('#warming-stage').selectOption('kyc_passed');
    await page.locator('#warming-note').fill('Note updated to KYC passed');
    await editDialog.getByRole('button', {name: /保存|Save/}).click();

    const cardKyc = warmingSection.locator('article.warming-card[data-warming-stage="kyc_passed"]').first();
    await cardKyc.waitFor();
    assert.match(await cardKyc.innerText(), /Synthetic Free Alpha Renamed/);
    const updateCmd = await page.evaluate(() => {
      const cmds = (window as any).identityFixture.commands;
      return cmds.find((c: any) => c.command === 'identities_warming_update');
    });
    assert(updateCmd, 'identities_warming_update must be called');
    assert.equal(updateCmd.args.name, 'Synthetic Free Alpha Renamed');
    assert.equal(updateCmd.args.stage, 'kyc_passed');
    checks++;

    // Every browser menu path must use the warming command, never a CLI switch.
    for (const [action, mode] of [['open', 'claude_ai'], ['verify', 'verify'], ['switch', 'switch_only']]) {
      await cardKyc.locator('button.identity-menu-trigger').click();
      await page.locator(`[data-warming-action="${action}"]`).click();
      await page.waitForFunction(mode => {
        const commands = (window as any).identityFixture.commands;
        return commands.filter((row: any) => row.command === 'identities_warming_open').at(-1)?.args.openMode === mode;
      }, mode);
      await cardKyc.locator('button.identity-menu-trigger').waitFor({state: 'visible'});
      const browserState = await page.evaluate(() => {
        const state = (window as any).identityFixture.state;
        const card = state.warming_cards[0];
        return {slot: state.active_browser_slot, expectedSlot: card.slot, active: state.active, current: state.current, records: state.records};
      });
      assert.equal(browserState.slot, browserState.expectedSlot);
      assert.deepEqual({active: browserState.active, current: browserState.current, records: browserState.records}, cliBefore);
    }
    assert.equal(await page.evaluate(() => (window as any).identityFixture.commands.filter((row: any) => ['identities_stop', 'identities_save', 'identities_switch'].includes(row.command)).length), 0);
    checks++;

    // This verifies confirmation copy only: the fixture does not simulate native browser lifetime.
    for (const locale of ['zh', 'en']) {
      await page.evaluate(locale => (window as any).identityFixture.language(locale), locale);
      const labels = await page.evaluate(async () => {
        const {translate} = await import('/src/i18n.ts');
        return {switch: translate('切换'), cancel: translate('取消'), keepsBrowser: translate('warming.cliSwitchKeepsBrowser'), restartsBrowser: translate('将关闭并重开关联浏览器，请先保存网页任务。')};
      });
      const savedCli = page.locator('.identity-library:not(.identity-warming-library) .identity-card:not(.current)').filter({has: page.getByRole('heading', {name: 'Identity 2', exact: true})});
      await savedCli.getByRole('button', {name: labels.switch, exact: true}).click();
      const switchDialog = page.getByRole('dialog');
      await switchDialog.getByText(labels.keepsBrowser, {exact: true}).waitFor();
      assert.equal(await switchDialog.getByText(labels.restartsBrowser, {exact: true}).count(), 0);
      await switchDialog.getByRole('button', {name: labels.cancel, exact: true}).click();
      await switchDialog.waitFor({state: 'detached'});
    }
    await page.evaluate(() => (window as any).identityFixture.language('zh'));
    assert.equal(await page.evaluate(() => (window as any).identityFixture.commands.filter((row: any) => ['identities_stop', 'identities_save', 'identities_switch'].includes(row.command)).length), 0, 'Cancelling ordinary CLI switch must not execute identity commands');
    checks++;

    // 5. 注入包含全部4个阶段与不同天数/互动状态的卡片组
    await page.evaluate(today => {
      const state = (window as any).identityFixture.state;
      state.warming_cards = [
        {
          id: '10000000000000000000000000000001',
          name: 'Card Unregistered',
          email: 'unreg@example.invalid',
          note: 'New card pending verify',
          stage: 'unregistered',
          created_ymd: today,
          last_warmed_ymd: today,
          created_at: 1780000000,
          updated_at: 1780000000,
          slot: 'warming-slot-1',
          seed: 1111,
          browser_active: true,
          region_summary: 'US · America/New_York',
          has_custom_proxy: false,
          subscription_expiry_ymd: null,
          subscription_recharge_ymd: null,
          subscription_date_source: null,
          subscription_expires_at: null,
        },
        {
          id: '10000000000000000000000000000002',
          name: 'Card KYC Passed',
          email: 'kyc@example.invalid',
          note: 'Residential proxy configured',
          stage: 'kyc_passed',
          created_ymd: '2026-10-27',
          last_warmed_ymd: '2026-10-28',
          created_at: 1779800000,
          updated_at: 1779800000,
          slot: 'warming-slot-2',
          seed: 2222,
          browser_active: false,
          region_summary: 'US · America/Chicago',
          has_custom_proxy: true,
          subscription_expiry_ymd: null,
          subscription_recharge_ymd: null,
          subscription_date_source: null,
          subscription_expires_at: null,
        },
        {
          id: '10000000000000000000000000000003',
          name: 'Card Warming Free',
          email: 'warming@example.invalid',
          note: 'Daily conversations active',
          stage: 'warming_free',
          created_ymd: '2026-10-22',
          last_warmed_ymd: null,
          created_at: 1779300000,
          updated_at: 1779300000,
          slot: 'warming-slot-3',
          seed: 3333,
          browser_active: false,
          region_summary: 'US · America/Los_Angeles',
          has_custom_proxy: false,
          subscription_expiry_ymd: null,
          subscription_recharge_ymd: null,
          subscription_date_source: null,
          subscription_expires_at: null,
        },
        {
          id: '10000000000000000000000000000004',
          name: 'Card Pro Ready',
          email: 'proready@example.invalid',
          note: 'Upgraded on web, ready for CLI',
          stage: 'pro_ready',
          created_ymd: '2026-10-15',
          last_warmed_ymd: today,
          created_at: 1778700000,
          updated_at: 1778700000,
          slot: 'warming-slot-4',
          seed: 4444,
          browser_active: false,
          region_summary: 'US · America/New_York',
          has_custom_proxy: true,
          subscription_expiry_ymd: null,
          subscription_recharge_ymd: null,
          subscription_date_source: null,
          subscription_expires_at: null,
        },
      ];
      state.active_browser_slot='warming-slot-1';
      (window as any).identityFixture.setRuntime({slot:'warming-slot-1',running:true,window_open:true});
      (window as any).identityFixture.remountIdentity();
    }, todayYmd);

    await warmingSection.locator('article.warming-card').nth(3).waitFor();
    assert.equal(await warmingSection.locator('article.warming-card').count(), 4);
    checks++;

    // 验证各卡天数与状态：
    // Card 1: Day 1, 今日已互动 (created today, warmed today)
    const c1 = warmingSection.locator('article.warming-card[data-warming-id="10000000000000000000000000000001"]');
    assert.match(await c1.locator('.warming-progress-window').innerText(), /Day 1/);
    assert.match(await c1.locator('.warming-progress-window').innerText(), /今日已互动/);
    await waitRuntime(c1,'running');
    assert.equal(await c1.locator('.identity-live-badge').innerText(),'运行中');
    assert.match(await c1.locator('[data-warming-open]').innerText(), /核验并注册/);

    // Card 2: Day 3, 今日待打开 (created 2026-10-27, warmed 10-28)
    const c2 = warmingSection.locator('article.warming-card[data-warming-id="10000000000000000000000000000002"]');
    assert.match(await c2.locator('.warming-progress-window').innerText(), /Day 3/);
    assert.match(await c2.locator('.warming-progress-window').innerText(), /今日待打开/);
    assert.match(await c2.locator('.identity-live-badge').innerText(), /已过 KYC/);
    assert.match(await c2.locator('[data-warming-open]').innerText(), /进入 Claude.ai/);

    // Card 3: Day 8, 今日待打开 (created 2026-10-22, null warmed)
    const c3 = warmingSection.locator('article.warming-card[data-warming-id="10000000000000000000000000000003"]');
    assert.match(await c3.locator('.warming-progress-window').innerText(), /Day 8/);
    assert.match(await c3.locator('.warming-progress-window').innerText(), /今日待打开/);
    assert.match(await c3.locator('.identity-live-badge').innerText(), /养号中/);

    // Card 4: Day 15, 今日已互动 (created 2026-10-15, warmed today)
    const c4 = warmingSection.locator('article.warming-card[data-warming-id="10000000000000000000000000000004"]');
    assert.match(await c4.locator('.warming-progress-window').innerText(), /Day 15/);
    assert.match(await c4.locator('.warming-progress-window').innerText(), /今日已互动/);
    assert.match(await c4.locator('.identity-live-badge').innerText(), /Pro 待转正/);
    checks++;

    // A delayed old-slot runtime sample cannot mark the next selected card as running.
    await page.evaluate(()=>(window as any).identityFixture.defer('browser_runtime_read'));
    await page.clock.runFor(3100);
    await page.waitForFunction(()=>(window as any).identityFixture.pending.includes('browser_runtime_read'));
    await c2.locator('button.identity-menu-trigger').click();
    await page.locator('[data-warming-action="switch"]').click();
    await page.waitForFunction(()=>(window as any).identityFixture.state.active_browser_slot==='warming-slot-2');
    await page.evaluate(()=>(window as any).identityFixture.release('browser_runtime_read'));
    await page.clock.runFor(3100);
    await waitRuntime(c2,'closed');
    assert.equal(await c2.getAttribute('data-browser-active'),'true');
    assert.equal(await c1.getAttribute('data-browser-active'),'false');
    assert.equal(await c1.getAttribute('data-browser-runtime'),'unknown');
    assert.equal(await c2.evaluate(node=>node.classList.contains('browser-active')),false);
    assert.deepEqual(await page.evaluate(()=>(window as any).identityFixture.state.warming_cards.map((card:any)=>card.seed)),[1111,2222,3333,4444]);
    await c1.locator('[data-warming-open]').click();
    await waitRuntime(c1,'running');
    checks++;

    // All four stages must fit exactly, including the longest English/privacy copy.
    for (const locale of ['zh', 'en']) {
      await page.evaluate(locale => (window as any).identityFixture.language(locale), locale);
      await warmingSection.getByRole('heading', {name: locale === 'zh' ? '养号' : 'Warming', exact: true}).waitFor();
      for(const [running,windowOpen,status] of [[true,true,'running'],[true,false,'closed'],[null,null,'unknown']] as const){
        await page.evaluate(({running,windowOpen})=>{
          (window as any).identityFixture.setRuntime({running,window_open:windowOpen});
          window.dispatchEvent(new Event('focus'));
        },{running,windowOpen});
        await waitRuntime(c1,status);
        const badge=await c1.locator('.identity-live-badge').evaluate(node=>({text:node.textContent,title:node.getAttribute('title')||'',width:node.clientWidth,scrollWidth:node.scrollWidth}));
        assert.equal(badge.text,(locale==='zh'?{running:'运行中',closed:'已关闭',unknown:'状态未知'}:{running:'Running',closed:'Closed',unknown:'Unknown'})[status]);
        assert(badge.scrollWidth<=badge.width,`${locale} ${status}: the complete short runtime badge must fit`);
        assert.match(badge.title,locale==='zh'?/^已选浏览器资料，/:/^Selected browser profile, /);
        assert.doesNotMatch(`${badge.text} ${badge.title}`,/·/,'The runtime badge must use plain status text');
      }
      assert.doesNotMatch(await warmingSection.locator('.warming-region').evaluateAll(nodes=>nodes.map(node=>`${node.textContent} ${node.getAttribute('title')}`).join(' ')),/·/,'Controlled region summaries must use natural punctuation');
      const countLabels=await page.locator('[data-card-count]').evaluateAll(nodes=>nodes.map(node=>{
        const style=getComputedStyle(node);
        return {kind:node.getAttribute('data-card-count'),text:node.textContent?.trim(),style:Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','border','borderRadius','padding','opacity'].map(key=>[key,(style as any)[key]]))};
      }));
      assert.equal(countLabels.length,2);
      const identityCount=countLabels.find(row=>row.kind==='identity')!;
      const warmingCount=countLabels.find(row=>row.kind==='warming')!;
      assert.match(identityCount.text!,locale==='zh'?/^\d+ 张身份卡$/:/^\d+ identity cards$/);
      assert.equal(warmingCount.text,locale==='zh'?'4 张养号卡':'4 warming cards');
      assert.deepEqual(warmingCount.style,identityCount.style,'Identity and warming counts must use the same pill presentation');
      const onboarding = await warmingSection.locator('.identity-onboarding-steps').evaluate(node => {
        const box = node.getBoundingClientRect();
        const bar = node.parentElement!.getBoundingClientRect();
        const steps = Array.from(node.querySelectorAll('.warming-step')).map(step => {
          const rect = step.getBoundingClientRect(), style = getComputedStyle(step);
          return {text: step.textContent, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', inside: rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1};
        });
        return {width: node.closest('section')!.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, barScrollWidth: node.parentElement!.scrollWidth, barClientWidth: node.parentElement!.clientWidth, insideBar: box.top >= bar.top - 1 && box.bottom <= bar.bottom + 1, steps};
      });
      assert(onboarding.width >= 680 && onboarding.width <= 700, `Expected narrow ~698px onboarding panel, got ${onboarding.width}`);
      assert.equal(onboarding.steps.length, 4);
      assert.deepEqual(onboarding.steps.map(step=>step.text?.replace('→','').trim()),locale==='zh'?['新建卡片','配置并核验','注册与日常使用','升级后转正']:['Create a card','Configure and verify','Register and use daily','Upgrade, then link CLI']);
      assert(onboarding.steps.every(step => step.visible && step.inside), `${locale}: all four steps must remain fully inside the steps box: ${JSON.stringify(onboarding.steps)}`);
      assert(onboarding.insideBar, `${locale}: wrapped steps must remain inside the onboarding bar`);
      assert(onboarding.scrollWidth <= onboarding.clientWidth, `${locale}: steps must not scroll horizontally`);
      assert(onboarding.barScrollWidth <= onboarding.barClientWidth, `${locale}: onboarding bar must not scroll horizontally`);
      checks++;
      for (const privacy of [false, true]) {
        await page.evaluate(async privacy => {
          const prefs = await import('/src/settings-model.ts');
          await prefs.synchronizePrivacyPreference(privacy);
        }, privacy);
        for (const card of [c1, c2, c3, c4]) {
          const dimensions = await card.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return {width: rect.width, height: rect.height, overflowX: node.scrollWidth > node.clientWidth + 1, overflowY: node.scrollHeight > node.clientHeight + 1};
          });
          assert.deepEqual(dimensions, {width: 180, height: 286, overflowX: false, overflowY: false}, `${locale} privacy=${privacy}`);
        }
        if (privacy) {
          assert.match(await c1.locator('.identity-email').innerText(), /\*\*\*/);
          assert.equal(await c1.locator('.warming-note').innerText(), locale === 'zh' ? '备注已隐藏' : 'Note hidden');
          const exposed = await c1.evaluate(node => [node.textContent, ...Array.from(node.querySelectorAll('[title],[aria-label],[aria-description]')).flatMap(el => ['title', 'aria-label', 'aria-description'].map(attr => el.getAttribute(attr)))].join(' '));
          assert(!exposed.includes('unreg@example.invalid'));
          assert(!exposed.includes('New card pending verify'));
        }else{
          const emailColors=await page.evaluate(()=>{
            const read=(selector:string)=>{const style=getComputedStyle(document.querySelector(selector)!);return {color:style.color,opacity:style.opacity,fontSize:style.fontSize,lineHeight:style.lineHeight};};
            return {warming:read('.warming-card .identity-email'),saved:read('.identity-library:not(.identity-warming-library) .identity-card:not(.current) .identity-email')};
          });
          assert.deepEqual(emailColors.warming,emailColors.saved,'Warming email must share the readable saved-card color and opacity');
          presentation.push({locale,emailColor:emailColors.warming.color,emailOpacity:emailColors.warming.opacity});
        }
        await warmingSection.screenshot({path:resolve(evidence,privacy?`warming-private-${locale}.png`:`warming-context-${locale}.png`)});
      }
    }
    await page.evaluate(async () => {
      (window as any).identityFixture.language('zh');
      const prefs = await import('/src/settings-model.ts');
      await prefs.synchronizePrivacyPreference(false);
    });
    await c1.getByRole('button', {name: '核验并注册', exact: true}).waitFor();
    checks++;

    // 保存养号卡 4 阶段预览截图
    await mkdir(resolve('.local/tasks/warming-implementation'), {recursive: true});
    await warmingSection.screenshot({path: resolve('.local/tasks/warming-implementation/warming-cards-preview.png')});
    checks++;

    // 6. 订阅到期设置表单（MM/DD Expiry Editor）
    await c4.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="expiry"]').click();
    const expiryDialog = page.getByRole('dialog');
    await expiryDialog.waitFor();
    const expiryInput = expiryDialog.locator('#identity-recharge-date');
    await expiryInput.fill('2026-11-20');
    await expiryDialog.getByRole('button', {name: /保存|Save/}).click();
    await page.waitForFunction(() => {
      const card = (window as any).identityFixture.state.warming_cards.find((c: any) => c.id === '10000000000000000000000000000004');
      return Boolean(card?.subscription_expiry_ymd);
    });
    // 验证卡片头部呈现 MM/DD 徽标
    assert.match(await c4.innerText(), /12\/20/);
    const subCmd = await page.evaluate(() => {
      const cmds = (window as any).identityFixture.commands;
      return cmds.find((c: any) => c.command === 'identities_set_subscription_expiry' && c.args.accountId === '10000000000000000000000000000004');
    });
    assert(subCmd, 'identities_set_subscription_expiry must be called with warming card ID');
    assert.equal(subCmd.args.rechargeYmd, '2026-11-20');
    assert.equal(subCmd.args.expiryYmd, '2026-12-20');
    assert.equal(subCmd.args.expectedIdentity, null);
    checks++;

    // 7. 转正门禁验证：非 pro_ready 阶段转正菜单禁用且不触发任何 stop
    await c2.locator('button.identity-menu-trigger').click();
    const promoteItemDisabled = page.locator('.identity-menu-content [data-warming-action="promote"]');
    assert.equal(await promoteItemDisabled.getAttribute('data-disabled'), '');
    assert.match(await promoteItemDisabled.innerText(), /转正前请先编辑阶段为「Pro 待转正」|Set the stage to Pro ready before linking CLI/);
    await page.keyboard.press('Escape');

    const cliStopsBefore = await page.evaluate(() => {
      return (window as any).identityFixture.commands.filter((c: any) => c.command === 'identities_stop').length;
    });
    assert.equal(cliStopsBefore, 0, 'No CLI stop must have occurred yet');
    checks++;

    // 8. 显式转正确认与取消：仅当确认时才调用 stop 与 identities_warming_promote
    await c4.locator('button.identity-menu-trigger').click();
    const promoteItemEnabled = page.locator('.identity-menu-content [data-warming-action="promote"]');
    assert.equal(await promoteItemEnabled.getAttribute('data-disabled'), null);
    await promoteItemEnabled.click();

    const promoteDialog = page.getByRole('dialog');
    await promoteDialog.waitFor();
    assert.match(await promoteDialog.getByRole('heading').innerText(), /已升级 Pro，登录 CLI 转正|Upgraded to Pro; link CLI/);
    const promotionRestartWarning = await page.evaluate(async () => (await import('/src/i18n.ts')).translate('将关闭并重开关联浏览器，请先保存网页任务。'));
    await promoteDialog.getByText(promotionRestartWarning, {exact: true}).waitFor();
    assert.equal(await promoteDialog.getByText('当前养号浏览器将保持打开，CLI 身份单独切换。', {exact: true}).count(), 0);

    // 取消转正：不触发 stop、不触发 promote
    await promoteDialog.getByRole('button', {name: /取消|Cancel/}).click();
    await promoteDialog.waitFor({state: 'detached'});

    const stopsAfterCancel = await page.evaluate(() => {
      return (window as any).identityFixture.commands.filter((c: any) => c.command === 'identities_stop').length;
    });
    assert.equal(stopsAfterCancel, 0, 'Cancelling promotion must not stop CLI');
    assert.equal(await page.evaluate(() => (window as any).identityFixture.commands.filter((row: any) => row.command === 'identities_warming_promote').length), 0);
    checks++;

    // 再次打开并确认转正
    await c4.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="promote"]').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', {name: /确认暂存并切换|Confirm archive and switch/}).click();

    // 确认后卡片被移出，CLI stop 且 identities_warming_promote 调用
    await c4.waitFor({state: 'detached'});
    const commandsAfterPromote = await page.evaluate(() => (window as any).identityFixture.commands);
    const stopCmd = commandsAfterPromote.find((c: any) => c.command === 'identities_stop');
    const promoteCmd = commandsAfterPromote.find((c: any) => c.command === 'identities_warming_promote');
    assert(stopCmd, 'identities_stop must be called upon confirmed promotion');
    assert(promoteCmd, 'identities_warming_promote must be called upon confirmed promotion');
    assert.equal(promoteCmd.args.id, '10000000000000000000000000000004');
    assert.deepEqual(commandsAfterPromote.filter((row: any) => ['identities_stop', 'identities_save', 'identities_switch', 'identities_warming_promote'].includes(row.command)).map((row: any) => row.command), ['identities_stop', 'identities_warming_promote']);
    checks++;

    // 9. 删除养号卡（勾选删除浏览器资料与取消保护）
    await c3.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="delete"]').click();
    const deleteAlert = page.locator('.identity-delete-alert');
    await deleteAlert.waitFor();
    assert.equal(await deleteAlert.getByRole('checkbox').first().isChecked(), false, 'Profile deletion requires a separate opt-in');

    // 先取消
    await deleteAlert.getByRole('button', {name: /取消|Cancel/}).click();
    await deleteAlert.waitFor({state: 'detached'});
    assert.equal(await c3.count(), 1);

    // 再次打开并勾选确认
    await c3.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="delete"]').click();
    await page.locator('.identity-delete-alert').waitFor();
    const confirmDeleteBtn = page.locator('.identity-delete-alert .identity-delete-button');
    assert.equal(await confirmDeleteBtn.isEnabled(), false, 'Confirm delete must be disabled before consent');

    // 勾选不可撤销与删除浏览器资料
    await page.locator('.identity-delete-alert').getByRole('checkbox', {name: /我知道此操作无法撤销|I understand this cannot be undone/}).check();
    await page.locator('.identity-delete-alert').getByRole('checkbox', {name: /同时删除该卡浏览器资料|Also delete this card’s browser profile/}).check();
    assert.equal(await confirmDeleteBtn.isEnabled(), true);
    await confirmDeleteBtn.click();

    await c3.waitFor({state: 'detached'});
    const deleteCmd = await page.evaluate(() => {
      const cmds = (window as any).identityFixture.commands;
      return cmds.find((c: any) => c.command === 'identities_warming_delete' && c.args.id === '10000000000000000000000000000003');
    });
    assert(deleteCmd, 'identities_warming_delete must be called');
    assert.equal(deleteCmd.args.deleteBrowser, true, 'deleteBrowser flag must be true when checked');
    assert.deepEqual(await page.evaluate(() => (window as any).identityFixture.commands.filter((row: any) => ['identities_stop', 'identities_save', 'identities_switch', 'identities_warming_promote'].includes(row.command)).map((row: any) => row.command)), ['identities_stop', 'identities_warming_promote']);
    checks++;

    // 10. 180×286 几何与零溢出检查
    const remainingCards = warmingSection.locator('article.warming-card');
    const geometry = await remainingCards.first().evaluate(node => {
      const r = node.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });
    assert.equal(geometry.width, 180);
    assert.equal(geometry.height, 286);
    assert(geometry.scrollWidth <= geometry.clientWidth + 1, 'Card horizontal content must not overflow');
    assert(geometry.scrollHeight <= geometry.clientHeight + 1, 'Card vertical content must not overflow');
    checks++;

    // 11. 隐私模式切换脱敏验证
    await page.evaluate(async () => {
      const prefs = await import('/src/settings-model.ts');
      await prefs.synchronizePrivacyPreference(true);
    });
    const c1Email = await c1.locator('.identity-email').innerText();
    assert.match(c1Email, /\*\*\*/, 'Email must be masked in privacy mode');
    const c1Note = await c1.locator('.warming-note').innerText();
    assert.match(c1Note, /备注已隐藏|Note hidden/, 'Note must be masked in privacy mode');
    checks++;

    await page.evaluate(async () => {
      const prefs = await import('/src/settings-model.ts');
      await prefs.synchronizePrivacyPreference(false);
    });
    assert.equal(await c1.locator('.identity-email').innerText(), 'unreg@example.invalid');
    assert.equal(await c1.locator('.warming-note').innerText(), 'New card pending verify');
    checks++;

    // 12. 英文双语与零英文溢出验证
    await page.evaluate(async () => {
      const i18n = await import('/src/i18n.ts');
      i18n.setLocale('en');
    });
    assert.equal(await warmingSection.getByRole('heading', {level: 2}).innerText(), 'Warming');
    assert.match(await warmingSection.locator('.identity-onboarding-bar').innerText(), /Warming:? 4 steps/i);
    assert.match(await c1.locator('.warming-progress-window').innerText(), /Opened today/);
    assert.match(await c2.locator('.warming-progress-window').innerText(), /Not opened today/);
    assert.match(await c1.locator('[data-warming-open]').innerText(), /Verify & register/);
    assert.match(await c2.locator('[data-warming-open]').innerText(), /Open Claude\.ai/);

    const enOverflow = await c1.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1);
    assert(enOverflow, 'English copy must fit within 180×286 card without overflow');
    await page.evaluate(async () => { const i18n = await import('/src/i18n.ts'); i18n.setLocale('zh'); });
    await c1.locator('button.identity-menu-trigger').click();
    await page.locator('.identity-menu-content [data-warming-action="edit"]').click();
    const sopDialog = page.getByRole('dialog');
    await sopDialog.waitFor();
    await sopDialog.locator('#warming-registered-country').fill('JP');
    await sopDialog.locator('#warming-registered-timezone').fill('Asia/Tokyo');
    await sopDialog.locator('.warming-sop-disclosure summary, .warming-sop-disclosure button').first().click();
    await sopDialog.locator('[data-warming-sop]').waitFor();
    assert.match(await sopDialog.locator('[data-warming-sop]').innerText(), /社区抗风控经验提示|仅供手动操作参考/);
    await sopDialog.getByRole('button', {name: /保存|Save/}).click();
    await sopDialog.waitFor({state: 'detached'});
    await page.evaluate(() => { (window as any).identityFixture.state.warming_cards[0].last_probe_country = 'US'; });
    await c1.locator('[data-warming-open]').click();
    const mismatchDialog = page.getByRole('alertdialog').filter({has: page.locator('[data-warming-mismatch-dialog]')});
    await mismatchDialog.waitFor();
    assert.match(await mismatchDialog.innerText(), /JP/);
    assert.match(await mismatchDialog.innerText(), /US/);
    await mismatchDialog.locator('[data-warming-mismatch-update-open]').click();
    await mismatchDialog.waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => (window as any).identityFixture.state.warming_cards[0].registered_country), 'US');
    checks++;
    checks++;

    // BrowserPanel must replace the warming draft with the different CLI configuration.
    const actionsBeforeBrowserPanel=await browserActions();
    await page.evaluate(cli=>{
      const f=(window as any).identityFixture;
      f.language('zh');
      f.state.current={...cli.current};f.state.active=cli.active;
      const card=f.state.warming_cards[0];
      f.state.active_browser_slot=card.slot;
      for(const row of f.state.warming_cards)row.browser_active=row.id===card.id;
      Object.assign(f.browser.config,{seed:card.seed,follow_machine:false,timezone:'America/Chicago'});
      f.setRuntime({slot:card.slot,running:true,window_open:true});
      f.showBrowserPanel();
    },cliBefore);
    const browserPanel=page.locator('.browser-page');
    await browserPanel.locator('[data-current-cli-identity]').filter({hasText:'Fixture user'}).waitFor();
    await browserPanel.locator('[data-current-browser-identity]').filter({hasText:'Card Unregistered'}).waitFor();
    await browserPanel.locator('.browser-advanced-panel > button').click();
    const warmingSeed=await browserPanel.locator('#fingerprint-seed').inputValue();
    assert.equal(warmingSeed,'1111');
    await browserPanel.locator('[data-return-cli-browser]').click();
    await page.locator('[data-return-cli-confirm]').click();
    await browserPanel.locator('[data-current-browser-identity]').filter({hasText:'Fixture user'}).waitFor();
    assert.equal(await browserPanel.locator('#fingerprint-seed').inputValue(),'123','The displayed draft must follow the returned Pro config');
    assert.equal(await browserPanel.getByText('先保存指纹设置，再启动浏览器或对齐机器。',{exact:true}).count(),0);
    assert.equal(await browserPanel.getByRole('button',{name:/^(打开浏览器并实测|重新打开实测页)$/}).isEnabled(),true,'An unchanged returned config must allow the launch action');
    const panelActions=(await browserActions()).slice(actionsBeforeBrowserPanel.length);
    assert.deepEqual(panelActions.map((row:any)=>row.command),['browser_return_to_cli']);
    assert.equal(panelActions[0].args.expectedIdentity,cliBefore.current.quota_identity);
    await browserPanel.locator('.browser-hero-card').screenshot({path:resolve(evidence,'browser-return-cli-config.png')});
    await page.evaluate(() => { (window as any).identityFixture.emitEvent('kill-switch-state', { enabled: true, triggered: true, reason_code: 'country_drift', expected_country: 'US', observed_country: 'SG', triggered_at: 1780000099, closed_slots: ['warming-10000001'] }); });
    const ksBanner = browserPanel.locator('[data-kill-switch-banner]');
    await ksBanner.waitFor();
    assert.match(await ksBanner.innerText(), /US/);
    assert.match(await ksBanner.innerText(), /SG/);
    await ksBanner.locator('[data-kill-switch-dismiss]').click();
    await ksBanner.waitFor({state: 'detached'});
    checks++;
    checks++;

    assert.equal(errors.length, 0, errors.join('\n'));
    await writeFile(resolve(evidence,'warming-ui-results.json'),JSON.stringify({checks,synthetic:true,externalRequests:'blocked',runtime:['selected-closed','external-close','external-reopen','unknown','late-old-slot'],returnToCli:['zh-cancel','en-cancel','confirm-browser-only'],usage:['frozen-cli-fingerprint','account-change-rejected','warming-selection-preserved'],browserPanel:['cli-and-warming-ownership','returned-cli-draft','no-unsaved-warning','launch-enabled','browser-only-command'],presentation,locales:['zh','en'],cardSize:{width:180,height:286},pageErrors:errors},null,2));
    return checks;
  } finally {
    await context.close();
  }
}
