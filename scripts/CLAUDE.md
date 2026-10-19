# scripts/

Windows local product tooling; not a mirror of another application's release flow.
- deploy-local.ps1: verified local binary/resources copy, per-user portable install default and independent shortcuts; no user-data writes or Claude process termination.
- package-browser.ps1 / fetch-browser.py / test-fetch-browser.py: pinned optional engine preparation, archive/path/hash validation and synthetic extraction regression.
- migrate-local-data.py / windows_private.py / test-migrate-local-data.py: explicit source-preserving private migration and synthetic safety checks.
- claude_quota.py / test-claude-quota-local.py: passive local quota collector, serialized atomic ledger writes and synthetic timing/concurrency tests.
- claude-cli.ps1 / claude-cli.sh / windows-region.ps1 / test-windows.py: controlled program/system operations; system-mutating tests only on ephemeral CI, never on a user's machine.
- browser_ui.py: bundled page resource reference verification.
- test-identities-ui.ts and imported test-*.ts: isolated fake-IPC GUI checks with the pinned engine.
- test-local-shell.mjs: independent full-shell preview using synthetic accounts and local-only requests.
- requirements-ci.txt: dependencies used only by synthetic CI verification.

Machine-specific proxy integration is deliberately excluded from source and may live in ignored .local/ tools. No official release assembly, update signatures, VPS deployment or affiliate navigation is included.

[PROTOCOL]: Update source headers and this map with changes.
