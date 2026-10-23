// [INPUT]: Fixed MV3 extension, pinned Chromium, and synthetic API fixtures.
// [OUTPUT]: Local assertions for pairing, one-shot delivery, and payload allowlisting.
// [POS]: Synthetic browser bridge regression; never signs in or contacts a real account.
// [PROTOCOL]: Update scripts/CLAUDE.md when changing this test.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const extension=resolve(root,'browser-runtime/quota-bridge');
const executablePath=resolve(root,'browser-runtime/WindowsBrowser/chrome.exe');
const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright-core/index.mjs')).href);
const nonce='0123456789abcdef0123456789abcdef0123456789abcdef';
const account='11111111-1111-4111-8111-111111111111';
const organization='22222222-2222-4222-8222-222222222222';
const otherOrganization='33333333-3333-4333-8333-333333333333';
const email='private@example.invalid';
const quotaIdentity=createHash('sha256').update(JSON.stringify([account,email,organization])).digest('hex');
let received=[];const receivedOrigins=[];
const server=createServer((request,response)=>{
  if(request.method==='OPTIONS'){
    response.writeHead(204,{'Access-Control-Allow-Origin':request.headers.origin||'null','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type'});response.end();return;
  }
  if(request.url===`/${nonce}/browser.html`){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>fixture</title>');return;}
  if(request.url===`/${nonce}/quota-sync`&&request.method==='POST'){
    let body='';request.setEncoding('utf8');request.on('data',chunk=>body+=chunk);request.on('end',()=>{
      try{received.push(JSON.parse(body));receivedOrigins.push(request.headers.origin);response.writeHead(200,{'Access-Control-Allow-Origin':request.headers.origin||'null','Content-Type':'application/json'});response.end('{"ok":true}');}
      catch{response.writeHead(400);response.end();}
    });return;
  }
  response.writeHead(404);response.end();
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'claude-local-quota-bridge-'));
let context;
try{
  context=await chromium.launchPersistentContext(profile,{
    executablePath,headless:true,ignoreHTTPSErrors:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check']
  });
  const workers=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const localUrl=`http://127.0.0.1:${port}/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${quotaIdentity}`;
  const claudeUrl=`https://claude.ai/settings/usage#claude-local-sync=${nonce}`;
  let outbound;
  const paired=await workers.evaluate(async({nonce,localUrl,quotaIdentity})=>{
    const sender={id:chrome.runtime.id,tab:{id:7,url:localUrl}};
    return {first:await pair({nonce,quotaIdentity},sender),duplicate:await pair({nonce,quotaIdentity},sender)};
  },{nonce,localUrl,quotaIdentity});
  assert.deepEqual(paired,{first:{paired:true},duplicate:{paired:false}});
  const queried=[];
  const fakeResponses={
    '/api/account':{account:{uuid:account,email_address:email},unrelated:'drop'},
    '/api/account_profile':null,
    '/api/organizations':[{uuid:otherOrganization,name:'Private Other Organization'},{id:organization,name:'Private Organization'}],
    [`/api/organizations/${organization}/subscription_details`]:null,
    [`/api/organizations/${organization}/usage?at_wall=1&skip_spend=1`]:{five_hour:{utilization:23,resets_at:'2027-01-01T00:00:00Z',private:'drop'},seven_day:{utilization:44,resets_at:'2027-01-05T00:00:00Z'},cedar_ember:{eligible:true,grants:[{resets_left:3,starts_at:'2026-01-01T00:00:00Z',ends_at:'2028-01-01T00:00:00Z',paused:false,secret:'must-not-leak'}],private:'drop'}}
  };
  const content=await readFile(join(extension,'content.js'),'utf8');
  await runInNewContext(content,{
    URL,AbortController,setTimeout,clearTimeout,TextDecoder,location:{href:claudeUrl,origin:'https://claude.ai',pathname:'/settings/usage',search:'',hash:`#claude-local-sync=${nonce}`},
    history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){}},
    fetch:async path=>{queried.push(path);return {ok:Object.hasOwn(fakeResponses,path)&&fakeResponses[path]!==null,json:async()=>fakeResponses[path]};},
    chrome:{runtime:{sendMessage:async message=>{
      const sender={id:workers.url().match(/^chrome-extension:\/\/([^/]+)/)[1],tab:{id:7,url:claudeUrl}};
      if(message.kind==='claude-local-quota-candidates')return workers.evaluate(({msg,sender})=>matchCandidates(msg,sender),{msg:message,sender});
      if(message.kind==='claude-local-quota-snapshot'){
        outbound=message;
        return workers.evaluate(({msg,sender})=>deliver(msg,sender),{msg:message,sender});
      }
      return {paired:false};
    }}},
    encodeURIComponent
  });
  for(let i=0;i<30&&!outbound;i++)await new Promise(resolveWait=>setTimeout(resolveWait,10));
  assert.equal(outbound?.kind,'claude-local-quota-snapshot');
  const mismatchNonce='abcdef0123456789abcdef0123456789abcdef0123456789';
  const mismatchHash=createHash('sha256').update(JSON.stringify([account,email,otherOrganization])).digest('hex');
  const mismatch=await workers.evaluate(async({nonce,hash,port,account,email,organization})=>{
    const local=`http://127.0.0.1:${port}/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${hash}`;
    const sender={id:chrome.runtime.id,tab:{id:8,url:local}};
    await pair({nonce,quotaIdentity:hash},sender);
    return matchCandidates({kind:'claude-local-quota-candidates',nonce,accountUuids:[account],emails:[email],organizationUuids:[organization]},
      {id:chrome.runtime.id,tab:{id:8,url:'https://claude.ai/settings/usage'}});
  },{nonce:mismatchNonce,hash:mismatchHash,port,account,email,organization});
  assert.deepEqual(mismatch,{matched:null},'unbound identity fingerprint must not select an organization');
  const differentMember='44444444-4444-4444-8444-444444444444';
  const memberMismatch=await workers.evaluate(async({nonce,hash,port,differentMember,email,organization})=>{
    const local=`http://127.0.0.1:${port}/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${hash}`;
    await pair({nonce,quotaIdentity:hash},{id:chrome.runtime.id,tab:{id:9,url:local}});
    return matchCandidates({kind:'claude-local-quota-candidates',nonce,
      accountUuids:[differentMember],emails:[email],organizationUuids:[organization]},
      {id:chrome.runtime.id,tab:{id:9,url:'https://claude.ai/settings/usage'}});
  },{nonce:'bcdef0123456789abcdef0123456789abcdef0123456789a',hash:quotaIdentity,port,differentMember,email,organization});
  assert.deepEqual(memberMismatch,{matched:null},'same organization with another member must not match');
  const missingAccount=await workers.evaluate(async({nonce,hash,port,email,organization})=>{
    const local=`http://127.0.0.1:${port}/${nonce}/browser.html#quota-sync=${nonce}&quota_identity=${hash}`;
    await pair({nonce,quotaIdentity:hash},{id:chrome.runtime.id,tab:{id:10,url:local}});
    return matchCandidates({kind:'claude-local-quota-candidates',nonce,accountUuids:[],emails:[email],organizationUuids:[organization]},
      {id:chrome.runtime.id,tab:{id:10,url:'https://claude.ai/settings/usage'}});
  },{nonce:'cdef0123456789abcdef0123456789abcdef0123456789ab',hash:quotaIdentity,port,email,organization});
  assert.deepEqual(missingAccount,{matched:null},'organization and email without account UUID must not match');
  const snapshot=outbound.snapshot;
  assert.equal(received.length,1,'paired flow should post once');
  assert.equal(receivedOrigins[0],'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg','The real extension callback must supply the fixed origin required by the native receiver');
  const body=received[0];
  assert.deepEqual(Object.keys(body).sort(),['account_uuid','nonce','organization_uuid','usage']);
  assert.equal(body.subscription_details,undefined,'subscription 403 must not discard successful usage');
  assert.deepEqual(body.usage,{five_hour:{utilization:23,resets_at:'2027-01-01T00:00:00Z'},seven_day:{utilization:44,resets_at:'2027-01-05T00:00:00Z'},cedar_ember:{eligible:true,grants:[{resets_left:3,starts_at:'2026-01-01T00:00:00Z',ends_at:'2028-01-01T00:00:00Z',paused:false}]}});
  assert.equal(body.account_uuid,account);assert.equal(body.organization_uuid,organization);
  assert.ok(queried.includes(`/api/organizations/${organization}/subscription_details`));
  assert.ok(queried.includes(`/api/organizations/${organization}/usage?at_wall=1&skip_spend=1`));
  assert.ok(!queried.some((path)=>path.includes(otherOrganization)),'unmatched organization must never be queried');
  assert.ok(!JSON.stringify(body).includes('secret'));
  assert.ok(new URL(workers.url()).host,'MV3 extension should be loaded');
  console.log('Synthetic MV3 quota bridge passed: duplicate pairing rejected and filtered snapshot delivered once.');
}finally{
  if(context)await context.close();
  await new Promise(resolveClose=>server.close(resolveClose));
  await rm(profile,{recursive:true,force:true});
}
