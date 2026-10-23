// [INPUT]: Explicit loopback fragment and same-origin Claude account/organization API responses.
// [OUTPUT]: Fingerprint candidates to the extension worker and allowlisted metadata for the local callback.
// [POS]: Fixed MV3 page bridge; account identity is selected by the local quota_identity fingerprint.
"use strict";
let quotaRequestDeadlineMs = 0;

(async () => {
  const url = new URL(location.href);
  if (url.protocol === "http:" && url.hostname === "127.0.0.1" &&
      Number(url.port) >= 1 && Number(url.port) <= 65535 && /\/[a-f0-9]{48}\/browser\.html$/.test(url.pathname)) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    const nonce = fragment.get("quota-sync") || "";
    const quotaIdentity = fragment.get("quota_identity") || "";
    if (!/^[a-f0-9]{48}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(quotaIdentity)) return;
    const response = await chrome.runtime.sendMessage({ kind: "claude-local-quota-pair", nonce, quotaIdentity });
    if (response?.paired) {
      location.assign(`https://claude.ai/settings/usage#claude-local-sync=${nonce}`);
    }
    return;
  }

  if (url.origin !== "https://claude.ai" || url.pathname !== "/settings/usage") return;
  const nonce = url.hash.startsWith("#claude-local-sync=") ? url.hash.slice(19) : "";
  if (!/^[a-f0-9]{48}$/.test(nonce)) return;
  if (sessionStorage.getItem(`claude-local-quota:${nonce}`)) return;
  sessionStorage.setItem(`claude-local-quota:${nonce}`, "started");
  history.replaceState(null, "", url.pathname + url.search);
  quotaRequestDeadlineMs = Date.now() + 20_000;
  try {
    const identity = await readIdentity();
    const { accountUuids, emails, organizationUuids } = identity;
    const match = await chrome.runtime.sendMessage({
      kind: "claude-local-quota-candidates", nonce, accountUuids, emails, organizationUuids
    });
    const accountUuid = match?.matched?.account_uuid;
    const organizationUuid = match?.matched?.organization_uuid;
    if (typeof accountUuid !== "string" || typeof organizationUuid !== "string") {
      return await sendFailure(nonce);
    }

    const encoded = encodeURIComponent(organizationUuid);
    const [subscriptionDetails, usage] = await Promise.all([
      getJsonOptional(`/api/organizations/${encoded}/subscription_details`),
      getJson(`/api/organizations/${encoded}/usage?at_wall=1&skip_spend=1`)
    ]);
    const identityAfter = await readIdentity();
    if (!sameIdentity(identity, identityAfter) ||
        !identityAfter.organizationUuids.includes(organizationUuid)) {
      return await sendFailure(nonce);
    }
    const cedar = usage?.cedar_ember;
    const grants = Array.isArray(cedar?.grants) ? cedar.grants.slice(0, 101).map((grant) => ({
      resets_left: grant?.resets_left,
      starts_at: grant?.starts_at,
      ends_at: grant?.ends_at,
      paused: grant?.paused
    })) : undefined;
    const snapshot = {
      nonce,
      account_uuid: accountUuid,
      organization_uuid: organizationUuid,
      subscription_details: subscriptionDetails?.next_charge_date
        ? { next_charge_date: subscriptionDetails.next_charge_date } : undefined,
      usage: usage ? { ...(cedar ? { cedar_ember: {
        ...(typeof cedar.eligible === "boolean" ? { eligible: cedar.eligible } : {}),
        ...(grants ? { grants } : {})
      } } : {}), ...projectWindows(usage) } : undefined
    };
    await chrome.runtime.sendMessage({
      kind: "claude-local-quota-snapshot",
      nonce,
      snapshot
    });
  } catch (_) {
    await sendFailure(nonce);
  }
})();

async function getJson(path) {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("Invalid fixed quota endpoint");
  }
  const controller = new AbortController();
  const remaining = Math.min(5000, quotaRequestDeadlineMs - Date.now());
  if (remaining <= 0) throw new Error("Quota request deadline exceeded");
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error("Claude endpoint unavailable");
    if (response.url && new URL(response.url).origin !== location.origin) throw new Error("Unexpected response origin");
    const contentType = response.headers?.get?.("content-type") || "application/json";
    if (!contentType.toLowerCase().includes("application/json")) throw new Error("Unexpected response type");
    const declaredLength = Number(response.headers?.get?.("content-length") || 0);
    if (declaredLength > 512 * 1024) throw new Error("Quota response too large");
    const text = typeof response.text === "function"
      ? await readTextLimited(response, 512 * 1024)
      : JSON.stringify(await response.json());
    if (text.length > 512 * 1024) throw new Error("Quota response too large");
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

async function readTextLimited(response, maximum) {
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Quota response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function readIdentity() {
  const account = await getJson("/api/account");
  const profile = await getJsonOptional("/api/account_profile");
  const organizationsResponse = await getJson("/api/organizations");
  const organizations = Array.isArray(organizationsResponse)
    ? organizationsResponse : organizationsResponse?.organizations;
  const accountObjects = [account, account?.account, profile, profile?.account]
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
  return {
    accountUuids: uniqueStrings(accountObjects.flatMap((item) =>
      [item.account_uuid, item.accountUuid, item.uuid, item.id]), 8),
    emails: uniqueStrings(accountObjects.flatMap((item) =>
      [item.email_address, item.emailAddress]), 8).map((value) => value.toLowerCase()),
    organizationUuids: uniqueStrings(Array.isArray(organizations)
      ? organizations.slice(0, 100).flatMap((item) => [item?.uuid, item?.id]) : [], 100)
  };
}

function sameIdentity(left, right) {
  const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  return same(left.accountUuids, right.accountUuids) && same(left.emails, right.emails);
}

function projectWindows(usage) {
  const result = {};
  for (const name of ["five_hour", "seven_day"]) {
    const window = usage?.[name];
    if (window && typeof window === "object" && !Array.isArray(window)) {
      result[name] = { utilization: window.utilization, resets_at: window.resets_at };
    }
  }
  return result;
}

async function getJsonOptional(path) {
  try { return await getJson(path); } catch (_) { return null; }
}

function uniqueStrings(values, limit) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))].slice(0, limit);
}

async function sendFailure(nonce) {
  await chrome.runtime.sendMessage({
    kind: "claude-local-quota-snapshot",
    nonce,
    snapshot: { nonce, failure: "identity_unavailable" }
  });
}
