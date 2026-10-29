// [INPUT]: Fresh private synthetic home/app-data directories, fictional CLI caches and quota anchors.
// [OUTPUT]: Fixed metadata allowlist and CLI /usage cache-to-revision-to-native-summary regressions.
// [POS]: No real home, credentials, identity store, process, browser, collector or network access.
// [PROTOCOL]: Update identities/CLAUDE.md when changing this test boundary.
use super::*;
use crate::identities::{private, profile};

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    app: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "claude-local-passive-quota-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let home = root.join("home");
        let app = root.join("app");
        for path in [&home, &app.join("identity-vault")] {
            private::directory(path).unwrap();
        }
        Self { root, home, app }
    }

    fn revision(&self) -> String {
        quota_revision(&self.app, &self.home).unwrap()
    }

    fn read(&self) -> profile::Current {
        profile::read_live(&self.home, &self.app.join("identity-vault"))
    }

    fn config(&self, value: &Value) {
        private::write(
            &self.home.join(".claude.json"),
            &serde_json::to_vec(value).unwrap(),
        )
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Remove only explicit synthetic paths; never recursively clean a home.
        for path in [
            self.home.join(".claude.json"),
            self.home.join(".claude/unwatched.json"),
            self.home.join(".claude/projects/unwatched.jsonl"),
            self.app.join("quota_ledger.json"),
            self.app.join("identity-vault/quota_web_metadata.json"),
            self.app.join("identity-vault/manual_subscriptions.json"),
        ] {
            let _ = fs::remove_file(path);
        }
        for path in [
            self.home.join(".claude/projects"),
            self.home.join(".claude"),
            self.app.join("identity-vault"),
            self.home.clone(),
            self.app.clone(),
            self.root.clone(),
        ] {
            let _ = fs::remove_dir(path);
        }
    }
}

fn cached(account: &str, observed: u64, used: u8, reset: u64) -> Value {
    json!({
        "oauthAccount": {"accountUuid": account, "emailAddress": "fixture@example.invalid",
            "organizationUuid": "fixture-org", "organizationName": "Fixture"},
        "cachedUsageUtilization": {"accountUuid": account, "fetchedAtMs": observed,
            "utilization": {"five_hour": {"utilization": used, "resets_at": reset}}}
    })
}

#[test]
fn passive_quota_revision_watches_only_fixed_files_without_parsing_contents() {
    let f = Fixture::new();
    let baseline = f.revision();
    private::write(&f.home.join(".claude.json"), b"invalid synthetic config").unwrap();
    let config_revision = f.revision();
    assert_ne!(baseline, config_revision);
    assert_eq!(config_revision, f.revision());

    private::directory(&f.home.join(".claude/projects")).unwrap();
    for relative in [".claude/unwatched.json", ".claude/projects/unwatched.jsonl"] {
        private::write(&f.home.join(relative), b"synthetic unobserved data").unwrap();
    }
    assert_eq!(config_revision, f.revision());

    private::write(&f.app.join("quota_ledger.json"), b"synthetic ledger").unwrap();
    let ledger_revision = f.revision();
    assert_ne!(config_revision, ledger_revision);
    private::write(
        &f.app.join("identity-vault/quota_web_metadata.json"),
        b"synthetic metadata",
    )
    .unwrap();
    let web_revision = f.revision();
    assert_ne!(ledger_revision, web_revision);
    private::write(
        &f.app.join("identity-vault/manual_subscriptions.json"),
        b"synthetic manual subscriptions",
    )
    .unwrap();
    assert_ne!(web_revision, f.revision());
}

#[test]
fn passive_quota_revision_usage_cache_reaches_native_read_without_cross_account_merge() {
    let f = Fixture::new();
    let now = now_ms() / 1000;
    let observed = (now - 60) * 1000;
    f.config(&cached("fixture-a", observed, 9, now + 3600));
    let initial = f.read();
    assert!(!initial.unavailable);
    assert_eq!(initial.quota_5h_used, Some(9));
    assert_eq!(initial.quota_7d_used, None);
    let identity_a = initial.quota_identity.clone().unwrap();

    // A newer anchor for B sharing A's email must not override A's /usage cache.
    f.config(&cached("fixture-b", observed, 33, now + 3600));
    let identity_b = f.read().quota_identity.unwrap();
    let ledger = json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": identity_b, "quota_5h_source": "server_anchor",
        "quota_5h_observed_at_ms": (now - 10) * 1000,
        "server_anchor": {"accountUuid": "fixture-b", "fetchedAtMs": (now - 10) * 1000,
            "utilization": {"five_hour": {"utilization": 98, "resets_at": now + 3600}}}
    }}});
    let ledger_bytes = serde_json::to_vec(&ledger).unwrap();
    private::write(&f.app.join("quota_ledger.json"), &ledger_bytes).unwrap();
    f.config(&cached("fixture-a", observed, 9, now + 3600));
    let baseline = f.revision();
    let updated_observed = (now - 20) * 1000;
    // Different digit count guarantees metadata length changes even on coarse clocks.
    f.config(&cached("fixture-a", updated_observed, 42, now + 3600));
    assert_ne!(baseline, f.revision());
    let updated = f.read();
    assert_eq!(updated.quota_identity.as_deref(), Some(identity_a.as_str()));
    assert_eq!(updated.quota_5h_used, Some(42));
    assert_eq!(
        updated.quota_5h_source,
        Some(profile::QuotaSource::ServerAnchor)
    );
    assert_eq!(updated.quota_5h_observed_at_ms, Some(updated_observed));
    assert_eq!(updated.quota_7d_used, None);
    assert_eq!(updated.quota_7d_source, Some(profile::QuotaSource::Unknown));
    assert_eq!(
        fs::read(f.app.join("quota_ledger.json")).unwrap(),
        ledger_bytes
    );

    let inferred_observed = (now - 900) * 1000;
    f.config(&cached("fixture-a", inferred_observed, 100, now - 1));
    let inferred = f.read();
    assert_eq!(
        inferred.quota_5h_source,
        Some(profile::QuotaSource::ResetInferred)
    );
    assert_eq!(inferred.quota_5h_reset_at, Some(now - 1));
    assert_eq!(inferred.quota_5h_observed_at_ms, Some(inferred_observed));
}
