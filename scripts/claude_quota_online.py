#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# [INPUT]: Minimal authenticated account/settings projection, explicit selector, profile/usage or bound browser snapshots with independent clocks.
# [OUTPUT]: Sanitized status JSON; opt-in nonce-bound two-phase commit grant; Python-owned atomic quota ledger and bounded manual-reset validity.
# [POS]: Network outside native identity door; grant before writer lock; never refreshes credentials or edits Claude configuration.
# [PROTOCOL]: Update scripts/CLAUDE.md when changing identity binding or persistence boundaries.
"""Fetch OAuth usage without refreshing or modifying local credentials."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import re
import secrets
import queue
import threading
import sqlite3
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid
from pathlib import Path

_QUOTA_PATH = Path(__file__).with_name("claude_quota.py")
_SPEC = importlib.util.spec_from_file_location("claude_quota_online_local", _QUOTA_PATH)
quota = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
try:
    from quota_archive import proxy_fields, read_online_identity
    _SPEC.loader.exec_module(quota)
except ImportError:
    # Optional packaging dependencies must fail closed through the status contract.
    quota = None

ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile"
MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages?beta=true"
TRACE_ENDPOINT = "https://www.cloudflare.com/cdn-cgi/trace"
BETA = "oauth-2025-04-20"
WAKEUP_BETA = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14"
WAKEUP_MODELS = ("claude-haiku-4-5-20251001", "claude-sonnet-4-6")
WAKEUP_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude."
_WAKEUP_PROMPTS = (
    ("quota", 1),
    ("Reply with one word: ready", 32),
    ("ping - respond with ok only", 16),
    ("status check, reply ok", 24),
    ("echo ack", 16),
    ("reply 1", 16),
)
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_CLI_VERSION = "2.1.304"
DEFAULT_ALLOWED_EXIT_COUNTRIES = ("US",)
_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:\.exe)?$", re.IGNORECASE)


def _cli_user_agent(claude_home: Path | None = None) -> str:
    """Align User-Agent with the locally installed official Claude Code CLI binary."""
    base = claude_home if isinstance(claude_home, Path) else Path.home()
    versions_dir = base / ".local" / "share" / "claude" / "versions"
    best_tuple: tuple[int, int, int] | None = None
    best_str = DEFAULT_CLI_VERSION
    try:
        if versions_dir.is_dir():
            for entry in versions_dir.iterdir():
                match = _VERSION_RE.fullmatch(entry.name)
                if match:
                    ver_tuple = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
                    if best_tuple is None or ver_tuple > best_tuple:
                        best_tuple = ver_tuple
                        best_str = f"{ver_tuple[0]}.{ver_tuple[1]}.{ver_tuple[2]}"
    except OSError:
        pass
    return f"claude-cli/{best_str} (external, cli)"


USER_AGENT = _cli_user_agent()
TIMEOUT_SECONDS = 9
MAX_RESPONSE_BYTES = 128 * 1024
MAX_LOCAL_JSON_BYTES = 2 * 1024 * 1024
SUCCESS_COOLDOWN_MS = 60_000
ERROR_COOLDOWN_MS = 180_000
LEASE_MS = 180_000
MIN_ERROR_BACKOFF_MS = 30_000
MAX_ERROR_BACKOFF_MS = 30 * 60_000
ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
IDENTITY_RE = re.compile(r"^[0-9a-f]{64}$")
WINDOWS = {"five_hour": "5h", "seven_day": "7d"}


class IdentityMismatch(LookupError):
    """The resolved local account does not match the caller's frozen identity."""


class RouteUnavailable(ValueError):
    """An explicitly configured route cannot be used safely by this transport."""


def _route(cj):
    fields = cj.get("_online_route", {})
    if not isinstance(fields, dict):
        raise RouteUnavailable()
    # Resolve the effective HTTPS route, including settings.local overrides.
    # A configured unsupported value fails closed; never retry direct.
    unset = object()
    value = next((fields[key] for key in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy",
                                          "HTTP_PROXY", "http_proxy")
                  if key in fields and fields[key] != ""), unset)
    if value is unset:
        # Freeze the actual host/system route, including no_proxy, once per run.
        proxies = urllib.request.getproxies()
        if urllib.request.proxy_bypass("api.anthropic.com"):
            proxies = {}
        if proxies.get("https"):
            _supported_proxy(proxies["https"] if "://" in proxies["https"] else "http://" + proxies["https"])
        return "host_system", tuple(sorted(proxies.items()))
    _supported_proxy(value)
    return "account_proxy", (("https", value),)


def _supported_proxy(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) <= 32 for c in value):
        raise RouteUnavailable()
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
        # urllib performs plaintext CONNECT even for a literal https:// proxy.
        # Fail closed until a verified TLS-to-proxy transport is available.
        if (parsed.scheme != "http" or not parsed.hostname or port == 0
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise RouteUnavailable()
    except (ValueError, UnicodeError) as exc:
        raise RouteUnavailable() from exc


def _result(status: str, **extra) -> dict:
    return {"status": status, **{k: v for k, v in extra.items() if v is not None}}


def _atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not _safe_parent_chain(path):
        raise OSError("unsafe local data directory")
    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=".quota-online-", suffix=".tmp", delete=False) as f:
            tmp = Path(f.name)
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        tmp = None
    finally:
        if tmp and tmp.exists():
            tmp.unlink()


def _state_path(app_data: Path) -> Path:
    return app_data / "identity-vault" / "quota_online_state.json"


def _load_state(path: Path) -> dict:
    if not _safe_parent_chain(path):
        raise OSError("unsafe quota state directory")
    try:
        path.lstat()
    except FileNotFoundError:
        return {"version": 1, "accounts": {}}
    if not _safe_regular_file(path):
        raise OSError("unsafe quota state file")
    try:
        obj = json.loads(_bounded_read(path).decode("utf-8"))
        if isinstance(obj, dict) and obj.get("version") == 1 and isinstance(obj.get("accounts"), dict):
            return obj
    except (OSError, ValueError):
        pass
    return {"version": 1, "accounts": {}}


def _safe_parent_chain(path: Path) -> bool:
    for parent in path.parents:
        try:
            parent_info = parent.lstat()
        except OSError:
            return False
        if not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode):
            return False
        parent_attrs = getattr(parent_info, "st_file_attributes", 0)
        if parent_attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
            return False
    return True


def _safe_regular_file(path: Path) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return False
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        return False
    attrs = getattr(info, "st_file_attributes", 0)
    if attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
        return False
    return _safe_parent_chain(path)


