# Claude-Local data and execution boundaries

The UI receives bounded identity display metadata, local quota summaries and operation results. Raw OAuth tokens, vault keys, cookies and proxy credentials are not serialized to the UI. Identity archives are authenticated encrypted containers; SQLite stores indexes and summaries, not credential bodies. Same-user and administrator access is not an absolute confidentiality boundary.

The default Claude workspace is managed through whitelisted files and selected JSON keys. Identity changes and destructive cleanup require the existing user confirmation, running-process checks, file snapshots and transaction/rollback logic. Personal source trees, unrelated applications and arbitrary paths are outside cleanup scope. A running identity recovery state blocks conflicting operations.

Browser data uses a separate per-identity profile under the application data root. A browser launch is an explicit action; ordinary application startup does not start it. Browser measurements use a bounded tokenized loopback session and report only the fields required for verification. Passing measurements do not establish anonymity, service acceptance, DNS or WebRTC privacy.

Manual network diagnostics contact four fixed Claude service domains without account authentication, redirects or arbitrary user-supplied targets. Companion verification may contact the documented public IP/location services when requested. The application has no upstream updater, commercial resource navigation, VPS deployment, affiliate links or external Skill installation workflow.

The passive Python quota collector reads Claude configuration and statusLine input. It writes only the independent external ledger and SQLite summaries, using a writer lock, atomic replacement and fresh-anchor checks. Rust consumes the ledger without replacing it with estimates. Offline inference is an estimate, not authoritative service entitlement.

Windows paths reject links/reparse points where identity operations require regular owned files. Private storage creation specifies the current user owner and restricted ACL. Migration preserves the source, checks that relevant source programs are closed, refuses database sidecars/recovery state, verifies every copied file and database integrity, and publishes only a complete private destination.

No credentials, identity data or local configuration belong in Git, CI or build artifacts. CI runs synthetic checks on ephemeral hosts. Installer jobs are manually dispatched, use no publishing/signing secrets and upload private artifacts only. Third-party distribution terms remain separate from application data security and are documented in NOTICE.md.
