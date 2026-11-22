/**
 * [INPUT]: 原生 SQLite 身份目录、只读本地 OAuth 有效期/刷新到期元数据、实时会话存活快照（含 cli-slots 并发子代理槽位、后台守护角色标记 background、前台交互子 Shell 列表 child_shells 与待接管后台任务 ID active_adopt_jobs）与用户的数据保留选择。
 * [OUTPUT]: 身份/策略/账号显示信息、实时 CLI/桌面/子代理槽位/后台守护会话状态（LiveSessionsSnapshot、ActiveCliSession、isBackgroundOnlyState、collectInteractiveChildShells、normalizeAdoptJobIds）、可选独立养号卡与当前浏览器槽位、离线额度（含 Ultra 无 5h 上限、非活跃静置 5h 窗口 quota_5h_rested 与 Fable 7d 专项池）、手动订阅到期与套餐覆写（subscription_renews_at / manual_plan）、重置次数及逐份 active grant 到期明细、只读 KYC 状态投影（kyc_status / kyc_check_kind / kyc_observed_at_ms）、保留选项与浏览器警告。
 * [POS]: 身份管理的脱敏契约；只有明确允许的账号显示字段、离线额度百分比与有界来源/观测时间，不含凭据、原始文件正文或任意路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {WarmingCard} from './warming-model';
export type IdentityPolicy={skills:boolean;plugins:boolean;mcp:boolean;settings:boolean;projects:boolean;history:boolean;cache:boolean};
export type Identity={id:string;name:string;saved_at:number;bytes:number;policy:IdentityPolicy};
export type QuotaSource='server_anchor'|'local_estimate'|'reset_inferred'|'unknown';
export type QuotaEvidence={quota_source?:QuotaSource|null;quota_observed_at_ms?:number|null;quota_5h_source?:QuotaSource|null;quota_7d_source?:QuotaSource|null;quota_5h_observed_at_ms?:number|null;quota_7d_observed_at_ms?:number|null;quota_5h_rested?:boolean|null;quota_identity?:string|null};
export type BillingDateKind='next_renewal'|'access_until'|'unknown';
export type ManualResetGrant={
  resets_left:number;
  ends_at?:number|null;
};
export type IdentitySubscriptionMetadata={
  billing_date_kind?:BillingDateKind|null;
  billing_date?:number|null;
  subscription_renews_at?:number|null;
  manual_plan?:string|null;
  manual_resets_remaining?:number|null;
  manual_resets_valid_until?:number|null;
  /** Uncapped latest finite active grant end from the same web sync (absent when unbounded or on older data). */
  manual_resets_grant_ends_at?:number|null;
  /** Per-grant breakdown of active positive grants sorted earliest-first. */
  manual_resets_grants?:ManualResetGrant[]|null;
  metadata_observed_at_ms?:number|null;
  billing_observed_at_ms?:number|null;
  manual_resets_observed_at_ms?:number|null;
  subscription_expiry_ymd?:string|null;
  subscription_recharge_ymd?:string|null;
  subscription_date_source?:'browser'|'manual'|null;
  kyc_status?:string|null;
  kyc_check_kind?:string|null;
  kyc_observed_at_ms?:number|null;
};
export type IdentitySummary={display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;auth_expires_at?:number|null;auth_has_refresh?:boolean|null;refresh_token_expires_at?:number|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_no_5h_limit?:boolean;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;quota_7d_fable_used?:number|null;quota_7d_fable_reset_at?:number|null;subscription_expires_at?:number|null}&QuotaEvidence&IdentitySubscriptionMetadata;
export type ActiveSession={pid:number;workspace:string|null;entrypoint:string;background?:boolean;child_shells?:string[]};
export type ActiveCliSession=ActiveSession;
export type LiveSessionsSnapshot={running:boolean;cli_running:boolean;sessions:ActiveSession[];slot_sessions?:Record<string,ActiveSession[]>;background_only?:boolean;active_adopt_jobs?:string[]};
export type CurrentIdentity={present:boolean;display_name:string|null;email:string|null;organization:string|null;plan:string|null;auth_status:string|null;auth_expires_at?:number|null;auth_has_refresh?:boolean|null;refresh_token_expires_at?:number|null;proxy:string|null;quota_5h_used?:number|null;quota_5h_reset_at?:number|null;quota_no_5h_limit?:boolean;quota_7d_used?:number|null;quota_7d_reset_at?:number|null;quota_7d_fable_used?:number|null;quota_7d_fable_reset_at?:number|null;subscription_expires_at?:number|null;unavailable:boolean;sessions?:ActiveSession[]}&QuotaEvidence&IdentitySubscriptionMetadata;
export type BrowserLink={enabled:boolean;bound_ids:string[]};
export type IdentityState={browser:BrowserLink;browser_warning:string|null;records:Identity[];summaries:Record<string,IdentitySummary>;sessions:ActiveSession[];slot_sessions?:Record<string,ActiveSession[]>;active:string;recovery:string|null;running:boolean;cli_running?:boolean;background_only?:boolean;active_adopt_jobs?:string[];current:CurrentIdentity;warming_cards?:WarmingCard[];active_browser_slot?:string};
export const defaultPolicy:IdentityPolicy={skills:true,plugins:true,mcp:true,settings:true,projects:true,history:true,cache:false};
export const policyRows:readonly [keyof IdentityPolicy,string][]=[['skills','Skills 与命令'],['plugins','插件'],['mcp','MCP 配置'],['settings','个人设置'],['projects','项目记录'],['history','会话历史'],['cache','缓存与日志']];

