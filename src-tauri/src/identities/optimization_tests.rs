// [INPUT]: 虚构 UUID/组织/凭据、隔离文件系统和归档格式。
// [OUTPUT]: A/B 往返去重、原始会话保留、窄缓存维护、旧68键归档只读兼容与设备/客户端写回保护、显式MCP/项目映射策略、刷新凭据覆盖及故障回归。
// [POS]: 账号匹配、读/保存工作区无副作用与不可变归档代次的离线证明，不读取真实用户数据。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
#[cfg(windows)]
use dunce::canonicalize;
#[cfg(not(windows))]
use std::fs::canonicalize;
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::Instant,
};
struct Fixture {
    root: PathBuf,
    home: PathBuf,
    vault: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("baga-opt-{}", new_id().unwrap()));
        let home = root.join("home");
        private::directory(&home.join(".claude")).unwrap();
        Self {
            vault: root.join("vault"),
            root,
            home,
        }
    }
    fn write(&self, path: &str, text: &[u8]) {
        let path = self.home.join(path);
        private::directory(path.parent().unwrap()).unwrap();
        private::write(&path, text).unwrap();
    }
    fn login(&self, id: &str, org: &str, token: &str) {
        self.write(".claude.json", serde_json::to_string(&serde_json::json!({"oauthAccount":{"accountUuid":id,"organizationUuid":org,"emailAddress":format!("{id}@example.invalid"),"displayName":id}})).unwrap().as_bytes());
        self.write(
            ".claude/.credentials.json",
            serde_json::to_string(&serde_json::json!({"claudeAiOauth":{"accessToken":token}}))
                .unwrap()
                .as_bytes(),
        );
    }
    fn token(&self) -> String {
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(self.home.join(".claude/.credentials.json")).unwrap())
                .unwrap();
        value["claudeAiOauth"]["accessToken"]
            .as_str()
            .unwrap()
            .into()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
#[test]
fn s13_legacy_68_key_archive_reads_without_restoring_device_or_ui_state() {
    let legacy_keys = "userID machineID anonymousId oauthAccount primaryApiKey additionalModelCostsCache additionalModelOptionsAnsweredAt additionalModelOptionsCache agentLastUsed announcementImpressions autoCompactWindowsCache cachedArtifactRoster cachedChromeExtensionInstalled cachedDynamicConfigs cachedExperimentData cachedExperimentFeatures cachedExtraUsageDisabledReason cachedGrowthBookFeatures cachedGrowthBookFeaturesAt cachedStatsigGates cachedUsageUtilization changelogLastFetched claudeAiMcpEverConnected claudeCodeFirstTokenDate clientDataCache clientDataCacheSlots closedIssuesLastChecked customApiKeyResponses feedbackSurveyState firstStartTime firstStartVersion githubWebConnectionStatusCache groveConfigCache hasAvailableSubscription hasCompletedOnboarding hasOpenedAgentsView hasResetAutoModeOptInForDefaultOffer hasSeenAutoDefaultNotice hasSeenAutoModeOutsideReadPrompt lastClawdEntranceVersion lastOnboardingVersion lastPlanModeUse lastReleaseNotesSeen metricsStatusCache metricsStatusCacheByPrincipal migrationVersion modelAccessCache numStartups officialMarketplaceAutoInstallAttempted officialMarketplaceAutoInstalled opusProMigrationComplete orgModelDefaultCache passesEligibilityCache pluginUsage pluginUsageLspGraceAppliedIds promptQueueUseCount remoteControlMachineId remoteControlUpsellSeenCount s1mAccessCache seenNotifications skillUsage sonnet1m45MigrationComplete subscriptionNoticeCount summonSidKey tipLifetimeShownCounts tipsHistory tipsHistoryByCommand transcriptShareDismissed";
    let keys: Vec<String> = legacy_keys.split_whitespace().map(str::to_string).collect();
    assert_eq!(keys.len(), 68);
    for keep_settings in [true, false] {
        let f = Fixture::new();
        let r = Reporter::channel(None);
        let p = Policy {
            settings: keep_settings,
            ..Policy::default()
        };
        let mut s = store::Store::open(&f.vault, &f.home).unwrap();
        f.login("A", "org-a", "fictional-a-login");
        let (mut record, mut stage) = s.save_checkpoint("legacy-a", &p, &r).unwrap();
        let slot = stage
            .manifest
            .sources
            .iter()
            .position(|source| source.path == f.home.join(".claude.json"))
            .unwrap();
        stage.manifest.sources[slot].keys = keys.clone();
        let mut old = serde_json::Map::new();
        for key in &keys {
            old.insert(key.clone(), serde_json::json!("old-device-or-client-state"));
        }
        old.insert("oauthAccount".into(), serde_json::json!({"accountUuid":"A", "organizationUuid":"org-a", "emailAddress":"A@example.invalid"}));
        fs::write(
            stage.path.join(format!("data/{slot}")),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let device_slot = stage.manifest.sources.len();
        stage
            .manifest
            .sources
            .push(crate::cleaner::identity::Source {
                path: f.home.join(".claude/.machine-id"),
                category: "account".into(),
                keys: Vec::new(),
            });
        stage.manifest.fingerprints.push(Vec::new());
        fs::write(
            stage.path.join(format!("data/{device_slot}")),
            b"old-device-file",
        )
        .unwrap();
        record.archive = format!("{}.baga", new_id().unwrap());
        let seal = codec::Seal::new(
            private::create(&f.vault.join(&record.archive)).unwrap(),
            &s.key,
        )
        .unwrap();
        let mut tar = tar::Builder::new(compression::encode(seal).unwrap());
        let bytes = serde_json::to_vec(&stage.manifest).unwrap();
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o600);
        header.set_cksum();
        tar.append_data(&mut header, "manifest.json", &bytes[..])
            .unwrap();
        for item in fs::read_dir(stage.path.join("data")).unwrap() {
            let item = item.unwrap();
            let name = std::path::Path::new("data").join(item.file_name());
            if item.path().is_dir() {
                tar.append_dir_all(name, item.path()).unwrap();
            } else {
                tar.append_path_with_name(item.path(), name).unwrap();
            }
        }
        tar.into_inner()
            .unwrap()
            .finish()
            .unwrap()
            .finish()
            .unwrap()
            .sync_all()
            .unwrap();
        s.db.remember(&record).unwrap();
        drop(stage);
        let verified = s
            .load(&record)
            .expect("legacy 68-key manifest must remain readable");
        assert_eq!(verified.manifest.sources[slot].keys.len(), 68);
        drop(verified);
        f.login("B", "org-b", "fictional-b-login");
        let stable = serde_json::json!({"userID":"current-user", "machineID":"current-machine", "anonymousId":"current-anonymous", "remoteControlMachineId":"current-remote", "tipsHistory":{"current":1}, "cachedExperimentData":{"current":true}, "numStartups":72});
        let mut current: serde_json::Value =
            serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
        current
            .as_object_mut()
            .unwrap()
            .extend(stable.as_object().unwrap().clone());
        f.write(".claude.json", &serde_json::to_vec(&current).unwrap());
        f.write(".claude/.machine-id", b"current-device-file");
        s.switch(&record.id, "B", &p, &r).unwrap();
        let restored: serde_json::Value =
            serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
        for (key, expected) in stable.as_object().unwrap() {
            assert_eq!(
                restored.get(key),
                Some(expected),
                "preserve {key}, settings={keep_settings}"
            );
        }
        assert_eq!(restored["oauthAccount"]["accountUuid"], "A");
        assert_eq!(f.token(), "fictional-a-login");
        assert_eq!(
            fs::read(f.home.join(".claude/.machine-id")).unwrap(),
            b"current-device-file"
        );
    }
}

