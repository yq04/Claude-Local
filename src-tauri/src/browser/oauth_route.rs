// [INPUT]: Windows external links, exact Claude OAuth+PKCE URL shape and proven local CLI identity/profile binding.
// [OUTPUT]: An authorization page in the existing CLI-bound profile while the selected warming profile/session stays untouched.
// [POS]: Private external-link guard; no general URL IPC, authorization request, credential refresh, URL logging or fallback to warming.
// [PROTOCOL]: Update header on change and check CLAUDE.md.
use super::*;
use crate::identities::{catalog, database::Database};

const FAILED: &str = "浏览器授权分流无法安全完成，请选择目标 CLI 身份及其浏览器后重试。";

pub(super) struct IdentityGuard(tauri::AppHandle);
impl IdentityGuard {
    pub(super) fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        app.state::<crate::cleaner::Cleaner>()
            .enter_quota()
            .map_err(|_| FAILED)?;
        Ok(Self(app.clone()))
    }
}
impl Drop for IdentityGuard {
    fn drop(&mut self) {
        self.0.state::<crate::cleaner::Cleaner>().leave();
    }
}

// Deliberately no Debug: OAuth query values must never enter diagnostics.
struct ValidatedClaudeOAuthUrl(String);

fn authorization_endpoint(value: &str) -> bool {
    reqwest::Url::parse(value).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("claude.ai")
            && url.port_or_known_default() == Some(443)
            && url.path() == "/oauth/authorize"
    })
}
pub(super) fn needs_identity_guard(urls: &[String]) -> bool {
    urls.iter().any(|url| authorization_endpoint(url))
}

/// This is an intentionally narrow policy, not a claim to recognize every CLI
/// OAuth endpoint/version. Other hosts and ordinary login/payment pages retain
/// their normal behavior. A malformed request at this exact endpoint fails safe.
fn validate_authorization(value: &str) -> Result<ValidatedClaudeOAuthUrl, String> {
    if value.len() > 16 * 1024 || !authorization_endpoint(value) {
        return Err(FAILED.into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| FAILED)?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(FAILED.into());
    }
    let one = |key: &str| -> Result<String, String> {
        let mut pairs = url.query_pairs().filter(|(name, _)| name == key);
        let value = pairs
            .next()
            .map(|(_, value)| value.into_owned())
            .ok_or(FAILED)?;
        if pairs.next().is_some() {
            return Err(FAILED.into());
        }
        Ok(value)
    };
    let unreserved = |value: &str| {
        value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte))
    };
    let client = one("client_id")?;
    let state = one("state")?;
    let challenge = one("code_challenge")?;
    let redirect = reqwest::Url::parse(&one("redirect_uri")?).map_err(|_| FAILED)?;
    if one("response_type")? != "code"
        || one("code_challenge_method")? != "S256"
        || client.is_empty()
        || client.len() > 128
        || !unreserved(&client)
        || state.len() < 8
        || state.len() > 512
        || !unreserved(&state)
        || challenge.len() != 43
        || !challenge
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        || redirect.scheme() != "http"
        || !matches!(
            redirect.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]")
        )
        || redirect.port().is_none_or(|port| port == 0)
        || redirect.path() != "/callback"
        || !redirect.username().is_empty()
        || redirect.password().is_some()
        || redirect.query().is_some()
        || redirect.fragment().is_some()
    {
        return Err(FAILED.into());
    }
    Ok(ValidatedClaudeOAuthUrl(value.to_string()))
}

