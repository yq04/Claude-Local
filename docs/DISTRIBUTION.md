<!--
[INPUT]: Owner-selected unsigned distribution, current-user NSIS hooks and audited build outputs.
[OUTPUT]: Private distribution, retained-data upgrade workflow and third-party license boundaries.
[POS]: Distribution policy; installer execution tests require disposable Windows environments.
[PROTOCOL]: Distinguish future source changes from immutable published release assets.
-->
# Private Windows distribution

Claude-Local currently targets private development and review. Its source repository and Actions artifacts are private. This status is an access boundary, and it does not establish permission to redistribute third-party code or artwork. No general permission to publish the complete application is asserted.

## Build a share artifact

For a local Windows share build, prepare the locked dependencies and pinned browser engine, then run `bun run build:windows`. This invokes `scripts/build-windows-share.ps1` and requires an existing 7-Zip `7z.exe` on PATH or in a standard Program Files installation. The script does not download or install this tool. A portable tool can be supplied explicitly:

```powershell
pwsh -NoProfile -File scripts/build-windows-share.ps1 -SevenZipPath '<path-to-7z.exe>'
```

Optionally add `-PrivateMarkersFile '<external-json-path>'`. This file must remain outside the repository and contains a JSON object mapping labels to private strings to check. It is never copied into the share artifact; reports omit the strings and absolute machine paths. Without supplied markers, filename and resource-boundary checks cannot establish the absence of every possible private string.

Native dependencies can embed C/C++ assertion paths that Rust path remapping cannot remove. Each build therefore uses a new neutral Cargo home and target under `<workspace-drive>:/ClaudeLocalBuild/<id>/`, outside the workspace and `USERPROFILE`. If creating a directory at that location is not permitted, supply `-BuildRoot '<new-neutral-directory>'`; it must not exist, must be outside both boundaries, and must contain no links or junctions. Only the original Cargo home's crates.io registry index and archive cache are copied, with links rejected. Root Cargo config, credentials, executables and `registry/src` are never copied. Cargo re-extracts verified crate archives into the neutral directory; the original cache and Rustup home remain intact.

The script preserves existing Rust flags and appends workspace/user-profile/neutral-root path remapping to generic `/build/claude-local`, `/build/user` and `/build/neutral` paths. It restores every process environment variable it changes, backs up previous fixed host/setup outputs, builds NSIS once with `custom-protocol`, and refreshes the conventional repository target outputs from the neutral target. It then uses 7z to extract the new installer into fresh ignored staging. It never executes the installer or uninstaller, and never reads or copies a live installation, personal application data, identity vault, account database, quota/usage ledger, log or browser profile into the package. Neutral build directories are retained; no original cache or user data is deleted.

The privacy audit verifies the fixed Tauri resource mappings and browser distribution allowlist, rejects runtime-data names and filesystem links, and compares the actual extracted payload against the expected relative paths and SHA-256 hashes. The allowed resources include the built frontend, pinned browser distribution, version metadata, icons and retained notices; the root `LICENSE` and `NOTICE.md` are included inside the installer under `licenses/`. Optional private markers are checked against the inspected file contents.

Only after the extracted-payload audit passes does the script create a unique ignored `.local/artifacts/<id>/` directory containing the setup executable, `SHA256SUMS.txt`, `privacy-audit.json` and `resource-manifest.json`. The script's final JSON gives the exact output paths. Share this selected output directory, not an old fixed build path, marker file, extraction tree, backup directory or manually assembled copy of an installed application. A documented workflow is not evidence that any particular final installer passed: inspect the reports associated with that build.

## Private Actions artifact

Run the `Build private Windows share artifact` workflow manually from the selected commit in the private repository. The packaging job refuses a public repository. After source checks pass, it builds one unsigned Windows x64 NSIS installer for the current user. The installer contains `claude-local.exe` and the companion browser, registered as `Claude-Local-Browser`, with the independent application identifier `ai.local.claude-local`.

Download the `Claude-Local-windows-x64-<run ID>` artifact from that workflow run. It includes the installer, SHA-256 checksums, a product/engine manifest, the root license and notices, and retained third-party license files. The artifact is retained for 14 days. Its workflow has read-only repository permissions and creates no GitHub Release, tag, automatic update manifest or signed update package. No upstream signing key is required or used.

The owner has chosen unsigned distribution. The local installer and Actions artifact remain unsigned; no certificate or signing-service dependency is added. Archive extraction/privacy checks do not test actual installation, upgrade or uninstall. Review the selected artifact's checksums and validate installation behavior in a disposable Windows account or machine. A build artifact is a review package, not a claim of production certification.

