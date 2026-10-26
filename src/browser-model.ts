/**
 * [INPUT]: 原生浏览器配置、机器快照和起始页实际观测。
 * [OUTPUT]: 不含令牌的绑定身份摘要、有效时区/语言、出口分类来源与受控失败原因、有界 WebRTC 原因/耗时、共享观测契约与三平台设备核验。
 * [POS]: 浏览器页面与宿主的边界，不持有凭据或执行清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type BrowserConfig={seed:number;proxy:string;follow_machine:boolean;language:string;timezone:string;native_graphics:boolean};
export type Machine={platform:string;version:string;cores:number;timezone:string;languages:string[];locale:string;locale_country?:string;location_enabled:boolean|null;timezones:string[]};
export type HostingError='rate_limited'|'timeout'|'http_error'|'network_error'|'invalid_response'|'ip_mismatch'|'response_too_large';
export type Exit={ip:string;country:string;city:string;timezone:string;isp:string;asn?:string;hosting?:boolean;hosting_source?:'ipquery';hosting_error?:HostingError};
export type Report={schema_version?:number;language:string;languages:string[];timezone:string;platform:string;cores:number;user_agent:string;platform_version:string;browser_version:string;geolocation:string;exit:Exit|null;error:string;webrtc_ok?:boolean|null;webrtc_detail?:string;webrtc_reason?:'complete'|'non_local_candidate'|'constructor_error'|'setup_error'|'offer_error'|'description_error'|'negotiation_timeout'|'gathering_timeout';webrtc_elapsed_ms?:number;webdriver?:boolean;graphics_ok?:boolean;webgl_renderer?:string;tz_offset_ok?:boolean|null;tz_offset_detail?:string;media_fingerprint_ok?:boolean|null;media_fingerprint_detail?:string;client_hints_ok?:boolean|null;client_hints_detail?:string};
export type BrowserIdentity={linked:boolean;status:'linked'|'draft'|'empty'|'unlinked'|'mismatch'|'unknown';name:string|null;email:string|null;organization:string|null;cli_proxy?:string|null};
export type BrowserContext={identity?:BrowserIdentity;ui_language:'zh'|'en';exit_services:string[];exit_classification_service?:string;region:{id:string;label:string;country:string;language:string;locale:string;timezone:string}|null;config:BrowserConfig;machine:Machine;engine_version:string};
export type BrowserState=BrowserContext&{engine_ready:boolean;running:boolean;profile:string;identity_linked?:boolean;cache:{path:string;bytes:number;login:boolean}[];cache_error:string;report:Report|null;report_received_at:number|null;machine_exit:Exit|null;checks:{id:string;title:string;status:'ok'|'mismatch'|'pending';detail:string}[]};
export type DefaultBrowser={is_default:boolean;http:string;https:string;installed:boolean;app:string};

const HOSTING_ISP_RE = /\b(amazon|aws|google\s*cloud|gcp|microsoft|azure|digitalocean|linode|akamai|vultr|choopa|constant\s*company|hetzner|ovh|m247|contabo|leaseweb|datacamp|cdn77|cloudflare|fastly|oracle\s*cloud|alibaba|aliyun|tencent|zenlayer|sharktech|multacom|psychz|quadranet|colocrossing|nocix|wholesale\s*internet|scaleway|upcloud|kamatera|bandwagon|it7\s*networks|hostwinds|racknerd|buyvm|frantech|dmit|cloudie|v\.ps|xtom|kurun|cera|ceranetworks|datacenter|data\s*center|hosting|vps|cloud\s*server)\b/i;

export function classifyExitIsp(exit?: Pick<Exit, 'isp' | 'asn' | 'hosting'> | null): 'isp' | 'hosting' | 'unknown' {
    if (!exit) return 'unknown';
    if (exit.hosting === true) return 'hosting';
    const combined = `${exit.isp || ''} ${exit.asn || ''}`.trim();
    if (!combined) return exit.hosting === false ? 'isp' : 'unknown';
    if (HOSTING_ISP_RE.test(combined)) return 'hosting';
    return exit.hosting === false ? 'isp' : 'unknown';
}

export type DeepVerifySite = {
    id: 'ping0' | 'checkcc' | 'browserscan' | 'iphey';
    name: string;
    url: string;
    focusKey: string;
    passRuleKey: string;
};

export const DEEP_VERIFY_SITES: readonly DeepVerifySite[] = [
    {
        id: 'ping0',
        name: 'Ping0.cc',
        url: 'https://ping0.cc/',
        focusKey: 'browserVerify.ping0Focus',
        passRuleKey: 'browserVerify.ping0Pass',
    },
    {
        id: 'checkcc',
        name: 'CheckCC.org',
        url: 'https://checkcc.org/',
        focusKey: 'browserVerify.checkccFocus',
        passRuleKey: 'browserVerify.checkccPass',
    },
    {
        id: 'browserscan',
        name: 'BrowserScan',
        url: 'https://www.browserscan.net/',
        focusKey: 'browserVerify.browserscanFocus',
        passRuleKey: 'browserVerify.browserscanPass',
    },
    {
        id: 'iphey',
        name: 'IPHey',
        url: 'https://iphey.com/',
        focusKey: 'browserVerify.ipheyFocus',
        passRuleKey: 'browserVerify.ipheyPass',
    },
];

export function effectiveBrowserTarget({config, machine}: Pick<BrowserContext, 'config' | 'machine'>) {
    if (!config.follow_machine) return {timezone: config.timezone, language: config.language};
    const first = machine.languages[0] || 'en-US';
    return {
        timezone: machine.timezone,
        language: first === 'en' ? 'en-US' : first,
    };
}

export function matchesDevice(machine: Pick<Machine, 'platform'|'version'|'cores'>, report: Pick<Report, 'platform'|'platform_version'|'cores'>) {
    const platform=report.platform.toLowerCase();
    const matched=machine.platform==='windows' ? platform==='win32' : platform.includes(machine.platform==='linux'?'linux':'mac');
    return matched && report.cores===machine.cores && (machine.platform==='linux'||report.platform_version===machine.version);
}
