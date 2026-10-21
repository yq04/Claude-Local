/**
 * [INPUT]: 原生 SQLite 身份目录与用户的数据保留选择。
 * [OUTPUT]: 身份/策略/账号显示信息与离线额度及可选订阅到期时间类型、默认保留选项、浏览器绑定和独立重开警告与界面分类。
 * [POS]: 身份管理的脱敏契约；只有明确允许的账号显示字段与离线额度百分比，不含凭据、原始文件正文或任意路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type IdentityPolicy={skills:boolean;plugins:boolean;mcp:boolean;settings:boolean;projects:boolean;history:boolean;cache:boolean};
export type Identity={id:string;name:string;saved_at:number;bytes:number;policy:IdentityPolicy};
export type IdentitySummary={display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null};
export type ActiveSession={pid:number;workspace:string|null;entrypoint:string};
export type CurrentIdentity={present:boolean;display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null;unavailable:boolean};
export type BrowserLink={enabled:boolean;bound_ids:string[]};
export type IdentityState={browser:BrowserLink;browser_warning:string|null;records:Identity[];summaries:Record<string,IdentitySummary>;sessions:ActiveSession[];active:string;recovery:string|null;running:boolean;current:CurrentIdentity};
export const defaultPolicy:IdentityPolicy={skills:true,plugins:true,mcp:true,settings:true,projects:true,history:true,cache:false};
export const policyRows:readonly [keyof IdentityPolicy,string][]=[['skills','Skills 与命令'],['plugins','插件'],['mcp','MCP 配置'],['settings','个人设置'],['projects','项目记录'],['history','会话历史'],['cache','缓存与日志']];
