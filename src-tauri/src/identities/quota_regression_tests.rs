// [INPUT]: Temporary fictional quota ledgers and in-memory identity summaries only.
// [OUTPUT]: Observed-percentage bounds, observation-order, account/organization, expired reset inference and return-visit regressions.
// [POS]: No real Claude home, credentials, processes, browser or network access.
// [PROTOCOL]: Update identities/CLAUDE.md when changing this test boundary.
use super::*;

#[test]
fn invalid_cached_percentages_are_rejected_per_window() {
    let now = 1_800_000_000;
    for invalid in [now as f64, -1.0] {
        let cj = serde_json::json!({
            "oauthAccount": {"accountUuid": "a"},
            "cachedUsageUtilization": {
                "accountUuid": "a", "fetchedAtMs": 1_799_999_000_000u64,
                "utilization": {
                    "five_hour": {"utilization": invalid, "resets_at": now + 1000},
                    "seven_day": {"utilization": 42, "resets_at": now + 86400}
                }
            }
        });
        let extracted = extract_quota(&cj, None, Some("Pro"), now, 0);
        let mut summary = Summary::default();
        summary.quota_5h_used = extracted.used_5h;
        summary.quota_5h_reset_at = extracted.reset_5h;
        summary.quota_7d_used = extracted.used_7d;
        summary.quota_7d_reset_at = extracted.reset_7d;
        set_summary_quota_evidence(&cj, &extracted, now, &mut summary);

        assert_eq!(summary.quota_5h_source, Some(QuotaSource::Unknown));
        assert_eq!(summary.quota_5h_used, None);
        assert_eq!(summary.quota_7d_used, Some(42));
        assert_eq!(summary.quota_7d_source, Some(QuotaSource::ServerAnchor));
    }

    let cj = serde_json::json!({
        "oauthAccount": {"accountUuid": "a"},
        "cachedUsageUtilization": {
            "accountUuid": "a", "fetchedAtMs": 1_799_999_000_000u64,
            "utilization": {
                "five_hour": {"utilization": 42, "resets_at": now + 1000},
                "seven_day": {"utilization": now, "resets_at": now + 86400}
            }
        }
    });
    let extracted = extract_quota(&cj, None, Some("Pro"), now, 0);
    assert_eq!(extracted.used_7d, None);
    assert_eq!(
        window_source(
            &cj,
            "seven_day",
            extracted.used_7d,
            extracted.reset_7d,
            false,
            now
        ),
        Some(QuotaSource::Unknown)
    );
}

#[test]
fn cached_percentages_preserve_bounds_rounding_tolerance() {
    let now = 1_800_000_000;
    let cj = serde_json::json!({
        "oauthAccount": {"accountUuid": "a"},
        "cachedUsageUtilization": {
            "accountUuid": "a", "fetchedAtMs": 1_799_999_000_000u64,
            "utilization": {
                "five_hour": {"utilization": 100.7, "resets_at": now + 1000},
                "seven_day": {"utilization": 0, "resets_at": now + 86400}
            }
        }
    });
    let extracted = extract_quota(&cj, None, Some("Pro"), now, 0);
    assert_eq!(extracted.used_5h, Some(100));
    assert_eq!(extracted.used_7d, Some(0));
    assert_eq!(
        window_source(
            &cj,
            "five_hour",
            extracted.used_5h,
            extracted.reset_5h,
            false,
            now
        ),
        Some(QuotaSource::ServerAnchor)
    );
}

