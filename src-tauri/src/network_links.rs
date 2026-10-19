// [INPUT]: 四个固定 Claude 服务目标、只读浏览器/系统代理配置和用户手动诊断命令。
// [OUTPUT]: 四域名只读连通性诊断；重定向仅认可服务 HTTPS 目标且不跟随，下载探针验证有界版本正文，不输出正文或冒充出口核验。
// [POS]: 独立网络诊断接口；没有外部资源导航或供应商配置依赖，不读取密钥，诊断不上传凭据。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const RELEASE_VERSION_LIMIT: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainCheckResult {
    pub domain: String,
    pub ok: bool,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u64>,
    pub ip: Option<String>,
    pub message: String,
}

fn valid_release_version(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).ok().is_some_and(|text| {
        let mut parts = text.trim_ascii().split('.');
        (0..3).all(|_| {
            parts.next().is_some_and(|part| {
                !part.is_empty()
                    && part.bytes().all(|byte| byte.is_ascii_digit())
                    && (part == "0" || !part.starts_with('0'))
            })
        }) && parts.next().is_none()
    })
}

fn valid_redirect_location(request_url: &str, location: Option<&str>) -> bool {
    let Some(target) = location
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| reqwest::Url::parse(request_url).ok()?.join(value).ok())
    else {
        return false;
    };
    target.scheme() == "https"
        && target.port_or_known_default() == Some(443)
        && target.username().is_empty()
        && target.password().is_none()
        && target.host_str().is_some_and(|host| {
            ["claude.ai", "claude.com", "anthropic.com"]
                .iter()
                .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        })
}

async fn validate_release_metadata(mut response: reqwest::Response) -> Result<(), &'static str> {
    if response.status() != reqwest::StatusCode::OK {
        return Err("下载版本信息响应异常");
    }
    if response
        .content_length()
        .is_some_and(|size| size > RELEASE_VERSION_LIMIT as u64)
    {
        return Err("下载版本信息过大");
    }
    let mut bytes = Vec::with_capacity(RELEASE_VERSION_LIMIT);
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            "请求超时"
        } else {
            "下载版本信息读取失败"
        }
    })? {
        if chunk.len() > RELEASE_VERSION_LIMIT - bytes.len() {
            return Err("下载版本信息过大");
        }
        bytes.extend_from_slice(&chunk);
    }
    if !valid_release_version(&bytes) {
        return Err("下载版本信息无效");
    }
    Ok(())
}

async fn diagnose(client: reqwest::Client, domain: String, url: String) -> DomainCheckResult {
    let started = Instant::now();
    let release_metadata = domain == "downloads.claude.ai";
    let mut result = DomainCheckResult {
        domain,
        ok: false,
        status_code: None,
        latency_ms: None,
        ip: None,
        message: String::new(),
    };
    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            // 展示真实连接对端，不把独立 DNS 查询误称为这次连接的路由。
            result.ip = response
                .remote_addr()
                .map(|address| address.ip().to_string());
            result.status_code = Some(status);
            // 下载源必须交付有效版本正文，不能把对象不存在、重定向或质询当成下载可用。
            if release_metadata {
                match validate_release_metadata(response).await {
                    Ok(()) => {
                        result.ok = true;
                        result.message = "下载版本信息已验证".into();
                    }
                    Err(message) => result.message = message.into(),
                }
                result.latency_ms = Some(started.elapsed().as_millis() as u64);
                return result;
            }
            // Cloudflare 对无脚本客户端返回可由浏览器完成的质询，说明已到达站点边缘；拦截规则不带此标记。
            let challenge = status == 403
                && response
                    .headers()
                    .get("cf-mitigated")
                    .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"challenge"));
            let redirect_ok = valid_redirect_location(
                &url,
                response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok()),
            );
            result.ok = (200..300).contains(&status)
                || ((300..400).contains(&status) && redirect_ok)
                || status == 401
                || status == 404
                || challenge;
            result.message = match status {
                200..=299 => "连接正常",
                401 | 404 => "服务响应正常",
                300..=399 if redirect_ok => "服务要求重定向",
                300..=399 => "受到安全拦截或限制",
                403 if challenge => "服务可达，需浏览器验证",
                403 => "受到安全拦截或限制",
                _ => "服务响应异常",
            }
            .into();
        }
        Err(error) => {
            result.message = if error.is_timeout() {
                "请求超时"
            } else if error.is_connect() {
                "连接失败或代理阻断"
            } else {
                "网络连接失败"
            }
            .into();
        }
    }
    result.latency_ms = Some(started.elapsed().as_millis() as u64);
    result
}
pub(crate) async fn diagnose_urls(targets: &[(&str, &str)]) -> Vec<DomainCheckResult> {
    diagnose_urls_with_proxy(targets, "").await
}
pub(crate) async fn diagnose_urls_with_proxy(
    targets: &[(&str, &str)],
    proxy: &str,
) -> Vec<DomainCheckResult> {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8));
    let trimmed = proxy.trim();
    if !trimmed.is_empty() {
        if let Ok(p) = reqwest::Proxy::all(trimmed) {
            builder = builder.proxy(p);
        }
    }
    let client = match builder.build() {
        Ok(client) => client,
        Err(_) => {
            return targets
                .iter()
                .map(|(domain, _)| DomainCheckResult {
                    domain: domain.to_string(),
                    ok: false,
                    status_code: None,
                    latency_ms: None,
                    ip: None,
                    message: "无法创建网络客户端".into(),
                })
                .collect()
        }
    };
    // DNS 交由异步 HTTP 客户端；固定探针并发，避免阻塞运行时或串行等待各自的 8 秒超时。
    let tasks: Vec<_> = targets
        .iter()
        .map(|(domain, url)| {
            tauri::async_runtime::spawn(diagnose(
                client.clone(),
                domain.to_string(),
                url.to_string(),
            ))
        })
        .collect();
    let mut results = Vec::new();
    for ((domain, _), task) in targets.iter().zip(tasks) {
        results.push(task.await.unwrap_or_else(|_| DomainCheckResult {
            domain: domain.to_string(),
            ok: false,
            status_code: None,
            latency_ms: None,
            ip: None,
            message: "网络连接失败".into(),
        }));
    }
    results
}

