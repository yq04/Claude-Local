// [INPUT]: Explicit local pairing ticket, bounded Claude account/org candidates, and projected metadata.
// [OUTPUT]: One nonce/tab-bound callback after fingerprint matching, or an allowlisted failure with no account payload.
// [POS]: Fixed MV3 bridge service worker; fingerprint stays in session storage and never reaches claude.ai.
"use strict";

const consumed = new Set();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FAILURES = new Set(["identity_unavailable", "identity_changed", "usage_unavailable",
  "web_auth_required", "web_access_denied", "request_timeout", "invalid_response"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.tab?.url) return;
  if (message?.kind === "claude-local-quota-pair") {
    void pair(message, sender).then(sendResponse, () => sendResponse({ paired: false }));
    return true;
  }
  if (message?.kind === "claude-local-quota-candidates") {
    void matchCandidates(message, sender).then(sendResponse, () => sendResponse({ matched: null }));
    return true;
  }
  if (message?.kind === "claude-local-quota-snapshot") {
    void deliver(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
});

async function pair(message, sender) {
  const tab = new URL(sender.tab.url);
  const nonce = message.nonce;
  const fragment = new URLSearchParams(tab.hash.slice(1));
  const quotaIdentity = message.quotaIdentity;
  if (tab.protocol !== "http:" || tab.hostname !== "127.0.0.1" ||
      !Number.isInteger(Number(tab.port)) || Number(tab.port) < 1 || Number(tab.port) > 65535 ||
      !/^\/[a-f0-9]{48}\/browser\.html$/.test(tab.pathname) ||
      fragment.get("quota-sync") !== nonce || fragment.get("quota_identity") !== quotaIdentity ||
      !/^[a-f0-9]{48}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(quotaIdentity) || consumed.has(nonce)) return { paired: false };
  const callbackUrl = new URL(tab.pathname.replace(/\/browser\.html$/, "/quota-sync"), tab.origin);
  const value = {
    callbackUrl: callbackUrl.href,
    tabId: sender.tab.id,
    expectedHash: quotaIdentity,
    expiresAt: Date.now() + 90_000
  };
  const existing = await chrome.storage.session.get(nonce);
  if (existing[nonce]) return { paired: false };
  await chrome.storage.session.set({ [nonce]: value });
  return { paired: true };
}

async function matchCandidates(message, sender) {
  const nonce = message.nonce;
  const tab = new URL(sender.tab.url);
  if (sender.id !== chrome.runtime.id || tab.origin !== "https://claude.ai" ||
      tab.pathname !== "/settings/usage" || !/^[a-f0-9]{48}$/.test(nonce)) return { matched: null };
  const stored = await chrome.storage.session.get(nonce);
  const paired = stored[nonce];
  if (!paired || paired.tabId !== sender.tab.id || paired.expiresAt <= Date.now() || paired.selected) return { matched: null };
  const accountUuids = [...new Set((Array.isArray(message.accountUuids) ? message.accountUuids : [])
    .filter((value) => typeof value === "string" && UUID.test(value)).slice(0, 8))];
  const emails = [...new Set((Array.isArray(message.emails) ? message.emails : [])
    .filter((value) => typeof value === "string" && value.trim() && value.length <= 320)
    .map((value) => value.trim().toLowerCase()).slice(0, 8))];
  const organizations = [...new Set((Array.isArray(message.organizationUuids) ? message.organizationUuids : [])
    .filter((value) => typeof value === "string" && UUID.test(value)).slice(0, 100))];
  const matches = new Map();
  for (const accountUuid of accountUuids) {
    for (const email of emails) {
      for (const organizationUuid of organizations) {
        const bytes = new TextEncoder().encode(JSON.stringify([accountUuid.trim(), email, organizationUuid.trim()]));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (hash === paired.expectedHash) {
          const pair = { account_uuid: accountUuid.trim(), organization_uuid: organizationUuid.trim() };
          matches.set(JSON.stringify(pair), pair);
        }
      }
    }
  }
  if (matches.size !== 1) return { matched: null };
  const [selected] = matches.values();
  await chrome.storage.session.set({ [nonce]: { ...paired, selected } });
  return { matched: selected };
}

async function deliver(message, sender) {
  const nonce = message.nonce;
  const tab = new URL(sender.tab.url);
  if (tab.origin !== "https://claude.ai" ||
      tab.pathname !== "/settings/usage" ||
      !/^[a-f0-9]{48}$/.test(nonce) || consumed.has(nonce)) return { ok: false };
  const stored = await chrome.storage.session.get(nonce);
  const paired = stored[nonce];
  if (!paired || paired.tabId !== sender.tab.id || paired.expiresAt <= Date.now()) return { ok: false };
  const callback = new URL(paired.callbackUrl);
  if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" ||
      !/^\/[a-f0-9]{48}\/quota-sync$/.test(callback.pathname) ||
      !Number.isInteger(Number(callback.port)) ||
      Number(callback.port) < 1 || Number(callback.port) > 65535) return { ok: false };
  consumed.add(nonce);
  await chrome.storage.session.remove(nonce);
  const snapshot = message.snapshot;
  if (!snapshot || snapshot.nonce !== nonce) return { ok: false };
  const failure = FAILURES.has(snapshot.failure);
  if (snapshot.failure !== undefined && !failure) return { ok: false };
  if (!failure && (!paired.selected || snapshot.account_uuid !== paired.selected.account_uuid ||
      snapshot.organization_uuid !== paired.selected.organization_uuid)) return { ok: false };
  const safeSnapshot = failure ? { nonce, failure: snapshot.failure } : projectSnapshot(snapshot, paired.selected);
  const response = await fetch(callback.href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(safeSnapshot),
    cache: "no-store",
    credentials: "omit",
    redirect: "error"
  });
  return { ok: response.ok };
}

function projectSnapshot(snapshot, selected) {
  const safe = {
    nonce: snapshot.nonce,
    account_uuid: selected.account_uuid,
    organization_uuid: selected.organization_uuid
  };
  const nextChargeDate = snapshot.subscription_details?.next_charge_date;
  if (typeof nextChargeDate === "string") safe.subscription_details = { next_charge_date: nextChargeDate };
  const cedar = snapshot.usage?.cedar_ember;
  if (cedar && typeof cedar === "object") {
    const projected = {};
    if (typeof cedar.eligible === "boolean") projected.eligible = cedar.eligible;
    if (Array.isArray(cedar.grants)) projected.grants = cedar.grants.slice(0, 101).map((grant) => ({
      resets_left: grant?.resets_left,
      starts_at: grant?.starts_at,
      ends_at: grant?.ends_at,
      paused: grant?.paused
    }));
    safe.usage = { cedar_ember: projected };
  }
  for (const name of ["five_hour", "seven_day"]) {
    const window = snapshot.usage?.[name];
    if (window && typeof window === "object" && !Array.isArray(window)) {
      safe.usage ??= {};
      safe.usage[name] = { utilization: window.utilization, resets_at: window.resets_at };
    }
  }
  return safe;
}
