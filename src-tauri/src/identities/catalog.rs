// [INPUT]: 有界 OAuth 账号元数据、本机密钥、已认证旧归档与 SQLite 目录。
// [OUTPUT]: 稳定的本机 HMAC 账号索引、仅针对缺失摘要行的旧记录补建与已提交归档代次回收（未超 120 秒的新归档与 .pending-* 并发写入暂存予以保留）。
// [POS]: 只按账号 UUID/组织（缺失时邮箱/组织）匹配；令牌刷新、名称变更不产生新身份。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{database::Database, private, store::Store};
use ring::hmac;
use serde_json::Value;
use std::{fs, io::Read, path::Path};
pub(super) fn archive_name(name: &str) -> bool {
    name.strip_suffix(".baga").is_some_and(super::valid_id)
}
pub(super) fn account_key(value: &Value, key: &[u8]) -> Option<String> {
    let account = &value["oauthAccount"];
    let field = |name: &str| {
        account[name]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 254 && !s.chars().any(char::is_control))
    };
    let org = field("organizationUuid")
        .or_else(|| field("organizationName"))
        .unwrap_or("");
    let identity = if let Some(uuid) = field("accountUuid") {
        ("uuid", uuid.to_string(), org)
    } else {
        let email = field("emailAddress")?.to_lowercase();
        if !email.contains('@') {
            return None;
        }
        ("email", email, org)
    };
    let bytes = serde_json::to_vec(&identity).ok()?;
    let tag = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), &bytes);
    Some(tag.as_ref().iter().map(|b| format!("{b:02x}")).collect())
}
pub(super) fn file_key(path: &Path, key: &[u8]) -> Result<Option<String>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("身份账号索引无法读取。".into()),
    };
    private::parents(path.parent().ok_or("身份路径无效。")?)?;
    private::safe(path)?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return Ok(None);
    }
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    fs::File::open(path)
        .map_err(|_| "身份账号索引无法读取。")?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "身份账号索引无法读取。")?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "身份配置不是有效 JSON。")?;
    Ok(account_key(&value, key))
}
pub(super) fn live_key(home: &Path, key: &[u8]) -> Result<Option<String>, String> {
    file_key(&home.join(".claude.json"), key)
}
pub(crate) fn current_id(
    vault: &Path,
    home: &Path,
    db: &Database,
) -> Result<Option<String>, String> {
    let key_path = vault.join("key.bin");
    if !key_path.exists() {
        return Ok(None);
    }
    private::parents(vault)?;
    private::safe(&key_path)?;
    if fs::metadata(&key_path)
        .map_err(|_| "身份密钥无法读取。")?
        .len()
        != 32
    {
        return Err("身份密钥无效。".into());
    }
    let key = zeroize::Zeroizing::new(fs::read(key_path).map_err(|_| "身份密钥无法读取。")?);
    Ok(match live_key(home, &key)? {
        Some(key) => db.by_account(&key)?.map(|r| r.id),
        None => None,
    })
}
impl Store {
    pub(super) fn index_legacy(&self) -> Result<(), String> {
        let summaries = self.db.summaries()?;
        for record in self
            .db
            .records()?
            .into_iter()
            .filter(|r| r.account_key.is_none() || (!r.empty && !summaries.contains_key(&r.id)))
        {
            // 损坏的旧副本不自动删除；用户仍可单独删除或保留排查。
            let Ok(stage) = self.load(&record) else {
                continue;
            };
            if record.account_key.is_none() {
                let key = if let Some(key) = &stage.manifest.account_key {
                    Some(key.clone())
                } else if let Some(n) = stage
                    .manifest
                    .sources
                    .iter()
                    .position(|s| s.path == self.home.join(".claude.json"))
                {
                    file_key(&stage.path.join(format!("data/{n}")), &self.key)?
                } else {
                    None
                };
                self.db.index(&record.id, key.as_deref().unwrap_or(""))?;
            }
            if !record.empty {
                let _ = self.db.set_summary(
                    &record.id,
                    &super::profile::summarize_stage_with_ledger(&stage, &self.vault),
                );
            }
        }
        Ok(())
    }
    pub(super) fn remove_unreferenced_archive_now(&self, archive: &str) {
        if !archive_name(archive) {
            return;
        }
        let Ok(records) = self.db.records() else {
            return;
        };
        if records.iter().any(|r| r.archive == archive) {
            return;
        }
        let path = self.vault.join(archive);
        if private::safe(&path).is_ok() {
            let _ = fs::remove_file(&path);
        }
    }
    pub(super) fn collect_generations(&self) -> Result<(), String> {
        let records = self.db.records()?;
        for entry in fs::read_dir(&self.vault).map_err(|_| "身份保险库无法读取。")? {
            let entry = entry.map_err(|_| "身份保险库无法读取。")?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_aged = || {
                fs::symlink_metadata(entry.path())
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age.as_secs() >= 120)
            };
            let unreferenced_archive =
                archive_name(&name) && !records.iter().any(|r| r.archive == name) && is_aged();
            let stale_pending =
                name.strip_prefix(".pending-").is_some_and(super::valid_id) && is_aged();
            if unreferenced_archive || stale_pending {
                private::safe(&entry.path())?;
                fs::remove_file(entry.path()).map_err(|_| "旧身份归档回收失败。")?;
            }
        }
        private::sync_parent(&self.vault.join("identities.sqlite"));
        Ok(())
    }
}
