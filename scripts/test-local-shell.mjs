// [INPUT]: Main shell and fictional account/browser/system snapshots.
// [OUTPUT]: Bilingual local-only shell and quick setup previews.
// [POS]: Isolated fake IPC screenshot helper; no runtime data or native changes.
// [PROTOCOL]: Update scripts/CLAUDE.md with changes.
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
const {createServer}=await import(pathToFileURL(resolve(root,'node_modules/vite/dist/node/index.js')).href);
const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright-core/index.mjs')).href);
const output=resolve(process.argv[2]||join(tmpdir(),'claude-local-ui-20261018'));
await mkdir(output,{recursive:true});
const privateHome=await mkdtemp(join(tmpdir(),'claude-local-preview-home-'));
await mkdir(join(privateHome,'config'));await mkdir(join(privateHome,'cache'));
const previewModule=`
import {mockIPC} from '/node_modules/@tauri-apps/api/mocks.js';
import {defaultPolicy} from '/src/identity-model.ts';
const now=Math.floor(Date.now()/1000);
const id=n=>n.toString(16).padStart(32,'0');
const current={present:true,display_name:'Studio account',email:'studio@example.invalid',organization:'Personal workspace',plan:'Max 20x',auth_status:'valid',proxy:null,quota_5h_used:35,quota_7d_used:40,quota_5h_reset_at:now+8100,quota_7d_reset_at:now+540000,unavailable:false};
const state={browser:{enabled:true,bound_ids:[id(2),id(3)]},browser_warning:null,active:id(1),recovery:null,running:true,sessions:[],current,records:Array.from({length:6},(_,n)=>({id:id(n+1),name:['Studio account','Research workspace','Writing account','备用工作身份','Long workspace identity name','Travel workspace'][n],saved_at:Date.now()-n*3600000,bytes:2048+n*1024,policy:{...defaultPolicy}})),summaries:{}};
for(let n=1;n<=6;n++)state.summaries[id(n)]={display_name:state.records[n-1].name,email:'workspace'+n+'@example.invalid',organization:'Personal workspace',plan:n%2?'Max 20x':'Pro',auth_status:n===4?'refresh_needed':n===6?'expired':'valid',proxy:n===5?'http://proxy.example.invalid:7890':null,quota_5h_used:n===3?90:n===6?100:20,quota_7d_used:n===6?100:30,quota_5h_reset_at:now+4800,quota_7d_reset_at:now+540000};
let locale='zh';
window.identityFixture={state};
window.localPreviewCommands=[];
mockIPC((command,args)=>{
  window.localPreviewCommands.push(command);
  if(command==='get_regions')return [{id:'us-west',label:'美国 · 洛杉矶',language:'en-US',locale:'en_US',timezone:'America/Los_Angeles'}];
  if(command==='ui_language_read')return locale;
  if(command==='ui_language_write'){locale=args.language;return;}
  if(command==='plugin:app|version')return '0.1.0';
  if(command==='identities_read')return structuredClone(state);
  if(command==='system_read')return {timezone:'America/New_York',languages:['en-US']};
  if(command==='browser_read')return {engine_ready:true,running:false,identity_linked:true,config:{timezone:'America/Los_Angeles',language:'en-US'}};
  if(command==='claude_cli_read')return {method:'',path:'',version:''};
  if(command==='plugin:event|listen')return 1;
  if(command==='plugin:event|unlisten')return;
  throw Error('Screenshot preview rejected command: '+command);
});
await import('/src/main.tsx');
`;
const html='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Claude-Local</title></head><body><div id="app"></div><script type="module">'+previewModule+'</script></body></html>';
const server=await createServer({
 root,configFile:resolve(root,'vite.config.ts'),
 plugins:[{name:'local-screenshot-preview',configureServer(instance){instance.middlewares.use(async(req,res,next)=>{
   if(!req.url?.startsWith('/__local-preview.html'))return next();
   try{res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await instance.transformIndexHtml('/__local-preview.html',html));}
   catch(error){next(error);}
 });}}],
 server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:{ignored:['**/src-tauri/**','**/browser-runtime/**','**/releases/**','**/dist/**']}},
 optimizeDeps:{include:['@tauri-apps/api/mocks']}
});
let browser;
try{
 await server.listen();
 const port=server.httpServer.address().port,base='http://127.0.0.1:'+port;
 const env={...process.env,HOME:privateHome,XDG_CONFIG_HOME:join(privateHome,'config'),XDG_CACHE_HOME:join(privateHome,'cache')};
 delete env.TAURI_SIGNING_PRIVATE_KEY;delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
 browser=await chromium.launch({executablePath:resolve(root,'browser-runtime/WindowsBrowser/chrome.exe'),headless:true,env});
 const context=await browser.newContext({viewport:{width:1180,height:860},deviceScaleFactor:1,reducedMotion:'reduce'});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/__local-preview.html');
 await page.getByRole('group',{name:'本地版本信息',exact:true}).waitFor();
 await page.getByRole('button',{name:'快速配置',exact:true}).click();
 await page.locator('.quick-overview[aria-busy="false"]').waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'01-quick-zh.png'),fullPage:true});
 await page.getByRole('button',{name:'身份管理',exact:true}).click();
 await page.getByText('studio@example.invalid',{exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'02-identities-zh.png'),fullPage:true});
 const geometry=await page.locator('.identity-card').evaluateAll(nodes=>nodes.slice(0,4).map(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};}));
 await page.getByRole('radio',{name:'EN',exact:true}).click();
 await page.getByRole('group',{name:'Local build information',exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'03-identities-en.png'),fullPage:true});
 await page.setViewportSize({width:900,height:800});
 await page.screenshot({path:join(output,'04-identities-compact-en.png'),fullPage:true});
 await page.setViewportSize({width:1180,height:860});
 await page.getByRole('radio',{name:'CN',exact:true}).click();
 await page.getByRole('button',{name:'软件设置',exact:true}).click();
 await page.getByRole('heading',{name:'软件设置',exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'05-settings-zh.png'),fullPage:true});
 await page.getByRole('button',{name:'网络环境',exact:true}).click();
 await page.getByRole('heading',{name:'Claude 服务连通性',exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'08-network-zh.png'),fullPage:true});
 await page.getByRole('button',{name:'软件设置',exact:true}).click();
 await page.getByRole('radio',{name:'月之暗面',exact:true}).click();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'06-settings-dark-zh.png'),fullPage:true});
 await page.getByRole('button',{name:'身份管理',exact:true}).click();
 await page.getByText('studio@example.invalid',{exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'07-identities-dark-zh.png'),fullPage:true});
 await page.getByRole('button',{name:'网络环境',exact:true}).click();
 await page.getByRole('heading',{name:'Claude 服务连通性',exact:true}).waitFor();
 await page.mouse.move(2,2);
 await page.screenshot({path:join(output,'09-network-dark-zh.png'),fullPage:true});
 const commands=await page.evaluate(()=>window.localPreviewCommands);
 if(commands.some(command=>/update|stop|switch|manage|delete|clean/.test(command)))throw Error('Unexpected mutation/update request: '+commands.join(','));
 const result={output,geometry,errors,commands:[...new Set(commands)]};
 await writeFile(join(output,'preview-results.json'),JSON.stringify(result,null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify(result,null,2));
}finally{
 await browser?.close();
 await server.close();
}