#[test]
fn s13_device_projection_preserves_explicit_mcp_and_project_mapping_policy() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let p = Policy {
        settings: false,
        mcp: false,
        projects: false,
        ..Policy::default()
    };
    let s = store::Store::open(&f.vault, &f.home).unwrap();
    f.login("A", "org-a", "fictional-login");
    let mut config: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    config["userID"] = "keep-device".into();
    config["tipsHistory"] = serde_json::json!({"keep":1});
    config["mcpServers"] = serde_json::json!({"move":{}});
    config["projects"] = serde_json::json!({"move":{}});
    config["githubRepoPaths"] = serde_json::json!({"move":["repo"]});
    f.write(".claude.json", &serde_json::to_vec(&config).unwrap());
    f.write(
        ".claude/settings.json",
        br#"{"model":"move-with-settings"}"#,
    );
    let (_, stage) = s.save_checkpoint("A", &p, &r).unwrap();
    let selected = store::Store::selected(&stage, &p);
    let source = selected
        .iter()
        .find(|(_, source)| source.path == f.home.join(".claude.json"))
        .unwrap();
    for key in ["oauthAccount", "mcpServers", "projects", "githubRepoPaths"] {
        assert!(source.1.keys.iter().any(|k| k == key));
    }
    for key in ["userID", "tipsHistory"] {
        assert!(!source.1.keys.iter().any(|k| k == key));
    }
    assert!(selected.iter().any(
        |(_, source)| source.path == f.home.join(".claude/settings.json") && source.keys.is_empty()
    ));
}

