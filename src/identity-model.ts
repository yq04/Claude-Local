/**
 * [INPUT]: 原生 SQLite 身份目录与用户的数据保留选择。
 * [OUTPUT]: 身份/策略/账号显示信息与逐窗口来源（含可信重置后的本地推定恢复）/观测时间的离线额度及可选订阅到期类型、保留选项、浏览器绑定和独立重开警告。
 * [POS]: 身份管理的脱敏契约；只有明确允许的账号显示字段、离线额度百分比与有界来源/观测时间，不含凭据、原始文件正文或任意路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type IdentityPolicy={skills:boolean;plugins:boolean;mcp:boolean;settings:boolean;projects:boolean;history:boolean;cache:boolean};
export type Identity={id:string;name:string;saved_at:number;bytes:number;policy:IdentityPolicy};
export type QuotaSource='server_anchor'|'local_estimate'|'reset_inferred'|'unknown';
export type QuotaEvidence={quota_source?:QuotaSource|null;quota_observed_at_ms?:number|null;quota_5h_source?:QuotaSource|null;quota_7d_source?:QuotaSource|null;quota_5h_observed_at_ms?:number|null;quota_7d_observed_at_ms?:number|null};
export type IdentitySummary={display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null}&QuotaEvidence;
export type ActiveSession={pid:number;workspace:string|null;entrypoint:string};
export type CurrentIdentity={present:boolean;display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null;unavailable:boolean}&QuotaEvidence;
export type BrowserLink={enabled:boolean;bound_ids:string[]};
export type IdentityState={browser:BrowserLink;browser_warning:string|null;records:Identity[];summaries:Record<string,IdentitySummary>;sessions:ActiveSession[];active:string;recovery:string|null;running:boolean;current:CurrentIdentity};
export const defaultPolicy:IdentityPolicy={skills:true,plugins:true,mcp:true,settings:true,projects:true,history:true,cache:false};
export const policyRows:readonly [keyof IdentityPolicy,string][]=[['skills','Skills 与命令'],['plugins','插件'],['mcp','MCP 配置'],['settings','个人设置'],['projects','项目记录'],['history','会话历史'],['cache','缓存与日志']];