#[test]
fn ledger_anchor_and_reset_inference_reject_invalid_percentages_per_window() {
    let now = 1_800_000_000;
    let entry = serde_json::json!({
        "quota_5h_source": "server_anchor",
        "quota_7d_source": "server_anchor",
        "quota_5h_observed_at_ms": 1_799_999_000_000u64,
        "quota_7d_observed_at_ms": 1_799_999_000_000u64,
        "server_anchor": {
            "accountUuid": "a", "fetchedAtMs": 1_799_999_000_000u64,
            "utilization": {
                "five_hour": {"utilization": 1_800_000_000u64, "resets_at": now + 1000},
                "seven_day": {"utilization": 42, "resets_at": now + 86400}
            }
        }
    });
    assert_eq!(ledger_window_value(&entry, "five_hour", now), None);
    assert_eq!(
        ledger_window_value(&entry, "seven_day", now),
        Some((
            42,
            now + 86400,
            1_799_999_000_000,
            QuotaSource::ServerAnchor
        ))
    );

    let inferred = serde_json::json!({
        "server_anchor": {
            "accountUuid": "a", "fetchedAtMs": (now - 900) * 1000,
            "utilization": {
                "five_hour": {"utilization": -1, "resets_at": now - 1}
            }
        }
    });
    assert_eq!(
        ledger_reset_inferred_value(&inferred, "five_hour", now),
        None
    );
}

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

#[test]
fn expired_five_hour_window_does_not_manufacture_zero_or_discard_weekly_window() {
    let mut summary = Summary {
        quota_source: Some(QuotaSource::LocalEstimate),
        quota_5h_source: Some(QuotaSource::ServerAnchor),
        quota_7d_source: Some(QuotaSource::LocalEstimate),
        quota_5h_observed_at_ms: Some(99_000),
        quota_7d_observed_at_ms: Some(90_000),
        quota_5h_used: Some(100),
        quota_5h_reset_at: Some(100),
        quota_7d_used: Some(63),
        quota_7d_reset_at: Some(700_000),
        ..Summary::default()
    };

    summary.refresh_for_now(101);

    assert_eq!(summary.quota_5h_used, Some(0));
    assert_eq!(summary.quota_5h_reset_at, Some(100));
    assert_eq!(summary.quota_7d_used, Some(63));
    assert_eq!(summary.quota_7d_reset_at, Some(700_000));
    assert!(summary.quota_5h_source == Some(QuotaSource::ResetInferred));
    assert!(summary.quota_7d_source == Some(QuotaSource::LocalEstimate));
}

#[test]
fn expired_raw_five_hour_anchor_does_not_mark_valid_seven_day_anchor_unknown() {
    let now = 1_800_000_000;
    let cj = serde_json::json!({
        "oauthAccount": {"accountUuid": "a", "emailAddress": "fixture@example.invalid"},
        "cachedUsageUtilization": {
            "accountUuid": "a",
            "fetchedAtMs": 1_799_999_000_000u64,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": now - 1},
                "seven_day": {"utilization": 42, "resets_at": now + 86_400}
            }
        }
    });
    let result = extract_quota(&cj, None, Some("Pro"), now, 0);
    let mut summary = Summary::default();
    summary.quota_5h_used = result.used_5h;
    summary.quota_5h_reset_at = result.reset_5h;
    summary.quota_7d_used = result.used_7d;
    summary.quota_7d_reset_at = result.reset_7d;
    set_summary_quota_evidence(&cj, &result, now, &mut summary);

    assert_eq!(summary.quota_5h_used, Some(0));
    assert_eq!(summary.quota_5h_reset_at, Some(now - 1));
    assert!(summary.quota_5h_source == Some(QuotaSource::ResetInferred));
    assert_eq!(summary.quota_7d_used, Some(42));
    assert!(summary.quota_7d_source == Some(QuotaSource::ServerAnchor));
}

