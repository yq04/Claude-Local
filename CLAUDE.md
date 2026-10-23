# Claude-Local

Independent Windows desktop application: Tauri/Rust native operations, React/TypeScript UI, encrypted local identity storage and an optional isolated browser. Project rules live in AGENTS.md. This project evolves from local requirements; no upstream synchronization or official updater exists.

<directory>
src/ - Main application, browser verification page, shared UI and bilingual catalogs.
src/identities.tsx - Pinned current card and saved-record order without search/sort controls, independent quota/observation ages, allowlisted diagnostic copy and review-only shell requests; local revision changes are acknowledged only after successful summary reads.
src/quick-actions.tsx - On-demand independent environment reads, scoped recovery and six configuration destinations using shared page icons and effective browser targets.
src/usage-statistics.tsx - Scoped token analytics, current-snapshot TSV copy/download and real IANA/DST intervals; responsive trend/model panels and visible-page refresh remain separate from hourly quota refresh.
src/main.tsx / command-palette.tsx / task-handoff.tsx - Guarded Ctrl+K navigation/refresh/review and an in-memory manual handoff form with explicit preview/copy/download; no automatic identity actions or session reads.
src/vps.tsx - Fixed referral copies without rendered URLs/codes, concise agent setup prompts and truthful clipboard feedback.
src/system.tsx - Paired rounded timezone/language cards, observed values separate from drafts and a compact full-width location row; narrow content stacks the paired cards.
src-tauri/ - Native commands, Windows boundaries, vault transactions, local quota consumers and installer configuration.
src-tauri/windows/installer-hooks.nsh - Existing MUI pre-welcome upgrade confirmation, read-only process checks and synchronous data-preserving removal before the next install; owner-selected unsigned distribution.
scripts/ - Windows build/deploy, audited NSIS share assembly, pinned engine preparation and synthetic verification tools.
browser-runtime/ - Pinned browser metadata, licenses and ignored local engine files.
assets/ - Independent CL marks and retained third-party notices.
vendor/ - Existing UI components with separate attribution/license boundaries in NOTICE.md.
docs/ - Local development, data boundaries and distribution documentation.
docs/plans/2026-10-22-identity-quota.md - Owner-requested online quota/card implementation scope, foreground refresh opt-in and synthetic verification boundaries; no installed/released update claim.
docs/plans/2026-10-23-functional-review/ - Read-only Astra software review: independent quota and product evidence, public-source constraints, and a phased functional reliability/improvement plan; no implementation or release performed by the review.
docs/plans/2026-10-21-usage-account-safety/ - Historical proposal, source evidence and phased account-safety plan implemented in 0.1.4; 0.1.5 fixes quota evidence compatibility and shares Rust window-state rules.
.github/workflows/ - Credential-free Windows checks and explicitly dispatched private build artifacts.
.github/workflows/share-windows.yml - Private manual artifact build with public original host/frontend inputs and audit evidence, allowing independent workstation re-audit without recompilation or binary reconstruction; no private probes or automatic release.
The optional explicit `private-draft` transport is only a private build archive fallback for exhausted Actions storage. Its release remains a draft; it does not publish a product release or change repository visibility.
HANDOFF.md - Current product behavior, verified delivery receipts, outstanding source work and safe next steps; machine-specific receipts stay in ignored .local/.
</directory>

Product Claude-Local / binary claude-local.exe / identifier ai.local.claude-local. Browser registration Claude-Local-Browser. All data is in the user's independent app-data root; the default Claude workspace is the managed integration boundary, not an OS sandbox. Ordinary startup does not open the browser. The network page bundles owner-approved fixed referral links with copy-only actions for recipients; there is no link editor, automatic vendor navigation or external Skill installation UI.

The quota workbench defaults to local summary synchronization. The visible page notices metadata changes in the two fixed product ledger files and the shared CLI root's .claude.json about every two seconds, then reads bound observations; the watcher reads no credentials or project contents. Online all-account queries, foreground scheduling and connection recovery are available from the header's more-actions menu in a separate dialog. Closing it stops timed reads without cancelling an existing native task; compact progress/reopen/cancel remains accessible. Existing online results do not decorate cards. Python remains the sole ledger/metadata writer and no shared refresh credential is rotated. Account handoff, isolation confirmations and local history retention remain unchanged. See HANDOFF for the delivered version.

Account isolation takes priority over freshness: each request freezes its displayed fingerprint, the OAuth credential must prove its account and organization through a matching profile, and commit rechecks the target and credential. Missing verification refuses the update and preserves prior evidence. A changed target account set revokes the foreground opt-in; switching the current identity within the same known set does not require separate query settings. No fallback to a different account is permitted.

Persistent archive magic, IDs, encryption keys and browser seed derivation must remain compatible with imported local data. Never delete live data or stop Claude sessions during maintenance. Only Python writes the external quota ledger; the Rust UI path reads it and merges newer same-account anchors in memory. Token statistics use a separate native usage ledger containing numeric metadata and hashed request identifiers; a private user-selected stable account ID can absorb unresolved historical and future usage in aggregates while preserving event evidence.

User-requested Claude Code CLI maintenance is separate from application releases: manually check fixed public CLI version metadata and update with the detected installation tool, without an uninstall step or automatic Claude process termination. The local product still has no upstream application updater.

