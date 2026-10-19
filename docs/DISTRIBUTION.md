# Private Windows distribution

Claude-Local currently targets private development and review. Its source repository and Actions artifacts are private. This status is an access boundary, and it does not establish permission to redistribute third-party code or artwork. No general permission to publish the complete application is asserted.

## Build a share artifact

Run the `Build private Windows share artifact` workflow manually from the selected commit in the private repository. The packaging job refuses a public repository. After source checks pass, it builds one unsigned Windows x64 NSIS installer for the current user. The installer contains `claude-local.exe` and the companion browser, registered as `Claude-Local-Browser`, with the independent application identifier `ai.local.claude-local`.

Download the `Claude-Local-windows-x64-<run ID>` artifact from that workflow run. It includes the installer, SHA-256 checksums, a product/engine manifest, the root license and notices, and retained third-party license files. The artifact is retained for 14 days. Its workflow has read-only repository permissions and creates no GitHub Release, tag, automatic update manifest or signed update package. No upstream signing key is required or used.

The installer is unsigned. It has not acquired Windows publisher trust, and the workflow does not claim to have tested an actual installation, upgrade or uninstall. Review its checksums and test it in a disposable Windows account or machine before using it with valuable data. A build artifact is a review package, not a claim of production certification.

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
