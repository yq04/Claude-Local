// [INPUT]: 固定 app_data_dir 下的身份保险库、SQLite online backup、ring PBKDF2/AES-GCM 与用户明确选择的备份文件。
// [OUTPUT]: 口令认证加密备份、脱敏预览/验收及保留源的全新私有恢复副本。
// [POS]: 身份数据管理边界；只封装 identities.sqlite、key.bin 和数据库引用的 .baga 归档，不触碰工作区/浏览器/Claude 配置。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{codec, private};
use ring::pbkdf2;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tauri::Manager;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"CLBKUP01";
const KDF_ROUNDS: u32 = 600_000;
const MAX_BACKUP_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_MEMBER_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_MEMBERS: usize = 4096;
const MAX_PATH_BYTES: usize = 240;
const MAX_INNER_MEMBERS: usize = 100_000;
const MAX_INNER_PATH_BYTES: usize = 4096;
const MAX_INNER_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_INNER_MANIFEST_BYTES: u64 = 1024 * 1024;

#[cfg(test)]
#[path = "backup_tests.rs"]
mod backup_tests;

#[derive(Serialize)]
pub struct BackupLocation {
    pub app_data_dir: String,
    pub vault_available: bool,
}
#[derive(Serialize)]
pub struct BackupPreview {
    pub valid: bool,
    pub rescue_available: bool,
    pub saved_identities: u64,
    pub archives: u64,
    pub estimated_bytes: u64,
    pub recovery_pending: bool,
    pub diagnostics: Vec<String>,
}
#[derive(Serialize)]
pub struct BackupReceipt {
    pub path: String,
    pub saved_identities: u64,
    pub archives: u64,
    pub bytes: u64,
    pub encrypted: bool,
    pub verified: bool,
    pub rescue_copy: bool,
    pub source_preserved: bool,
}
#[derive(Serialize)]
pub struct BackupInspection {
    pub saved_identities: u64,
    pub archives: u64,
    pub bytes: u64,
    pub verified: bool,
    pub rescue_copy: bool,
    pub recovery_pending: bool,
    pub diagnostics: Vec<String>,
}
#[derive(Serialize)]
pub struct RestoreReceipt {
    pub path: String,
    pub saved_identities: u64,
    pub archives: u64,
    pub verified: bool,
    pub active_vault_changed: bool,
    pub rescue_copy: bool,
    pub source_preserved: bool,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    mode: String,
    saved_identities: u64,
    archives: u64,
    diagnostics: Vec<String>,
    files: Vec<ManifestFile>,
}
#[derive(Clone, Serialize, Deserialize)]
struct ManifestFile {
    path: String,
    bytes: u64,
    sha256: String,
}
struct Catalog {
    identities: u64,
    recovery_pending: bool,
    archives: Vec<String>,
}