#[test]
fn repeated_accounts_update_one_slot_and_keep_latest_tokens_and_history() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let p = Policy::default();
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    s.db.configure_browser(true, false, None).unwrap();
    let initial_browser = s.db.browser_slot().unwrap();
    f.login("A", "one", "a-first");
    f.write(".claude/history.jsonl", b"a-history");
    s.switch("empty", "A custom", &p, &r).unwrap();
    let a = s.records()[0].id.clone();
    assert_eq!(a, initial_browser);
    assert_eq!(
        s.db.browser_for(&a).unwrap().as_deref(),
        Some(initial_browser.as_str())
    );
    let browser_b = s.db.browser_slot().unwrap();
    assert_ne!(browser_b, initial_browser);
    f.login("B", "one", "b-first");
    f.write(".claude/history.jsonl", b"b-history");
    s.switch(&a, "B custom", &p, &r).unwrap();
    let b = s.records().into_iter().find(|row| row.id != a).unwrap().id;
    assert_eq!(f.token(), "a-first");
    for n in 0..4 {
        f.login("A", "one", &format!("a-refresh-{n}"));
        f.write(".claude/history.jsonl", format!("a-new-{n}").as_bytes());
        assert_eq!(
            catalog::current_id(&f.vault, &f.home, &s.db)
                .unwrap()
                .as_deref(),
            Some(a.as_str())
        );
        s.switch(&b, "name changed", &p, &r).unwrap();
        assert_eq!(
            f.token(),
            if n == 0 {
                "b-first".into()
            } else {
                format!("b-refresh-{}", n - 1)
            }
        );
        f.login("B", "one", &format!("b-refresh-{n}"));
        s.switch(&a, "another name", &p, &r).unwrap();
        assert_eq!(f.token(), format!("a-refresh-{n}"));
        assert_eq!(
            fs::read(f.home.join(".claude/history.jsonl")).unwrap(),
            format!("a-new-{n}").as_bytes()
        );
        assert_eq!(s.records().len(), 2);
        assert_eq!(s.db.browser_slot().unwrap(), initial_browser);
        assert_eq!(
            s.db.browser_for(&b).unwrap().as_deref(),
            Some(browser_b.as_str())
        );
    }
    assert_eq!(
        s.records().iter().find(|row| row.id == a).unwrap().name,
        "A custom"
    );
    // 已经是 A 时不允许用旧 A 快照覆盖当前新令牌。
    f.login("A", "one", "a-live");
    s.switch(&a, "same", &p, &r).unwrap();
    assert_eq!(f.token(), "a-live");
    s.fail_after_clear = true;
    assert!(s.switch(&b, "failure", &p, &r).is_err());
    assert_eq!(f.token(), "a-live");
    assert_eq!(s.records().len(), 2);
    assert!(s.db.get("recovery").unwrap().is_none());
    drop(s);
    let s = store::Store::open(&f.vault, &f.home).unwrap();
    let generations = fs::read_dir(&f.vault)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|e| e == "baga"))
        .count();
    assert_eq!(generations, s.records().len());
}
#[test]
fn matching_is_private_stable_and_never_collapses_unknown_or_other_organizations() {
    let key = [8; 32];
    let a = serde_json::json!({"oauthAccount":{"accountUuid":"A","organizationUuid":"one","emailAddress":"old@example.invalid"}});
    let renamed = serde_json::json!({"oauthAccount":{"accountUuid":"A","organizationUuid":"one","emailAddress":"new@example.invalid","displayName":"changed"}});
    assert_eq!(
        catalog::account_key(&a, &key),
        catalog::account_key(&renamed, &key)
    );
    let mut other = a.clone();
    other["oauthAccount"]["organizationUuid"] = "two".into();
    assert_ne!(
        catalog::account_key(&a, &key),
        catalog::account_key(&other, &key)
    );
    assert_ne!(
        catalog::account_key(&a, &key),
        catalog::account_key(&a, &[9; 32])
    );
    assert!(catalog::account_key(
        &serde_json::json!({"oauthAccount":{"displayName":"unknown"}}),
        &key
    )
    .is_none());
    let f = Fixture::new();
    f.login("A", "one", "token");
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    s.switch("empty", "one", &Policy::default(), &Reporter::channel(None))
        .unwrap();
    let a = s.records()[0].id.clone();
    f.login("B", "one", "manual-login");
    assert!(catalog::current_id(&f.vault, &f.home, &s.db)
        .unwrap()
        .is_none());
    f.login("A", "two", "different-org");
    s.switch(&a, "two", &Policy::default(), &Reporter::channel(None))
        .unwrap();
    assert_eq!(s.records().len(), 2);
    assert!(!serde_json::to_string(&s.records())
        .unwrap()
        .contains("account_key"));
}
#[test]
fn gzip_compatibility_and_zstd_authentication_are_preserved() {
    let data = vec![55; 2 * 1024 * 1024];
    let key = [7; 32];
    for legacy in [true, false] {
        let seal = codec::Seal::new(Vec::new(), &key).unwrap();
        let encrypted = if legacy {
            let mut gzip = flate2::write::GzEncoder::new(seal, flate2::Compression::default());
            gzip.write_all(&data).unwrap();
            gzip.finish().unwrap().finish().unwrap()
        } else {
            let mut encoder = compression::encode(seal).unwrap();
            encoder.write_all(&data).unwrap();
            encoder.finish().unwrap().finish().unwrap()
        };
        let decode = |bytes: Vec<u8>| {
            let open = codec::Open::new(std::io::Cursor::new(bytes), &key)?;
            let mut decoded = compression::decode(open)?;
            let mut result = Vec::new();
            decoded.read_to_end(&mut result)?;
            Ok::<_, std::io::Error>(result)
        };
        assert_eq!(decode(encrypted.clone()).unwrap(), data);
        for cut in [1, 16, 20] {
            assert!(decode(encrypted[..encrypted.len() - cut].to_vec()).is_err());
        }
        let mut extra = encrypted.clone();
        extra.push(0);
        assert!(decode(extra).is_err());
        let mut damaged = encrypted;
        damaged[80] ^= 1;
        assert!(decode(damaged).is_err());
    }
}
#[test]
fn updating_an_archive_commits_the_new_generation_with_its_recovery_marker() {
    let f = Fixture::new();
    f.login("A", "one", "old");
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    let p = Policy::default();
    let r = Reporter::channel(None);
    s.switch("empty", "A", &p, &r).unwrap();
    let old = s.records()[0].clone();
    s.switch(&old.id, "empty", &p, &r).unwrap();
    f.login("A", "one", "latest");
    let (new, stage) = s.save("update", &p, &r).unwrap();
    assert_eq!(old.id, new.id);
    assert_ne!(old.archive, new.archive);
    assert_eq!(
        s.db.by_account(new.account_key.as_deref().unwrap())
            .unwrap()
            .unwrap()
            .archive,
        old.archive
    );
    s.db.pending(&new, "empty").unwrap();
    s.clear(&store::Store::selected(&stage, &p), &r, "clear")
        .unwrap();
    drop(stage);
    drop(s);
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    assert_eq!(
        s.db.get("recovery").unwrap().as_deref(),
        Some(old.id.as_str())
    );
    s.recover("checkpoint", &r).unwrap();
    assert_eq!(f.token(), "latest");
}
#[test]
#[ignore = "manual synthetic performance measurement"]
fn synthetic_switch_and_compression_benchmark() {
    let f = Fixture::new();
    f.login("A", "one", "fixture");
    // 代表性 JSONL：重复结构、变化文本、500 个会话；仅人工合成数据。
    let mut data = Vec::new();
    for n in 0..150_000u64 {
        writeln!(data,"{{\"role\":\"assistant\",\"id\":{n},\"content\":\"synthetic session tool output {}\"}}", n.wrapping_mul(2654435761u64)).unwrap();
    }
    let start = Instant::now();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&data).unwrap();
    let gzip = gzip.finish().unwrap();
    let gz_time = start.elapsed();
    let start = Instant::now();
    let mut zstd = compression::encode(Vec::new()).unwrap();
    zstd.write_all(&data).unwrap();
    let zstd = zstd.finish().unwrap();
    let zs_time = start.elapsed();
    for n in 0..500 {
        f.write(
            &format!(".claude/projects/fixture/{n}.jsonl"),
            &data[n * 100..n * 100 + 256 * 1024],
        );
    }
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    let mut bench_policy = Policy::default();
    bench_policy.history = false;
    let start = Instant::now();
    s.switch("empty", "A", &bench_policy, &Reporter::channel(None))
        .unwrap();
    let stash = start.elapsed();
    let id = s.records().into_iter().find(|r| !r.empty).unwrap().id;
    let start = Instant::now();
    s.switch(&id, "empty", &bench_policy, &Reporter::channel(None))
        .unwrap();
    let restore = start.elapsed();
    eprintln!("synthetic {} bytes: gzip={} bytes {:?}; zstd={} bytes {:?}; 500-file stash {:?}; restore {:?}",data.len(),gzip.len(),gz_time,zstd.len(),zs_time,stash,restore);
    assert!(zstd.len() < data.len());
    assert_eq!(f.token(), "fixture");
}

