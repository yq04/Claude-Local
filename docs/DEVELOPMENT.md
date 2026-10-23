<!--
[INPUT]: Locked source, Windows toolchain and synthetic test fixtures.
[OUTPUT]: Build and scoped verification commands with private-data and system-mutation boundaries.
[POS]: Developer workflow; scoped UI and installer compilation checks use synthetic fixtures without live system mutations.
-->
# Development

Claude-Local is a Windows-first private desktop product. The host is `claude-local.exe`, the product is `Claude-Local`, and its application identifier is `ai.local.claude-local`. Its companion browser is registered as `Claude-Local-Browser`. One current-user NSIS installer contains the host, frontend and companion browser engine.

## Tools

Use Windows x64 with Visual Studio Build Tools and the Desktop development with C++ workload, a Windows SDK, Rust's MSVC toolchain, and Microsoft Edge WebView2 Runtime. CI uses Rust 1.98.1, Bun 1.3.5, Node 22.23.2 and Python 3.13. Keep the existing lockfiles when installing dependencies:

```powershell
bun install --frozen-lockfile
python -m pip install -r scripts/requirements-ci.txt
```

The Python requirements cover the quota encryption dependency and workflow YAML parser. The application does not obtain these packages on behalf of a user's Python installation.

The optional online quota helper requires Python 3.10+ with the existing `cryptography` dependency; the application never auto-installs them. Capability is probed under `-E -s` before execution without network access or environment modifications; missing dependencies must be installed in the external Python interpreter directly. Quota setup diagnostics remain read-only and unverified, without pretending passive hookup applies to online probing. One manual batch reads all accounts, with two workers, exact fingerprint binding, per-account status and shared cooldown. The server profile determines whether an access credential is still valid even if its archived expiry metadata has elapsed; shared refresh credentials are never rotated. Manual batches may use a separately paired, already running managed browser profile for live usage after eligible OAuth failures. This does not change the selected CLI identity, copy profile data or export cookies; automatic batches never open browser pages. The foreground opt-in applies to the frozen account set and pauses while hidden/unfocused. A two-second local metadata check picks up passive ledger changes without network requests or repeated full scans. Actual account permissions, authorization expiry and first extension activation remain separate runtime acceptance boundaries.

## Build and run

```powershell
# Frontend type checking and production assets; no browser download.
bun run build

# Explicitly obtain the pinned companion browser for a full native build.
python scripts/fetch-browser.py

# Native executable with embedded production frontend.
bun run build:local

# Host and browser in a current-user NSIS installer.
bun run build:windows
```

The native executable is under `src-tauri/target/release/claude-local.exe`; the internal NSIS build output remains under `src-tauri/target/release/bundle/nsis/`. `build:windows` calls `scripts/build-windows-share.ps1`, which requires an existing `7z.exe` on PATH or in a standard Program Files installation. To use a portable copy, run `pwsh -NoProfile -File scripts/build-windows-share.ps1 -SevenZipPath '<path-to-7z.exe>'`. Optional `-PrivateMarkersFile '<external-json-path>'` accepts private markers kept outside the repository.

The wrapper builds once in a fresh neutral Cargo home/target under `<workspace-drive>:/ClaudeLocalBuild/<id>/`, outside the workspace and `USERPROFILE`, so native assertion paths cannot embed a personal Cargo source directory. Optional `-BuildRoot '<new-neutral-directory>'` chooses another new location outside both boundaries. It copies only crates.io registry index/archive caches with links rejected, never Cargo root config, credentials, executables or `registry/src`; original caches and Rustup home are preserved. Existing Rust flags are retained, workspace/user-profile/neutral paths are remapped and changed process environment variables are restored. Previous fixed outputs are backed up before the new host/setup are copied from the neutral target to the conventional repository locations.

The existing `package-browser.ps1` hook fetches a missing pinned engine and verifies its version and build-input privacy boundary. After building, the wrapper uses 7z to extract the installer without executing it, verifies exact payload paths/hashes and privacy rules, and only after a passing audit creates a unique ignored `.local/artifacts/<id>/` containing the installer, SHA-256 and two audit JSON files. Use the final JSON output to find that share directory instead of manually collecting the internal NSIS output. The engine download is excluded from Git; personal identities, usage, logs and browser profiles are never packaging inputs. Never substitute a browser folder containing user data. This process does not run installation/uninstallation or establish that a particular final build passed; inspect its reports and the signing/license limitations in [Distribution](DISTRIBUTION.md).

For UI development, `bun run dev` starts Vite. `bun run tauri dev --config src-tauri/tauri.windows.conf.json` starts the native development host. Native actions can change the current user's Claude workspace, browser registration or system settings; use synthetic fixtures for automated checks.