fn error() -> String {
    "加密备份无法验证；源保险库未修改。".into()
}
struct CleanerGuard(tauri::AppHandle);
impl Drop for CleanerGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}
struct ScratchGuard(PathBuf);
impl Drop for ScratchGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn bounded_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("请使用不含上级目录跳转的绝对文件路径。".into());
    }
    Ok(path)
}
fn checked_file(path: &Path) -> Result<fs::Metadata, String> {
    private::parents(path.parent().ok_or("备份文件路径无效。")?)?;
    private::safe(path)?;
    let meta = fs::symlink_metadata(path).map_err(|_| "备份文件无法读取。")?;
    if !meta.is_file() || meta.len() > MAX_BACKUP_BYTES {
        return Err("备份文件不是受支持的普通文件或超过大小上限。".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            return Err("拒绝带有多个硬链接的备份文件。".into());
        }
    }
    Ok(meta)
}
fn derive(password: &[u8], salt: &[u8; 16]) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0; 32]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(KDF_ROUNDS).unwrap(),
        salt,
        password,
        key.as_mut(),
    );
    key
}
fn write_envelope(mut out: fs::File, password: &[u8]) -> Result<codec::Seal<fs::File>, String> {
    let salt = codec::random::<16>()?;
    out.write_all(MAGIC)
        .and_then(|_| out.write_all(&KDF_ROUNDS.to_be_bytes()))
        .and_then(|_| out.write_all(&salt))
        .map_err(|_| error())?;
    let key = derive(password, &salt);
    codec::Seal::new(out, key.as_ref()).map_err(|_| error())
}
fn open_envelope(mut input: fs::File, password: &[u8]) -> Result<codec::Open<fs::File>, String> {
    let mut magic = [0; 8];
    let mut rounds = [0; 4];
    let mut salt = [0; 16];
    input
        .read_exact(&mut magic)
        .and_then(|_| input.read_exact(&mut rounds))
        .and_then(|_| input.read_exact(&mut salt))
        .map_err(|_| error())?;
    if &magic != MAGIC || u32::from_be_bytes(rounds) != KDF_ROUNDS {
        return Err(error());
    }
    let key = derive(password, &salt);
    codec::Open::new(input, key.as_ref()).map_err(|_| error())
}
fn validate_backup_entry(member_count: usize, name: &Path, size: u64) -> Result<(), String> {
    if member_count >= MAX_MEMBERS + 1 {
        return Err("备份成员数量超过安全上限。".into());
    }
    if name == Path::new("manifest.json") {
        if size > MAX_MANIFEST_BYTES {
            return Err("备份清单超过安全大小上限。".into());
        }
    } else if size > MAX_MEMBER_BYTES {
        return Err("备份成员超过单文件大小上限。".into());
    }
    Ok(())
}
fn digest(path: &Path) -> Result<(u64, String), String> {
    private::safe(path)?;
    let before = fs::symlink_metadata(path).map_err(|_| error())?;
    if !before.is_file() || before.len() > MAX_MEMBER_BYTES {
        return Err("保险库文件超过安全大小上限。".into());
    }
    let mut file = fs::File::open(path).map_err(|_| error())?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buffer).map_err(|_| error())?;
        if size == 0 {
            break;
        }
        total = total
            .checked_add(size as u64)
            .filter(|n| *n <= MAX_MEMBER_BYTES)
            .ok_or("保险库文件超过安全大小上限。")?;
        hash.update(&buffer[..size]);
    }
    let after = fs::symlink_metadata(path).map_err(|_| error())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("保险库文件在读取期间发生变化。".into());
    }
    Ok((total, format!("{:x}", hash.finalize())))
}
fn database_counts(db_path: &Path) -> Result<(u64, bool), String> {
    let db = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| error())?;
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| error())?;
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| error())?;
    if integrity != "ok" || version != 3 {
        return Err(error());
    }
    let identities: i64 = db
        .query_row("SELECT COUNT(*) FROM identities WHERE empty=0", [], |row| {
            row.get(0)
        })
        .map_err(|_| error())?;
    let state_exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='state')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| error())?;
    let recovery = state_exists
        && db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM state WHERE key='recovery')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| error())?;
    Ok((identities.max(0) as u64, recovery))
}
fn source_catalog(vault: &Path, reject_recovery: bool) -> Result<Catalog, String> {
    private::parents(vault)?;
    let db_path = vault.join("identities.sqlite");
    let key_path = vault.join("key.bin");
    private::safe(vault)?;
    private::safe(&db_path)?;
    private::safe(&key_path)?;
    if fs::metadata(&key_path)
        .map_err(|_| "身份主密钥缺失。")?
        .len()
        != 32
    {
        return Err("身份主密钥不完整。".into());
    }
    let db = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "身份索引无法安全读取。".to_string())?;
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| error())?;
    if integrity != "ok" {
        return Err("身份数据库完整性检查失败。".into());
    }
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| error())?;
    if version != 3 {
        return Err("身份数据库版本不是受支持的 SQLite v3。".into());
    }
    let identities: i64 = db
        .query_row("SELECT COUNT(*) FROM identities WHERE empty=0", [], |row| {
            row.get(0)
        })
        .map_err(|_| error())?;
    let recovery_exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='state')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| error())?;
    let recovery_pending = recovery_exists
        && db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM state WHERE key='recovery')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| error())?;
    if reject_recovery && recovery_pending {
        return Err("身份恢复事务尚未完成；可在显式救援模式创建加密副本。".into());
    }
    let mut stmt = db
        .prepare("SELECT archive FROM identities ORDER BY archive")
        .map_err(|_| error())?;
    let archives = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| error())?;
    let mut unique = std::collections::BTreeSet::new();
    for archive in &archives {
        if archive.len() > MAX_PATH_BYTES
            || archive.contains(['/', '\\', ':'])
            || archive == "."
            || archive == ".."
            || !archive.ends_with(".baga")
            || !unique.insert(archive.clone())
        {
            return Err("身份索引引用了无效或重复的归档。".into());
        }
        private::safe(&vault.join(archive))?;
    }
    Ok(Catalog {
        identities: identities.max(0) as u64,
        recovery_pending,
        archives: unique.into_iter().collect(),
    })
}
fn backup_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        let _ = fs::remove_file(destination);
    }
    drop(private::create(destination)?);
    let input = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法打开身份索引快照。".to_string())?;
    let mut output = Connection::open(destination).map_err(|_| error())?;
    let backup = Backup::new(&input, &mut output).map_err(|_| error())?;
    backup
        .run_to_completion(64, Duration::from_millis(20), None)
        .map_err(|_| error())?;
    drop(backup);
    output.close().map_err(|_| error())?;
    Ok(())
}
fn collect_files(
    vault: &Path,
    catalog: &Catalog,
    snapshot: &Path,
) -> Result<Vec<(String, PathBuf, u64, String)>, String> {
    let mut files = Vec::with_capacity(catalog.archives.len() + 2);
    files.push((
        "identity-vault/identities.sqlite".into(),
        snapshot.to_path_buf(),
    ));
    files.push(("identity-vault/key.bin".into(), vault.join("key.bin")));
    for name in &catalog.archives {
        files.push((format!("identity-vault/{name}"), vault.join(name)));
    }
    let mut total = 0u64;
    let mut checked = Vec::with_capacity(files.len());
    for (name, path) in files {
        let (bytes, hash) = digest(&path)?;
        total = total
            .checked_add(bytes)
            .filter(|n| *n <= MAX_BACKUP_BYTES)
            .ok_or("身份保险库超过 16 GiB 备份上限。")?;
        checked.push((name, path, bytes, hash));
    }
    if checked.len() > MAX_MEMBERS {
        return Err("身份保险库文件数量超过安全上限。".into());
    }
    Ok(checked)
}
fn archive_filename(name: &str) -> bool {
    name.strip_suffix(".baga").is_some_and(super::valid_id)
}
fn rescue_files(
    vault: &Path,
    hash_files: bool,
) -> Result<(Vec<(String, PathBuf, u64, String)>, Vec<String>), String> {
    let mut diagnostics = Vec::new();
    let mut files = Vec::new();
    let Ok(meta) = fs::symlink_metadata(vault) else {
        return Ok((files, vec!["vault_missing".into()]));
    };
    if !meta.is_dir() || crate::cleaner::linked(&meta) {
        return Err("身份保险库目录包含链接或特殊文件。".into());
    }
    private::safe(vault)?;
    let db = vault.join("identities.sqlite");
    let wal = vault.join("identities.sqlite-wal");
    let key = vault.join("key.bin");
    if wal.exists() || PathBuf::from(format!("{}-shm", db.display())).exists() {
        diagnostics.push("database_sidecar_present".into());
    }
    for (path, code) in [(&db, "database_missing"), (&key, "master_key_missing")] {
        if !path.exists() {
            diagnostics.push(code.into());
        } else if !path.is_file() {
            diagnostics.push(
                if code == "database_missing" {
                    "database_unreadable"
                } else {
                    "master_key_unreadable"
                }
                .into(),
            );
        }
    }
    let mut candidates = vec![db.clone(), key.clone(), wal.clone()];
    let entries = fs::read_dir(vault).map_err(|_| "身份保险库目录无法只读检查。".to_string())?;
    let mut archive_candidates = 0usize;
    for item in entries {
        let entry = item.map_err(|_| "身份保险库目录无法只读检查。".to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !archive_filename(&name) {
            continue;
        }
        archive_candidates += 1;
        if archive_candidates > MAX_MEMBERS - 3 {
            return Err("身份归档数量超过救援副本上限。".into());
        }
        candidates.push(entry.path());
    }
    for path in candidates {
        if !path.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(error)?;
        if private::safe(&path).is_err() {
            diagnostics.push(
                if name == "identities.sqlite" || name == "identities.sqlite-wal" {
                    "database_unreadable"
                } else if name == "key.bin" {
                    "master_key_unreadable"
                } else {
                    "archive_unreadable"
                }
                .into(),
            );
            continue;
        }
        let measured = if hash_files {
            digest(&path)
        } else {
            fs::metadata(&path).map_err(|_| error()).and_then(|meta| {
                if !meta.is_file() || meta.len() > MAX_MEMBER_BYTES {
                    Err("保险库文件超过安全大小上限。".into())
                } else {
                    Ok((meta.len(), String::new()))
                }
            })
        };
        match measured {
            Ok((bytes, hash)) => files.push((format!("identity-vault/{name}"), path, bytes, hash)),
            Err(_) => diagnostics.push(
                if name == "identities.sqlite" || name == "identities.sqlite-wal" {
                    "database_unreadable"
                } else if name == "key.bin" {
                    "master_key_unreadable"
                } else {
                    "archive_unreadable"
                }
                .into(),
            ),
        }
    }
    if files.is_empty() {
        diagnostics.push("no_readable_evidence".into());
    }
    let mut total = 0u64;
    for (_, _, bytes, _) in &files {
        total = total
            .checked_add(*bytes)
            .filter(|n| *n <= MAX_BACKUP_BYTES)
            .ok_or("救援副本超过 16 GiB 安全上限。")?;
    }
    if files
        .iter()
        .any(|(name, _, _, _)| name.ends_with("identities.sqlite"))
    {
        match database_counts(&db) {
            Ok((_, true)) => diagnostics.push("recovery_pending".into()),
            Ok(_) => {}
            Err(_) => diagnostics.push("database_unverified".into()),
        }
    }
    if files
        .iter()
        .any(|(name, _, _, _)| name.ends_with("key.bin"))
        && fs::metadata(&key)
            .map(|meta| meta.len() != 32)
            .unwrap_or(true)
    {
        diagnostics.push("master_key_invalid".into());
    }
    diagnostics.sort();
    diagnostics.dedup();
    Ok((files, diagnostics))
}
fn make_manifest(
    catalog: &Catalog,
    files: &[(String, PathBuf, u64, String)],
) -> Result<Manifest, String> {
    Ok(Manifest {
        version: 1,
        mode: "full".into(),
        saved_identities: catalog.identities,
        archives: catalog.archives.len() as u64,
        diagnostics: Vec::new(),
        files: files
            .iter()
            .map(|(path, _, bytes, sha256)| ManifestFile {
                path: path.clone(),
                bytes: *bytes,
                sha256: sha256.clone(),
            })
            .collect(),
    })
}
fn make_rescue_manifest(
    saved_identities: u64,
    archives: u64,
    diagnostics: Vec<String>,
    files: &[(String, PathBuf, u64, String)],
) -> Manifest {
    Manifest {
        version: 1,
        mode: "rescue".into(),
        saved_identities,
        archives,
        diagnostics,
        files: files
            .iter()
            .map(|(path, _, bytes, sha256)| ManifestFile {
                path: path.clone(),
                bytes: *bytes,
                sha256: sha256.clone(),
            })
            .collect(),
    }
}
fn write_tar<W: Write>(
    writer: W,
    manifest: &Manifest,
    files: &[(String, PathBuf, u64, String)],
) -> Result<W, String> {
    let mut tar = tar::Builder::new(writer);
    let manifest_bytes = serde_json::to_vec(manifest).map_err(|_| error())?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("备份清单超过安全大小上限。".into());
    }
    let mut header = tar::Header::new_gnu();
    header.set_size(manifest_bytes.len() as u64);
    header.set_mode(0o600);
    header.set_cksum();
    tar.append_data(&mut header, "manifest.json", manifest_bytes.as_slice())
        .map_err(|_| error())?;
    for (name, path, bytes, _) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(*bytes);
        header.set_mode(0o600);
        header.set_cksum();
        tar.append_data(
            &mut header,
            name,
            fs::File::open(path).map_err(|_| error())?,
        )
        .map_err(|_| error())?;
    }
    tar.into_inner().map_err(|_| error())
}
fn authenticate_inner_archive(
    path: &Path,
    master: &[u8],
    expected_id: &str,
    expected_account_key: Option<&str>,
) -> Result<(), String> {
    let input = fs::File::open(path).map_err(|_| error())?;
    let opened =
        codec::Open::new(input, master).map_err(|_| "某个身份归档无法认证。".to_string())?;
    let mut decoded =
        super::compression::decode(opened).map_err(|_| "某个身份归档无法解压验证。".to_string())?;
    let mut tar = tar::Archive::new(&mut decoded);
    let mut names = std::collections::HashSet::new();
    let mut total = 0u64;
    let mut inner_manifest: Option<super::archive::Manifest> = None;
    let mut kinds = std::collections::HashMap::new();
    for item in tar
        .entries()
        .map_err(|_| "某个身份归档内容无效。".to_string())?
    {
        let mut entry = item.map_err(|_| "某个身份归档内容无效。".to_string())?;
        let name = entry.path().map_err(|_| error())?.into_owned();
        if names.len() >= MAX_INNER_MEMBERS {
            return Err("某个身份归档成员数量超过安全上限。".into());
        }
        if name.as_os_str().is_empty()
            || name.to_string_lossy().len() > MAX_INNER_PATH_BYTES
            || name
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || !names.insert(name.clone())
        {
            return Err("某个身份归档包含重复或不安全成员。".into());
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("某个身份归档包含链接或特殊文件。".into());
        }
        kinds.insert(name.clone(), kind.is_dir());
        if kind.is_file() {
            total = total
                .checked_add(entry.size())
                .filter(|n| *n <= MAX_INNER_TOTAL_BYTES)
                .ok_or("某个身份归档超过安全大小上限。")?;
            if name == Path::new("manifest.json") {
                if entry.size() > MAX_INNER_MANIFEST_BYTES {
                    return Err("某个身份归档清单超过大小上限。".into());
                }
                let mut manifest_bytes = Vec::with_capacity(entry.size() as usize);
                entry
                    .read_to_end(&mut manifest_bytes)
                    .map_err(|_| "某个身份归档清单无法读取。".to_string())?;
                let parsed: super::archive::Manifest = serde_json::from_slice(&manifest_bytes)
                    .map_err(|_| "某个身份归档清单格式无效。".to_string())?;
                inner_manifest = Some(parsed);
            } else {
                io::copy(&mut entry, &mut io::sink())
                    .map_err(|_| "某个身份归档无法完整读取。".to_string())?;
            }
        }
    }
    drop(tar);
    io::copy(&mut decoded, &mut io::sink())
        .map_err(|_| "某个身份归档无法完整认证。".to_string())?;

    let manifest = inner_manifest.ok_or_else(|| "某个身份归档缺少清单。".to_string())?;
    if manifest.version != 1 {
        return Err("某个身份归档版本无效。".into());
    }
    if manifest.id != expected_id {
        return Err("某个身份归档编号与记录不匹配。".into());
    }
    if manifest.sources.len() != manifest.fingerprints.len() {
        return Err("某个身份归档特征集长度不匹配。".into());
    }
    if let (Some(m_key), Some(e_key)) = (manifest.account_key.as_deref(), expected_account_key) {
        if m_key != e_key {
            return Err("某个身份归档账号签名与记录不匹配。".into());
        }
    }
    if manifest
        .sources
        .iter()
        .any(|source| !crate::cleaner::identity::allowed(&manifest.home, source))
    {
        return Err("某个身份归档包含超出允许范围的源路径。".into());
    }
    let expected_data: std::collections::BTreeSet<usize> = (0..manifest.sources.len()).collect();
    let mut observed_data = std::collections::BTreeSet::new();
    for path in &names {
        if path == Path::new("manifest.json") {
            continue;
        }
        if path == Path::new("data") {
            if kinds.get(path) != Some(&true) {
                return Err("某个身份归档包含非法数据根成员。".into());
            }
            continue;
        }
        let mut components = path.components();
        if components.next() != Some(Component::Normal("data".as_ref())) {
            return Err("某个身份归档包含非法路径成员。".into());
        }
        let second = components.next().ok_or("某个身份归档包含非法路径成员。")?;
        let index_str = second.as_os_str().to_string_lossy();
        let index: usize = index_str
            .parse()
            .map_err(|_| "某个身份归档包含非法数据槽。".to_string())?;
        if index.to_string() != index_str || index >= manifest.sources.len() {
            return Err("某个身份归档数据槽超出声明范围。".into());
        }
        observed_data.insert(index);
    }
    if observed_data != expected_data {
        return Err("某个身份归档缺少声明的数据槽。".into());
    }
    Ok(())
}
fn verify_staged(
    root: &Path,
    expected_recovery: Option<bool>,
) -> Result<(Catalog, Manifest), String> {
    let manifest_path = root.join("manifest.json");
    let meta = fs::metadata(&manifest_path).map_err(|_| error())?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(error());
    }
    let manifest: Manifest =
        serde_json::from_reader(fs::File::open(&manifest_path).map_err(|_| error())?)
            .map_err(|_| error())?;
    if manifest.version != 1
        || manifest.mode != "full"
        || !manifest.diagnostics.is_empty()
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_MEMBERS
    {
        return Err(error());
    }
    let vault = root.join("identity-vault");
    let key_path = vault.join("key.bin");
    let mut key_file = fs::File::open(&key_path).map_err(|_| error())?;
    let mut key_bytes = Zeroizing::new([0u8; 32]);
    key_file
        .read_exact(key_bytes.as_mut())
        .map_err(|_| "备份中的身份主密钥长度无效。".to_string())?;
    if key_file.read(&mut [0u8; 1]).map_err(|_| error())? != 0 {
        return Err("备份中的身份主密钥长度无效。".into());
    }
    let catalog = source_catalog(&vault, false)?;
    if catalog.identities != manifest.saved_identities
        || catalog.archives.len() as u64 != manifest.archives
        || expected_recovery.is_some_and(|expected| catalog.recovery_pending != expected)
    {
        return Err("备份清单与 SQLite 身份/恢复状态数量不匹配。".into());
    }
    let expected: std::collections::BTreeSet<String> =
        std::iter::once("identity-vault/identities.sqlite".to_string())
            .chain(std::iter::once("identity-vault/key.bin".to_string()))
            .chain(
                catalog
                    .archives
                    .iter()
                    .map(|name| format!("identity-vault/{name}")),
            )
            .collect();
    let mut got = std::collections::BTreeSet::new();
    let mut total = 0u64;
    for file in &manifest.files {
        if file.path.len() > MAX_PATH_BYTES
            || file
                .path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !expected.contains(&file.path)
            || !got.insert(file.path.clone())
            || file.sha256.len() != 64
        {
            return Err("备份清单包含重复、额外或不安全成员。".into());
        }
        let path = root.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let (bytes, hash) = digest(&path)?;
        total = total
            .checked_add(bytes)
            .filter(|n| *n <= MAX_BACKUP_BYTES)
            .ok_or("备份超过安全大小上限。")?;
        if bytes != file.bytes || hash != file.sha256 {
            return Err("备份成员哈希与清单不符。".into());
        }
    }
    if got != expected {
        return Err("备份缺少必要身份文件或归档。".into());
    }
    let db = Connection::open_with_flags(
        &vault.join("identities.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| error())?;
    for archive in &catalog.archives {
        let (record_id, record_account_key): (String, Option<String>) = db
            .query_row(
                "SELECT id, account_key FROM identities WHERE archive = ?1",
                [archive],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "身份索引缺少归档对应记录。".to_string())?;
        authenticate_inner_archive(
            &vault.join(archive),
            key_bytes.as_ref(),
            &record_id,
            record_account_key.as_deref(),
        )?;
    }
    Ok((catalog, manifest))
}
fn verify_rescue_staged(root: &Path) -> Result<Manifest, String> {
    let manifest_path = root.join("manifest.json");
    let metadata = fs::metadata(&manifest_path).map_err(|_| error())?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(error());
    }
    let manifest: Manifest =
        serde_json::from_reader(fs::File::open(manifest_path).map_err(|_| error())?)
            .map_err(|_| error())?;
    if manifest.version != 1
        || manifest.mode != "rescue"
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_MEMBERS
    {
        return Err(error());
    }
    let mut names = std::collections::BTreeSet::new();
    let mut total = 0u64;
    let mut archive_count = 0u64;
    for file in &manifest.files {
        if file.path.len() > MAX_PATH_BYTES
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !names.insert(file.path.clone())
        {
            return Err("加密救援包清单包含无效成员。".into());
        }
        let relative = file
            .path
            .strip_prefix("identity-vault/")
            .ok_or_else(error)?;
        if !matches!(
            relative,
            "identities.sqlite" | "identities.sqlite-wal" | "key.bin"
        ) && !archive_filename(relative)
        {
            return Err("加密救援包包含不允许的证据文件。".into());
        }
        if archive_filename(relative) {
            archive_count += 1;
        }
        let path = root.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let (bytes, hash) = digest(&path)?;
        total = total
            .checked_add(bytes)
            .filter(|n| *n <= MAX_BACKUP_BYTES)
            .ok_or("救援副本超过 16 GiB 安全上限。")?;
        if bytes != file.bytes || hash != file.sha256 {
            return Err("加密救援包哈希校验失败。".into());
        }
    }
    if archive_count != manifest.archives
        || manifest.diagnostics.iter().any(|code| {
            !matches!(
                code.as_str(),
                "vault_missing"
                    | "database_missing"
                    | "database_unreadable"
                    | "database_unverified"
                    | "catalog_unverified"
                    | "master_key_missing"
                    | "master_key_unreadable"
                    | "master_key_invalid"
                    | "archive_unreadable"
                    | "no_readable_evidence"
                    | "recovery_pending"
                    | "database_sidecar_present"
            )
        })
    {
        return Err("加密救援包清单状态无效。".into());
    }
    let expected: std::collections::BTreeSet<String> = std::iter::once("manifest.json".to_string())
        .chain(manifest.files.iter().map(|file| file.path.clone()))
        .collect();
    let mut found = std::collections::BTreeSet::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for item in fs::read_dir(directory).map_err(|_| error())? {
            let item = item.map_err(|_| error())?;
            let metadata = fs::symlink_metadata(item.path()).map_err(|_| error())?;
            if metadata.is_dir() {
                pending.push(item.path());
            } else if metadata.is_file() {
                found.insert(
                    item.path()
                        .strip_prefix(root)
                        .map_err(|_| error())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            } else {
                return Err("救援副本暂存区包含特殊文件。".into());
            }
        }
    }
    if found != expected {
        return Err("加密救援包成员与清单不匹配。".into());
    }
    Ok(manifest)
}
fn create_private_dir(path: &Path) -> Result<(), String> {
    private::directory(path)
}
fn new_private_dir(parent: &Path, stem: &str) -> Result<PathBuf, String> {
    private::directory(parent)?;
    for _ in 0..8 {
        let path = parent.join(format!("{stem}-{}", super::new_id()?));
        match private::create_new_directory(&path)? {
            true => return Ok(path),
            false => continue,
        }
    }
    Err("无法创建独占的私有备份目录。".into())
}
fn stage_archive(
    path: &Path,
    parent: &Path,
    password: &[u8],
    rescue_mode: bool,
) -> Result<(PathBuf, Manifest, bool), String> {
    checked_file(path)?;
    let stage = new_private_dir(parent, "verify")?;
    let result = (|| {
        let mut reader = open_envelope(fs::File::open(path).map_err(|_| error())?, password)?;
        let mut archive = tar::Archive::new(&mut reader);
        let mut paths = std::collections::HashSet::new();
        let mut bytes_total = 0u64;
        for item in archive.entries().map_err(|_| error())? {
            let mut entry = item.map_err(|_| error())?;
            let name = entry.path().map_err(|_| error())?.into_owned();
            let member_count = paths.len();
            if name.as_os_str().is_empty()
                || name
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
                || !paths.insert(name.clone())
                || name.to_string_lossy().len() > MAX_PATH_BYTES
            {
                return Err("备份包含重复或不安全成员。".into());
            }
            validate_backup_entry(member_count, &name, entry.size())?;
            if name == Path::new("manifest.json") {
                if entry.header().entry_type().is_dir() {
                    return Err(error());
                }
            } else if !name.starts_with("identity-vault") {
                return Err("备份包含不受支持的额外内容。".into());
            }
            let kind = entry.header().entry_type();
            if !kind.is_file() {
                return Err("备份只允许普通文件成员。".into());
            }
            bytes_total = bytes_total
                .checked_add(entry.size())
                .filter(|n| *n <= MAX_BACKUP_BYTES)
                .ok_or("备份超过 16 GiB 安全上限。")?;
            let output = stage.join(&name);
            if output.parent().is_none() {
                return Err(error());
            }
            for parent in output
                .parent()
                .ok_or_else(error)?
                .ancestors()
                .take_while(|p| *p != stage.parent().unwrap())
            {
                if parent != stage {
                    create_private_dir(parent)?;
                }
            }
            let mut target = private::create(&output)?;
            io::copy(&mut entry, &mut target).map_err(|_| error())?;
            target.sync_all().map_err(|_| error())?;
        }
        drop(archive);
        io::copy(&mut reader, &mut io::sink()).map_err(|_| error())?;
        if !paths.contains(Path::new("manifest.json")) {
            return Err(error());
        }
        let manifest_path = stage.join("manifest.json");
        let manifest: Manifest =
            serde_json::from_reader(fs::File::open(manifest_path).map_err(|_| error())?)
                .map_err(|_| error())?;
        let expected: std::collections::BTreeSet<String> =
            std::iter::once("manifest.json".to_string())
                .chain(manifest.files.iter().map(|file| file.path.clone()))
                .collect();
        if paths
            .iter()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect::<std::collections::BTreeSet<_>>()
            != expected
        {
            return Err("备份文件成员与清单不匹配。".into());
        }
        let recovery_pending = manifest
            .diagnostics
            .iter()
            .any(|code| code == "recovery_pending");
        match manifest.mode.as_str() {
            "full" => {
                let (catalog, _) = verify_staged(&stage, None)?;
                if catalog.recovery_pending && !rescue_mode {
                    return Err("此副本包含未完成恢复状态；请显式选择救援模式。".into());
                }
                Ok((manifest, catalog.recovery_pending))
            }
            "rescue" => {
                let checked = verify_rescue_staged(&stage)?;
                Ok((checked, recovery_pending))
            }
            _ => Err(error()),
        }
    })();
    match result {
        Ok((manifest, recovery)) => Ok((stage, manifest, recovery)),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn identities_backup_location(app: tauri::AppHandle) -> Result<BackupLocation, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "产品资料目录无法定位。")?;
    let vault = root.join("identity-vault");
    Ok(BackupLocation {
        app_data_dir: root.to_string_lossy().into_owned(),
        vault_available: vault.exists(),
    })
}
#[tauri::command]
pub async fn identities_backup_open_location(app: tauri::AppHandle) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "产品资料目录无法定位。")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(root)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "无法打开产品资料目录。")?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(root)
            .spawn()
            .map_err(|_| "无法打开产品资料目录。")?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(root)
            .spawn()
            .map_err(|_| "无法打开产品资料目录。")?;
    }
    Ok(())
}
#[tauri::command]
pub async fn identities_backup_preview(app: tauri::AppHandle) -> Result<BackupPreview, String> {
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    let _guard = CleanerGuard(app.clone());
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "产品资料目录无法定位。")?
        .join("identity-vault");
    let catalog = source_catalog(&root, false);
    let (evidence, mut diagnostics) = rescue_files(&root, false)?;
    if catalog.is_err() && diagnostics.is_empty() {
        diagnostics.push("catalog_unverified".into());
    }
    let (saved_identities, recovery_pending) = catalog
        .as_ref()
        .map(|catalog| (catalog.identities, catalog.recovery_pending))
        .ok()
        .or_else(|| database_counts(&root.join("identities.sqlite")).ok())
        .unwrap_or((0, false));
    if recovery_pending && !diagnostics.iter().any(|value| value == "recovery_pending") {
        diagnostics.push("recovery_pending".into());
    }
    let archives = catalog
        .as_ref()
        .map(|catalog| catalog.archives.len() as u64)
        .unwrap_or_else(|_| {
            evidence
                .iter()
                .filter(|(name, _, _, _)| name.ends_with(".baga"))
                .count() as u64
        });
    let mut bytes = 0u64;
    for (_, _, length, _) in &evidence {
        bytes = bytes
            .checked_add(*length)
            .filter(|n| *n <= MAX_BACKUP_BYTES)
            .ok_or("身份保险库超过 16 GiB 备份上限。")?;
    }
    Ok(BackupPreview {
        valid: catalog.is_ok() && !recovery_pending,
        rescue_available: !evidence.is_empty(),
        saved_identities,
        archives,
        estimated_bytes: bytes,
        recovery_pending,
        diagnostics,
    })
}
#[tauri::command]
pub async fn identities_backup_export(
    app: tauri::AppHandle,
    path: String,
    passphrase: String,
    confirmation: String,
    rescue_mode: bool,
) -> Result<BackupReceipt, String> {
    let password = Zeroizing::new(passphrase.into_bytes());
    let confirmation = Zeroizing::new(confirmation.into_bytes());
    if password.len() < 12
        || password.len() > 1024
        || password.as_slice() != confirmation.as_slice()
    {
        return Err("请填写至少 12 个字符且两次一致的备份口令。".into());
    }
    let path = bounded_path(&path)?;
    private::parents(path.parent().ok_or("备份文件路径无效。")?)?;
    if fs::symlink_metadata(&path).is_ok() {
        return Err("目标文件已存在；备份不会覆盖现有文件。".into());
    }
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    let _guard = CleanerGuard(app.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let vault = app
            .path()
            .app_data_dir()
            .map_err(|_| "产品资料目录无法定位。")?
            .join("identity-vault");
        let parent = app
            .path()
            .app_data_dir()
            .map_err(|_| "产品资料目录无法定位。")?
            .join("backup-staging");
        let (files, manifest, _scratch) = if rescue_mode {
            let (files, mut diagnostics) = rescue_files(&vault, true)?;
            if files.is_empty() {
                return Err("没有可读的身份保险库证据，无法创建救援副本。".into());
            }
            let (saved_identities, recovery) =
                database_counts(&vault.join("identities.sqlite")).unwrap_or((0, false));
            if recovery && !diagnostics.iter().any(|value| value == "recovery_pending") {
                diagnostics.push("recovery_pending".into());
            }
            let archives = files
                .iter()
                .filter(|(name, _, _, _)| name.ends_with(".baga"))
                .count() as u64;
            (
                files.clone(),
                make_rescue_manifest(saved_identities, archives, diagnostics, &files),
                None,
            )
        } else {
            let catalog = source_catalog(&vault, true)?;
            let stage = new_private_dir(&parent, "snapshot")?;
            let scratch = ScratchGuard(stage.clone());
            let snapshot = stage.join("identities.sqlite");
            backup_snapshot(&vault.join("identities.sqlite"), &snapshot)?;
            let files = collect_files(&vault, &catalog, &snapshot)?;
            let manifest = make_manifest(&catalog, &files)?;
            (files, manifest, Some(scratch))
        };
        let output = private::create(&path)?;
        let sealed = write_envelope(output, password.as_slice())?;
        let sealed = write_tar(sealed, &manifest, &files)?;
        let output = sealed.finish().map_err(|_| error())?;
        output.sync_all().map_err(|_| error())?;
        drop(output);
        let stage_parent = app
            .path()
            .app_data_dir()
            .map_err(|_| "产品资料目录无法定位。")?
            .join("backup-staging");
        let (verified_stage, verified_manifest, _) =
            stage_archive(&path, &stage_parent, password.as_slice(), rescue_mode)?;
        let _ = fs::remove_dir_all(verified_stage);
        let length = fs::metadata(&path).map_err(|_| error())?.len();
        Ok(BackupReceipt {
            path: path.to_string_lossy().into_owned(),
            saved_identities: verified_manifest.saved_identities,
            archives: verified_manifest.archives,
            bytes: length,
            encrypted: true,
            verified: !rescue_mode,
            rescue_copy: rescue_mode,
            source_preserved: true,
        })
    })
    .await
    .map_err(|_| "加密备份任务中断；源保险库未修改。".to_string())?
}
#[tauri::command]
pub async fn identities_backup_inspect(
    app: tauri::AppHandle,
    path: String,
    passphrase: String,
) -> Result<BackupInspection, String> {
    if passphrase.len() < 1 || passphrase.len() > 1024 {
        return Err("备份口令长度无效。".into());
    }
    let password = Zeroizing::new(passphrase.into_bytes());
    let path = bounded_path(&path)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "产品资料目录无法定位。")?;
    let (stage, manifest, recovery_pending) = stage_archive(
        &path,
        &root.join("backup-staging"),
        password.as_slice(),
        true,
    )?;
    let _ = fs::remove_dir_all(stage);
    Ok(BackupInspection {
        saved_identities: manifest.saved_identities,
        archives: manifest.archives,
        bytes: fs::metadata(path).map_err(|_| error())?.len(),
        verified: manifest.mode == "full",
        rescue_copy: manifest.mode == "rescue",
        recovery_pending,
        diagnostics: manifest.diagnostics,
    })
}
#[tauri::command]
pub async fn identities_backup_restore_new(
    app: tauri::AppHandle,
    path: String,
    passphrase: String,
) -> Result<RestoreReceipt, String> {
    if passphrase.len() < 1 || passphrase.len() > 1024 {
        return Err("备份口令长度无效。".into());
    }
    let password = Zeroizing::new(passphrase.into_bytes());
    let path = bounded_path(&path)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "产品资料目录无法定位。")?;
    let (stage, manifest, _) = stage_archive(
        &path,
        &root.join("backup-staging"),
        password.as_slice(),
        true,
    )?;
    let target_parent = root.join("restored-vaults");
    let destination = new_private_dir(&target_parent, "verified-copy")?;
    if manifest.mode == "rescue" {
        let evidence_root = destination.join("rescue-evidence");
        private::directory(&evidence_root)?;
        for file in &manifest.files {
            let relative = Path::new(&file.path);
            let target = evidence_root.join(relative);
            for parent in target
                .parent()
                .ok_or_else(error)?
                .ancestors()
                .take_while(|parent| *parent != evidence_root.parent().unwrap())
            {
                if parent != evidence_root {
                    private::directory(parent)?;
                }
            }
            copy_private(&stage.join(relative), &target)?;
        }
        let _ = fs::remove_dir_all(stage);
        return Ok(RestoreReceipt {
            path: evidence_root.to_string_lossy().into_owned(),
            saved_identities: manifest.saved_identities,
            archives: manifest.archives,
            verified: false,
            active_vault_changed: false,
            rescue_copy: true,
            source_preserved: true,
        });
    }
    let copy_vault = destination.join("identity-vault");
    private::directory(&copy_vault)?;
    for name in ["identities.sqlite", "key.bin"] {
        copy_private(
            &stage.join("identity-vault").join(name),
            &copy_vault.join(name),
        )?;
    }
    for file in &manifest.files {
        let rel = Path::new(&file.path);
        if let Some(name) = rel
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| name.ends_with(".baga"))
        {
            copy_private(&stage.join(rel), &copy_vault.join(name))?;
        }
    }
    let (catalog, _) = verify_staged(&stage, None)?;
    if catalog.identities != manifest.saved_identities
        || catalog.archives.len() as u64 != manifest.archives
    {
        return Err(error());
    }
    let copied_catalog = source_catalog(&copy_vault, false)?;
    if copied_catalog.identities != manifest.saved_identities
        || copied_catalog.archives.len() as u64 != manifest.archives
    {
        return Err("新恢复副本校验失败；原文件与备份均保留。".into());
    }
    let expected_hashes: std::collections::HashMap<_, _> = manifest
        .files
        .iter()
        .map(|f| (f.path.as_str(), (f.bytes, f.sha256.as_str())))
        .collect();
    for name in std::iter::once("identities.sqlite".to_string())
        .chain(std::iter::once("key.bin".to_string()))
        .chain(copied_catalog.archives.iter().cloned())
    {
        let relative = format!("identity-vault/{name}");
        let (bytes, hash) = digest(&copy_vault.join(&name))?;
        if expected_hashes
            .get(relative.as_str())
            .is_none_or(|expected| expected.0 != bytes || expected.1 != hash)
        {
            return Err("新恢复副本的哈希校验失败；原文件与备份均保留。".into());
        }
    }
    let _ = fs::remove_dir_all(stage);
    Ok(RestoreReceipt {
        path: destination.to_string_lossy().into_owned(),
        saved_identities: manifest.saved_identities,
        archives: manifest.archives,
        verified: true,
        active_vault_changed: false,
        rescue_copy: false,
        source_preserved: true,
    })
}
fn copy_private(source: &Path, target: &Path) -> Result<(), String> {
    private::safe(source)?;
    let mut input = fs::File::open(source).map_err(|_| error())?;
    let mut output = private::create(target)?;
    io::copy(&mut input, &mut output).map_err(|_| error())?;
    output.sync_all().map_err(|_| error())
}
