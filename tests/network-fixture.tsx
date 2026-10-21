/**
 * [INPUT]: 真实网络页、Tauri mockIPC 与四类虚构诊断结果（四个固定域名，含 Cloudflare 浏览器质询可达）。
 * [OUTPUT]: 可控诊断成功/部分失败/命令异常/缺失结果、复制拒绝开关与调用记录，检测期间由测试显式释放。
 * [POS]: 无真实连接、密钥或外部导航的 GUI 回归样本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {createRoot} from 'react-dom/client';
import {mockIPC} from '@tauri-apps/api/mocks';
import {MotionRoot,TooltipProvider} from 'cromma-ui';
import {VpsPanel} from '../src/vps';
import {setLocale} from '../src/i18n';
import '../src/index.css';
import '../src/style.css';
let mode='success';
let copyFailure=false;
let release=()=>{};
const commands:string[]=[];
const copied:string[]=[];
Object.assign(window,{networkFixture:{commands,copied,setMode:(value:string)=>{mode=value;},setCopyFailure:(value:boolean)=>{copyFailure=value;},finish:()=>release(),language:setLocale}});
mockIPC((command,args)=>{
 if(command==='copy_result'){
  if(copyFailure)throw Error('fixture native clipboard denied');
  copied.push(String((args as {text?:string})?.text??''));
  return;
 }
 commands.push(command);
 if(command!=='network_diagnose_domains')throw Error(`Unexpected fixture command: ${command}`);
 return new Promise((resolve,reject)=>{release=()=>{
  if(mode==='error')return reject('fixture connection interrupted');
  if(mode==='empty')return resolve([]);
  if(mode==='invalid')return resolve(null);
  resolve(['claude.ai','api.anthropic.com','platform.claude.com','downloads.claude.ai'].map((domain,n)=>({domain,ok:mode!=='partial'||n!==1,status_code:mode==='partial'&&n===1?403:n===0?403:200,latency_ms:35+n,ip:'203.0.113.1',message:mode==='partial'&&n===1?'受到安全拦截或限制':n===0?'服务可达，需浏览器验证':'连接正常'})));
 };});
});
setLocale('zh');
createRoot(document.getElementById('fixture')!).render(<MotionRoot><TooltipProvider><VpsPanel/></TooltipProvider></MotionRoot>);
