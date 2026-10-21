# scripts/

Windows local product tooling; not a mirror of another application's release flow.
- deploy-local.ps1: verified local binary/resources copy, per-user portable install default and independent shortcuts; no user-data writes or Claude process termination.
- build-windows-share.ps1: `build:windows` entry point; existing 7z CLI, fresh neutral Cargo home/target outside workspace and USERPROFILE (default drive-root `ClaudeLocalBuild/<id>`, optional `-BuildRoot`), only crates.io registry index/archive cache copied with links rejected (never Cargo root config/credentials/bin or registry/src), Rust build-path remapping and process-environment restoration. Backs up fixed host/installers, builds once, refreshes conventional target outputs, extracts/audits without running installers and publishes only passing unique `.local/artifacts/<id>/` shares. Optional private markers stay outside the repository; original caches remain untouched.
- audit-windows-package.py / test-audit-windows-package.py: fixed resource/engine allowlists, runtime-data and link rejection, relative SHA-256 manifests, exact extracted-payload comparison and synthetic privacy-marker regressions; reports never contain marker text or absolute machine paths.
- package-browser.ps1 / fetch-browser.py / test-fetch-browser.py: pinned optional engine preparation, archive/path/hash validation, privacy preflight before version reads and synthetic extraction regression.
- migrate-local-data.py / windows_private.py / test-migrate-local-data.py: explicit source-preserving private migration and synthetic safety checks.
- claude_quota.py / test-claude-quota-local.py: passive local quota collector, serialized atomic ledger writes and synthetic timing/concurrency tests.
- claude-cli.ps1 / claude-cli.sh: controlled CLI status and explicit in-place updates through the detected native/npm/bun/WinGet/Homebrew installation; update does not uninstall or touch personal assets, and legacy reinstall logic remains isolated from the new UI.
- windows-region.ps1 / test-windows.py: controlled system operations and synthetic CLI update fixtures; system-mutating SystemTests only on ephemeral CI, never on a user's machine.
- browser_ui.py: bundled page resource reference verification.
- test-identities-ui.ts and imported test-*.ts: isolated fake-IPC GUI checks with the pinned engine; local saved-name priority, long rename without extra title rows, preserved account summaries and private name/email descriptions, plus fixed publisher referrals with one copy action per setup card and read-only network diagnostics.
- test-network-diagnostics.ts: hidden fixed referral URLs/codes, stable bilingual copy labels, concise configuration intent, ignored legacy URL overrides and no vendor navigation; synthetic native/fallback clipboard failures and recovery preserve truthful status, alongside four-domain diagnostic regressions.
- test-local-shell.mjs: full-shell bilingual previews with fictional identities and read-only quick-setup snapshots; local-only requests.
- test-usage-statistics.mjs: isolated fake-IPC shell regression with a controlled clock; hourly/future and 7/30/full-history spans, chart/data switching without native rereads, elapsed-hour table pagination/sort semantics, three-model totals, 1440-wide and 720-narrow classic/compact layouts with long model names, serialized polling/hidden pause/unmount cleanup, read-only quick setup and six destinations, partial-failure recovery. Identity checks cover single-line local aliases versus original account names, all-card email/name privacy, 12px sans quota/reset/countdown text, accessible reset clocks and stable 180×286 card geometry in both locales/themes. Referral checks cover hidden URLs/codes, unchanged fixed copy values, concise prompts and stable bilingual action labels. System checks use mutable synthetic snapshots to verify natural card heights, compact location geometry, current values independent of drafts, unknown location state, read-only refresh and 720-wide classic/compact bilingual layouts; existing CLI checks remain. Synthetic reports/previews stay outside Git.
- requirements-ci.txt: dependencies used only by synthetic CI verification.

GUI dark-theme coverage uses the actual in-memory preference API, so navigation and sidebar changes cannot silently restore light mode; computer geometry reports assert the expected theme.

Machine-specific proxy integration is deliberately excluded from source and may live in ignored .local/ tools. Publisher referral content is fixed in the UI and copied only. Local share artifacts remain unsigned and subject to the third-party distribution restrictions in docs/DISTRIBUTION.md. No automatic public releases, update signatures, VPS deployment or automatic affiliate navigation is included.

[PROTOCOL]: Update source headers and this map with changes.

Usage GUI checks also require the concise All selector and absence of history/live/scope clutter.