#[test]
fn expired_cached_anchor_becomes_inferred_zero_without_fabricating_reset_or_observation() {
    let now = 1_800_000_000;
    let observed = (now as u64 - 900) * 1000;
    let cj = serde_json::json!({
        "oauthAccount": {"accountUuid": "a", "emailAddress": "fixture@example.invalid"},
        "cachedUsageUtilization": {
            "accountUuid": "a",
            "fetchedAtMs": observed,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": now - 1},
                "seven_day": {"utilization": 72, "resets_at": now - 10}
            }
        }
    });
    let extracted = extract_quota(&cj, None, Some("Pro"), now, 0);
    let mut summary = Summary::default();
    set_summary_quota_evidence(&cj, &extracted, now, &mut summary);

    assert_eq!(summary.quota_5h_used, Some(0));
    assert_eq!(summary.quota_5h_reset_at, Some(now - 1));
    assert_eq!(summary.quota_5h_source, Some(QuotaSource::ResetInferred));
    assert_eq!(summary.quota_5h_observed_at_ms, Some(observed));
    assert_eq!(summary.quota_7d_used, Some(0));
    assert_eq!(summary.quota_7d_reset_at, Some(now - 10));
    assert_eq!(summary.quota_7d_source, Some(QuotaSource::ResetInferred));
    assert_eq!(summary.quota_7d_observed_at_ms, Some(observed));
}