Interaction primitives come from the vendored `vendor/cromma-ui` source: Tabs for view switches, SegmentedControl for single-value choices, Switch for on/off preferences, Disclosure for expandable details, Select, Checkbox, Button, Dialog/ModalShell and the Motion presets in `motion.ts`. New primitives there only compose the already installed Radix behavior with existing tokens; pages add layout classes, not another skin or hand-written keyboard handling. `node_modules/cromma-ui` is an installed copy, so after adding or renaming files under `vendor/cromma-ui` run `bun install` (the lockfile stays unchanged) and start Vite once with `--force` (or `optimizeDeps.force`) so its dependency pre-bundle picks up the new exports.

## Tests

```powershell
bun test
bun run build
python scripts/browser_ui.py dist
python scripts/test-fetch-browser.py
python scripts/test-claude-quota-local.py
python scripts/test-claude-quota-online.py
python scripts/test-migrate-local-data.py
# Windows system-changing tests run only on disposable CI, not a personal machine.
```

Run native unit tests using only the public static build resources when the full browser engine is absent:

```powershell
$env:TAURI_CONFIG = '{"bundle":{"resources":["../dist/","../browser-runtime/version.txt","../browser-runtime/LICENSE.fingerprint-chromium"]}}'
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol usage_tests
Remove-Item Env:TAURI_CONFIG
```

The quota and migration tests create fictional ledgers, identities and browser files in temporary directories. The Windows CLI tests use a temporary installer and executable fixtures. Do not run the real quota collector, migration command, local deployment or proxy configuration as CI checks.

The browser interaction scripts use `playwright-core` with the pinned engine and mock IPC. After explicitly fetching the engine, run their Node or Bun entry points to exercise the UI. `scripts/test-local-shell.mjs` accepts an optional output directory for fictional screenshots; keep generated images and reports outside Git. These tests do not replace an installed application smoke test.

For installer-hook changes, run `pwsh -NoProfile -File scripts/test-installer-upgrade.ps1` with an existing NSIS compiler (optional `-MakensisPath`). This compiles English, Simplified Chinese and Traditional Chinese with warnings as errors. Optional `-TauriScript '<selected-neutral-build>/target/release/nsis/x64/installer.nsi'` also compiles the actual generated Tauri/MUI template with synthetic payloads and checks its `/UPDATE` app-data guard. Both synthetic programs quit at initialization if accidentally opened. The check never executes an installer/uninstaller, writes registry entries or stops processes; real install/upgrade/uninstall verification remains restricted to disposable Windows environments.

For a change limited to the quick setup overview, run `node scripts/test-usage-statistics.mjs .local/preview/quick-setup --quick-only`. This reuses the shell harness with a direct quick-page cold start, independent slow/failing reads, manual recovery, effective browser targets and bilingual responsive previews. It uses fictional IPC and an isolated browser context. Database initialization regressions can be selected with the same public-resource `TAURI_CONFIG` above and the Rust filter `identities::database_tests`; they use temporary SQLite databases only.

For Usage analytics and Quick setup, run `bun test src`, the native tests filtered by `usage_tests`, and `node scripts/test-usage-statistics.mjs`. The harness uses the actual React shell with fictional IPC, blocked external requests and a controlled clock. It verifies hourly/future slots, 7/30-day and full-history spans, sequential polling/visibility/unmount behavior, partial status failures, all six quick destinations and bilingual narrow layouts. Previews default to ignored `.local/preview/ui-refinements`; pass a separate output directory for each delivery. Native tests use temporary homes and databases, never the real collector or an actual identity switch.

The refined Usage analytics/compact-sidebar/computer/CLI controls are covered by that same fake-IPC harness; current previews are under `.local/preview/ui-refinements`. CLI checks use the Rust `claude_cli` test filter. Windows update regression cases are the update-specific methods under `CliTests` in `scripts/test-windows.py`; select those synthetic fixtures directly, never the system-mutating `SystemTests` on a personal machine.

## GitHub Actions

`Windows source checks` runs on pull requests, `main` pushes, manual dispatch and calls from the share workflow. It builds the frontend and runs Rust/Python/CLI fixtures without downloading the engine. Test homes and temporary directories are under the hosted runner's temporary directory. No real Claude login, repository signing secret or release token is provided.

Windows Known Folder APIs can use the runner's actual account even when environment variables point to fixtures. Run this workflow only on a disposable GitHub-hosted runner. Under `GITHUB_ACTIONS=true`, the existing Windows native tests change and restore timezone, and the Windows Python test changes and restores regional settings. Do not set that flag on a personal workstation to force those tests.

`Build private Windows share artifact` is manual. It first reuses the source checks, then downloads the pinned engine and builds an unsigned NSIS installer. It only uploads an Actions artifact; see [Distribution](DISTRIBUTION.md) for its scope and licensing limits. It does not run the installer, alter a developer installation or configure an updater.

## Data and product boundaries

The local application data directory is `%APPDATA%/ai.local.claude-local`. Keep real Claude credentials, identity archives, vault keys, account ledgers, browser profiles, local proxy files, screenshots of real accounts and build output outside Git. The local product has no authority to use the upstream application's update channel or signing keys.

The application still manages the current user's default Claude workspace. Separate application data directories do not create a Windows user or process sandbox. Close another identity manager before switching the same Claude workspace.
