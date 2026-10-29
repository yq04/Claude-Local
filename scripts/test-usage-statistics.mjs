// [INPUT]: Main React shell, fake IPC aggregates and an isolated local browser context.
// [OUTPUT]: Isolated usage/identity/system layout previews; --usage-reliability-only verifies complete token totals, recorded activity, all models, concise account scopes, TSV and bilingual responsive layouts without unrelated suites.
// [POS]: Synthetic UI verification; no live identities, external requests or native mutations.
// [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing this harness.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const args = process.argv.slice(2);
const quickOnly = args.includes('--quick-only');
const layoutOnly = args.includes('--layout-only');
const usageReliabilityOnly = args.includes('--usage-reliability-only');
const outArg = args.find(a => !['--quick-only', '--layout-only', '--usage-reliability-only'].includes(a));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(outArg || join(root, '.local', 'preview', usageReliabilityOnly ? 'usage-reliability' : layoutOnly ? 'window-layout' : quickOnly ? 'quick-setup-refinements' : 'ui-refinements'));
await mkdir(output, {recursive: true});
const privateHome = await mkdtemp(join(tmpdir(), 'claude-local-usage-ui-'));
await mkdir(join(privateHome, 'config'));
await mkdir(join(privateHome, 'cache'));

const fixture = `
import {mockIPC} from '/node_modules/@tauri-apps/api/mocks.js';
import {defaultPolicy} from '/src/identity-model.ts';
const id = n => String(n).padStart(32, '0');
const now = Math.floor(Date.now() / 1000);
const totals = (input, output, creation, read, reasoning = null) => ({input_tokens:input,output_tokens:output,cache_creation_tokens:creation,cache_read_tokens:read,total_tokens:input+output+creation+read,reasoning_tokens:reasoning,requests:2});
const alpha = totals(200,100,100,600,20), beta = totals(500,300,200,1000);
const all = totals(740,410,300,1650,20), unknown = totals(40,10,0,50);
const empty = totals(0,0,0,0);
alpha.requests = 48; beta.requests = 72; all.requests = 134; unknown.requests = 14; empty.requests = 0;
alpha.sessions = 2; beta.sessions = 3; unknown.sessions = 1; all.sessions = 6; empty.sessions = 0;
const accounts = [{id:id(1),name:'Alpha workspace',email:'alpha@example.invalid',current:true,totals:alpha},{id:id(2),name:'Beta workspace',email:'beta@example.invalid',current:false,totals:beta}];
accounts.push({id:id(3),name:'Gamma workspace',email:'gamma@example.invalid',current:false,totals:empty});
window.usageFixture = {
  requests:[],commands:[],copied:[],fail:false,empty:false,warnings:[],
  cliRunning:false,failedRead:'',failedReads:[],
  hold:false,pendingReads:[],
  holdBrowser:false,browserPendingResolvers:[],
  holdIdentity:false,identityPendingResolvers:[],
  longNames:false,legacyActivity:false,manyModels:${usageReliabilityOnly},lastSnapshot:null,
  browserConfig:{
    seed:123456,proxy:'',follow_machine:false,language:'en-US',timezone:'America/Los_Angeles',native_graphics:true
  },
  browserMachine:{
    platform:'windows',version:'15.0.0',cores:8,timezone:'America/New_York',languages:['en-US'],locale:'en-US',location_enabled:false,timezones:['America/New_York','America/Los_Angeles']
  }
};
window.usageFixture.releaseBrowser=function(){
  window.usageFixture.holdBrowser=false;
  const resolvers=window.usageFixture.browserPendingResolvers.splice(0);
  for(const r of resolvers)r();
};
window.usageFixture.releaseIdentity=function(){
  window.usageFixture.holdIdentity=false;
  const resolvers=window.usageFixture.identityPendingResolvers.splice(0);
  for(const r of resolvers)r();
};
window.usageFixture.systemState={platform:'windows',timezone:'America/New_York',timezones:['America/New_York','America/Los_Angeles','Asia/Shanghai'],automatic_timezone:false,languages:['en-US'],location_enabled:false,accessibility:true};
let cliVersion = '2.1.303';
const cliStatus = () => window.usageFixture.cliMissing
  ? {method:'',path:'',version:'',running:false}
  : ({method:'native',path:'C:/fixture/claude.exe',version:cliVersion,running:window.usageFixture.cliRunning});
function dailyRows(value,period){
  const isHourly = period==='today'||period==='yesterday';
  const count=period==='today'?new Date().getHours()+1:period==='yesterday'?24:period==='week'?7:period==='month'?30:81;
  const weights=Array.from({length:count},(_,index)=>4+index%7);
  const weightTotal=weights.reduce((a,b)=>a+b,0);let cumulative=0;
  return weights.map((weight,index)=>{
    const before=cumulative;cumulative+=weight;const row={...empty};
    for(const key of ['input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','requests'])row[key]=Math.floor(value[key]*cumulative/weightTotal)-Math.floor(value[key]*before/weightTotal);
    row.total_tokens=row.input_tokens+row.output_tokens+row.cache_creation_tokens+row.cache_read_tokens;
    const day=new Date();if(period==='yesterday')day.setDate(day.getDate()-1);else if(period!=='today')day.setDate(day.getDate()-weights.length+index+1);
    const key=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
    return {day:key+(isHourly?'T'+String(index).padStart(2,'0')+':00':''),totals:row};
  });
}
function modelRows(value){
  const names=['claude-test-model','claude-research-sonnet','claude-studio-haiku','claude-opus-4-6','claude-fable-preview','claude-sonnet-4-6','third-party-model-zeta','unknown'];
  let cumulative=0;
  return (window.usageFixture.manyModels?[30,20,15,10,8,7,6,4]:[60,30,10]).map((weight,index)=>{
    const before=cumulative;cumulative+=weight;const row={...empty};
    for(const key of ['input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','requests'])row[key]=Math.floor(value[key]*cumulative/100)-Math.floor(value[key]*before/100);
    row.total_tokens=row.input_tokens+row.output_tokens+row.cache_creation_tokens+row.cache_read_tokens;
    row.reasoning_tokens=value.reasoning_tokens==null?null:Math.floor(value.reasoning_tokens*cumulative/100)-Math.floor(value.reasoning_tokens*before/100);
    return {model:window.usageFixture.longNames&&index>0&&names[index]!=='unknown'?names[index]+'-synthetic-long-context-workspace-preview-2026-10-20':names[index],totals:row,...(window.usageFixture.manyModels&&index===0?{efforts:[{effort:'max',totals:row}]}:{})};
  });
}
const current = {present:true,display_name:'Alpha account owner',email:'alpha@example.invalid',organization:'Test workspace',plan:'Pro',auth_status:'valid',proxy:null,unavailable:false,quota_5h_used:49,quota_5h_reset_at:now+10560,quota_7d_used:18,quota_7d_reset_at:now+475200,subscription_expires_at:now+19*86400};
const identityState = {browser:{enabled:false,bound_ids:[]},browser_warning:null,active:id(1),recovery:null,running:false,sessions:[],current,records:accounts.map(a=>({id:a.id,name:a.name,saved_at:now,bytes:1024,policy:{...defaultPolicy}})),summaries:{}};
identityState.records[2].name='Gamma workspace — synthetic long local archive alias';
for(const a of accounts)identityState.summaries[a.id]={display_name:a.name,email:a.email,organization:'Test workspace',plan:'Pro',auth_status:'valid',proxy:null};
Object.assign(identityState.summaries[id(1)],current);
Object.assign(identityState.summaries[id(2)],{display_name:'Beta account owner',quota_5h_used:0,quota_5h_reset_at:now+14400,quota_7d_used:75,quota_7d_reset_at:now+172800,subscription_expires_at:null});
Object.assign(identityState.summaries[id(3)],{display_name:'Gamma account owner',plan:'Max 20x',proxy:'http://proxy.example.invalid:7890',quota_5h_used:null,quota_7d_used:null});
window.usageFixture.identityState=identityState;
let locale = 'zh';
localStorage.setItem('claude-local.preferences.v1', JSON.stringify({privacyMask: false}));
localStorage.setItem('claude-local.page.v1', ${JSON.stringify(quickOnly ? 'quick' : 'usage')});
localStorage.setItem('claude-local.kookeey-referral.v1','https://legacy.example.invalid/referral');
mockIPC(async (command,args)=>{
  window.usageFixture.commands.push({command,args:structuredClone(args)});
  if(command===window.usageFixture.failedRead || (window.usageFixture.failedReads&&window.usageFixture.failedReads.includes(command)))throw Error('Synthetic status read failure: '+command);
  if(command==='copy_result'){window.usageFixture.copied.push(args.text);return;}
  if(command==='network_diagnose_domains')return ['claude.ai','api.anthropic.com','platform.claude.com','downloads.claude.ai'].map(domain=>({domain,ok:true,status_code:200,latency_ms:30,ip:'203.0.113.1',message:'连接正常'}));
  if(command==='usage_statistics_read'){
    window.usageFixture.requests.push(structuredClone(args));
    if(window.usageFixture.hold)await new Promise(resolve=>window.usageFixture.pendingReads.push(resolve));
    if(window.usageFixture.fail)throw Error('Synthetic usage read failure');
    const selected = args.accountId==='unattributed'?unknown:args.accountId===id(1)?alpha:args.accountId===id(2)?beta:args.accountId===id(3)?empty:all;
    const value = window.usageFixture.empty?empty:selected;
    const daily=window.usageFixture.empty?[]:dailyRows(value,args.period);
    const visibleTotals={...value};
    if(window.usageFixture.legacyActivity)delete visibleTotals.sessions;
    const snapshot={generated_at:Math.floor(Date.now()/1000),tracking_since:now-86400,timezone:args.timezone,granularity:(args.period==='today'||args.period==='yesterday')?'hour':'day',totals:visibleTotals,unattributed:window.usageFixture.empty?empty:unknown,accounts:accounts.map(a=>({...a,totals:window.usageFixture.empty?empty:a.totals})),daily,models:window.usageFixture.empty?[]:modelRows(value),warnings:[...window.usageFixture.warnings,...(!window.usageFixture.empty?['attribution_gap']:[])],attribution:{fallback_account_id:id(1),fallback_account_name:'Alpha workspace',fallback_before:now-3600,unassigned_requests:0,unassigned_tokens:0},...(!window.usageFixture.legacyActivity?{activity:{sessions:value.sessions,active_days:new Set(daily.filter(row=>row.totals.total_tokens>0).map(row=>row.day.slice(0,10))).size}}:{})};
    window.usageFixture.lastSnapshot=structuredClone(snapshot);
    return snapshot;
  }
  if(command==='ui_privacy_read')return false;
  if(command==='ui_privacy_write')return;
  if(command==='quota_setup_status')return {state:'not_configured',collector_bundled:false,has_statusline:false};
  if(command==='ui_language_read')return locale;
  if(command==='ui_language_write'){locale=args.language;return;}
  if(command==='plugin:app|version')return '0.1.3';
  if(command==='get_regions')return [{id:'us-west',label:'United States',language:'en-US',locale:'en_US',timezone:'America/Los_Angeles'}];
  if(command==='identities_read'){
    if(window.usageFixture.holdIdentity)await new Promise(resolve=>window.usageFixture.identityPendingResolvers.push(resolve));
    return structuredClone(identityState);
  }
  if(command==='browser_default_read')return {is_default:false,http:'',https:'',installed:true,app:'Claude-Local Browser'};
  if(command==='browser_read'){
    if(window.usageFixture.holdBrowser)await new Promise(resolve=>window.usageFixture.browserPendingResolvers.push(resolve));
    return {
      engine_ready:true,running:false,profile:'synthetic-profile',identity_linked:true,identity:{linked:true,status:'linked',name:'Alpha workspace',email:null,organization:null},
      ui_language:locale,exit_services:[],region:{id:'us-west',label:'United States',country:'US',language:'en-US',locale:'en_US',timezone:'America/Los_Angeles'},
      config:structuredClone(window.usageFixture.browserConfig),
      machine:structuredClone(window.usageFixture.browserMachine),
      engine_version:'150.0.0.0',cache:[],cache_error:'',report:null,report_received_at:null,machine_exit:null,checks:[]
    };
  }
  if(command==='claude_cli_read')return cliStatus();
  if(command==='claude_cli_check')return {current:cliStatus(),latest_version:'2.1.304',update_available:cliVersion!=='2.1.304'};
  if(command==='claude_cli_manage' && args.action==='update') {if(window.usageFixture.cliRunning)throw Error('cli.error.running');cliVersion='2.1.304';return cliStatus();}
  if(command==='system_read')return structuredClone(window.usageFixture.systemState);
  if(command==='identities_quota_revision')return 1;
  if(command==='identities_quota_batch_state')return null;
  if(command==='identities_backup_location')return 'C:/fixture/data';
  if(command==='plugin:event|listen')return 1;
  if(command==='plugin:event|unlisten')return;
  throw Error('Unexpected native command: '+command);
});
await import('/src/main.tsx');
`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Claude-Local</title></head><body><div id="app"></div><script type="module">' + fixture + '</script></body></html>';
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  plugins: [{name: 'usage-statistics-fixture', configureServer(instance) {
    instance.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__usage-fixture.html')) return next();
      try {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(await instance.transformIndexHtml('/__usage-fixture.html', html));
      } catch (error) { next(error); }
    });
  }}],
  server: {host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: {ignored: ['**/src-tauri/**', '**/browser-runtime/**', '**/.local/**', '**/dist/**']}},
  optimizeDeps: {include: ['@tauri-apps/api/mocks']},
});

