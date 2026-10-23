// [INPUT]: 只读有界身份摘要、打包起始页、随机会话令牌、机器上下文与显式触发的一次性扩展快照。
// [OUTPUT]: 仅 127.0.0.1 的起始页、观测接口和严格扩展 Origin 的额度回传路由；有界并发、正文与时限，资源限定在打包目录。
// [POS]: Chromium 与工具箱之间的窄桥；额度路由只经单次身份绑定票据调用既有白名单账本接口。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{network::Report, Browser, Context};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
const MAX_REQUESTS: usize = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const QUOTA_BRIDGE_ORIGIN: &str = "chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg";
struct RequestPermit(Arc<AtomicUsize>);
impl RequestPermit {
    fn acquire(active: &Arc<AtomicUsize>) -> Option<Self> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_REQUESTS).then_some(n + 1)
            })
            .ok()
            .map(|_| Self(Arc::clone(active)))
    }
}
impl Drop for RequestPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
fn read_before(
    stream: &mut TcpStream,
    mut buffer: &mut [u8],
    deadline: Instant,
) -> std::io::Result<()> {
    while !buffer.is_empty() {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or(std::io::ErrorKind::TimedOut)?;
        stream.set_read_timeout(Some(remaining.min(Duration::from_millis(500))))?;
        match stream.read(buffer) {
            Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            Ok(n) => buffer = &mut buffer[n..],
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
fn current_session(session: &Option<super::Session>, token: &str) -> bool {
    session.as_ref().is_some_and(|s| s.token == token)
}
fn answer(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8]) {
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; frame-ancestors 'none'; connect-src 'self' https://ipwho.is https://ipapi.co; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'self'\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}
fn answer_quota(stream: &mut TcpStream, status: &str, body: &[u8]) {
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nAccess-Control-Allow-Origin: {QUOTA_BRIDGE_ORIGIN}\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nVary: Origin\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}
pub fn nonce() -> Result<String, String> {
    #[cfg(unix)]
    {
        let mut bytes = [0u8; 24];
        std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut bytes))
            .map_err(|_| "无法创建本地会话令牌。")?;
        Ok(bytes.iter().map(|x| format!("{x:02x}")).collect())
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        let mut bytes = [0u8; 24];
        let status = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                bytes.as_mut_ptr(),
                bytes.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status != 0 {
            return Err("无法创建本地会话令牌。".into());
        }
        Ok(bytes.iter().map(|x| format!("{x:02x}")).collect())
    }
}
pub fn bind() -> Result<TcpListener, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "起始页服务启动失败。")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "起始页服务配置失败。")?;
    Ok(listener)
}
pub fn resource(root: &Path, relative: &str) -> Option<std::path::PathBuf> {
    let path = Path::new(relative);
    if path
        .components()
        .any(|x| !matches!(x, Component::Normal(_)))
    {
        return None;
    }
    let target = root.join(path).canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    if !target.starts_with(root) || !target.is_file() {
        return None;
    }
    Some(target)
}
pub fn start(
    app: tauri::AppHandle,
    listener: TcpListener,
    token: String,
    root: std::path::PathBuf,
    context: Context,
) {
    let port = listener.local_addr().ok().map(|a| a.port()).unwrap_or(0);
    let context = Arc::new(context);
    let active = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        // 生命周期跟随会话令牌：令牌被替换或清空即退出；宿主运行期间保持可用，供 Claude-Local Browser 每次全新启动打开。
        loop {
            if app
                .state::<Browser>()
                .session
                .lock()
                .unwrap()
                .as_ref()
                .map(|x| x.token.as_str())
                != Some(token.as_str())
            {
                break;
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let Some(permit) = RequestPermit::acquire(&active) else {
                        continue;
                    };
                    let app_clone = app.clone();
                    let token_clone = token.clone();
                    let root_clone = root.clone();
                    let context_clone = Arc::clone(&context);
                    // 创建线程失败时闭包被释放，许可随之归还；不因本机资源不足使宿主崩溃。
                    let _ = std::thread::Builder::new().spawn(move || {
                        let _permit = permit;
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        handle(
                            &app_clone,
                            &mut stream,
                            &token_clone,
                            &root_clone,
                            &context_clone,
                            port,
                        );
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(40))
                }
                Err(_) => break,
            }
        }
    });
}
fn handle(
    app: &tauri::AppHandle,
    stream: &mut TcpStream,
    token: &str,
    root: &Path,
    context: &Context,
    port: u16,
) {
    let deadline = Instant::now() + REQUEST_TIMEOUT;
    let mut data = Vec::new();
    let mut byte = [0u8; 1];
    while data.len() < 8192 && !data.ends_with(b"\r\n\r\n") {
        if read_before(stream, &mut byte, deadline).is_err() {
            return;
        }
        data.push(byte[0]);
    }
    if !data.ends_with(b"\r\n\r\n") {
        return;
    }
    let header = String::from_utf8_lossy(&data);

    let mut host_count = 0;
    let mut host_valid = false;
    let mut content_length_count = 0;
    let mut content_length_valid = true;
    let mut content_type: Option<String> = None;
    let mut origin: Option<String> = None;
    let mut requested_method: Option<String> = None;
    let mut requested_headers: Option<String> = None;
    let mut has_transfer_encoding = false;

    for line in header.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim();
            match key.as_str() {
                "host" => {
                    host_count += 1;
                    if port > 0 {
                        let exp_ip = format!("127.0.0.1:{port}");
                        let exp_lh = format!("localhost:{port}");
                        if val == exp_ip || val == exp_lh {
                            host_valid = true;
                        }
                    } else if val.starts_with("127.0.0.1") || val.starts_with("localhost") {
                        host_valid = true;
                    }
                }
                "content-length" => {
                    content_length_count += 1;
                    if val.parse::<usize>().is_err() {
                        content_length_valid = false;
                    }
                }
                "content-type" => content_type = Some(val.to_ascii_lowercase()),
                "origin" => origin = Some(val.to_string()),
                "access-control-request-method" => requested_method = Some(val.to_string()),
                "access-control-request-headers" => {
                    requested_headers = Some(val.to_ascii_lowercase())
                }
                "transfer-encoding" => has_transfer_encoding = true,
                _ => {}
            }
        }
    }

    if host_count != 1
        || !host_valid
        || content_length_count > 1
        || !content_length_valid
        || has_transfer_encoding
    {
        answer(stream, "400 Bad Request", "text/plain", b"Bad request");
        return;
    }

    let mut words = header.lines().next().unwrap_or("").split_whitespace();
    let method = words.next().unwrap_or("");
    let url = words.next().unwrap_or("");
    let prefix = format!("/{token}/");
    let Some(path) = url.strip_prefix(&prefix) else {
        answer(stream, "404 Not Found", "text/plain", b"Not found");
        return;
    };
    let quota_route = path == "quota-sync";
    if let Some(ref org) = origin {
        let valid_origin = if port > 0 {
            org == &format!("http://127.0.0.1:{port}") || org == &format!("http://localhost:{port}")
        } else {
            org.starts_with("http://127.0.0.1") || org.starts_with("http://localhost")
        };
        if !valid_origin && !(quota_route && org == QUOTA_BRIDGE_ORIGIN) {
            answer(stream, "403 Forbidden", "text/plain", b"Invalid origin");
            return;
        }
    }
    if !current_session(&app.state::<Browser>().session.lock().unwrap(), token) {
        answer(stream, "410 Gone", "text/plain", b"Session expired");
        return;
    }
    if quota_route && method == "OPTIONS" {
        if origin.as_deref() == Some(QUOTA_BRIDGE_ORIGIN)
            && requested_method.as_deref() == Some("POST")
            && requested_headers.as_deref() == Some("content-type")
        {
            answer_quota(stream, "204 No Content", b"");
        } else {
            answer(stream, "403 Forbidden", "text/plain", b"Invalid preflight");
        }
        return;
    }
    if quota_route && method == "POST" {
        if origin.as_deref() != Some(QUOTA_BRIDGE_ORIGIN)
            || content_type.as_deref() != Some("application/json")
            || content_length_count != 1
        {
            answer(
                stream,
                "403 Forbidden",
                "text/plain",
                b"Invalid quota bridge request",
            );
            return;
        }
        let length = header
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, v)| v.trim().parse::<usize>().ok())
            .filter(|n| *n > 0 && *n <= 16_384);
        let Some(length) = length else {
            answer(stream, "400 Bad Request", "text/plain", b"Invalid length");
            return;
        };
        let mut body = vec![0u8; length];
        if read_before(stream, &mut body, deadline).is_err() {
            return;
        }
        let incoming = serde_json::from_slice::<super::quota_bridge::Incoming>(&body);
        let Ok(incoming) = incoming else {
            answer(
                stream,
                "400 Bad Request",
                "text/plain",
                b"Invalid quota snapshot",
            );
            return;
        };
        let ticket = {
            let browser = app.state::<Browser>();
            let mut pending = browser.quota_sync.lock().unwrap();
            super::quota_bridge::take_ticket(&mut pending, token, &incoming.nonce, Instant::now())
        };
        let Some(ticket) = ticket else {
            answer_quota(stream, "410 Gone", b"{\"ok\":false}");
            return;
        };
        let result = (|| -> Result<(), String> {
            let (current_id, current_quota_identity) =
                crate::identities::online::current_browser_binding(app)?;
            if current_id != ticket.account_id || current_quota_identity != ticket.quota_identity {
                return Err("quotaOnline.accountMismatch".into());
            }
            let observed_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "quotaOnline.unavailable")?
                .as_millis() as u64;
            let snapshot = super::quota_bridge::snapshot(incoming, observed_ms)?;
            if snapshot.billing_date.is_none() && snapshot.manual_resets_remaining.is_none() && snapshot.usage.is_none() {
                return Err("quotaOnline.bridgeUnavailable".into());
            }
            let value = crate::identities::online::import_browser_snapshot(
                app,
                &ticket.account_id,
                &ticket.quota_identity,
                serde_json::to_value(snapshot).map_err(|_| "quotaOnline.unavailable")?,
            )?;
            let status = value
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if !matches!(status, "updated" | "cached") {
                return Err(match status {
                    "account_mismatch" => "quotaOnline.accountMismatch".into(),
                    "auth_required" => "quotaOnline.authRequired".into(),
                    _ => "quotaOnline.unavailable".into(),
                });
            }
            if value
                .get("metadata_updated")
                .and_then(serde_json::Value::as_bool)
                == Some(true)
            {
                let _ = app.emit("quota-metadata-updated", ());
            }
            Ok(())
        })();
        let ok = result.is_ok();
        let _ = ticket.reply.send(result);
        answer_quota(
            stream,
            if ok { "200 OK" } else { "409 Conflict" },
            if ok {
                b"{\"ok\":true}"
            } else {
                b"{\"ok\":false}"
            },
        );
        return;
    }
    if method == "GET" && path == "context" {
        let mut current = context.clone();
        current.ui_language = crate::ui_language::ui_language_read(app.clone());
        let mask = crate::ui_privacy::effective_privacy_mask(app);
        match super::identity_context(app) {
            Ok(identity) => current.identity = super::mask_browser_identity(identity, mask),
            Err(_) => {
                answer(
                    stream,
                    "503 Service Unavailable",
                    "text/plain",
                    b"Identity state unavailable",
                );
                return;
            }
        }
        match super::config::machine() {
            Ok(machine) => current.update_machine(machine),
            Err(_) => {
                answer(
                    stream,
                    "503 Service Unavailable",
                    "text/plain",
                    b"Machine state unavailable",
                );
                return;
            }
        }
        let browser = app.state::<Browser>();
        let session = browser.session.lock().unwrap();
        if !current_session(&session, token) {
            answer(stream, "410 Gone", "text/plain", b"Session expired");
            return;
        }
        // 持有令牌锁直至写完摘要，换身份先使旧会话失效，旧请求不得取得新身份。
        answer(
            stream,
            "200 OK",
            "application/json",
            &serde_json::to_vec(&current).unwrap(),
        );
        return;
    }
    if method == "GET" && path == "report" {
        let browser = app.state::<Browser>();
        let session = browser.session.lock().unwrap();
        if !current_session(&session, token) {
            answer(stream, "410 Gone", "text/plain", b"Session expired");
            return;
        }
        let observed = session.as_ref().filter(|s| s.token == token);
        let body = serde_json::json!({"report": observed.and_then(|s| s.report.as_ref()), "received_at": observed.and_then(|s| s.received_at)});
        answer(
            stream,
            "200 OK",
            "application/json",
            &serde_json::to_vec(&body).unwrap(),
        );
        return;
    }
    if method == "POST" && path == "report" {
        let is_json = content_type
            .as_deref()
            .is_some_and(|c| c.starts_with("application/json"));
        if !is_json {
            answer(
                stream,
                "415 Unsupported Media Type",
                "text/plain",
                b"Invalid Content-Type",
            );
            return;
        }
        if origin.is_none() {
            answer(stream, "403 Forbidden", "text/plain", b"Missing origin");
            return;
        }
        let length = header
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, v)| v.trim().parse::<usize>().ok())
            .filter(|n| *n > 0 && *n <= 16_384);
        let Some(length) = length else {
            answer(stream, "400 Bad Request", "text/plain", b"Invalid length");
            return;
        };
        let mut body = vec![0u8; length];
        if read_before(stream, &mut body, deadline).is_err() {
            return;
        }
        let report = serde_json::from_slice::<Report>(&body)
            .ok()
            .filter(Report::valid);
        let Some(report) = report else {
            answer(stream, "400 Bad Request", "text/plain", b"Invalid report");
            return;
        };
        let state = app.state::<Browser>();
        let mut session = state.session.lock().unwrap();
        if let Some(state) = session.as_mut().filter(|x| x.token == token) {
            state.report = Some(report);
            state.received_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
            let _ = app.emit("browser-report", ());
            answer(stream, "200 OK", "application/json", b"{\"ok\":true}");
        } else {
            answer(stream, "410 Gone", "text/plain", b"Session expired");
        }
        return;
    }
    if method != "GET" {
        answer(
            stream,
            "405 Method Not Allowed",
            "text/plain",
            b"Method not allowed",
        );
        return;
    }
    serve_resource(stream, root, path);
}
fn media_type(path: &Path) -> Option<&'static str> {
    Some(
        match path.extension().and_then(|x| x.to_str()).unwrap_or("") {
            "html" => "text/html; charset=utf-8",
            "js" => "text/javascript",
            "css" => "text/css",
            "woff2" => "font/woff2",
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "avif" => "image/avif",
            _ => return None,
        },
    )
}
fn serve_resource(stream: &mut TcpStream, root: &Path, relative: &str) {
    let Some(path) = resource(root, relative) else {
        answer(stream, "404 Not Found", "text/plain", b"Not found");
        return;
    };
    let Some(kind) = media_type(&path) else {
        answer(stream, "404 Not Found", "text/plain", b"Not found");
        return;
    };
    if let Ok(body) = std::fs::read(path) {
        answer(stream, "200 OK", kind, &body);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_capacity_is_bounded_and_released_on_completion_or_spawn_failure() {
        let active = Arc::new(AtomicUsize::new(0));
        let mut requests = (0..MAX_REQUESTS)
            .map(|_| RequestPermit::acquire(&active).unwrap())
            .collect::<Vec<_>>();
        assert!(RequestPermit::acquire(&active).is_none());
        requests.pop();
        let permit = RequestPermit::acquire(&active).unwrap();
        // OS 无法创建线程时，Builder::spawn 丢弃未启动闭包并释放其中的许可。
        drop(move || {
            drop(permit);
        });
        assert_eq!(active.load(Ordering::Acquire), MAX_REQUESTS - 1);
        drop(requests);
        assert_eq!(active.load(Ordering::Acquire), 0);
    }
    #[test]
    fn request_body_uses_the_original_deadline_and_expired_tokens_are_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(b"HB").unwrap();
            std::thread::sleep(Duration::from_millis(600));
            let _ = stream.write_all(b"C");
        });
        let (mut stream, _) = listener.accept().unwrap();
        let deadline = Instant::now() + Duration::from_millis(300);
        read_before(&mut stream, &mut [0u8; 1], deadline).unwrap();
        let error = read_before(&mut stream, &mut [0u8; 2], deadline).unwrap_err();
        assert!(matches!(
            error.kind(),
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
        ));
        client.join().unwrap();
        let session = Some(super::super::Session {
            token: "new".into(),
            port: 0,
            received_at: None,
            report: None,
        });
        assert!(!current_session(&None, "old"));
        assert!(!current_session(&session, "old"));
        assert!(current_session(&session, "new"));
    }
    #[test]
    fn bundled_logo_is_served_over_the_actual_static_http_path() {
        let root = std::env::temp_dir().join(format!("claude-local-http-{}", nonce().unwrap()));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        let logo = include_bytes!("../../../assets/browser-logo.jpg");
        std::fs::write(root.join("assets/logo.jpg"), logo).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let folder = root.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            serve_resource(&mut stream, &folder, "assets/logo.jpg");
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .write_all(b"GET /test/assets/logo.jpg HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).unwrap();
        server.join().unwrap();
        let split = response.windows(4).position(|x| x == b"\r\n\r\n").unwrap() + 4;
        let header = String::from_utf8_lossy(&response[..split]);
        assert!(header.starts_with("HTTP/1.1 200 OK"));
        assert!(header.contains("Content-Type: image/jpeg"));
        assert!(header.contains("Referrer-Policy: no-referrer"));
        assert!(header.contains("X-Frame-Options: DENY"));
        assert!(header.contains("frame-ancestors 'none'"));
        assert_eq!(&response[split..], logo);
        assert!(resource(&root, "../outside").is_none());
        assert_eq!(media_type(Path::new("unknown.bin")), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_host_or_ambiguous_framing_is_rejected() {
        let stream_pair = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = stream_pair.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).unwrap();
            s.write_all(
                b"GET /test/context HTTP/1.1\r\nHost: localhost\r\nHost: 127.0.0.1\r\n\r\n",
            )
            .unwrap();
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        });
        let (mut server_stream, _) = stream_pair.accept().unwrap();
        answer(
            &mut server_stream,
            "400 Bad Request",
            "text/plain",
            b"Bad request",
        );
        drop(server_stream);
        let client_resp = client.join().unwrap();
        assert!(String::from_utf8_lossy(&client_resp).contains("400 Bad Request"));
    }
}
