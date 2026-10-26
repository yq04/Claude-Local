# Contributing to Claude-Local

This is an independently maintained Windows project based on CCBaga secondary development. Preserve the original CCBaga attribution and every applicable third-party notice; independent maintenance is not a claim that all code is original. Changes are driven by local usability, correctness and safe data handling. Read AGENTS.md, NOTICE.md and docs/DEVELOPMENT.md before changing code.

Use synthetic fixtures, preserve existing on-disk formats, and include focused regression tests for correctness fixes. Keep all user data and machine-specific configuration out of commits. Do not add an upstream auto-sync, official update channel, unauthorized promotional links, automatic external navigation or release credentials. The project owner authorizes fixed referral links bundled with the software exclusively as copy-only actions; do not add recipient-facing link editors, per-install overrides or automatic external routing.

The repository separates automated source checks from manually published product releases. The optional Actions share-build workflow is currently private-repository-only; public maintainers can use the documented local build. Continuous integration executes validation and synthetic tests without automatic public releases. Public release workflows and broader redistribution remain separate deliberate decisions; third-party license boundaries (including vendor components documented in NOTICE.md and docs/DISTRIBUTION.md) must be resolved before public source or binary distribution.

## Reporting and proposing changes

Use the repository’s bug or feature forms under Issues. Describe the app version, Windows environment, reproducible steps and expected/actual behavior. Do not attach identity archives, credentials, OAuth/API secrets, cookies, proxy credentials, full local session URLs or unredacted account screenshots. A feature request is a discussion, not a delivery promise. Do not submit a public issue containing a live secret; revoke it through the issuing service if it has already been exposed.

For inherited behavior, include a source link or comparison and distinguish it from Claude-Local changes. For adopted code or assets, include their source and applicable license; do not infer that the top-level MIT covers every vendor component. Public release tags and installers remain immutable; use the [release policy](docs/RELEASE_POLICY.md) and [origin guide](docs/PROJECT_ORIGIN.md).
