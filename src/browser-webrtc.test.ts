/**
 * [INPUT]: Synthetic RTCPeerConnection behavior, deferred negotiation and deterministic elapsed-time clock.
 * [OUTPUT]: Production collector regression for slow synchronous construction, phased deadlines, genuine completion, failures and late-settlement cleanup.
 * [POS]: Isolated tests for the same no-STUN collector used by browser-start.tsx; no network access.
 * [PROTOCOL]: Update src/CLAUDE.md when this test changes.
 */
import {expect,test} from 'bun:test';
import {probeWebRtcLocalCandidates,type ProbeTimers,type WebRtcPeer} from './browser-webrtc';

function fakeClock(){
 let now=0;
 let nextId=0;
 const jobs=new Map<number,{at:number;callback:()=>void}>();
 const timers:ProbeTimers={
  now:()=>now,
  setTimeout:(callback,ms)=>{const id=++nextId;jobs.set(id,{at:now+ms,callback});return id;},
  clearTimeout:handle=>{jobs.delete(handle as number);},
 };
 return {
  timers,
  // Models synchronous native work while the JavaScript event loop cannot run callbacks.
  elapseSync:(ms:number)=>{now+=ms;},
  advance:(ms:number)=>{
   const until=now+ms;
   while(true){
    const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next||next[1].at>until)break;
    jobs.delete(next[0]);now=Math.max(now,next[1].at);next[1].callback();
   }
   now=until;
  },
  deadlines:()=>[...jobs.values()].map(job=>job.at).sort((a,b)=>a-b),
 };
}
function deferred<T>(){
 let resolve!:(value:T)=>void;
 let reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
async function flushNegotiation(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
function fakePeer(opts:{
 createDataChannel?:()=>unknown;
 createOffer?:()=>Promise<unknown>;
 setLocalDescription?:(offer:unknown)=>Promise<void>;
 iceGatheringState?:string;
 close?:()=>void;
}={}):WebRtcPeer{
 return {
  onicecandidate:null,
  onicegatheringstatechange:null,
  iceGatheringState:opts.iceGatheringState||'new',
  createDataChannel:opts.createDataChannel||(()=>undefined),
  createOffer:opts.createOffer||(async()=>({})),
  setLocalDescription:opts.setLocalDescription||(async()=>undefined),
  close:opts.close||(()=>undefined),
 };
}

test('slow synchronous construction does not consume the independent gathering window',async()=>{
 const clock=fakeClock();
 const peer=fakePeer();
 const resultPromise=probeWebRtcLocalCandidates(()=>{clock.elapseSync(3554);return peer;},clock.timers);
 expect(clock.deadlines()).toEqual([8554]);
 await flushNegotiation();
 expect(clock.deadlines()).toEqual([5554]);
 clock.advance(123);
 peer.iceGatheringState='complete';
 peer.onicegatheringstatechange?.({});
 expect(await resultPromise).toMatchObject({ok:true,reason:'complete',elapsedMs:3677});
 expect(clock.deadlines()).toEqual([]);
});

test('RTC constructor throw has a controlled unknown reason and no remaining timer',async()=>{
 const clock=fakeClock();
 const result=await probeWebRtcLocalCandidates(()=>{throw new Error('synthetic');},clock.timers);
 expect(result).toMatchObject({ok:null,reason:'constructor_error',elapsedMs:0});
 expect(result.detail).toContain('结果未知');
 expect(clock.deadlines()).toEqual([]);
});

for(const reason of ['setup_error','offer_error','description_error'] as const){
 test(`${reason} remains unknown and closes the peer exactly once`,async()=>{
  const clock=fakeClock();
  let closed=0;
  const fail=()=>{throw new Error('synthetic');};
  const peer=fakePeer({
   close:()=>{closed++;},
   ...(reason==='setup_error'?{createDataChannel:fail}:{}),
   ...(reason==='offer_error'?{createOffer:async()=>fail()}:{}),
   ...(reason==='description_error'?{setLocalDescription:async()=>fail()}:{}),
  });
  const result=await probeWebRtcLocalCandidates(()=>peer,clock.timers);
  expect(result).toMatchObject({ok:null,reason});
  expect(result.detail).toContain('结果未知');
  expect(closed).toBe(1);
  expect(peer.onicecandidate).toBeNull();
  expect(peer.onicegatheringstatechange).toBeNull();
  expect(clock.deadlines()).toEqual([]);
 });
}

for(const phase of ['offer','description'] as const){
 test(`hung ${phase} is bounded and its late settlement cannot revive a closed probe`,async()=>{
  const clock=fakeClock();
  const pending=deferred<unknown>();
  let descriptionCalls=0;
  let closed=0;
  const peer=fakePeer({
   createOffer:phase==='offer'?()=>pending.promise:async()=>({}),
   setLocalDescription:()=>{descriptionCalls++;return phase==='description'?pending.promise.then(()=>undefined):Promise.resolve();},
   close:()=>{closed++;},
  });
  const resultPromise=probeWebRtcLocalCandidates(()=>peer,clock.timers);
  await flushNegotiation();
  clock.advance(5000);
  expect(await resultPromise).toMatchObject({ok:null,reason:'negotiation_timeout',elapsedMs:5000});
  expect(closed).toBe(1);
  expect(peer.onicecandidate).toBeNull();
  expect(peer.onicegatheringstatechange).toBeNull();
  pending.resolve({});
  await flushNegotiation();
  expect(descriptionCalls).toBe(phase==='description'?1:0);
  expect(closed).toBe(1);
  expect(clock.deadlines()).toEqual([]);
 });
}

test('successful negotiation receives a fresh full gathering window',async()=>{
 const clock=fakeClock();
 const offer=deferred<unknown>();
 const peer=fakePeer({createOffer:()=>offer.promise});
 const resultPromise=probeWebRtcLocalCandidates(()=>peer,clock.timers);
 clock.advance(4900);
 offer.resolve({});
 await flushNegotiation();
 expect(clock.deadlines()).toEqual([6900]);
 clock.advance(1999);
 expect(peer.onicecandidate).not.toBeNull();
 clock.advance(1);
 expect(await resultPromise).toMatchObject({ok:null,reason:'gathering_timeout',elapsedMs:6900});
 expect(clock.deadlines()).toEqual([]);
});

test('empty non-null candidate is not final completion; null candidate completes and cleans up',async()=>{
 const clock=fakeClock();
 let closed=0;
 const peer=fakePeer({close:()=>{closed++;}});
 const resultPromise=probeWebRtcLocalCandidates(()=>peer,clock.timers);
 await flushNegotiation();
 const callback=peer.onicecandidate;
 callback?.({candidate:{candidate:'candidate:0 1 UDP 2122252543 abc.local 54321 typ host'}});
 callback?.({candidate:{candidate:''}});
 expect(closed).toBe(0);
 expect(clock.deadlines()).toEqual([2000]);
 callback?.({candidate:null});
 expect(await resultPromise).toMatchObject({ok:true,reason:'complete'});
 expect(closed).toBe(1);
 expect(peer.onicecandidate).toBeNull();
 expect(peer.onicegatheringstatechange).toBeNull();
 clock.advance(10000);
 callback?.({candidate:null});
 expect(closed).toBe(1);
 expect(clock.deadlines()).toEqual([]);
});

test('non-local IP candidate immediately fails the observation and closes once',async()=>{
 const clock=fakeClock();
 let closed=0;
 const peer=fakePeer({close:()=>{closed++;}});
 const resultPromise=probeWebRtcLocalCandidates(()=>peer,clock.timers);
 await flushNegotiation();
 peer.onicecandidate?.({candidate:{candidate:'candidate:1 1 UDP 2122252543 198.51.100.8 54321 typ host'}});
 const result=await resultPromise;
 expect(result).toMatchObject({ok:false,reason:'non_local_candidate'});
 expect(result.detail).toContain('198.51.100.8');
 expect(closed).toBe(1);
 expect(clock.deadlines()).toEqual([]);
});

for(const completion of ['before','during'] as const){
 test(`complete state ${completion} description is checked without requiring an event`,async()=>{
  const clock=fakeClock();
  const peer=fakePeer({
   iceGatheringState:completion==='before'?'complete':'new',
   setLocalDescription:async function(this:WebRtcPeer){this.iceGatheringState='complete';},
  });
  expect(await probeWebRtcLocalCandidates(()=>peer,clock.timers)).toMatchObject({ok:true,reason:'complete'});
  expect(clock.deadlines()).toEqual([]);
 });
}

for(const descriptionOutcome of ['resolved','rejected'] as const){
 test(`completion observed during pending description waits for its ${descriptionOutcome} outcome`,async()=>{
  const clock=fakeClock();
  const description=deferred<void>();
  let closed=0;
  const peer=fakePeer({setLocalDescription:()=>description.promise,close:()=>{closed++;}});
  const resultPromise=probeWebRtcLocalCandidates(()=>peer,clock.timers);
  await flushNegotiation();
  peer.onicecandidate?.({candidate:null});
  expect(closed).toBe(0);
  if(descriptionOutcome==='resolved')description.resolve(undefined);
  else description.reject(new Error('synthetic'));
  expect(await resultPromise).toMatchObject(descriptionOutcome==='resolved'?{ok:true,reason:'complete'}:{ok:null,reason:'description_error'});
  expect(closed).toBe(1);
  expect(clock.deadlines()).toEqual([]);
 });
}