#[test]
fn erased_expired_anchor_is_recovered_only_for_matching_identity_and_never_replaces_live_window() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-inferred-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let now = 1_800_000_001u64;
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": account_id,
        "quota_5h_source": "unknown",
        "quota_5h_used": null,
        "quota_5h_reset_at": null,
        "server_anchor": {
            "accountUuid": "a",
            "utilization": {"five_hour": {
                "utilization": 100,
                "resets_at": now - 1,
                "fetchedAtMs": (now - 900) * 1000
            }}
        }
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();

    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id.clone()),
        quota_5h_source: Some(QuotaSource::Unknown),
        ..Summary::default()
    };
    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, now);
    assert_eq!(summary.quota_5h_used, Some(0));
    assert_eq!(summary.quota_5h_reset_at, Some(now - 1));
    assert_eq!(summary.quota_5h_source, Some(QuotaSource::ResetInferred));
    assert_eq!(summary.quota_5h_observed_at_ms, Some((now - 900) * 1000));

    let mut writer_ledger = ledger.clone();
    let writer_entry = &mut writer_ledger["accounts"]["fixture@example.invalid"];
    writer_entry["quota_5h_source"] = Value::String("reset_inferred".into());
    writer_entry["quota_5h_used"] = Value::from(0);
    writer_entry["quota_5h_reset_at"] = Value::from(now - 1);
    writer_entry["quota_5h_observed_at_ms"] = Value::from((now - 900) * 1000);
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&writer_ledger).unwrap(),
    )
    .unwrap();
    let mut writer_summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(identity("a", "org-a")),
        quota_5h_source: Some(QuotaSource::Unknown),
        ..Summary::default()
    };
    apply_ledger_to_summary(&root.join("identity-vault"), &mut writer_summary, 0, now);
    assert_eq!(writer_summary.quota_5h_used, Some(0));
    assert_eq!(writer_summary.quota_5h_reset_at, Some(now - 1));
    assert_eq!(
        writer_summary.quota_5h_source,
        Some(QuotaSource::ResetInferred)
    );

    let mut foreign = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(identity("b", "org-a")),
        quota_5h_source: Some(QuotaSource::Unknown),
        ..Summary::default()
    };
    apply_ledger_to_summary(&root.join("identity-vault"), &mut foreign, 0, now);
    assert_eq!(foreign.quota_5h_source, Some(QuotaSource::Unknown));
    assert_eq!(foreign.quota_5h_used, None);

    let mut live = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_5h_source: Some(QuotaSource::ServerAnchor),
        quota_5h_observed_at_ms: Some((now as u64) * 1000),
        quota_5h_used: Some(15),
        quota_5h_reset_at: Some(now + 300),
        ..Summary::default()
    };
    apply_ledger_to_summary(&root.join("identity-vault"), &mut live, 0, now);
    assert_eq!(live.quota_5h_used, Some(15));
    assert_eq!(live.quota_5h_reset_at, Some(now + 300));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn incomplete_legacy_ledger_does_not_poison_trusted_summary() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-legacy-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_5h_used": 100,
        "quota_5h_reset_at": 1_800_000_000,
        "server_anchor": {
            "accountUuid": "a",
            "fetchedAtMs": 1_800_000_000_000u64,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": 1_800_003_000}
            }
        }
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();
    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_source: Some(QuotaSource::LocalEstimate),
        quota_observed_at_ms: Some(1_799_999_000_000),
        quota_5h_used: Some(40),
        quota_5h_reset_at: Some(1_800_003_000),
        quota_7d_used: Some(50),
        quota_7d_reset_at: Some(1_800_604_800),
        ..Summary::default()
    };

    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, 1_800_000_001);

    assert!(summary.quota_source == Some(QuotaSource::LocalEstimate));
    assert_eq!(summary.quota_5h_used, Some(40));
    assert_eq!(summary.quota_7d_used, Some(50));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_live_anchor_requires_matching_account_and_organization_and_merges_per_window() {
    let mut live = serde_json::json!({
        "oauthAccount": {
            "accountUuid": "a",
            "emailAddress": "fixture@example.invalid",
            "organizationUuid": "org-uuid-a",
            "organizationName": "Org A"
        },
        "cachedUsageUtilization": {
            "accountUuid": "a",
            "fetchedAtMs": 1000,
            "utilization": {
                "five_hour": {"utilization": 40, "resets_at": 1800003000},
                "seven_day": {"utilization": 50, "resets_at": 1800604800}
            }
        }
    });
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "organization": "Org A",
        "server_anchor_observed_windows": ["five_hour"],
        "server_anchor": {
            "accountUuid": "a",
            "fetchedAtMs": 2000,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": 1800003000, "fetchedAtMs": 2000}
            }
        }
    }}});

    merge_server_anchor(&mut live, &ledger);

    assert_eq!(
        live.pointer("/cachedUsageUtilization/utilization/five_hour/utilization")
            .and_then(Value::as_u64),
        Some(100)
    );
    assert_eq!(
        live.pointer("/cachedUsageUtilization/utilization/seven_day/utilization")
            .and_then(Value::as_u64),
        Some(50)
    );
    assert_eq!(
        live.pointer("/cachedUsageUtilization/utilization/five_hour/fetchedAtMs")
            .and_then(Value::as_u64),
        Some(2000)
    );
    assert_eq!(
        live.pointer("/cachedUsageUtilization/utilization/seven_day/fetchedAtMs")
            .and_then(Value::as_u64),
        Some(1000)
    );

    live["oauthAccount"]["organizationName"] = Value::String("Org B".into());
    let before = live["cachedUsageUtilization"].clone();
    merge_server_anchor(&mut live, &ledger);
    assert_eq!(live["cachedUsageUtilization"], before);

    live["oauthAccount"]["organizationName"] = Value::String("Org A".into());
    live["oauthAccount"]["organizationUuid"] = Value::String("org-uuid-b".into());
    live["cachedUsageUtilization"] = serde_json::json!({
        "accountUuid": "a",
        "fetchedAtMs": 1000,
        "utilization": {
            "five_hour": {"utilization": 40, "resets_at": 1800003000},
            "seven_day": {"utilization": 50, "resets_at": 1800604800}
        }
    });
    let before_conflict = live["cachedUsageUtilization"].clone();
    let mut conflicting_org = ledger;
    conflicting_org["accounts"]["fixture@example.invalid"]["organization_uuid"] =
        Value::String("org-uuid-a".into());
    merge_server_anchor(&mut live, &conflicting_org);
    assert_eq!(live["cachedUsageUtilization"], before_conflict);
}

