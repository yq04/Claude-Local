// [INPUT]: 合成认证归档、可注入的小资源限额和隔离私有临时目录。
// [OUTPUT]: gzip/Zstd 兼容、声明/数量/展开尾部/JSON/元数据超限及失败隔离证明。
// [POS]: 普通身份归档离线安全回归，不读取真实账号或运行浏览器/进程操作。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;
use crate::identities::{
    codec, compression, database::Record, new_id, private, store::Store, Policy,
};
use std::{io::Write, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("claude-local-archive-limits-{}", new_id().unwrap()));
        private::directory(&root.join("home")).unwrap();
        Self(root)
    }
    fn open(&self) -> Store {
        Store::open(&self.0.join("vault"), &self.0.join("home")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn manifest(store: &Store, id: &str, config: bool) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "version":1, "id":id, "home":store.home, "platform":std::env::consts::OS,
        "policy":Policy::default(), "credentials":[],
        "sources": if config { serde_json::json!([{
            "path":store.home.join(".claude.json"), "category":"account", "keys":["oauthAccount"]
        }]) } else { serde_json::json!([]) },
        "fingerprints":if config { serde_json::json!([[]]) } else { serde_json::json!([]) }
    }))
    .unwrap()
}

fn append(raw: &mut Vec<u8>, name: &str, kind: u8, declared: u64, bytes: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_path(name).unwrap();
    header.set_entry_type(tar::EntryType::new(kind));
    header.set_mode(0o600);
    header.set_size(declared);
    header.set_cksum();
    raw.extend_from_slice(header.as_bytes());
    raw.extend_from_slice(bytes);
    raw.resize(raw.len().div_ceil(512) * 512, 0);
}

fn record(store: &Store, id: &str, raw: &[u8], gzip: bool) -> Record {
    let compressed = if gzip {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(raw).unwrap();
        encoder.finish().unwrap()
    } else {
        let mut encoder = compression::encode(Vec::new()).unwrap();
        encoder.write_all(raw).unwrap();
        encoder.finish().unwrap()
    };
    let mut seal = codec::Seal::new(Vec::new(), &store.key).unwrap();
    seal.write_all(&compressed).unwrap();
    let bytes = seal.finish().unwrap();
    assert_eq!(&bytes[..8], b"BAGAID01");
    let archive = format!("{}.baga", new_id().unwrap());
    private::write(&store.vault.join(&archive), &bytes).unwrap();
    Record {
        id: id.into(),
        name: "synthetic".into(),
        archive,
        saved_at: 0,
        bytes: bytes.len() as u64,
        policy: Policy::default(),
        empty: true,
        account_key: None,
    }
}

fn assert_rejected(store: &Store, record: &Record, limits: Limits) {
    let archive = store.vault.join(&record.archive);
    let before = fs::read(&archive).unwrap();
    let unrelated = store.vault.join(format!(".stage-{}", new_id().unwrap()));
    private::directory(&unrelated).unwrap();
    private::write(&unrelated.join("preserve"), b"other-operation").unwrap();
    let before_stages = fs::read_dir(&store.vault)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(".stage-"))
        .count();
    let error = match store.load_with_limits(record, limits) {
        Ok(_) => panic!("oversized archive accepted"),
        Err(error) => error,
    };
    assert_eq!(error, ERROR);
    assert_eq!(fs::read(archive).unwrap(), before);
    assert_eq!(
        fs::read(unrelated.join("preserve")).unwrap(),
        b"other-operation"
    );
    assert_eq!(
        fs::read_dir(&store.vault)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(".stage-"))
            .count(),
        before_stages
    );
}

#[test]
fn authenticated_gzip_and_zstd_keep_content_limit_separate_from_tar_overhead() {
    for gzip in [true, false] {
        let fixture = Fixture::new();
        let store = fixture.open();
        let id = new_id().unwrap();
        let bytes = manifest(&store, &id, false);
        let mut raw = Vec::new();
        append(&mut raw, "manifest.json", b'0', bytes.len() as u64, &bytes);
        raw.extend_from_slice(&[0; 1024]);
        let record = record(&store, &id, &raw, gzip);
        let limits = Limits {
            content_bytes: bytes.len() as u64,
            member_bytes: bytes.len() as u64,
            stream_bytes: raw.len() as u64,
            ..Limits::default()
        };
        let stage = store.load_with_limits(&record, limits).unwrap();
        assert_eq!(stage.manifest.id, id);
        assert_eq!(fs::read(stage.path.join("manifest.json")).unwrap(), bytes);
    }
}

#[test]
fn authenticated_declared_member_count_total_and_manifest_limits_reject() {
    let fixture = Fixture::new();
    let store = fixture.open();
    let id = new_id().unwrap();
    let bytes = manifest(&store, &id, true);
    let mut raw = Vec::new();
    append(&mut raw, "manifest.json", b'0', bytes.len() as u64, &bytes);
    append(&mut raw, "data/0", b'0', 2, b"{}");
    raw.extend_from_slice(&[0; 1024]);
    let valid = record(&store, &id, &raw, false);
    for limits in [
        Limits {
            members: 1,
            ..Limits::default()
        },
        Limits {
            content_bytes: bytes.len() as u64 + 1,
            ..Limits::default()
        },
        Limits {
            manifest_bytes: bytes.len() as u64 - 1,
            ..Limits::default()
        },
        Limits {
            config_bytes: 1,
            ..Limits::default()
        },
    ] {
        assert_rejected(&store, &valid, limits);
    }
    let mut declared = Vec::new();
    append(&mut declared, "data/0", b'0', 4097, &[]);
    let malformed = record(&store, &id, &declared, true);
    assert_rejected(
        &store,
        &malformed,
        Limits {
            member_bytes: 4096,
            ..Limits::default()
        },
    );
}

