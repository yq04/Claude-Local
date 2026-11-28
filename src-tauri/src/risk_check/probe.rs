// [INPUT]: 冻结浏览器代理配置、目标地区参数以及用户触发的三路 trace URL。
// [OUTPUT]: 浏览器 DNS/代理防护投影（parse_browser_dns_guard，对齐 browser::config::proxy 覆盖 http/https/socks5/socks5h 远端 DNS 锁定）、Cloudflare trace 解析及并发验证的一致性报告（ConsistencyProbeReport）。
// [POS]: risk_check 子模块：只读浏览器代理语义投影与边缘 trace 出口一致性并发探测。
// [PROTOCOL]: 变更时更新此头部，然后检查 risk_check/CLAUDE.md
use super::{
    is_valid_rfc1918_lan_ipv4, BrowserDnsGuard, ConsistencyProbeReport, TraceEndpointResult,
};
use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};

const TRACE_BODY_LIMIT: usize = 4096;

pub fn parse_browser_dns_guard(
    configured_proxy: &str,
    target_country: Option<String>,
    target_timezone: String,
    target_language: String,
) -> BrowserDnsGuard {
    let trimmed = configured_proxy.trim();
    if trimmed.is_empty() {
        return BrowserDnsGuard {
            proxy_configured: false,
            proxy_scheme: None,
            proxy_local_port: None,
            remote_dns_locked: false,
            target_country,
            target_timezone,
            target_language,
        };
    }
    if let Ok(url) = reqwest::Url::parse(trimmed) {
        let scheme = url.scheme().to_ascii_lowercase();
        let remote_dns_locked = crate::browser::config::proxy(trimmed).is_ok_and(|u| u.is_some());
        let local_host = url.host_str().is_some_and(|host| {
            let clean = host.trim_matches(['[', ']']);
            clean.eq_ignore_ascii_case("localhost")
                || clean == "127.0.0.1"
                || clean == "::1"
                || clean
                    .parse::<Ipv4Addr>()
                    .is_ok_and(is_valid_rfc1918_lan_ipv4)
        });
        return BrowserDnsGuard {
            proxy_configured: true,
            proxy_scheme: Some(scheme),
            proxy_local_port: if local_host { url.port() } else { None },
            remote_dns_locked,
            target_country,
            target_timezone,
            target_language,
        };
    }
    BrowserDnsGuard {
        proxy_configured: true,
        proxy_scheme: None,
        proxy_local_port: None,
        remote_dns_locked: false,
        target_country,
        target_timezone,
        target_language,
    }
}

pub fn parse_cloudflare_trace(domain: &str, body: &str, latency_ms: u64) -> TraceEndpointResult {
    let mut ip: Option<String> = None;
    let mut country: Option<String> = None;
    let mut colo: Option<String> = None;

    for line in body.lines().take(32) {
        if let Some((k, v)) = line.trim().split_once('=') {
            let v = v.trim();
            match k {
                "ip" => {
                    if v.parse::<IpAddr>().is_ok() {
                        ip = Some(v.to_string());
                    }
                }
                "loc" => {
                    if v.len() == 2 && v.bytes().all(|b| b.is_ascii_uppercase()) {
                        country = Some(v.to_string());
                    }
                }
                "colo" => {
                    if !v.is_empty() && v.len() <= 8 && v.bytes().all(|b| b.is_ascii_alphanumeric())
                    {
                        colo = Some(v.to_ascii_uppercase());
                    }
                }
                _ => {}
            }
        }
    }

    if country.is_some() && ip.is_some() {
        TraceEndpointResult {
            domain: domain.to_string(),
            ok: true,
            country,
            colo,
            ip,
            latency_ms: Some(latency_ms),
            error: None,
        }
    } else {
        TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country,
            colo,
            ip,
            latency_ms: Some(latency_ms),
            error: Some("invalid_trace".into()),
        }
    }
}

