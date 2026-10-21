// [INPUT]: Temporary fictional quota ledgers and in-memory identity summaries only.
// [OUTPUT]: Observation-order, account/organization and return-visit regressions.
// [POS]: No real Claude home, credentials, processes, browser or network access.
// [PROTOCOL]: Update identities/CLAUDE.md when changing this test boundary.
use super::*;

fn identity(uuid: &str, org: &str) -> String {
    quota_identity(&serde_json::json!({"oauthAccount": {"accountUuid": uuid,
        "emailAddress": "fixture@example.invalid", "organizationUuid": org}}))
    .unwrap()
}

#[test]
fn quota_observation_order_survives_new_archive_and_return_visit() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": account_id, "quota_source": "server_anchor", "updated_at_sec": 2,
        "quota_5h_used": 100, "quota_5h_reset_at": 1000,
        "server_anchor": {"accountUuid": "a", "fetchedAtMs": 2000}
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();
    for (observed, expected) in [(1000, 100), (2000, 100), (3000, 10)] {
        let mut summary = Summary {
            email: Some("fixture@example.invalid".into()),
            quota_identity: Some(account_id.clone()),
            quota_observed_at_ms: Some(observed),
            quota_5h_used: Some(10),
            quota_5h_reset_at: Some(1000),
            ..Summary::default()
        };
        apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 90000, 100);
        assert_eq!(summary.quota_5h_used, Some(expected));
    }
    for foreign in [identity("b", "org-a"), identity("a", "org-b")] {
        let mut summary = Summary {
            email: Some("fixture@example.invalid".into()),
            quota_identity: Some(foreign),
            quota_5h_used: Some(10),
            ..Summary::default()
        };
        apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, 100);
        assert_eq!(summary.quota_5h_used, Some(10));
    }
    let mut next = ledger;
    next["accounts"]["fixture@example.invalid"]["quota_5h_used"] = 5.into();
    next["accounts"]["fixture@example.invalid"]["quota_5h_reset_at"] = 2000.into();
    next["accounts"]["fixture@example.invalid"]["server_anchor"]["fetchedAtMs"] = 3000.into();
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&next).unwrap(),
    )
    .unwrap();
    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_observed_at_ms: Some(2000),
        quota_5h_used: Some(100),
        quota_5h_reset_at: Some(1000),
        ..Summary::default()
    };
    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 90000, 100);
    assert_eq!(summary.quota_5h_used, Some(5));
    assert_eq!(summary.quota_5h_reset_at, Some(2000));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quota_identity_matches_python_canonical_digest() {
    assert_eq!(
        identity("a", "org-a"),
        "84c4ecdd68c4f613eeaf1d7b17895246dd2f2b26c641605761e8b8e5f2a7eec1"
    );
}

#[test]
fn quota_organization_slot_is_selected_without_overwriting_legacy_account() {
    let id = identity("a", "org-b");
    let mut ledger = serde_json::json!({"accounts": {
        "fixture@example.invalid": {"quota_identity": identity("a", "org-a"), "quota_5h_used": 100},
    }});
    ledger["accounts"][format!("fixture@example.invalid#{id}")] =
        serde_json::json!({"quota_identity": id, "quota_5h_used": 20});
    let selected = ledger_account(&ledger, "fixture@example.invalid", Some(&id)).unwrap();
    assert_eq!(selected["quota_5h_used"], 20);
    assert_eq!(
        ledger["accounts"]["fixture@example.invalid"]["quota_5h_used"],
        100
    );
}
