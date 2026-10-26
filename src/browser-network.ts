/**
 * [INPUT]: 宿主提供的 HTTPS 地理/可选固定 IPQuery 分类服务与浏览器 fetch；始终走当前浏览器路由。
 * [OUTPUT]: probeBrowserExit、parseExit；保留地理故障备援，仅在缺少 hosting 时以同 IP 补充布尔分类和受控诊断。
 * [POS]: 起始页外部请求的唯一边界；不借宿主代测浏览器出口，不在代理失败时切换直连。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {Exit,HostingError} from './browser-model';
const CLASSIFICATION_SERVICE='https://api.ipquery.io/';
const MAX_BODY_BYTES=32768;
function validIp(ip:string):boolean {
  if(ip.includes(':')){if(!/^[0-9A-Fa-f:.]+$/.test(ip))return false;try{return new URL(`http://[${ip}]/`).hostname.startsWith('[');}catch{return false;}}
  return ip.split('.').length===4&&ip.split('.').every(x=>/^(0|[1-9]\d{0,2})$/.test(x)&&Number(x)<=255);
}
export function parseExit(value:unknown):Exit {
  const data=value as Record<string,unknown>|null;
  if(!data||data.success===false||data.error===true||typeof data.ip!=='string'||!validIp(data.ip)||typeof data.country_code!=='string'||!/^[A-Z]{2}$/.test(data.country_code))throw new Error('出口检测返回无效数据');
  const field=(value:unknown):string=>{if(value==null)return '';if(typeof value!=='string'||value.length>=300)throw new Error('出口字段无效');return value;};
  const zone=data.timezone as {id?:unknown}|undefined;
  const connection=data.connection as {isp?:unknown;asn?:unknown;org?:unknown}|undefined;
  const security=data.security as {hosting?:unknown;vpn?:unknown;proxy?:unknown}|undefined;
  const rawAsn=data.asn??connection?.asn;
  const asnStr=typeof rawAsn==='number'&&Number.isFinite(rawAsn)?`AS${rawAsn}`:typeof rawAsn==='string'&&rawAsn.trim().length>0&&rawAsn.length<60?(rawAsn.trim().toUpperCase().startsWith('AS')?rawAsn.trim():`AS${rawAsn.trim()}`):'';
  const hosting=typeof data.hosting==='boolean'?data.hosting:typeof security?.hosting==='boolean'?security.hosting:undefined;
  const exit:Exit={ip:data.ip,country:data.country_code,city:field(data.city),timezone:field(typeof data.timezone==='string'?data.timezone:zone?.id),isp:field(data.org??connection?.isp??connection?.org)};
  if(asnStr)exit.asn=asnStr;
  if(hosting!==undefined)exit.hosting=hosting;
  return exit;
}
function canonicalIp(ip:string):string|null {
  if(!validIp(ip))return null;
  return ip.includes(':')?new URL(`http://[${ip}]/`).hostname.slice(1,-1):ip;
}
async function supplementHosting(exit:Exit,service:string,request:(address:string,options?:RequestInit)=>Promise<Response>):Promise<Exit> {
  // Only the fixed provider is permitted; a context cannot turn this into an arbitrary request.
  if(service!==CLASSIFICATION_SERVICE)return {...exit,hosting_error:'invalid_response'};
  let error:HostingError='network_error';
  try{
    const response=await request(`${service}${exit.ip}?format=json`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!response.ok)return {...exit,hosting_error:response.status===429?'rate_limited':'http_error'};
    const reader=response.body?.getReader();
    if(!reader)return {...exit,hosting_error:'invalid_response'};
    const chunks:Uint8Array[]=[];let size=0;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();return {...exit,hosting_error:'response_too_large'};}chunks.push(value);}
    }finally{reader.releaseLock();}
    error='invalid_response';
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(!data||typeof data.ip!=='string')return {...exit,hosting_error:'invalid_response'};
    const returnedIp=canonicalIp(data.ip);
    if(!returnedIp)return {...exit,hosting_error:'invalid_response'};
    if(returnedIp!==canonicalIp(exit.ip))return {...exit,hosting_error:'ip_mismatch'};
    if(typeof data.risk?.is_datacenter!=='boolean')return {...exit,hosting_error:'invalid_response'};
    return {...exit,hosting:data.risk.is_datacenter,hosting_source:'ipquery'};
  }catch(e){
    if(e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError'))error='timeout';
    return {...exit,hosting_error:error};
  }
}
export async function probeBrowserExit(services:readonly string[],request:(address:string,options?:RequestInit)=>Promise<Response>=fetch,classificationService?:string):Promise<Exit> {
  const errors:string[]=[];
  for(const address of services){
    try{
      const response=await request(address,{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const text=await response.text();if(text.length>32768)throw new Error('出口响应过大');
      const exit=parseExit(JSON.parse(text));
      return exit.hosting===undefined&&classificationService?await supplementHosting(exit,classificationService,request):exit;
    }catch(e){errors.push(`${new URL(address).hostname}：${e instanceof Error?e.message:String(e)}`);}
  }
  throw new Error(`出口检测未完成（${errors.join('；')}）。请检查 TUN/代理连接后重试。`);
}
