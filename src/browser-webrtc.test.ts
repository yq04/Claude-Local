/**
 * [INPUT]: Fake RTCPeerConnection behavior and deterministic timer callbacks.
 * [OUTPUT]: Real probe collector maps constructor errors, rejected offers and deadlines to unknown; observes completion and detects leaks.
 * [POS]: Isolated tests for the same no-STUN collector used by browser-start.tsx; no network access.
 * [PROTOCOL]: Update src/CLAUDE.md when this test changes.
 */
import {expect,test} from 'bun:test';
import {probeWebRtcLocalCandidates,type ProbeTimers,type WebRtcPeer} from './browser-webrtc';

function fakeTimers(){
 let deadline:(()=>void)|undefined;
 let requestedMs=0;
 const timers:ProbeTimers={setTimeout:(callback,ms)=>{deadline=callback;requestedMs=ms;return 1;},clearTimeout:()=>{}};
 return {timers,expire:()=>deadline?.(),requestedMs:()=>requestedMs};
}
function fakePeer(opts:{
 createOffer?:()=>Promise<unknown>;
 setLocalDescription?:(offer:unknown)=>Promise<void>;
 iceGatheringState?:string;
 close?:()=>void;
}={}):WebRtcPeer{
 return {
  onicecandidate:null,
  onicegatheringstatechange:null,
  iceGatheringState:opts.iceGatheringState||'new',
  createDataChannel:()=>undefined,
  createOffer:opts.createOffer||(async()=>({})),
  setLocalDescription:opts.setLocalDescription||(async()=>undefined),
  close:opts.close||(()=>undefined),
 };
}

test('RTC constructor throw produces unknown through the production collector',async()=>{
 const {timers}=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>{throw new Error('constructor failed');},timers);
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('offer rejection produces unknown through the production collector',async()=>{
 const {timers}=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>fakePeer({createOffer:()=>Promise.reject(new Error('offer failed'))}),timers);
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('setLocalDescription rejection produces unknown through the production collector',async()=>{
 const {timers}=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>fakePeer({setLocalDescription:()=>Promise.reject(new Error('setLocalDescription failed'))}),timers);
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('1000ms collection deadline without completion produces unknown',async()=>{
 const clock=fakeTimers();
 const pending=new Promise<unknown>(()=>{});
 const resultPromise=probeWebRtcLocalCandidates(()=>fakePeer({createOffer:()=>pending}),clock.timers);
 await Promise.resolve();
 expect(clock.requestedMs()).toBe(1000);
 clock.expire();
 const result=await resultPromise;
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('candidate end without non-local candidates marks observation as passed',async()=>{
 const clock=fakeTimers();
 let peerRef:WebRtcPeer|undefined;
 const resultPromise=probeWebRtcLocalCandidates(()=>{
  peerRef=fakePeer();
  return peerRef;
 },clock.timers);
 await Promise.resolve();
 peerRef?.onicecandidate?.({candidate:{candidate:'candidate:0 1 UDP 2122252543 abc.local 54321 typ host'}});
 peerRef?.onicecandidate?.({candidate:null});
 const result=await resultPromise;
 expect(result.ok).toBe(true);
 expect(result.detail).toContain('1000ms 本地候选观察未发现非本地地址');
});

test('detected non-local candidate immediately marks observation as failed and reports IP',async()=>{
 const clock=fakeTimers();
 let peerRef:WebRtcPeer|undefined;
 const resultPromise=probeWebRtcLocalCandidates(()=>{
  peerRef=fakePeer();
  return peerRef;
 },clock.timers);
 await Promise.resolve();
 peerRef?.onicecandidate?.({candidate:{candidate:'candidate:1 1 UDP 2122252543 198.51.100.8 54321 typ host'}});
 const result=await resultPromise;
 expect(result.ok).toBe(false);
 expect(result.detail).toContain('198.51.100.8');
});

test('iceGatheringState complete via onicegatheringstatechange finishes as passed',async()=>{
 const clock=fakeTimers();
 let peerRef:WebRtcPeer|undefined;
 const resultPromise=probeWebRtcLocalCandidates(()=>{
  peerRef=fakePeer();
  return peerRef;
 },clock.timers);
 await Promise.resolve();
 if(peerRef){
  peerRef.iceGatheringState='complete';
  peerRef.onicegatheringstatechange?.({});
 }
 const result=await resultPromise;
 expect(result.ok).toBe(true);
});

test('iceGatheringState complete post-setLocalDescription finishes as passed',async()=>{
 const clock=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>fakePeer({
  setLocalDescription:async function(this:WebRtcPeer){
   this.iceGatheringState='complete';
  },
 }),clock.timers);
 expect(result.ok).toBe(true);
});

test('cleanup nulls handlers and closes peer on completion',async()=>{
 const clock=fakeTimers();
 let closed=false;
 let peerRef:WebRtcPeer|undefined;
 const resultPromise=probeWebRtcLocalCandidates(()=>{
  peerRef=fakePeer({close:()=>{closed=true;}});
  return peerRef;
 },clock.timers);
 await Promise.resolve();
 peerRef?.onicecandidate?.({candidate:null});
 await resultPromise;
 expect(closed).toBe(true);
 expect(peerRef?.onicecandidate).toBeNull();
 expect(peerRef?.onicegatheringstatechange).toBeNull();
});