const ADOPT_JOB_ID_RE=/^[A-Za-z0-9_-]{1,32}$/;

export function normalizeAdoptJobIds(jobs?:readonly string[]|null):string[]{
  if(!Array.isArray(jobs)||jobs.length===0)return [];
  const seen=new Set<string>();
  const out:string[]=[];
  for(const raw of jobs){
    if(typeof raw!=='string')continue;
    const trimmed=raw.trim();
    if(!ADOPT_JOB_ID_RE.test(trimmed)||seen.has(trimmed))continue;
    seen.add(trimmed);
    out.push(trimmed);
    if(out.length>=8)break;
  }
  return out;
}

type SessionCarrier={
  sessions?:readonly ActiveSession[]|null;
  background_only?:boolean|null;
  current?:{sessions?:readonly ActiveSession[]|null}|null;
};

function extractSessions(
  source?:readonly ActiveSession[]|SessionCarrier|null,
):readonly ActiveSession[]{
  if(!source)return [];
  if(Array.isArray(source))return source;
  const carrier=source as SessionCarrier;
  if(Array.isArray(carrier.sessions))return carrier.sessions;
  if(Array.isArray(carrier.current?.sessions))return carrier.current.sessions;
  return [];
}

export function isBackgroundOnlyState(source?:SessionCarrier|null):boolean{
  if(!source)return false;
  const sessions=extractSessions(source);
  if(sessions.length>0){
    return sessions.every(session=>Boolean(session?.background));
  }
  return Boolean(source.background_only);
}

export function collectInteractiveChildShells(
  source?:readonly ActiveSession[]|SessionCarrier|null,
):string[]{
  const sessions=extractSessions(source);
  if(sessions.length===0)return [];
  const seen=new Set<string>();
  const out:string[]=[];
  for(const session of sessions){
    if(!session||session.background)continue;
    if(!Array.isArray(session.child_shells))continue;
    for(const raw of session.child_shells){
      if(typeof raw!=='string')continue;
      const trimmed=raw.trim();
      if(!trimmed)continue;
      const key=trimmed.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      out.push(trimmed);
      if(out.length>=12)return out;
    }
  }
  return out;
}
