// [INPUT]: 身份 SQLite 事务、本软件随机身份 ID、浏览器资料槽位及只读有界本地账号显示字段。
// [OUTPUT]: CLI/养号独占绑定与稳定种子、CLI事务保留真实养号选择、受控转正草稿及回滚和无凭据身份摘要。
// [POS]: 浏览器联动的持久元数据；不读取 Cookie，不保存网站凭据，不把账号 UUID 暴露给引擎。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{
    database::{error, Database, Record},
    valid_id,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;

#[derive(Serialize)]
pub struct BrowserLink {
    pub enabled: bool,
    pub bound_ids: Vec<String>,
}
#[derive(Clone, Serialize)]
pub struct BrowserIdentity {
    pub linked: bool,
    pub status: &'static str,
    pub name: Option<String>,
    pub email: Option<String>,
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_proxy: Option<String>,
}
fn get(tx: &Transaction<'_>, key: &str) -> Result<Option<String>, String> {
    tx.query_row("SELECT value FROM state WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(error)
}
fn set(tx: &Transaction<'_>, key: &str, value: &str) -> Result<(), String> {
    tx.execute(
        "INSERT OR REPLACE INTO state VALUES(?1,?2)",
        params![key, value],
    )
    .map_err(error)?;
    Ok(())
}
pub fn valid_slot(slot: &str) -> bool {
    slot == "legacy" || valid_id(slot)
}
// Persistent format domain: retained to keep imported IDs and fingerprints stable.
pub fn seed(id: &str, attempt: u32) -> u32 {
    let digest = ring::digest::digest(
        &ring::digest::SHA256,
        format!("CCBaga/browser/{id}/{attempt}").as_bytes(),
    );
    u32::from_be_bytes(digest.as_ref()[..4].try_into().unwrap())
}
/// A dangling binding or an unbound draft is not a warming workspace. Require
/// both the private card and a binding that has not become a CLI identity.
fn warming_slot(connection: &rusqlite::Connection, slot: &str) -> Result<bool, String> {
    let owner: Option<String> = connection
        .query_row(
            "SELECT identity FROM browser_bindings WHERE slot=?1 AND identity NOT IN (SELECT id FROM identities)",
            [slot],
            |r| r.get(0),
        )
        .optional()
        .map_err(error)?;
    let Some(owner) = owner else {
        return Ok(false);
    };
    let vault = connection
        .path()
        .and_then(|p| std::path::Path::new(p).parent())
        .ok_or("身份库目录不可用。")?;
    super::warming::contains(vault, &owner)
}
fn bind(tx: &Transaction<'_>, id: &str, preferred: Option<&str>) -> Result<String, String> {
    if !valid_id(id) {
        return Err("身份编号无效。".into());
    }
    if let Some(slot) = tx
        .query_row(
            "SELECT slot FROM browser_bindings WHERE identity=?1",
            [id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(error)?
    {
        return Ok(slot);
    }
    let mut slot = preferred
        .filter(|s| valid_slot(s))
        .map(str::to_owned)
        .unwrap_or(super::new_id()?);
    if tx
        .query_row(
            "SELECT COUNT(*) FROM browser_bindings WHERE slot=?1",
            [&slot],
            |r| r.get::<_, i64>(0),
        )
        .map_err(error)?
        != 0
    {
        slot = super::new_id()?;
    }
    for attempt in 0..1024 {
        let seed = seed(id, attempt);
        if seed != 0
            && tx
                .query_row(
                    "SELECT COUNT(*) FROM browser_bindings WHERE seed=?1",
                    [seed],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(error)?
                == 0
        {
            tx.execute(
                "INSERT INTO browser_bindings(identity,slot,seed) VALUES(?1,?2,?3)",
                params![id, slot, seed],
            )
            .map_err(error)?;
            return Ok(slot);
        }
    }
    Err("无法分配独立浏览器种子。".into())
}
pub(super) fn pending(tx: &Transaction<'_>, record: &Record, target: &str) -> Result<(), String> {
    if get(tx, "browser.enabled")?.as_deref() != Some("1") {
        return Ok(());
    }
    let previous = get(tx, "browser.active")?.ok_or("浏览器资料选择无效。")?;
    if !valid_slot(&previous) {
        return Err("浏览器资料选择无效。".into());
    }
    // Database::pending has already installed the CLI recovery checkpoint in
    // this transaction. Promotion explicitly owns browser selection; ordinary
    // CLI work leaves an independently selected warming workspace in place.
    let keep_warming = get(tx, "browser.promotion")?.is_none() && warming_slot(tx, &previous)?;
    if !record.empty {
        // Promotion has already selected the warming slot; never assign it to outgoing CLI.
        let outgoing = if get(tx, "browser.promotion")?.is_some() {
            get(tx, "browser.promotion.previous")?
        } else if !keep_warming {
            Some(previous.clone())
        } else {
            None
        };
        bind(tx, &record.id, outgoing.as_deref())?;
    }
    let next = if target == "empty" {
        match get(tx, "browser.promotion")? {
            Some(id) if get(tx, "browser.draft")?.as_deref() == Some(id.as_str()) => tx
                .query_row(
                    "SELECT slot FROM browser_bindings WHERE identity=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error)?
                .ok_or("养号浏览器绑定已变化。")?,
            _ => super::new_id()?,
        }
    } else {
        bind(tx, target, None)?
    };
    set(tx, "browser.previous", &previous)?;
    set(
        tx,
        "browser.next",
        if keep_warming { &previous } else { &next },
    )
}
pub(super) fn complete(tx: &Transaction<'_>, active: &str) -> Result<(), String> {
    if let Some(previous) = get(tx, "browser.previous")? {
        let slot = if get(tx, "target")?.as_deref() == Some(active) {
            get(tx, "browser.next")?.ok_or("浏览器资料选择无效。")?
        } else {
            previous
        };
        if !valid_slot(&slot) {
            return Err("浏览器资料选择无效。".into());
        }
        set(tx, "browser.active", &slot)?;
        tx.execute(
            "DELETE FROM state WHERE key IN ('browser.previous','browser.next')",
            [],
        )
        .map_err(error)?;
    } else if get(tx, "recovery")?.is_none()
        && get(tx, "browser.enabled")?.as_deref() == Some("1")
        && get(tx, "browser.promotion")?.is_none()
        && get(tx, "browser.active")?
            .map(|slot| warming_slot(tx, &slot))
            .transpose()?
            .unwrap_or(false)
    {
        // Save/current-account shortcut/delete has no pending browser state.
        // Maintain a separate CLI binding without adopting the warming slot.
        if valid_id(active) {
            bind(tx, active, None)?;
        }
    } else if active == "empty"
        && get(tx, "recovery")?.is_none()
        && get(tx, "browser.enabled")?.as_deref() == Some("1")
        && get(tx, "browser.promotion")?.is_none()
    {
        // 直接删除当前身份后，使用全新空资料；旧资料由独立删除选择决定。
        set(tx, "browser.active", &super::new_id()?)?;
    } else if valid_id(active)
        && get(tx, "recovery")?.is_none()
        && get(tx, "browser.enabled")?.as_deref() == Some("1")
    {
        // 当前 Claude 已是目标账号时仍对齐其浏览器绑定，不回灌旧登录归档。
        let previous = get(tx, "browser.active")?;
        let slot = bind(tx, active, previous.as_deref())?;
        set(tx, "browser.active", &slot)?;
    }
    if active != "empty" && get(tx, "browser.promotion")?.is_some() {
        if get(tx, "target")?
            .as_deref()
            .is_some_and(|target| target != active)
        {
            if let Some(previous) = get(tx, "browser.promotion.previous")?.filter(|s| valid_slot(s))
            {
                set(tx, "browser.active", &previous)?;
                let enabled = get(tx, "browser.promotion.enabled")?.unwrap_or_else(|| "0".into());
                set(tx, "browser.enabled", &enabled)?;
            }
        }
        clear_promotion(tx)?;
    }
    Ok(())
}
fn clear_promotion(tx: &Transaction<'_>) -> Result<(), String> {
    tx.execute("DELETE FROM state WHERE key IN ('browser.draft','browser.promotion','browser.promotion.previous','browser.promotion.enabled')", [])
        .map_err(error)?;
    Ok(())
}
pub(super) fn merge(tx: &Transaction<'_>, old: &str, retained: &str) -> Result<(), String> {
    let old_slot = tx
        .query_row(
            "SELECT slot FROM browser_bindings WHERE identity=?1",
            [old],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(error)?;
    if let Some(slot) = old_slot {
        let retained_exists = tx
            .query_row(
                "SELECT COUNT(*) FROM browser_bindings WHERE identity=?1",
                [retained],
                |r| r.get::<_, i64>(0),
            )
            .map_err(error)?
            != 0;
        if !retained_exists || get(tx, "browser.active")?.as_deref() == Some(slot.as_str()) {
            // 合并旧身份卡时仍指向正在使用的资料；不删除被替代的资料目录。
            tx.execute(
                "DELETE FROM browser_bindings WHERE identity IN (?1,?2)",
                params![old, retained],
            )
            .map_err(error)?;
            bind(tx, retained, Some(&slot))?;
        }
    }
    Ok(())
}
impl Database {
    fn browser_vault(&self) -> Result<&std::path::Path, String> {
        self.connection
            .path()
            .and_then(|p| std::path::Path::new(p).parent())
            .ok_or_else(|| "身份库目录不可用。".into())
    }
    pub(crate) fn bind_warming(&mut self, id: &str) -> Result<(String, u32), String> {
        if self.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        let tx = self.connection.transaction().map_err(error)?;
        let occupied: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM identities WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(error)?;
        if occupied {
            return Err("身份编号已用于 CLI 身份。".into());
        }
        let slot = bind(&tx, id, None)?;
        let seed = tx
            .query_row(
                "SELECT seed FROM browser_bindings WHERE identity=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok((slot, seed))
    }
    pub(crate) fn current_browser_is_warming(&self) -> Result<bool, String> {
        if !self.browser_link()?.enabled {
            return Ok(false);
        }
        warming_slot(&self.connection, &self.browser_slot()?)
    }
    pub(crate) fn switch_browser_slot_only(&mut self, slot: &str) -> Result<(), String> {
        if self.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        if !valid_slot(slot) {
            return Err("浏览器资料选择无效。".into());
        }
        let tx = self.connection.transaction().map_err(error)?;
        if let Some(id) = get(&tx, "browser.promotion")? {
            let promotion_slot: Option<String> = tx
                .query_row(
                    "SELECT slot FROM browser_bindings WHERE identity=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error)?;
            if promotion_slot.as_deref() != Some(slot) {
                clear_promotion(&tx)?;
            }
        }
        set(&tx, "browser.enabled", "1")?;
        set(&tx, "browser.active", slot)?;
        tx.commit().map_err(error)
    }
    pub(crate) fn prepare_warming_promotion(&mut self, id: &str, slot: &str) -> Result<(), String> {
        if self.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        if !valid_id(id)
            || !valid_slot(slot)
            || !super::warming::contains(self.browser_vault()?, id)?
        {
            return Err("养号身份不存在。".into());
        }
        let tx = self.connection.transaction().map_err(error)?;
        let bound: Option<String> = tx.query_row("SELECT slot FROM browser_bindings WHERE identity=?1 AND identity NOT IN (SELECT id FROM identities)", [id], |r| r.get(0)).optional().map_err(error)?;
        if bound.as_deref() != Some(slot) {
            return Err("养号浏览器绑定已变化。".into());
        }
        if get(&tx, "browser.promotion")?.is_some() {
            return Err("请先完成或取消已有养号转正。".into());
        }
        let previous = get(&tx, "browser.active")?.ok_or("浏览器资料选择无效。")?;
        let enabled = get(&tx, "browser.enabled")?.unwrap_or_else(|| "0".into());
        set(&tx, "browser.promotion.previous", &previous)?;
        set(&tx, "browser.promotion.enabled", &enabled)?;
        set(&tx, "browser.promotion", id)?;
        set(&tx, "browser.draft", id)?;
        set(&tx, "browser.enabled", "1")?;
        set(&tx, "browser.active", slot)?;
        tx.commit().map_err(error)
    }
    pub(crate) fn clear_warming_promotion(&mut self, id: &str) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        if get(&tx, "browser.promotion")?.as_deref() == Some(id)
            || get(&tx, "browser.draft")?.as_deref() == Some(id)
        {
            clear_promotion(&tx)?;
        }
        tx.commit().map_err(error)
    }
    pub(crate) fn rollback_warming_promotion(&mut self, id: &str) -> Result<(), String> {
        let tx = self.connection.transaction().map_err(error)?;
        if get(&tx, "browser.promotion")?.as_deref() == Some(id) {
            if get(&tx, "recovery")?.is_none() {
                if let Some(previous) =
                    get(&tx, "browser.promotion.previous")?.filter(|s| valid_slot(s))
                {
                    set(&tx, "browser.active", &previous)?;
                    let enabled =
                        get(&tx, "browser.promotion.enabled")?.unwrap_or_else(|| "0".into());
                    set(&tx, "browser.enabled", &enabled)?;
                }
            }
            clear_promotion(&tx)?;
        }
        tx.commit().map_err(error)
    }
    pub(crate) fn remove_warming_binding(&mut self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("身份编号无效。".into());
        }
        if self.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        let tx = self.connection.transaction().map_err(error)?;
        let occupied: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM identities WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(error)?;
        if occupied {
            return Err("身份已转正，不能删除养号绑定。".into());
        }
        let slot: Option<String> = tx
            .query_row(
                "SELECT slot FROM browser_bindings WHERE identity=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        if slot.is_some() && slot == get(&tx, "browser.active")? {
            return Err("请先切换到其他浏览器槽位，再删除养号卡。".into());
        }
        if get(&tx, "browser.promotion")?.as_deref() == Some(id) {
            clear_promotion(&tx)?;
        }
        tx.execute("DELETE FROM browser_bindings WHERE identity=?1", [id])
            .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub(crate) fn browser_draft(&self) -> Result<Option<String>, String> {
        if !self.browser_link()?.enabled {
            return Ok(None);
        }
        let slot = self.browser_slot()?;
        if let Some(id) = self.get("browser.promotion")? {
            if self.get("active")?.as_deref() == Some("empty")
                && self.get("recovery")?.is_none()
                && self.get("browser.draft")?.as_deref() == Some(id.as_str())
                && self.browser_for(&id)?.as_deref() == Some(slot.as_str())
                && !self.records()?.iter().any(|r| r.id == id)
                && super::warming::contains(self.browser_vault()?, &id)?
            {
                return Ok(Some(id));
            }
            return Ok(None);
        }
        let draft = if valid_id(&slot) {
            slot.clone()
        } else {
            match self.get("browser.draft")? {
                Some(id) => id,
                None => return Ok(None),
            }
        };
        if !valid_id(&draft) {
            return Err("浏览器资料选择无效。".into());
        }
        let occupied:i64=self.connection.query_row("SELECT (SELECT COUNT(*) FROM identities WHERE id=?1)+(SELECT COUNT(*) FROM browser_bindings WHERE slot=?2 OR identity=?1)",params![draft,slot],|r|r.get(0)).map_err(error)?;
        Ok((occupied == 0).then_some(draft))
    }
    pub fn browser_identity(
        &self,
        vault: &std::path::Path,
        home: &std::path::Path,
    ) -> Result<BrowserIdentity, String> {
        let linked = self.browser_link()?.enabled;
        if !linked {
            return Ok(BrowserIdentity {
                linked,
                status: "unlinked",
                name: None,
                email: None,
                organization: None,
                cli_proxy: None,
            });
        }
        let slot = self.browser_slot()?;
        let bound=self.connection.query_row("SELECT i.id,i.name FROM browser_bindings b JOIN identities i ON i.id=b.identity WHERE b.slot=?1",[&slot],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().map_err(error)?;
        if bound.is_none() {
            for card in super::warming::read_cards(vault)? {
                if self.browser_for(&card.id)?.as_deref() == Some(slot.as_str()) {
                    return Ok(BrowserIdentity {
                        linked,
                        status: "warming",
                        name: Some(card.name),
                        email: card.email,
                        organization: None,
                        cli_proxy: None,
                    });
                }
            }
        }
        let current = super::profile::read(home);
        let local = super::catalog::current_id(vault, home, self);
        let unavailable = current.unavailable || local.is_err();
        let matches = bound
            .as_ref()
            .is_some_and(|(id, _)| local.as_ref().ok().and_then(|id| id.as_ref()) == Some(id));
        let status = if unavailable {
            "unknown"
        } else if bound.is_some() && !matches {
            "mismatch"
        } else if !current.present {
            "empty"
        } else if matches {
            "linked"
        } else {
            "draft"
        };
        let show_local = !unavailable && (matches || bound.is_none());
        let name = if show_local {
            current
                .display_name
                .clone()
                .or_else(|| current.email.clone())
                .or_else(|| bound.as_ref().map(|(_, name)| name.clone()))
        } else {
            bound.map(|(_, name)| name)
        };
        Ok(BrowserIdentity {
            linked,
            status,
            name,
            email: show_local.then_some(current.email).flatten(),
            organization: show_local.then_some(current.organization).flatten(),
            cli_proxy: show_local.then_some(current.proxy).flatten(),
        })
    }
    pub fn browser_link(&self) -> Result<BrowserLink, String> {
        let mut query=self.connection.prepare("SELECT identity FROM browser_bindings WHERE identity IN (SELECT id FROM identities)").map_err(error)?;
        let ids = query
            .query_map([], |r| r.get(0))
            .map_err(error)?
            .collect::<Result<Vec<String>, _>>()
            .map_err(error)?;
        Ok(BrowserLink {
            enabled: self.get("browser.enabled")?.as_deref() == Some("1"),
            bound_ids: ids,
        })
    }
    pub fn browser_slot(&self) -> Result<String, String> {
        if self.get("browser.enabled")?.as_deref() != Some("1") {
            return Ok("legacy".into());
        }
        let slot = self.get("browser.active")?.ok_or("浏览器资料选择无效。")?;
        if !valid_slot(&slot) {
            return Err("浏览器资料选择无效。".into());
        }
        Ok(slot)
    }
    pub fn browser_seed(&self, slot: &str) -> Result<Option<u32>, String> {
        self.connection
            .query_row(
                "SELECT seed FROM browser_bindings WHERE slot=?1",
                [slot],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)
    }
    pub fn browser_for(&self, id: &str) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT slot FROM browser_bindings WHERE identity=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)
    }
    pub fn configure_browser(
        &mut self,
        enabled: bool,
        adopt: bool,
        current: Option<&str>,
    ) -> Result<(), String> {
        if self.get("recovery")?.is_some() {
            return Err("请先恢复未完成的身份切换。".into());
        }
        let tx = self.connection.transaction().map_err(error)?;
        let slot = if !enabled {
            "legacy".into()
        } else {
            let preferred = if adopt {
                "legacy".into()
            } else {
                super::new_id()?
            };
            match current {
                Some(id) => bind(&tx, id, Some(&preferred))?,
                None => preferred,
            }
        };
        set(&tx, "browser.enabled", if enabled { "1" } else { "0" })?;
        set(&tx, "browser.active", &slot)?;
        tx.commit().map_err(error)
    }
}
