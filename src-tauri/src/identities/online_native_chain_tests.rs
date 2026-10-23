// [INPUT]: Fresh synthetic private roots, staged public Python sources and a deterministic test transport.
// [OUTPUT]: Shared native command core -> runtime/resource resolution -> real grant/ledger -> native projection evidence.
// [POS]: cfg(test)-only integration fixture; the Tauri adapter and browser launch/WebView remain separately tested seams.
// [PROTOCOL]: No HOME/AppData resolution, external network, real accounts, process stopping or recursive cleanup.
use super::*;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicUsize;

struct Fixture {
    root: PathBuf,
    cleaner: Arc<crate::cleaner::Cleaner>,
    grants: AtomicUsize,
}

struct Door(Arc<crate::cleaner::Cleaner>);
impl Drop for Door {
    fn drop(&mut self) {
        self.0.leave();
    }
}

impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.local/native-chain-tests")
            .join(super::super::new_id().unwrap());
        fs::create_dir_all(root.parent().unwrap()).unwrap();
        assert!(super::super::private::create_new_directory(&root).unwrap());
        for relative in ["installed", "installed/scripts", "app-data", "app-data/identity-vault", "claude-home", "claude-home/.claude"] {
            super::super::private::directory(&root.join(relative)).unwrap();
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts");
        let installed = root.join("installed/scripts");
        for name in ["claude_quota.py", "quota_runtime.py", "quota_archive.py"] {
            fs::copy(source.join(name), installed.join(name)).unwrap();
        }
        fs::copy(source.join("claude_quota_online.py"), installed.join("quota_collector.py")).unwrap();
        fs::copy(source.join("quota-native-chain-fixture.py"), installed.join("claude_quota_online.py")).unwrap();
        let config = json!({"oauthAccount": {
            "accountUuid":"11111111-1111-4111-8111-111111111111",
            "emailAddress":"synthetic@example.invalid",
            "organizationUuid":"22222222-2222-4222-8222-222222222222"
        }});
        super::super::private::write(&root.join("claude-home/.claude.json"), &serde_json::to_vec(&config).unwrap()).unwrap();
        // Fixture-owned fictional credentials are created, never read from a workstation location.
        let credentials = json!({"claudeAiOauth": {
            "accessToken":"synthetic-native-chain-token", "expiresAt":now_ms()+3_600_000,
            "subscriptionType":"pro"
        }});
        super::super::private::write(&root.join("claude-home/.claude/.credentials.json"), &serde_json::to_vec(&credentials).unwrap()).unwrap();
        Self { root, cleaner: Arc::new(crate::cleaner::Cleaner::default()), grants: AtomicUsize::new(0) }
    }

    fn current(&self) -> super::super::profile::Current {
        let mut current = super::super::profile::read_live(
            &self.root.join("claude-home"), &self.root.join("app-data/identity-vault"));
        apply_metadata(&self.root.join("app-data/identity-vault"), current.quota_identity.as_deref(), &mut current.web);
        current
    }

    fn validate(&self, account: &str, identity: &str) -> Result<(), String> {
        if account == "current" && matches_identity(identity, self.current().quota_identity.as_deref()) {
            Ok(())
        } else {
            Err("quotaOnline.accountMismatch".into())
        }
    }
}

impl CollectorContext for Fixture {
    type Guard = Door;

    fn freeze(&self, account: &str, identity: &str) -> Result<u64, String> {
        self.cleaner.enter_quota()?;
        let _door = Door(self.cleaner.clone());
        self.validate(account, identity)?;
        Ok(self.cleaner.identity_epoch())
    }

    fn paths(&self) -> Result<(Option<PathBuf>, PathBuf, PathBuf), String> {
        Ok((installed_script(&self.root.join("installed")), self.root.join("app-data"), self.root.join("claude-home")))
    }

    fn grant(&self, request: &Value, task: Option<&QuotaTask>, epoch: u64, deadline: Instant) -> Result<Door, OnlineQuotaResult> {
        grant_door(&self.cleaner, task, epoch, deadline, || {
            self.validate(request["account_id"].as_str().unwrap_or(""), request["expected_identity"].as_str().unwrap_or(""))
        })?;
        self.grants.fetch_add(1, Ordering::SeqCst);
        Ok(Door(self.cleaner.clone()))
    }
}

