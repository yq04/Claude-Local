# Claude-Local

Independent Windows desktop application: Tauri/Rust native operations, React/TypeScript UI, encrypted local identity storage and an optional isolated browser. Project rules live in AGENTS.md. This project evolves from local requirements; no upstream synchronization or official updater exists.

<directory>
src/ - Main application, browser verification page, shared UI and bilingual catalogs.
src/identities.tsx - Single-line local identity aliases and consistent quota/time typography, with original account names confined to non-private hints.
src/quick-actions.tsx - On-demand independent environment reads, scoped recovery and six configuration destinations using shared page icons and effective browser targets.
src/usage-statistics.tsx - Scoped token analytics with responsive trend/model panels, sortable period details and visible-page refresh; separate from hourly quota refresh.
src/vps.tsx - Fixed referral copies without rendered URLs/codes, concise agent setup prompts and truthful clipboard feedback.
src/system.tsx - Natural-height computer settings, observed values separate from draft controls and a compact location action row.
src-tauri/ - Native commands, Windows boundaries, vault transactions, local quota consumers and installer configuration.
src-tauri/windows/installer-hooks.nsh - Existing MUI pre-welcome upgrade confirmation, read-only process checks and synchronous data-preserving removal before the next install; owner-selected unsigned distribution.
scripts/ - Windows build/deploy, audited NSIS share assembly, pinned engine preparation and synthetic verification tools.
browser-runtime/ - Pinned browser metadata, licenses and ignored local engine files.
assets/ - Independent CL marks and retained third-party notices.
vendor/ - Existing UI components with separate attribution/license boundaries in NOTICE.md.
docs/ - Local development, data boundaries and distribution documentation.
docs/plans/2026-10-21-usage-account-safety/ - Pending owner-review proposal, source evidence and phased usage/account-safety optimization plan; no implementation authorization before confirmation.
.github/workflows/ - Credential-free Windows checks and explicitly dispatched private build artifacts.
HANDOFF.md - Current work, verified results, remaining validation and compatibility pitfalls; private machine details stay in ignored .local/.
</directory>

Product Claude-Local / binary claude-local.exe / identifier ai.local.claude-local. Browser registration Claude-Local-Browser. All data is in the user's independent app-data root; the default Claude workspace is the managed integration boundary, not an OS sandbox. Ordinary startup does not open the browser. The network page bundles owner-approved fixed referral links with copy-only actions for recipients; there is no link editor, automatic vendor navigation or external Skill installation UI.

Persistent archive magic, IDs, encryption keys and browser seed derivation must remain compatible with imported local data. Never delete live data or stop Claude sessions during maintenance. Only Python writes the external quota ledger; the Rust UI path reads it and merges newer same-account anchors in memory. Token statistics use a separate native usage ledger containing numeric metadata and hashed request identifiers; a private user-selected stable account ID can absorb unresolved historical and future usage in aggregates while preserving event evidence.

User-requested Claude Code CLI maintenance is separate from application releases: manually check fixed public CLI version metadata and update with the detected installation tool, without an uninstall step or automatic Claude process termination. The local product still has no upstream application updater.

`bun run build:windows` calls `scripts/build-windows-share.ps1` and requires an existing 7z CLI. Each build uses a fresh neutral Cargo home/target outside workspace and USERPROFILE (default drive-root `ClaudeLocalBuild/<id>`, optional `-BuildRoot`). Only crates.io index/archive caches are copied with links rejected; Cargo root config, credentials, bin and registry/src are excluded, original cache/Rustup home are preserved, and changed process variables are restored. The script remaps Rust workspace/user-profile/neutral paths, builds once with custom-protocol, backs up and refreshes conventional host/installer outputs, extracts the NSIS archive without executing it and checks exact resource allowlists/hashes and privacy boundaries. Optional private marker JSON stays outside the repository. Only a passing audit publishes a fresh ignored `.local/artifacts/<id>/` containing the installer, SHA-256 and relative-path audit manifests; no live identity, quota, log or browser-profile data is a build input. This process does not test installation/uninstallation, establish publisher trust or resolve the third-party license limitations documented in docs/DISTRIBUTION.md.

[PROTOCOL]: Update source headers and directory maps with changes. Preserve both locale catalogs and run scoped tests.

docs/RELEASE_NOTES_0.1.1.md - Owner-requested manual private prerelease notes; shared packages exclude personal usage-attribution seeds.
docs/RELEASE_NOTES_0.1.2.md - Quick setup cold-start/database concurrency fixes, shared UI consistency and effective browser targets; manual private delivery only.
docs/RELEASE_NOTES_0.1.3.md - Cromma SegmentedControl/Switch/Disclosure adoption, truthful version settings, reduced-motion wiring and the registered-install upgrade sequence; manual private delivery only.
docs/RELEASE_NOTES_0.1.4.md - Quota observation order fix, native privacy preference bridge, environment-first navigation, task handoff notes, and device-identifier preservation; manual private delivery only.
