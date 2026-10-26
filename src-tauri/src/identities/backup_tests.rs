// [INPUT]: Synthetic private vaults, encrypted backup streams and owned scratch directories.
// [OUTPUT]: Backup compatibility, source preservation and stage lifecycle regression checks.
// [POS]: Isolated backup tests; never reads live identities or changes the active vault.
// [PROTOCOL]: Update this header and check CLAUDE.md when behavior changes.
use super::*;
use crate::identities::{database::Record, Policy};
use std::{fs, io::Cursor, path::PathBuf};

struct Fixture {
    root: PathBuf,
    vault: PathBuf,
    archive_name: String,
    master: [u8; 32],
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "claude-local-backup-test-{}",
            crate::identities::new_id().unwrap()
        ));
        private::directory(&root).unwrap();
        let vault = root.join("identity-vault");
        private::directory(&vault).unwrap();
        let master = codec::random::<32>().unwrap();
        let mut key = private::create(&vault.join("key.bin")).unwrap();
        key.write_all(&master).unwrap();
        key.sync_all().unwrap();
        drop(key);
        let archive_name = format!("{}.baga", "a".repeat(32));
        let mut fixture = Self {
            root,
            vault,
            archive_name,
            master,
        };
        let manifest_bytes = serde_json::to_vec(&fixture.inner_manifest()).unwrap();
        fixture.write_inner_archive(&[
            ("manifest.json", &manifest_bytes),
            ("data/0", b"{}"),
            ("data/", b""),
        ]);
        let db = crate::identities::database::Database::open(&fixture.vault).unwrap();
        db.remember(&Record {
            id: "a".repeat(32),
            name: "Synthetic account".into(),
            archive: fixture.archive_name.clone(),
            saved_at: 123,
            bytes: 27,
            policy: Policy::default(),
            empty: false,
            account_key: Some("synthetic-account-key".into()),
        })
        .unwrap();
        drop(db);
        fixture
    }
    fn write_inner_archive(&mut self, files: &[(&str, &[u8])]) {
        let sealed = codec::Seal::new(Vec::new(), &self.master).unwrap();
        let encoder = super::super::compression::encode(sealed).unwrap();
        let mut tar = tar::Builder::new(encoder);
        for (name, data) in files {
            let mut header = tar::Header::new_gnu();
            let is_directory = *name == "data/";
            header.set_size(if is_directory { 0 } else { data.len() as u64 });
            header.set_mode(0o600);
            if is_directory {
                header.set_entry_type(tar::EntryType::Directory);
            }
            header.set_cksum();
            tar.append_data(
                &mut header,
                name,
                Cursor::new(if is_directory { &[][..] } else { *data }),
            )
            .unwrap();
        }
        let encoder = tar.into_inner().unwrap();
        let sealed = encoder.finish().unwrap();
        let bytes = sealed.finish().unwrap();
        let mut archive = private::create(&self.vault.join(&self.archive_name)).unwrap();
        archive.write_all(&bytes).unwrap();
        archive.sync_all().unwrap();
    }
    fn replace_inner_archive(&mut self, files: &[(&str, &[u8])]) {
        fs::remove_file(self.vault.join(&self.archive_name)).unwrap();
        self.write_inner_archive(files);
    }
    fn inner_manifest(&self) -> crate::identities::archive::Manifest {
        let home = self.root.join("synthetic-home");
        crate::identities::archive::Manifest {
            version: 1,
            id: "a".repeat(32),
            home: home.clone(),
            platform: "synthetic-platform".into(),
            policy: Policy::default(),
            sources: vec![crate::cleaner::identity::Source {
                path: home.join(".claude.json"),
                category: "account".into(),
                keys: vec!["oauthAccount".into()],
            }],
            credentials: Vec::new(),
            fingerprints: vec![vec![1, 2, 3]],
            account_key: Some("synthetic-account-key".into()),
        }
    }
    fn files(&self) -> Vec<(String, PathBuf, u64, String)> {
        let catalog = source_catalog(&self.vault, false).unwrap();
        let snapshot = self.root.join("snapshot.sqlite");
        backup_snapshot(&self.vault.join("identities.sqlite"), &snapshot).unwrap();
        collect_files(&self.vault, &catalog, &snapshot).unwrap()
    }
    fn package(&self, path: &Path, password: &[u8], count: u64, unsafe_member: bool) {
        let catalog = source_catalog(&self.vault, false).unwrap();
        let files = self.files();
        let mut manifest = make_manifest(&catalog, &files).unwrap();
        manifest.saved_identities = count;
        let target = private::create(path).unwrap();
        let mut sealed = write_envelope(target, password).unwrap();
        if unsafe_member {
            let mut tar = tar::Builder::new(sealed);
            let mut header = tar::Header::new_gnu();
            header.set_size(1);
            header.set_mode(0o600);
            let name_bytes = b"../outside\0";
            header.as_mut_bytes()[..name_bytes.len()].copy_from_slice(name_bytes);
            header.set_cksum();
            tar.append(&header, Cursor::new(b"x")).unwrap();
            sealed = tar.into_inner().unwrap();
        } else {
            sealed = write_tar(sealed, &manifest, &files).unwrap();
        }
        sealed.finish().unwrap().sync_all().unwrap();
    }
    fn package_path(&self) -> PathBuf {
        self.root.join("synthetic.clbak")
    }
    fn stage_parent(&self) -> PathBuf {
        self.root.join("stage")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn encrypted_package_round_trip_checks_counts_and_preserves_sources() {
    let fixture = Fixture::new();
    let db_before = digest(&fixture.vault.join("identities.sqlite")).unwrap();
    let key_before = digest(&fixture.vault.join("key.bin")).unwrap();
    let archive_before = digest(&fixture.vault.join(&fixture.archive_name)).unwrap();
    let path = fixture.package_path();
    fixture.package(&path, b"synthetic passphrase", 1, false);
    let (mut stage, manifest, recovery) = stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        false,
    )
    .unwrap();
    assert_eq!(manifest.saved_identities, 1);
    assert_eq!(manifest.archives, 1);
    assert!(!recovery);
    let (catalog, _) = verify_staged(&stage, Some(false)).unwrap();
    assert_eq!(catalog.identities, 1);
    assert_eq!(
        digest(&fixture.vault.join("identities.sqlite")).unwrap(),
        db_before
    );
    assert_eq!(digest(&fixture.vault.join("key.bin")).unwrap(), key_before);
    assert_eq!(
        digest(&fixture.vault.join(&fixture.archive_name)).unwrap(),
        archive_before
    );
    let stage_path = stage.to_path_buf();
    stage.cleanup().unwrap();
    stage.cleanup().unwrap();
    assert!(!stage_path.exists());
    assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
}