#[test]
fn rejected_catalog_update_never_replaces_the_committed_archive_or_live_account() {
    let f = Fixture::new();
    let p = Policy::default();
    let r = Reporter::channel(None);
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    f.login("A", "one", "a-old");
    s.switch("empty", "A", &p, &r).unwrap();
    let a = s.records()[0].clone();
    f.login("B", "one", "b-old");
    s.switch(&a.id, "B", &p, &r).unwrap();
    let b = s.records().into_iter().find(|row| row.id != a.id).unwrap();
    let committed = fs::read(f.vault.join(&a.archive)).unwrap();
    f.login("A", "one", "a-live");
    let connection = rusqlite::Connection::open(f.vault.join("identities.sqlite")).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON identities BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(s.switch(&b.id, "update", &p, &r).is_err());
    assert_eq!(f.token(), "a-live");
    assert_eq!(fs::read(f.vault.join(&a.archive)).unwrap(), committed);
    assert_eq!(
        s.db.by_account(a.account_key.as_deref().unwrap())
            .unwrap()
            .unwrap()
            .archive,
        a.archive
    );
    assert!(s.db.get("recovery").unwrap().is_none());
}

#[test]
fn version_one_gzip_catalog_migrates_and_old_duplicate_targets_remain_usable() {
    let f = Fixture::new();
    let p = Policy::default();
    let r = Reporter::channel(None);
    let s = store::Store::open(&f.vault, &f.home).unwrap();
    let mut ids = Vec::new();
    for n in 0..2 {
        f.login("A", "one", &format!("legacy-{n}"));
        let (mut record, stage) = s.save_checkpoint("legacy", &p, &r).unwrap();
        let original = record.archive.clone();
        record.archive = format!("{}.baga", record.id);
        record.account_key = None;
        record.saved_at = n + 1;
        let open =
            codec::Open::new(fs::File::open(f.vault.join(&original)).unwrap(), &s.key).unwrap();
        let decoded = compression::decode(open).unwrap();
        let mut old_tar = tar::Archive::new(decoded);
        let seal = codec::Seal::new(
            private::create(&f.vault.join(&record.archive)).unwrap(),
            &s.key,
        )
        .unwrap();
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
            seal,
            flate2::Compression::default(),
        ));
        for entry in old_tar.entries().unwrap() {
            let mut entry = entry.unwrap();
            let path = entry.path().unwrap().into_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            if path == std::path::Path::new("manifest.json") {
                let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                value.as_object_mut().unwrap().remove("account_key");
                bytes = serde_json::to_vec(&value).unwrap();
            }
            let mut header = entry.header().clone();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, &path, &bytes[..]).unwrap();
        }
        let file = tar
            .into_inner()
            .unwrap()
            .finish()
            .unwrap()
            .finish()
            .unwrap();
        file.sync_all().unwrap();
        s.db.remember(&record).unwrap();
        ids.push(record.id);
        fs::remove_file(f.vault.join(original)).unwrap();
        drop(stage);
    }
    drop(s);
    let connection = rusqlite::Connection::open(f.vault.join("identities.sqlite")).unwrap();
    connection
        .execute_batch("ALTER TABLE identities DROP COLUMN account_key; PRAGMA user_version=1;")
        .unwrap();
    drop(connection);
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    assert_eq!(s.records().len(), 2);
    assert!(s
        .records()
        .iter()
        .all(|row| row.account_key.as_ref().is_some_and(|key| !key.is_empty())));
    // 旧 UI 仍可传入迁移前的卡片编号；同账号切换不回灌过期凭据。
    s.switch(&ids[0], "current", &p, &r).unwrap();
    assert_eq!(f.token(), "legacy-1");
    assert_eq!(s.records().len(), 1);
    assert_eq!(s.records()[0].id, ids[1]);
}
#[test]
fn switching_from_empty_identity_does_not_leak_empty_sqlite_rows_or_archives() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let p = Policy::default();
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    f.login("A", "one", "a-token");
    s.switch("empty", "A slot", &p, &r).unwrap();
    let a = s.records()[0].id.clone();
    // 处于空身份时再次切回已暂存身份，不应残留 empty=1 记录或空归档。
    s.switch(&a, "ignored", &p, &r).unwrap();
    s.switch("empty", "A slot", &p, &r).unwrap();
    s.switch(&a, "ignored", &p, &r).unwrap();
    let connection = rusqlite::Connection::open(f.vault.join("identities.sqlite")).unwrap();
    let empty_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM identities WHERE empty != 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(empty_rows, 0);
    let bagas = fs::read_dir(&f.vault)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".baga"))
        .count();
    assert_eq!(bagas, 1);
}
#[test]
fn store_open_is_read_only_for_workspace_and_explicit_cache_maintenance_is_narrow() {
    let f = Fixture::new();
    let active_acct = "dc56850a-1111-4111-8111-111111111111";
    let active_org = "cd9d0243-2222-4222-8222-222222222222";
    let foreign_acct = "cd633a0c-3c6a-40f6-b6de-3d45b7e32f30";
    let foreign_org = "2e3c4ebe-2b4a-4cf8-a169-ddff973eb25e";
    f.write(
        ".claude.json",
        serde_json::to_string(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": active_acct,
                "organizationUuid": active_org,
                "emailAddress": "active@example.invalid"
            },
            "s1mAccessCache": {
                active_org: {"hasAccess": true},
                foreign_org: {"hasAccess": false}
            },
            "passesEligibilityCache": {
                active_org: {"eligible": true},
                foreign_org: {"eligible": false}
            },
            "metricsStatusCacheByPrincipal": {
                active_acct: {"enabled": true},
                foreign_acct: {"enabled": true}
            },
            "projects": {
                "D:/fixture": {
                    "lastSessionId": "sess-fixture",
                    "lastCost": 1.25,
                    "lastModelUsage": {"fixture-model": {"costUSD": 1.25}}
                }
            }
        }))
        .unwrap()
        .as_bytes(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"active-token"}}"#,
    );
    let raw_session = br#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"foreign-org"}}
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"preserve","signature":"foreign-signature"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"dangling"}]}}"#;
    f.write(".claude/projects/demo/sess-fixture.jsonl", raw_session);
    f.write(
        &format!(".claude/plugins/synced/{active_org}_{active_acct}/keep.json"),
        b"{}",
    );
    f.write(
        ".claude/plugins/synced/foreign-org_foreign-account/drop.json",
        b"{}",
    );
    f.write(
        &format!(".claude/cache/model-catalog/{active_org}-123-cc.json"),
        b"{}",
    );
    f.write(".claude/cache/model-catalog/foreign-org-123-cc.json", b"{}");
    let original_config = fs::read(f.home.join(".claude.json")).unwrap();
    #[cfg(target_os = "windows")]
    {
        f.write(
            "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/config.json",
            serde_json::to_string(&serde_json::json!({
                "lastKnownAccountUuid": active_acct,
                format!("dxt:allowlist:{active_acct}"): [],
                format!("dxt:allowlist:{foreign_acct}"): []
            }))
            .unwrap()
            .as_bytes(),
        );
        f.write(
            "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/ant-device-registry.json",
            serde_json::to_string(&serde_json::json!({
                active_acct: "pk1:active",
                foreign_acct: "pk1:foreign"
            }))
            .unwrap()
            .as_bytes(),
        );
        f.write(
            &format!("AppData/Roaming/Claude/local-agent-mode-sessions/{active_acct}/{active_org}/keep.json"),
            b"{}",
        );
        f.write(
            &format!("AppData/Roaming/Claude/local-agent-mode-sessions/{foreign_acct}/{foreign_org}/drop.json"),
            b"{}",
        );
        f.write(
            &format!("AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/{foreign_org}/drop.json"),
            b"{}",
        );
        f.write(
            "AppData/Local/Claude-3p/config.json",
            serde_json::to_string(&serde_json::json!({
                "lastKnownAccountUuid": foreign_acct
            }))
            .unwrap()
            .as_bytes(),
        );
        f.write(
            "AppData/Local/Claude-3p/Local Storage/leveldb/0001.ldb",
            b"foreign",
        );
        f.write("AppData/Roaming/Claude/DIPS", b"unassociated");
    }
    let _s = store::Store::open(&f.vault, &f.home).unwrap();
    assert_eq!(
        fs::read(f.home.join(".claude.json")).unwrap(),
        original_config
    );
    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-fixture.jsonl")).unwrap(),
        raw_session
    );
    assert!(f
        .home
        .join(".claude/plugins/synced/foreign-org_foreign-account/drop.json")
        .exists());
    assert!(f
        .home
        .join(".claude/cache/model-catalog/foreign-org-123-cc.json")
        .exists());

    crate::cleaner::identity::maintain_account_caches(&f.home).unwrap();
    let cfg: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    assert!(cfg["s1mAccessCache"].get(active_org).is_some());
    assert!(cfg["s1mAccessCache"].get(foreign_org).is_none());
    assert!(cfg["passesEligibilityCache"].get(active_org).is_some());
    assert!(cfg["passesEligibilityCache"].get(foreign_org).is_none());
    assert!(cfg["metricsStatusCacheByPrincipal"]
        .get(active_acct)
        .is_some());
    assert!(cfg["metricsStatusCacheByPrincipal"]
        .get(foreign_acct)
        .is_some());
    assert_eq!(
        cfg["projects"]["D:/fixture"]["lastSessionId"],
        "sess-fixture"
    );
    assert_eq!(cfg["projects"]["D:/fixture"]["lastCost"], 1.25);
    assert!(cfg["projects"]["D:/fixture"]
        .get("lastModelUsage")
        .is_some());
    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-fixture.jsonl")).unwrap(),
        raw_session
    );
    assert!(f
        .home
        .join(format!(
            ".claude/plugins/synced/{active_org}_{active_acct}/keep.json"
        ))
        .exists());
    assert!(!f
        .home
        .join(".claude/plugins/synced/foreign-org_foreign-account")
        .exists());
    assert!(f
        .home
        .join(format!(
            ".claude/cache/model-catalog/{active_org}-123-cc.json"
        ))
        .exists());
    assert!(!f
        .home
        .join(".claude/cache/model-catalog/foreign-org-123-cc.json")
        .exists());
    #[cfg(target_os = "windows")]
    {
        let msix_cfg: serde_json::Value = serde_json::from_slice(
            &fs::read(f.home.join(
                "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/config.json",
            ))
            .unwrap(),
        )
        .unwrap();
        assert!(msix_cfg
            .get(format!("dxt:allowlist:{active_acct}"))
            .is_some());
        assert!(msix_cfg
            .get(format!("dxt:allowlist:{foreign_acct}"))
            .is_some());
        let dev_reg: serde_json::Value = serde_json::from_slice(
            &fs::read(f.home.join(
                "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/ant-device-registry.json",
            ))
            .unwrap(),
        )
        .unwrap();
        assert!(dev_reg.get(active_acct).is_some());
        assert!(dev_reg.get(foreign_acct).is_some());
        assert!(f
            .home
            .join(format!("AppData/Roaming/Claude/local-agent-mode-sessions/{active_acct}/{active_org}/keep.json"))
            .exists());
        assert!(f
            .home
            .join(format!(
                "AppData/Roaming/Claude/local-agent-mode-sessions/{foreign_acct}"
            ))
            .exists());
        assert!(f
            .home
            .join(format!(
                "AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/{foreign_org}"
            ))
            .exists());
        assert!(f.home.join("AppData/Local/Claude-3p/config.json").exists());
        assert!(f
            .home
            .join("AppData/Local/Claude-3p/Local Storage")
            .exists());
        assert!(f.home.join("AppData/Roaming/Claude/DIPS").exists());
    }
}

