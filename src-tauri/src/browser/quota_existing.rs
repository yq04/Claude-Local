// [INPUT]: An explicit batch query or subscription sync, frozen account fingerprint and an isolated managed browser profile.
// [OUTPUT]: One bounded, extension-origin, account-bound live usage/subscription snapshot or specific bridge failure on an independent ephemeral loopback listener (250ms first-byte timeout & invalid/concurrent budget isolation against local 32-request DoS); acquires per-slot `SlotGate` and performs controlled reopen into `QuotaSync` when the running profile lacks the on-demand extension; `cfg(test)` exposes the receiver for synthetic native-chain tests; no cookies or browser data are read.
// [POS]: Independent per-request loopback bridge for unified quota reads and web subscription sync; never changes selected identity, global Browser.session, seed, profile or credentials.
// [PROTOCOL]: Only manual batches may use this bridge; update browser/CLAUDE.md with changes.
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

const ORIGIN: &str = "chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg";
const MAX_BODY: usize = 16_384;
const WAIT: Duration = Duration::from_secs(20);
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_millis(250);
const HEADER_BODY_TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_ACTIVE_CONNS: usize = 8;
const MAX_VALID_REQUESTS: usize = 32;
const MAX_INVALID_CONNS: usize = 256;

struct ActiveConnGuard(Arc<AtomicUsize>);
impl Drop for ActiveConnGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

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
    let first_byte_deadline = deadline.min(Instant::now() + FIRST_BYTE_TIMEOUT);
    loop {
        if cancelled() {
            return None;
        }
        let wait = first_byte_deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())?
            .min(Duration::from_millis(50));
        stream.set_read_timeout(Some(wait)).ok()?;
        match stream.read(&mut byte) {
            Ok(0) => return None,
            Ok(_) => {
                header.push(byte[0]);
                break;
            }
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
    }

    let request_deadline = deadline.min(Instant::now() + HEADER_BODY_TIMEOUT);
    while !header.ends_with(b"\r\n\r\n") && header.len() < 8192 {
        if cancelled() {
            return None;
        }
        let wait = request_deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())?
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

