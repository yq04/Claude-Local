// [INPUT]: 冻结的显式代理（SOCKS 自动升级 socks5h/socks4a 锁远程 DNS）、ipwho.is/ipapi.co 地理信息、可选固定 IPQuery 分类与版本化浏览器观测。
// [OUTPUT]: 多信号住宅宽带 ISP / IDC 机房 ASN+关键词分类（含 RCN/Astound AS6079 等北美及主流地区家宽识别与机房硬阻断优先）、同 IP 布尔分类/受控失败诊断、本机与网页上报平台/CPU对比、去重有界 WebRTC 原因/耗时与探针核验；缺少观测保持 pending。
// [POS]: 环境核验边界；WebRTC 仅为无 STUN 本地候选观察，不证明 DNS 或公网 STUN 状态。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
pub const SERVICES: [&str; 2] = ["https://ipwho.is/", "https://ipapi.co/json/"];
pub const CLASSIFICATION_SERVICE: &str = "https://api.ipquery.io/";
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Exit {
    pub ip: String,
    pub country: String,
    pub city: String,
    pub timezone: String,
    pub isp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosting_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosting_error: Option<String>,
}
pub fn parse(data: &Value) -> Result<Exit, String> {
    if data["success"].as_bool() == Some(false) || data["error"].as_bool() == Some(true) {
        return Err("出口服务未返回有效结果。".into());
    }
    let ip = data["ip"].as_str().ok_or("出口 IP 缺失。")?;
    ip.parse::<std::net::IpAddr>()
        .map_err(|_| "出口 IP 无效。")?;
    let country = data["country_code"]
        .as_str()
        .filter(|x| x.len() == 2 && x.bytes().all(|c| c.is_ascii_uppercase()))
        .ok_or("出口国家无效。")?;
    let raw_asn = data
        .get("asn")
        .or_else(|| data.get("connection").and_then(|c| c.get("asn")));
    let asn = match raw_asn {
        Some(Value::Number(n)) => Some(format!("AS{n}")),
        Some(Value::String(s)) if !s.trim().is_empty() && s.len() < 60 => {
            let trimmed = s.trim();
            if trimmed.to_ascii_uppercase().starts_with("AS") {
                Some(trimmed.to_string())
            } else {
                Some(format!("AS{trimmed}"))
            }
        }
        _ => None,
    };
    let hosting = data["hosting"]
        .as_bool()
        .or_else(|| data["security"]["hosting"].as_bool())
        .or_else(|| data["risk"]["is_datacenter"].as_bool())
        .or_else(|| {
            let conn_type = data["connection"]["type"]
                .as_str()
                .or_else(|| data["asn"]["type"].as_str());
            match conn_type.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("hosting" | "datacenter") => Some(true),
                Some("isp") => Some(false),
                _ => None,
            }
        });
    let mut exit = Exit {
        ip: ip.into(),
        country: country.into(),
        city: data["city"]
            .as_str()
            .or_else(|| data["location"]["city"].as_str())
            .unwrap_or("")
            .into(),
        timezone: data["timezone"]
            .as_str()
            .or_else(|| data["timezone"]["id"].as_str())
            .or_else(|| data["location"]["timezone"].as_str())
            .unwrap_or("")
            .into(),
        isp: data["org"]
            .as_str()
            .or_else(|| data["connection"]["isp"].as_str())
            .or_else(|| data["connection"]["org"].as_str())
            .or_else(|| data["isp"]["isp"].as_str())
            .or_else(|| data["isp"]["org"].as_str())
            .unwrap_or("")
            .into(),
        asn: asn.or_else(|| {
            data["isp"]["asn"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.len() < 60)
                .map(|s| {
                    if s.to_ascii_uppercase().starts_with("AS") {
                        s.to_string()
                    } else {
                        format!("AS{s}")
                    }
                })
        }),
        hosting,
        ..Default::default()
    };
    apply_builtin_classification(&mut exit);
    Ok(exit)
}
pub async fn probe(proxy: &str) -> Result<Exit, String> {
    probe_with_classification(proxy, &SERVICES, Some(CLASSIFICATION_SERVICE)).await
}
#[cfg(test)]
pub(super) async fn probe_urls(proxy: &str, services: &[&str]) -> Result<Exit, String> {
    probe_with_classification(proxy, services, None).await
}
pub(super) async fn probe_with_classification(
    proxy: &str,
    services: &[&str],
    classification_service: Option<&str>,
) -> Result<Exit, String> {
    let mut client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(8));
    let normalized_proxy = super::config::normalize_reqwest_proxy(proxy);
    if !normalized_proxy.is_empty() {
        client = client.proxy(
            reqwest::Proxy::all(&normalized_proxy).map_err(|_| "代理格式无效。")?,
        );
    }
    let client = client.build().map_err(|_| "无法建立出口检查。")?;
    let mut errors = Vec::new();
    for address in services {
        let name = reqwest::Url::parse(address)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default();
        let result = async {
            let mut response = client.get(*address).send().await.map_err(|e| {
                if e.is_timeout() {
                    "请求超时"
                } else {
                    "网络连接失败"
                }
                .to_string()
            })?;
            if !response.status().is_success() {
                return Err(format!("HTTP {}", response.status().as_u16()));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "出口响应读取失败".to_string())?
            {
                if bytes.len() + chunk.len() > 32_768 {
                    return Err("出口响应过大".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            parse(&serde_json::from_slice(&bytes).map_err(|_| "出口响应格式错误".to_string())?)
        }
        .await;
        match result {
            Ok(mut exit) => {
                if exit.hosting.is_none() {
                    if let Some(service) = classification_service {
                        match supplement_hosting(&client, &exit.ip, service).await {
                            Ok(hosting) => {
                                exit.hosting = Some(hosting);
                                exit.hosting_source = Some("ipquery".into());
                            }
                            Err(error) => exit.hosting_error = Some(error.into()),
                        }
                    }
                }
                return Ok(exit);
            }
            Err(error) => errors.push(format!("{name}：{error}")),
        }
    }
    Err(format!(
        "出口检测未完成（{}）。请检查 TUN/代理连接后重试。",
        errors.join("；")
    ))
}
pub(crate) async fn probe_ip_via_ipquery(proxy: &str, ip: &str) -> Result<Exit, String> {
    let parsed_ip = ip
        .trim()
        .parse::<std::net::IpAddr>()
        .map_err(|_| "出口 IP 无效。".to_string())?;
    let mut client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(6));
    let normalized_proxy = super::config::normalize_reqwest_proxy(proxy);
    if !normalized_proxy.is_empty() {
        client = client.proxy(
            reqwest::Proxy::all(&normalized_proxy).map_err(|_| "代理格式无效。".to_string())?,
        );
    }
    let client = client.build().map_err(|_| "无法建立出口检查。".to_string())?;
    let mut response = client
        .get(format!("{CLASSIFICATION_SERVICE}{parsed_ip}?format=json"))
        .send()
        .await
        .map_err(|_| "网络连接失败".to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "出口响应读取失败".to_string())?
    {
        if bytes.len() + chunk.len() > 32_768 {
            return Err("出口响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut data: Value =
        serde_json::from_slice(&bytes).map_err(|_| "出口响应格式错误".to_string())?;
    if data.get("country_code").is_none() {
        if let Some(cc) = data["location"]["country_code"]
            .as_str()
            .map(str::to_string)
        {
            data["country_code"] = Value::String(cc);
        }
    }
    if let Some(returned) = data.get("ip").and_then(Value::as_str) {
        let actual = returned
            .trim()
            .parse::<std::net::IpAddr>()
            .map_err(|_| "出口响应格式错误".to_string())?;
        if actual != parsed_ip {
            return Err("出口 IP 不一致".into());
        }
    } else {
        data["ip"] = Value::String(parsed_ip.to_string());
    }
    let mut exit = parse(&data)?;
    if exit.hosting.is_some() {
        exit.hosting_source = Some("ipquery".into());
    }
    Ok(exit)
}

async fn supplement_hosting(
    client: &reqwest::Client,
    ip: &str,
    service: &str,
) -> Result<bool, &'static str> {
    let mut response = client
        .get(format!("{service}{ip}?format=json"))
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "timeout"
            } else {
                "network_error"
            }
        })?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 429 {
            "rate_limited"
        } else {
            "http_error"
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            "timeout"
        } else {
            "network_error"
        }
    })? {
        if bytes.len() + chunk.len() > 32_768 {
            return Err("response_too_large");
        }
        bytes.extend_from_slice(&chunk);
    }
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid_response")?;
    let expected = ip
        .parse::<std::net::IpAddr>()
        .map_err(|_| "invalid_response")?;
    let actual = data["ip"]
        .as_str()
        .and_then(|s| s.parse::<std::net::IpAddr>().ok())
        .ok_or("invalid_response")?;
    if actual != expected {
        return Err("ip_mismatch");
    }
    data["risk"]["is_datacenter"]
        .as_bool()
        .ok_or("invalid_response")
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Report {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    pub language: String,
    pub languages: Vec<String>,
    pub timezone: String,
    pub platform: String,
    pub cores: u32,
    pub user_agent: String,
    pub platform_version: String,
    pub browser_version: String,
    pub geolocation: String,
    pub exit: Option<Exit>,
    pub error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webrtc_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webrtc_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webrtc_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webrtc_elapsed_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webdriver: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphics_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webgl_renderer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tz_offset_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tz_offset_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_fingerprint_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_fingerprint_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_hints_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_hints_detail: Option<String>,
}
impl Report {
    pub fn valid(&self) -> bool {
        self.language.len() < 80
            && self.languages.len() < 20
            && self.languages.iter().all(|x| x.len() < 80)
            && self.timezone.len() < 100
            && self.platform.len() < 60
            && self.user_agent.len() < 2048
            && self.platform_version.len() < 60
            && self.browser_version.len() < 60
            && self.geolocation.len() < 30
            && self.error.len() < 1000
            && self.cores > 0
            && self.cores <= 1024
            && self
                .webrtc_reason
                .as_deref()
                .map(|reason| {
                    matches!(
                        reason,
                        "complete"
                            | "non_local_candidate"
                            | "constructor_error"
                            | "setup_error"
                            | "offer_error"
                            | "description_error"
                            | "negotiation_timeout"
                            | "gathering_timeout"
                    )
                })
                .unwrap_or(true)
            && self
                .webrtc_elapsed_ms
                .map(|elapsed| elapsed <= 120_000)
                .unwrap_or(true)
            && self
                .webrtc_detail
                .as_ref()
                .map(|x| x.len() < 300)
                .unwrap_or(true)
            && self
                .webgl_renderer
                .as_ref()
                .map(|x| x.len() < 300)
                .unwrap_or(true)
            && self
                .tz_offset_detail
                .as_ref()
                .map(|x| x.len() < 300)
                .unwrap_or(true)
            && self
                .media_fingerprint_detail
                .as_ref()
                .map(|x| x.len() < 300)
                .unwrap_or(true)
            && self
                .client_hints_detail
                .as_ref()
                .map(|x| x.len() < 300)
                .unwrap_or(true)
            && self
                .exit
                .as_ref()
                .map(|x| {
                    x.ip.parse::<std::net::IpAddr>().is_ok()
                        && [&x.country, &x.city, &x.timezone, &x.isp]
                            .iter()
                            .all(|x| x.len() < 300)
                        && x.asn.as_ref().map(|a| a.len() < 80).unwrap_or(true)
                        && x.hosting_source
                            .as_deref()
                            .map(|source| source == "ipquery" && x.hosting.is_some())
                            .unwrap_or(true)
                        && x.hosting_error
                            .as_deref()
                            .map(|error| {
                                x.hosting.is_none()
                                    && matches!(
                                        error,
                                        "rate_limited"
                                            | "timeout"
                                            | "http_error"
                                            | "network_error"
                                            | "invalid_response"
                                            | "ip_mismatch"
                                            | "response_too_large"
                                    )
                            })
                            .unwrap_or(true)
                })
                .unwrap_or(true)
    }
}
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitKind {
    ResidentialIsp,
    Hosting,
    Unknown,
}

