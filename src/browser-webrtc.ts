/**
 * [INPUT]: Injected RTCPeerConnection constructor and timer functions; production defaults use browser APIs.
 * [OUTPUT]: Finite no-STUN local candidate observation with iceGatheringState and statechange tracking; setup/offer failure or deadline yields unknown.
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
export type ProbeTimers={setTimeout:(callback:()=>void,ms:number)=>unknown;clearTimeout:(handle:unknown)=>void};
const browserTimers:ProbeTimers={setTimeout:(callback,ms)=>globalThis.setTimeout(callback,ms),clearTimeout:handle=>globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)};
const nonLocalAddress=(candidate:string):string|undefined=>{
 const address=candidate.split(/\s+/)[4]||'';
 if(!address||address.endsWith('.local')||['127.0.0.1','::1','0.0.0.0'].includes(address))return;
 return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)||address.includes(':')?address:undefined;
};
export function probeWebRtcLocalCandidates(createPeer:()=>WebRtcPeer,timers:ProbeTimers=browserTimers):Promise<{ok:boolean|null;detail:string}> {
 return new Promise(resolve=>{
  let settled=false;
  const leaked=new Set<string>();
  let peer:WebRtcPeer|undefined;
  let timer:unknown;
  const finish=(complete:boolean)=>{
   if(settled)return;
   settled=true;
   if(timer!==undefined)timers.clearTimeout(timer);
   if(peer){
    try{peer.onicecandidate=null;}catch{}
    try{peer.onicegatheringstatechange=null;}catch{}
    try{peer.close();}catch{/* Keep the measurement result. */}
   }
   if(leaked.size)resolve({ok:false,detail:`检出候选 IP：${[...leaked].slice(0,2).join(', ')}`});
   else if(complete)resolve({ok:true,detail:'无 STUN 的 1000ms 本地候选观察未发现非本地地址；不覆盖 DNS 或公网 STUN'});
   else resolve({ok:null,detail:'候选收集未完成或接口失败，结果未知'});
  };
  timer=timers.setTimeout(()=>finish(false),1000);
  try{
   peer=createPeer();
   peer.createDataChannel('probe');
   peer.onicecandidate=event=>{
    const candidate=event?.candidate?.candidate||'';
    if(!candidate){finish(true);return;}
    const address=nonLocalAddress(candidate);
    if(address){leaked.add(address);finish(true);return;}
    if(peer?.iceGatheringState==='complete')finish(true);
   };
   peer.onicegatheringstatechange=()=>{
    if(peer?.iceGatheringState==='complete')finish(true);
   };
   if(peer.iceGatheringState==='complete'){finish(true);return;}
   void peer.createOffer()
    .then(offer=>peer?.setLocalDescription(offer))
    .then(()=>{
     if(peer?.iceGatheringState==='complete')finish(true);
    })
    .catch(()=>finish(false));
  }catch{finish(false);}
 });
}
