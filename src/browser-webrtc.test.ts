/**
 * [INPUT]: Fake RTCPeerConnection behavior and deterministic timer callbacks.
 * [OUTPUT]: Real probe collector maps constructor errors, rejected offers and deadlines to unknown.
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
function fakePeer(createOffer:()=>Promise<unknown>):WebRtcPeer{
 return {onicecandidate:null,createDataChannel:()=>undefined,createOffer,setLocalDescription:async()=>undefined,close:()=>undefined};
}

test('RTC constructor throw produces unknown through the production collector',async()=>{
 const {timers}=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>{throw new Error('constructor failed');},timers);
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('offer rejection produces unknown through the production collector',async()=>{
 const {timers}=fakeTimers();
 const result=await probeWebRtcLocalCandidates(()=>fakePeer(()=>Promise.reject(new Error('offer failed'))),timers);
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});

test('300ms collection deadline without completion produces unknown',async()=>{
 const clock=fakeTimers();
 const pending=new Promise<unknown>(()=>{});
 const resultPromise=probeWebRtcLocalCandidates(()=>fakePeer(()=>pending),clock.timers);
 await Promise.resolve();
 expect(clock.requestedMs()).toBe(300);
 clock.expire();
 const result=await resultPromise;
 expect(result.ok).toBeNull();
 expect(result.detail).toContain('结果未知');
});