#[test]
fn wrong_password_tamper_and_truncation_are_refused() {
    let fixture = Fixture::new();
    let path = fixture.package_path();
    fixture.package(&path, b"synthetic passphrase", 1, false);
    assert!(stage_archive(&path, &fixture.stage_parent(), b"wrong passphrase", true).is_err());
    assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
    let original = fs::read(&path).unwrap();
    let mut damaged = original.clone();
    damaged[40] ^= 1;
    fs::write(&path, damaged).unwrap();
    assert!(stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        true
    )
    .is_err());
    assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
    fs::write(&path, &original[..original.len() - 7]).unwrap();
    assert!(stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        true
    )
    .is_err());
    assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
}

#[test]
fn failed_final_authentication_removes_already_extracted_members() {
    let fixture = Fixture::new();
    let original_path = fixture.package_path();
    fixture.package(&original_path, b"synthetic passphrase", 1, false);
    let original = fs::read(&original_path).unwrap();
    let source_hashes: Vec<_> = ["identities.sqlite", "key.bin", &fixture.archive_name]
        .iter()
        .map(|name| digest(&fixture.vault.join(name)).unwrap())
        .collect();
    let mut damaged = original.clone();
    *damaged.last_mut().unwrap() ^= 1;
    for (index, bytes) in [damaged.as_slice(), &original[..original.len() - 7]]
        .into_iter()
        .enumerate()
    {
        let path = fixture.root.join(format!("damaged-{index}.clbak"));
        private::create(&path).unwrap().write_all(bytes).unwrap();
        // The complete tar, including synthetic key material, is readable before
        // the terminal authentication failure. This exercises post-extraction cleanup.
        let mut reader =
            open_envelope(fs::File::open(&path).unwrap(), b"synthetic passphrase").unwrap();
        let mut archive = tar::Archive::new(&mut reader);
        let mut key_was_read = false;
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            key_was_read |= entry.path().unwrap() == Path::new("identity-vault/key.bin");
            io::copy(&mut entry, &mut io::sink()).unwrap();
        }
        assert!(key_was_read);
        drop(archive);
        assert!(io::copy(&mut reader, &mut io::sink()).is_err());
        assert!(stage_archive(
            &path,
            &fixture.stage_parent(),
            b"synthetic passphrase",
            false,
        )
        .is_err());
        assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    assert_eq!(fs::read(&original_path).unwrap(), original);
    for (name, expected) in ["identities.sqlite", "key.bin", &fixture.archive_name]
        .iter()
        .zip(source_hashes)
    {
        assert_eq!(digest(&fixture.vault.join(name)).unwrap(), expected);
    }
}