def _bounded_read(path: Path, limit: int = MAX_LOCAL_JSON_BYTES) -> bytes:
    if not _safe_regular_file(path):
        raise OSError("unsafe or missing local file")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise OSError("local file exceeds size limit")
    return data


def _state_update(app_data: Path, identity: str, mutate):
    path = _state_path(app_data)
    if not app_data.is_dir():
        raise FileNotFoundError("application data directory is unavailable")
    with quota.ledger_writer_lock(str(app_data)):
        state = _load_state(path)
        entry = state["accounts"].get(identity)
        if not isinstance(entry, dict):
            entry = {}
        result = mutate(entry)
        if result is not None:
            state["accounts"][identity] = entry
            _atomic_json(path, state)
        return result


def _load_json(path: Path) -> dict:
    try:
        obj = json.loads(_bounded_read(path).decode("utf-8"))
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def _account_identity(cj: dict, cred: dict) -> tuple[dict, dict, str]:
    acc = cj.get("oauthAccount")
    oauth = cred.get("claudeAiOauth")
    if not isinstance(acc, dict) or not isinstance(oauth, dict):
        raise PermissionError("account credentials unavailable")
    identity = quota.quota_identity(acc)
    if not identity or not isinstance(acc.get("accountUuid"), str) or not acc["accountUuid"].strip():
        raise ValueError("account identity unavailable")
    return acc, oauth, identity


def _read_live(claude_home: Path):
    cj = _load_json(claude_home / ".claude.json")
    cj = {key: cj[key] for key in ("oauthAccount", "cachedUsageUtilization", "userID") if key in cj}
    cred = _load_json(claude_home / ".claude" / ".credentials.json")
    acc, oauth, identity = _account_identity(cj, cred)
    cj["_online_route"] = proxy_fields(_load_settings(claude_home / ".claude" / "settings.json"))
    cj["_online_route"].update(proxy_fields(_load_settings(claude_home / ".claude" / "settings.local.json")))
    return cj, cred, acc, oauth, identity


def _load_settings(path):
    # Missing settings means no account route; malformed/unreadable explicit
    # settings must never silently become a direct request.
    try:
        path.lstat()
    except FileNotFoundError:
        return {}
    try:
        settings = json.loads(_bounded_read(path).decode("utf-8"))
        if not isinstance(settings, dict):
            raise ValueError()
        return settings
    except (OSError, ValueError) as exc:
        raise RouteUnavailable() from exc