#[test]
fn per_identity_proxy_and_repo_paths_and_oauth_lock_are_isolated_across_switches() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {"accountUuid": "acct-a", "organizationUuid": "org-a"},
            "changelogLastFetched": 1791955499521u64,
            "lastClawdEntranceVersion": "2.1.299",
            "githubRepoPaths": {"owner-a/repo": ["/workspace/a"]},
            "projects": {"/workspace/a": {"allowedTools": []}},
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"token-a"}}"#,
    );
    f.write(
        ".claude/settings.json",
        br#"{"theme":"dark","env":{"HTTPS_PROXY":"http://127.0.0.1:10801","NO_PROXY":"localhost,127.0.0.1","SHARED_FLAG":"1"}}"#,
    );
    f.write(
        ".claude/.oauth_refresh.lock.owner",
        br#"{"pid":1872,"pidSpace":"HOST-A"}"#,
    );

    let mut policy = Policy::default();
    policy.projects = false;

    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    s.switch("empty", "Account A", &policy, &r).unwrap();

    // After switching to empty with policy.settings = true and policy.projects = false:
    // 1. .oauth_refresh.lock.owner is removed
    assert!(!f.home.join(".claude/.oauth_refresh.lock.owner").exists());
    // 2. Client UI state stays on the machine; selected project mappings move with the account.
    let empty_claude: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(empty_claude["changelogLastFetched"], 1791955499521u64);
    assert_eq!(empty_claude["lastClawdEntranceVersion"], "2.1.299");
    assert!(empty_claude.get("githubRepoPaths").is_none());
    // 3. Account A's proxy is removed from settings.json while shared theme & SHARED_FLAG remain
    let empty_settings: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(empty_settings["theme"], "dark");
    assert_eq!(empty_settings["env"]["SHARED_FLAG"], "1");
    assert!(empty_settings["env"].get("HTTPS_PROXY").is_none());
    assert!(empty_settings["env"].get("NO_PROXY").is_none());

    // Now configure Account B with a different proxy and switch back to Account A
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {"accountUuid": "acct-b", "organizationUuid": "org-b"},
            "githubRepoPaths": {"owner-b/repo": ["/workspace/b"]},
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"token-b"}}"#,
    );
    f.write(
        ".claude/settings.json",
        br#"{"theme":"dark","env":{"HTTPS_PROXY":"http://127.0.0.1:10802","SHARED_FLAG":"1"}}"#,
    );
    let a_id = s.records().into_iter().find(|rec| !rec.empty).unwrap().id;
    s.switch(&a_id, "Account B", &policy, &r).unwrap();

    let restored_settings: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(
        restored_settings["env"]["HTTPS_PROXY"],
        "http://127.0.0.1:10801"
    );
    assert_eq!(restored_settings["env"]["NO_PROXY"], "localhost,127.0.0.1");
    let restored_claude: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    assert!(restored_claude["githubRepoPaths"]
        .get("owner-a/repo")
        .is_some());
    assert!(restored_claude["githubRepoPaths"]
        .get("owner-b/repo")
        .is_none());
}

