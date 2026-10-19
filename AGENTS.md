# Claude-Local development rules

Claude-Local is an independent Windows x64 product owned and maintained in this repository. Do not add upstream remotes, automatic upstream sync, official update endpoints, commercial referral links, or a dependency on another application's release workflow.

## Product boundaries

- Product: Claude-Local; binary: claude-local.exe; bundle ID: ai.local.claude-local.
- Companion browser: Claude-Local Browser; Windows registration: Claude-Local-Browser.
- App data is per-user under %APPDATA%/ai.local.claude-local. Never hard-code an account, email, proxy credential, personal install path or real identity in tracked files.
- The browser is a subsystem, launched only by an explicit user action or --browser. The main application does not launch it at ordinary startup.
- Default page is identity management; only a validated page enum is remembered.
- Never interrupt a running claude.exe during development or deployment. Tests use synthetic data and isolated browser contexts, never live identity switching or cleanup.
- Preserve existing vaults and browser profiles. Migration copies into a fresh private destination and verifies integrity, hashes and identity counts; never deletes the source.
- Quota collection reads Claude configuration and passively consumes statusLine input. No OAuth usage polling, no writes to .claude.json. Python is the sole quota-ledger writer, with a cross-process lock, atomic replace and newer-anchor precedence. Keep the UI refresh at one hour or manual.

## Compatibility and safety

Keep BAGAID01, .baga archive encoding, SQLite user_version=3, account HMAC rules, and the legacy CCBaga/browser seed-domain string intact. They are persistent format compatibility, not product branding or an upstream dependency. Do not regenerate IDs, keys or browser seeds during rebranding.

Destructive operations require the existing explicit confirmation, process/snapshot checks, and rollback behavior. Do not broaden cleanup targets to personal settings, project source, password stores or arbitrary directories.

## Engineering

Read the relevant directory CLAUDE.md and source headers. Update INPUT/OUTPUT/POS and directory maps when editing. Keep both locale catalogs complete. Release builds require --features custom-protocol.

Run appropriate Bun, Rust and synthetic Python tests. Do not run system-mutating Windows tests on a user's machine; CI-only tests require an ephemeral runner. Do not use git clean, hard reset, recursive worktree deletion or repository-wide restore.

Keep .local/, runtime assets, identity archives, databases, ledger files, credentials, installers and machine-specific notes out of Git. No release secrets in CI. Actions currently run checks and optional private build artifacts; no automatic public releases or updater feed.

Maintain original MIT copyright and all third-party notices. A private repository or self-authored application code does not resolve missing licenses in vendored components; public distribution must respect the documented third-party boundaries.