#[test]
fn owned_scratch_is_removed_on_unwind_without_sweeping_existing_siblings() {
    let fixture = Fixture::new();
    let parent = fixture.stage_parent();
    let existing = parent.join("verify-existing");
    private::directory(&existing).unwrap();
    let sentinel = existing.join("keep.txt");
    private::create(&sentinel)
        .unwrap()
        .write_all(b"keep")
        .unwrap();
    let stage = ScratchGuard::create(&parent, "verify").unwrap();
    let stage_path = stage.to_path_buf();
    private::create(&stage.join("synthetic-material")).unwrap();
    let result = std::panic::catch_unwind(move || {
        let _stage = stage;
        panic!("synthetic unwind");
    });
    assert!(result.is_err());
    assert!(!stage_path.exists());
    assert_eq!(fs::read(&sentinel).unwrap(), b"keep");
}

#[test]
fn cleanup_refuses_replaced_path_and_reports_a_path_free_diagnostic() {
    let fixture = Fixture::new();
    let mut stage = ScratchGuard::create(&fixture.stage_parent(), "verify").unwrap();
    let path = stage.to_path_buf();
    fs::remove_dir(&path).unwrap();
    private::create(&path).unwrap().write_all(b"keep").unwrap();
    let mut diagnostics = Vec::new();
    stage.cleanup_diagnostic(&mut diagnostics);
    stage.cleanup_diagnostic(&mut diagnostics);
    assert_eq!(diagnostics, ["staging_cleanup_failed"]);
    assert_eq!(
        stage.cleanup_error(error()),
        format!("{} {CLEANUP_FAILED}", error())
    );
    assert_eq!(fs::read(&path).unwrap(), b"keep");
    // Restore only this synthetic test path so Drop can finish its owned cleanup.
    fs::remove_file(&path).unwrap();
    private::directory(&path).unwrap();
    stage.cleanup().unwrap();
}

#[test]
fn unsafe_members_and_catalog_count_mismatch_are_refused() {
    let fixture = Fixture::new();
    let path = fixture.package_path();
    fixture.package(&path, b"synthetic passphrase", 9, false);
    assert!(stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        true
    )
    .is_err());
    assert_eq!(fs::read_dir(fixture.stage_parent()).unwrap().count(), 0);
    fs::remove_file(&path).unwrap();
    fixture.package(&path, b"synthetic passphrase", 1, true);
    assert!(stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        true
    )
    .is_err());
}