#[test]
fn in_place_save_and_summary_backfill_leave_default_workspace_untouched() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let p = Policy::default();
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    s.db.configure_browser(true, false, None).unwrap();
    let draft_slot = s.db.browser_slot().unwrap();

    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "acct-max",
                "organizationUuid": "org-max",
                "emailAddress": "max@example.invalid",
                "displayName": "Max User",
                "organizationName": "Max Org",
                "subscriptionType": "claude_max_20x"
            },
            "cachedUsageUtilization": {
                "fetchedAtMs": 4102400000000u64,
                "accountUuid": "acct-max",
                "utilization": {
                    "five_hour": {"utilization": 25, "resets_at": "2099-12-31T18:00:00Z"},
                    "seven_day": {"utilization": 40, "resets_at": "2099-12-31T23:59:59Z"}
                }
            }
        }))
        .unwrap(),
    );
    let original_config = fs::read(f.home.join(".claude.json")).unwrap();
    let raw_session = br#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"foreign-org"}}
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"preserve","signature":"foreign-signature"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"dangling"}]}}"#;
    f.write(".claude/projects/demo/sess-save.jsonl", raw_session);
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"tok-max","refreshToken":"ref-max","expiresAt":4102444800000,"subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}"#,
    );
    f.write(
        ".claude/settings.json",
        br#"{"env":{"HTTPS_PROXY":"http://user:secret@127.0.0.1:7897"}}"#,
    );
    f.write(".claude.lock", b"stale");
    f.write(".claude.json.lock", b"stale-json");
    f.write(".claude/plugins/synced/org-max_acct-max/ok.json", b"{}");
    f.write(
        ".claude/plugins/synced/org-other_acct-other/drop.json",
        b"{}",
    );
    f.write(".claude/cache/model-catalog/org-max-123-cc.json", b"{}");
    f.write(".claude/cache/model-catalog/org-other-123-cc.json", b"{}");

    // 1. In-place save snapshots into vault without clearing live files or switching browser slot
    s.save_current("主力 Max 20x", &p, &r).unwrap();
    assert!(f.home.join(".claude.lock").exists());
    assert!(f.home.join(".claude.json.lock").exists());
    assert_eq!(
        fs::read(f.home.join(".claude.json")).unwrap(),
        original_config
    );
    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-save.jsonl")).unwrap(),
        raw_session
    );
    assert_eq!(f.token(), "tok-max");
    assert_eq!(s.records().len(), 1);
    let rec = &s.records()[0];
    assert_eq!(rec.id, draft_slot);
    assert_eq!(rec.name, "主力 Max 20x");
    assert_eq!(s.db.browser_slot().unwrap(), draft_slot);
    assert_eq!(
        s.db.browser_for(&rec.id).unwrap().as_deref(),
        Some(draft_slot.as_str())
    );

    // 2. Check live profile and persisted summary (including 5h/7d offline quota)
    let current = profile::read(&f.home);
    assert_eq!(current.plan.as_deref(), Some("Max 20x"));
    assert_eq!(current.auth_status.as_deref(), Some("valid"));
    assert_eq!(current.proxy.as_deref(), Some("http://127.0.0.1:7897"));
    assert_eq!(current.quota_5h_used, Some(25));
    assert_eq!(current.quota_7d_used, Some(40));

    let summaries = s.db.summaries().unwrap();
    let sum = summaries.get(&rec.id).unwrap();
    assert_eq!(sum.email.as_deref(), Some("max@example.invalid"));
    assert_eq!(sum.organization.as_deref(), Some("Max Org"));
    assert_eq!(sum.plan.as_deref(), Some("Max 20x"));
    assert_eq!(sum.auth_status.as_deref(), Some("valid"));
    assert_eq!(sum.proxy.as_deref(), Some("http://127.0.0.1:7897"));
    assert_eq!(sum.quota_5h_used, Some(25));
    assert_eq!(sum.quota_7d_used, Some(40));
    assert_eq!(sum.quota_checked, Some(true));

    // 3. Simulate a legacy archive without a summary and confirm open backfills only private index data.
    let rec_id = rec.id.clone();
    s.db.connection
        .execute("DELETE FROM identity_summaries WHERE id=?1", [&rec_id])
        .unwrap();
    assert!(s.db.summaries().unwrap().is_empty());
    drop(s);

    let s = store::Store::open(&f.vault, &f.home).unwrap();
    assert!(f
        .home
        .join(".claude/plugins/synced/org-max_acct-max/ok.json")
        .exists());
    assert!(f
        .home
        .join(".claude/plugins/synced/org-other_acct-other")
        .exists());
    assert!(f
        .home
        .join(".claude/cache/model-catalog/org-max-123-cc.json")
        .exists());
    assert!(f
        .home
        .join(".claude/cache/model-catalog/org-other-123-cc.json")
        .exists());
    assert_eq!(
        fs::read(f.home.join(".claude.json")).unwrap(),
        original_config
    );
    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-save.jsonl")).unwrap(),
        raw_session
    );
    assert!(f.home.join(".claude.lock").exists());
    assert!(f.home.join(".claude.json.lock").exists());
    let backfilled = s.db.summaries().unwrap();
    let sum2 = backfilled.get(&rec_id).unwrap();
    assert_eq!(sum2.email.as_deref(), Some("max@example.invalid"));
    assert_eq!(sum2.plan.as_deref(), Some("Max 20x"));
    assert_eq!(sum2.proxy.as_deref(), Some("http://127.0.0.1:7897"));
    assert_eq!(sum2.quota_5h_used, Some(25));
    assert_eq!(sum2.quota_7d_used, Some(40));
}