let browser;
try {
  await server.listen();
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  const pinned = join(root, 'browser-runtime', 'WindowsBrowser', 'chrome.exe');
  const env = {...process.env, HOME: privateHome, XDG_CONFIG_HOME: join(privateHome, 'config'), XDG_CACHE_HOME: join(privateHome, 'cache')};
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  browser = await chromium.launch({...(existsSync(pinned) ? {executablePath: pinned} : {channel: 'msedge'}), headless: true, env});
  const context = await browser.newContext({viewport: {width: 1040, height: 820}, reducedMotion: 'reduce', timezoneId: 'America/New_York'});
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  const usageGeometry = async label => {
    const geometry=await page.locator('.usage-page').evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,viewport:window.innerWidth,documentWidth:document.documentElement.clientWidth,documentScrollWidth:document.documentElement.scrollWidth}));
    assert.ok(geometry.scrollWidth<=geometry.width+1,label+': usage page must fit without horizontal overflow');
    assert.ok(geometry.documentScrollWidth<=geometry.documentWidth+1,label+': document must fit without horizontal overflow');
    return geometry;
  };
  const readSystemGeometry=async (label,theme='light')=>{
    const geometry=await page.locator('.system-environment-page').evaluate(node=>{
      const box=element=>{const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom};};
      const cards=[...node.querySelectorAll('.system-setting-card')].map(card=>({setting:card.getAttribute('data-system-setting'),box:box(card),width:card.clientWidth,scrollWidth:card.scrollWidth,contents:[...card.querySelectorAll('h2,p,.system-current-value,.system-state-label,.system-inline-controls,.system-inline-field,[role="combobox"],button')].map(element=>({tag:element.tagName,className:element.className,...box(element)}))}));
      const timezone=node.querySelector('[data-system-setting="timezone"]'),last=timezone.querySelector('.system-inline-controls > button:last-child');
      return {theme:document.documentElement.classList.contains('dark')?'dark':'light',width:node.clientWidth,scrollWidth:node.scrollWidth,documentWidth:document.documentElement.clientWidth,documentScrollWidth:document.documentElement.scrollWidth,viewport:window.innerWidth,list:box(node.querySelector('.system-settings-list')),cards,trailingGap:timezone.getBoundingClientRect().right-last.getBoundingClientRect().right,locationButtons:[...node.querySelectorAll('.system-location-controls > button')].map(box)};
    });
    assert.deepEqual(geometry.cards.map(card=>card.setting),['timezone','language','location']);
    assert.equal(geometry.theme,theme,label+': theme preference must survive navigation and sidebar changes');
    assert.ok(geometry.scrollWidth<=geometry.width+1,label+': system page must not overflow horizontally');
    assert.ok(geometry.documentScrollWidth<=geometry.documentWidth+1,label+': system page must not widen the document');
    for(const card of geometry.cards){
      assert.ok(card.scrollWidth<=card.width+1,label+': card content must fit its width');
      for(const content of card.contents){
        assert.ok(content.width>0&&content.height>0,label+': system text and controls must remain visible');
        assert.ok(content.x>=card.box.x-1&&content.right<=card.box.right+1,label+': system text and controls must stay within the card horizontally');
        assert.ok(content.y>=card.box.y-1&&content.bottom<=card.box.bottom+1,label+': system text and controls must stay within the card vertically');
      }
    }
    assert.equal(geometry.locationButtons.length,2);
    return geometry;
  };
  const chooseSystemDraft=async(name,value,label=value)=>{
    const control=page.locator('.system-environment-page').getByRole('combobox',{name,exact:true});
    if(await control.evaluate(node=>node.tagName)==='SELECT')await control.selectOption(value);
    else{await control.click();await page.getByRole('option',{name:label,exact:true}).click();}
  };
  const readIdentityGeometry=()=>page.locator('.identity-card:not(.empty)').evaluateAll(nodes=>nodes.map(node=>{
    const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const typography=[...node.querySelectorAll('.identity-quota-copy > strong,.identity-quota-value,.identity-quota-value > strong,.identity-quota-reset,.identity-reset-time,.identity-quota-countdown')].map(element=>{
      const style=getComputedStyle(element);
      return {className:element.className,percentage:element.matches('.identity-quota-value > strong'),text:element.textContent,fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,fontWeight:style.fontWeight,numeric:style.fontVariantNumeric,...box(element)};
    });
    const resets=[...node.querySelectorAll('.identity-quota-reset')].map(element=>({box:box(element),clock:element.querySelector('.identity-reset-time')?box(element.querySelector('.identity-reset-time')):null,countdown:element.querySelector('.identity-quota-countdown')?box(element.querySelector('.identity-quota-countdown')):null}));
    const subscription=node.querySelector('.identity-sub-resets-block');
    return {card:box(node),heading:box(node.querySelector('h3[data-identity-name]')),email:box(node.querySelector('.identity-email')),windows:[...node.querySelectorAll('[data-quota-window]')].map(box),subscription:subscription?box(subscription):null,footer:box(node.querySelector('.identity-card-footer')),bars:[...node.querySelectorAll('.identity-quota-track')].map(box),typography,resets,fontSans:getComputedStyle(node).getPropertyValue('--font-sans'),width:node.clientWidth,scrollWidth:node.scrollWidth};
  }));
  const verifyIdentityGeometry=(geometries,label)=>{
    const normalizeFamily=value=>value.replaceAll('"','').replaceAll("'",'').replaceAll(' ','').toLowerCase();
    for(const geometry of geometries){
      assert.equal(geometry.card.width,180);assert.equal(geometry.card.height,286);
      assert.ok(geometry.scrollWidth<=geometry.width+1,label+': long identity names must stay inside their card');
      assert.ok(geometry.heading.bottom<=geometry.email.y,label+': title and email must not overlap');
      assert.ok(geometry.email.bottom<=geometry.windows[0].y,label+': the email must remain above quota details');
      assert.equal(geometry.windows.length,2);assert.ok(geometry.windows[0].bottom<=geometry.windows[1].y);
      assert.ok(geometry.windows[1].bottom<=(geometry.subscription?.y??geometry.footer.y),label+': quota windows and subscription/actions must not overlap');
      if(geometry.subscription)assert.ok(geometry.subscription.bottom<=geometry.footer.y,label+': subscription and action buttons must not overlap');
      assert.ok(geometry.footer.bottom<=geometry.card.bottom-2,label+': identity actions must remain inside the card');
      assert.ok(geometry.bars.every(bar=>bar.height===6&&bar.width>140));
      for(const text of geometry.typography){
        assert.equal(text.fontSize,'12px',label+': quota and reset text must share the readable font size');
        assert.equal(text.lineHeight,'16px',label+': quota and reset text must share a stable line height');
        assert.equal(normalizeFamily(text.fontFamily),normalizeFamily(geometry.fontSans),label+': quota and reset text must use the sans font');
        assert.match(text.numeric,/tabular-nums/);
        assert.equal(text.fontWeight,text.percentage?'600':'400',label+': only the quota percentage should be semibold');
        assert.ok(text.height>0&&text.width>0,label+': quota text must not be compressed away');
      }
      for(const reset of geometry.resets){
        if(reset.clock&&reset.countdown)assert.ok(reset.clock.right<=reset.countdown.x+1,label+': reset dates and countdowns must not overlap');
        if(reset.clock)assert.ok(reset.clock.bottom<=reset.box.bottom+1,label+': reset dates must stay inside their line');
        if(reset.countdown)assert.ok(reset.countdown.bottom<=reset.box.bottom+1,label+': countdowns must stay inside their line');
      }
    }
  };
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (usageReliabilityOnly) {
    const {runUsageReliabilityChecks} = await import('./usage-reliability-checks.mjs');
    await runUsageReliabilityChecks({page, output, base, errors});
  } else if (layoutOnly) {
    const {runWindowLayoutChecks} = await import('./window-layout-checks.mjs');
    await runWindowLayoutChecks({page, output, base, errors});
  } else if (quickOnly) {
    const {runQuickSetupChecks} = await import('./quick-setup-checks.mjs');
    await runQuickSetupChecks({page, context, output, base, errors});
  } else {
    await page.clock.install({time: new Date('2026-10-20T10:35:00-04:00')});
  await page.goto(base + '/__usage-fixture.html');
  await page.getByRole('heading', {name: '用量分析', exact: true}).waitFor();
  await page.getByText('claude-test-model', {exact: true}).waitFor();
  assert.equal(await page.locator('.usage-trend').getAttribute('data-usage-bucket-count'),'81','All time must include history older than 30 days');
  assert.equal((await page.evaluate(()=>window.usageFixture.commands)).some(item=>item.command==='browser_read'),false,'Inactive quick setup must not read browser state');
  assert.equal(await page.locator('.usage-filter-note, .usage-live-note, .usage-attribution-card').count(), 0);
  assert.equal(await page.locator('.usage-history-note').count(), 0, 'Account selector must remain concise');
  assert.equal(await page.getByRole('tab', {name: '昨天', exact: true}).count(), 1);
  const accountSelect = page.locator('.usage-account-filter').getByRole('combobox');
  assert.equal(await accountSelect.innerText(), '全部');
  await accountSelect.click();
  assert.equal(await page.getByRole('option').count(), 4, 'Only All and ordinary accounts belong in the selector');
  assert.equal(await page.getByRole('option', {name: '未归属历史', exact: true}).count(), 0);
  await page.getByRole('option', {name: '全部', exact: true}).click();
  const alignment = await page.locator('.usage-page').evaluate(node => ({title: node.querySelector('h1').getBoundingClientRect().left, card: node.querySelector('.usage-overview').getBoundingClientRect().left}));
  assert.ok(Math.abs(alignment.title - alignment.card) <= 1, 'Usage cards must share the page-title margin');
  assert.equal(await page.locator('.usage-details').getByText('已报告推理', {exact:true}).count(), 0);
  assert.equal(await page.locator('.usage-bar-input, .usage-bar-output, .usage-bar-cache').count(), 0);
  assert.equal(await page.locator('.usage-total-value').getAttribute('title'), '3,100');
  const metricStyles=await page.locator('.usage-summary > .usage-metric').evaluateAll(nodes=>nodes.map(node=>({background:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage,border:getComputedStyle(node).borderColor,value:getComputedStyle(node.querySelector(':scope > strong')).color})));
  assert.ok(metricStyles.every(style=>JSON.stringify(style)===JSON.stringify(metricStyles[0])),'All metric cards must use the same surface and value color');
  const chartColor=await page.locator('.usage-total-line').evaluate(node=>getComputedStyle(node).stroke);
  const modelColor=await page.locator('.usage-model-track > span').first().evaluate(node=>getComputedStyle(node).backgroundColor);
  assert.equal(chartColor,modelColor,'Daily and model total-token colors must match');
  await page.locator('.usage-trend').focus();
  await page.keyboard.press('ArrowLeft');
  await page.locator('.usage-trend-tooltip').waitFor();
  await page.getByRole('heading', {name: '用量分析', exact: true}).click();
  await page.screenshot({path: join(output, 'usage-analytics-zh-light.png'), fullPage: true});
  await page.locator('.usage-table').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.usage-table').getByRole('row').count(), 4, 'Only ordinary accounts belong in account details');
  assert.equal(await page.locator('.usage-model-row').count(),3,'Model distribution must render every synthetic model');
  assert.deepEqual(await page.locator('.usage-model-track > span').evaluateAll(nodes=>nodes.map(node=>node.style.width)),['60%','30%','10%']);
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('heading',{name:'用量分析',exact:true}).click();
  const wideGeometry=await usageGeometry('Chinese wide layout');
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'usage-analytics-zh-wide.png'),fullPage:true});
  await page.setViewportSize({width:720,height:820});
  const narrowClassicGeometry=await usageGeometry('Chinese narrow classic sidebar');
  await page.setViewportSize({width:1040,height:820});

  // A previous hover index must remain safe when changing to a shorter series.
  await page.locator('.usage-trend').focus(); await page.keyboard.press('End');
  await page.getByRole('tab',{name:'今天',exact:true}).click();
  await page.locator('[data-usage-granularity="hour"]').waitFor();
  assert.equal(await page.locator('.usage-trend').getAttribute('data-usage-bucket-count'),'24');
  assert.equal(await page.locator('.usage-future-region').count(),1);
  assert.match(await page.locator('.usage-trend').innerText(),/00:00/);
  const hourlyPath=await page.locator('.usage-total-line').getAttribute('d');
  assert.equal((hourlyPath.match(/[ML]/g)||[]).length,11,'Only elapsed hours may form the trend line');
  await page.locator('.usage-trend').focus(); await page.keyboard.press('End');
  assert.match(await page.locator('.usage-trend-tooltip').innerText(),/尚未发生/);
  assert.doesNotMatch(await page.locator('.usage-trend-tooltip').innerText(),/0 Token/);
  await page.keyboard.press('Home');
  assert.match(await page.locator('.usage-trend-tooltip').innerText(),/00:00.*01:00/);
  await page.getByRole('heading',{name:'用量分析',exact:true}).click();
  await page.screenshot({path:join(output,'usage-hourly-zh-light.png'),fullPage:true});

  // Switching presentation, sorting and paging uses the existing snapshot only.
  const view=page.getByRole('tablist',{name:'趋势视图',exact:true});
  const beforeView=await page.evaluate(()=>window.usageFixture.requests.length);
  await view.getByRole('tab',{name:'数据',exact:true}).click();
  assert.equal(await view.getByRole('tab',{name:'数据',exact:true}).getAttribute('aria-selected'),'true');
  const trendTable=page.locator('.usage-trend-table');
  await trendTable.getByRole('table',{name:'按时段用量',exact:true}).waitFor();
  assert.equal(await trendTable.locator('tbody tr').count(),10,'The first hourly page must contain ten elapsed hours');
  const firstPageHours=await trendTable.locator('tbody tr > :first-child').allTextContents();
  await trendTable.getByRole('button',{name:'下一页',exact:true}).click();
  assert.equal(await trendTable.locator('tbody tr').count(),1,'Eleven elapsed hours must occupy exactly two pages');
  assert.equal(await trendTable.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
  const hourlyLabels=[...firstPageHours,...await trendTable.locator('tbody tr > :first-child').allTextContents()];
  assert.equal(new Set(hourlyLabels).size,11,'Pagination must neither duplicate nor omit elapsed hours');
  assert.ok(hourlyLabels.every(label=>{const match=label.match(/(\d{2}):00/);return match&&Number(match[1])<=10;}),'Future hours must not appear as recorded table rows');
  await trendTable.getByRole('button',{name:'上一页',exact:true}).click();
  for(const name of ['总 Token','去重响应数','时间']){
    await trendTable.getByRole('button',{name,exact:true}).click();
    const header=trendTable.getByRole('columnheader').filter({has:page.getByRole('button',{name,exact:true})});
    const direction=await header.getAttribute('aria-sort');
    assert.ok(['ascending','descending'].includes(direction),'The active sort must expose its direction');
    const column=await header.evaluate(node=>node.cellIndex);
    const values=await trendTable.locator('tbody tr').evaluateAll((rows,column)=>rows.map(row=>row.children[column].getAttribute('title')||row.children[column].textContent.trim()),column);
    const ordered=[...values].sort((a,b)=>(name==='时间'?a.localeCompare(b):Number(a.replaceAll(',',''))-Number(b.replaceAll(',','')))*(direction==='ascending'?1:-1));
    assert.deepEqual(values,ordered,'Rendered rows must follow the selected sort order');
  }
  await trendTable.scrollIntoViewIfNeeded();
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'usage-table-zh.png'),fullPage:true});
  await view.getByRole('tab',{name:'图表',exact:true}).click();
  await page.locator('.usage-trend').waitFor();
  assert.equal(await view.getByRole('tab',{name:'图表',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.evaluate(()=>window.usageFixture.requests.length),beforeView,'Chart/data switching, paging and sorting must not reread native usage');
  await page.getByRole('tab',{name:'近30天',exact:true}).click();
  await page.locator('[data-usage-bucket-count="30"]').waitFor();

  // The next poll starts 30 seconds after completion and pauses while hidden.
  let beforePoll=await page.evaluate(()=>window.usageFixture.requests.length);
  await page.clock.fastForward(30_100);
  await page.waitForFunction(count=>window.usageFixture.requests.length===count+1,beforePoll);
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  beforePoll=await page.evaluate(()=>window.usageFixture.requests.length);
  await page.clock.fastForward(90_000);
  assert.equal(await page.evaluate(()=>window.usageFixture.requests.length),beforePoll);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(count=>window.usageFixture.requests.length===count+1,beforePoll);
  await page.evaluate(()=>{window.usageFixture.hold=true;});
  beforePoll=await page.evaluate(()=>window.usageFixture.requests.length);
  await page.clock.fastForward(30_100);
  await page.waitForFunction(()=>window.usageFixture.pendingReads.length===1);
  assert.equal(await page.getByRole('button',{name:'刷新',exact:true}).isDisabled(),true);
  await page.clock.fastForward(90_000);
  assert.equal(await page.evaluate(()=>window.usageFixture.requests.length),beforePoll+1,'Polling must not overlap a pending read');
  await page.evaluate(()=>{window.usageFixture.hold=false;window.usageFixture.pendingReads.splice(0).forEach(resolve=>resolve());});
  await page.waitForFunction(()=>!document.querySelector('.usage-header button')?.disabled);

  await page.getByRole('tab', {name: '近7天', exact: true}).click();
  await page.waitForFunction(() => window.usageFixture.requests.at(-1)?.period === 'week');
  await page.locator('[data-usage-bucket-count="7"]').waitFor();
  const filter = page.getByRole('combobox', {name: '统计账号', exact: true});
  if (await filter.evaluate(node => node.tagName) === 'SELECT') {
    await filter.selectOption('00000000000000000000000000000002');
  } else {
    await filter.click();
    await page.getByRole('option', {name: /Beta workspace/}).click();
  }
  await page.waitForFunction(() => window.usageFixture.requests.at(-1)?.accountId === '00000000000000000000000000000002');
  await page.getByText('claude-test-model', {exact: true}).waitFor();

  await page.evaluate(() => { window.usageFixture.fail = true; });
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.getByRole('alert').filter({hasText: /Synthetic usage read failure/}).waitFor();
  assert.equal(await page.locator('.usage-total-value').getAttribute('title'),'2,000','Refresh failure must retain this filter\'s previous totals');
  await page.evaluate(() => { window.usageFixture.fail = false; });
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.waitForFunction(() => !document.querySelector('.usage-page [role="alert"]'));

  await page.getByRole('button',{name:'快速配置',exact:true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  beforePoll=await page.evaluate(()=>window.usageFixture.requests.length);
  await page.clock.fastForward(90_000);
  assert.equal(await page.evaluate(()=>window.usageFixture.requests.length),beforePoll,'Leaving Usage must cancel polling');
  assert.equal(await page.locator('[data-quick-destination]').count(),7);
  const quickAlignment=await page.locator('.quick-page').evaluate(node=>({title:node.querySelector('h1').getBoundingClientRect().left,card:node.querySelector('.quick-overview').getBoundingClientRect().left}));
  assert.ok(Math.abs(quickAlignment.title-quickAlignment.card)<=1,'Quick setup cards must share the title margin');
  assert.match(await page.locator('[data-quick-state="identity"]').innerText(),/已保存 3 个身份/);
  assert.match(await page.locator('[data-quick-state="system"]').innerText(),/America\/New_York/);
  assert.match(await page.locator('[data-quick-state="browser"]').innerText(),/引擎已就绪/);
  assert.equal(await page.locator('.quick-page input,.quick-page [role="combobox"]').count(),0);
  const quickStart=(await page.evaluate(()=>window.usageFixture.commands)).length;
  await page.evaluate(()=>{window.usageFixture.failedRead='system_read';});
  await page.locator('.quick-page').getByRole('button',{name:'刷新状态',exact:true}).click();
  await page.locator('.quick-page [role="alert"]').waitFor();
  assert.match(await page.locator('[data-quick-state="system"]').innerText(),/无法读取/);
  assert.match(await page.locator('[data-quick-state="browser"]').innerText(),/引擎已就绪/);
  await page.evaluate(()=>{window.usageFixture.failedRead='';});
  await page.locator('.quick-page').getByRole('button',{name:'刷新状态',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.quick-page [role="alert"]')&&!document.querySelector('.quick-header button')?.disabled);
  const readCommands=(await page.evaluate(()=>window.usageFixture.commands)).slice(quickStart);
  assert.ok(readCommands.every(item=>['identities_read','browser_read','system_read','claude_cli_read'].includes(item.command)));
  await page.screenshot({path:join(output,'quick-setup-zh-light.png'),fullPage:true});
  for(const [destination,title] of [['vps','网络环境'],['cleaner','身份管理'],['browser','浏览环境'],['system','电脑环境'],['usage','用量分析'],['settings','软件设置']]){
    await page.locator('[data-quick-destination="'+destination+'"]').first().getByRole('button').click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'Navigation must not open a destructive confirmation');
    assert.equal(await page.evaluate(()=>localStorage.getItem('claude-local.page.v1')),destination);
    await page.getByRole('button',{name:'快速配置',exact:true}).click();
    await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  }

  await page.getByRole('button',{name:'网络环境',exact:true}).click();
  const network=page.locator('.network-page'),networkCards=network.locator('.network-action-card');
  await network.getByRole('heading',{name:'Claude 服务连通性',exact:true}).waitFor();
  assert.equal(await networkCards.count(),3);
  for(let index=0;index<3;index++)assert.equal(await networkCards.nth(index).getByRole('button').count(),1);
  assert.equal(await network.locator('input,textarea,a,.network-prompt-preview').count(),0);
  for(const card of await networkCards.all())assert.doesNotMatch(await card.evaluate(node=>node.outerHTML),/ikuuu\.top|kookeey\.com|uXqM|14151075|legacy\.example\.invalid/i,'Fixed referral links and invite codes must be hidden from card text and attributes');
  await page.screenshot({path:join(output,'network-copy-only-zh.png'),fullPage:true});
  const beforeCopyUrl=page.url();
  for(const [index,name] of [[0,'复制链接'],[1,'复制链接'],[2,'复制提示词']]){
    const button=networkCards.nth(index).getByRole('button',{name,exact:true});
    const beforeCopy=await page.evaluate(()=>window.usageFixture.copied.length);
    await button.click();
    await page.waitForFunction(count=>window.usageFixture.copied.length===count+1,beforeCopy);
    await network.locator('.network-copy-status[role="status"]').waitFor();
    assert.equal(await button.innerText(),name,'Copy success must preserve the button label');
  }
  const copied=await page.evaluate(()=>window.usageFixture.copied);
  assert.deepEqual(copied.slice(0,2),['https://ikuuu.top/auth/register?code=uXqM','https://www.kookeey.com/?aff=14151075']);
  for(const intent of [/iKuuu/i,/Kookeey/i,/Clash Verge Rev/i,/SOCKS5/i,/dialer-proxy/,/TUN/i,/DNS/i,/备份/,/回环|本地回调/,/版本/,/验证/,/回滚/])assert.match(copied[2],intent);
  assert.ok(copied[2].trim().split(/\r?\n/).filter(line=>line.trim()).length<=8,'The copied prompt must remain a concise configuration brief');
  assert.doesNotMatch(copied[2],/function\s+main|tcp-concurrent|mixed-port|7890|rules\s*[:=]/i);
  assert.equal(page.url(),beforeCopyUrl);assert.equal(context.pages().length,1,'Copy actions must not create vendor pages');
  assert.equal((await page.evaluate(()=>window.usageFixture.commands)).filter(item=>item.command==='network_diagnose_domains').length,0);
  const diagnostics=network.locator('.domain-diagnostics');
  assert.equal(await diagnostics.getByRole('button').count(),1);
  await diagnostics.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.domain-diagnostics')?.getAttribute('data-status')==='passed');

  await page.getByRole('button',{name:'身份管理',exact:true}).click();
  const identityCards=page.locator('.identity-card:not(.empty)');
  await identityCards.first().locator('[data-quota-window="5h"]').waitFor();
  assert.equal(await identityCards.count(),3);
  const identityAliases=['Alpha workspace','Beta workspace','Gamma workspace — synthetic long local archive alias'];
  const identityAccountNames=['Alpha account owner','Beta account owner','Gamma account owner'];
  const identityEmails=['alpha@example.invalid','beta@example.invalid','gamma@example.invalid'];
  assert.equal(await identityCards.locator('.identity-user-name,.identity-saved-name').count(),0,'Different account names must stay out of the visible card layout');
  for(let index=0;index<identityAliases.length;index++){
    const heading=identityCards.nth(index).locator('h3[data-identity-name]');
    assert.equal(await heading.locator(':scope > strong').innerText(),identityAliases[index],'Current and saved cards must prefer their local alias');
    assert.ok((await heading.locator(':scope > strong').getAttribute('title')||'').includes(identityAccountNames[index]));
    assert.ok((await heading.getAttribute('aria-description')||'').includes(identityAccountNames[index]));
    const titleStyle=await heading.locator(':scope > strong').evaluate(node=>{const style=getComputedStyle(node);return {whiteSpace:style.whiteSpace,overflow:style.overflow,textOverflow:style.textOverflow};});
    assert.deepEqual(titleStyle,{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
    assert.equal(await identityCards.nth(index).locator('.identity-email').count(),1);
  }
  const cardGeometry=await readIdentityGeometry();
  verifyIdentityGeometry(cardGeometry,'Chinese identity cards');
  assert.equal(cardGeometry[0].card.y,cardGeometry[2].card.y);
  assert.match(await identityCards.first().locator('[data-quota-window="5h"]').innerText(),/剩余 51%/);
  assert.match(await identityCards.first().locator('[data-quota-window="7d"]').innerText(),/剩余 82%/);
  assert.equal(await identityCards.first().locator('.identity-organization').count(),0);
  assert.equal(await identityCards.first().locator('.identity-email').count(),1);
  assert.equal(await identityCards.nth(1).locator('.identity-sub-resets-block').count(),0);
  assert.equal(await identityCards.nth(2).locator('[data-quota-window="5h"] i').count(),0);
  assert.match(await identityCards.nth(2).innerText(),/Max 20x/i);
  for(const [windowName,datePattern] of [['5h',/^\d{2}-\d{2} \d{2}:\d{2}$/],['7d',/^\d{2}-\d{2} \d{2}:\d{2}$/]]){
    const reset=identityCards.first().locator('[data-quota-window="'+windowName+'"] .identity-quota-reset');
    assert.match(await reset.locator('time.identity-reset-time').innerText(),datePattern,'Reset date/time must be readable text without a repeated reset prefix');
    const resetSemantics=await reset.evaluate(node=>[node.getAttribute('title'),node.getAttribute('aria-label'),...Array.from(node.querySelectorAll('[title],[aria-label]')).flatMap(child=>[child.getAttribute('title'),child.getAttribute('aria-label')])].filter(Boolean).join(' '));
    assert.match(resetSemantics,/重置/,'The reset icon must retain accessible reset semantics');
    assert.match(await reset.locator('.identity-quota-countdown').innerText(),/^\d+(?:d \d+h|h \d+m|m)$/);
    assert.equal(await reset.locator('small').count(),0);
  }
  await page.evaluate(async()=>{const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({quotaDisplay:'used',privacyMask:true});});
  await page.waitForFunction(()=>document.querySelector('.identity-card.current [data-quota-window="5h"]')?.textContent.includes('已用 49%'));
  for(let index=0;index<identityAliases.length;index++){
    const exposed=await identityCards.nth(index).evaluate(node=>[node.textContent,...Array.from(node.querySelectorAll('[title],[aria-label],[aria-description]')).flatMap(child=>[child.getAttribute('title'),child.getAttribute('aria-label'),child.getAttribute('aria-description')])].filter(Boolean).join('\n'));
    assert.equal(exposed.includes(identityEmails[index]),false,'Privacy mode must mask every current/saved email, including tooltips');
    assert.equal(exposed.includes(identityAccountNames[index]),false,'Privacy mode must omit extra account names from visible and accessible descriptions');
    assert.equal(await identityCards.nth(index).locator('h3[data-identity-name] > strong').innerText(),identityAliases[index]);
  }
  assert.equal(await identityCards.nth(2).locator('[data-quota-window="5h"] i').count(),0,'Unknown quota must remain unknown when switching the display preference');
  assert.equal(await page.evaluate(()=>window.usageFixture.identityState.current.display_name),'Alpha account owner');
  assert.equal(await page.evaluate(()=>window.usageFixture.identityState.summaries['00000000000000000000000000000003'].display_name),'Gamma account owner','Presentation and privacy changes must preserve account summaries');
  await page.evaluate(async()=>{const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({quotaDisplay:'remaining',privacyMask:false});});
  await page.waitForFunction(()=>document.querySelector('.identity-card.current [data-quota-window="5h"]')?.textContent.includes('剩余 51%'));
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'identity-cards-zh.png'),fullPage:true});
  const cli=page.locator('.identity-cli');
  await cli.getByRole('heading',{name:'Claude Code CLI',exact:true}).waitFor();
  assert.equal(await cli.getByRole('button',{name:/一键卸载|一键重装/}).count(),0);
  await cli.getByRole('button',{name:'检查更新',exact:true}).click();
  await cli.getByText(/当前 2\.1\.303 · 最新 2\.1\.304/).waitFor();
  await cli.getByRole('button',{name:'一键更新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.cli-status-pill')?.textContent.includes('2.1.304'));
  await page.evaluate(()=>{window.usageFixture.cliRunning=true;});
  await cli.getByRole('button',{name:'检查更新',exact:true}).click();
  await cli.getByText(/Claude Code 正在运行/).waitFor();
  assert.equal(await cli.getByRole('button',{name:'一键更新',exact:true}).isDisabled(),true);
  await cli.scrollIntoViewIfNeeded();
  await page.screenshot({path:join(output,'cli-update-controls-zh.png'),fullPage:true});

  await page.getByRole('button',{name:'电脑环境',exact:true}).click();
  await page.locator('.system-setting-card').first().waitFor();
  assert.equal(await page.locator('.system-setting-card').count(),3);
  const timezoneCard=page.locator('[data-system-setting="timezone"]'),languageCard=page.locator('[data-system-setting="language"]'),locationCard=page.locator('[data-system-setting="location"]');
  await timezoneCard.locator('.system-current-value').filter({hasText:'America/New_York'}).waitFor();
  const systemGeometry=await readSystemGeometry('Chinese 1040-wide computer environment');
  assert.ok(systemGeometry.trailingGap<=24,'Computer actions must fill the card and align to its end');
  assert.ok(systemGeometry.cards[2].box.height<=systemGeometry.cards[0].box.height-20,'The location row must be visibly shorter than a card with draft controls');
  assert.ok(systemGeometry.locationButtons.every(button=>button.width<200),'Location actions must keep a normal button width');
  assert.equal(await timezoneCard.locator('.system-inline-controls > .system-inline-field').count(),1);
  assert.equal(await languageCard.locator('.system-inline-controls > .system-inline-field').count(),1);
  assert.equal(await locationCard.locator('.system-inline-field').count(),0,'The location row must not reserve an empty select field');
  const currentSystemValues=[await timezoneCard.locator('.system-current-value').innerText(),await languageCard.locator('.system-current-value').innerText()];
  const beforeSystemDraft=await page.evaluate(()=>window.usageFixture.commands.length);
  await chooseSystemDraft('目标时区','Asia/Shanghai');
  await chooseSystemDraft('目标语言','zh-Hans','简体中文');
  assert.equal(await timezoneCard.getByRole('button',{name:'应用时区',exact:true}).isEnabled(),true);
  assert.equal(await languageCard.getByRole('button',{name:'应用语言',exact:true}).isEnabled(),true);
  assert.deepEqual([await timezoneCard.locator('.system-current-value').innerText(),await languageCard.locator('.system-current-value').innerText()],currentSystemValues,'Unapplied timezone/language drafts must not replace observed current values');
  assert.deepEqual(await page.evaluate(()=>({timezone:window.usageFixture.systemState.timezone,languages:window.usageFixture.systemState.languages})),{timezone:'America/New_York',languages:['en-US']});
  await page.evaluate(()=>{window.usageFixture.systemState.location_enabled=null;window.usageFixture.systemState.automatic_timezone=null;window.dispatchEvent(new Event('focus'));});
  await locationCard.locator('.system-state-label').filter({hasText:/未核验|未知/}).waitFor();
  assert.doesNotMatch(await locationCard.locator('.system-state-label').innerText(),/关闭/,'Unknown location status must not be presented as disabled');
  assert.deepEqual([await timezoneCard.locator('.system-current-value').innerText(),await languageCard.locator('.system-current-value').innerText()],currentSystemValues);
  await page.evaluate(()=>{window.usageFixture.systemState.location_enabled=false;window.usageFixture.systemState.automatic_timezone=false;window.dispatchEvent(new Event('focus'));});
  await locationCard.locator('.system-state-label').filter({hasText:/已关闭/}).waitFor();
  await chooseSystemDraft('目标时区','America/New_York','America/New York');
  await chooseSystemDraft('目标语言','en','English');
  const systemDraftCommands=(await page.evaluate(()=>window.usageFixture.commands)).slice(beforeSystemDraft);
  assert.ok(systemDraftCommands.every(item=>item.command==='system_read'),'System draft and refresh checks must remain read-only');
  await page.getByRole('heading',{name:'电脑环境',exact:true}).click();
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'computer-environment-zh.png'),fullPage:true});
  await page.setViewportSize({width:720,height:720});
  const systemNarrowClassicGeometry=await readSystemGeometry('Chinese narrow computer environment with classic sidebar');
  await page.screenshot({path:join(output,'computer-environment-zh-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1040,height:820});
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
  await page.locator('.sidebar-compact').waitFor();
  const compactGeometry=await page.locator('.app-sidebar').evaluate(node=>{
    const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const boxes=[box(node.querySelector('.app-brand img')),box(node.querySelector('.sidebar-collapse-btn')),...[...node.querySelectorAll('.language-switch button')].map(box)];
    const overlaps=(a,b)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
    return {boxes,overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>overlaps(a,b))),width:node.clientWidth,scrollWidth:node.scrollWidth};
  });
  assert.equal(compactGeometry.overlap,false,'Compact logo, expand and language controls must not overlap');
  assert.ok(compactGeometry.scrollWidth<=compactGeometry.width+1);
  await page.screenshot({path:join(output,'compact-sidebar-system-zh.png'),fullPage:true});
  await page.setViewportSize({width:720,height:720});
  const systemNarrowCompactGeometry=await readSystemGeometry('Chinese narrow computer environment with compact sidebar');
  await page.screenshot({path:join(output,'computer-environment-zh-narrow-compact.png'),fullPage:true});
  await page.setViewportSize({width:1040,height:820});
  await page.getByRole('button',{name:'用量分析',exact:true}).click();
  await page.getByText('claude-test-model',{exact:true}).waitFor();

  await page.getByRole('radio', {name: 'EN', exact: true}).click();
  await page.getByRole('heading', {name: 'Usage analytics', exact: true}).waitFor();
  await page.evaluate(async()=>{const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({theme:'dark'});});
  await page.setViewportSize({width: 900, height: 720});
  await page.getByRole('button',{name:'Quick setup',exact:true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.match(await page.locator('[data-quick-state="cli"]').innerText(),/CLI session running/);
  await page.setViewportSize({width:720,height:720});
  const quickGeometry=await page.locator('.quick-page').evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth}));
  assert.ok(quickGeometry.scrollWidth<=quickGeometry.width+1,'Quick setup must fit a narrow compact window');
  assert.equal(await page.getByRole('radio',{name:'CN',exact:true}).innerText(),'CN');
  await page.screenshot({path:join(output,'quick-setup-en-dark-narrow.png'),fullPage:true});
  await page.setViewportSize({width:900,height:720});
  await page.getByRole('button',{name:'Identity management',exact:true}).click();
  await page.locator('[data-quota-window="5h"]').first().waitFor();
  assert.match(await page.locator('.identity-card.current').innerText(),/Remaining 51%/);
  const cardGeometryEnglish=await readIdentityGeometry();
  verifyIdentityGeometry(cardGeometryEnglish,'English dark identity cards');
  assert.deepEqual(await identityCards.locator('h3[data-identity-name] > strong').allTextContents(),identityAliases);
  assert.equal(await identityCards.locator('.identity-user-name,.identity-saved-name').count(),0);
  const englishResetSemantics=await identityCards.first().locator('.identity-quota-reset').first().evaluate(node=>[node.getAttribute('title'),node.getAttribute('aria-label'),...Array.from(node.querySelectorAll('[title],[aria-label]')).flatMap(child=>[child.getAttribute('title'),child.getAttribute('aria-label')])].filter(Boolean).join(' '));
  assert.match(englishResetSemantics,/[Rr]eset/);
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'identity-cards-en-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'Usage analytics',exact:true}).click();
  await page.getByText('claude-test-model',{exact:true}).waitFor();
  await page.screenshot({path: join(output, 'usage-analytics-en-dark-compact.png'), fullPage: true});
  const geometry = await page.locator('.usage-page').evaluate(node => ({width: node.clientWidth, scrollWidth: node.scrollWidth}));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, 'Usage page must not overflow horizontally');
  const englishView=page.getByRole('tablist',{name:'Trend view',exact:true});
  assert.equal(await englishView.getByRole('tab',{name:'Chart',exact:true}).getAttribute('aria-selected'),'true');
  const beforeEnglishView=await page.evaluate(()=>window.usageFixture.requests.length);
  await englishView.getByRole('tab',{name:'Data',exact:true}).click();
  await page.locator('.usage-trend-table').getByRole('table',{name:'Usage by period',exact:true}).waitFor();
  await englishView.getByRole('tab',{name:'Chart',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.usageFixture.requests.length),beforeEnglishView,'English view switching must also reuse the existing snapshot');
  await page.evaluate(()=>{window.usageFixture.longNames=true;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.locator('.usage-model-row').filter({hasText:'synthetic-long-context-workspace-preview-2026-10-20'}).first().waitFor();
  await page.setViewportSize({width:720,height:720});
  const narrowCompactGeometry=await usageGeometry('English dark long model names with compact sidebar');
  await page.getByRole('heading',{name:'Usage analytics',exact:true}).click();
  await page.mouse.move(2,2);
  await page.screenshot({path:join(output,'usage-analytics-en-dark-narrow.png'),fullPage:true});
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
  const longNameClassicGeometry=await usageGeometry('English dark long model names with classic sidebar');
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
  await page.setViewportSize({width:900,height:720});

  await page.getByRole('button',{name:'Computer',exact:true}).click();
  await page.locator('.system-setting-card').first().waitFor();
  await page.locator('[data-system-setting="timezone"] .system-current-value').filter({hasText:'America/New_York'}).waitFor();
  const systemEnglishGeometry=await readSystemGeometry('English dark computer environment','dark');
  await page.screenshot({path:join(output,'computer-environment-en-dark-compact.png'),fullPage:true});
  await page.setViewportSize({width:720,height:720});
  const systemEnglishNarrowCompactGeometry=await readSystemGeometry('English dark narrow computer environment with compact sidebar','dark');
  await page.screenshot({path:join(output,'computer-environment-en-dark-narrow.png'),fullPage:true});
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
  const systemEnglishNarrowClassicGeometry=await readSystemGeometry('English dark narrow computer environment with classic sidebar','dark');
  await page.screenshot({path:join(output,'computer-environment-en-dark-narrow-classic.png'),fullPage:true});
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
  await page.setViewportSize({width:900,height:720});
  await page.getByRole('button',{name:'Network',exact:true}).click();
  await page.getByRole('heading',{name:'Claude service connectivity',exact:true}).waitFor();
  for(let index=0;index<3;index++)assert.equal(await page.locator('.network-page .network-action-card').nth(index).getByRole('button').count(),1);
  assert.equal(await page.locator('.network-page input,.network-page textarea,.network-prompt-preview').count(),0);
  const englishNetworkCards=page.locator('.network-page .network-action-card');
  for(const [index,name] of [[0,'Copy link'],[1,'Copy link'],[2,'Copy prompt']]){
    const card=englishNetworkCards.nth(index),button=card.getByRole('button',{name,exact:true});
    assert.doesNotMatch(await card.evaluate(node=>node.outerHTML),/ikuuu\.top|kookeey\.com|uXqM|14151075|legacy\.example\.invalid/i);
    const beforeCopy=await page.evaluate(()=>window.usageFixture.copied.length);
    await button.click();
    await page.waitForFunction(count=>window.usageFixture.copied.length===count+1,beforeCopy);
    await page.locator('.network-copy-status[role="status"]').filter({hasText:/copied/i}).waitFor();
    assert.equal(await button.innerText(),name);
  }
  const copiedEnglish=await page.evaluate(()=>window.usageFixture.copied.slice(-3));
  assert.deepEqual(copiedEnglish.slice(0,2),['https://ikuuu.top/auth/register?code=uXqM','https://www.kookeey.com/?aff=14151075']);
  assert.match(copiedEnglish[2],/US static residential/i);assert.match(copiedEnglish[2],/dialer-proxy/);
  assert.ok(copiedEnglish[2].trim().split(/\r?\n/).filter(line=>line.trim()).length<=8);
  assert.equal(page.url(),beforeCopyUrl);assert.equal(context.pages().length,1);
  await page.getByRole('button',{name:'Usage analytics',exact:true}).click();
  await page.getByText('claude-test-model',{exact:true}).waitFor();

  await page.evaluate(() => { window.usageFixture.empty = true; });
  await page.getByRole('button', {name: 'Refresh', exact: true}).click();
  await page.waitForFunction(() => !document.querySelector('.usage-page')?.textContent.includes('claude-test-model'));
  const requests = await page.evaluate(() => window.usageFixture.requests);
  assert.ok(requests.some(request => request.period === 'week'));
  assert.ok(requests.every(request => Math.abs(request.offsetMinutes) <= 840));
  assert.deepEqual(errors, []);
  const commands=await page.evaluate(()=>window.usageFixture.commands);
  assert.equal(commands.some(item=>item.command==='identities_stop'||(item.command==='claude_cli_manage'&&item.args.action!=='update')||/^system_(set|disable|open)/.test(item.command)||['open_permissions','unlock_keychain'].includes(item.command)||/^browser_(launch|rotate|clear|quit|align|save|set)/.test(item.command)),false);
  const result = {checks: ['navigation', 'period/account filters', '24 hourly slots and future gaps', '81-day complete history', '7/30 day spans and hover reset', 'chart/data switching without IPC reread', 'elapsed-hour table pagination and accessible sorting', 'three-model totals and distribution', '1440-wide and 720-narrow layouts with both sidebar modes', 'English dark long-model-name layout', '30-second polling and hidden pause', 'pending read serialization and unmount cleanup', 'read-only quick setup snapshots and six destinations', 'partial status failure and recovery', 'bilingual quick setup and narrow dark layout', 'refresh error and recovery', 'uniform metric cards', 'fixed publisher URLs and prompt copy', 'legacy URL override ignored', 'manual service diagnostics', 'total-only chart and consistent colors', 'K/M/B labels', 'two quota blocks and independent resets', 'single-line current/saved aliases and preserved summaries', 'long-name card/quota/subscription/footer geometry', 'bilingual 12px sans quota/reset/countdown typography', 'accessible reset dates and compact countdowns', 'known/unknown subscription and quota', 'used/remaining preference and all-card masked tooltips', 'CLI check/update and active-session block', 'natural-height system cards and compact location row', 'system current observations stay separate from unapplied drafts', 'unknown location is not shown as disabled', 'bilingual dark/narrow system layouts and read-only refresh', 'compact sidebar hitboxes', 'English dark compact layout', 'empty state', 'isolated IPC'], geometry, wideGeometry,narrowClassicGeometry,narrowCompactGeometry,longNameClassicGeometry,compactGeometry,cardGeometry,cardGeometryEnglish,quickGeometry,systemGeometry,systemNarrowClassicGeometry,systemNarrowCompactGeometry,systemEnglishGeometry,systemEnglishNarrowCompactGeometry,systemEnglishNarrowClassicGeometry, requests: requests.length, screenshots: output};
  await writeFile(join(output, 'usage-ui-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser?.close();
  await server.close();
}
