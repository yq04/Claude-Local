# Quota connection capability decision

## Decision

Phase 5 does not add an independently issued OAuth credential, a new consent scope, a refresh-token store, or automatic authorization renewal. The available review evidence does not verify that Claude offers an officially supported quota-only authorization with separate revocation and renewal semantics. This implementation therefore keeps the existing OAuth collector as a best-effort read of the account’s archived CLI authorization and provides explicit browser sign-in as the recovery path.

The browser recovery action opens only the selected account’s existing, database-bound Claude-Local browser profile at the fixed `https://claude.ai/settings/usage` page. It does not switch the active CLI identity or browser slot, copy a profile, extract cookies, or return browser credentials to the app. Users may sign in in that browser profile and then retry the pending accounts together through the existing quota service.

## Evidence and limits

The local review’s [X-01 and X-02 evidence](2026-10-23-functional-review/03-EXTERNAL-EVIDENCE.md) cites public implementations that call OAuth profile/usage endpoints and describes why a static archived authorization cannot guarantee long-term access. Those references establish implementation precedent and limitations only. They are not provider documentation, do not verify a supported independent consent flow, and do not establish an official read-only scope, revocation endpoint, credential lifetime, or refresh policy.

The Phase 2/3 implementation preserves one frozen archived authorization for the account, classifies authorization cooldown separately from server rate limits, and revalidates identity and route before a write. It does not refresh a shared live CLI credential. Phase 4’s browser bridge can read validated usage from an explicitly paired managed browser; it does not expose the browser session to Rust or the UI.

No live account, network authorization, revocation, token refresh, or real browser profile was used to validate these claims. Provider behavior can change; browser session reuse lasts only as long as the provider continues to accept that existing session. No duration is promised.

## User flow

After a unified query, the identity page shows accounts that need sign-in or route repair. For an account needing sign-in, the user can explicitly open its bound browser profile. Route failures remain visible with the original route reason. One centralized action retries only the still-current pending subset, while successes and failures for other accounts remain in the in-memory process history across identity-page remounts. The target ID and 64-hex fingerprint are checked against the current inventory before opening or retrying.

The recovery queue is process-local; it contains only bounded result metadata and is not persisted across application restarts. Existing quota result privacy rules continue to exclude credentials, raw routes and browser session material.