`bun run build:windows` calls `scripts/build-windows-share.ps1` and requires an existing 7z CLI. Each build uses a fresh neutral Cargo home/target outside workspace and USERPROFILE (default drive-root `ClaudeLocalBuild/<id>`, optional `-BuildRoot`). Only crates.io index/archive caches are copied with links rejected; Cargo root config, credentials, bin and registry/src are excluded, original cache/Rustup home are preserved, and changed process variables are restored. The script remaps Rust workspace/user-profile/neutral paths, builds once with custom-protocol, backs up and refreshes conventional host/installer outputs, extracts the NSIS archive without executing it and checks exact resource allowlists/hashes and privacy boundaries. Optional private marker JSON stays outside the repository. Only a passing audit publishes a fresh ignored `.local/artifacts/<id>/` containing the installer, SHA-256 and relative-path audit manifests; no live identity, quota, log or browser-profile data is a build input. This process does not test installation/uninstallation, establish publisher trust or resolve the third-party license limitations documented in docs/DISTRIBUTION.md.

[PROTOCOL]: Update source headers and directory maps with changes. Preserve both locale catalogs and run scoped tests.

Action geometry: ordinary application buttons use the shared small 28px height and 10px horizontal padding, with width determined by their labels. Pages use the existing neutral secondary variant; destructive confirmations retain explicit red styling. Account filters fit the selected label instead of a fixed wide column, while popup options retain readable width. No vendored primitives or action semantics are changed.

docs/RELEASE_NOTES_0.1.1.md - Owner-requested manual private prerelease notes; shared packages exclude personal usage-attribution seeds.
docs/RELEASE_NOTES_0.1.2.md - Quick setup cold-start/database concurrency fixes, shared UI consistency and effective browser targets; manual private delivery only.
docs/RELEASE_NOTES_0.1.3.md - Cromma SegmentedControl/Switch/Disclosure adoption, truthful version settings, reduced-motion wiring and the registered-install upgrade sequence; manual private delivery only.
docs/RELEASE_NOTES_0.1.4.md - Quota observation order fix, native privacy preference bridge, environment-first navigation, task handoff notes, and device-identifier preservation; manual private delivery only.
docs/RELEASE_NOTES_0.1.5.md - Independent quota evidence/legacy compatibility and shared Rust window-state core; audited local update and owner-requested private prerelease, without automatic publishing or statusLine migration.
docs/RELEASE_NOTES_0.1.6.md - Explicitly inferred quota recovery after trusted resets, compact neutral action controls and paired computer setting cards; manual private delivery, preserving the existing data and hook boundaries.
docs/PRODUCT_REVIEW_2026-10-22.md - Pinned open-source evidence, verified percentage-input/CLI retry fixes and product proposals; distinguishes current unpublished source work from installed 0.1.6.
docs/RELEASE_NOTES_0.1.7.md - Implemented identity search/diagnostics, command palette/manual handoff, scoped TSV export and IANA/DST analytics, plus verified parsing/retry fixes; uses the owner-authorized private release workflow.
docs/QUOTA_CARD_RESEARCH_2026-10-22.md - Source-anchored quota-card research distinguishing credential expiry, subscription renewal/access dates and manual reset grants; proposes explicit online reads and browser-scoped metadata without changing the current passive implementation.
docs/WINDOW_LAYOUT_2026-10-22.md - Sidebar/content adaptation and native main-window size memory; distinguishes synthetic layout/model checks and Rust integration checking from installation/runtime verification.
docs/RELEASE_NOTES_0.1.8.md - Narrower navigation, wrapped identity onboarding and native main-window size/maximization memory; owner-authorized private delivery with separate audit/update receipts. Private build-draft tags and titles derive from the packaged version manifest.
docs/plans/2026-10-23-functional-review/05-EXECUTION-RESULTS.md - Owner-authorized functional implementation, layered synthetic checks, preserved account isolation and explicit unexecuted real-account/installer boundaries; separate from the historical review.
docs/plans/2026-10-23-functional-review/06-SOURCE-CANDIDATE.json - Hashes of the selected changed source/test/config/document files against the recorded base commit; source candidate only, without a new release or installation claim.
docs/RELEASE_NOTES_0.2.0.md - Online quota orchestration, authenticated archive/backup rescue, system modification auditing, proxy and runtime capability gates, and manual handoff import/export; release delivery with separate build and verification receipts.
docs/RELEASE_VERIFICATION_0.2.0.md - Exact CI/source tag, independent frontend/package audit, backed-up local update and eight-asset private publication; real-account and installer acceptance remain separate.
docs/RELEASE_NOTES_0.2.1.md - Local quota synchronization restored as default, CLI-cache metadata change detection and repaired helper translations; optional online controls preserve account isolation.
docs/QUOTA_RECOVERY_0.2.1.md - User-selected passive quota recovery, metadata/translation root causes, isolated checks and verified 0.2.1 package/local update/private delivery.
docs/RELEASE_NOTES_0.2.2.md - Redundant identity-page descriptions removed, optional online tools moved to a secondary dialog, and native batch controls retained without changing identity/history guards.
docs/RELEASE_NOTES_0.2.3.md - Removed unwanted identity filters, retried unacknowledged passive quota reads and preserved literal Markdown heading escapes; owner-authorized private update and packaging with separate delivery receipts.