#[test]
fn ledger_merges_windows_independently_and_preserves_same_window_exhaustion() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-windows-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": account_id,
        "quota_source": "unknown",
        "quota_5h_used": 100,
        "quota_5h_reset_at": 1800003000,
        "quota_5h_observed_at_ms": 2000,
        "quota_7d_used": 65,
        "quota_7d_reset_at": 1800604800,
        "quota_7d_observed_at_ms": 3000,
        "server_anchor": {
            "accountUuid": "a",
            "fetchedAtMs": 3000,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": 1800003000, "fetchedAtMs": 2000},
                "seven_day": {"utilization": 65, "resets_at": 1800604800, "fetchedAtMs": 3000}
            }
        }
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();
    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_5h_source: Some(QuotaSource::LocalEstimate),
        quota_7d_source: Some(QuotaSource::LocalEstimate),
        quota_5h_observed_at_ms: Some(1000),
        quota_7d_observed_at_ms: Some(1000),
        quota_5h_used: Some(80),
        quota_5h_reset_at: Some(1800003000),
        quota_7d_used: Some(20),
        quota_7d_reset_at: Some(1800604800),
        ..Summary::default()
    };

    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, 1_800_000_001);

    assert_eq!(summary.quota_5h_used, Some(100));
    assert_eq!(summary.quota_7d_used, Some(65));
    assert!(summary.quota_5h_source == Some(QuotaSource::ServerAnchor));
    assert!(summary.quota_7d_source == Some(QuotaSource::ServerAnchor));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_unknown_ledger_does_not_replace_newer_local_estimate() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-stale-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": account_id,
        "quota_source": "unknown",
        "quota_5h_used": 100,
        "quota_5h_reset_at": 1800003000,
        "quota_5h_observed_at_ms": 500,
        "server_anchor": {
            "accountUuid": "a",
            "fetchedAtMs": 500,
            "utilization": {
                "five_hour": {"utilization": 100, "resets_at": 1800003000, "fetchedAtMs": 500}
            }
        }
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();
    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_5h_source: Some(QuotaSource::LocalEstimate),
        quota_5h_observed_at_ms: Some(1000),
        quota_5h_used: Some(72),
        quota_5h_reset_at: Some(1800003000),
        ..Summary::default()
    };

    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, 1_800_000_001);

    assert_eq!(summary.quota_5h_used, Some(72));
    assert!(summary.quota_5h_source == Some(QuotaSource::LocalEstimate));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rolled_legacy_zero_is_not_recovered_from_an_expired_anchor_window() {
    let root = std::env::temp_dir().join(format!(
        "claude-local-quota-rolled-{}",
        super::super::new_id().unwrap()
    ));
    fs::create_dir_all(root.join("identity-vault")).unwrap();
    let account_id = identity("a", "org-a");
    let now = 1_800_000_001u64;
    let ledger = serde_json::json!({"accounts": {"fixture@example.invalid": {
        "quota_identity": account_id,
        "quota_source": "unknown",
        "quota_7d_used": 0,
        "quota_7d_reset_at": now + 6 * 86400,
        "server_anchor": {
            "accountUuid": "a",
            "fetchedAtMs": 1_800_000_000_000u64,
            "utilization": {
                "seven_day": {"utilization": 91, "resets_at": now - 1}
            }
        }
    }}});
    fs::write(
        root.join("quota_ledger.json"),
        serde_json::to_vec(&ledger).unwrap(),
    )
    .unwrap();
    let mut summary = Summary {
        email: Some("fixture@example.invalid".into()),
        quota_identity: Some(account_id),
        quota_7d_source: Some(QuotaSource::LocalEstimate),
        quota_7d_observed_at_ms: Some(1_800_000_000_000),
        quota_7d_used: Some(47),
        quota_7d_reset_at: Some(now + 86_400),
        ..Summary::default()
    };

    apply_ledger_to_summary(&root.join("identity-vault"), &mut summary, 0, now);

    assert_eq!(summary.quota_7d_used, Some(47));
    assert_eq!(summary.quota_7d_reset_at, Some(now + 86_400));
    assert!(summary.quota_7d_source == Some(QuotaSource::LocalEstimate));
    fs::remove_dir_all(root).unwrap();
}