def _saved_account(app_data: Path, account_id: str):
    vault = app_data / "identity-vault"
    db_path, key_path = vault / "identities.sqlite", vault / "key.bin"
    if not _safe_regular_file(db_path) or not _safe_regular_file(key_path):
        raise LookupError("saved account unavailable")
    conn = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT archive FROM identities WHERE id=? AND empty=0", (account_id,)).fetchone()
        summary_row = conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (account_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise LookupError("saved account unavailable")
    archive = row[0]
    if not isinstance(archive, str) or not re.fullmatch(r"[0-9a-f]{32}\.baga", archive):
        raise ValueError("unsafe archive selector")
    archive_path = vault / archive
    if not _safe_regular_file(archive_path):
        raise LookupError("saved account unavailable")
    master_key = _bounded_read(key_path, 64)
    cj, cred, route = read_online_identity(vault, archive, master_key)
    cj["_online_route"] = route
    acc, oauth, identity = _account_identity(cj, cred)
    if summary_row and summary_row[0]:
        try:
            summary = json.loads(summary_row[0])
        except ValueError:
            summary = {}
        saved_identity = summary.get("quota_identity") if isinstance(summary, dict) else None
        if saved_identity and saved_identity != identity:
            raise ValueError("saved account identity mismatch")
        saved_uuid = summary.get("account_uuid") if isinstance(summary, dict) else None
        if saved_uuid and saved_uuid != acc.get("accountUuid"):
            raise ValueError("saved account identity mismatch")
    return cj, cred, acc, oauth, identity


def resolve_account(app_data: Path, claude_home: Path, account_id: str):
    if account_id == "current":
        return _read_live(claude_home)
    if not ACCOUNT_ID_RE.fullmatch(account_id):
        raise LookupError("saved account unavailable")
    archived = _saved_account(app_data, account_id)
    try:
        live = _read_live(claude_home)
    except (OSError, ValueError, PermissionError):
        return archived
    # Reuse a live token only when the account UUID, organization and full quota identity match.
    if live[4] == archived[4] and live[2].get("accountUuid") == archived[2].get("accountUuid"):
        live_exp = _expiry_ms(live[3].get("expiresAt")) or 0
        saved_exp = _expiry_ms(archived[3].get("expiresAt")) or 0
        if live_exp > saved_exp:
            # Token freshness does not change a saved account's route selection.
            cj = dict(live[0])
            cj["_online_route"] = archived[0].get("_online_route", {})
            return cj, *live[1:]
    return archived


def _resolve_expected(app_data: Path, claude_home: Path, account_id: str,
                      expected_identity: str | None):
    resolved = resolve_account(app_data, claude_home, account_id)
    if expected_identity is not None:
        if not IDENTITY_RE.fullmatch(expected_identity) or resolved[4] != expected_identity:
            raise IdentityMismatch("account identity mismatch")
    return resolved


def _expiry_ms(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        return None
    return int(value)


def _valid_access_token(oauth: dict, now_ms: int) -> str | None:
    token = oauth.get("accessToken")
    # expiresAt is local metadata and can lag the server's actual token state.
    # Probe the identity-bound profile with any present token; only its HTTP
    # response decides whether authorization is still usable.
    return token if isinstance(token, str) and token.strip() else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _FrozenProxy(urllib.request.ProxyHandler):
    """Use the frozen HTTPS proxy without urllib's implicit host bypass lookup."""
    def __init__(self, proxies, *, account_route):
        super().__init__({"https": proxies["https"]} if proxies.get("https") else {})
        self.account_route = account_route

    def proxy_open(self, req, proxy, protocol):
        value = proxy if "://" in proxy else "http://" + proxy
        _supported_proxy(value)
        parsed = urllib.parse.urlsplit(value)
        hostname = parsed.hostname
        if ":" in hostname:
            hostname = "[" + hostname + "]"
        if parsed.port:
            hostname += ":" + str(parsed.port)
        req.set_proxy(hostname, parsed.scheme)
        return None


def _parse_trace_country(raw: bytes | str) -> str | None:
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
    for line in text.splitlines():
        if line.startswith("loc="):
            code = line[4:].strip().upper()
            if re.fullmatch(r"[A-Z]{2}", code):
                return code
    return None


def _verify_exit_country(route, allowed_countries=DEFAULT_ALLOWED_EXIT_COUNTRIES) -> tuple[bool, str | None]:
    """Verify the frozen route's exit country via Cloudflare trace before sending OAuth tokens."""
    if route is None:
        raise RouteUnavailable()
    request = urllib.request.Request(TRACE_ENDPOINT, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/plain",
    }, method="GET")
    proxies = dict(route[1])
    handler = _FrozenProxy(proxies, account_route=route[0] == "account_proxy")
    opener = urllib.request.build_opener(handler, _NoRedirect())
    try:
        with opener.open(request, timeout=4) as response:
            if response.status != 200:
                return False, None
            raw = response.read(4096)
    except (TimeoutError, OSError, urllib.error.URLError, RouteUnavailable):
        return False, None
    country = _parse_trace_country(raw)
    if not country:
        return False, None
    allowed = {c.strip().upper() for c in allowed_countries if isinstance(c, str) and c.strip()}
    return (country in allowed), country


def _device_id(cj: dict, identity: str) -> str:
    """Resolve the account's 64-hex .claude.json userID or derive a deterministic per-account device_id."""
    raw = cj.get("userID") if isinstance(cj, dict) else None
    if isinstance(raw, str):
        cleaned = raw.strip().lower()
        if IDENTITY_RE.fullmatch(cleaned):
            return cleaned
    return hashlib.sha256(("claude-local-device-id:" + identity).encode("utf-8")).hexdigest()


def _wakeup_prompt_and_tokens() -> tuple[str, int]:
    return secrets.choice(_WAKEUP_PROMPTS)


def _build_wakeup_headers(token: str, session_id: str, request_id: str) -> dict[str, str]:
    """Align wakeup request headers with official claude.exe 2.1.x (@anthropic-ai/sdk 0.128.0)."""
    return {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": WAKEUP_BETA,
        "anthropic-version": ANTHROPIC_VERSION,
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-app": "cli",
        "X-Claude-Code-Session-Id": session_id,
        "x-client-request-id": request_id,
        "X-Stainless-Lang": "js",
        "X-Stainless-Package-Version": "0.128.0",
        "X-Stainless-OS": "Windows",
        "X-Stainless-Arch": "x64",
        "X-Stainless-Runtime": "node",
        "X-Stainless-Runtime-Version": "v24.3.0",
        "X-Stainless-Retry-Count": "0",
        "X-Stainless-Timeout": "600",
    }


def _post_wakeup(token: str, model: str, device_id: str, account_uuid: str, route=None):
    """Send a lightweight CLI-aligned /v1/messages request to start the next 5h rolling window."""
    if route is None:
        raise RouteUnavailable()
    session_id = str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    prompt_text, max_tok = _wakeup_prompt_and_tokens()
    metadata_user_id = json.dumps({
        "device_id": device_id,
        "account_uuid": account_uuid,
        "session_id": session_id,
    }, separators=(",", ":"))
    body = json.dumps({
        "model": model,
        "max_tokens": max_tok,
        "system": [{"type": "text", "text": WAKEUP_SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": prompt_text}],
        "metadata": {"user_id": metadata_user_id},
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        MESSAGES_ENDPOINT,
        data=body,
        headers=_build_wakeup_headers(token, session_id, request_id),
        method="POST",
    )
    proxies = dict(route[1])
    handler = _FrozenProxy(proxies, account_route=route[0] == "account_proxy")
    opener = urllib.request.build_opener(handler, _NoRedirect())
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                return "invalid_response", None, None
            return response.status, raw, response.headers
    except urllib.error.HTTPError as exc:
        return exc.code, None, exc.headers
    except (TimeoutError, OSError, urllib.error.URLError, RouteUnavailable):
        return "network_error", None, None


def parse_ratelimit_headers(headers, account_uuid: str, observed_ms: int):
    """Extract 5h/7d window utilization and reset timestamps directly from /v1/messages response headers."""
    if not headers:
        raise ValueError("missing ratelimit headers")
    lower_map = {str(k).lower(): v for k, v in (headers.items() if hasattr(headers, "items") else ())}
    utilization = {}
    updated = []
    for window, suffix in WINDOWS.items():
        raw_util = lower_map.get(f"anthropic-ratelimit-unified-{suffix}-utilization")
        raw_reset = lower_map.get(f"anthropic-ratelimit-unified-{suffix}-reset")
        if raw_util is None or raw_reset is None:
            continue
        try:
            val = float(raw_util)
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(val) or val < 0:
            continue
        # Unified ratelimit headers report ratio in [0.0, 1.0]; convert to percentage [0.0, 100.0].
        pct = round(val * 100.0, 4) if val <= 1.0 else val
        if pct > 100.0:
            continue
        reset = _reset_seconds(raw_reset)
        if reset is None and isinstance(raw_reset, str) and raw_reset.strip().isdigit():
            reset = _reset_seconds(int(raw_reset.strip()))
        if reset is None or reset <= observed_ms // 1000:
            continue
        utilization[window] = {
            "utilization": float(pct),
            "resets_at": dt.datetime.fromtimestamp(reset, dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "fetchedAtMs": observed_ms,
        }
        updated.append(suffix)
    if not updated:
        raise ValueError("no valid ratelimit headers")
    return {
        "accountUuid": account_uuid,
        "fetchedAtMs": observed_ms,
        "utilization": utilization,
        "server_anchor_observed_windows": list(utilization),
    }, updated


def _fetch(token: str, endpoint: str = ENDPOINT, route=None):
    if endpoint not in (ENDPOINT, PROFILE_ENDPOINT):
        return "unavailable", None, None
    request = urllib.request.Request(endpoint, headers={
        "Authorization": f"Bearer {token}",
        "anthropic-beta": BETA,
        "anthropic-version": ANTHROPIC_VERSION,
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "x-app": "cli",
    }, method="GET")
    # Explicit ProxyHandler suppresses environment re-resolution between profile
    # and usage. Account routes also suppress host NO_PROXY bypass rules.
    if route is None:
        raise RouteUnavailable()
    proxies = dict(route[1])
    handler = _FrozenProxy(proxies, account_route=route[0] == "account_proxy")
    opener = urllib.request.build_opener(handler, _NoRedirect())
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                return "invalid_response", None, None
            return response.status, raw, response.headers
    except urllib.error.HTTPError as exc:
        # Do not read or expose an error body; only the status and Retry-After are relevant.
        return exc.code, None, exc.headers
    except (TimeoutError, OSError, urllib.error.URLError, RouteUnavailable):
        return "network_error", None, None


def _reset_seconds(raw):
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        if math.isfinite(raw) and 0 < raw <= 253402300799:
            return int(raw)
        return None
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        seconds = parsed.timestamp()
        return int(seconds) if math.isfinite(seconds) and 0 < seconds <= 253402300799 else None
    except (ValueError, OverflowError, OSError):
        return None


def validate_profile(payload: dict, local_account: dict) -> None:
    """Require all three server identity fields; never infer token ownership."""
    if not isinstance(payload, dict):
        raise ValueError("invalid profile")
    profile_account = payload.get("account")
    organization = payload.get("organization")
    if not isinstance(profile_account, dict) or not isinstance(organization, dict):
        raise ValueError("profile identity unavailable")
    account_uuid = profile_account.get("uuid")
    organization_uuid = organization.get("uuid")
    email = profile_account.get("email")
    local_email = local_account.get("emailAddress")
    local_org = local_account.get("organizationUuid")
    local_uuid = local_account.get("accountUuid")
    if not all(isinstance(value, str) and value.strip() for value in
               (account_uuid, organization_uuid, email, local_uuid, local_org, local_email)):
        raise ValueError("profile identity unavailable")
    if (account_uuid != local_uuid or organization_uuid != local_org
            or email.strip().casefold() != local_email.strip().casefold()):
        raise LookupError("profile identity mismatch")


def validate_usage(payload: dict, account_uuid: str, observed_ms: int):
    if not isinstance(payload, dict):
        raise ValueError("invalid payload")
    for key in ("account_uuid", "accountUuid"):
        response_uuid = payload.get(key)
        if response_uuid is not None and response_uuid != account_uuid:
            raise LookupError("account mismatch")
    utilization = {}
    updated = []
    for window, suffix in WINDOWS.items():
        raw = payload.get(window)
        if raw is None:
            continue
        if not isinstance(raw, dict):
            continue
        value = raw.get("utilization")
        reset = _reset_seconds(raw.get("resets_at"))
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or not 0 <= value <= 100 or reset is None or reset <= observed_ms // 1000):
            continue
        utilization[window] = {"utilization": float(value), "resets_at": dt.datetime.fromtimestamp(reset, dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                               "fetchedAtMs": observed_ms}
        updated.append(suffix)
    if not updated:
        raise ValueError("no valid quota windows")
    return {"accountUuid": account_uuid, "fetchedAtMs": observed_ms,
            "utilization": utilization, "server_anchor_observed_windows": list(utilization)}, updated


def _retry_after_ms(headers, now_ms):
    raw = headers.get("Retry-After") if headers else None
    if raw:
        try:
            seconds = float(raw)
            if math.isfinite(seconds) and seconds >= 0:
                return now_ms + int(seconds * 1000)
        except ValueError:
            try:
                when = dt.datetime.strptime(raw, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=dt.timezone.utc)
                return max(now_ms, int(when.timestamp() * 1000))
            except ValueError:
                pass
    return now_ms + ERROR_COOLDOWN_MS


def _claim(app_data: Path, identity: str, now_ms: int):
    lease = secrets.token_hex(16)

    def mutate(entry):
        retry = int(entry.get("retry_at_ms") or 0)
        lease_until = int(entry.get("lease_until_ms") or 0)
        source = entry.get("last_source") if entry.get("last_source") in ("oauth", "browser") else None
        if retry > now_ms:
            rate_retry = int(entry.get("rate_limit_retry_at_ms") or 0)
            auth_only = entry.get("last_status") == "auth_required" and rate_retry <= now_ms
            return _result("cooldown", retry_at_ms=retry,
                           last_observed_at_ms=entry.get("last_observed_at_ms"), source=source,
                           retry_scope="oauth" if auth_only else "all",
                           reason="auth_required" if auth_only else "rate_limited" if rate_retry > now_ms else None,
                           verified_at_ms=entry.get("verified_at_ms"))
        if lease_until > now_ms:
            return _result("cooldown", retry_at_ms=lease_until,
                           last_observed_at_ms=entry.get("last_observed_at_ms"), source=source)
        entry.update({"lease": lease, "lease_until_ms": now_ms + LEASE_MS})
        return lease

    return _state_update(app_data, identity, mutate)


def _complete_entry(entry: dict, lease: str, now_ms: int, status: str, retry_at_ms=None):
    if entry.get("lease") != lease or int(entry.get("lease_until_ms") or 0) <= now_ms:
        return None
    count = int(entry.get("error_count") or 0) + 1 if status != "updated" else 0
    if status == "updated":
        retry = now_ms + SUCCESS_COOLDOWN_MS
        entry["last_observed_at_ms"] = now_ms
        entry["last_source"] = "oauth"
        entry["verified_at_ms"] = now_ms
        entry.pop("rate_limit_retry_at_ms", None)
    elif status == "rate_limited":
        retry = max(retry_at_ms or now_ms, now_ms + ERROR_COOLDOWN_MS)
        entry["rate_limit_retry_at_ms"] = retry
    elif status == "auth_required":
        retry = now_ms + 5 * 60_000
        entry.pop("verified_at_ms", None)
    elif status in ("network_error", "unavailable", "invalid_response", "account_mismatch", "route_unavailable"):
        retry = now_ms + min(MAX_ERROR_BACKOFF_MS, max(ERROR_COOLDOWN_MS, MIN_ERROR_BACKOFF_MS)
                             * (2 ** min(count - 1, 6)))
    else:
        retry = 0
    entry.pop("lease", None)
    entry.pop("lease_until_ms", None)
    entry["retry_at_ms"] = retry
    entry["last_status"] = status
    entry["error_count"] = count
    return retry


def _finish_state(app_data: Path, identity: str, lease: str, now_ms: int, status: str, retry_at_ms=None):
    path = _state_path(app_data)
    with quota.ledger_writer_lock(str(app_data)):
        state = _load_state(path)
        entry = state["accounts"].get(identity)
        if not isinstance(entry, dict):
            return None
        retry = _complete_entry(entry, lease, now_ms, status, retry_at_ms)
        if retry is None:
            return None
        state["accounts"][identity] = entry
        _atomic_json(path, state)
        return retry, entry.get("last_observed_at_ms")


def _ledger_item(cj, cred, anchor):
    now = dt.datetime.now(dt.timezone.utc)
    cj = dict(cj)
    cj["cachedUsageUtilization"] = anchor
    info = quota.format_account(cj, cred, [], None, now)
    info.update({"role": "current", "name": info.get("display"), "server_anchor": anchor,
                 "server_anchor_observed_windows": list(anchor["utilization"]),
                 "server_anchor_base_fetched_at_ms": 0})
    return info, now


def _commit_success(app_data: Path, claude_home: Path, account_id: str,
                    expected_identity: str | None, initial_token: str,
                    identity: str, lease: str, now_ms: int,
                    cj: dict, cred: dict, anchor: dict, initial_route=None) -> tuple[str, int | None]:
    """Verify lease, write ledger and finish cooldown under one Python writer lock."""
    path = _state_path(app_data)
    with quota.ledger_writer_lock(str(app_data)):
        state = _load_state(path)
        entry = state["accounts"].get(identity)
        if (not isinstance(entry, dict) or entry.get("lease") != lease
                or int(entry.get("lease_until_ms") or 0) <= int(time.time() * 1000)):
            return "cooldown", None
        try:
            current_cj, current_cred, _, current_oauth, current_identity = _resolve_expected(
                app_data, claude_home, account_id, expected_identity)
            if initial_route is not None and _route(current_cj) != initial_route:
                raise RouteUnavailable()
        except RouteUnavailable:
            retry = _complete_entry(entry, lease, now_ms, "route_unavailable")
            state["accounts"][identity] = entry
            _atomic_json(path, state)
            return "route_unavailable", retry
        except IdentityMismatch:
            retry = _complete_entry(entry, lease, now_ms, "account_mismatch")
            state["accounts"][identity] = entry
            _atomic_json(path, state)
            return "account_mismatch", retry
        except LookupError:
            retry = _complete_entry(entry, lease, now_ms, "unavailable")
            state["accounts"][identity] = entry
            _atomic_json(path, state)
            return "unavailable", retry
        except (OSError, ValueError, PermissionError, sqlite3.Error, RuntimeError):
            retry = _complete_entry(entry, lease, now_ms, "unavailable")
            state["accounts"][identity] = entry
            _atomic_json(path, state)
            return "unavailable", retry
        current_token = current_oauth.get("accessToken")
        if current_identity != identity or current_token != initial_token:
            retry = _complete_entry(entry, lease, now_ms, "account_mismatch")
            state["accounts"][identity] = entry
            _atomic_json(path, state)
            return "account_mismatch", retry
        if int(entry.get("lease_until_ms") or 0) <= int(time.time() * 1000):
            return "cooldown", None
        info, now_utc = _ledger_item(cj, cred, anchor)
        quota._save_ledger_and_sync_sqlite(str(app_data), str(app_data / "identity-vault"), [info], now_utc)
        retry = _complete_entry(entry, lease, now_ms, "updated")
        if retry is None:
            return "cooldown", None
        state["accounts"][identity] = entry
        _atomic_json(path, state)
        return "updated", retry


def import_browser_snapshot(app_data: Path, claude_home: Path, account_id: str, snapshot: dict,
                            expected_identity: str | None = None, commit_guard=None) -> dict:
    """Import bounded, identity-bound metadata and optional live quota windows."""
    if quota is None:
        return _result("unavailable", metadata_updated=False)
    base_fields = {"account_uuid", "organization_uuid", "billing_date_kind", "billing_date",
                   "manual_resets_remaining", "manual_resets_valid_until", "metadata_observed_at_ms"}
    try:
        if (not isinstance(snapshot, dict) or not base_fields.issubset(snapshot)
                or set(snapshot) - base_fields - {"usage"}):
            return _result("invalid_response", metadata_updated=False)
        _, _, account, _, identity = _resolve_expected(app_data, claude_home, account_id, expected_identity)
    except IdentityMismatch:
        return _result("account_mismatch", metadata_updated=False)
    except LookupError:
        return _result("unavailable", metadata_updated=False)
    except (OSError, ValueError, PermissionError, sqlite3.Error, RuntimeError):
        return _result("unavailable", metadata_updated=False)
    if snapshot.get("account_uuid") != account.get("accountUuid"):
        return _result("account_mismatch", metadata_updated=False)
    org_uuid = account.get("organizationUuid")
    if snapshot.get("organization_uuid") != org_uuid:
        return _result("account_mismatch", metadata_updated=False)
    kind = snapshot.get("billing_date_kind")
    if kind not in ("next_renewal", "access_until", "unknown"):
        return _result("invalid_response", metadata_updated=False)
    billing_date = snapshot.get("billing_date")
    if billing_date is not None and (type(billing_date) is not int or not 0 <= billing_date <= 253402300799):
        return _result("invalid_response", metadata_updated=False)
    if kind == "unknown" and billing_date is not None:
        return _result("invalid_response", metadata_updated=False)
    resets = snapshot.get("manual_resets_remaining")
    if resets is not None and (type(resets) is not int or not 0 <= resets <= 0xFFFFFFFF):
        return _result("invalid_response", metadata_updated=False)
    resets_valid_until = snapshot.get("manual_resets_valid_until")
    resets_valid = resets is None and resets_valid_until is None
    if resets is not None and type(resets_valid_until) is int:
        observed_s = snapshot.get("metadata_observed_at_ms")
        resets_valid = (type(observed_s) is int and resets_valid_until > observed_s // 1000
                        and resets_valid_until <= observed_s // 1000 + 24 * 60 * 60)
    observed = snapshot.get("metadata_observed_at_ms")
    now_ms = int(time.time() * 1000)
    if type(observed) is not int or not 0 < observed <= now_ms + 300_000:
        return _result("invalid_response", metadata_updated=False)

    usage_anchor = None
    usage_windows = []
    usage = snapshot.get("usage")
    if usage is not None:
        if (not isinstance(usage, dict) or not usage or len(usage) > len(WINDOWS)
                or set(usage) - set(WINDOWS)):
            return _result("invalid_response", metadata_updated=False)
        # Keep the browser bridge schema explicit and small. Invalid individual
        # windows are skipped by validate_usage; a valid sibling remains usable.
        for raw_window in usage.values():
            if (not isinstance(raw_window, dict)
                    or set(raw_window) != {"utilization", "resets_at"}
                    or isinstance(raw_window.get("resets_at"), str)
                    and len(raw_window["resets_at"]) > 64):
                return _result("invalid_response", metadata_updated=False)
        try:
            # Bind observation time to host receipt, never to a caller/cache clock.
            usage_anchor, usage_windows = validate_usage(usage, account["accountUuid"], now_ms)
        except LookupError:
            return _result("account_mismatch", metadata_updated=False)
        except (ValueError, TypeError, OverflowError):
            # Keep metadata independent: invalid/expired quota windows do not
            # clear existing quota evidence or invalidate valid metadata fields.
            usage_anchor, usage_windows = None, []

    path = app_data / "identity-vault" / "quota_web_metadata.json"
    outcome = {"updated": False, "metadata_updated": False, "observed_at_ms": None}
    try:
        # Never wait for the native identity door while holding the ledger lock.
        if commit_guard is not None and not commit_guard():
            return _result("cancelled")
        with quota.ledger_writer_lock(str(app_data)):
            try:
                current_cj, current_cred, current_account, _, current_identity = _resolve_expected(
                    app_data, claude_home, account_id, expected_identity)
            except LookupError:
                return _result("account_mismatch", metadata_updated=False)
            except (OSError, ValueError, PermissionError, sqlite3.Error, RuntimeError):
                return _result("unavailable", metadata_updated=False)
            if (current_identity != identity
                    or current_account.get("accountUuid") != snapshot.get("account_uuid")
                    or current_account.get("organizationUuid") != snapshot.get("organization_uuid")):
                return _result("account_mismatch", metadata_updated=False)

            if usage_anchor is not None:
                info, now_utc = _ledger_item(current_cj, current_cred, usage_anchor)
                quota._save_ledger_and_sync_sqlite(
                    str(app_data), str(app_data / "identity-vault"), [info], now_utc)
                outcome["updated"] = True

                # A browser usage GET is a successful account observation for
                # the shared manual-query cooldown. Do not steal an in-flight
                # OAuth lease, and never shorten a still-active 429 retry.
                state_path = _state_path(app_data)
                state_doc = _load_state(state_path)
                state_entry = state_doc["accounts"].get(identity)
                state_entry = state_entry if isinstance(state_entry, dict) else {}
                lease_until = state_entry.get("lease_until_ms")
                active_lease = (isinstance(state_entry.get("lease"), str)
                                and type(lease_until) is int and lease_until > now_ms)
                state_entry["last_observed_at_ms"] = now_ms
                state_entry["verified_at_ms"] = now_ms
                if not active_lease:
                    previous_retry = state_entry.get("retry_at_ms")
                    rate_retry = state_entry.get("rate_limit_retry_at_ms")
                    if (type(rate_retry) is not int and state_entry.get("last_status") == "rate_limited"):
                        rate_retry = previous_retry
                    preserve_rate_limit = type(rate_retry) is int and rate_retry > now_ms
                    if preserve_rate_limit:
                        state_entry["rate_limit_retry_at_ms"] = rate_retry
                        state_entry["retry_at_ms"] = max(
                            rate_retry, previous_retry if type(previous_retry) is int else 0)
                    else:
                        state_entry.pop("rate_limit_retry_at_ms", None)
                        state_entry["retry_at_ms"] = now_ms + SUCCESS_COOLDOWN_MS
                    state_entry["last_status"] = "updated"
                    state_entry["last_source"] = "browser"
                    state_entry["error_count"] = 0
                state_doc["accounts"][identity] = state_entry
                _atomic_json(state_path, state_doc)

            try:
                if path.exists() and not _safe_regular_file(path):
                    raise OSError("unsafe web metadata file")
                doc = json.loads(_bounded_read(path).decode("utf-8"))
                if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("accounts"), dict):
                    doc = {"version": 1, "accounts": {}}
            except (OSError, ValueError):
                doc = {"version": 1, "accounts": {}}
            previous = doc["accounts"].get(identity, {})
            previous = previous if isinstance(previous, dict) else {}
            entry = dict(previous)
            updated = False
            billing_valid = kind in ("next_renewal", "access_until") and billing_date is not None
            if billing_valid and observed > int(previous.get("billing_observed_at_ms") or 0):
                entry.update({"billing_date_kind": kind, "billing_date": billing_date,
                              "billing_observed_at_ms": observed})
                updated = True
            if resets is not None and resets_valid and observed > int(previous.get("manual_resets_observed_at_ms") or 0):
                entry.update({"manual_resets_remaining": resets,
                              "manual_resets_valid_until": resets_valid_until,
                              "manual_resets_observed_at_ms": observed})
                updated = True
            # Preserve the legacy aggregate timestamp as the maximum field clock.
            field_times = [int(entry.get("billing_observed_at_ms") or 0),
                           int(entry.get("manual_resets_observed_at_ms") or 0)]
            aggregate = max(field_times) or None
            entry.pop("metadata_observed_at_ms", None)
            if aggregate is not None:
                entry["metadata_observed_at_ms"] = aggregate
            outcome.update({"metadata_updated": updated, "observed_at_ms": aggregate})
            if updated:
                outcome["updated"] = True
                doc["accounts"][identity] = entry
                _atomic_json(path, doc)
    except (OSError, TimeoutError):
        return _result("unavailable", metadata_updated=False)
    result = _result("updated" if outcome["updated"] else "cached",
                     metadata_updated=outcome["metadata_updated"],
                     observed_at_ms=now_ms if usage_windows else outcome["observed_at_ms"],
                     updated_windows=usage_windows or None,
                     source="browser" if usage_windows else None,
                     verified_at_ms=now_ms if usage_windows else None)
    return result


def _classify_http_result(status_code, headers, now_ms: int):
    if status_code == "network_error":
        return "network_error", None
    if status_code == "invalid_response":
        return "invalid_response", None
    if status_code == 401:
        return "auth_required", None
    if status_code == 403:
        return "unavailable", None
    if status_code == 429:
        return "rate_limited", max(_retry_after_ms(headers, now_ms), now_ms + ERROR_COOLDOWN_MS)
    if isinstance(status_code, int) and 300 <= status_code < 400:
        return "unavailable", None
    if status_code != 200:
        return "unavailable", None
    return None, None


def run(app_data: Path, claude_home: Path, account_id: str,
        expected_identity: str | None = None, commit_guard=None) -> dict:
    if quota is None:
        return _result("unavailable")
    try:
        cj, cred, acc, oauth, identity = _resolve_expected(app_data, claude_home, account_id, expected_identity)
        route = _route(cj)
    except RouteUnavailable:
        return _result("route_unavailable", reason="unsupported_proxy", stage="route")
    except IdentityMismatch:
        return _result("account_mismatch")
    except PermissionError:
        return _result("auth_required")
    except LookupError:
        return _result("unavailable")
    except (OSError, ValueError, sqlite3.Error, RuntimeError):
        return _result("unavailable")
    now_ms = int(time.time() * 1000)
    try:
        lease = _claim(app_data, identity, now_ms)
    except (OSError, TimeoutError):
        return _result("unavailable")
    if isinstance(lease, dict):
        return lease
    token = _valid_access_token(oauth, now_ms)
    if token is None:
        try:
            _finish_state(app_data, identity, lease, now_ms, "auth_required")
        except (OSError, TimeoutError):
            return _result("unavailable")
        return _result("auth_required")
    route_fields = cj.get("_online_route", {}) if isinstance(cj.get("_online_route"), dict) else {}
    if os.environ.get("CLAUDE_LOCAL_VERIFY_EXIT") == "1" or route_fields.get("CLAUDE_LOCAL_VERIFY_EXIT") == "1":
        allowed_raw = route_fields.get("CLAUDE_LOCAL_ALLOWED_COUNTRIES") or os.environ.get("CLAUDE_LOCAL_ALLOWED_COUNTRIES")
        allowed = tuple(c.strip() for c in allowed_raw.split(",") if c.strip()) if isinstance(allowed_raw, str) and allowed_raw.strip() else DEFAULT_ALLOWED_EXIT_COUNTRIES
        exit_ok, exit_country = _verify_exit_country(route, allowed)
        if not exit_ok:
            try:
                finished = _finish_state(app_data, identity, lease, int(time.time() * 1000), "route_unavailable")
            except (OSError, TimeoutError):
                return _result("unavailable")
            retry_at = finished[0] if finished else None
            return _result("route_unavailable", retry_at_ms=retry_at,
                           reason="non_us_exit" if exit_country else "exit_check_failed",
                           stage="exit_check", country=exit_country, route_mode=route[0])
    profile_code, profile_raw, profile_headers = _fetch(token, PROFILE_ENDPOINT, route)
    profile_now = int(time.time() * 1000)
    status, retry = _classify_http_result(profile_code, profile_headers, profile_now)
    if status is None:
        try:
            profile = json.loads(profile_raw.decode("utf-8"))
            validate_profile(profile, acc)
        except LookupError:
            status, retry = "account_mismatch", None
        except (UnicodeError, ValueError, TypeError, OverflowError):
            status, retry = "invalid_response", None
    if status is None:
        usage_code, raw, headers = _fetch(token, ENDPOINT, route)
        observed_ms = int(time.time() * 1000)
        status, retry = _classify_http_result(usage_code, headers, observed_ms)
        if status is None:
            try:
                payload = json.loads(raw.decode("utf-8"))
                anchor, updated = validate_usage(payload, acc["accountUuid"], observed_ms)
            except LookupError:
                status, retry = "account_mismatch", None
            except (UnicodeError, ValueError, TypeError, OverflowError):
                status, retry = "invalid_response", None
            else:
                try:
                    if commit_guard is not None and not commit_guard():
                        # Keep prior observations; releasing this lease is not a quota write.
                        _finish_state(app_data, identity, lease, int(time.time() * 1000), "cancelled")
                        return _result("cancelled")
                    status, retry_at = _commit_success(
                        app_data, claude_home, account_id, expected_identity, token,
                        identity, lease, observed_ms, cj, cred, anchor, route)
                    if status == "updated":
                        return _result("updated", observed_at_ms=observed_ms, retry_at_ms=retry_at,
                                       last_observed_at_ms=observed_ms, updated_windows=updated,
                                       source="oauth", verified_at_ms=observed_ms, route_mode=route[0])
                    if status == "cooldown":
                        return _result("cooldown")
                    if status == "route_unavailable":
                        return _result(status, retry_at_ms=retry_at, reason="route_changed", stage="commit", route_mode=route[0])
                    return _result(status, retry_at_ms=retry_at, route_mode=route[0])
                except (OSError, TimeoutError, sqlite3.Error, RuntimeError):
                    status, retry = "unavailable", None
    observed_ms = int(time.time() * 1000)
    try:
        finished = _finish_state(app_data, identity, lease, observed_ms, status, retry)
    except (OSError, TimeoutError):
        return _result("unavailable")
    if finished is None:
        return _result("cooldown")
    actual_retry, last_observed = finished
    return _result(status, retry_at_ms=actual_retry, last_observed_at_ms=last_observed, route_mode=route[0])


def run_wakeup(app_data: Path, claude_home: Path, account_id: str,
               expected_identity: str | None = None, commit_guard=None) -> dict:
    """Trigger a lightweight /v1/messages request to start the next 5h quota window and persist the new anchor."""
    if quota is None:
        return _result("unavailable")
    try:
        cj, cred, acc, oauth, identity = _resolve_expected(app_data, claude_home, account_id, expected_identity)
        route = _route(cj)
    except RouteUnavailable:
        return _result("route_unavailable", reason="unsupported_proxy", stage="route")
    except IdentityMismatch:
        return _result("account_mismatch")
    except PermissionError:
        return _result("auth_required")
    except LookupError:
        return _result("unavailable")
    except (OSError, ValueError, sqlite3.Error, RuntimeError):
        return _result("unavailable")
    now_ms = int(time.time() * 1000)
    try:
        lease = _claim(app_data, identity, now_ms)
    except (OSError, TimeoutError):
        return _result("unavailable")
    if isinstance(lease, dict):
        return lease
    token = _valid_access_token(oauth, now_ms)
    if token is None:
        try:
            _finish_state(app_data, identity, lease, now_ms, "auth_required")
        except (OSError, TimeoutError):
            return _result("unavailable")
        return _result("auth_required")
    route_fields = cj.get("_online_route", {}) if isinstance(cj.get("_online_route"), dict) else {}
    if os.environ.get("CLAUDE_LOCAL_VERIFY_EXIT") == "1" or route_fields.get("CLAUDE_LOCAL_VERIFY_EXIT") == "1":
        allowed_raw = route_fields.get("CLAUDE_LOCAL_ALLOWED_COUNTRIES") or os.environ.get("CLAUDE_LOCAL_ALLOWED_COUNTRIES")
        allowed = tuple(c.strip() for c in allowed_raw.split(",") if c.strip()) if isinstance(allowed_raw, str) and allowed_raw.strip() else DEFAULT_ALLOWED_EXIT_COUNTRIES
        exit_ok, exit_country = _verify_exit_country(route, allowed)
        if not exit_ok:
            try:
                finished = _finish_state(app_data, identity, lease, int(time.time() * 1000), "route_unavailable")
            except (OSError, TimeoutError):
                return _result("unavailable")
            retry_at = finished[0] if finished else None
            return _result("route_unavailable", retry_at_ms=retry_at,
                           reason="non_us_exit" if exit_country else "exit_check_failed",
                           stage="exit_check", country=exit_country, route_mode=route[0])
    profile_code, profile_raw, profile_headers = _fetch(token, PROFILE_ENDPOINT, route)
    profile_now = int(time.time() * 1000)
    status, retry = _classify_http_result(profile_code, profile_headers, profile_now)
    if status is None:
        try:
            profile = json.loads(profile_raw.decode("utf-8"))
            validate_profile(profile, acc)
        except LookupError:
            status, retry = "account_mismatch", None
        except (UnicodeError, ValueError, TypeError, OverflowError):
            status, retry = "invalid_response", None
    if status is None:
        device_id = _device_id(cj, identity)
        msg_code, msg_raw, msg_headers = None, None, None
        for model in WAKEUP_MODELS:
            msg_code, msg_raw, msg_headers = _post_wakeup(token, model, device_id, acc["accountUuid"], route)
            if msg_code not in (400, 404):
                break
        observed_ms = int(time.time() * 1000)
        status, retry = _classify_http_result(msg_code, msg_headers, observed_ms)
        if status is None:
            anchor, updated = None, None
            try:
                anchor, updated = parse_ratelimit_headers(msg_headers, acc["accountUuid"], observed_ms)
            except ValueError:
                # Fallback to GET /api/oauth/usage if the proxy stripped custom response headers.
                usage_code, raw, headers = _fetch(token, ENDPOINT, route)
                observed_ms = int(time.time() * 1000)
                status, retry = _classify_http_result(usage_code, headers, observed_ms)
                if status is None:
                    try:
                        payload = json.loads(raw.decode("utf-8"))
                        anchor, updated = validate_usage(payload, acc["accountUuid"], observed_ms)
                    except LookupError:
                        status, retry = "account_mismatch", None
                    except (UnicodeError, ValueError, TypeError, OverflowError):
                        status, retry = "invalid_response", None
            if status is None and anchor is not None and updated:
                try:
                    if commit_guard is not None and not commit_guard():
                        _finish_state(app_data, identity, lease, int(time.time() * 1000), "cancelled")
                        return _result("cancelled")
                    status, retry_at = _commit_success(
                        app_data, claude_home, account_id, expected_identity, token,
                        identity, lease, observed_ms, cj, cred, anchor, route)
                    if status == "updated":
                        return _result("updated", observed_at_ms=observed_ms, retry_at_ms=retry_at,
                                       last_observed_at_ms=observed_ms, updated_windows=updated,
                                       source="oauth", verified_at_ms=observed_ms, route_mode=route[0])
                    if status == "cooldown":
                        return _result("cooldown")
                    if status == "route_unavailable":
                        return _result(status, retry_at_ms=retry_at, reason="route_changed", stage="commit", route_mode=route[0])
                    return _result(status, retry_at_ms=retry_at, route_mode=route[0])
                except (OSError, TimeoutError, sqlite3.Error, RuntimeError):
                    status, retry = "unavailable", None
    observed_ms = int(time.time() * 1000)
    try:
        finished = _finish_state(app_data, identity, lease, observed_ms, status, retry)
    except (OSError, TimeoutError):
        return _result("unavailable")
    if finished is None:
        return _result("cooldown")
    actual_retry, last_observed = finished
    return _result(status, retry_at_ms=actual_retry, last_observed_at_ms=last_observed, route_mode=route[0])


MAX_PROTOCOL_LINE = 16 * 1024


def _read_protocol_line(stream, timeout=10):
    """Bound both line size and wait; daemon reader never delays process exit."""
    answers = queue.Queue(maxsize=1)
    def read():
        try:
            answers.put(stream.readline(MAX_PROTOCOL_LINE + 1))
        except (OSError, ValueError):
            answers.put("")
    threading.Thread(target=read, daemon=True).start()
    try:
        line = answers.get(timeout=max(0.001, timeout))
    except queue.Empty:
        raise ValueError("protocol timeout") from None
    if not line or len(line) > MAX_PROTOCOL_LINE or not line.endswith("\n"):
        raise ValueError("invalid protocol line")
    return json.loads(line)


def _commit_grant(stream, output, nonce, deadline_ms):
    """One fresh grant per helper. No credential, route or usage crosses this pipe."""
    used = False
    def acquire():
        nonlocal used
        if used:
            return False
        used = True
        remaining = (deadline_ms - int(time.time() * 1000)) / 1000
        if remaining <= 0:
            return False
        output.write(json.dumps({"type": "ready_to_commit", "nonce": nonce}) + "\n")
        output.flush()
        try:
            grant = _read_protocol_line(stream, min(10, remaining))
            return (isinstance(grant, dict) and set(grant) == {"type", "nonce", "expires_at_ms"}
                    and grant["type"] == "grant" and grant["nonce"] == nonce
                    and type(grant["expires_at_ms"]) is int
                    and int(time.time() * 1000) < grant["expires_at_ms"] <= deadline_ms)
        except (ValueError, OSError, TypeError):
            return False
    return acquire


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-data", required=True)
    parser.add_argument("--claude-home", required=True)
    parser.add_argument("--two-phase", action="store_true")
    args = parser.parse_args(argv)
    try:
        request = _read_protocol_line(sys.stdin) if args.two_phase else json.load(sys.stdin)
        commit_guard = None
        if args.two_phase:
            nonce = request.get("nonce") if isinstance(request, dict) else None
            deadline = request.get("deadline_at_ms") if isinstance(request, dict) else None
            if (not isinstance(nonce, str) or not ACCOUNT_ID_RE.fullmatch(nonce)
                    or type(deadline) is not int or not 0 < deadline - int(time.time() * 1000) <= 120_000):
                raise ValueError("invalid two-phase request")
            commit_guard = _commit_grant(sys.stdin, sys.stdout, nonce, deadline)
        account_id = request.get("account_id") if isinstance(request, dict) else None
        expected_identity = request.get("expected_identity") if isinstance(request, dict) else None
        if not isinstance(account_id, str):
            result = _result("unavailable")
        elif not isinstance(expected_identity, str) or not IDENTITY_RE.fullmatch(expected_identity):
            result = _result("account_mismatch")
        elif isinstance(request, dict) and "browser_snapshot" in request:
            result = import_browser_snapshot(Path(args.app_data), Path(args.claude_home),
                                             account_id, request.get("browser_snapshot"), expected_identity, commit_guard)
        elif isinstance(request, dict) and request.get("wakeup") is True:
            result = run_wakeup(Path(args.app_data), Path(args.claude_home), account_id, expected_identity, commit_guard)
        else:
            result = run(Path(args.app_data), Path(args.claude_home), account_id, expected_identity, commit_guard)
    except (ValueError, OSError):
        result = _result("unavailable")
    message = {"type": "result", "result": result} if args.two_phase else result
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