#[test]
fn output_creation_refuses_existing_target_and_invalid_sqlite_is_rejected() {
    let fixture = Fixture::new();
    let target = fixture.root.join("already-exists.clbak");
    drop(private::create(&target).unwrap());
    assert!(private::create(&target).is_err());
    let database = fixture.vault.join("identities.sqlite");
    fs::write(&database, b"not sqlite").unwrap();
    assert!(source_catalog(&fixture.vault, false).is_err());
}

#[test]
fn authenticated_archive_uses_full_manifest_and_rejects_invalid_identity_metadata() {
    let mut fixture = Fixture::new();
    let path = fixture.vault.join(&fixture.archive_name);
    let expected_id = "a".repeat(32);
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &expected_id,
        Some("synthetic-account-key")
    )
    .is_ok());
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &"b".repeat(32),
        Some("synthetic-account-key")
    )
    .is_err());
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &expected_id,
        Some("different-account-key")
    )
    .is_err());

    let manifest_bytes = serde_json::to_vec(&fixture.inner_manifest()).unwrap();
    fixture.replace_inner_archive(&[("manifest.json", &manifest_bytes)]);
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &expected_id,
        Some("synthetic-account-key")
    )
    .is_err());

    fixture.replace_inner_archive(&[("manifest.json", b"{ not json }"), ("data/0", b"{}")]);
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &expected_id,
        Some("synthetic-account-key")
    )
    .is_err());

    let mut disallowed = fixture.inner_manifest();
    disallowed.sources[0].path = disallowed.home.join("outside.json");
    let disallowed_bytes = serde_json::to_vec(&disallowed).unwrap();
    fixture.replace_inner_archive(&[("manifest.json", &disallowed_bytes), ("data/0", b"{}")]);
    assert!(authenticate_inner_archive(
        &path,
        &fixture.master,
        &expected_id,
        Some("synthetic-account-key")
    )
    .is_err());
}

#[test]
fn backup_member_limits_are_checked_before_extraction() {
    assert!(validate_backup_entry(MAX_MEMBERS, Path::new("identity-vault/key.bin"), 0).is_ok());
    assert!(validate_backup_entry(MAX_MEMBERS + 1, Path::new("extra"), 0).is_err());
    assert!(
        validate_backup_entry(0, Path::new("identity-vault/key.bin"), MAX_MEMBER_BYTES).is_ok()
    );
    assert!(
        validate_backup_entry(0, Path::new("identity-vault/key.bin"), MAX_MEMBER_BYTES + 1)
            .is_err()
    );
    assert!(validate_backup_entry(0, Path::new("manifest.json"), MAX_MANIFEST_BYTES + 1).is_err());
}

#[test]
fn corrupt_database_and_missing_key_can_be_preserved_as_unverified_encrypted_rescue_evidence() {
    let fixture = Fixture::new();
    let database = fixture.vault.join("identities.sqlite");
    fs::write(&database, b"synthetic corrupt sqlite evidence").unwrap();
    fs::write(
        fixture.vault.join("identities.sqlite-wal"),
        b"synthetic wal evidence",
    )
    .unwrap();
    let (files, mut diagnostics) = rescue_files(&fixture.vault, true).unwrap();
    assert!(diagnostics.iter().any(|flag| flag == "database_unverified"));
    assert!(files
        .iter()
        .any(|(name, _, _, _)| name.ends_with("identities.sqlite-wal")));
    let path = fixture.package_path();
    let rescue = make_rescue_manifest(0, 1, std::mem::take(&mut diagnostics), &files);
    let target = private::create(&path).unwrap();
    let sealed = write_envelope(target, b"synthetic passphrase").unwrap();
    write_tar(sealed, &rescue, &files)
        .unwrap()
        .finish()
        .unwrap()
        .sync_all()
        .unwrap();
    let (mut stage, inspected, _) = stage_archive(
        &path,
        &fixture.stage_parent(),
        b"synthetic passphrase",
        true,
    )
    .unwrap();
    assert_eq!(inspected.mode, "rescue");
    assert!(verify_staged(&stage, None).is_err());
    assert_eq!(verify_rescue_staged(&stage).unwrap().mode, "rescue");
    stage.cleanup().unwrap();

    fs::remove_file(&fixture.vault.join("key.bin")).unwrap();
    let (files, diagnostics) = rescue_files(&fixture.vault, true).unwrap();
    assert!(diagnostics.iter().any(|flag| flag == "master_key_missing"));
    assert!(files.iter().any(|(name, _, _, _)| name.ends_with(".baga")));
}

