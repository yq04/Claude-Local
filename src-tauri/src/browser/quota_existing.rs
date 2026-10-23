// [INPUT]: An explicit batch query, frozen account fingerprint and an already running managed browser profile.
// [OUTPUT]: One bounded, extension-origin, account-bound live usage snapshot with cooperative cancellation; cfg(test) also exposes the receiver for synthetic native-chain tests; no cookies or browser data are read.
// [POS]: Browser fallback for unified quota reads; 20-second receiver deadline plus caller deadline/cancel signal; never changes selected identity, seed, profile or credentials.
// [PROTOCOL]: Only manual batches may use this bridge; update browser/CLAUDE.md with changes.
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const ORIGIN: &str = "chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg";
const MAX_BODY: usize = 16_384;
const WAIT: Duration = Duration::from_secs(20);

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    content_type: Option<String>,
    requested_method: Option<String>,
    requested_headers: Option<String>,
    body: Vec<u8>,
}

fn read_request(
    stream: &mut TcpStream,
    port: u16,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Option<Request> {
    let mut header = Vec::new();
    let mut byte = [0u8; 1];
    let request_deadline = deadline.min(Instant::now() + Duration::from_secs(3));
    while !header.ends_with(b"\r\n\r\n") && header.len() < 8192 {
        if cancelled() {
            return None;
        }
        let wait = request_deadline
            .checked_duration_since(Instant::now())?
            .min(Duration::from_millis(250));
        stream.set_read_timeout(Some(wait)).ok()?;
        match stream.read(&mut byte) {
            Ok(0) => return None,
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(_) => return None,
        }
        header.push(byte[0]);
    }
    if !header.ends_with(b"\r\n\r\n") {
        return None;
    }
    let text = std::str::from_utf8(&header).ok()?;
    let mut lines = text.lines();
    let first: Vec<_> = lines.next()?.split_whitespace().collect();
    if first.len() != 3 || first[2] != "HTTP/1.1" {
        return None;
    }
    let mut host_count = 0;
    let mut host_valid = false;
    let mut length = None;
    let mut request = Request {
        method: first[0].into(),
        path: first[1].into(),
        origin: None,
        content_type: None,
        requested_method: None,
        requested_headers: None,
        body: vec![],
    };
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':')?;
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "host" => {
                host_count += 1;
                host_valid = value == format!("127.0.0.1:{port}");
            }
            "origin" => {
                if request.origin.is_some() {
                    return None;
                }
                request.origin = Some(value.into());
            }
            "content-length" => {
                if length.is_some() {
                    return None;
                }
                length = Some(value.parse::<usize>().ok()?);
            }
            "content-type" => {
                if request.content_type.is_some() {
                    return None;
                }
                request.content_type = Some(value.to_ascii_lowercase());
            }
            "access-control-request-method" => request.requested_method = Some(value.into()),
            "access-control-request-headers" => {
                request.requested_headers = Some(value.to_ascii_lowercase())
            }
            "transfer-encoding" => return None,
            _ => {}
        }
    }
    if host_count != 1 || !host_valid || length.is_some_and(|n| n > MAX_BODY) {
        return None;
    }
    if request.method == "POST" && length.unwrap_or(0) == 0 {
        return None;
    }
    let size = length.unwrap_or(0);
    request.body.resize(size, 0);
    let mut offset = 0;
    while offset < size {
        if cancelled() {
            return None;
        }
        let wait = request_deadline
            .checked_duration_since(Instant::now())?
            .min(Duration::from_millis(250));
        stream.set_read_timeout(Some(wait)).ok()?;
        let count = match stream.read(&mut request.body[offset..]) {
            Ok(count) => count,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(_) => return None,
        };
        if count == 0 {
            return None;
        }
        offset += count;
    }
    Some(request)
}