fn parse_asn_number(raw: Option<&str>) -> Option<u32> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    let rest = if s.len() >= 2 && s[..2].eq_ignore_ascii_case("as") {
        &s[2..]
    } else {
        s
    };
    let digits: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

fn contains_ascii_word(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let nbytes = needle.as_bytes();
    if nbytes.is_empty() || nbytes.len() > bytes.len() {
        return false;
    }
    for start in 0..=(bytes.len() - nbytes.len()) {
        if &bytes[start..start + nbytes.len()] == nbytes {
            let prev_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            let next_idx = start + nbytes.len();
            let next_ok = next_idx == bytes.len() || !bytes[next_idx].is_ascii_alphanumeric();
            if prev_ok && next_ok {
                return true;
            }
        }
    }
    false
}

const HOSTING_ASNS: &[u32] = &[
    174,    // Cogent
    906,    // DMIT
    3214,   // xTom
    4785,   // xTom
    6939,   // Hurricane Electric
    8068,   // Microsoft
    8075,   // Microsoft Azure
    8100,   // QuadraNet
    8987,   // Amazon AWS
    9009,   // M247
    11854,  // Internap
    11878,  // Tzulo
    12876,  // Scaleway / Online S.A.S.
    13335,  // Cloudflare
    14061,  // DigitalOcean
    14618,  // Amazon AWS
    15169,  // Google Cloud (distinct from Google Fiber AS16591)
    16265,  // Leaseweb
    16276,  // OVH
    16509,  // Amazon AWS
    16625,  // Akamai
    20473,  // Vultr / Choopa / The Constant Company
    20940,  // Akamai
    21859,  // Zenlayer
    24940,  // Hetzner
    25820,  // IT7 Networks / Bandwagon
    28753,  // Leaseweb
    30633,  // Leaseweb US
    31898,  // Oracle Cloud
    32097,  // Wholesale Internet
    33387,  // Nocix
    35916,  // Multacom
    36007,  // Kamatera
    36351,  // HostPapa
    36352,  // ColoCrossing / Velocity Servers
    37963,  // Alibaba / Aliyun
    38895,  // Amazon AWS
    40021,  // Contabo
    40065,  // CeraNetworks
    40676,  // Psychz
    42708,  // GleSYS
    45090,  // Tencent
    45102,  // Alibaba Cloud
    46844,  // Sharktech
    47583,  // Hostinger
    51167,  // Contabo
    53667,  // FranTech / BuyVM
    54113,  // Fastly
    54290,  // Hostwinds
    54574,  // DMIT
    60068,  // Datacamp / CDN77
    60781,  // Leaseweb
    62567,  // DigitalOcean
    63949,  // Linode / Akamai Connected Cloud
    132203, // Tencent Cloud
    202053, // UpCloud
    209242, // Cloudflare
    212238, // Datacamp
    213230, // Hetzner
    396982, // Google Cloud
    398101, // RackNerd / Sharktech
    398493, // Hostwinds
];

