# Claude-Local — project handoff

## Product

Independent Windows x64 desktop application, version 0.1.0. Native host claude-local.exe, bundle identifier ai.local.claude-local. Companion browser registration Claude-Local-Browser; both ship in one NSIS installer. Ordinary startup does not open the browser. Default page is identity management; last validated page and UI language are remembered.

## Ownership and maintenance

This repository is independently initialized and maintained. Origin is the project's own private GitHub repository; there is no upstream remote, inherited Git history, auto-sync, official release signer or updater channel. Follow AGENTS.md. Source heritage and third-party licenses remain documented in NOTICE.md.

## Architecture

React/TypeScript owns UI and input; Rust/Tauri owns validated native commands, process identity checks, transactions and rollback. Identity data is stored outside the source tree in the current user's app-data directory. The browser is an optional subsystem with per-identity persistent profiles. Network diagnostics are manual fixed-domain probes; no commercial provider or external deployment workflow is included.

Quota collection is versioned in scripts/claude_quota.py. It only reads Claude configuration, consumes passive statusLine input and serializes atomic writes to an external ledger. The UI reads the ledger and merges newer same-account anchors in memory. Keep the one-hour/manual refresh policy and the relay configuration-directory isolation.

## Data compatibility

Preserve BAGAID01, encrypted .baga containers, SQLite schema version 3, account HMAC identity matching, record IDs and the legacy browser seed-domain separator. Migrating applications must copy existing keys/archives/profile bindings without regeneration. Use the explicit migration tool: it refuses live source programs, recovery state, database sidecars, existing destination and unsafe paths; verifies hashes and database integrity; retains source and any failed private stage.

## Development and validation

See docs/DEVELOPMENT.md and package.json. Run Bun tests/build, native Rust tests with one test thread, synthetic Python quota/migration tests, and isolated GUI regression when changing user flows. Browser GUI tests require the pinned ignored engine. Release binaries must use custom-protocol. Do not use live accounts for switching/cleanup validation. Never stop claude.exe during maintenance.

## Private machine state

Paths, real identities, installed binary hashes, proxy configuration and migration receipts belong in ignored .local/ notes. They must never be committed. This handoff intentionally contains no personal account or machine details.

## Distribution

Windows checks run without credentials or engine downloads. The optional build workflow is manually dispatched and uploads private artifacts only. The vendored interface currently lacks an independent upstream redistribution license notice; do not treat a private build as clearance for public distribution. See docs/DISTRIBUTION.md and NOTICE.md before sharing binaries publicly.
