// [INPUT]: rusqlite/内嵌 SQLite、私有保险库目录和脱敏身份元数据与本机加盐的账号索引。
// [OUTPUT]: 默认联动/显式关闭保留、首身份预留编号与身份目录、保留策略、当前身份、SQLite v3 浏览器绑定、切换前目录快照与无残留回滚撤销（abort_pending / finish_transient_recovery）及身份移除事务；已初始化 v3 库的无写锁快速打开与首开/迁移的进程内串行化。
// [POS]: 保险库的索引事务；短期 Mutex 保护打开边界，v3 已就绪时跳过写事务与重复 DDL，未初始化或旧版本时以 IMMEDIATE 事务保护跨连接版本迁移与默认状态，凭据和会话正文仅进入加密归档。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex, time::Duration};
static DATABASE_OPEN: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    pub name: String,
    pub archive: String,
    pub saved_at: u64,
    pub bytes: u64,
    pub policy: super::Policy,
    pub empty: bool,
    #[serde(skip)]
    pub account_key: Option<String>,
}
pub struct Database {
    pub(super) connection: Connection,
}
pub(super) struct PreSwitchSnapshot {
    pub(super) prior_record: Option<Record>,
    pub(super) prior_summary_raw: Option<String>,
    pub(super) prior_active: Option<String>,
    pub(super) prior_active_since: Option<String>,
    pub(super) prior_record_binding: Option<(String, u32)>,
    pub(super) prior_target_binding: Option<(String, u32)>,
    pub(super) prior_browser_active: Option<String>,
    pub(super) prior_browser_enabled: Option<String>,
    pub(super) prior_browser_draft: Option<String>,
    pub(super) prior_browser_promotion: Option<String>,
}
pub(super) fn error(_: rusqlite::Error) -> String {
    "身份数据库无法读写；未提交身份切换。".into()
}
impl Database {
    pub fn open(root: &Path) -> Result<Self, String> {
        // A Windows private::create handle shares reads only until it is closed. A competing
        // SQLite open can silently fall back to read-only before BEGIN IMMEDIATE runs.
        // Serialize the entire creation/open/initialization boundary, including PRAGMAs;
        // release this guard before returning so normal Store operations can open other DBs.
        let _open_guard = DATABASE_OPEN
            .lock()
            .map_err(|_| "身份数据库初始化锁不可用；未提交身份切换。")?;
        if let Err(error) = super::private::directory(root) {
            // Another opener may have won the same create_new directory race.
            // Accept only the same safe, owned directory after validating it again.
            match std::fs::symlink_metadata(root) {
                Ok(meta) if meta.is_dir() && !crate::cleaner::linked(&meta) => {
                    super::private::safe(root)?;
                }
                _ => return Err(error),
            }
        }
        super::private::protect(root)?;
        let path = root.join("identities.sqlite");
        if !path.exists() {
            match super::private::create(&path) {
                Ok(file) => file.sync_all().map_err(|_| "无法创建身份数据库。")?,
                // A concurrent opener can win the exclusive create between exists() and create_new().
                Err(_error) if path.exists() => super::private::protect(&path)?,
                Err(error) => return Err(error),
            }
        }
        super::private::parents(root)?;
        super::private::protect(&path)?;
        let mut connection = Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(error)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(error)?;
        let initial_version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(error)?;
        if initial_version == 3 {
            let has_draft: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM state WHERE key='browser.draft')",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if has_draft {
                let _ = connection.execute_batch("PRAGMA synchronous=FULL;");
                return Ok(Self { connection });
            }
        }
        connection
            .execute_batch(
                "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
            )
            .map_err(error)?;
        // Acquire the write reservation before reading user_version so concurrent first-open
        // and migration callers cannot both make decisions from the same stale schema version.
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL, policy TEXT NOT NULL,empty INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS identity_summaries(id TEXT PRIMARY KEY,summary TEXT NOT NULL);
").map_err(error)?;
        let version: i64 = tx
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(error)?;
        if version < 2 {
            tx.execute_batch(
                "ALTER TABLE identities ADD COLUMN account_key TEXT; PRAGMA user_version=2;",
            )
            .map_err(error)?;
        } else if version > 3 {
            return Err("身份目录版本较新，请更新应用。".into());
        }
        tx.execute_batch("CREATE TABLE IF NOT EXISTS browser_bindings(identity TEXT PRIMARY KEY,slot TEXT NOT NULL UNIQUE,seed INTEGER NOT NULL UNIQUE); PRAGMA user_version=3;").map_err(error)?;
        // 未设置过的用户默认联动；显式关闭和已有资料指针始终保留。
        tx.execute_batch("INSERT OR IGNORE INTO state VALUES('browser.enabled','1'); INSERT OR IGNORE INTO state VALUES('browser.active','legacy');").map_err(error)?;
        tx.execute(
            "INSERT OR IGNORE INTO state VALUES('browser.draft',?1)",
            [super::new_id()?],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(Self { connection })
    }
    pub fn summaries(
        &self,
    ) -> Result<std::collections::BTreeMap<String, super::profile::Summary>, String> {
        let mut query = self
            .connection
            .prepare("SELECT id,summary FROM identity_summaries")
            .map_err(error)?;
        let rows = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(error)?;
        let mut map = std::collections::BTreeMap::new();
        for row in rows {
            let (id, raw) = row.map_err(error)?;
            if let Ok(summary) = serde_json::from_str::<super::profile::Summary>(&raw) {
                map.insert(id, summary);
            }
        }
        Ok(map)
    }
    pub fn set_summary(&self, id: &str, summary: &super::profile::Summary) -> Result<(), String> {
        let text = serde_json::to_string(summary).map_err(|_| "身份摘要无法保存。")?;
        self.connection
            .execute(
                "INSERT INTO identity_summaries(id,summary) VALUES(?1,?2)
                 ON CONFLICT(id) DO UPDATE SET summary=excluded.summary",
                params![id, text],
            )
            .map_err(error)?;
        Ok(())
    }
    pub fn records(&self) -> Result<Vec<Record>, String> {
        let mut query=self.connection.prepare("SELECT id,name,archive,saved_at,bytes,policy,empty,account_key FROM identities ORDER BY saved_at DESC,id").map_err(error)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(error)?;
        rows.map(|r| {
            let (id, name, archive, saved_at, bytes, policy, empty, account_key) =
                r.map_err(error)?;
            let saved_at = u64::try_from(saved_at).map_err(|_| "身份元数据无效。")?;
            let bytes = u64::try_from(bytes).map_err(|_| "身份元数据无效。")?;
            Ok(Record {
                id,
                name,
                archive,
                saved_at,
                bytes,
                empty,
                account_key,
                policy: serde_json::from_str(&policy).map_err(|_| "身份策略无法读取。")?,
            })
        })
        .collect()
    }
    pub fn by_account(&self, key: &str) -> Result<Option<Record>, String> {
        Ok(self
            .records()?
            .into_iter()
            .find(|r| r.account_key.as_deref() == Some(key)))
    }
    pub fn index(&self, id: &str, key: &str) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE identities SET account_key=?2 WHERE id=?1",
                params![id, key],
            )
            .map_err(error)?;
        Ok(())
    }
    pub fn prune_orphan_summaries(&self) -> Result<(), String> {
        if self.get("recovery")?.is_none() {
            self.connection
                .execute(
                    "DELETE FROM identity_summaries WHERE id NOT IN (SELECT id FROM identities WHERE empty = 0)",
                    [],
                )
                .map_err(error)?;
        }
        Ok(())
    }
    pub fn remove_empty(&self) -> Result<(), String> {
        if self.get("recovery")?.is_none() {
            self.connection
                .execute("DELETE FROM identities WHERE empty != 0", [])
                .map_err(error)?;
            self.prune_orphan_summaries()?;
        }
        Ok(())
    }
    pub fn compact(&mut self) -> Result<(), String> {
        if self.get("recovery")?.is_some() {
            return Ok(());
        }
        let records = self.records()?;
        let tx = self.connection.transaction().map_err(error)?;
        tx.execute("DELETE FROM identities WHERE empty != 0", [])
            .map_err(error)?;
        let mut seen = std::collections::HashMap::<String, String>::new();
        for record in records.into_iter().filter(|r| !r.empty) {
            if let Some(key) = record.account_key.filter(|k| !k.is_empty()) {
                if let Some(id) = seen.get(&key) {
                    super::browser_link::merge(&tx, &record.id, id)?;
                    tx.execute(
                        "UPDATE state SET value=?2 WHERE key='active' AND value=?1",
                        params![record.id, id],
                    )
                    .map_err(error)?;
                    tx.execute("DELETE FROM identity_summaries WHERE id=?1", [&record.id])
                        .map_err(error)?;
                    tx.execute("DELETE FROM identities WHERE id=?1", [record.id])
                        .map_err(error)?;
                } else {
                    seen.insert(key, record.id);
                }
            }
        }
        tx.execute(
            "DELETE FROM identity_summaries WHERE id NOT IN (SELECT id FROM identities WHERE empty = 0)",
            [],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        self.connection
            .query_row("SELECT value FROM state WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)
    }
    pub fn remember(&self, record: &Record) -> Result<(), String> {
        let saved_at = i64::try_from(record.saved_at).map_err(|_| "身份元数据无效。")?;
        let bytes = i64::try_from(record.bytes).map_err(|_| "身份元数据无效。")?;
        self.connection
            .execute(
                "INSERT INTO identities(id,name,archive,saved_at,bytes,policy,empty,account_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET archive=excluded.archive,saved_at=excluded.saved_at,bytes=excluded.bytes,policy=excluded.policy,empty=excluded.empty,account_key=excluded.account_key",
                params![
                    record.id,
                    record.name,
                    record.archive,
                    saved_at,
                    bytes,
                    serde_json::to_string(&record.policy).unwrap(),
                    record.empty,
                    record.account_key
                ],
            )
            .map_err(error)?;
        Ok(())
    }
    pub(super) fn snapshot_before_switch(
        &self,
        record_id: &str,
        target: &str,
    ) -> Result<PreSwitchSnapshot, String> {
        let prior_record = self.records()?.into_iter().find(|r| r.id == record_id);
        let prior_summary_raw = self
            .connection
            .query_row(
                "SELECT summary FROM identity_summaries WHERE id=?1",
                [record_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)?;
        let binding_for = |id: &str| -> Result<Option<(String, u32)>, String> {
            self.connection
                .query_row(
                    "SELECT slot,seed FROM browser_bindings WHERE identity=?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(error)
        };
        let prior_record_binding = binding_for(record_id)?;
        let prior_target_binding = if target != "empty" && target != record_id {
            binding_for(target)?
        } else {
            None
        };
        Ok(PreSwitchSnapshot {
            prior_record,
            prior_summary_raw,
            prior_active: self.get("active")?,
            prior_active_since: self.get("active_since")?,
            prior_record_binding,
            prior_target_binding,
            prior_browser_active: self.get("browser.active")?,
            prior_browser_enabled: self.get("browser.enabled")?,
            prior_browser_draft: self.get("browser.draft")?,
            prior_browser_promotion: self.get("browser.promotion")?,
        })
    }
    pub fn pending(&mut self, record: &Record, target: &str) -> Result<(), String> {
        let saved_at = i64::try_from(record.saved_at).map_err(|_| "身份元数据无效。")?;
        let bytes = i64::try_from(record.bytes).map_err(|_| "身份元数据无效。")?;
        let tx = self.connection.transaction().map_err(error)?;
        let existed: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM identities WHERE id=?1)",
                [&record.id],
                |r| r.get(0),
            )
            .map_err(error)?;
        tx.execute(
            "INSERT INTO identities(id,name,archive,saved_at,bytes,policy,empty,account_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET archive=excluded.archive,saved_at=excluded.saved_at,bytes=excluded.bytes,policy=excluded.policy,empty=excluded.empty,account_key=excluded.account_key",
            params![
                record.id,
                record.name,
                record.archive,
                saved_at,
                bytes,
                serde_json::to_string(&record.policy).unwrap(),
                record.empty,
                record.account_key
            ],
        )
        .map_err(error)?;
        tx.execute(
            "INSERT OR REPLACE INTO state VALUES('recovery',?1)",
            [&record.id],
        )
        .map_err(error)?;
        tx.execute("INSERT OR REPLACE INTO state VALUES('target',?1)", [target])
            .map_err(error)?;
        if existed {
            tx.execute("DELETE FROM state WHERE key='recovery_transient'", [])
                .map_err(error)?;
        } else {
            tx.execute(
                "INSERT OR REPLACE INTO state VALUES('recovery_transient','1')",
                [],
            )
            .map_err(error)?;
        }
        super::browser_link::pending(&tx, record, target)?;
        tx.commit().map_err(error)
    }
    pub(super) fn abort_pending(
        &mut self,
        snap: &PreSwitchSnapshot,
        record_id: &str,
        target: &str,
    ) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        if let Some(prev) = &snap.prior_record {
            let saved_at = i64::try_from(prev.saved_at).map_err(|_| "身份元数据无效。")?;
            let bytes = i64::try_from(prev.bytes).map_err(|_| "身份元数据无效。")?;
            tx.execute(
                "INSERT INTO identities(id,name,archive,saved_at,bytes,policy,empty,account_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,archive=excluded.archive,saved_at=excluded.saved_at,bytes=excluded.bytes,policy=excluded.policy,empty=excluded.empty,account_key=excluded.account_key",
                params![
                    prev.id,
                    prev.name,
                    prev.archive,
                    saved_at,
                    bytes,
                    serde_json::to_string(&prev.policy).unwrap(),
                    prev.empty,
                    prev.account_key
                ],
            )
            .map_err(error)?;
            if let Some(raw) = &snap.prior_summary_raw {
                tx.execute(
                    "INSERT OR REPLACE INTO identity_summaries(id,summary) VALUES(?1,?2)",
                    params![record_id, raw],
                )
                .map_err(error)?;
            } else {
                tx.execute("DELETE FROM identity_summaries WHERE id=?1", [record_id])
                    .map_err(error)?;
            }
        } else {
            tx.execute("DELETE FROM identity_summaries WHERE id=?1", [record_id])
                .map_err(error)?;
            tx.execute("DELETE FROM identities WHERE id=?1", [record_id])
                .map_err(error)?;
        }
        if let Some((slot, seed)) = &snap.prior_record_binding {
            tx.execute(
                "INSERT OR REPLACE INTO browser_bindings(identity,slot,seed) VALUES(?1,?2,?3)",
                params![record_id, slot, seed],
            )
            .map_err(error)?;
        } else {
            tx.execute("DELETE FROM browser_bindings WHERE identity=?1", [record_id])
                .map_err(error)?;
        }
        if target != "empty" && target != record_id && snap.prior_target_binding.is_none() {
            tx.execute("DELETE FROM browser_bindings WHERE identity=?1", [target])
                .map_err(error)?;
        }
        tx.execute(
            "DELETE FROM state WHERE key IN ('recovery','target','recovery_transient','browser.previous','browser.next')",
            [],
        )
        .map_err(error)?;
        let restore_key = |key: &str, value: &Option<String>| -> Result<(), String> {
            match value {
                Some(v) => tx
                    .execute("INSERT OR REPLACE INTO state VALUES(?1,?2)", params![key, v])
                    .map_err(error)?,
                None => tx
                    .execute("DELETE FROM state WHERE key=?1", [key])
                    .map_err(error)?,
            };
            Ok(())
        };
        restore_key("active", &snap.prior_active)?;
        restore_key("active_since", &snap.prior_active_since)?;
        restore_key("browser.active", &snap.prior_browser_active)?;
        restore_key("browser.enabled", &snap.prior_browser_enabled)?;
        restore_key("browser.draft", &snap.prior_browser_draft)?;
        if snap.prior_browser_promotion.is_some() {
            super::browser_link::abort_promotion(&tx)?;
        }
        tx.commit().map_err(error)
    }
    pub(super) fn finish_transient_recovery(
        &mut self,
        transient_id: &str,
        restored_empty: bool,
    ) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        let previous_slot: Option<String> = tx
            .query_row(
                "SELECT value FROM state WHERE key='browser.previous'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)?;
        if let Some(slot) = previous_slot.filter(|s| super::browser_link::valid_slot(s)) {
            tx.execute(
                "INSERT OR REPLACE INTO state VALUES('browser.active',?1)",
                [slot],
            )
            .map_err(error)?;
        }
        super::browser_link::abort_promotion(&tx)?;
        tx.execute(
            "DELETE FROM state WHERE key IN ('recovery','target','recovery_transient','browser.previous','browser.next')",
            [],
        )
        .map_err(error)?;
        tx.execute("DELETE FROM identity_summaries WHERE id=?1", [transient_id])
            .map_err(error)?;
        tx.execute("DELETE FROM identities WHERE id=?1", [transient_id])
            .map_err(error)?;
        tx.execute("DELETE FROM browser_bindings WHERE identity=?1", [transient_id])
            .map_err(error)?;
        if !restored_empty && super::valid_id(transient_id) {
            let legacy_unbound: bool = tx
                .query_row(
                    "SELECT COALESCE((SELECT value FROM state WHERE key='browser.active')='legacy', 0)
                        AND NOT EXISTS(SELECT 1 FROM browser_bindings WHERE slot='legacy')",
                    [],
                    |row| row.get(0),
                )
                .map_err(error)?;
            if legacy_unbound {
                tx.execute(
                    "INSERT OR IGNORE INTO state VALUES('browser.draft',?1)",
                    [transient_id],
                )
                .map_err(error)?;
            }
        }
        let next_active = if restored_empty { "empty" } else { "current" };
        tx.execute(
            "INSERT OR REPLACE INTO state VALUES('active',?1)",
            [next_active],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn complete(&mut self, active: &str) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        super::browser_link::complete(&tx, active)?;
        let pending_target: Option<String> = tx
            .query_row("SELECT value FROM state WHERE key='target'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        let pending_recovery: Option<String> = tx
            .query_row("SELECT value FROM state WHERE key='recovery'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        if pending_target.as_deref() == Some(active) && pending_recovery.as_deref() != Some(active)
        {
            let now_sec = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            tx.execute(
                "INSERT OR REPLACE INTO state VALUES('active_since',?1)",
                [now_sec.to_string()],
            )
            .map_err(error)?;
        }
        tx.execute("INSERT OR REPLACE INTO state VALUES('active',?1)", [active])
            .map_err(error)?;
        tx.execute(
            "DELETE FROM state WHERE key IN ('recovery','target','recovery_transient')",
            [],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn forget(&mut self, id: &str) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        if tx
            .execute("DELETE FROM identities WHERE id=?1", [id])
            .map_err(error)?
            == 0
        {
            return Err("身份不存在。".into());
        }
        tx.execute("DELETE FROM identity_summaries WHERE id=?1", [id])
            .map_err(error)?;
        tx.execute(
            "UPDATE state SET value='current' WHERE key='active' AND value=?1",
            [id],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        if self
            .connection
            .execute(
                "UPDATE identities SET name=?2 WHERE id=?1",
                params![id, name],
            )
            .map_err(error)?
            == 0
        {
            return Err("身份不存在。".into());
        }
        Ok(())
    }
}