const RESIDENTIAL_ASNS: &[u32] = &[
    209,    // CenturyLink / Quantum Fiber / Qwest
    577,    // Bell Canada
    701,    // Verizon / Fios / MCI residential
    702,    // Verizon Business / UUNET residential EMEA
    812,    // Rogers
    852,    // Telus
    2516,   // KDDI
    2527,   // So-net
    2856,   // BT (British Telecom)
    3215,   // Orange
    3320,   // Deutsche Telekom
    3462,   // Chunghwa Telecom / HiNet
    3758,   // Singtel
    4181,   // TDS Telecom
    4657,   // StarHub
    4713,   // NTT OCN
    4760,   // HKT / PCCW / Netvigator
    5089,   // Virgin Media
    5607,   // Sky Broadband
    5650,   // Frontier Communications
    6079,   // RCN / RCN Corporation / Astound Broadband
    6128,   // Cablevision / Optimum / Altice USA
    6167,   // Verizon Cellco
    6389,   // BellSouth / AT&T
    7015,   // Comcast
    7016,   // Comcast
    7018,   // AT&T / SBC
    7029,   // Windstream / Kinetic
    7473,   // Singtel
    7843,   // Time Warner Cable / Spectrum / Grande
    7922,   // Comcast Cable / Xfinity
    8047,   // GCI Communications
    9269,   // HKBN
    9506,   // Singtel
    10796,  // Charter / Spectrum
    10910,  // Altafiber / Cincinnati Bell
    11232,  // Midco
    11351,  // Charter / Spectrum
    11404,  // Wave Broadband / Astound
    11426,  // Charter / Spectrum
    11427,  // Charter / Spectrum
    11492,  // Sparklight / Cable One
    11858,  // Hawaiian Telcom
    12083,  // WideOpenWest / WOW! / Knology
    12271,  // Charter / Spectrum
    12322,  // Free SAS
    13630,  // Armstrong
    13977,  // Consolidated Communications / Fidium
    14593,  // Starlink
    14654,  // Ting Fiber
    16591,  // Google Fiber (residential FTTH, distinct from Google Cloud)
    17676,  // SoftBank Broadband
    19108,  // Suddenlink / Optimum / Grande
    20001,  // Charter / Spectrum
    20055,  // Ziply Fiber
    20057,  // AT&T Mobility / Broadband
    20115,  // Charter / Spectrum
    21707,  // Breezeline / Atlantic Broadband
    21928,  // T-Mobile USA
    22394,  // Cellco / Verizon Wireless
    22561,  // CenturyLink
    22773,  // Cox Communications
    30036,  // Mediacom
    30600,  // Metronet
    33363,  // Bright House / Spectrum
    33651,  // Comcast
    33657,  // Comcast
    33668,  // Comcast
    40127,  // Brightspeed
    46375,  // Sonic.net
    394925, // Starry
];