fn receive_with<T>(
    listener: TcpListener,
    token: &str,
    nonce: &str,
    deadline: Instant,
    max_wait: Duration,
    cancelled: &dyn Fn() -> bool,
    commit: impl FnOnce(super::quota_bridge::Snapshot) -> Result<T, String>,
) -> Result<T, String> {
    let _ = listener.set_nonblocking(true);
    let port = listener
        .local_addr()
        .map_err(|_| "quotaOnline.unavailable")?
        .port();
    let page = format!("/{token}/browser.html");
    let callback = format!("/{token}/quota-sync");
    let deadline = deadline.min(Instant::now() + max_wait);
    let active_conns = Arc::new(AtomicUsize::new(0));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let (tx, rx) =
        std::sync::mpsc::sync_channel::<Option<(Request, TcpStream)>>(MAX_ACTIVE_CONNS);
    let mut valid_requests = 0usize;
    let mut invalid_conns = 0usize;
    let mut commit_opt = Some(commit);

    macro_rules! handle_ready_request {
        ($item:expr) => {
            match $item {
                None => {
                    invalid_conns += 1;
                }
                Some((request, mut stream)) => {
                    valid_requests += 1;
                    if request.method == "GET" && request.path == page && request.origin.is_none() {
                        reply(
                            &mut stream,
                            "200 OK",
                            b"<!doctype html><title>Claude-Local quota sync</title>",
                            true,
                            false,
                        );
                    } else if request.path != callback || request.origin.as_deref() != Some(ORIGIN)
                    {
                        reply(&mut stream, "403 Forbidden", b"{}", false, false);
                    } else if request.method == "OPTIONS"
                        && request.requested_method.as_deref() == Some("POST")
                        && request.requested_headers.as_deref() == Some("content-type")
                    {
                        reply(&mut stream, "204 No Content", b"", false, true);
                    } else if request.method != "POST"
                        || request.content_type.as_deref() != Some("application/json")
                    {
                        reply(&mut stream, "400 Bad Request", b"{}", false, true);
                    } else {
                        match serde_json::from_slice::<super::quota_bridge::Incoming>(&request.body)
                        {
                            Err(_) => {
                                reply(&mut stream, "400 Bad Request", b"{}", false, true);
                            }
                            Ok(incoming) if incoming.nonce != nonce => {
                                reply(&mut stream, "403 Forbidden", b"{}", false, true);
                            }
                            Ok(incoming) => {
                                let observed = match std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                {
                                    Ok(d) => d.as_millis() as u64,
                                    Err(_) => {
                                        stop_flag.store(true, Ordering::Release);
                                        return Err("quotaOnline.unavailable".into());
                                    }
                                };
                                let snapshot = super::quota_bridge::snapshot(incoming, observed);
                                let Some(commit_fn) = commit_opt.take() else {
                                    stop_flag.store(true, Ordering::Release);
                                    return Err("quotaOnline.unavailable".into());
                                };
                                stop_flag.store(true, Ordering::Release);
                                match snapshot.and_then(commit_fn) {
                                    Ok(value) => {
                                        reply(&mut stream, "200 OK", b"{\"ok\":true}", false, true);
                                        return Ok(value);
                                    }
                                    Err(error) => {
                                        reply(
                                            &mut stream,
                                            "409 Conflict",
                                            b"{\"ok\":false}",
                                            false,
                                            true,
                                        );
                                        return Err(error);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    while Instant::now() < deadline
        && valid_requests < MAX_VALID_REQUESTS
        && invalid_conns < MAX_INVALID_CONNS
    {
        if cancelled() {
            stop_flag.store(true, Ordering::Release);
            return Err("quotaOnline.cancelled".into());
        }
        while let Ok(item) = rx.try_recv() {
            handle_ready_request!(item);
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                if active_conns
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                        (n < MAX_ACTIVE_CONNS).then_some(n + 1)
                    })
                    .is_err()
                {
                    drop(stream);
                    invalid_conns += 1;
                    continue;
                }
                let active_clone = Arc::clone(&active_conns);
                let stop_clone = Arc::clone(&stop_flag);
                let tx_clone = tx.clone();
                if std::thread::Builder::new()
                    .spawn(move || {
                        let _guard = ActiveConnGuard(active_clone);
                        let _ = stream.set_nonblocking(false);
                        let parsed = read_request(
                            &mut stream,
                            port,
                            deadline,
                            &|| stop_clone.load(Ordering::Acquire),
                        );
                        let _ = tx_clone.send(parsed.map(|req| (req, stream)));
                    })
                    .is_err()
                {
                    active_conns.fetch_sub(1, Ordering::AcqRel);
                    invalid_conns += 1;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                match rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(item) => {
                        handle_ready_request!(item);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            Err(_) => break,
        }
    }
    stop_flag.store(true, Ordering::Release);
    if cancelled() {
        Err("quotaOnline.cancelled".into())
    } else if Instant::now() >= deadline {
        Err("quotaOnline.deadlineExceeded".into())
    } else {
        Err("quotaOnline.unavailable".into())
    }
}

fn receive(
    listener: TcpListener,
    token: &str,
    nonce: &str,
    deadline: Instant,
    cancelled: &dyn Fn() -> bool,
) -> Result<Value, String> {
    receive_with(listener, token, nonce, deadline, WAIT, cancelled, |snapshot| {
        if snapshot.usage.is_some() {
            serde_json::to_value(snapshot).map_err(|_| "quotaOnline.unavailable".to_string())
        } else {
            Err("quotaOnline.browserNoQuotaUpdate".into())
        }
    })
}

pub(super) fn receive_subscription_sync(
    listener: TcpListener,
    token: &str,
    nonce: &str,
    max_wait: Duration,
    commit: impl FnOnce(super::quota_bridge::Snapshot) -> Result<(), String>,
) -> Result<(), String> {
    receive_with(
        listener,
        token,
        nonce,
        Instant::now() + max_wait,
        max_wait,
        &|| false,
        commit,
    )
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
    let listener = super::server::bind()?;
    let port = listener
        .local_addr()
        .map_err(|_| "quotaOnline.unavailable")?
        .port();
    let token = super::server::nonce()?;
    let nonce = super::server::nonce()?;
    let url = format!(
        "http://127.0.0.1:{port}/{token}/browser.html#quota-sync={nonce}&quota_identity={expected_identity}"
    );
    {
        let browser = app.state::<super::Browser>();
        let slot_gate = browser.slot_gate(&slot);
        let _slot_guard = slot_gate.lock();

        let scope = super::workspaces::slot_path(&root, &slot)?;
        let profile = scope.join("profile");
        super::profile::check_path(&root, &profile)?;
        if !super::profile::running_uncached(&profile)? {
            return Err("quotaOnline.browserProfileNotRunning".into());
        }
        let config =
            super::load_config_ensured_seed(&root, &scope, Some(&slot)).map_err(|_| "quotaOnline.unavailable")?;
        let machine = super::config::machine().map_err(|_| "quotaOnline.unavailable")?;
        config
            .validate(&machine)
            .map_err(|_| "quotaOnline.unavailable")?;

        let options =
            super::config::LaunchOptions::for_purpose(super::config::LaunchPurpose::QuotaSync);
        let desired =
            super::LaunchRuntimeSnapshot::from_config_with_options(&config, &machine, options);
        let prev = browser.read_launched_config(&scope, &slot);
        let needs_reopen = prev.as_ref().is_none_or(|p| p != &desired);
        let ks_triggered = super::kill_switch::is_triggered(app);
        if ks_triggered {
            super::kill_switch::ensure_launch_route_healthy_when_triggered(app, Some(&slot), &config, &machine)?;
        }
        super::config::preflight_browser_launch_policy(&config, &machine, needs_reopen)?;

        let engine = super::engine(app)?;
        let binary = super::binary(&engine);
        if !binary.is_file() {
            return Err("quotaOnline.unavailable".into());
        }

        let launch_args = if needs_reopen {
            super::profile::quit(&profile)?;
            browser.clear_launched_config(&scope, &slot);
            super::launch::prepare_slot_singleton_for_launch(&root, &profile)?;
            super::profile::preferences(&profile, &config, &machine)?;
            super::config::arguments_with_options(
                &config,
                &machine,
                &profile,
                &url,
                &super::version(&engine),
                options,
            )
        } else {
            super::quota_connection::build_hot_forward_args(&profile, &url)
        };

        super::profile::invalidate_running_memo(&profile);
        let mut command = Command::new(binary);
        command
            .args(&launch_args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "quotaOnline.unavailable")?;
        if needs_reopen {
            super::launch::wait_scope_launch_ready(&profile, &mut child)?;
            browser.record_launched_config(&scope, &slot, &desired);
        }
        super::kill_switch::on_managed_browser_spawned(app, true);
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
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

    #[test]
    fn receiver_preserves_allowlisted_extension_failure_for_the_retry_queue() {
        let listener = super::super::server::bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(48);
        let nonce = "b".repeat(48);
        let body = serde_json::json!({"nonce":nonce,"failure":"request_timeout"}).to_string();
        let sender = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(stream, "POST /{token}/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 409 Conflict"));
        });
        let result = receive(listener, &"a".repeat(48), &"b".repeat(48), Instant::now() + Duration::from_secs(2), &|| false);
        sender.join().unwrap();
        assert_eq!(result.unwrap_err(), "quotaOnline.browserRequestTimeout");
    }

    #[test]
    fn loopback_receiver_survives_40_slow_or_empty_connections_without_32_request_dos() {
        let listener = super::super::server::bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(48);
        let nonce = "b".repeat(48);

        let token_c = token.clone();
        let nonce_c = nonce.clone();
        let attacker_and_ext = std::thread::spawn(move || {
            // 1. Flood 40 empty/slow TCP connections (more than old 32-request limit) without sending HTTP data.
            let mut held_sockets = Vec::new();
            for i in 0..40 {
                if let Ok(stream) = TcpStream::connect(("127.0.0.1", port)) {
                    if i % 2 == 0 {
                        // Immediate close
                        drop(stream);
                    } else {
                        // Slowloris: hold silent connection open
                        held_sockets.push(stream);
                    }
                }
            }
            // Wait slightly past 250ms first-byte timeout so silent sockets drain cleanly.
            std::thread::sleep(Duration::from_millis(320));
            drop(held_sockets);

            // 2. Now send legitimate extension POST /{token}/quota-sync; it MUST succeed!
            let body = serde_json::json!({"nonce": nonce_c, "failure": "usage_unavailable"}).to_string();
            let mut valid = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(
                valid,
                "POST /{token_c}/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            let mut resp = String::new();
            let _ = valid.read_to_string(&mut resp);
            assert!(resp.starts_with("HTTP/1.1 409 Conflict"));
        });

        let started = Instant::now();
        let result = receive(
            listener,
            &token,
            &nonce,
            Instant::now() + Duration::from_secs(3),
            &|| false,
        );
        attacker_and_ext.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(result.unwrap_err(), "quotaOnline.browserUsageUnavailable");
    }
}