#[derive(Debug, PartialEq, Eq)]
struct CliProfileTarget {
    identity: String,
    slot: String,
    scope: PathBuf,
    profile: PathBuf,
}
fn should_isolate_authorization(db: &Database) -> Result<bool, String> {
    Ok(db.get("browser.promotion")?.is_none() && db.current_browser_is_warming()?)
}
fn resolve_target(
    root: &Path,
    db: &Database,
    proven_current: Option<&str>,
) -> Result<CliProfileTarget, String> {
    if db.get("recovery")?.is_some() || !should_isolate_authorization(db)? {
        return Err(FAILED.into());
    }
    let id = proven_current
        .filter(|id| crate::identities::valid_id(id))
        .ok_or(FAILED)?;
    if !db
        .records()?
        .iter()
        .any(|record| record.id == id && !record.empty)
    {
        return Err(FAILED.into());
    }
    let slot = db.browser_for(id)?.ok_or(FAILED)?;
    if slot == db.browser_slot()? {
        return Err(FAILED.into());
    }
    let scope = workspaces::slot_path(root, &slot)?;
    let profile = scope.join("profile");
    profile::check_path(root, &profile)?;
    profile::check_path(root, &scope.join("config.json"))?;
    if !profile.is_dir() || !scope.join("config.json").is_file() {
        return Err(FAILED.into());
    }
    Ok(CliProfileTarget {
        identity: id.to_string(),
        slot,
        scope,
        profile,
    })
}
fn current_target(app: &tauri::AppHandle) -> Result<CliProfileTarget, String> {
    let root = root(app)?;
    let db = workspaces::database(&root)?;
    let vault = root.parent().ok_or(FAILED)?.join("identity-vault");
    // The live account HMAC must match a saved identity. db.active by itself is
    // not evidence after an external CLI login; never fall back to that pointer.
    let current = catalog::current_id(&vault, &crate::cleaner::identity::root()?, &db)?;
    resolve_target(&root, &db, current.as_deref())
}