pub fn is_hosting_exit(exit: &Exit) -> bool {
    let asn_num = parse_asn_number(exit.asn.as_deref()).or_else(|| parse_asn_number(Some(&exit.isp)));
    if let Some(num) = asn_num {
        if HOSTING_ASNS.contains(&num) {
            return true;
        }
    }
    let text = format!(
        " {} {} ",
        exit.isp.to_ascii_lowercase(),
        exit.asn.as_deref().unwrap_or("").to_ascii_lowercase()
    );
    let is_google_fiber = asn_num == Some(16591) || text.contains("google fiber") || contains_ascii_word(&text, "gfiber");
    const WORD_KEYWORDS: [&str; 17] = [
        "aws", "gcp", "azure", "ovh", "m247", "vps", "idc", "xtom", "dmit", "cera", "kurun",
        "nocix", "buyvm", "v.ps", "tzulo", "cogent", "ec2",
    ];
    const SUBSTRING_KEYWORDS: [&str; 44] = [
        "amazon",
        "google cloud",
        "microsoft",
        "digitalocean",
        "linode",
        "akamai",
        "vultr",
        "choopa",
        "constant company",
        "hetzner",
        "contabo",
        "leaseweb",
        "datacamp",
        "cdn77",
        "cloudflare",
        "fastly",
        "oracle cloud",
        "ibm cloud",
        "alibaba",
        "aliyun",
        "tencent",
        "zenlayer",
        "sharktech",
        "multacom",
        "psychz",
        "quadranet",
        "colocrossing",
        "velocity servers",
        "hurricane electric",
        "hostpapa",
        "hostinger",
        "scaleway",
        "online s.a.s",
        "upcloud",
        "kamatera",
        "bandwagon",
        "it7 networks",
        "hostwinds",
        "racknerd",
        "wholesale internet",
        "data center",
        "cloud network",
        "hosting network",
        "dedicated network",
    ];
    const EXTRA_KEYWORDS: [&str; 11] = [
        "frantech",
        "cloudie",
        "ceranetworks",
        "datacenter",
        "hosting",
        "colocation",
        "softlayer",
        "glesys",
        "internap",
        "server",
        "servers",
    ];
    if WORD_KEYWORDS.iter().any(|kw| contains_ascii_word(&text, kw))
        || SUBSTRING_KEYWORDS.iter().any(|kw| text.contains(kw))
        || EXTRA_KEYWORDS.iter().any(|kw| contains_ascii_word(&text, kw))
    {
        return true;
    }
    if !is_google_fiber && text.contains("google llc") {
        return true;
    }
    exit.hosting == Some(true)
}

