// [INPUT]: SQLite 目录、用户策略、白名单源、已验收归档代次、认证加密与平台凭据桥。
// [OUTPUT]: 有界主密钥读取、切号前纯后台守护进程优雅挂起（自动落盘 `adopt.json` 并保活脱离 Shell）、跨切号 `.claude/jobs/*/adopt.json` 保护（即使不保留历史也绝不误删待接管后台 Shell 句柄）、先暂存后切换（保留 120 秒内并发 .stage-* 目录）、`empty`/`delete("current")` 隔离设备 ID 预置与 `save_current` 碰撞保护、防封交接检查点（清理前只读捕获 `HandoffDraft` 并仅在 `db.complete` 后原子提交）、`settings.local.json` 代理对齐与切换后 `anonymousId`/`firstStartTime`/代理核验、Pass #4 `account`/`settings` TOCTOU 校验、子代理隔离槽位忙锁/租约拒绝与轮换凭据单调 expiresAt 安全回灌（sync_slot_credentials）、Windows 文件锁退避、单重故障自动无残留回滚、双重故障一键干净恢复（recover_clean）与显式命名恢复检查点（recover）、窄账号缓存与残留锁清场、独立养号转正草稿保护与真实阶段进度。
// [POS]: 身份的文件事务；SQLite 与文件系统由恢复日志与切换前目录快照协调，优先自动自愈回滚，极端中断保底零丢数据。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{
    archive::{walk, Stage},
    codec,
    database::{Database, Record},
    private, Policy,
};
use crate::{
    cleaner::identity::{self, Source},
    native,
    progress::Reporter,
};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;
pub struct Store {
    pub(super) vault: PathBuf,
    pub(super) home: PathBuf,
    pub(super) key: Zeroizing<Vec<u8>>,
    pub(super) db: Database,
    pub(super) suppress_browser_draft: bool,
    pub(crate) last_handoff: Option<(PathBuf, PathBuf)>,
    process_check: std::cell::Cell<std::time::Instant>,
    #[cfg(test)]
    pub(super) fail_before_clear: bool,
    #[cfg(test)]
    pub(super) fail_after_clear: bool,
    #[cfg(test)]
    pub(super) test_live_pids: Vec<i32>,
}
pub(super) fn problem(_: impl std::fmt::Display) -> String {
    "身份归档读写或验证失败；请保留暂存文件并重试。".into()
}
impl Store {
    pub fn open(vault: &Path, home: &Path) -> Result<Self, String> {
        let db = Database::open(vault)?;
        let key_path = vault.join("key.bin");
        if !key_path.exists() {
            if !db.records()?.is_empty()
                || fs::read_dir(vault).map_err(problem)?.any(|e| {
                    e.ok()
                        .is_some_and(|e| e.path().extension().is_some_and(|x| x == "baga"))
                })
            {
                return Err("身份密钥缺失；不能创建新密钥覆盖已有身份。".into());
            }
            private::write(&key_path, &codec::random::<32>()?)?;
        }
        private::protect(&key_path)?;
        let mut key = Zeroizing::new(Vec::with_capacity(33));
        fs::File::open(&key_path)
            .map_err(problem)?
            .take(33)
            .read_to_end(&mut *key)
            .map_err(problem)?;
        if key.len() != 32 {
            return Err("身份密钥无效。".into());
        }
        for entry in fs::read_dir(vault).map_err(problem)? {
            let p = entry.map_err(problem)?.path();
            if p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.strip_prefix(".stage-").is_some_and(super::valid_id))
            {
                let stale = fs::symlink_metadata(&p)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age.as_secs() >= 120);
                if stale {
                    private::safe(&p)?;
                    crate::cleaner::file_io::remove_dir_all_retry(&p).map_err(problem)?;
                }
            }
        }
        let records = db.records()?;
        for entry in fs::read_dir(vault).map_err(problem)? {
            let path = entry.map_err(problem)?.path();
            if let Some(id) = path
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix(".trash-"))
                .filter(|s| super::valid_id(s))
            {
                private::safe(&path)?;
                if let Some(record) = records.iter().find(|r| r.id == id) {
                    if !super::catalog::archive_name(&record.archive) {
                        return Err("身份归档编号无效。".into());
                    }
                    let original = vault.join(&record.archive);
                    if !original.exists() {
                        crate::cleaner::file_io::rename_retry(&path, &original).map_err(problem)?;
                    }
                } else {
                    crate::cleaner::file_io::remove_file_retry(&path).map_err(problem)?;
                }
            }
        }
        let store = Self {
            vault: vault.into(),
            home: home.into(),
            key,
            db,
            suppress_browser_draft: false,
            last_handoff: None,
            process_check: std::cell::Cell::new(std::time::Instant::now()),
            #[cfg(test)]
            fail_before_clear: false,
            #[cfg(test)]
            fail_after_clear: false,
            #[cfg(test)]
            test_live_pids: Vec::new(),
        };
        if store.db.get("recovery")?.is_none() {
            store.index_legacy()?;
            store.db.remove_empty()?;
            store.collect_generations()?;
        }
        Ok(store)
    }
    pub(crate) fn live_account_key(&self) -> Option<String> {
        super::catalog::live_key(&self.home, &self.key)
            .ok()
            .flatten()
    }
    pub(super) fn stopped(&self) -> Result<(), String> {
        #[cfg(test)]
        if identity::root().ok().as_ref() != Some(&self.home) {
            return Ok(());
        }
        self.process_check.set(std::time::Instant::now());
        identity::ensure_stopped_in(self.vault.parent())
    }
    fn slot_live_pids(&self, slot_dir: &Path) -> Vec<i32> {
        #[cfg_attr(not(test), allow(unused_mut))]
        let mut procs = identity::running_processes();
        #[cfg(test)]
        for &pid in &self.test_live_pids {
            if !procs.iter().any(|p| p.pid == pid) {
                procs.push(crate::cleaner::ClaudeProcess {
                    pid,
                    name: "claude.exe".into(),
                    executable: String::new(),
                    #[cfg(windows)]
                    created: 0,
                    #[cfg(windows)]
                    role: crate::cleaner::ClaudeProcessRole::InteractiveCli,
                    #[cfg(windows)]
                    child_shells: Vec::new(),
                });
            }
        }
        super::orchestrator::live_slot_pids_in_dir(slot_dir, &procs)
    }
    fn wait_for_slot_oauth_locks(slot_dir: &Path) {
        let mut lock_candidates = vec![
            slot_dir.join(".oauth_refresh.lock"),
            slot_dir.join(".oauth_refresh.lock.owner"),
            slot_dir.join(".storage-write.lock"),
            slot_dir.join(".claude.json.lock"),
        ];
        if let (Some(parent), Some(name)) = (
            slot_dir.parent(),
            slot_dir.file_name().and_then(|s| s.to_str()),
        ) {
            lock_candidates.push(parent.join(format!("{name}.lock")));
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        loop {
            let mut active_lock = false;
            for lock_path in &lock_candidates {
                let Ok(meta) = fs::symlink_metadata(lock_path) else {
                    continue;
                };
                if crate::cleaner::linked(&meta) {
                    continue;
                }
                let seen_mtime = meta.modified().ok();
                let stale = seen_mtime
                    .and_then(|m| std::time::SystemTime::now().duration_since(m).ok())
                    .is_some_and(|age| age.as_secs() >= 60);
                if stale {
                    if fs::symlink_metadata(lock_path)
                        .and_then(|m| m.modified())
                        .ok()
                        == seen_mtime
                    {
                        if meta.is_dir() {
                            let _ = crate::cleaner::file_io::remove_dir_all_retry(lock_path);
                        } else {
                            let _ = fs::remove_file(lock_path);
                        }
                    }
                } else {
                    active_lock = true;
                }
            }
            if !active_lock || std::time::Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    fn oauth_expires_at(obj: &serde_json::Map<String, serde_json::Value>) -> Option<i64> {
        let exp = obj.get("claudeAiOauth")?.get("expiresAt")?;
        exp.as_i64()
            .or_else(|| exp.as_u64().and_then(|u| i64::try_from(u).ok()))
            .or_else(|| {
                exp.as_f64()
                    .filter(|f| f.is_finite() && *f > 0.0)
                    .map(|f| f as i64)
            })
            .filter(|&v| v > 0)
    }
    pub(crate) fn sync_slot_credentials(
        &mut self,
        record_id: &str,
        slot_dir: &Path,
    ) -> Result<bool, String> {
        if self.db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        let record = self.record(record_id)?;
        let slot_meta = match fs::symlink_metadata(slot_dir) {
            Ok(meta) => meta,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("relay.error.slotNotFound".into()),
        };
        if crate::cleaner::linked(&slot_meta) || !slot_meta.is_dir() {
            return Err("身份路径包含链接或特殊文件。".into());
        }
        if let Some(parent) = slot_dir.parent() {
            private::parents(parent)?;
        }
        private::safe(slot_dir)?;
        if !self.slot_live_pids(slot_dir).is_empty() {
            return Err("relay.error.targetSlotBusy".into());
        }
        Self::wait_for_slot_oauth_locks(slot_dir);
        let drifted_marker = slot_dir.join(".slot-drifted");
        if drifted_marker.exists() {
            return Err("relay.error.slotCredentialDrift".into());
        }
        let slot_claude = slot_dir.join(".claude.json");
        if slot_claude.exists() {
            private::safe(&slot_claude)?;
            let slot_key = super::catalog::file_key(&slot_claude, &self.key)?;
            if record.account_key.is_none() || slot_key.is_none() || slot_key != record.account_key
            {
                let _ = private::write(&drifted_marker, b"1");
                return Err("relay.error.slotCredentialDrift".into());
            }
        }
        let slot_creds_path = slot_dir.join(".credentials.json");
        let cred_meta = match fs::symlink_metadata(&slot_creds_path) {
            Ok(meta) => meta,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(err) => return Err(problem(err)),
        };
        private::safe(&slot_creds_path)?;
        if crate::cleaner::linked(&cred_meta)
            || !cred_meta.is_file()
            || cred_meta.len() > 1024 * 1024
        {
            return Err("身份凭据格式不受支持，未修改凭据。".into());
        }
        let slot_mtime_ms = cred_meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(0);
        let slot_cred_bytes =
            Zeroizing::new(fs::read(&slot_creds_path).map_err(problem)?);
        let slot_cred_val: serde_json::Value =
            serde_json::from_slice(&slot_cred_bytes).map_err(|_| "身份凭据格式不受支持，未修改凭据。")?;
        let slot_cred_obj = slot_cred_val
            .as_object()
            .ok_or("身份凭据格式不受支持，未修改凭据。")?;

        let mut stage = self.load(&record)?;
        let cred_keys = identity::base_credential_keys();
        let target_cred_path = self.home.join(".claude/.credentials.json");
        let mut changed = false;

        if let Some(idx) = stage
            .manifest
            .sources
            .iter()
            .position(|s| s.path == target_cred_path)
        {
            let stage_cred_path = stage.path.join(format!("data/{idx}"));
            let mut stage_val: serde_json::Value = if stage_cred_path.exists() {
                private::safe(&stage_cred_path)?;
                let raw = Zeroizing::new(fs::read(&stage_cred_path).map_err(problem)?);
                serde_json::from_slice(&raw).map_err(problem)?
            } else {
                serde_json::json!({})
            };
            let stage_obj = stage_val
                .as_object_mut()
                .ok_or("身份凭据格式不受支持，未修改凭据。")?;
            let slot_oauth_exp = Self::oauth_expires_at(slot_cred_obj);
            let stage_oauth_exp = Self::oauth_expires_at(stage_obj);
            for key in cred_keys {
                if let Some(new_val) = slot_cred_obj.get(*key) {
                    if stage_obj.get(*key) == Some(new_val) {
                        continue;
                    }
                    if *key == "claudeAiOauth" {
                        let newer_oauth = match (slot_oauth_exp, stage_oauth_exp) {
                            (Some(s_exp), Some(a_exp)) => s_exp > a_exp,
                            (None, Some(_)) => false,
                            (Some(_), None) => true,
                            (None, None) => slot_mtime_ms >= record.saved_at,
                        };
                        if !newer_oauth {
                            continue;
                        }
                    }
                    stage_obj.insert((*key).to_string(), new_val.clone());
                    changed = true;
                }
            }
            if changed {
                let encoded =
                    Zeroizing::new(serde_json::to_vec(&stage_val).map_err(problem)?);
                private::write(&stage_cred_path, &encoded)?;
            }
        } else {
            let mut extracted = serde_json::Map::new();
            for key in cred_keys {
                if let Some(val) = slot_cred_obj.get(*key) {
                    extracted.insert((*key).to_string(), val.clone());
                }
            }
            if !extracted.is_empty() {
                let idx = stage.manifest.sources.len();
                let stage_cred_path = stage.path.join(format!("data/{idx}"));
                let encoded = Zeroizing::new(
                    serde_json::to_vec(&serde_json::Value::Object(extracted)).map_err(problem)?,
                );
                private::write(&stage_cred_path, &encoded)?;
                let mut keys = Vec::new();
                for k in cred_keys {
                    keys.push((*k).to_string());
                }
                stage.manifest.sources.push(Source {
                    path: target_cred_path,
                    category: "account".into(),
                    keys,
                });
                stage
                    .manifest
                    .fingerprints
                    .push(identity::fingerprint(&slot_creds_path)?);
                changed = true;
            }
        }

        if !changed {
            return Ok(false);
        }
        let (updated_record, reloaded_stage) = self.repack_stage(&stage, &record)?;
        self.db.remember(&updated_record)?;
        if record.archive != updated_record.archive {
            self.remove_unreferenced_archive_now(&record.archive);
        }
        self.persist_stage_summary(&record.id, &reloaded_stage, None);
        let _ = self.collect_generations();
        Ok(true)
    }
    fn persist_stage_summary(&self, id: &str, stage: &Stage, fallback_proxy: Option<String>) {
        let sum = super::profile::summarize_stage_with_ledger(stage, &self.vault);
        self.persist_live_summary(id, sum, fallback_proxy);
    }
    fn persist_live_summary(
        &self,
        id: &str,
        mut sum: super::profile::Summary,
        fallback_proxy: Option<String>,
    ) {
        if sum.proxy.is_none() {
            sum.proxy = fallback_proxy.or_else(|| {
                self.db
                    .summaries()
                    .ok()
                    .and_then(|m| m.get(id).and_then(|prev| prev.proxy.clone()))
            });
        }
        let _ = self.db.set_summary(id, &sum);
    }
    fn stopped_for_rollback(&self) -> Result<(), String> {
        for attempt in 0..4 {
            match self.stopped() {
                Ok(()) => return Ok(()),
                Err(_) if attempt < 3 => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
    pub(super) fn during_io(&self) -> Result<(), String> {
        if self.process_check.get().elapsed() >= std::time::Duration::from_millis(250) {
            self.stopped()?;
        }
        Ok(())
    }
    pub(super) fn snapshot_keys(&self) -> Result<Vec<serde_json::Value>, String> {
        #[cfg(test)]
        if identity::root().ok().as_ref() != Some(&self.home) {
            return Ok(Vec::new());
        }
        native::identity_snapshot()
    }
    fn keys(
        &self,
        items: &[serde_json::Value],
        restore: bool,
        policy: &Policy,
    ) -> Result<(), String> {
        #[cfg(test)]
        if identity::root().ok().as_ref() != Some(&self.home) {
            return Ok(());
        }
        let transformed = if restore {
            super::credentials::restore(items, &native::identity_snapshot()?, policy)?
        } else {
            super::credentials::clear(items, policy)?
        };
        native::identity_keys(&transformed, restore)
    }
    #[cfg(test)]
    pub(super) fn records(&self) -> Vec<Record> {
        self.db.records().unwrap()
    }
    pub(super) fn record(&self, id: &str) -> Result<Record, String> {
        if !super::valid_id(id) {
            return Err("身份编号无效。".into());
        }
        self.db
            .records()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("身份不存在。".into())
    }
    pub(super) fn selected(stage: &Stage, policy: &Policy) -> Vec<(usize, Source)> {
        Self::selected_manifest(&stage.manifest, policy)
    }
    pub(super) fn selected_manifest(
        manifest: &super::archive::Manifest,
        policy: &Policy,
    ) -> Vec<(usize, Source)> {
        manifest
            .sources
            .iter()
            .enumerate()
            .filter_map(|(n, s)| {
                if s.keys.is_empty() && s.category != "settings" && policy.keeps(&s.category) {
                    return None;
                }
                let mut s = identity::writable_source(&manifest.home, s)?;
                if s.keys.is_empty() && s.category == "settings" && policy.settings {
                    s.keys = crate::cleaner::identity::SETTINGS_IDENTITY_KEYS
                        .iter()
                        .map(|k| (*k).into())
                        .collect();
                }
                if s.path == manifest.home.join(".claude.json") && policy.settings {
                    s.keys.retain(|k| {
                        crate::cleaner::identity::account_key(k)
                            || k == "mcpServers"
                            || k == "projects"
                            || k == "githubRepoPaths"
                    });
                }
                if policy.mcp {
                    s.keys.retain(|k| {
                        ![
                            "mcpServers",
                            "mcpOAuth",
                            "mcpOAuthClientConfig",
                            "mcpXaaIdp",
                            "mcpXaaIdpConfig",
                        ]
                        .contains(&k.as_str())
                    });
                }
                if policy.plugins {
                    s.keys.retain(|k| k != "pluginSecrets");
                }
                if policy.projects {
                    s.keys.retain(|k| k != "projects" && k != "githubRepoPaths");
                }
                if !manifest.sources[n].keys.is_empty() && s.keys.is_empty() {
                    return None;
                }
                Some((n, s))
            })
            .collect()
    }
    pub(super) fn clear(
        &self,
        sources: &[(usize, Source)],
        reporter: &Reporter,
        phase: &str,
    ) -> Result<(), String> {
        self.clear_inner(sources, reporter, phase, true)
    }
    fn clear_for_rollback(
        &self,
        sources: &[(usize, Source)],
        reporter: &Reporter,
    ) -> Result<(), String> {
        self.clear_inner(sources, reporter, "rollback", false)
    }
    fn job_dir_has_live_adopt(home: &Path, job_dir: &Path) -> bool {
        super::profile::job_dir_has_live_adopt(home, job_dir)
    }
    fn jobs_dir_has_live_adopt(home: &Path, jobs_path: &Path) -> bool {
        let Ok(meta) = fs::symlink_metadata(jobs_path) else {
            return false;
        };
        if crate::cleaner::linked(&meta) || !meta.is_dir() {
            return false;
        }
        let Ok(entries) = fs::read_dir(jobs_path) else {
            return false;
        };
        entries
            .flatten()
            .any(|entry| Self::job_dir_has_live_adopt(home, &entry.path()))
    }
    fn clear_jobs_preserving_live_adopt(home: &Path, jobs_path: &Path) -> Result<(), String> {
        let entries = fs::read_dir(jobs_path).map_err(problem)?;
        for entry in entries {
            let entry = entry.map_err(problem)?;
            let path = entry.path();
            if Self::job_dir_has_live_adopt(home, &path) {
                continue;
            }
            private::safe(&path)?;
            let meta = fs::symlink_metadata(&path).map_err(problem)?;
            if meta.is_dir() {
                crate::cleaner::file_io::remove_dir_all_retry(&path).map_err(problem)?;
            } else {
                crate::cleaner::file_io::remove_file_retry(&path).map_err(problem)?;
            }
        }
        Ok(())
    }
    fn preserved_project_paths_for_live_adopt(home: &Path) -> Vec<PathBuf> {
        let Ok(projects_canon) = dunce::canonicalize(&home.join(".claude/projects")) else {
            return Vec::new();
        };
        super::profile::live_adopt_referenced_paths(home)
            .into_iter()
            .filter(|p| p.starts_with(&projects_canon))
            .collect()
    }
    fn clear_projects_preserving_paths(dir: &Path, preserved: &[PathBuf]) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(problem)?;
        for entry in entries {
            let entry = entry.map_err(problem)?;
            let path = entry.path();
            private::safe(&path)?;
            let meta = fs::symlink_metadata(&path).map_err(problem)?;
            let Ok(canon) = dunce::canonicalize(&path) else {
                continue;
            };
            if preserved.iter().any(|p| p == &canon) {
                continue;
            }
            if meta.is_dir() {
                if preserved.iter().any(|p| p.starts_with(&canon)) {
                    Self::clear_projects_preserving_paths(&path, preserved)?;
                } else {
                    crate::cleaner::file_io::remove_dir_all_retry(&path).map_err(problem)?;
                }
            } else {
                crate::cleaner::file_io::remove_file_retry(&path).map_err(problem)?;
            }
        }
        Ok(())
    }
    fn clear_inner(
        &self,
        sources: &[(usize, Source)],
        reporter: &Reporter,
        phase: &str,
        strict_process_check: bool,
    ) -> Result<(), String> {
        if strict_process_check {
            self.stopped()?;
        }
        let preserved_project_paths = if sources
            .iter()
            .any(|(_, s)| s.keys.is_empty() && s.path == self.home.join(".claude/projects"))
        {
            Self::preserved_project_paths_for_live_adopt(&self.home)
        } else {
            Vec::new()
        };
        reporter.log(
            phase,
            "running",
            "正在清除所选工作区文件。",
            0,
            Some(sources.len()),
        );
        for (index, (_, source)) in sources.iter().enumerate() {
            if strict_process_check {
                self.during_io()?;
            }
            if !identity::allowed(&self.home, source) {
                return Err("身份路径超出允许范围。".into());
            }
            match crate::cleaner::file_io::retry_io(|| fs::symlink_metadata(&source.path)) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(problem(error)),
                Ok(_) => {
                    private::parents(source.path.parent().unwrap())?;
                    private::safe(&source.path)?;
                    if !source.keys.is_empty() {
                        identity::apply_config_with_lock_clear(
                            source,
                            &serde_json::json!({}),
                            false,
                        )?;
                    } else if source.path.is_dir() {
                        if source.path == self.home.join(".claude/jobs")
                            && Self::jobs_dir_has_live_adopt(&self.home, &source.path)
                        {
                            Self::clear_jobs_preserving_live_adopt(&self.home, &source.path)?;
                        } else if source.path == self.home.join(".claude/projects")
                            && !preserved_project_paths.is_empty()
                        {
                            Self::clear_projects_preserving_paths(
                                &source.path,
                                &preserved_project_paths,
                            )?;
                        } else {
                            crate::cleaner::file_io::remove_dir_all_retry(&source.path)
                                .map_err(problem)?;
                        }
                    } else {
                        crate::cleaner::file_io::remove_file_retry(&source.path)
                            .map_err(problem)?;
                    }
                }
            }
            reporter.log(
                phase,
                "running",
                "已清除工作区文件。",
                index + 1,
                Some(sources.len()),
            );
        }
        reporter.log(
            phase,
            "ok",
            "所选工作区文件已清除。",
            sources.len(),
            Some(sources.len()),
        );
        Ok(())
    }
    fn read_live_settings_proxy_env(
        settings_path: &Path,
    ) -> Option<serde_json::Map<String, serde_json::Value>> {
        const ACTIVE_PROXY_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
        ];
        const ALL_PROXY_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
            "no_proxy",
        ];
        let meta = fs::symlink_metadata(settings_path).ok()?;
        if crate::cleaner::linked(&meta)
            || !meta.is_file()
            || meta.len() > 2 * 1024 * 1024
            || private::safe(settings_path).is_err()
        {
            return None;
        }
        let bytes = fs::read(settings_path).ok()?;
        let val: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let obj = val.as_object()?;
        let env_obj = obj.get("env").and_then(serde_json::Value::as_object);
        let mut preserved = serde_json::Map::new();
        let mut has_active_proxy = false;
        for key in ALL_PROXY_KEYS {
            let raw = env_obj
                .and_then(|e| e.get(*key))
                .or_else(|| obj.get(&format!("env.{key}")))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty() && !s.chars().any(char::is_control));
            if let Some(v) = raw {
                if ACTIVE_PROXY_KEYS.contains(key) {
                    if super::orchestrator::config::normalize_proxy_to_http(v).is_some() {
                        has_active_proxy = true;
                        preserved.insert((*key).to_string(), serde_json::Value::String(v.into()));
                    }
                } else {
                    preserved.insert((*key).to_string(), serde_json::Value::String(v.into()));
                }
            }
        }
        has_active_proxy.then_some(preserved)
    }
    fn read_live_proxy_env_from_home(
        &self,
    ) -> Option<serde_json::Map<String, serde_json::Value>> {
        Self::read_live_settings_proxy_env(&self.home.join(".claude/settings.json")).or_else(|| {
            Self::read_live_settings_proxy_env(&self.home.join(".claude/settings.local.json"))
        })
    }
    fn restore_missing_settings_proxy_env(
        &self,
        settings_path: &Path,
        preserved: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        if preserved.is_empty() || Self::read_live_settings_proxy_env(settings_path).is_some() {
            return Ok(());
        }
        let parent = settings_path.parent().ok_or("设置路径无效。")?;
        private::parents(parent)?;
        let mut root_val = if let Ok(meta) = fs::symlink_metadata(settings_path) {
            if crate::cleaner::linked(&meta)
                || !meta.is_file()
                || meta.len() > 2 * 1024 * 1024
            {
                return Err("设置文件路径异常。".into());
            }
            private::safe(settings_path)?;
            let bytes = crate::cleaner::file_io::read_bytes_retry(settings_path).map_err(problem)?;
            let val: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "设置文件不是有效 JSON。".to_string())?;
            if !val.is_object() {
                return Err("设置文件不是 JSON 对象。".into());
            }
            val
        } else {
            private::directory(parent)?;
            serde_json::json!({})
        };
        let root_obj = root_val.as_object_mut().ok_or("设置文件不是 JSON 对象。")?;
        let env_entry = root_obj
            .entry("env")
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if !env_entry.is_object() {
            *env_entry = serde_json::Value::Object(serde_json::Map::new());
        }
        if let Some(env_map) = env_entry.as_object_mut() {
            for (k, v) in preserved {
                env_map.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
        let text = serde_json::to_string_pretty(&root_val).map_err(problem)?;
        let payload = format!("{text}\n");
        if fs::symlink_metadata(settings_path).is_ok() {
            crate::cleaner::file_io::atomic_write(settings_path, payload.as_bytes(), 0o600)
                .map_err(problem)?;
        } else {
            private::write(settings_path, payload.as_bytes())?;
        }
        Ok(())
    }
    fn align_settings_proxy_env(
        &self,
        settings_path: &Path,
        proxy_url: &str,
    ) -> Result<(), String> {
        const ALIGN_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
        ];
        let parent = settings_path.parent().ok_or("设置路径无效。")?;
        private::parents(parent)?;
        let existed = fs::symlink_metadata(settings_path).is_ok();
        let mut root_val = if existed {
            let meta = fs::symlink_metadata(settings_path).map_err(problem)?;
            if crate::cleaner::linked(&meta)
                || !meta.is_file()
                || meta.len() > 2 * 1024 * 1024
            {
                return Err("设置文件路径异常。".into());
            }
            private::safe(settings_path)?;
            let bytes = crate::cleaner::file_io::read_bytes_retry(settings_path).map_err(problem)?;
            let val: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "设置文件不是有效 JSON。".to_string())?;
            if !val.is_object() {
                return Err("设置文件不是 JSON 对象。".into());
            }
            val
        } else {
            private::directory(parent)?;
            serde_json::json!({})
        };
        let root_obj = root_val.as_object_mut().ok_or("设置文件不是 JSON 对象。")?;
        let env_entry = root_obj
            .entry("env")
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if !env_entry.is_object() {
            *env_entry = serde_json::Value::Object(serde_json::Map::new());
        }
        if let Some(env_map) = env_entry.as_object_mut() {
            for k in ALIGN_KEYS {
                env_map.insert((*k).into(), serde_json::Value::String(proxy_url.into()));
            }
        }
        let text = serde_json::to_string_pretty(&root_val).map_err(problem)?;
        let payload = format!("{text}\n");
        if existed {
            crate::cleaner::file_io::atomic_write(settings_path, payload.as_bytes(), 0o600)
                .map_err(problem)?;
        } else {
            private::write(settings_path, payload.as_bytes())?;
        }
        Ok(())
    }
    fn settings_has_proxy_env_keys(settings_path: &Path) -> bool {
        const PROXY_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
        ];
        let Ok(meta) = fs::symlink_metadata(settings_path) else {
            return false;
        };
        if crate::cleaner::linked(&meta)
            || !meta.is_file()
            || meta.len() > 2 * 1024 * 1024
            || private::safe(settings_path).is_err()
        {
            return false;
        }
        let Ok(bytes) = crate::cleaner::file_io::read_bytes_retry(settings_path) else {
            return false;
        };
        let Ok(val) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            return false;
        };
        let Some(obj) = val.as_object() else {
            return false;
        };
        let env_obj = obj.get("env").and_then(serde_json::Value::as_object);
        PROXY_KEYS.iter().any(|k| {
            env_obj.is_some_and(|e| e.contains_key(*k)) || obj.contains_key(&format!("env.{k}"))
        })
    }
    fn settings_proxy_aligned(settings_path: &Path, expected_proxy: &str) -> bool {
        const ALIGN_KEYS: &[&str] = &[
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "grpc_proxy",
        ];
        let Ok(meta) = fs::symlink_metadata(settings_path) else {
            return false;
        };
        if crate::cleaner::linked(&meta)
            || !meta.is_file()
            || meta.len() > 2 * 1024 * 1024
            || private::safe(settings_path).is_err()
        {
            return false;
        }
        let Ok(bytes) = crate::cleaner::file_io::read_bytes_retry(settings_path) else {
            return false;
        };
        let Ok(val) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            return false;
        };
        let Some(env_obj) = val.get("env").and_then(serde_json::Value::as_object) else {
            return false;
        };
        ALIGN_KEYS
            .iter()
            .all(|k| env_obj.get(*k).and_then(serde_json::Value::as_str) == Some(expected_proxy))
    }
    fn now_epoch_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(0)
    }
    fn prospective_empty_device_id(&self) -> Result<(String, Option<String>), String> {
        if let Some(promo_id) = self
            .db
            .get("browser.promotion")?
            .filter(|id| super::valid_id(id))
        {
            return Ok((promo_id, None));
        }
        if self.db.get("browser.enabled")?.as_deref() == Some("1") {
            let prev = self.db.get("browser.previous")?;
            if let Some(next_slot) = self
                .db
                .get("browser.next")?
                .filter(|s| super::valid_id(s) && prev.as_deref() != Some(s.as_str()))
            {
                let occupied = self.db.records()?.iter().any(|r| r.id == next_slot);
                if !occupied {
                    return Ok((next_slot, None));
                }
            }
        }
        let fresh = super::new_id()?;
        Ok((fresh.clone(), Some(fresh)))
    }
    fn live_claude_user_id(&self) -> Option<String> {
        let claude_json = self.home.join(".claude.json");
        let meta = fs::symlink_metadata(&claude_json).ok()?;
        if crate::cleaner::linked(&meta)
            || !meta.is_file()
            || meta.len() > 8 * 1024 * 1024
            || private::safe(&claude_json).is_err()
        {
            return None;
        }
        let bytes = crate::cleaner::file_io::read_bytes_retry(&claude_json).ok()?;
        let val: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        val.get("userID")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }
    fn stamp_isolated_device_identity(
        &self,
        record_id: &str,
        saved_at: u64,
    ) -> Result<(), String> {
        if !super::valid_id(record_id) {
            return Ok(());
        }
        let claude_json = self.home.join(".claude.json");
        let meta = match fs::symlink_metadata(&claude_json) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err("身份配置无法读取。".into()),
        };
        if crate::cleaner::linked(&meta) || !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
            return Ok(());
        }
        private::parents(&self.home)?;
        private::safe(&claude_json)?;
        let bytes = crate::cleaner::file_io::read_bytes_retry(&claude_json).map_err(problem)?;
        let mut value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "身份配置不是有效 JSON。")?;
        let Some(obj) = value.as_object_mut() else {
            return Ok(());
        };
        let expected_uid = super::orchestrator::derive_slot_user_id(&self.key, record_id);
        let expected_anon = super::orchestrator::derive_slot_anonymous_id(&self.key, record_id);
        let expected_mid = super::orchestrator::derive_slot_machine_id(&self.key, record_id);
        let expected_fst =
            super::orchestrator::derive_slot_first_start_time(&self.key, record_id, saved_at);
        let mut changed = false;
        for (key, next_val) in [
            ("userID", Some(expected_uid)),
            ("anonymousId", Some(expected_anon)),
            ("machineID", Some(expected_mid)),
            ("firstStartTime", expected_fst),
        ] {
            if let Some(v) = next_val {
                if obj.get(key).and_then(serde_json::Value::as_str) != Some(v.as_str()) {
                    obj.insert(key.into(), serde_json::Value::String(v));
                    changed = true;
                }
            }
        }
        if changed {
            let text =
                serde_json::to_string_pretty(&value).map_err(|_| "身份配置无法更新设备标识。")?;
            crate::cleaner::file_io::atomic_write(
                &claude_json,
                format!("{text}\n").as_bytes(),
                0o600,
            )
            .map_err(|_| "身份配置无法更新设备标识。")?;
        }
        Ok(())
    }
    fn restore(
        &self,
        stage: &Stage,
        sources: &[(usize, Source)],
        policy: &Policy,
        reporter: &Reporter,
        phase: &str,
        allow_overwrite: bool,
    ) -> Result<(), String> {
        if phase != "rollback" {
            self.stopped()?;
        }
        let settings_path = self.home.join(".claude/settings.json");
        let preserved_proxy = if phase != "rollback" {
            self.read_live_proxy_env_from_home()
        } else {
            None
        };
        let preserved_project_paths = if sources
            .iter()
            .any(|(_, s)| s.keys.is_empty() && s.path == self.home.join(".claude/projects"))
        {
            Self::preserved_project_paths_for_live_adopt(&self.home)
        } else {
            Vec::new()
        };
        reporter.log(
            phase,
            "running",
            "正在恢复身份文件。",
            0,
            Some(sources.len()),
        );
        for (index, (n, source)) in sources.iter().enumerate() {
            if phase != "rollback" {
                self.during_io()?;
            }
            if !identity::allowed(&self.home, source) {
                return Err("身份路径超出允许范围。".into());
            }
            private::parents(source.path.parent().unwrap())?;
            if fs::symlink_metadata(&source.path).is_ok() {
                private::safe(&source.path)?;
            }
            let data = stage.path.join(format!("data/{n}"));
            if !source.keys.is_empty() {
                let bytes = crate::cleaner::file_io::read_bytes_retry(&data).map_err(problem)?;
                let saved = if stage.manifest.sources[*n].keys.is_empty() {
                    identity::extract(source, std::str::from_utf8(&bytes).map_err(problem)?)?
                } else {
                    serde_json::from_slice(&bytes).map_err(problem)?
                };
                identity::apply_config_with_lock_clear(source, &saved, false)?;
            } else {
                let preserve_live_adopt = source.path == self.home.join(".claude/jobs")
                    && Self::jobs_dir_has_live_adopt(&self.home, &source.path);
                let preserve_live_projects = source.path == self.home.join(".claude/projects")
                    && !preserved_project_paths.is_empty();
                if fs::symlink_metadata(&source.path).is_ok()
                    && !preserve_live_adopt
                    && !preserve_live_projects
                {
                    if allow_overwrite {
                        private::safe(&source.path)?;
                        if source.path.is_dir() {
                            crate::cleaner::file_io::remove_dir_all_retry(&source.path)
                                .map_err(problem)?;
                        } else {
                            crate::cleaner::file_io::remove_file_retry(&source.path)
                                .map_err(problem)?;
                        }
                    } else {
                        return Err("身份恢复位置已有数据；请使用恢复操作。".into());
                    }
                }
                if data.is_dir() {
                    let is_cache = source.category == "cache";
                    walk(&data, &data, &mut |path, relative, directory| {
                        if phase != "rollback" {
                            self.during_io()?;
                        }
                        let target = source.path.join(relative);
                        if directory {
                            private::directory(&target)
                        } else {
                            if preserve_live_adopt {
                                if let Some(first_comp) = relative.components().next() {
                                    if Self::job_dir_has_live_adopt(
                                        &self.home,
                                        &source.path.join(first_comp.as_os_str()),
                                    ) {
                                        return Ok(());
                                    }
                                }
                                if fs::symlink_metadata(&target).is_ok() && !allow_overwrite {
                                    return Ok(());
                                }
                            }
                            if preserve_live_projects
                                && fs::symlink_metadata(&target).is_ok()
                                && dunce::canonicalize(&target)
                                    .ok()
                                    .is_some_and(|c| preserved_project_paths.contains(&c))
                            {
                                return Ok(());
                            }
                            private::directory(target.parent().unwrap())?;
                            if (allow_overwrite || preserve_live_projects)
                                && fs::symlink_metadata(&target).is_ok()
                            {
                                private::safe(&target)?;
                                crate::cleaner::file_io::remove_file_retry(&target)
                                    .map_err(problem)?;
                            }
                            let mut dest = private::create(&target)?;
                            let mut input =
                                crate::cleaner::file_io::open_read_retry(path).map_err(problem)?;
                            io::copy(&mut input, &mut dest).map_err(problem)?;
                            if !is_cache {
                                dest.sync_all().map_err(problem)?;
                            }
                            Ok(())
                        }
                    })?;
                } else {
                    private::directory(source.path.parent().unwrap())?;
                    let mut output = private::create(&source.path)?;
                    let mut input =
                        crate::cleaner::file_io::open_read_retry(&data).map_err(problem)?;
                    io::copy(&mut input, &mut output).map_err(problem)?;
                    if source.category != "cache" {
                        output.sync_all().map_err(problem)?;
                    }
                }
            }
            reporter.log(
                phase,
                "running",
                "已恢复身份文件。",
                index + 1,
                Some(sources.len()),
            );
        }
        if let Some(ref preserved) = preserved_proxy {
            let _ = self.restore_missing_settings_proxy_env(&settings_path, preserved);
        }
        self.merge_kept_history(stage, policy)?;
        reporter.log(
            phase,
            "ok",
            "所选身份文件已恢复。",
            sources.len(),
            Some(sources.len()),
        );
        if phase != "rollback" {
            self.stopped()?;
        }
        let phase = if phase == "rollback" {
            phase
        } else {
            "credentials"
        };
        if cfg!(target_os = "macos") || !stage.manifest.credentials.is_empty() {
            reporter.log(phase, "running", "正在恢复本地登录凭据。", 0, None);
            self.keys(&stage.manifest.credentials, true, policy)?;
            reporter.log(phase, "ok", "本地登录凭据已恢复。", 1, Some(1));
        } else {
            self.keys(&stage.manifest.credentials, true, policy)?;
        }
        Ok(())
    }
    fn merge_kept_history(&self, stage: &Stage, policy: &Policy) -> Result<(), String> {
        if policy.projects {
            let claude_json = self.home.join(".claude.json");
            if let Some((n, _)) = stage
                .manifest
                .sources
                .iter()
                .enumerate()
                .find(|(_, s)| s.path == claude_json)
            {
                let data = stage.path.join(format!("data/{n}"));
                if data.is_file() {
                    if let Ok(bytes) = fs::read(&data) {
                        if let Ok(saved) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                            let _ = identity::merge_kept_projects(&claude_json, &saved);
                        }
                    }
                }
            }
        }
        if !policy.history {
            return Ok(());
        }
        for (n, source) in stage.manifest.sources.iter().enumerate() {
            if !source.keys.is_empty() || source.category != "history" {
                continue;
            }
            if !identity::allowed(&self.home, source) {
                continue;
            }
            let data = stage.path.join(format!("data/{n}"));
            if !data.exists() {
                continue;
            }
            self.stopped()?;
            private::parents(source.path.parent().unwrap())?;
            if source.path.exists() {
                private::safe(&source.path)?;
            }
            if data.is_dir() {
                walk(&data, &data, &mut |path, relative, directory| {
                    self.during_io()?;
                    let target = source.path.join(relative);
                    if directory {
                        private::directory(&target)
                    } else if !target.exists() {
                        private::directory(target.parent().unwrap())?;
                        let mut dest = private::create(&target)?;
                        io::copy(&mut fs::File::open(path).map_err(problem)?, &mut dest)
                            .map_err(problem)?;
                        dest.sync_all().map_err(problem)
                    } else {
                        Ok(())
                    }
                })?;
            } else if !source.path.exists() {
                private::directory(source.path.parent().unwrap())?;
                let mut output = private::create(&source.path)?;
                io::copy(&mut fs::File::open(data).map_err(problem)?, &mut output)
                    .map_err(problem)?;
                output.sync_all().map_err(problem)?;
            }
        }
        Ok(())
    }
    pub fn delete(&mut self, id: &str, policy: &Policy, reporter: &Reporter) -> Result<(), String> {
        if self.db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        if id == "current" {
            self.stopped()?;
            let sources = identity::sources(&self.home, policy)?;
            let fingerprints = sources
                .iter()
                .map(|s| identity::fingerprint(&s.path))
                .collect::<Result<Vec<_>, _>>()?;
            let credentials = self.snapshot_keys()?;
            // 预先验证凭据格式和范围，删除没有隐式恢复副本。
            super::credentials::clear(&credentials, policy)?;
            for (s, stamp) in sources.iter().zip(&fingerprints) {
                if identity::fingerprint(&s.path)? != *stamp {
                    return Err("身份数据发生变化；未修改身份。".into());
                }
            }
            reporter.log(
                "delete",
                "running",
                "正在直接删除所选本地身份数据。",
                0,
                None,
            );
            let selected: Vec<_> = sources.into_iter().enumerate().collect();
            self.clear(&selected, reporter, "clear")
                .and_then(|_| {
                    reporter.log(
                        "credentials",
                        "running",
                        "正在清除所选本地登录凭据。",
                        0,
                        None,
                    );
                    self.keys(&credentials, false, policy)?;
                    reporter.log("credentials", "ok", "所选本地登录凭据已清除。", 1, Some(1));
                    Ok(())
                })
                .map_err(|_| "直接删除未完成；部分数据可能已删除，请刷新检查。".to_string())?;
            identity::clear_stale_locks(&self.home);
            let _ = identity::maintain_account_caches(&self.home);
            reporter.log("commit", "running", "正在保存空身份状态。", 0, Some(1));
            self.db.complete("empty")?;
            let next_id = if let Some(draft_id) = self.db.browser_draft()? {
                draft_id
            } else {
                let fresh = super::new_id()?;
                self.db.set_state("pending_device_id", &fresh)?;
                fresh
            };
            self.stamp_isolated_device_identity(&next_id, Self::now_epoch_ms())?;
            reporter.log("commit", "ok", "空身份状态已保存。", 1, Some(1));
        } else {
            let record = self.record(id)?;
            if !super::catalog::archive_name(&record.archive) {
                return Err("身份归档编号无效。".into());
            }
            let idle_slot_dir = self
                .vault
                .parent()
                .map(|app_dir| app_dir.join("cli-slots").join(id));
            if let Some(ref slot_dir) = idle_slot_dir {
                if slot_dir.exists()
                    && (!self.slot_live_pids(slot_dir).is_empty()
                        || super::orchestrator::slot_lease_fresh_by_mtime(slot_dir))
                {
                    return Err("relay.error.targetSlotBusy".into());
                }
            }
            let path = self.vault.join(&record.archive);
            private::safe(&path)?;
            let trash = self.vault.join(format!(".trash-{id}"));
            if trash.exists() {
                return Err("身份删除事务尚未完成，请重新打开身份面板。".into());
            }
            crate::cleaner::file_io::rename_retry(&path, &trash).map_err(problem)?;
            private::sync_parent(&trash);
            if let Err(e) = self.db.forget(id) {
                let _ = crate::cleaner::file_io::rename_retry(&trash, &path);
                return Err(e);
            }
            if let Some(ref slot_dir) = idle_slot_dir {
                let _ = super::orchestrator::remove_idle_slot_dir(slot_dir);
            }
            // 数据库提交后，这个仅由自身命名的加密文件可安全回收；失败留待下次回收。
            crate::cleaner::file_io::remove_file_retry(&trash)
                .map_err(|_| "身份已从目录移除，但暂存文件回收失败；请重新打开面板。")?;
            private::sync_parent(&trash);
        }
        reporter.log("verify", "ok", "所选本地身份已直接删除。", 1, Some(1));
        Ok(())
    }
    pub fn save_current(
        &mut self,
        name: &str,
        policy: &Policy,
        reporter: &Reporter,
    ) -> Result<(), String> {
        if self.db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        let verified = self.save_verified(name, policy, reporter)?;
        let mut record = verified.record;
        if record.empty {
            return Err("当前未检测到可暂存的登录凭据或身份数据。".into());
        }
        record.name = name.into();
        reporter.log(
            "commit",
            "running",
            "正在更新身份保险库与浏览器绑定。",
            0,
            Some(1),
        );
        let existing_records = self.db.records()?;
        let superseded = existing_records
            .iter()
            .find(|r| r.id == record.id && r.archive != record.archive)
            .map(|r| r.archive.clone());
        let user_id_collides = self.live_claude_user_id().is_some_and(|live_uid| {
            existing_records.iter().any(|r| {
                r.id != record.id
                    && super::orchestrator::derive_slot_user_id(&self.key, &r.id) == live_uid
            })
        });
        if user_id_collides {
            self.stamp_isolated_device_identity(&record.id, record.saved_at)?;
        }
        self.db.remember(&record)?;
        if let Some(old_archive) = superseded {
            self.remove_unreferenced_archive_now(&old_archive);
        }
        self.db.rename(&record.id, &record.name)?;
        let ledger_root = super::profile::read_ledger_root(&self.vault);
        let live_summary = super::profile::Summary::from_current(
            &super::profile::read_live_with_ledger(&self.home, &self.vault, ledger_root.as_ref()),
        );
        self.persist_live_summary(&record.id, live_summary, None);
        self.db.complete(&record.id)?;
        self.finish_warming_promotion(&record.id)?;
        self.db.compact()?;
        super::usage::commit_switch_boundary(
            &self.vault,
            &self.home,
            record.account_key.as_deref().filter(|key| !key.is_empty()),
        );
        let _ = self.collect_generations();
        reporter.log("commit", "ok", "身份保险库与浏览器绑定已更新。", 1, Some(1));
        reporter.log(
            "verify",
            "ok",
            "当前身份已加密备份到保险库，无需退出当前工作区。",
            1,
            Some(1),
        );
        Ok(())
    }
    pub fn switch(
        &mut self,
        target: &str,
        name: &str,
        policy: &Policy,
        reporter: &Reporter,
    ) -> Result<(), String> {
        self.last_handoff = None;
        if self.db.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        #[cfg(not(test))]
        let _ = crate::cleaner::park_if_only_background_in(self.vault.parent());
        #[cfg(test)]
        if identity::root().ok().as_ref() == Some(&self.home) {
            let _ = crate::cleaner::park_if_only_background_in(self.vault.parent());
        }
        if target != "empty" {
            let target_rec = self.record(target)?;
            if let Some(app_dir) = self.vault.parent() {
                let slot_dir = app_dir.join("cli-slots").join(target);
                if slot_dir.exists() {
                    if !self.slot_live_pids(&slot_dir).is_empty()
                        || super::orchestrator::slot_lease_fresh_by_mtime(&slot_dir)
                    {
                        return Err("relay.error.targetSlotBusy".into());
                    }
                    if !slot_dir.join(".slot-drifted").exists() {
                        match self.sync_slot_credentials(target, &slot_dir) {
                            Ok(_) => {
                                super::orchestrator::scrub_idle_slot_artifacts(&slot_dir);
                                if let Some(acct_key) = target_rec.account_key.as_deref() {
                                    let _ = super::usage::collect_slot_usage(
                                        &self.vault,
                                        &slot_dir,
                                        acct_key,
                                    );
                                }
                            }
                            Err(err) if err == "relay.error.slotCredentialDrift" => {}
                            Err(err) => return Err(err),
                        }
                    }
                }
            }
        }
        reporter.log("validate", "running", "正在核对当前身份。", 0, None);
        let live_key = super::catalog::live_key(&self.home, &self.key)?;
        reporter.log("validate", "ok", "当前本地身份已核对。", 1, Some(1));
        if target != "empty" && live_key.is_some() && self.record(target)?.account_key == live_key {
            // 当前账号仍是最新状态；避免用自己的旧快照覆盖当前刷新过的登录。
            let target_saved_at = self.record(target)?.saved_at;
            self.stamp_isolated_device_identity(target, target_saved_at)?;
            reporter.log("commit", "running", "正在保存当前身份选择。", 0, Some(1));
            self.db.complete(target)?;
            self.db.compact()?;
            super::usage::commit_switch_boundary(&self.vault, &self.home, live_key.as_deref());
            let _ = self.collect_generations();
            reporter.log("commit", "ok", "当前身份选择已保存。", 1, Some(1));
            reporter.log("verify", "ok", "当前身份已经是所选身份。", 1, Some(1));
            return Ok(());
        }
        let incoming = if target == "empty" {
            None
        } else {
            reporter.log(
                "verify_archive",
                "running",
                "正在验收目标身份归档。",
                0,
                None,
            );
            let stage = self.load(&self.record(target)?)?;
            reporter.log(
                "verify_archive",
                "ok",
                "目标身份归档已完整验收。",
                1,
                Some(1),
            );
            Some(stage)
        };
        // The outgoing account may be an unsaved Pro account while promotion has
        // reserved a warming ID. Never assign that reservation to the outgoing archive.
        self.suppress_browser_draft = self.suppress_browser_draft
            || (self.db.get("browser.promotion")?.is_some()
                && self.db.get("active")?.as_deref() != Some("empty"));
        let outgoing_result = self.save_verified(name, policy, reporter);
        self.suppress_browser_draft = false;
        let outgoing = outgoing_result?;
        let record = outgoing.record;
        let outgoing_manifest = outgoing.manifest;
        let pre_snap = self.db.snapshot_before_switch(&record.id, target)?;
        if let Err(error) = self.db.pending(&record, target) {
            self.remove_unreferenced_archive_now(&record.archive);
            let _ = self.collect_generations();
            return Err(error);
        }
        let current = Self::selected_manifest(&outgoing_manifest, policy);
        let next = incoming
            .as_ref()
            .map(|s| Self::selected(s, policy))
            .unwrap_or_default();
        let settings_path = self.home.join(".claude/settings.json");
        let outgoing_ledger = super::profile::read_ledger_root(&self.vault);
        let outgoing_live = super::profile::read_live_with_ledger(
            &self.home,
            &self.vault,
            outgoing_ledger.as_ref(),
        );
        let outgoing_live_proxy = outgoing_live.proxy.clone();
        let outgoing_summary = super::profile::Summary::from_current(&outgoing_live);
        let pre_switch_proxy = if target != "empty" {
            self.read_live_proxy_env_from_home()
        } else {
            None
        };
        let mut mutated = false;
        let mut handoff_draft: Option<super::handoff::HandoffDraft> = None;
        let mut committed_handoff: Option<(PathBuf, PathBuf)> = None;
        let result: Result<(), String> = (|| {
            self.stopped()?;
            // Capture outgoing requests against the verified live HMAC identity before
            // cleanup can rewrite shared project-session attribution markers.
            super::usage::collect_before_switch(&self.vault, &self.home, live_key.as_deref());
            let mut extra_exact: Vec<String> = Vec::new();
            if let Some(ref email) = outgoing_live.email {
                extra_exact.push(email.clone());
            }
            if let Some(ref org) = outgoing_live.organization {
                extra_exact.push(org.clone());
            }
            if let Some(ref qid) = outgoing_live.quota_identity {
                extra_exact.push(qid.clone());
            }
            if let Some(ref lk) = live_key {
                extra_exact.push(lk.clone());
            }
            let mut extra_aliases: Vec<String> = vec![name.to_string()];
            if let Some(ref n) = outgoing_live.display_name {
                extra_aliases.push(n.clone());
            }
            if let Some(ref org) = outgoing_live.organization {
                extra_aliases.push(org.clone());
            }
            if let Ok(recs) = self.db.records() {
                for r in recs {
                    extra_aliases.push(r.name);
                }
            }
            handoff_draft =
                super::handoff::capture_handoff_draft(&self.home, &extra_exact, &extra_aliases);
            for (source, stamp) in outgoing_manifest
                .sources
                .iter()
                .zip(&outgoing_manifest.fingerprints)
            {
                if matches!(source.category.as_str(), "account" | "settings")
                    && identity::fingerprint(&source.path)? != *stamp
                {
                    return Err("身份数据发生变化；未切换身份。".into());
                }
            }
            #[cfg(test)]
            if self.fail_before_clear {
                return Err("fixture pre-clear abort".into());
            }
            mutated = true;
            let mut clear_list = current.clone();
            for item in &next {
                if item.1.keys.is_empty() && !clear_list.iter().any(|(_, c)| c.path == item.1.path)
                {
                    clear_list.push(item.clone());
                }
            }
            self.clear(&clear_list, reporter, "clear")?;
            identity::clear_stale_locks(&self.home);
            #[cfg(test)]
            if self.fail_after_clear {
                return Err("fixture rollback".into());
            }
            if cfg!(target_os = "macos") || !outgoing_manifest.credentials.is_empty() {
                reporter.log(
                    "credentials",
                    "running",
                    "正在清除当前本地登录凭据。",
                    0,
                    None,
                );
                self.keys(&outgoing_manifest.credentials, false, policy)?;
                reporter.log("credentials", "ok", "当前本地登录凭据已清除。", 1, Some(1));
            } else {
                self.keys(&outgoing_manifest.credentials, false, policy)?;
            }
            if let Some(stage) = incoming.as_ref() {
                self.restore(stage, &next, policy, reporter, "restore", false)?;
            }
            reporter.log(
                "cleanroom",
                "running",
                "正在执行净室隔离与出口对齐。",
                0,
                None,
            );
            let mut cleanroom_warning = false;
            if let Some(ref preserved) = pre_switch_proxy {
                if self
                    .restore_missing_settings_proxy_env(&settings_path, preserved)
                    .is_err()
                {
                    cleanroom_warning = true;
                }
            }
            if target != "empty" && policy.settings {
                if let Some(app_dir) = self.vault.parent() {
                    let relay_cfg = super::orchestrator::config::load_config(app_dir);
                    if let Some(raw_proxy) = relay_cfg.slot_proxies.get(target) {
                        if let Some(norm_proxy) =
                            super::orchestrator::config::normalize_proxy_to_http(raw_proxy)
                        {
                            if self
                                .align_settings_proxy_env(&settings_path, &norm_proxy)
                                .is_err()
                            {
                                cleanroom_warning = true;
                            }
                            let settings_local_path = self.home.join(".claude/settings.local.json");
                            if Self::settings_has_proxy_env_keys(&settings_local_path)
                                && self
                                    .align_settings_proxy_env(&settings_local_path, &norm_proxy)
                                    .is_err()
                            {
                                cleanroom_warning = true;
                            }
                        }
                    }
                }
            }
            if identity::maintain_account_caches_report(&self.home).is_err() {
                cleanroom_warning = true;
            }
            let pending_empty_device_id = if target != "empty" {
                let target_saved_at = self.record(target)?.saved_at;
                self.stamp_isolated_device_identity(target, target_saved_at)?;
                None
            } else {
                let (next_id, pending_id) = self.prospective_empty_device_id()?;
                self.stamp_isolated_device_identity(&next_id, Self::now_epoch_ms())?;
                pending_id
            };
            if cleanroom_warning {
                reporter.log(
                    "cleanroom",
                    "warning",
                    "代理出口对齐未完全成功，请检查设置。",
                    1,
                    Some(1),
                );
            } else {
                reporter.log(
                    "cleanroom",
                    "ok",
                    "已完成净室隔离与出口对齐。",
                    1,
                    Some(1),
                );
            }
            reporter.log(
                "commit",
                "running",
                "正在提交身份与浏览器选择。",
                0,
                Some(1),
            );
            self.db
                .complete_with_pending(target, pending_empty_device_id.as_deref())?;
            if let (Some(app_dir), Some(draft)) = (self.vault.parent(), handoff_draft.as_ref()) {
                if let Ok(paths) = super::handoff::commit_handoff_draft(app_dir, draft) {
                    committed_handoff = Some(paths);
                }
            }
            let next_account = if target == "empty" {
                None
            } else {
                self.record(target)?.account_key
            };
            if target == "empty" {
                super::usage::commit_empty_login_boundary(&self.vault, &self.home);
            } else {
                super::usage::commit_switch_boundary(
                    &self.vault,
                    &self.home,
                    next_account.as_deref(),
                );
            }
            if !record.empty {
                self.persist_live_summary(&record.id, outgoing_summary, outgoing_live_proxy);
            }
            if let Some(stage) = incoming.as_ref() {
                self.persist_stage_summary(
                    target,
                    stage,
                    super::profile::read(&self.home).proxy,
                );
            }
            reporter.log("commit", "ok", "身份与浏览器选择已提交。", 1, Some(1));
            Ok(())
        })();
        if let Err(error) = result {
            if !mutated {
                reporter.log(
                    "rollback",
                    "running",
                    "身份未修改，正在撤销切换记录。",
                    0,
                    Some(1),
                );
                self.db.abort_pending(&pre_snap, &record.id, target)?;
                self.remove_unreferenced_archive_now(&record.archive);
                let _ = self.collect_generations();
                reporter.log("rollback", "ok", "原身份选择已保留。", 1, Some(1));
                return Err(error);
            }
            reporter.log("rollback", "running", "切换失败，正在恢复原身份。", 0, None);
            #[cfg(windows)]
            if identity::root().ok().as_ref() == Some(&self.home) {
                crate::cleaner::wait_claude_workspace_handles_released(&self.home, 400);
            }
            if self.stopped_for_rollback().is_ok() {
                let rollback = (|| -> Result<(), String> {
                    let outgoing = self.load(&record)?;
                    self.clear_for_rollback(&next, reporter)?;
                    self.clear_for_rollback(&current, reporter)?;
                    identity::clear_stale_locks(&self.home);
                    let live = self.snapshot_keys()?;
                    self.keys(&live, false, &outgoing.manifest.policy)?;
                    self.restore(
                        &outgoing,
                        &current,
                        &outgoing.manifest.policy,
                        reporter,
                        "rollback",
                        true,
                    )?;
                    let _ = identity::maintain_account_caches(&self.home);
                    if !record.empty {
                        self.stamp_isolated_device_identity(&record.id, record.saved_at)?;
                    }
                    if super::catalog::live_key(&self.home, &self.key)? != live_key {
                        return Err("身份归档读写或验证失败；请保留暂存文件并重试。".into());
                    }
                    if pre_snap.prior_record.is_none() {
                        self.db.abort_pending(&pre_snap, &record.id, target)?;
                        self.remove_unreferenced_archive_now(&record.archive);
                    } else {
                        self.db.complete(&record.id)?;
                        let _ = self.db.compact();
                        if let Some(ref prior) = pre_snap.prior_record {
                            if prior.archive != record.archive {
                                self.remove_unreferenced_archive_now(&prior.archive);
                            }
                        }
                        if record.empty {
                            self.remove_unreferenced_archive_now(&record.archive);
                        }
                    }
                    let _ = self.collect_generations();
                    Ok(())
                })();
                if rollback.is_ok() {
                    reporter.log("rollback", "ok", "已恢复切换前的身份。", 1, Some(1));
                    return Err(format!("{error} 已恢复切换前的身份。"));
                }
            }
            reporter.log(
                "rollback",
                "error",
                "自动恢复未完成，原身份已暂存。",
                0,
                None,
            );
            return Err(format!("{error} 原身份已暂存，请使用恢复操作。"));
        }
        self.last_handoff = committed_handoff;
        self.db.compact()?;
        if let Some(ref prior) = pre_snap.prior_record {
            if prior.archive != record.archive {
                self.remove_unreferenced_archive_now(&prior.archive);
            }
        }
        if record.empty {
            self.remove_unreferenced_archive_now(&record.archive);
        }
        if !record.empty {
            self.finish_warming_promotion(&record.id)?;
        }
        // 目录已提交后才回收旧代次；回收失败保留加密文件，不把成功切换报为失败。
        let _ = self.collect_generations();
        reporter.log(
            "verify",
            "running",
            "正在核验切换后的身份与隔离配置。",
            0,
            None,
        );
        let mut verify_warning: Option<&'static str> = None;
        let cred_path = self.home.join(".claude/.credentials.json");
        if let Ok(meta) = fs::symlink_metadata(&cred_path) {
            if !crate::cleaner::linked(&meta) && meta.is_file() {
                let valid_json = crate::cleaner::file_io::read_bytes_retry(&cred_path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .is_some_and(|v| v.is_object());
                if !valid_json {
                    verify_warning = Some("切换后本地凭据校验失败，请重新登录。");
                }
            }
        }
        if verify_warning.is_none() && target != "empty" {
            if let Ok(target_rec) = self.record(target) {
                let expected_key = target_rec
                    .account_key
                    .as_deref()
                    .filter(|k| !k.is_empty());
                let actual_key = super::catalog::live_key(&self.home, &self.key)?;
                if expected_key.is_some() && actual_key.as_deref() != expected_key {
                    verify_warning = Some("切换后身份键与目标账号不一致，请检查。");
                }
            }
        }
        if verify_warning.is_none() && target != "empty" && super::valid_id(target) {
            let cj_path = self.home.join(".claude.json");
            if let Ok(meta) = fs::symlink_metadata(&cj_path) {
                if !crate::cleaner::linked(&meta) && meta.is_file() && meta.len() <= 8 * 1024 * 1024
                {
                    let expected_uid =
                        super::orchestrator::derive_slot_user_id(&self.key, target);
                    let expected_mid =
                        super::orchestrator::derive_slot_machine_id(&self.key, target);
                    let expected_anon =
                        super::orchestrator::derive_slot_anonymous_id(&self.key, target);
                    let expected_fst =
                        super::orchestrator::derive_slot_first_start_time(&self.key, target, 0);
                    let stamped_ok = crate::cleaner::file_io::read_bytes_retry(&cj_path)
                        .ok()
                        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                        .is_some_and(|v| {
                            v.get("userID").and_then(|x| x.as_str()) == Some(expected_uid.as_str())
                                && v.get("machineID").and_then(|x| x.as_str())
                                    == Some(expected_mid.as_str())
                                && v.get("anonymousId").and_then(|x| x.as_str())
                                    == Some(expected_anon.as_str())
                                && expected_fst.as_deref().is_none_or(|fst| {
                                    v.get("firstStartTime").and_then(|x| x.as_str()) == Some(fst)
                                })
                        });
                    if !stamped_ok {
                        verify_warning = Some("切换后隔离设备标识未正确写入，请检查。");
                    }
                }
            }
            if verify_warning.is_none() && policy.settings {
                if let Some(app_dir) = self.vault.parent() {
                    let relay_cfg = super::orchestrator::config::load_config(app_dir);
                    if let Some(expected_proxy) = relay_cfg
                        .slot_proxies
                        .get(target)
                        .and_then(|raw| super::orchestrator::config::normalize_proxy_to_http(raw))
                    {
                        let local_settings_path = self.home.join(".claude/settings.local.json");
                        let main_ok = Self::settings_proxy_aligned(&settings_path, &expected_proxy);
                        let local_ok = !Self::settings_has_proxy_env_keys(&local_settings_path)
                            || Self::settings_proxy_aligned(&local_settings_path, &expected_proxy);
                        if !main_ok || !local_ok {
                            verify_warning = Some("代理出口对齐未完全成功，请检查设置。");
                        }
                    }
                }
            }
        }
        if let Some(warn_msg) = verify_warning {
            reporter.log("verify", "warning", warn_msg, 1, Some(1));
        } else {
            reporter.log(
                "verify",
                "ok",
                "切换后身份、凭据与隔离设备标识核验通过。",
                1,
                Some(1),
            );
        }
        Ok(())
    }
    fn finish_warming_promotion(&mut self, id: &str) -> Result<(), String> {
        // The archive/index is already committed. Keep inherited subscriptions and
        // browser bindings intact; a failed JSON cleanup is retried by State reads.
        super::warming::remove_card(&self.vault, id)?;
        self.db.clear_warming_promotion(id)
    }
    pub fn recover(&mut self, name: &str, reporter: &Reporter) -> Result<(), String> {
        let id = self.db.get("recovery")?.ok_or("没有需要恢复的身份事务。")?;
        let record = self.record(&id)?;
        reporter.log(
            "verify_archive",
            "running",
            "正在验收待恢复的身份归档。",
            0,
            None,
        );
        let outgoing = self.load(&record)?;
        reporter.log(
            "verify_archive",
            "ok",
            "待恢复的身份归档已验收。",
            1,
            Some(1),
        );
        let target = self.db.get("target")?.unwrap_or_else(|| "empty".into());
        let incoming = if target == "empty" {
            None
        } else {
            reporter.log(
                "verify_archive",
                "running",
                "正在验收未完成的目标归档。",
                0,
                None,
            );
            let stage = self.load(&self.record(&target)?)?;
            reporter.log(
                "verify_archive",
                "ok",
                "未完成的目标归档已验收。",
                1,
                Some(1),
            );
            Some(stage)
        };
        self.stopped()?;
        reporter.log("switch", "running", "正在恢复未完成的身份切换。", 0, None);
        // 恢复前再保存现状，避免崩溃后用户新产生的数据被恢复操作覆盖。
        let (checkpoint, current_stage) =
            self.save_checkpoint(name, &outgoing.manifest.policy, reporter)?;
        if checkpoint.empty {
            self.remove_unreferenced_archive_now(&checkpoint.archive);
        } else {
            let superseded = self
                .db
                .records()?
                .into_iter()
                .find(|r| r.id == checkpoint.id && r.archive != checkpoint.archive)
                .map(|r| r.archive);
            self.db.remember(&checkpoint)?;
            if let Some(old_archive) = superseded {
                self.remove_unreferenced_archive_now(&old_archive);
            }
            let _ = self.db.set_summary(
                &checkpoint.id,
                &super::profile::summarize_stage_with_ledger(&current_stage, &self.vault),
            );
        }
        self.clear(
            &Self::selected(&current_stage, &outgoing.manifest.policy),
            reporter,
            "clear",
        )?;
        let current = Self::selected(&outgoing, &outgoing.manifest.policy);
        self.clear(&current, reporter, "clear")?;
        if let Some(stage) = incoming.as_ref() {
            self.clear(
                &Self::selected(stage, &outgoing.manifest.policy),
                reporter,
                "clear",
            )?;
        }
        let live = self.snapshot_keys()?;
        reporter.log(
            "credentials",
            "running",
            "正在清除待恢复工作区的登录凭据。",
            0,
            None,
        );
        self.keys(&live, false, &outgoing.manifest.policy)?;
        reporter.log(
            "credentials",
            "ok",
            "待恢复工作区的登录凭据已清除。",
            1,
            Some(1),
        );
        self.restore(
            &outgoing,
            &current,
            &outgoing.manifest.policy,
            reporter,
            "restore",
            true,
        )?;
        let _ = identity::maintain_account_caches(&self.home);
        if !record.empty {
            self.stamp_isolated_device_identity(&record.id, record.saved_at)?;
        }
        reporter.log(
            "commit",
            "running",
            "正在提交恢复后的身份选择。",
            0,
            Some(1),
        );
        self.db.complete(&record.id)?;
        if !record.empty {
            let _ = self.db.set_summary(
                &record.id,
                &super::profile::summarize_stage_with_ledger(&outgoing, &self.vault),
            );
        }
        self.db.compact()?;
        super::usage::commit_switch_boundary(
            &self.vault,
            &self.home,
            record.account_key.as_deref().filter(|key| !key.is_empty()),
        );
        let _ = self.collect_generations();
        reporter.log("commit", "ok", "恢复后的身份选择已提交。", 1, Some(1));
        reporter.log("verify", "ok", "原身份已恢复。", 1, Some(1));
        Ok(())
    }
    pub fn recover_clean(&mut self, reporter: &Reporter) -> Result<(), String> {
        let id = self.db.get("recovery")?.ok_or("没有需要恢复的身份事务。")?;
        let was_transient = self.db.get("recovery_transient")?.as_deref() == Some("1");
        let record = self.record(&id)?;
        reporter.log(
            "verify_archive",
            "running",
            "正在验收待恢复的身份归档。",
            0,
            None,
        );
        let outgoing = self.load(&record)?;
        reporter.log(
            "verify_archive",
            "ok",
            "待恢复的身份归档已验收。",
            1,
            Some(1),
        );
        let target = self.db.get("target")?.unwrap_or_else(|| "empty".into());
        let incoming = if target == "empty" {
            None
        } else {
            self.record(&target).ok().and_then(|r| self.load(&r).ok())
        };
        self.stopped()?;
        reporter.log("switch", "running", "正在恢复未完成的身份切换。", 0, None);
        // 仅当崩溃后工作区实际登录了不同于原身份与目标身份的全新第三账号时才暂存保护，普通半切换工作区不生成多余「恢复前状态」卡片。
        if let Some(live_key) = super::catalog::live_key(&self.home, &self.key)
            .ok()
            .flatten()
        {
            let is_outgoing = outgoing.manifest.account_key.as_deref() == Some(live_key.as_str());
            let is_incoming = incoming
                .as_ref()
                .and_then(|s| s.manifest.account_key.as_deref())
                == Some(live_key.as_str());
            if !is_outgoing && !is_incoming && self.db.by_account(&live_key)?.is_none() {
                let (rescued, rescued_stage) =
                    self.save("恢复前状态", &outgoing.manifest.policy, reporter)?;
                if rescued.empty {
                    self.remove_unreferenced_archive_now(&rescued.archive);
                } else {
                    self.db.remember(&rescued)?;
                    self.persist_stage_summary(
                        &rescued.id,
                        &rescued_stage,
                        super::profile::read(&self.home).proxy,
                    );
                }
            }
        }
        let current = Self::selected(&outgoing, &outgoing.manifest.policy);
        if let Some(stage) = incoming.as_ref() {
            self.clear(
                &Self::selected(stage, &outgoing.manifest.policy),
                reporter,
                "clear",
            )?;
        }
        self.clear(&current, reporter, "clear")?;
        identity::clear_stale_locks(&self.home);
        let live = self.snapshot_keys()?;
        reporter.log(
            "credentials",
            "running",
            "正在清除待恢复工作区的登录凭据。",
            0,
            None,
        );
        self.keys(&live, false, &outgoing.manifest.policy)?;
        reporter.log(
            "credentials",
            "ok",
            "待恢复工作区的登录凭据已清除。",
            1,
            Some(1),
        );
        self.restore(
            &outgoing,
            &current,
            &outgoing.manifest.policy,
            reporter,
            "restore",
            true,
        )?;
        let _ = identity::maintain_account_caches(&self.home);
        let expected_key = outgoing
            .manifest
            .account_key
            .as_deref()
            .filter(|k| !k.is_empty());
        if let Some(expected) = expected_key {
            if super::catalog::live_key(&self.home, &self.key)?.as_deref() != Some(expected) {
                return Err("身份归档读写或验证失败；请保留暂存文件并重试。".into());
            }
        }
        reporter.log(
            "commit",
            "running",
            "正在提交恢复后的身份选择。",
            0,
            Some(1),
        );
        if was_transient {
            self.db.finish_transient_recovery(&id, record.empty)?;
            self.remove_unreferenced_archive_now(&record.archive);
        } else {
            self.db.complete(&record.id)?;
            if !record.empty {
                self.stamp_isolated_device_identity(&record.id, record.saved_at)?;
                self.persist_stage_summary(
                    &record.id,
                    &outgoing,
                    super::profile::read(&self.home).proxy,
                );
            }
        }
        self.db.compact()?;
        if record.empty {
            self.remove_unreferenced_archive_now(&record.archive);
        }
        super::usage::commit_switch_boundary(&self.vault, &self.home, expected_key);
        let _ = self.collect_generations();
        reporter.log("commit", "ok", "恢复后的身份选择已提交。", 1, Some(1));
        reporter.log("verify", "ok", "原身份已恢复。", 1, Some(1));
        Ok(())
    }
}