fn reply(stream: &mut TcpStream, code: &str, body: &[u8], html: bool, cors: bool) {
    let kind = if html {
        "text/html; charset=utf-8"
    } else {
        "application/json"
    };
    let extra = if cors {
        format!("Access-Control-Allow-Origin: {ORIGIN}\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nVary: Origin\r\n")
    } else {
        String::new()
    };
    let head = format!("HTTP/1.1 {code}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\n{extra}\r\n", body.len());
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn receive(
    listener: TcpListener,
    token: &str,
    nonce: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value, String> {
    let port = listener
        .local_addr()
        .map_err(|_| "quotaOnline.unavailable")?
        .port();
    let page = format!("/{token}/browser.html");
    let callback = format!("/{token}/quota-sync");
    let deadline = deadline.min(Instant::now() + WAIT);
    let mut requests = 0;
    while Instant::now() < deadline && requests < 32 {
        if cancelled() {
            return Err("quotaOnline.cancelled".into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            Err(_) => break,
        };
        requests += 1;
        let Some(request) = read_request(&mut stream, port, deadline, cancelled) else {
            continue;
        };
        if request.method == "GET" && request.path == page && request.origin.is_none() {
            reply(
                &mut stream,
                "200 OK",
                b"<!doctype html><title>Claude-Local quota sync</title>",
                true,
                false,
            );
            continue;
        }
        if request.path != callback || request.origin.as_deref() != Some(ORIGIN) {
            reply(&mut stream, "403 Forbidden", b"{}", false, false);
            continue;
        }
        if request.method == "OPTIONS"
            && request.requested_method.as_deref() == Some("POST")
            && request.requested_headers.as_deref() == Some("content-type")
        {
            reply(&mut stream, "204 No Content", b"", false, true);
            continue;
        }
        if request.method != "POST" || request.content_type.as_deref() != Some("application/json") {
            reply(&mut stream, "400 Bad Request", b"{}", false, true);
            continue;
        }
        let incoming: super::quota_bridge::Incoming = match serde_json::from_slice(&request.body) {
            Ok(value) => value,
            Err(_) => {
                reply(&mut stream, "400 Bad Request", b"{}", false, true);
                continue;
            }
        };
        if incoming.nonce != nonce {
            reply(&mut stream, "403 Forbidden", b"{}", false, true);
            continue;
        }
        let observed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "quotaOnline.unavailable")?
            .as_millis() as u64;
        let snapshot = super::quota_bridge::snapshot(incoming, observed);
        match snapshot {
            Ok(snapshot) if snapshot.usage.is_some() => {
                let value =
                    serde_json::to_value(snapshot).map_err(|_| "quotaOnline.unavailable")?;
                reply(&mut stream, "200 OK", b"{\"ok\":true}", false, true);
                return Ok(value);
            }
            _ => {
                reply(&mut stream, "409 Conflict", b"{\"ok\":false}", false, true);
                return Err("quotaOnline.unavailable".into());
            }
        }
    }
    if cancelled() {
        Err("quotaOnline.cancelled".into())
    } else if Instant::now() >= deadline {
        Err("quotaOnline.deadlineExceeded".into())
    } else {
        Err("quotaOnline.unavailable".into())
    }
}

#[cfg(test)]
pub(crate) fn receive_for_test(
    listener: TcpListener,
    token: &str,
    nonce: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value, String> {
    receive(listener, token, nonce, deadline, cancelled)
}

/// The caller holds the identity transaction lock for the whole batch. Each
/// query gets an independent loopback endpoint rather than changing Browser's
/// global session or the selected profile. Python revalidates account and org.
pub(crate) fn query_existing_profile(
    app: &tauri::AppHandle,
    account_id: &str,
    expected_identity: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value, String> {
    if expected_identity.len() != 64 || !expected_identity.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("quotaOnline.accountMismatch".into());
    }
    let root = super::root(app)?;
    super::workspaces::ready(&root)?;
    let db = super::workspaces::database(&root)?;
    if !db.browser_link()?.enabled {
        return Err("quotaOnline.unavailable".into());
    }
    let id = if account_id == "current" {
        let (id, fingerprint) = crate::identities::online::current_browser_binding(app)?;
        if fingerprint != expected_identity {
            return Err("quotaOnline.accountMismatch".into());
        }
        id
    } else {
        account_id.to_owned()
    };
    let slot = db.browser_for(&id)?.ok_or("quotaOnline.unavailable")?;
    let scope = super::workspaces::slot_path(&root, &slot)?;
    let profile = scope.join("profile");
    super::profile::check_path(&root, &profile)?;
    if !super::profile::running(&profile)? {
        return Err("quotaOnline.unavailable".into());
    }
    let listener = super::server::bind()?;
    let port = listener
        .local_addr()
        .map_err(|_| "quotaOnline.unavailable")?
        .port();
    let token = super::server::nonce()?;
    let nonce = super::server::nonce()?;
    let url = format!("http://127.0.0.1:{port}/{token}/browser.html#quota-sync={nonce}&quota_identity={expected_identity}");
    let engine = super::engine(app)?;
    let mut command = Command::new(super::binary(&engine));
    command
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--profile-directory=Default")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "quotaOnline.unavailable")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    receive(listener, &token, &nonce, deadline, cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_loopback_parser_rejects_wrong_host_origin_duplicates_and_transfer_encoding() {
        fn parse(raw: &str) -> Option<Request> {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let bytes = raw.replace("{port}", &port.to_string()).into_bytes();
            let writer = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                stream.write_all(&bytes).unwrap();
            });
            let (mut stream, _) = listener.accept().unwrap();
            let result = read_request(
                &mut stream,
                port,
                Instant::now() + Duration::from_secs(2),
                &|| false,
            );
            writer.join().unwrap();
            result
        }
        assert!(parse("GET /a/browser.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").is_some());
        assert!(parse(
            "POST /a/quota-sync HTTP/1.1\r\nHost: attacker.invalid\r\nContent-Length: 2\r\n\r\n{}"
        )
        .is_none());
        assert!(parse("POST /a/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}").is_none());
        assert!(parse(&format!(
            "POST /a/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{{port}}\r\nContent-Length: {}\r\n\r\n",
            MAX_BODY + 1
        ))
        .is_none());
        assert!(parse("POST /a/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nTransfer-Encoding: chunked\r\n\r\n").is_none());
        assert!(parse("POST /a/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: a\r\nOrigin: b\r\nContent-Length: 2\r\n\r\n{}").is_none());
    }

    #[test]
    fn receiver_observes_cooperative_cancellation_and_deadline() {
        let listener = super::super::server::bind().unwrap();
        let cancelled_at = Instant::now() + Duration::from_millis(40);
        let result = receive(
            listener,
            &"a".repeat(48),
            &"b".repeat(48),
            Instant::now() + Duration::from_secs(1),
            &|| Instant::now() >= cancelled_at,
        );
        assert_eq!(result.unwrap_err(), "quotaOnline.cancelled");

        let listener = super::super::server::bind().unwrap();
        let result = receive(
            listener,
            &"a".repeat(48),
            &"b".repeat(48),
            Instant::now() + Duration::from_millis(20),
            &|| false,
        );
        assert_eq!(result.unwrap_err(), "quotaOnline.deadlineExceeded");
    }
}
