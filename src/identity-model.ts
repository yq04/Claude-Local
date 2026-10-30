/**
 * [INPUT]: 原生 SQLite 身份目录、只读本地 OAuth 有效期/刷新存在性元数据与用户的数据保留选择。
 * [OUTPUT]: 身份/策略/账号显示信息、可选独立养号卡与当前浏览器槽位、离线额度、手动订阅到期、保留选项与浏览器警告。
 * [POS]: 身份管理的脱敏契约；只有明确允许的账号显示字段、离线额度百分比与有界来源/观测时间，不含凭据、原始文件正文或任意路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {WarmingCard} from './warming-model';
export type IdentityPolicy={skills:boolean;plugins:boolean;mcp:boolean;settings:boolean;projects:boolean;history:boolean;cache:boolean};
export type Identity={id:string;name:string;saved_at:number;bytes:number;policy:IdentityPolicy};
export type QuotaSource='server_anchor'|'local_estimate'|'reset_inferred'|'unknown';
export type QuotaEvidence={quota_source?:QuotaSource|null;quota_observed_at_ms?:number|null;quota_5h_source?:QuotaSource|null;quota_7d_source?:QuotaSource|null;quota_5h_observed_at_ms?:number|null;quota_7d_observed_at_ms?:number|null;quota_identity?:string|null};
export type BillingDateKind='next_renewal'|'access_until'|'unknown';
export type IdentitySubscriptionMetadata={
  billing_date_kind?:BillingDateKind|null;
  billing_date?:number|null;
  manual_resets_remaining?:number|null;
  manual_resets_valid_until?:number|null;
  metadata_observed_at_ms?:number|null;
  billing_observed_at_ms?:number|null;
  manual_resets_observed_at_ms?:number|null;
  subscription_expiry_ymd?:string|null;
  subscription_recharge_ymd?:string|null;
  subscription_date_source?:'browser'|'manual'|null;
};
export type IdentitySummary={display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;auth_expires_at?:number|null;auth_has_refresh?:boolean|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null}&QuotaEvidence&IdentitySubscriptionMetadata;
export type ActiveSession={pid:number;workspace:string|null;entrypoint:string};
export type CurrentIdentity={present:boolean;display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;auth_expires_at?:number|null;auth_has_refresh?:boolean|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;subscription_expires_at?:number|null;unavailable:boolean}&QuotaEvidence&IdentitySubscriptionMetadata;
export type BrowserLink={enabled:boolean;bound_ids:string[]};
export type IdentityState={browser:BrowserLink;browser_warning:string|null;records:Identity[];summaries:Record<string,IdentitySummary>;sessions:ActiveSession[];active:string;recovery:string|null;running:boolean;current:CurrentIdentity;warming_cards?:WarmingCard[];active_browser_slot?:string};
export const defaultPolicy:IdentityPolicy={skills:true,plugins:true,mcp:true,settings:true,projects:true,history:true,cache:false};
export const policyRows:readonly [keyof IdentityPolicy,string][]=[['skills','Skills 与命令'],['plugins','插件'],['mcp','MCP 配置'],['settings','个人设置'],['projects','项目记录'],['history','会话历史'],['cache','缓存与日志']];