#[test]
fn cross_account_session_resume_preserves_original_history_bytes() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();

    // Step 1: Account A has a session and subagent session, stashed with legacy policy (history: false)
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "acct-a",
                "organizationUuid": "org-a",
                "emailAddress": "a@example.invalid",
                "displayName": "Account A"
            },
            "projects": {
                "D:/demo": {
                    "lastSessionId": "sess-a"
                }
            }
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"tok-a"}}"#,
    );
    let sess_a_lines = [
        r#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"org-a"}}"#,
        r#"{"type":"attachment","attachment":{"type":"session_context","context":{"userEmail":"The user's email address is a@example.invalid. Use it only to identify the user, such as for authorship."},"rendered":[{"content":"<system-reminder>\nThe user's email address is a@example.invalid. Use it only to identify the user, such as for authorship.\n</system-reminder>"}]}}"#,
        r#"{"type":"assistant","uuid":"u1","message":{"content":[{"type":"thinking","thinking":"secret-a","signature":"sig-org-a"}]}}"#,
        r#"{"type":"assistant","uuid":"u2","parentUuid":"u1","message":{"content":[{"type":"thinking","thinking":"secret-a2","signature":"sig-org-a"},{"type":"text","text":"unfinished work on A"}]}}"#,
    ]
    .join("\n")
        + "\n";
    f.write(
        ".claude/projects/demo/sess-a.jsonl",
        sess_a_lines.as_bytes(),
    );
    f.write(
        ".claude/projects/demo/sess-a/subagents/agent-1.jsonl",
        b"{\"type\":\"assistant\",\"uuid\":\"sub1\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"sub-secret\",\"signature\":\"sig-org-a\"},{\"type\":\"text\",\"text\":\"subagent output\"}]}}\n",
    );

    let mut legacy_policy = Policy::default();
    legacy_policy.history = false;
    s.switch("empty", "Account A", &legacy_policy, &r).unwrap();
    assert!(!f.home.join(".claude/projects/demo/sess-a.jsonl").exists());
    let a_id = s.records().into_iter().find(|rec| !rec.empty).unwrap().id;

    // Step 2: Account B logs in and creates sess-b.jsonl, switches to A (merging legacy sess-a.jsonl),
    // and then switches back to B while working on sess-a with default Policy (history: true)
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "acct-b",
                "organizationUuid": "org-b",
                "emailAddress": "b@example.invalid",
                "displayName": "Account B"
            },
            "projects": {
                "D:/demo": {
                    "lastSessionId": "sess-b"
                }
            }
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"tok-b"}}"#,
    );
    f.write(
        ".claude/projects/demo/sess-b.jsonl",
        b"{\"type\":\"attachment\",\"attachment\":{\"type\":\"credential_org\",\"organizationUuid\":\"org-b\"}}\n",
    );

    let default_policy = Policy::default();
    assert!(default_policy.history);
    s.switch(&a_id, "Account B", &default_policy, &r).unwrap();
    // Now Account A is active and sess-a.jsonl has been merged onto disk; simulate Account A active on sess-a
    let mut cfg_on_a: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    cfg_on_a["projects"]["D:/demo"]["lastSessionId"] = serde_json::json!("sess-a");
    f.write(".claude.json", &serde_json::to_vec(&cfg_on_a).unwrap());

    let b_id = s
        .records()
        .into_iter()
        .find(|rec| !rec.empty && rec.id != a_id)
        .unwrap()
        .id;
    s.switch(&b_id, "Account A", &default_policy, &r).unwrap();

    // Both sess-a.jsonl (merged from legacy archive) and sess-b.jsonl must exist on disk
    assert!(f.home.join(".claude/projects/demo/sess-a.jsonl").exists());
    assert!(f.home.join(".claude/projects/demo/sess-b.jsonl").exists());

    // Cross-account resume may be incompatible, but switching never rewrites archived history.
    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-a.jsonl")).unwrap(),
        sess_a_lines.as_bytes()
    );
    let raw_subagent = b"{\"type\":\"assistant\",\"uuid\":\"sub1\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"sub-secret\",\"signature\":\"sig-org-a\"},{\"type\":\"text\",\"text\":\"subagent output\"}]}}\n";
    assert_eq!(
        fs::read(
            f.home
                .join(".claude/projects/demo/sess-a/subagents/agent-1.jsonl")
        )
        .unwrap(),
        raw_subagent
    );

    // lastSessionId in .claude.json is preserved because sess-a.jsonl is present in .claude/projects/demo/
    let claude_cfg: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(claude_cfg["projects"]["D:/demo"]["lastSessionId"], "sess-a");
}