pub fn is_residential_isp_exit(exit: &Exit) -> bool {
    if is_hosting_exit(exit) {
        return false;
    }
    let asn_num = parse_asn_number(exit.asn.as_deref()).or_else(|| parse_asn_number(Some(&exit.isp)));
    if let Some(num) = asn_num {
        if RESIDENTIAL_ASNS.contains(&num) {
            return true;
        }
    }
    let text = format!(" {} ", exit.isp.to_ascii_lowercase());
    const RES_WORDS: &[&str] = &[
        "rcn",
        "astound",
        "comcast",
        "xfinity",
        "charter",
        "spectrum",
        "verizon",
        "fios",
        "cellco",
        "uunet",
        "cox",
        "optimum",
        "altice",
        "cablevision",
        "suddenlink",
        "frontier",
        "centurylink",
        "qwest",
        "windstream",
        "kinetic",
        "mediacom",
        "breezeline",
        "wideopenwest",
        "knology",
        "sparklight",
        "ziply",
        "fidium",
        "brightspeed",
        "midco",
        "armstrong",
        "altafiber",
        "metronet",
        "starry",
        "hinet",
        "chunghwa",
        "netvigator",
        "hkbn",
        "pccw",
        "hkt",
        "kddi",
        "softbank",
        "ocn",
        "singtel",
        "starhub",
        "rogers",
        "telus",
        "starlink",
    ];
    const RES_PHRASES: &[&str] = &[
        "rcn corporation",
        "rcn telecom",
        "astound broadband",
        "wave broadband",
        "grande communications",
        "time warner cable",
        "bright house",
        "at&t",
        "bellsouth",
        "sbc internet",
        "quantum fiber",
        "atlantic broadband",
        "wow! internet",
        "cable one",
        "google fiber",
        "sonic.net",
        "sonic telecom",
        "consolidated communications",
        "tds telecom",
        "cincinnati bell",
        "ting fiber",
        "ting internet",
        "hawaiian telcom",
        "gci communications",
        "gci communication",
        "general communication",
        "mci communications",
        "t-mobile",
        "ntt communications",
        "ntt docomo",
        "so-net",
        "british telecom",
        "bt group",
        "virgin media",
        "sky broadband",
        "sky uk",
        "deutsche telekom",
        "free sas",
        "proxad",
        "bell canada",
    ];
    RES_WORDS.iter().any(|kw| contains_ascii_word(&text, kw))
        || RES_PHRASES.iter().any(|kw| contains_ascii_word(&text, kw))
}

