// [INPUT]: A fresh bundled Chromium profile, fixed MV3 bridge and HTTPS/local synthetic responses.
// [OUTPUT]: Real-navigation evidence for pairing, service-worker restart, identity recheck and bounded failure handling.
// [POS]: End-to-end browser bridge test; all Claude-origin requests are intercepted and no user profile is opened.
// [PROTOCOL]: Keep this test synthetic and isolated; update scripts/CLAUDE.md when its scope changes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {appendFile,copyFile,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const resourceManifest=JSON.parse(await readFile(resolve(root,'scripts/runtime-resources.json'),'utf8'));
const executablePath=resolve(root,'browser-runtime/WindowsBrowser/chrome.exe');
const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright-core/index.mjs')).href);
const account='11111111-1111-4111-8111-111111111111';
const organization='22222222-2222-4222-8222-222222222222';
const otherOrganization='33333333-3333-4333-8333-333333333333';
const email='synthetic@example.invalid';
const quotaIdentity=createHash('sha256').update(JSON.stringify([account,email,organization])).digest('hex');
const callbacks=[];
const pages=new Map();
let nextTicket=1;
let serverRequests=0;
const server=createServer((request,response)=>{
  serverRequests++;
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(request.method==='OPTIONS'){
    response.writeHead(204,{'Access-Control-Allow-Origin':'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'});response.end();return;
  }
  if(path.endsWith('/browser.html')){
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end('<!doctype html><title>Claude-Local synthetic pairing</title>');return;
  }
  if(path.endsWith('/quota-sync')&&request.method==='POST'){
    let raw='';request.setEncoding('utf8');request.on('data',chunk=>raw+=chunk);request.on('end',()=>{
      try{callbacks.push({path,origin:request.headers.origin,body:JSON.parse(raw)});response.writeHead(200,{'Content-Type':'application/json'});response.end('{"ok":true}');}
      catch{response.writeHead(400);response.end();}
    });return;
  }
  response.writeHead(404);response.end();
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'claude-local-quota-integration-'));
const ledgerRoot=await mkdtemp(join(tmpdir(),'claude-local-quota-ledger-'));
const installedRoot=join(profile,'installed-resources');
for(const [source,target] of Object.entries(resourceManifest.resources)){
  const targetPath=join(installedRoot,target);
  await mkdir(resolve(targetPath,'..'),{recursive:true});
  const sourcePath=resolve(root,'scripts',source);
  await copyFile(sourcePath,targetPath);
  const sourceHash=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  const installedHash=createHash('sha256').update(await readFile(targetPath)).digest('hex');
  assert.equal(installedHash,sourceHash,`installed resource must match source: ${target}`);
}
const extension=join(installedRoot,'browser-runtime','quota-bridge');
await appendFile(join(extension,'background.js'),`\nchrome.runtime.onMessage.addListener((message,sender)=>{\n  const key='__testQuotaMessages';\n  void chrome.storage.session.get(key).then(state=>chrome.storage.session.set({[key]:[...(state[key]||[]).slice(-19),{kind:message?.kind,tabUrl:sender.tab?.url||'',url:sender.url||''}]}));\n});\n`);
let context;
try{
  context=await chromium.launchPersistentContext(profile,{
    executablePath,headless:true,ignoreHTTPSErrors:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--no-proxy-server']
  });
  if(!context.serviceWorkers().length)await context.waitForEvent('serviceworker',{timeout:15000});
  let challenge=false;
  let changeIdentityAfterUsage=false;
  let usageMode='normal';
  let identityCalls=0;
  let navigationControl=null;
  let workerRestartPromise;
  let restartStage='idle';
  const browserCdp=await context.browser().newBrowserCDPSession();
  await browserCdp.send('Target.setDiscoverTargets',{discover:true});
  const queried=[];
  const routeEntries=[];
  const pageDiagnostics=[];
  let routeFailure=null;
  await context.route('**/*',async route=>{try{
    const url=new URL(route.request().url());
    let frameUrl='no-associated-frame';
    try{frameUrl=route.request().frame().url();}catch{}
    routeEntries.push(`${frameUrl} -> ${url.href}`);
    if(url.protocol==='chrome-extension:'){await route.continue();return;}
    if(url.protocol==='http:'&&url.hostname==='127.0.0.1'){
      if(url.pathname.endsWith('/browser.html')){
        await route.fulfill({status:200,contentType:'text/html',headers:{'Cache-Control':'no-store'},body:'<!doctype html><title>Claude-Local synthetic pairing</title>'});return;
      }
      await route.continue();return;
    }
    if(url.origin!=='https://claude.ai'){await route.abort();return;}
    queried.push(url.pathname+url.search);
    if(url.pathname==='/settings/usage'){
      let restartWorker=false;
      if(navigationControl){
        const control=navigationControl;navigationControl=null;
        routeEntries.push(`control:${control.nonce}:restart=${control.restartWorker}:expire=${control.expire}`);
        const worker=context.serviceWorkers()[0];
        const stored=await worker.evaluate(async nonce=>chrome.storage.session.get(nonce),control.nonce);
        assert.ok(stored[control.nonce],'pairing ticket should be in extension session storage before HTTPS navigation');
        if(control.expire){
          stored[control.nonce].expiresAt=Date.now()-1;
          await worker.evaluate(async ({nonce,value})=>chrome.storage.session.set({[nonce]:value}),{nonce:control.nonce,value:stored[control.nonce]});
        }
        restartWorker=control.restartWorker;
        if(control.delayMs)await new Promise(resolveDelay=>setTimeout(resolveDelay,control.delayMs));
        if(restartWorker){
          restartStage='locating worker';
          const {targetInfos}=await browserCdp.send('Target.getTargets');
          const target=targetInfos.find(item=>item.type==='service_worker'&&item.url.endsWith('/background.js'));
          assert.ok(target,'MV3 service worker target should be active before the restart test');
          restartStage='closing worker';
          await browserCdp.send('Target.closeTarget',{targetId:target.targetId});
          restartStage='waiting for old worker to stop';
          await waitForTargetState(browserCdp,target.targetId,false);
          restartStage='resuming navigation';
          await route.fulfill({status:200,contentType:'text/html',headers:{'Cache-Control':'no-store'},body:'<!doctype html><title>Synthetic usage page</title>'});
          restartStage='waiting for replacement worker';
          const replacement=await waitForTargetState(browserCdp,target.targetId,true);
          workerRestartPromise=Promise.resolve(replacement.targetId);
          restartStage=`restarted as ${replacement.targetId}`;
          return;
        }
      }
      else routeEntries.push('settings:no-control');
      await route.fulfill({status:200,contentType:'text/html',headers:{'Cache-Control':'no-store'},body:'<!doctype html><title>Synthetic usage page</title>'});
      return;
    }
    if(url.pathname==='/api/account'){
      identityCalls++;
      const changed=changeIdentityAfterUsage&&identityCalls>1;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({account:{uuid:changed?'44444444-4444-4444-8444-444444444444':account,email_address:email}})});return;
    }
    if(url.pathname==='/api/account_profile'){
      await route.fulfill({status:200,contentType:'application/json',body:'{}'});return;
    }
    if(url.pathname==='/api/organizations'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{uuid:otherOrganization},{uuid:organization}])});return;
    }
    if(url.pathname.endsWith('/subscription_details')){
      await route.fulfill({status:403,contentType:'text/html',body:'challenge'});return;
    }
    if(url.pathname.endsWith('/usage')){
      if(challenge){await route.fulfill({status:200,contentType:'text/html',body:'<html>challenge</html>'});return;}
      if(usageMode==='timeout'){
        await new Promise(resolveDelay=>setTimeout(resolveDelay,6000));
        await route.fulfill({status:200,contentType:'application/json',body:'{}'});return;
      }
      if(usageMode==='oversized'){
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({usage:'x'.repeat(600*1024)})});return;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        five_hour:{utilization:23,resets_at:'2027-01-01T00:00:00Z',private:'drop'},
        seven_day:{utilization:44,resets_at:'2027-01-05T00:00:00Z'},
        cedar_ember:{eligible:true,grants:[{resets_left:3,starts_at:'2026-01-01T00:00:00Z',ends_at:'2028-01-01T00:00:00Z',paused:false,secret:'drop'}],private:'drop'}
      })});return;
    }
    await route.fulfill({status:404,contentType:'application/json',body:'{}'});
  }catch(error){routeFailure=String(error);await route.abort().catch(()=>{});}});

  async function navigate(ticket,{expire=false,delayMs=0,restartWorker=false}={}){
    const nonce=(nextTicket++).toString(16).padStart(48,'0');
    const hash=createHash('sha256').update(JSON.stringify([account,email,organization])).digest('hex');
    const page=await context.newPage();pages.set(ticket,page);
    page.on('request',request=>pageDiagnostics.push(`${ticket}:request:${request.url()}`));
    page.on('console',message=>pageDiagnostics.push(`${ticket}:console:${message.type()}:${message.text().slice(0,240)}`));
    page.on('pageerror',error=>pageDiagnostics.push(`${ticket}:pageerror:${String(error).slice(0,240)}`));
    const pageCdp=await context.newCDPSession(page);
    await pageCdp.send('Network.enable');
    await pageCdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await pageCdp.send('Runtime.enable');
    pageCdp.on('Runtime.exceptionThrown',event=>pageDiagnostics.push(`${ticket}:exception:${event.exceptionDetails.text.slice(0,240)}`));
    navigationControl={nonce,expire,delayMs,restartWorker};
    const local=`http://127.0.0.1:${port}/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${hash}`;
    try{await page.goto(local,{waitUntil:'commit',timeout:45000});}
    catch(error){throw new Error(`${String(error)}; serverRequests=${serverRequests}; routeFailure=${routeFailure||'none'}`);}
    return {page,nonce};
  }

  const normal=await navigate('normal-flow');
  try{await waitFor(()=>callbacks.length>=1,12_000);}
  catch(error){
    const worker=context.serviceWorkers()[0];
    const observed=worker?await worker.evaluate(async()=>chrome.storage.session.get('__testQuotaMessages')):{};
    throw new Error(`${String(error)}; page=${normal.page.url()}; queries=${queried.join(',')||'none'}; observed=${JSON.stringify(observed)}; pageDiagnostics=${JSON.stringify(pageDiagnostics)}; routeFailure=${routeFailure||'none'}`);
  }
  await waitFor(()=>callbacks.length>=1,12_000);
  assert.ok(normal.page.url().startsWith('https://claude.ai/settings/usage'));
  assert.equal(callbacks[0].origin,'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg');
  assert.deepEqual(Object.keys(callbacks[0].body).sort(),['account_uuid','nonce','organization_uuid','usage']);
  assert.equal(callbacks[0].body.account_uuid,account);
  assert.equal(callbacks[0].body.organization_uuid,organization,'only the fingerprint-matched organization may be selected');
  assert.ok(!JSON.stringify(callbacks[0].body).includes('drop'));
  assert.ok(!queried.some(path=>path.includes(otherOrganization)),'the unmatched organization must not be queried');
  const observedAtMs=Date.now();
  const normalized={
    account_uuid:callbacks[0].body.account_uuid,
    organization_uuid:callbacks[0].body.organization_uuid,
    billing_date_kind:'unknown',billing_date:null,
    manual_resets_remaining:3,manual_resets_valid_until:Math.floor(observedAtMs/1000)+6*60*60,
    metadata_observed_at_ms:observedAtMs,
    usage:Object.fromEntries(Object.entries(callbacks[0].body.usage||{})
      .filter(([name])=>name==='five_hour'||name==='seven_day')),
  };
  const python=spawnSync('python',[resolve(root,'scripts/test-quota-ledger-integration.py'),ledgerRoot],{
    input:JSON.stringify(normalized),encoding:'utf8',timeout:15000,
    env:{...process.env,CLAUDE_LOCAL_RESOURCE_ROOT:installedRoot},
  });
  assert.equal(python.status,0,python.stderr||'synthetic Python quota ledger import failed');
  const persisted=JSON.parse(python.stdout);
  assert.equal(persisted.result.status,'updated');
  assert.equal(persisted.metadata.manual_resets_remaining,3);
  assert.equal(persisted.metadata.manual_resets_valid_until,normalized.manual_resets_valid_until);
  assert.equal(persisted.quota_windows.five_hour.utilization,23);

  const beforeRestart=callbacks.length;
  const restartFlow=await navigate('worker-restart',{restartWorker:true});
  try{await waitForValue(()=>workerRestartPromise,12000,`MV3 worker restart at ${restartStage} (${routeFailure||'no route error'}; requests=${queried.join(',')||'none'})`);}
  catch(error){
    const worker=context.serviceWorkers()[0];
    const observed=worker?await worker.evaluate(async()=>chrome.storage.session.get('__testQuotaMessages')):{};
    throw new Error(`${String(error)}; stage=${restartStage}; routeFailure=${routeFailure||'none'}; page=${restartFlow.page.url()}; observed=${JSON.stringify(observed)}; routeEntries=${JSON.stringify(routeEntries)}; pageDiagnostics=${JSON.stringify(pageDiagnostics)}`);
  }
  assert.ok(await workerRestartPromise,'MV3 worker should restart with a new target after the test-only close');
  await waitFor(()=>callbacks.length>beforeRestart,12000);
  assert.ok(restartFlow.page.url().startsWith('https://claude.ai/settings/usage'));

  const beforeExpiry=callbacks.length;
  const expired=await navigate('expired-ticket',{expire:true});
  await new Promise(resolveDelay=>setTimeout(resolveDelay,1200));
  assert.equal(callbacks.length,beforeExpiry,'expired pairing ticket must not deliver a snapshot');
  await expired.page.close();

  challenge=true;identityCalls=0;
  const beforeChallenge=callbacks.length;
  const challenged=await navigate('challenge-response');
  await waitFor(()=>callbacks.length>beforeChallenge,8000);
  assert.equal(callbacks.at(-1).body.failure,'identity_unavailable','challenge HTML cannot be treated as authorized usage');
  await challenged.page.close();

  challenge=false;changeIdentityAfterUsage=true;identityCalls=0;
  const beforeMismatch=callbacks.length;
  const changed=await navigate('identity-changed');
  await waitFor(()=>callbacks.length>beforeMismatch,8000);
  assert.equal(callbacks.at(-1).body.failure,'identity_unavailable','identity change during collection must be rejected');
  await changed.page.close();

  changeIdentityAfterUsage=false;identityCalls=0;usageMode='oversized';
  const beforeOversized=callbacks.length;
  const oversized=await navigate('oversized-response');
  await waitFor(()=>callbacks.length>beforeOversized,8000);
  assert.equal(callbacks.at(-1).body.failure,'identity_unavailable','oversized response bodies must fail closed');
  await oversized.page.close();

  usageMode='timeout';identityCalls=0;
  const beforeTimeout=callbacks.length;
  const timedOut=await navigate('timed-out-response');
  await waitFor(()=>callbacks.length>beforeTimeout,9000);
  assert.equal(callbacks.at(-1).body.failure,'identity_unavailable','request deadline must produce a failure callback');
  await timedOut.page.close();

  console.log('Synthetic quota integration passed: real MV3 navigation, worker stop/restart, one-org fingerprint match, expiry, challenge/identity rejection, timeout and body cap.');
}finally{
  for(const page of pages.values())if(!page.isClosed())await page.close();
  if(context)await context.close();
  await new Promise(done=>server.close(done));
  await rm(profile,{recursive:true,force:true});
  await rm(ledgerRoot,{recursive:true,force:true});
}

async function waitFor(predicate,timeoutMs){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){if(predicate())return;await new Promise(resolveDelay=>setTimeout(resolveDelay,25));}
  assert.fail('timed out waiting for synthetic quota bridge callback');
}
async function waitForValue(value,timeoutMs,label){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){const result=value();if(result!==undefined)return result;await new Promise(resolveDelay=>setTimeout(resolveDelay,20));}
  assert.fail(`timed out waiting for ${label}`);
}
async function waitForTargetState(session,previousTargetId,expectReplacement,timeoutMs=10000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const {targetInfos}=await session.send('Target.getTargets');
    const workers=targetInfos.filter(item=>item.type==='service_worker'&&item.url.endsWith('/background.js'));
    if(expectReplacement){
      const replacement=workers[0];
      if(replacement)return replacement;
    }else if(!workers.some(item=>item.targetId===previousTargetId))return true;
    await new Promise(resolveDelay=>setTimeout(resolveDelay,25));
  }
  assert.fail(expectReplacement?'timed out waiting for a new MV3 worker target':'timed out waiting for the old MV3 worker target to stop');
}