## Interactive upgrade and retained data

Future installer builds check the current user's registered Claude-Local installation before displaying the new welcome page. If an installation exists, the user first confirms removing the previous program. The prompt states that accounts, encrypted vaults, quota/usage history, browser profiles and settings are retained. The old uninstaller is awaited synchronously in its data-preserving update mode. The new installation wizard appears only after removal succeeds; cancellation, a launch error, a nonzero return code or a remaining old executable blocks installation.

This changes the installer sequence, not the location or ownership of application data. The upgrade does not clear `%APPDATA%/ai.local.claude-local`, the default Claude workspace or unrelated applications. Running Claude-Local and its companion browser must be closed by the user before removal; the upgrade must not terminate Claude Code sessions.

Detection uses the product's current-user install/uninstall registration. A manually copied portable folder has no standard uninstall record and is not discovered by scanning personal disks or guessing paths. Such a folder is not automatically removed. Installing the managed application retains the same independent app-data root; subsequent registered-install upgrades use the sequence above.

The change ships from the 0.1.3 installer onward. Published 0.1.2 release assets remain unchanged, and a file-based local replacement does not exercise this installer sequence. Real installation/uninstallation regression runs belong on a disposable Windows runner; local checks only compile synthetic NSIS fixtures and inspect the generated script.

## Browser engine provenance

`scripts/fetch-browser.py` fixes the Fingerprint Chromium release, Windows x64 download URL and expected archive SHA-256. It checks the archive digest, PE architecture and engine version before publishing the complete extracted engine folder. The package workflow fetches this source explicitly; source CI uses fake engine trees and makes no engine download.

Keep `browser-runtime/version.txt`, the fetch script's version/digest and the generated manifest consistent. Do not replace the fixed source with a moving `latest` URL. The browser engine, archives, user profiles and application data are excluded from the repository. The application's runtime profiles must never become build input.

## License and attribution status

`LICENSE` retains the CCBaga contributors' MIT notice for the original project work. It covers that work and eligible modifications, and does not replace licenses held by other copyright owners. Retain it with source copies and binary packages, together with `NOTICE.md`.

`vendor/cromma-ui` includes a copied UI library and Pika icon subset. Its current copied tree has no independent upstream license file or package license declaration. Its redistribution terms remain unverified. Keep the repository private while investigating provenance; obtain the applicable license/permission or replace those components before a public source or binary distribution. Private access alone does not resolve this licensing question.

The companion engine retains `browser-runtime/LICENSE.fingerprint-chromium` (BSD-3-Clause). Chromium and bundled dependencies have additional terms: preserve the engine's complete credits and attribution resources and verify their required distribution materials. The single BSD notice does not provide a complete browser license inventory. The workflow preserves the downloaded engine tree and includes the retained notice, but has not audited the full Chromium dependency inventory.

If their corresponding material is retained, also keep `assets/ai-icons/LICENSE.lobehub.txt`, `src-tauri/windows/LICENSE.unicode.txt`. Dependency versions are recorded in `bun.lock` and `src-tauri/Cargo.lock`; prepare an actual dependency license inventory before wider distribution. The current artifact's collected notices are not an exhaustive SBOM or legal clearance.

The current Windows CL monogram and desktop/browser marks were created for Claude-Local and replace the inherited product artwork. Third-party names and marks do not imply endorsement. `NOTICE.md` records additional upstream reference material whose terms must be checked if protected material was copied.

## What to share

Share only the selected artifact and relevant source commit with authorized reviewers. Never include `.env` files, signing keys, identity vaults, `key.bin`, encrypted identity archives, SQLite account databases, quota ledgers, browser profiles, personal proxy settings or real-account screenshots. Rebuild from the repository's locked source and pinned engine rather than copying a live installation directory.

Windows uses one current-user installer for both application entry points. Application data belongs under `%APPDATA%/ai.local.claude-local`; the default Claude workspace remains shared with other tools running as the same Windows user. Migration and identity switching require their own explicit user actions and are not part of the share workflow.

## Owner-requested manual GitHub releases

The owner may explicitly request a manual review release in the existing private repository. Keep its visibility unchanged, use a prerelease with the selected version and source commit, and attach only the freshly audited installer, checksums, relative-path audit reports and reviewed documentation. Do not include private workstation settings or account-attribution seeds. Preserve the license restrictions above; this manual path grants no public redistribution clearance and adds no automatic release workflow or updater feed.