#[test]
fn cross_account_switch_preserves_session_replay_and_tool_blocks() {
    let f = Fixture::new();
    let r = Reporter::channel(None);
    let mut s = store::Store::open(&f.vault, &f.home).unwrap();
    let p = Policy::default();

    // Account A hits a 5h limit mid-turn leaving:
    // 1. api-request-blob with hidden foreign thinking signature & SHA-256 replay hash
    // 2. bridge-session with bridgeOwnerAccountUuid / bridgeOwnerOrganizationUuid
    // 3. An orphaned tool_result (no matching tool_use)
    // 4. An interrupted tool_use at the end of the session (no matching tool_result)
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "acct-a",
                "organizationUuid": "org-a",
                "emailAddress": "a@example.invalid",
                "displayName": "Account A"
            },
            "projects": {
                "D:/demo-OnlyInA": {
                    "lastSessionId": "sess-only-a"
                },
                "D:/demo": {
                    "lastSessionId": "sess-interrupted",
                    "lastCost": 4.25,
                    "lastDuration": 180000,
                    "lastModelUsage": {"claude-opus-4-7": {"costUSD": 4.25}}
                }
            },
            "githubRepoPaths": {
                "owner/repo-a": ["D:/demo-OnlyInA"]
            }
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"tok-a"}}"#,
    );
    let interrupted_lines = [
        r#"{"type":"attachment","attachment":{"type":"credential_org","organizationUuid":"org-a"}}"#,
        r#"{"type":"api-request-blob","hash":"deadbeef","value":{"content":[{"type":"thinking","thinking":"blob-secret","signature":"sig-blob-org-a"}]}}"#,
        r#"{"type":"api-request-shape","hash":"cafebabe","messages":[]}"#,
        r#"{"type":"bridge-session","bridgeOwnerAccountUuid":"acct-a","bridgeOwnerOrganizationUuid":"org-a"}"#,
        r#"{"type":"user","uuid":"u-orphan","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_missing","content":"orphan output"}]}}"#,
        r#"{"type":"assistant","uuid":"a-dangling","parentUuid":"u-orphan","message":{"role":"assistant","content":[{"type":"thinking","thinking":"think-before-429","signature":"sig-org-a"},{"type":"tool_use","id":"toolu_interrupted_429","name":"Bash","input":{"command":"cargo test"}}]}}"#,
    ]
    .join("\n")
        + "\n";
    f.write(
        ".claude/projects/demo/sess-interrupted.jsonl",
        interrupted_lines.as_bytes(),
    );
    let mut legacy_p = p.clone();
    legacy_p.projects = false;
    s.save_current("Account A", &legacy_p, &r).unwrap();
    let a_id = s.records()[0].id.clone();

    // Account B logs in and is stashed
    f.write(
        ".claude.json",
        &serde_json::to_vec(&serde_json::json!({
            "oauthAccount": {
                "accountUuid": "acct-b",
                "organizationUuid": "org-b",
                "emailAddress": "b@example.invalid",
                "displayName": "Account B"
            },
            "projects": {
                "D:/demo": {
                    "lastSessionId": "sess-interrupted",
                    "lastCost": 4.25,
                    "lastDuration": 180000,
                    "lastModelUsage": {"claude-opus-4-7": {"costUSD": 4.25}}
                }
            }
        }))
        .unwrap(),
    );
    f.write(
        ".claude/.credentials.json",
        br#"{"claudeAiOauth":{"accessToken":"tok-b"}}"#,
    );
    s.save_current("Account B", &p, &r).unwrap();
    let b_id = s
        .records()
        .into_iter()
        .find(|rec| rec.id != a_id)
        .unwrap()
        .id;

    // Switch to Account A, then switch to Account B (simulating 5h limit relay from A -> B)
    s.switch(&a_id, "Account B", &p, &r).unwrap();
    s.switch(&b_id, "Account A", &p, &r).unwrap();

    assert_eq!(
        fs::read(f.home.join(".claude/projects/demo/sess-interrupted.jsonl")).unwrap(),
        interrupted_lines.as_bytes()
    );

    // Session references and telemetry remain byte-for-byte tied to the original history.
    let cfg_b: serde_json::Value =
        serde_json::from_slice(&fs::read(f.home.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(
        cfg_b["projects"]["D:/demo"]["lastSessionId"],
        "sess-interrupted"
    );
    assert_eq!(cfg_b["projects"]["D:/demo"]["lastCost"], 4.25);
    assert_eq!(cfg_b["projects"]["D:/demo"]["lastDuration"], 180000);
    assert!(cfg_b["projects"]["D:/demo"].get("lastModelUsage").is_some());
    // 4. Missing project & githubRepoPaths from Account A were merged into Account B
    assert!(cfg_b["projects"].get("D:/demo-OnlyInA").is_some());
    assert!(cfg_b["githubRepoPaths"].get("owner/repo-a").is_some());
}
