/**
 * [INPUT]: 宿主提供的多源 HTTPS 地理服务（ipquery.io / ipinfo.io / api.ip.sb / get.geojs.io / ipwho.is）、可选固定 IPQuery 分类服务与浏览器 fetch；始终走当前浏览器路由。
 * [OUTPUT]: probeBrowserExit、parseExit；支持多服务响应结构解析与顺序故障备援、同源分类限流/超时去重、仅缺 hosting 时同 IP 布尔补充分类及受控诊断。
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
function normalizeAsn(raw:unknown):string {
  if(typeof raw==='number'&&Number.isFinite(raw)&&raw>0)return `AS${Math.trunc(raw)}`;
  if(typeof raw==='string'){
    const trimmed=raw.trim();
    if(!trimmed||trimmed.length>=60||trimmed==='0'||trimmed.toUpperCase()==='AS0')return '';
    return trimmed.toUpperCase().startsWith('AS')?`AS${trimmed.slice(2)}`:`AS${trimmed}`;
  }
  return '';
}
function splitLeadingAsn(raw:string):{asn:string;org:string}|null {
  const match=raw.trim().match(/^AS([1-9]\d{0,9})\s+(.+)$/i);
  if(!match)return null;
  const org=match[2].trim();
  return org?{asn:`AS${match[1]}`,org}:null;
}
function firstNonEmptyField(candidates:readonly unknown[]):string {
  for(const candidate of candidates){
    if(candidate==null)continue;
    if(typeof candidate!=='string'||candidate.length>=300)throw new Error('出口字段无效');
    const trimmed=candidate.trim();
    if(trimmed)return trimmed;
  }
  return '';
}
export function parseExit(value:unknown):Exit {
  const data=value as Record<string,unknown>|null;
  const hasErrorObj=data!=null&&((typeof data.error==='object'&&data.error!==null)||typeof data.error==='string');
  const location=data?.location&&typeof data.location==='object'?data.location as {country_code?:unknown;city?:unknown;timezone?:unknown}:undefined;
  const rawCountry=data?.country_code!==undefined&&data?.country_code!==null
    ?data.country_code
    :(location?.country_code!==undefined&&location?.country_code!==null?location.country_code:data?.country);
  if(!data||data.success===false||data.error===true||hasErrorObj||typeof data.ip!=='string'||!validIp(data.ip)||typeof rawCountry!=='string'||!/^[A-Z]{2}$/.test(rawCountry))throw new Error('出口检测返回无效数据');
  const zone=data.timezone&&typeof data.timezone==='object'?data.timezone as {id?:unknown}:undefined;
  const connection=data.connection&&typeof data.connection==='object'?data.connection as {isp?:unknown;asn?:unknown;org?:unknown;type?:unknown}:undefined;
  const ispObj=data.isp&&typeof data.isp==='object'?data.isp as {isp?:unknown;asn?:unknown;org?:unknown}:undefined;
  const ispStr=typeof data.isp==='string'?data.isp:undefined;
  const security=data.security&&typeof data.security==='object'?data.security as {hosting?:unknown;vpn?:unknown;proxy?:unknown}:undefined;
  const risk=data.risk&&typeof data.risk==='object'?data.risk as {is_datacenter?:unknown}:undefined;
  let asnStr=normalizeAsn(data.asn)||normalizeAsn(connection?.asn)||normalizeAsn(ispObj?.asn);
  let isp=firstNonEmptyField([data.org,connection?.isp,connection?.org,ispObj?.isp,ispObj?.org,ispStr,data.organization_name,data.organization,data.asn_organization]);
  if(!asnStr&&isp){
    const split=splitLeadingAsn(isp);
    if(split){asnStr=split.asn;isp=split.org;}
  }
  const hosting=typeof data.hosting==='boolean'
    ?data.hosting
    :typeof security?.hosting==='boolean'
      ?security.hosting
      :typeof risk?.is_datacenter==='boolean'
        ?risk.is_datacenter
        :undefined;
  const exit:Exit={
    ip:data.ip,
    country:rawCountry,
    city:firstNonEmptyField([data.city,location?.city]),
    timezone:firstNonEmptyField([typeof data.timezone==='string'?data.timezone:undefined,zone?.id,location?.timezone]),
    isp,
  };
  if(asnStr)exit.asn=asnStr;
  if(hosting!==undefined)exit.hosting=hosting;
  return exit;
}
function canonicalIp(ip:string):string|null {
  if(!validIp(ip))return null;
  return ip.includes(':')?new URL(`http://[${ip}]/`).hostname.slice(1,-1):ip;
}
async function readBoundedText(response:Response):Promise<{ok:true;text:string}|{ok:false;reason:'response_too_large'|'invalid_response'}> {
  const reader=response.body?.getReader();
  if(!reader){
    const text=await response.text();
    return new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES?{ok:false,reason:'response_too_large'}:{ok:true,text};
  }
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BODY_BYTES){await reader.cancel();return {ok:false,reason:'response_too_large'};}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {ok:true,text:new TextDecoder().decode(bytes)};
}
async function supplementHosting(exit:Exit,service:string,request:(address:string,options?:RequestInit)=>Promise<Response>):Promise<Exit> {
  // Only the fixed provider is permitted; a context cannot turn this into an arbitrary request.
  if(service!==CLASSIFICATION_SERVICE)return {...exit,hosting_error:'invalid_response'};
  let error:HostingError='network_error';
  try{
    const response=await request(`${service}${exit.ip}?format=json`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!response.ok)return {...exit,hosting_error:response.status===429?'rate_limited':'http_error'};
    const body=await readBoundedText(response);
    if(!body.ok)return {...exit,hosting_error:body.reason};
    error='invalid_response';
    const data=JSON.parse(body.text);
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
function formatFetchError(e:unknown):{message:string;classifierCode?:HostingError} {
  if(e instanceof Error){
    if(e.name==='TimeoutError'||e.name==='AbortError')return {message:'请求超时',classifierCode:'timeout'};
    if(e instanceof TypeError)return {message:'网络连接失败',classifierCode:'network_error'};
    const msg=e.message.trim();
    return {message:msg.length>60?msg.slice(0,60):msg};
  }
  const msg=String(e).trim();
  return {message:msg.length>60?msg.slice(0,60):msg};
}
export async function probeBrowserExit(services:readonly string[],request:(address:string,options?:RequestInit)=>Promise<Response>=fetch,classificationService?:string):Promise<Exit> {
  const errors:string[]=[];
  let classifierOrigin='';
  if(classificationService===CLASSIFICATION_SERVICE){
    try{classifierOrigin=new URL(classificationService).origin;}catch{classifierOrigin='';}
  }
  let priorClassificationError:HostingError|undefined;
  for(const address of services){
    let parsedUrl:URL;
    try{parsedUrl=new URL(address);}catch{errors.push(`${address}：出口检测返回无效数据`);continue;}
    const sameOriginAsClassifier=!!classifierOrigin&&parsedUrl.origin===classifierOrigin;
    try{
      const response=await request(address,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok){
        if(sameOriginAsClassifier&&!priorClassificationError){
          priorClassificationError=response.status===429?'rate_limited':'http_error';
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const body=await readBoundedText(response);
      if(!body.ok){
        if(sameOriginAsClassifier&&!priorClassificationError)priorClassificationError=body.reason;
        throw new Error(body.reason==='response_too_large'?'出口响应过大':'出口检测返回无效数据');
      }
      let raw:unknown;
      try{raw=JSON.parse(body.text);}catch{throw new Error('出口检测返回无效数据');}
      const exit=parseExit(raw);
      const rawRisk=(raw as {risk?:{is_datacenter?:unknown}}|null)?.risk;
      if(parsedUrl.hostname==='api.ipquery.io'&&typeof rawRisk?.is_datacenter==='boolean'&&exit.hosting===rawRisk.is_datacenter){
        exit.hosting_source='ipquery';
      }
      if(exit.hosting===undefined&&classificationService){
        if(priorClassificationError&&classificationService===CLASSIFICATION_SERVICE){
          return {...exit,hosting_error:priorClassificationError};
        }
        return await supplementHosting(exit,classificationService,request);
      }
      return exit;
    }catch(e){
      const formatted=formatFetchError(e);
      if(sameOriginAsClassifier&&!priorClassificationError&&formatted.classifierCode){
        priorClassificationError=formatted.classifierCode;
      }
      errors.push(`${parsedUrl.hostname}：${formatted.message}`);
    }
  }
  throw new Error(`出口检测未完成（${errors.join('；')}）。请检查 TUN/代理连接后重试。`);
}
