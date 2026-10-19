# Claude-Local

Independent Windows desktop application: Tauri/Rust native operations, React/TypeScript UI, encrypted local identity storage and an optional isolated browser. Project rules live in AGENTS.md. This project evolves from local requirements; no upstream synchronization or official updater exists.

<directory>
src/ - Main application, browser verification page, shared UI and bilingual catalogs.
src-tauri/ - Native commands, Windows boundaries, vault transactions, local quota consumers and installer configuration.
scripts/ - Windows build/deploy, pinned engine preparation and synthetic verification tools.
browser-runtime/ - Pinned browser metadata, licenses and ignored local engine files.
assets/ - Independent CL marks and retained third-party notices.
vendor/ - Existing UI components with separate attribution/license boundaries in NOTICE.md.
docs/ - Local development, data boundaries and distribution documentation.
.github/workflows/ - Credential-free Windows checks and explicitly dispatched private build artifacts.
HANDOFF.md - Current work, verified results, remaining validation and compatibility pitfalls; private machine details stay in ignored .local/.
</directory>

Product Claude-Local / binary claude-local.exe / identifier ai.local.claude-local. Browser registration Claude-Local-Browser. All data is in the user's independent app-data root; the default Claude workspace is the managed integration boundary, not an OS sandbox. Ordinary startup does not open the browser. No commercial acquisition or external Skill installation UI is part of this product.

Persistent archive magic, IDs, encryption keys and browser seed derivation must remain compatible with imported local data. Never delete live data or stop Claude sessions during maintenance. Only Python writes the external quota ledger; the Rust UI path reads it and merges newer same-account anchors in memory.

[PROTOCOL]: Update source headers and directory maps with changes. Preserve both locale catalogs and run scoped tests.