#[tauri::command]
pub async fn network_diagnose_domains(
    app: tauri::AppHandle,
) -> Result<Vec<DomainCheckResult>, String> {
    let proxy = tauri::async_runtime::spawn_blocking(move || {
        crate::browser::configured_or_system_proxy(&app)
    })
    .await
    .unwrap_or_default();
    Ok(diagnose_urls_with_proxy(&CLAUDE_TARGETS, &proxy).await)
}

// downloads.claude.ai 是不允许列目录的对象存储，根路径恒为 403；探测官方安装器实际读取的公开版本号。
const CLAUDE_TARGETS: [(&str, &str); 4] = [
    ("claude.ai", "https://claude.ai/"),
    ("api.anthropic.com", "https://api.anthropic.com/"),
    ("platform.claude.com", "https://platform.claude.com/"),
    (
        "downloads.claude.ai",
        "https://downloads.claude.ai/claude-code-releases/latest",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};

    #[test]
    fn network_page_only_registers_read_only_diagnostics() {
        let main = include_str!("main.rs");
        assert!(main.contains("network_links::network_diagnose_domains"));
        assert!(!main.contains("network_links::network_open_resource"));
    }

    #[test]
    fn fixed_claude_targets_avoid_unlisted_bucket_root() {
        let domains: Vec<_> = CLAUDE_TARGETS.iter().map(|(domain, _)| *domain).collect();
        assert_eq!(
            domains,
            [
                "claude.ai",
                "api.anthropic.com",
                "platform.claude.com",
                "downloads.claude.ai"
            ]
        );
        for (domain, url) in CLAUDE_TARGETS {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert_eq!(parsed.scheme(), "https");
            assert_eq!(parsed.host_str(), Some(domain));
        }
        assert_eq!(
            CLAUDE_TARGETS[3].1,
            "https://downloads.claude.ai/claude-code-releases/latest"
        );
    }

    #[test]
    fn release_version_requires_three_numeric_components() {
        for version in [b"2.1.300".as_slice(), b"0.0.1\n", b" 2.1.300\r\n"] {
            assert!(valid_release_version(version));
        }
        for version in [
            b"".as_slice(),
            b" \r\n",
            b"2.1",
            b"2.1.300.1",
            b"v2.1.300",
            b"2.01.300",
            b"2.1.-1",
            b"2.1.300-beta",
            b"<html>2.1.300</html>",
            b"2.1.300\0",
            b"2.1.\xff",
        ] {
            assert!(!valid_release_version(version));
        }
    }

    #[test]
    fn redirects_only_accept_official_https_without_credentials() {
        for location in [
            "/login",
            "login?next=home",
            "https://platform.claude.com/",
            "//claude.ai/login",
            "https://api.anthropic.com/",
        ] {
            assert!(
                valid_redirect_location("https://claude.ai/", Some(location)),
                "{location}"
            );
        }
        for location in [
            "",
            " ",
            "http://claude.ai/",
            "https://claude.ai:444/",
            "https://user:password@claude.ai/",
            "https://captive.example.invalid/",
            "https://claude.ai.example.invalid/",
            "https://notclaude.ai/",
            "javascript:alert(1)",
        ] {
            assert!(
                !valid_redirect_location("https://claude.ai/", Some(location)),
                "{location}"
            );
        }
        assert!(!valid_redirect_location("https://claude.ai/", None));
    }

    #[test]
    fn downloads_require_complete_bounded_http_200_version_metadata() {
        let response = |status: &str, body: &[u8]| {
            let mut bytes = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .into_bytes();
            bytes.extend_from_slice(body);
            bytes
        };
        let cases = [
            (response("200 OK", b"2.1.300\n"), true, "下载版本信息已验证"),
            (response("200 OK", b""), false, "下载版本信息无效"),
            (
                response("200 OK", b"<html>OK</html>"),
                false,
                "下载版本信息无效",
            ),
            (
                response("200 OK", b"2.1.300\xff"),
                false,
                "下载版本信息无效",
            ),
            (
                response("200 OK", &[b'1'; RELEASE_VERSION_LIMIT + 1]),
                false,
                "下载版本信息过大",
            ),
            (
                response(
                    "302 Found\r\nLocation: http://127.0.0.1:1/never-follow",
                    b"2.1.300",
                ),
                false,
                "下载版本信息响应异常",
            ),
            (
                response("401 Unauthorized", b"2.1.300"),
                false,
                "下载版本信息响应异常",
            ),
            (
                response("403 Forbidden\r\ncf-mitigated: challenge", b"2.1.300"),
                false,
                "下载版本信息响应异常",
            ),
            (
                response("404 Not Found", b"2.1.300"),
                false,
                "下载版本信息响应异常",
            ),
            (
                response("206 Partial Content", b"2.1.300"),
                false,
                "下载版本信息响应异常",
            ),
            (
                response("500 Internal Server Error", b"2.1.300"),
                false,
                "下载版本信息响应异常",
            ),
            // 没有 Content-Length 时仍按实际收到的块限制；正文截断不能只凭已到达的数字报告成功。
            (
                [
                    b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".as_slice(),
                    &[b'1'; RELEASE_VERSION_LIMIT + 1],
                ]
                .concat(),
                false,
                "下载版本信息过大",
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\n2.1.300"
                    .to_vec(),
                false,
                "下载版本信息读取失败",
            ),
        ];
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let expected: Vec<_> = cases
            .iter()
            .map(|(_, ok, message)| (*ok, *message))
            .collect();
        let server = std::thread::spawn(move || {
            for (response, _, _) in cases {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    request.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                let lower = request.to_ascii_lowercase();
                assert!(!lower.contains("authorization:") && !lower.contains("cookie:"));
                stream.write_all(&response).unwrap();
            }
        });
        let url = format!("http://{address}/claude-code-releases/latest");
        // 顺序请求让每个畸形响应对应固定断言；全部流量限制在临时回环服务。
        for (ok, message) in expected {
            let results =
                tauri::async_runtime::block_on(diagnose_urls(&[("downloads.claude.ai", &url)]));
            assert_eq!(results[0].ok, ok);
            assert_eq!(results[0].message, message);
            assert_eq!(results[0].ip.as_deref(), Some("127.0.0.1"));
        }
        server.join().unwrap();
    }

    #[test]
    fn domain_diagnostics_handles_mock_endpoints() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0
                        || line == "\r\n"
                        || line == "\n"
                    {
                        break;
                    }
                }
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                );
            }
        });
        let target = format!("http://{address}/");
        let results = tauri::async_runtime::block_on(diagnose_urls(&[("127.0.0.1", &target)]));
        assert_eq!(results.len(), 1);
        assert!(results[0].ok);
        assert_eq!(results[0].status_code, Some(200));
        assert_eq!(results[0].message, "连接正常");
    }

    #[test]
    fn probes_never_send_credentials_or_follow_redirects() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..5 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    request.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                let lower = request.to_lowercase();
                assert!(!lower.contains("authorization:"));
                assert!(!lower.contains("cookie:"));
                let status = if request.starts_with("GET /blocked ") {
                    "403 Forbidden"
                } else if request.starts_with("GET /challenge ") {
                    "403 Forbidden\r\ncf-mitigated: challenge"
                } else if request.starts_with("GET /redirect ") {
                    "302 Found"
                } else if request.starts_with("GET /portal ") {
                    "302 Found\r\nLocation: https://captive.example.invalid/"
                } else {
                    "401 Unauthorized"
                };
                let location = if request.starts_with("GET /portal ") {
                    ""
                } else {
                    "Location: https://claude.ai/login\r\n"
                };
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\n{location}Content-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
            }
        });
        let urls = [
            format!("http://{address}/auth"),
            format!("http://{address}/blocked"),
            format!("http://{address}/redirect"),
            format!("http://{address}/challenge"),
            format!("http://{address}/portal"),
        ];
        let results = tauri::async_runtime::block_on(diagnose_urls(&[
            ("auth", &urls[0]),
            ("blocked", &urls[1]),
            ("redirect", &urls[2]),
            ("challenge", &urls[3]),
            ("portal", &urls[4]),
        ]));
        server.join().unwrap();
        assert!(results[0].ok);
        assert!(!results[1].ok);
        assert_eq!(results[2].status_code, Some(302));
        assert_eq!(results[2].message, "服务要求重定向");
        assert!(results[3].ok);
        assert_eq!(results[3].status_code, Some(403));
        assert_eq!(results[3].message, "服务可达，需浏览器验证");
        assert_eq!(results[1].message, "受到安全拦截或限制");
        assert!(!results[4].ok);
        assert_eq!(results[4].message, "受到安全拦截或限制");
        assert!(results
            .iter()
            .all(|result| result.ip.as_deref() == Some("127.0.0.1")));
    }
}
