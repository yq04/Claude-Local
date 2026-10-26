/**
 * [INPUT]: Injected RTCPeerConnection constructor, timers and optional clock; production defaults use browser APIs.
 * [OUTPUT]: No-STUN observation with separate 5000ms negotiation and 2000ms gathering deadlines, controlled reason and elapsed time; failures remain unknown.
 * [POS]: Shared probe implementation for the browser entry and isolated fake-RTC tests; makes no network requests.
 * [PROTOCOL]: Update src/CLAUDE.md when this module changes.
 */
export type WebRtcCandidateEvent={candidate:{candidate:string}|null};
export interface WebRtcPeer {
 onicecandidate:((event:WebRtcCandidateEvent)=>void)|null;
 onicegatheringstatechange?:((event:unknown)=>void)|null;
 iceGatheringState?:string;
 createDataChannel(label:string):unknown;
 createOffer():Promise<unknown>;
 setLocalDescription(offer:unknown):Promise<void>;
 close():void;
}
export type ProbeTimers={setTimeout:(callback:()=>void,ms:number)=>unknown;clearTimeout:(handle:unknown)=>void;now?:()=>number};
export type WebRtcProbeReason='complete'|'non_local_candidate'|'constructor_error'|'setup_error'|'offer_error'|'description_error'|'negotiation_timeout'|'gathering_timeout';
export type WebRtcProbeResult={ok:boolean|null;detail:string;reason:WebRtcProbeReason;elapsedMs:number};
const browserTimers:ProbeTimers={setTimeout:(callback,ms)=>globalThis.setTimeout(callback,ms),clearTimeout:handle=>globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)};
const nonLocalAddress=(candidate:string):string|undefined=>{
 const address=candidate.split(/\s+/)[4]||'';
 if(!address||address.endsWith('.local')||['127.0.0.1','::1','0.0.0.0'].includes(address))return;
 return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)||address.includes(':')?address:undefined;
};
export function probeWebRtcLocalCandidates(createPeer:()=>WebRtcPeer,timers:ProbeTimers=browserTimers):Promise<WebRtcProbeResult> {
 const now=timers.now||(()=>globalThis.performance.now());
 const startedAt=now();
 return new Promise(resolve=>{
  let settled=false;
  let descriptionSet=false;
  let completionObserved=false;
  const leaked=new Set<string>();
  let peer:WebRtcPeer|undefined;
  let timer:unknown;
  const finish=(reason:WebRtcProbeReason)=>{
   if(settled)return;
   settled=true;
   if(timer!==undefined)timers.clearTimeout(timer);
   if(peer){
    try{peer.onicecandidate=null;}catch{}
    try{peer.onicegatheringstatechange=null;}catch{}
    try{peer.close();}catch{/* Keep the measurement result. */}
   }
   const detail={
    complete:'无 STUN 的本地候选收集已完成，未发现非本地地址；不覆盖 DNS 或公网 STUN',
    non_local_candidate:`检出候选 IP：${[...leaked].slice(0,2).join(', ')}`,
    constructor_error:'WebRTC 接口构造失败，结果未知',
    setup_error:'WebRTC 探针初始化失败，结果未知',
    offer_error:'WebRTC offer 创建失败，结果未知',
    description_error:'WebRTC 本地描述设置失败，结果未知',
    negotiation_timeout:'WebRTC 协商在 5000ms 内未完成，结果未知',
    gathering_timeout:'本地候选收集在 2000ms 内未完成，结果未知',
   }[reason];
   resolve({ok:reason==='non_local_candidate'?false:reason==='complete'?true:null,detail,reason,elapsedMs:Math.max(0,Math.round(now()-startedAt))});
  };
  // A synchronous native constructor cannot be preempted by a JavaScript timer.
  // Start bounded asynchronous negotiation afterwards, rather than spending the ICE window here.
  try{peer=createPeer();}catch{finish('constructor_error');return;}
  const activePeer=peer;
  const observeCompletion=()=>{
   completionObserved=true;
   if(descriptionSet)finish('complete');
  };
  try{
   timer=timers.setTimeout(()=>finish('negotiation_timeout'),5000);
   peer.onicecandidate=event=>{
    if(settled)return;
    if(event.candidate===null){observeCompletion();return;}
    const candidate=event.candidate.candidate;
    const address=nonLocalAddress(candidate);
    if(address){leaked.add(address);finish('non_local_candidate');return;}
    // An empty non-null candidate ends one generation, not necessarily all gathering.
    if(peer?.iceGatheringState==='complete')observeCompletion();
   };
   peer.onicegatheringstatechange=()=>{
    if(!settled&&peer?.iceGatheringState==='complete')observeCompletion();
   };
   peer.createDataChannel('probe');
   if(peer.iceGatheringState==='complete')observeCompletion();
  }catch{finish('setup_error');return;}
  if(settled)return;
  void (async()=>{
   let offer:unknown;
   try{offer=await activePeer.createOffer();}catch{finish('offer_error');return;}
   // Offers may settle after the negotiation deadline has already closed the peer.
   if(settled)return;
   try{await activePeer.setLocalDescription(offer);}catch{finish('description_error');return;}
   if(settled)return;
   descriptionSet=true;
   if(timer!==undefined)timers.clearTimeout(timer);
   timer=undefined;
   if(activePeer.iceGatheringState==='complete')completionObserved=true;
   if(completionObserved){finish('complete');return;}
   timer=timers.setTimeout(()=>finish('gathering_timeout'),2000);
   if(activePeer.iceGatheringState==='complete')observeCompletion();
  })();
 });
}