#[test]
fn authenticated_trailing_expansion_is_bounded_and_never_successful_eof() {
    let fixture = Fixture::new();
    let store = fixture.open();
    let id = new_id().unwrap();
    let bytes = manifest(&store, &id, false);
    let mut raw = Vec::new();
    append(&mut raw, "manifest.json", b'0', bytes.len() as u64, &bytes);
    raw.extend_from_slice(&[0; 1024]);
    let maximum = raw.len() as u64;
    raw.extend_from_slice(&[0; 1024]);
    for gzip in [true, false] {
        let record = record(&store, &id, &raw, gzip);
        assert_rejected(
            &store,
            &record,
            Limits {
                stream_bytes: maximum,
                ..Limits::default()
            },
        );
    }
}

#[test]
fn full_authentication_tail_is_checked_at_exact_decompressed_limit() {
    let fixture = Fixture::new();
    let store = fixture.open();
    let id = new_id().unwrap();
    let bytes = manifest(&store, &id, false);
    let mut raw = Vec::new();
    append(&mut raw, "manifest.json", b'0', bytes.len() as u64, &bytes);
    raw.extend_from_slice(&[0; 1024]);
    for gzip in [true, false] {
        let record = record(&store, &id, &raw, gzip);
        let path = store.vault.join(&record.archive);
        // Mutate only the newly created synthetic encrypted authentication tail.
        let mut file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(record.bytes - 1).unwrap();
        file.flush().unwrap();
        drop(file);
        assert!(store
            .load_with_limits(
                &record,
                Limits {
                    stream_bytes: raw.len() as u64,
                    ..Limits::default()
                }
            )
            .is_err());
    }
}

#[test]
fn gnu_long_names_remain_readable_and_extensions_are_bounded_before_allocation() {
    let name = format!("data/0/{}", "a".repeat(140));
    let mut tar = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(2);
    header.set_mode(0o600);
    header.set_cksum();
    tar.append_data(&mut header, &name, &b"ok"[..]).unwrap();
    let raw = tar.into_inner().unwrap();
    let mut guarded = TarRead::new(raw.as_slice(), Limits::default());
    let mut tar = tar::Archive::new(&mut guarded);
    let mut entries = tar.entries().unwrap();
    let mut entry = entries.next().unwrap().unwrap();
    assert_eq!(entry.path().unwrap(), Path::new(&name));
    let mut contents = Vec::new();
    entry.read_to_end(&mut contents).unwrap();
    assert_eq!(contents, b"ok");
    drop(entry);
    drop(entries);
    drop(tar);
    io::copy(&mut guarded, &mut io::sink()).unwrap();
    for kind in [b'L', b'x'] {
        let mut declared = Vec::new();
        append(&mut declared, "metadata", kind, 10_000, &[]);
        let mut guarded = TarRead::new(
            declared.as_slice(),
            Limits {
                path_bytes: 64,
                manifest_bytes: 64,
                ..Limits::default()
            },
        );
        assert_eq!(guarded.read(&mut [0; 512]).unwrap_err().to_string(), ERROR);
    }
}

fn pax_size(size: u64) -> Vec<u8> {
    let body = format!(" size={size}\n");
    let mut length = body.len() + 1;
    loop {
        let text = format!("{length}{body}");
        if text.len() == length {
            return text.into_bytes();
        }
        length = text.len();
    }
}

#[test]
fn pax_size_override_is_preserved_and_counted_before_member_payload() {
    let extension = pax_size(2);
    let mut raw = Vec::new();
    append(
        &mut raw,
        "metadata",
        b'x',
        extension.len() as u64,
        &extension,
    );
    append(&mut raw, "data/0", b'0', 0, b"ok");
    raw.extend_from_slice(&[0; 1024]);
    let mut guarded = TarRead::new(raw.as_slice(), Limits::default());
    let mut tar = tar::Archive::new(&mut guarded);
    let mut entry = tar.entries().unwrap().next().unwrap().unwrap();
    assert_eq!(entry.size(), 2);
    let mut contents = Vec::new();
    entry.read_to_end(&mut contents).unwrap();
    assert_eq!(contents, b"ok");
    let mut guarded = TarRead::new(
        raw.as_slice(),
        Limits {
            member_bytes: 1,
            ..Limits::default()
        },
    );
    let mut tar = tar::Archive::new(&mut guarded);
    assert!(tar
        .entries()
        .unwrap()
        .next()
        .unwrap()
        .err()
        .unwrap()
        .to_string()
        .contains(ERROR));
}

#[test]
fn effective_pax_path_is_bounded_after_metadata_preprocessing() {
    let fixture = Fixture::new();
    let store = fixture.open();
    let id = new_id().unwrap();
    let path = "a".repeat(65);
    let body = format!(" path={path}\n");
    let mut length = body.len() + 2;
    let extension = loop {
        let text = format!("{length}{body}");
        if text.len() == length {
            break text;
        }
        length = text.len();
    };
    let mut raw = Vec::new();
    append(
        &mut raw,
        "metadata",
        b'x',
        extension.len() as u64,
        extension.as_bytes(),
    );
    append(&mut raw, "short", b'0', 0, &[]);
    raw.extend_from_slice(&[0; 1024]);
    let record = record(&store, &id, &raw, false);
    assert_rejected(
        &store,
        &record,
        Limits {
            path_bytes: 64,
            ..Limits::default()
        },
    );
}
