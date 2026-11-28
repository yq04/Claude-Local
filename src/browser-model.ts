/**
 * [INPUT]: 原生浏览器配置、网络防漏断路器状态、机器快照和起始页实际观测（含跨执行上下文探针快照）。
 * [OUTPUT]: 不含令牌的浏览器/CLI 归属摘要、冻结回切账号与当前槽位、有效时区/语言、出口分类来源、断路器契约、跨上下文一致性类型契约与有界观测契约（保持 Report 23 线缆字段不变）。
 * [POS]: 浏览器页面与宿主的边界，不持有凭据或执行清理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type BrowserConfig={seed:number;proxy:string;follow_machine:boolean;language:string;timezone:string;native_graphics:boolean};
export interface KillSwitchState {
  enabled: boolean;
  triggered: boolean;
  reason_code?: string | null;
  expected_country?: string | null;
  observed_country?: string | null;
  triggered_at?: number | null;
  closed_slots: string[];
}
export type Machine={platform:string;version:string;cores:number;timezone:string;languages:string[];locale:string;locale_country?:string;location_enabled:boolean|null;timezones:string[]};
export type HostingError='rate_limited'|'timeout'|'http_error'|'network_error'|'invalid_response'|'ip_mismatch'|'response_too_large';
export type Exit={ip:string;country:string;city:string;timezone:string;isp:string;asn?:string;hosting?:boolean;hosting_source?:'ipquery'|'asn_catalog'|'geo_api'|string;hosting_error?:HostingError};
export type Report={schema_version?:number;language:string;languages:string[];timezone:string;platform:string;cores:number;user_agent:string;platform_version:string;browser_version:string;geolocation:string;exit:Exit|null;error:string;webrtc_ok?:boolean|null;webrtc_detail?:string;webrtc_reason?:'complete'|'non_local_candidate'|'constructor_error'|'setup_error'|'offer_error'|'description_error'|'negotiation_timeout'|'gathering_timeout';webrtc_elapsed_ms?:number;webdriver?:boolean;graphics_ok?:boolean;webgl_renderer?:string;tz_offset_ok?:boolean|null;tz_offset_detail?:string;media_fingerprint_ok?:boolean|null;media_fingerprint_detail?:string;client_hints_ok?:boolean|null;client_hints_detail?:string};
export type BrowserIdentity={linked:boolean;status:'linked'|'draft'|'empty'|'unlinked'|'mismatch'|'unknown'|'warming';name:string|null;email:string|null;organization:string|null;cli_proxy?:string|null};
export type BrowserContext={identity?:BrowserIdentity;ui_language:'zh'|'en';exit_services:string[];exit_classification_service?:string;region:{id:string;label:string;country:string;language:string;locale:string;timezone:string}|null;config:BrowserConfig;machine:Machine;engine_version:string};
export type BrowserState=BrowserContext&{engine_ready:boolean;running:boolean;profile:string;active_browser_slot?:string;cli_identity?:BrowserIdentity|null;cli_expected_identity?:string|null;identity_linked?:boolean;cache:{path:string;bytes:number;login:boolean}[];cache_error:string;report:Report|null;report_received_at:number|null;machine_exit:Exit|null;checks:{id:string;title:string;status:'ok'|'mismatch'|'pending';detail:string}[]};

export type CrossContextKind =
  | 'window'
  | 'worker'
  | 'shared-worker'
  | 'service-worker'
  | 'same-origin-iframe'
  | 'sandbox-iframe';

export type CrossContextProbeStatus = 'matched' | 'mismatch' | 'unsupported' | 'pending';
export type CrossContextCellStatus = 'matched' | 'mismatch' | 'unsupported' | 'not_applicable' | 'pending';

export interface NativeIntegrityResult {
  ok: boolean;
  toStringOk: boolean;
  ownPropTampered: boolean;
  stackTampered: boolean;
  details: string[];
}

export interface CrossContextUserAgentData {
  mobile: boolean;
  platform: string;
  brands: { brand: string; version: string }[];
  highEntropy: {
    platformVersion: string;
    uaFullVersion: string;
    architecture: string;
    bitness: string;
    model: string;
  } | null;
}

export interface CrossContextScreen {
  available: boolean;
  width: number | null;
  height: number | null;
  orientationType: string | null;
  orientationAngle: number | null;
}

export interface CrossContextOffscreenWebgl {
  supported: boolean;
  vendor: string;
  renderer: string;
  debugExtension: boolean;
}

export interface CrossContextSnapshot {
  kind: CrossContextKind;
  isSecureContext: boolean;
  platform: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  userAgentData: CrossContextUserAgentData | null;
  intl: {
    timeZone: string;
    locale: string;
    timezoneOffsetMin: number;
  };
  screen: CrossContextScreen;
  offscreenWebgl: CrossContextOffscreenWebgl;
  nativeIntegrity: NativeIntegrityResult;
}

export interface CrossContextProbeRecord {
  kind: Exclude<CrossContextKind, 'window'>;
  status: 'ok' | 'unsupported';
  reason?: string;
  snapshot: CrossContextSnapshot | null;
}

export type CrossContextMetricId =
  | 'ctx.platform'
  | 'ctx.languages'
  | 'ctx.cores'
  | 'ctx.device-memory'
  | 'ctx.ua-data'
  | 'ctx.intl'
  | 'ctx.screen-orientation'
  | 'ctx.offscreen-webgl'
  | 'ctx.anti-tamper';

export interface CrossContextMismatch {
  metricId: CrossContextMetricId;
  context: CrossContextKind;
  messageKey: string;
  values: Record<string, string | number>;
}

export interface CrossContextMetricResult {
  id: CrossContextMetricId;
  labelKey: string;
  scope: 'all' | 'secure' | 'window_iframe_only';
  scopeKey: string;
  baseline: string;
  status: 'matched' | 'mismatch' | 'unsupported';
  cells: Record<CrossContextKind, { status: CrossContextCellStatus; value: string }>;
  mismatches: CrossContextMismatch[];
}

export interface CrossContextEvaluation {
  status: 'checking' | 'passed' | 'failed';
  blocking: boolean;
  matchedContexts: number;
  unsupportedContexts: number;
  contextStates: Record<CrossContextKind, { status: CrossContextProbeStatus; reason?: string }>;
  metrics: CrossContextMetricResult[];
  mismatches: CrossContextMismatch[];
}

const DATACENTER_ASNS = new Set([
    'AS174', 'AS906', 'AS3214', 'AS4785', 'AS6939', 'AS8068', 'AS8075', 'AS8100',
    'AS8987', 'AS9009', 'AS11854', 'AS11878', 'AS12876', 'AS13335', 'AS14061', 'AS14618',
    'AS15169', 'AS16265', 'AS16276', 'AS16509', 'AS16625', 'AS20473', 'AS20940', 'AS21859',
    'AS24940', 'AS25820', 'AS28753', 'AS30633', 'AS31898', 'AS32097', 'AS33387', 'AS35916',
    'AS36007', 'AS36351', 'AS36352', 'AS37963', 'AS38895', 'AS40021', 'AS40065', 'AS40676',
    'AS42708', 'AS45090', 'AS45102', 'AS46844', 'AS47583', 'AS51167', 'AS53667', 'AS54113',
    'AS54290', 'AS54574', 'AS60068', 'AS60781', 'AS62567', 'AS63949', 'AS132203', 'AS202053',
    'AS209242', 'AS212238', 'AS213230', 'AS396982', 'AS398101', 'AS398493',
]);

const RESIDENTIAL_ASNS = new Set([
    'AS209', 'AS577', 'AS701', 'AS702', 'AS812', 'AS852', 'AS2516', 'AS2527',
    'AS2856', 'AS3215', 'AS3320', 'AS3462', 'AS3758', 'AS4181', 'AS4657', 'AS4713',
    'AS4760', 'AS5089', 'AS5607', 'AS5650', 'AS6079', 'AS6128', 'AS6167', 'AS6389',
    'AS7015', 'AS7016', 'AS7018', 'AS7029', 'AS7473', 'AS7843', 'AS7922', 'AS8047',
    'AS9269', 'AS9506', 'AS10796', 'AS10910', 'AS11232', 'AS11351', 'AS11404', 'AS11426',
    'AS11427', 'AS11492', 'AS11858', 'AS12083', 'AS12271', 'AS12322', 'AS13630', 'AS13977',
    'AS14593', 'AS14654', 'AS16591', 'AS17676', 'AS19108', 'AS20001', 'AS20055', 'AS20057',
    'AS20115', 'AS21707', 'AS21928', 'AS22394', 'AS22561', 'AS22773', 'AS30036', 'AS30600',
    'AS33363', 'AS33651', 'AS33657', 'AS33668', 'AS40127', 'AS46375', 'AS394925',
]);

const HOSTING_ISP_RE = /(?:^|[^a-z0-9])(amazon|aws|ec2|google\s*cloud|gcp|microsoft|azure|digitalocean|linode|akamai|vultr|choopa|constant\s*company|hetzner|ovh|m247|contabo|leaseweb|datacamp|cdn77|cloudflare|fastly|oracle\s*cloud|alibaba|aliyun|tencent|zenlayer|sharktech|multacom|psychz|quadranet|colocrossing|velocity\s*servers?|tzulo|hostpapa|hostinger|cogent|hurricane\s*electric|softlayer|ibm\s*cloud|nocix|wholesale\s*internet|scaleway|online\s*s\.?a\.?s|upcloud|kamatera|bandwagon|it7\s*networks?|hostwinds|racknerd|buyvm|frantech|dmit|cloudie|v\.ps|xtom|kurun|cera|ceranetworks|glesys|internap|datacenter|data\s*center|hosting(?:\s*networks?)?|vps|idc|colocation|(?:cloud|dedicated)\s*(?:servers?|networks?)|servers?)(?=$|[^a-z0-9])/i;

const RESIDENTIAL_ISP_RE = /(?:^|[^a-z0-9])(rcn(?:\s+(?:corporation|telecom))?|astound(?:\s+broadband)?|wave\s+broadband|grande\s+communications|comcast|xfinity|charter(?:\s+communications)?|spectrum|time\s+warner\s+cable|bright\s+house|at\s*&\s*t|att\s+(?:internet|services|mobility)|sbc\s+internet|bellsouth|verizon|fios|cellco|uunet|mci\s+communications|cox(?:\s+communications)?|optimum|altice|cablevision|suddenlink|frontier(?:\s+communications)?|centurylink|quantum\s+fiber|qwest|windstream|kinetic(?:\s+by\s+windstream)?|mediacom|breezeline|atlantic\s+broadband|wideopenwest|wow!\s+internet|knology|sparklight|cable\s+one|ziply(?:\s+fiber)?|google\s+fiber|sonic(?:\.net|\s+telecom)|consolidated\s+communications|fidium|tds\s+telecom|brightspeed|midco(?:ntinent)?|armstrong(?:\s+(?:cable|utilities|telephone))?|altafiber|cincinnati\s+bell|metronet|starry|ting\s+(?:fiber|internet)|hawaiian\s+telcom|general\s+communication|gci\s+communications?|t-mobile|starlink|ntt(?:\s+communications|\s+docomo)?|ocn|kddi|softbank|so-net|chunghwa(?:\s+telecom)?|hinet|pccw|hkt|hkbn|netvigator|british\s+telecom|bt\s+group|virgin\s+media|sky\s+(?:broadband|uk)|deutsche\s+telekom|orange\s+s\.?a\.?|free\s+sas|proxad|bell\s+canada|rogers(?:\s+communications)?|telus(?:\s+communications)?|singtel|starhub)(?=$|[^a-z0-9])/i;

export function extractCanonicalAsn(exit?: Pick<Exit, 'isp' | 'asn'> | null): string | null {
    if (!exit) return null;
    const raw = `${exit.asn || ''} ${exit.isp || ''}`;
    const match = raw.match(/\bAS(\d{1,10})\b/i);
    return match ? `AS${match[1]}` : null;
}

function isGoogleFiberExit(combined: string, asn: string | null): boolean {
    return asn === 'AS16591' || /\bgoogle\s+fiber\b|\bgfiber\b/i.test(combined);
}

function isHardHostingExit(exit: Pick<Exit, 'isp' | 'asn' | 'hosting'>): boolean {
    if (exit.hosting === true) return true;
    const asn = extractCanonicalAsn(exit);
    if (asn && DATACENTER_ASNS.has(asn)) return true;
    const combined = `${exit.isp || ''} ${exit.asn || ''}`.trim();
    if (!combined) return false;
    if (HOSTING_ISP_RE.test(combined)) return true;
    if (!isGoogleFiberExit(combined, asn) && /\bgoogle\s+llc\b/i.test(combined)) return true;
    return false;
}

export function classifyExitIsp(exit?: Pick<Exit, 'isp' | 'asn' | 'hosting'> | null): 'isp' | 'hosting' | 'unknown' {
    if (!exit) return 'unknown';
    if (isHardHostingExit(exit)) return 'hosting';
    return exit.hosting === false ? 'isp' : 'unknown';
}

export function classifyBrowserExitIsp(exit?: Pick<Exit, 'isp' | 'asn' | 'hosting'> | null): 'isp' | 'hosting' | 'unknown' {
    if (!exit) return 'unknown';
    if (isHardHostingExit(exit)) return 'hosting';
    const asn = extractCanonicalAsn(exit);
    const combined = `${exit.isp || ''} ${exit.asn || ''}`.trim();
    if ((asn && RESIDENTIAL_ASNS.has(asn)) || (combined && RESIDENTIAL_ISP_RE.test(combined))) {
        return 'isp';
    }
    return exit.hosting === false ? 'isp' : 'unknown';
}

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