#[test]
fn installed_python_native_receiver_ledger_and_projection_chain() {
    let fixture = Fixture::new();
    let identity = fixture.current().quota_identity.expect("native synthetic identity");
    let config_before = fs::read(fixture.root.join("claude-home/.claude.json")).unwrap();
    let result = collect_in(&fixture, json!({"account_id":"current", "expected_identity":identity})).unwrap();
    assert_eq!(result.status, OnlineStatus::Updated, "{}", serde_json::to_string(&result).unwrap());
    assert_eq!(result.source.as_deref(), Some("oauth"));
    assert_eq!(fixture.grants.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.current().quota_5h_used, Some(21));
    let calls = fs::read_to_string(fixture.root.join("installed/scripts/transport-calls.jsonl")).unwrap();
    let calls: Vec<Value> = calls.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["endpoint"], "https://api.anthropic.com/api/oauth/profile");
    assert_eq!(calls[1]["endpoint"], "https://api.anthropic.com/api/oauth/usage");

    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let token = "a".repeat(48);
    let nonce = "b".repeat(48);
    let observed = now_ms();
    let renewal = chrono::DateTime::from_timestamp((observed / 1000 + 86_400) as i64, 0).unwrap().to_rfc3339();
    let starts = chrono::DateTime::from_timestamp((observed / 1000 - 60) as i64, 0).unwrap().to_rfc3339();
    let ends = chrono::DateTime::from_timestamp((observed / 1000 + 7200) as i64, 0).unwrap().to_rfc3339();
    let callback = json!({"nonce":nonce,
        "account_uuid":"11111111-1111-4111-8111-111111111111",
        "organization_uuid":"22222222-2222-4222-8222-222222222222",
        "subscription_details":{"next_charge_date":renewal},
        "usage":{"five_hour":{"utilization":37,"resets_at":ends},
          "cedar_ember":{"eligible":true,"grants":[{"resets_left":2,"paused":false,"starts_at":starts,"ends_at":ends}]}}
    });
    let sender = std::thread::spawn(move || {
        let body = serde_json::to_vec(&callback).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(format!("POST /{token}/quota-sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n", body.len()).as_bytes()).unwrap();
        stream.write_all(&body).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
    });
    let snapshot = crate::browser::receive_for_test(listener, &"a".repeat(48), &nonce, Instant::now()+Duration::from_secs(5), &||false).unwrap();
    sender.join().unwrap();
    let result = collect_in(&fixture, json!({"account_id":"current", "expected_identity":identity, "browser_snapshot":snapshot})).unwrap();
    assert_eq!(result.status, OnlineStatus::Updated);
    assert_eq!(result.source.as_deref(), Some("browser"));
    assert_eq!(fixture.grants.load(Ordering::SeqCst), 2);
    let projection = fixture.current();
    assert_eq!(projection.quota_5h_used, Some(37));
    assert_eq!(projection.web.billing_date_kind.as_deref(), Some("next_renewal"));
    assert_eq!(projection.web.manual_resets_remaining, Some(2));
    assert!(projection.web.manual_resets_valid_until.unwrap() > now_ms()/1000);
    assert!(projection.web.billing_observed_at_ms.unwrap() >= observed);
    let ledger = fs::read(fixture.root.join("app-data/quota_ledger.json")).unwrap();
    assert!(collect_in(&fixture, json!({"account_id":"current", "expected_identity":"f".repeat(64)})).is_err());
    assert_eq!(fs::read(fixture.root.join("app-data/quota_ledger.json")).unwrap(), ledger);
    assert_eq!(fs::read(fixture.root.join("claude-home/.claude.json")).unwrap(), config_before);
    assert_eq!(fixture.grants.load(Ordering::SeqCst), 2);
    assert!(fixture.cleaner.enter_quota().is_ok());
    fixture.cleaner.leave();
    // Retain this uniquely named ignored fixture for inspection; no cleanup can touch another session.
}