#[test]
fn sqlite_online_backup_includes_committed_wal_state() {
    let fixture = Fixture::new();
    let database = fixture.vault.join("identities.sqlite");
    let source = Connection::open(&database).unwrap();
    source
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    source
        .execute(
            "UPDATE identities SET name='WAL snapshot' WHERE id=?1",
            ["a".repeat(32)],
        )
        .unwrap();
    assert!(Path::new(&format!("{}-wal", database.display())).exists());
    let snapshot = fixture.root.join("wal-snapshot.sqlite");
    backup_snapshot(&database, &snapshot).unwrap();
    let name: String = Connection::open(snapshot)
        .unwrap()
        .query_row(
            "SELECT name FROM identities WHERE id=?1",
            ["a".repeat(32)],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(name, "WAL snapshot");
    drop(source);
}

#[test]
fn inner_archive_corrupt_swapped_id_and_missing_data_are_refused() {
    let mut bad_fixture = Fixture::new();
    let swapped_manifest = serde_json::json!({
        "version": 1,
        "id": "b".repeat(32),
        "sources": [{"path": "/dummy", "keys": []}],
        "fingerprints": [[1, 2, 3]],
        "account_key": null
    });
    let manifest_bytes = serde_json::to_vec(&swapped_manifest).unwrap();
    fs::remove_file(bad_fixture.vault.join(&bad_fixture.archive_name)).unwrap();
    bad_fixture.write_inner_archive(&[("manifest.json", &manifest_bytes), ("data/0", b"{}")]);
    let bad_pkg = bad_fixture.package_path();
    bad_fixture.package(&bad_pkg, b"synthetic passphrase", 1, false);
    assert!(stage_archive(
        &bad_pkg,
        &bad_fixture.stage_parent(),
        b"synthetic passphrase",
        false
    )
    .is_err());

    let mut missing_data_fixture = Fixture::new();
    let valid_manifest = serde_json::json!({
        "version": 1,
        "id": "a".repeat(32),
        "sources": [{"path": "/dummy", "keys": []}],
        "fingerprints": [[1, 2, 3]],
        "account_key": null
    });
    let valid_bytes = serde_json::to_vec(&valid_manifest).unwrap();
    fs::remove_file(
        missing_data_fixture
            .vault
            .join(&missing_data_fixture.archive_name),
    )
    .unwrap();
    missing_data_fixture.write_inner_archive(&[("manifest.json", &valid_bytes)]);
    let missing_pkg = missing_data_fixture.package_path();
    missing_data_fixture.package(&missing_pkg, b"synthetic passphrase", 1, false);
    assert!(stage_archive(
        &missing_pkg,
        &missing_data_fixture.stage_parent(),
        b"synthetic passphrase",
        false
    )
    .is_err());

    let mut corrupt_fixture = Fixture::new();
    fs::remove_file(corrupt_fixture.vault.join(&corrupt_fixture.archive_name)).unwrap();
    corrupt_fixture.write_inner_archive(&[("manifest.json", b"not valid json"), ("data/0", b"{}")]);
    let corrupt_pkg = corrupt_fixture.package_path();
    corrupt_fixture.package(&corrupt_pkg, b"synthetic passphrase", 1, false);
    assert!(stage_archive(
        &corrupt_pkg,
        &corrupt_fixture.stage_parent(),
        b"synthetic passphrase",
        false
    )
    .is_err());
}