#[cfg(test)]
pub fn classify_exit(exit: &Exit) -> ExitKind {
    if is_hosting_exit(exit) {
        ExitKind::Hosting
    } else if is_residential_isp_exit(exit) || exit.hosting == Some(false) {
        ExitKind::ResidentialIsp
    } else {
        ExitKind::Unknown
    }
}

fn canonical_residential_alias(isp_lower: &str, asn_num: Option<u32>) -> Option<&'static str> {
    if (asn_num == Some(6079) || contains_ascii_word(isp_lower, "rcn"))
        && !isp_lower.contains("astound")
    {
        return Some("Astound Broadband");
    }
    if (asn_num == Some(11404) || isp_lower.contains("wave broadband"))
        && !isp_lower.contains("astound")
    {
        return Some("Astound");
    }
    if asn_num == Some(7922) && isp_lower.contains("comcast") && !isp_lower.contains("xfinity") {
        return Some("Xfinity");
    }
    if matches!(asn_num, Some(20115 | 10796 | 11351 | 11426 | 11427 | 12271 | 20001 | 33363))
        && (isp_lower.contains("charter") || isp_lower.contains("time warner") || isp_lower.contains("bright house"))
        && !isp_lower.contains("spectrum")
    {
        return Some("Spectrum");
    }
    if asn_num == Some(701) && isp_lower.contains("verizon") && !isp_lower.contains("fios") {
        return Some("Fios");
    }
    None
}

pub fn format_exit_isp_label(exit: &Exit) -> String {
    let base = exit.isp.trim();
    let asn_clean = exit
        .asn
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let asn_num = parse_asn_number(asn_clean).or_else(|| parse_asn_number(Some(base)));
    let padded_lower = format!(" {} ", base.to_ascii_lowercase());
    let alias = canonical_residential_alias(&padded_lower, asn_num);
    let has_asn_in_base = asn_clean.is_some_and(|a| {
        base.to_ascii_uppercase()
            .contains(&a.to_ascii_uppercase())
    });

    if base.is_empty() {
        return match (alias, asn_clean) {
            (Some(al), Some(a)) => format!("{al} ({a})"),
            (Some(al), None) => al.to_string(),
            (None, Some(a)) => a.to_string(),
            (None, None) => String::new(),
        };
    }

    let formatted = match (alias, asn_clean.filter(|_| !has_asn_in_base)) {
        (Some(al), Some(a)) => format!("{base} ({al} · {a})"),
        (Some(al), None) => format!("{base} ({al})"),
        (None, Some(a)) => format!("{base} ({a})"),
        (None, None) => base.to_string(),
    };
    if formatted.len() < 280 {
        formatted
    } else {
        base.to_string()
    }
}

