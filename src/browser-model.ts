/**
 * [INPUT]: 原生浏览器配置、机器快照和起始页实际观测。
 * [OUTPUT]: 不含令牌的绑定身份摘要与两个前端入口共享的目标地区、出口服务目录与界面语言与带接收时间的观测数据契约与三平台真实设备核验；区分目标设置与已测状态，标识当前独立资料是否随身份联动。
 * [POS]: 浏览器页面与宿主的边界，不持有凭据或执行清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type BrowserConfig={seed:number;proxy:string;follow_machine:boolean;language:string;timezone:string;native_graphics:boolean};
export type Machine={platform:string;version:string;cores:number;timezone:string;languages:string[];locale:string;locale_country?:string;location_enabled:boolean|null;timezones:string[]};
export type Exit={ip:string;country:string;city:string;timezone:string;isp:string};
export type Report={language:string;languages:string[];timezone:string;platform:string;cores:number;user_agent:string;platform_version:string;browser_version:string;geolocation:string;exit:Exit|null;error:string};
export type BrowserIdentity={linked:boolean;status:'linked'|'draft'|'empty'|'unlinked'|'mismatch'|'unknown';name:string|null;email:string|null;organization:string|null};
export type BrowserContext={identity?:BrowserIdentity;ui_language:'zh'|'en';exit_services:string[];region:{id:string;label:string;country:string;language:string;locale:string;timezone:string}|null;config:BrowserConfig;machine:Machine;engine_version:string};
export type BrowserState=BrowserContext&{engine_ready:boolean;running:boolean;profile:string;identity_linked?:boolean;cache:{path:string;bytes:number;login:boolean}[];cache_error:string;report:Report|null;report_received_at:number|null;machine_exit:Exit|null;checks:{title:string;status:'ok'|'mismatch'|'pending';detail:string}[]};
export type DefaultBrowser={is_default:boolean;http:string;https:string;installed:boolean;app:string};

export function matchesDevice(machine: Pick<Machine, 'platform'|'version'|'cores'>, report: Pick<Report, 'platform'|'platform_version'|'cores'>) {
    const platform=report.platform.toLowerCase();
    const matched=machine.platform==='windows' ? platform==='win32' : platform.includes(machine.platform==='linux'?'linux':'mac');
    return matched && report.cores===machine.cores && (machine.platform==='linux'||report.platform_version===machine.version);
}