fn launch_authorization_locked(
    app: &tauri::AppHandle,
    url: &ValidatedClaudeOAuthUrl,
) -> Result<(), String> {
    let target = current_target(app)?;
    let config = config::load(&target.scope)?;
    let machine = config::machine()?;
    config.validate(&machine)?;
    let engine = prepare_engine(app)?;
    let mut args = config::arguments(&config, &machine, &target.profile, "", &version(&engine));
    args.pop();
    args.push(url.0.clone());
    // Revalidate immediately before spawn; do not write preferences/launch.args
    // or create missing profiles. The active warming session is never replaced.
    if current_target(app)? != target
        || serde_json::to_value(config::load(&target.scope)?).ok()
            != serde_json::to_value(&config).ok()
    {
        return Err(FAILED.into());
    }
    let mut child = Command::new(binary(&engine))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| FAILED)?;
    super::kill_switch::clear_alert(app);
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Caller owns Cleaner -> Browser for protected endpoints. No arbitrary URL can
/// reach the isolated launcher; its argument type is privately validated above.
pub(super) fn route_external_urls_locked(
    app: &tauri::AppHandle,
    urls: &[String],
) -> Result<Vec<String>, String> {
    if !needs_identity_guard(urls) {
        return Ok(urls.to_vec());
    }
    let db = workspaces::database(&root(app)?)?;
    if !should_isolate_authorization(&db)? {
        return Ok(urls.to_vec());
    }
    let mut ordinary = Vec::new();
    for value in urls {
        if authorization_endpoint(value) {
            let url = validate_authorization(value)?;
            launch_authorization_locked(app, &url).map_err(|_| FAILED)?;
        } else {
            ordinary.push(value.clone());
        }
    }
    Ok(ordinary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identities::{database::Record, private, Policy};

    fn authorization() -> String {
        let mut url = reqwest::Url::parse("https://claude.ai/oauth/authorize").unwrap();
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", "synthetic-client")
            .append_pair("state", "synthetic-state")
            .append_pair("code_challenge", &"a".repeat(43))
            .append_pair("code_challenge_method", "S256")
            .append_pair("redirect_uri", "http://localhost:58123/callback");
        url.to_string()
    }
    #[test]
    fn strict_claude_oauth_shape_rejects_malformed_query_and_preserves_ordinary_urls() {
        let valid = authorization();
        assert!(validate_authorization(&valid).is_ok());
        assert!(needs_identity_guard(&[valid.clone()]));
        for value in [
            "https://claude.ai/login",
            "https://claude.ai/settings/billing",
            "https://claude.ai/new",
            "https://payments.example.invalid/oauth/authorize",
            "https://claude.ai.example.invalid/oauth/authorize",
            "https://platform.claude.com/oauth/authorize",
        ] {
            assert!(!needs_identity_guard(&[value.to_string()]));
        }
        let mut duplicate = reqwest::Url::parse(&valid).unwrap();
        duplicate
            .query_pairs_mut()
            .append_pair("state", "another-synthetic-state");
        assert!(validate_authorization(duplicate.as_str()).is_err());
        assert!(
            validate_authorization("https://claude.ai/oauth/authorize?response_type=code").is_err()
        );
        assert!(validate_authorization(&valid.replace("S256", "plain")).is_err());
        assert!(
            validate_authorization(&valid.replace("localhost", "localhost.example.invalid"))
                .is_err()
        );
        assert!(
            validate_authorization(&valid.replace("claude.ai/", "claude.ai.example.invalid/"))
                .is_err()
        );
    }
    #[test]
    fn oauth_target_requires_proven_current_cli_binding_and_preserves_warming_or_promotion() {
        let fixture = super::super::tests::sample();
        let root = fixture.join("browser");
        let vault = fixture.join("identity-vault");
        let mut db = workspaces::database(&root).unwrap();
        let record = |name: &str| Record {
            id: crate::identities::new_id().unwrap(),
            name: name.into(),
            archive: "synthetic.baga".into(),
            saved_at: 1,
            bytes: 1,
            policy: Policy::default(),
            empty: false,
            account_key: Some(name.into()),
        };
        let a = record("CLI A");
        let b = record("Stale CLI pointer");
        db.remember(&a).unwrap();
        db.remember(&b).unwrap();
        db.configure_browser(true, false, Some(&a.id)).unwrap();
        db.complete(&b.id).unwrap();
        let cli_pointer = db.get("active").unwrap();
        let w = crate::identities::new_id().unwrap();
        private::write(&vault.join("warming_cards.json"), &serde_json::to_vec(&serde_json::json!({
            "version": 1, "cards": [{ "id": w, "name": "Synthetic warming", "email": null, "note": null,
            "stage": "pro_ready", "created_ymd": "2026-10-01", "last_warmed_ymd": null, "created_at": 1, "updated_at": 1 }]
        })).unwrap()).unwrap();
        let (warming_slot, seed) = db.bind_warming(&w).unwrap();
        db.switch_browser_slot_only(&warming_slot).unwrap();
        let warming_scope = workspaces::ensure(&root).unwrap();
        private::write(
            &warming_scope.join("profile/Cookies"),
            b"synthetic warming login",
        )
        .unwrap();
        assert!(should_isolate_authorization(&db).unwrap());
        assert!(
            resolve_target(&root, &db, None).is_err(),
            "db.active alone never proves a CLI identity"
        );
        assert!(
            resolve_target(&root, &db, Some(&a.id)).is_err(),
            "a missing profile is never created"
        );
        let cli_slot = db.browser_for(&a.id).unwrap().unwrap();
        let cli_scope = workspaces::slot_path(&root, &cli_slot).unwrap();
        private::directory(&cli_scope.join("profile")).unwrap();
        config::save(&cli_scope, &Config::default()).unwrap();
        let target = resolve_target(&root, &db, Some(&a.id)).unwrap();
        assert_eq!(target.identity, a.id);
        assert_eq!(target.slot, cli_slot);
        assert_ne!(target.slot, warming_slot);
        assert_eq!(db.get("active").unwrap(), cli_pointer);
        assert_eq!(db.browser_slot().unwrap(), warming_slot);
        assert_eq!(db.browser_seed(&warming_slot).unwrap(), Some(seed));
        assert_eq!(
            fs::read(warming_scope.join("profile/Cookies")).unwrap(),
            b"synthetic warming login"
        );
        db.prepare_warming_promotion(&w, &warming_slot).unwrap();
        assert!(
            !should_isolate_authorization(&db).unwrap(),
            "explicit promotion keeps its intentional login workflow"
        );
        assert!(resolve_target(&root, &db, Some(&a.id)).is_err());
        db.rollback_warming_promotion(&w).unwrap();
        db.pending(&a, &b.id).unwrap();
        assert!(
            resolve_target(&root, &db, Some(&a.id)).is_err(),
            "recovery refuses auth routing"
        );
        db.complete(&a.id).unwrap();
        assert_eq!(db.browser_slot().unwrap(), warming_slot);
        drop(db);
        fs::remove_dir_all(fixture).unwrap();
    }
}