pub fn apply_builtin_classification(exit: &mut Exit) {
    if is_hosting_exit(exit) {
        exit.hosting = Some(true);
        exit.hosting_error = None;
        exit.isp = format_exit_isp_label(exit);
    } else if is_residential_isp_exit(exit) {
        if exit.hosting.is_none() {
            exit.hosting = Some(false);
            exit.hosting_error = None;
        }
        exit.isp = format_exit_isp_label(exit);
    }
}
#[derive(Serialize)]
pub struct Check {
    pub id: &'static str,
    pub title: &'static str,
    pub status: &'static str,
    pub detail: String,
}
pub fn checks(
    machine: &super::config::Machine,
    config: &super::config::Config,
    report: Option<&Report>,
    host: Option<&Exit>,
    version: &str,
) -> Vec<Check> {
    let check = |id, title, ok: Option<bool>, detail: String| Check {
        id,
        title,
        status: match ok {
            Some(true) => "ok",
            Some(false) => "mismatch",
            None => "pending",
        },
        detail,
    };
    let target = config.region(machine);
    vec![
        check(
            "exit.target-country",
            "目标地区网络出口",
            target
                .zip(report.and_then(|r| r.exit.as_ref()))
                .map(|(r, x)| x.country == r.country),
            report
                .and_then(|r| r.exit.as_ref())
                .map(|x| {
                    format!(
                        "目标：{}；实际：{} · {} · {} · {}",
                        target.map(|r| r.label).unwrap_or("自定义组合，未确定国家"),
                        x.country,
                        x.ip,
                        x.city,
                        x.isp
                    )
                })
                .unwrap_or("需要打开浏览器实测出口。".into()),
        ),
        check(
            "exit.machine-match",
            "浏览器与机器出口",
            host.zip(report.and_then(|r| r.exit.as_ref()))
                .map(|(a, b)| a.ip == b.ip),
            host.map(|x| format!("上次检测的机器出口：{}", x.ip))
                .unwrap_or("点击检测机器出口；配置代理不等于已核验。".into()),
        ),
        check(
            "environment.timezone",
            "时区一致",
            report
                .zip(report.and_then(|r| r.exit.as_ref()))
                .map(|(r, e)| {
                    r.timezone == config.timezone(machine)
                        && r.timezone == machine.timezone
                        && r.timezone == e.timezone
                }),
            format!(
                "本机：{}；浏览器：{}；出口：{}",
                machine.timezone,
                report.map(|x| x.timezone.as_str()).unwrap_or("待测"),
                report
                    .and_then(|x| x.exit.as_ref())
                    .map(|x| x.timezone.as_str())
                    .unwrap_or("待测")
            ),
        ),
        check(
            "environment.language-region",
            "目标语言与系统区域",
            target.zip(report).and_then(|(target, r)| {
                let language = config.language(machine);
                let first = machine.languages.first()?;
                if machine.locale_country.is_empty() || first.is_empty() || r.language.is_empty() {
                    return None;
                }
                Some(
                    r.language == language
                        && (first == &language
                            || first.starts_with(&format!("{language}-"))
                            || (config.follow_machine && first == "en" && language == "en-US"))
                        && machine.locale_country == target.country,
                )
            }),
            format!(
                "机器：{} / {}；浏览器：{}",
                machine.languages.join(" → "),
                machine.locale,
                report.map(|x| x.language.as_str()).unwrap_or("待测")
            ),
        ),
        check(
            "device.platform-cpu",
            "真实设备与 CPU",
            report.map(|r| {
                let platform = r.platform.to_lowercase();
                (match machine.platform.as_str() {
                    "windows" => platform == "win32",
                    "linux" => platform.contains("linux"),
                    _ => platform.contains("mac"),
                }) && r.cores == machine.cores
                    && (machine.platform == "linux" || r.platform_version == machine.version)
            }),
            format!(
                "本机：{} {} · {} 核；网页上报：{} · {} 核",
                match machine.platform.as_str() {
                    "windows" => "Windows",
                    "macos" => "macOS",
                    "linux" => "Linux",
                    other => other,
                },
                machine.version,
                machine.cores,
                report
                    .map(|x| x.platform_version.as_str())
                    .unwrap_or("待测"),
                report.map(|x| x.cores.to_string()).unwrap_or("待测".into())
            ),
        ),
        check(
            "browser.version",
            "浏览器版本",
            report.map(|r| r.browser_version == version),
            format!(
                "引擎：{version}；实测：{}",
                report.map(|x| x.browser_version.as_str()).unwrap_or("待测")
            ),
        ),
        check(
            "privacy.geolocation",
            "地理位置关闭",
            report.and_then(|r| {
                if r.geolocation != "denied" {
                    Some(false)
                } else {
                    machine.location_enabled.map(|enabled| !enabled)
                }
            }),
            format!(
                "机器定位：{}；网页权限：{}",
                match machine.location_enabled {
                    Some(true) => "开启",
                    Some(false) => "关闭",
                    None => "尚未核验",
                },
                report.map(|x| x.geolocation.as_str()).unwrap_or("待测")
            ),
        ),
        check(
            "probe.graphics-webdriver",
            "真实图形与字体",
            report
                .filter(|r| r.schema_version == Some(1))
                .and_then(|r| r.graphics_ok.map(|g| g && r.webdriver != Some(true))),
            if let Some(renderer) = report
                .and_then(|r| r.webgl_renderer.as_deref())
                .filter(|s| !s.is_empty())
            {
                format!(
                    "硬件渲染：{renderer}；webdriver：{}",
                    if report.and_then(|r| r.webdriver) == Some(true) {
                        "暴露"
                    } else {
                        "已隐藏"
                    }
                )
            } else if config.native_graphics {
                "已配置使用真实字体、GPU、音频、Canvas 与布局；读数尚未独立核验。".into()
            } else {
                "Canvas 与布局矩形使用稳定种子；不作为机器完全一致。".into()
            },
        ),
        check(
            "probe.webrtc-local-candidates",
            "WebRTC 本地候选观察",
            report
                .filter(|r| r.schema_version == Some(1))
                .and_then(|r| r.webrtc_ok),
            if let Some(detail) = report
                .and_then(|r| r.webrtc_detail.as_deref())
                .filter(|s| !s.is_empty())
            {
                if detail.starts_with("无 STUN") {
                    detail.to_string()
                } else {
                    format!("无 STUN 的短时本地候选观察；不覆盖 DNS 或公网 STUN：{detail}")
                }
            } else {
                "尚无完整的本地候选观察；此项不测 DNS 或公网 STUN。".into()
            },
        ),
        check(
            "exit.provider-probes",
            "防封特征与出口纯净度",
            report.and_then(|r| {
                let exit = r.exit.as_ref()?;
                let isp_ok = if exit.hosting == Some(true) || is_hosting_exit(exit) {
                    Some(false)
                } else if exit.hosting == Some(false) || is_residential_isp_exit(exit) {
                    Some(true)
                } else {
                    None
                };
                let probes_ok = if r.schema_version != Some(1) {
                    None
                } else if [r.tz_offset_ok, r.media_fingerprint_ok, r.client_hints_ok]
                    .contains(&Some(false))
                {
                    Some(false)
                } else if r.tz_offset_ok == Some(true)
                    && r.media_fingerprint_ok == Some(true)
                    && r.client_hints_ok == Some(true)
                {
                    Some(true)
                } else {
                    None
                };
                match (isp_ok, probes_ok) {
                    (Some(false), _) => Some(false),
                    (Some(true), Some(true)) => Some(true),
                    _ => None,
                }
            }),
            if let Some(r) = report {
                if let Some(exit) = r.exit.as_ref() {
                    let isp_tag = if exit.hosting == Some(true) || is_hosting_exit(exit) {
                        "IDC 机房（高风控）"
                    } else if is_residential_isp_exit(exit) {
                        "住宅宽带 ISP"
                    } else if exit.hosting == Some(false) {
                        "分类数据源未标记为机房"
                    } else {
                        "运营商未知"
                    };
                    let probes_tag = if r.tz_offset_ok == Some(false)
                        || r.media_fingerprint_ok == Some(false)
                        || r.client_hints_ok == Some(false)
                    {
                        "部分防封探针异常"
                    } else if r.tz_offset_ok == Some(true)
                        && r.media_fingerprint_ok == Some(true)
                        && r.client_hints_ok == Some(true)
                    {
                        "时区偏移 / Canvas / 音频 / UA-CH 已核验正常"
                    } else {
                        "时区偏移 / Canvas / UA-CH 待核验或正常"
                    };
                    format!("出口属性：{isp_tag}；探针：{probes_tag}")
                } else {
                    "等待出口与防封探针实测结果。".into()
                }
            } else {
                "内建 ISP 纯净度、时区偏移、Canvas/音频与 UA-CH 深度核验；打开浏览器实测。".into()
            },
        ),
    ]
}
