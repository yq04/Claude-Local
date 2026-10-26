// [INPUT]: 显式代理地址、ipwho.is/ipapi.co HTTPS 出口信息与带 schema 版本的浏览器观测。
// [OUTPUT]: 目标环境核验、出口分类与版本兼容探针检查；缺少/旧版观测保持 pending。
// [POS]: 环境核验边界；WebRTC 仅为无 STUN 本地候选观察，不证明 DNS 或公网 STUN 状态。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
pub const SERVICES: [&str; 2] = ["https://ipwho.is/", "https://ipapi.co/json/"];
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
        .or_else(|| data["security"]["hosting"].as_bool());
    Ok(Exit {
        ip: ip.into(),
        country: country.into(),
        city: data["city"].as_str().unwrap_or("").into(),
        timezone: data["timezone"]
            .as_str()
            .or_else(|| data["timezone"]["id"].as_str())
            .unwrap_or("")
            .into(),
        isp: data["org"]
            .as_str()
            .or_else(|| data["connection"]["isp"].as_str())
            .or_else(|| data["connection"]["org"].as_str())
            .unwrap_or("")
            .into(),
        asn,
        hosting,
    })
}
pub async fn probe(proxy: &str) -> Result<Exit, String> {
    probe_urls(proxy, &SERVICES).await
}
pub(super) async fn probe_urls(proxy: &str, services: &[&str]) -> Result<Exit, String> {
    let mut client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(8));
    if !proxy.is_empty() {
        client = client.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理格式无效。")?);
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
            Ok(exit) => return Ok(exit),
            Err(error) => errors.push(format!("{name}：{error}")),
        }
    }
    Err(format!(
        "出口检测未完成（{}）。请检查 TUN/代理连接后重试。",
        errors.join("；")
    ))
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
                })
                .unwrap_or(true)
    }
}
pub fn is_hosting_exit(exit: &Exit) -> bool {
    if exit.hosting == Some(true) {
        return true;
    }
    let text = format!(
        " {} {} ",
        exit.isp.to_ascii_lowercase(),
        exit.asn.as_deref().unwrap_or("").to_ascii_lowercase()
    );
    const HOSTING_KEYWORDS: [&str; 26] = [
        "amazon",
        "aws",
        "google cloud",
        "digitalocean",
        "linode",
        "akamai",
        "vultr",
        "choopa",
        "constant company",
        "hetzner",
        "ovh",
        "m247",
        "contabo",
        "leaseweb",
        "datacamp",
        "cdn77",
        "cloudflare",
        "fastly",
        "oracle cloud",
        "alibaba",
        "aliyun",
        "tencent",
        "zenlayer",
        "sharktech",
        "datacenter",
        "hosting",
    ];
    HOSTING_KEYWORDS.iter().any(|kw| text.contains(kw))
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
                "{} {} · {} 核；浏览器版本 {} · {} 核",
                machine.platform,
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
            report.map(|r| machine.location_enabled == Some(false) && r.geolocation == "denied"),
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
                format!("无 STUN 的短时本地候选观察；不覆盖 DNS 或公网 STUN：{detail}")
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
                } else if exit.hosting == Some(false) {
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
                    let isp_tag = if is_hosting_exit(exit) {
                        "IDC 机房（高风控）"
                    } else if exit.hosting == Some(false) {
                        "运营商标记为非机房"
                    } else {
                        "运营商未知"
                    };
                    let probes_tag = if r.tz_offset_ok == Some(false)
                        || r.media_fingerprint_ok == Some(false)
                        || r.client_hints_ok == Some(false)
                    {
                        "部分防封探针异常"
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