async fn fetch_trace_endpoint(
    client: reqwest::Client,
    domain: &'static str,
    url: String,
) -> TraceEndpointResult {
    let started = Instant::now();
    let response = match client.get(&url).send().await {
        Ok(resp) => resp,
        Err(err) => {
            let code = if err.is_timeout() {
                "timeout"
            } else if err.is_connect() {
                "connect_failed"
            } else {
                "network_error"
            };
            return TraceEndpointResult {
                domain: domain.to_string(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: Some(code.into()),
            };
        }
    };

    if !response.status().is_success() {
        return TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country: None,
            colo: None,
            ip: None,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: Some(format!("HTTP {}", response.status().as_u16())),
        };
    }

    let mut bytes = Vec::with_capacity(512);
    let mut resp = response;
    while let Ok(Some(chunk)) = resp.chunk().await {
        if bytes.len() + chunk.len() > TRACE_BODY_LIMIT {
            return TraceEndpointResult {
                domain: domain.to_string(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: Some("invalid_trace".into()),
            };
        }
        bytes.extend_from_slice(&chunk);
    }

    let latency_ms = started.elapsed().as_millis() as u64;
    match std::str::from_utf8(&bytes) {
        Ok(text) => parse_cloudflare_trace(domain, text, latency_ms),
        Err(_) => TraceEndpointResult {
            domain: domain.to_string(),
            ok: false,
            country: None,
            colo: None,
            ip: None,
            latency_ms: Some(latency_ms),
            error: Some("invalid_trace".into()),
        },
    }
}

pub(crate) async fn probe_consistency_urls(
    proxy: &str,
    claude_url: &str,
    persona_url: &str,
    unlisted_url: &str,
    include_isp: bool,
) -> ConsistencyProbeReport {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8));

    let trimmed = crate::browser::config::normalize_reqwest_proxy(proxy);
    if !trimmed.is_empty() {
        if let Ok(p) = reqwest::Proxy::all(&trimmed) {
            builder = builder.proxy(p);
        }
    }

    let client = match builder.build() {
        Ok(c) => c,
        Err(_) => {
            let fail = |domain: &str| TraceEndpointResult {
                domain: domain.into(),
                ok: false,
                country: None,
                colo: None,
                ip: None,
                latency_ms: None,
                error: Some("client_error".into()),
            };
            return ConsistencyProbeReport {
                context_id: None,
                claude: fail("claude.ai"),
                persona: fail("withpersona.com"),
                unlisted_dns: fail("cloudflare-dns.com"),
                exit_isp: None,
                same_country: None,
                same_exit_ip: None,
                unlisted_same_country: None,
            };
        }
    };

    let c_url = claude_url.to_string();
    let p_url = persona_url.to_string();
    let u_url = unlisted_url.to_string();
    let proxy_owned = trimmed.to_string();

    let t_claude =
        tauri::async_runtime::spawn(fetch_trace_endpoint(client.clone(), "claude.ai", c_url));
    let t_persona = tauri::async_runtime::spawn(fetch_trace_endpoint(
        client.clone(),
        "withpersona.com",
        p_url,
    ));
    let t_unlisted =
        tauri::async_runtime::spawn(fetch_trace_endpoint(client, "cloudflare-dns.com", u_url));
    let t_isp = if include_isp {
        Some(tauri::async_runtime::spawn(async move {
            crate::browser::network::probe(&proxy_owned).await.ok()
        }))
    } else {
        None
    };

    let fallback = |domain: &str| TraceEndpointResult {
        domain: domain.into(),
        ok: false,
        country: None,
        colo: None,
        ip: None,
        latency_ms: None,
        error: Some("network_error".into()),
    };

    let claude = t_claude.await.unwrap_or_else(|_| fallback("claude.ai"));
    let persona = t_persona
        .await
        .unwrap_or_else(|_| fallback("withpersona.com"));
    let unlisted_dns = t_unlisted
        .await
        .unwrap_or_else(|_| fallback("cloudflare-dns.com"));
    let claude_parsed_ip = claude
        .ip
        .as_deref()
        .and_then(|s| s.trim().parse::<IpAddr>().ok());
    let mut exit_isp = match t_isp {
        Some(handle) => handle.await.ok().flatten(),
        None => None,
    };
    if let (Some(expected_ip), Some(ref current_exit)) = (claude_parsed_ip, &exit_isp) {
        let actual_ip = current_exit.ip.trim().parse::<IpAddr>().ok();
        if actual_ip != Some(expected_ip) {
            exit_isp = None;
        }
    }
    if exit_isp.is_none() && include_isp {
        if let Some(ref cip) = claude.ip {
            exit_isp = crate::browser::network::probe_ip_via_ipquery(&trimmed, cip)
                .await
                .ok()
                .filter(
                    |queried| match (claude_parsed_ip, queried.ip.trim().parse::<IpAddr>().ok()) {
                        (Some(exp), Some(act)) => exp == act,
                        _ => false,
                    },
                );
        }
    }
    if let Some(ref mut exit) = exit_isp {
        crate::browser::network::apply_builtin_classification(exit);
    }

    let same_country = match (&claude.country, &persona.country) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };
    let same_exit_ip = match (&claude.ip, &persona.ip) {
        (Some(a), Some(b)) => {
            let ca = a.parse::<IpAddr>().ok();
            let cb = b.parse::<IpAddr>().ok();
            match (ca, cb) {
                (Some(ia), Some(ib)) => Some(ia == ib),
                _ => Some(a == b),
            }
        }
        _ => None,
    };
    let unlisted_same_country = match (&claude.country, &unlisted_dns.country) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };

    ConsistencyProbeReport {
        context_id: None,
        claude,
        persona,
        unlisted_dns,
        exit_isp,
        same_country,
        same_exit_ip,
        unlisted_same_country,
    }
}
