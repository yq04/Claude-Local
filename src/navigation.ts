/**
 * [INPUT]: 可选本机页面偏好；不保存身份、凭据或工作区路径。
 * [OUTPUT]: 含本地 Token 统计的验证页面枚举，缺失/无效/存储不可用时默认身份管理。
 * [POS]: 独立产品导航偏好，存储失败不阻止应用使用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type Page='quick'|'cleaner'|'usage'|'browser'|'system'|'vps'|'help'|'settings';
const key='claude-local.page.v1';
export function validPage(value:unknown):value is Page{
  return typeof value==='string'&&['quick','cleaner','usage','browser','system','vps','help','settings'].includes(value);
}
export function readPage():Page{
  try{const value=localStorage.getItem(key);return validPage(value)?value:'cleaner';}catch{return 'cleaner';}
}
export function rememberPage(page:Page):void{
  try{if(validPage(page))localStorage.setItem(key,page);}catch{/* Navigation works without storage. */}
}
