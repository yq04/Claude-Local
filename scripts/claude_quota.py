#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# [INPUT]: Passive statusLine data, isolated account evidence and the bounded sibling Rust quota protocol.
# [OUTPUT]: Serialized atomic quota summaries with validated observed percentages, trusted-reset inference and original observations.
# [POS]: Sole quota-ledger writer; standalone legacy rules mirror Rust without polling or editing Claude configuration.
# [PROTOCOL]: Update scripts/CLAUDE.md when changing window evidence or persistence behavior.
"""
claude-quota v6: passive quota collector with the bundled Rust window-state core
融合 GitHub 开源标杆架构 (ryoppippi/ccusage + Maciek-roboblog/Claude-Code-Usage-Monitor + sirmalloc/ccstatusline + Haleclipse/CCometixLine):
1. 被动式 statusLine 响应头收割 (--statusline): 实时捕获 Claude Code 2.1.x 每轮 /v1/messages 响应头中的
   anthropic-ratelimit-unified-5h/7d-utilization 与 resets_at，仅读取 ~/.claude.json，将锚点写入本地版 quota_ledger.json 与 SQLite 摘要表；
2. Claude Code 2.1.302 内核级 qHr 精确计费表: 完整对齐 opus-5-5 ($4/$20/$5/$8/$0.20)、haiku-5-5 ($0.10/$0.50)、
   opus-4-7/4-8 ($5/$25)、sonnet-5-5 ($2/$10/$0.10) 及 US 推理倍率 (1.1x)；
3. 跨文件全局 (message.id, requestId) 去重 + 单账号快照自适应标定 (Adaptive Window Calibration)；
4. Python remains the sole ledger/SQLite writer and preserves its lock/atomic replacement. The packaged collector calls the sibling claude-local.exe with bounded JSON for shared Rust window merging; standalone script use without that executable reports and retains the explicit legacy_python path. Trusted elapsed server resets retain their original boundary/observation as reset_inferred, never as a new server observation. No statusLine configuration is changed.
"""
import sys
import os
import json
import math
import hashlib
import struct
import sqlite3
import tempfile
import subprocess
import time
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.stdout.reconfigure(encoding="utf-8")

# 经 Claude Code 2.1.302 qHr 真实模型计费表 + 全局跨文件去重后双官方快照实证标定：
# Pro 账号默认 5h 窗口 100% ≈ $32.00 USD ($0.320/1%)，7d 周限额 100% ≈ $242.50 USD ($2.425/1%)
# 同时支持从各账号自身官方快照窗口内真实会话流自动计算自适应费率 (Adaptive Calibration)
PRO_WEEKLY_COST_USD = 242.5
PRO_5H_COST_USD = 32.0
CURRENT_QUOTA_VERSION = 7
QUOTA_SOURCES = ("server_anchor", "local_estimate", "reset_inferred", "unknown")


def observed_percentage(value) -> float | None:
    """Validate observed percentages before rounding; preserve legacy numeric strings."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    # A one-point rounding overshoot is tolerated; timestamps and other
    # out-of-contract values must not become a trusted exhausted window.
    return min(100.0, number) if math.isfinite(number) and 0 <= number <= 101 else None


def clean_anchor_percentages(anchor):
    """Copy only valid observed windows; never mutate a source cache in place."""
    if not isinstance(anchor, dict):
        return None
    utilization = anchor.get("utilization")
    if not isinstance(utilization, dict):
        return dict(anchor)
    utilization = dict(utilization)
    for window in ("five_hour", "seven_day"):
        raw = utilization.get(window)
        if isinstance(raw, dict) and raw.get("utilization") is not None:
            percentage = observed_percentage(raw["utilization"])
            if percentage is None:
                utilization.pop(window)
            else:
                utilization[window] = {**raw, "utilization": percentage}
    return {**anchor, "utilization": utilization}


def quota_identity(account: dict) -> str | None:
    """Non-secret provenance fingerprint; independent of the vault's HMAC identity."""
    uuid = str(account.get("accountUuid") or "").strip()
    email = str(account.get("emailAddress") or "").strip().lower()
    org = str(account.get("organizationUuid") or account.get("organizationName") or "").strip()
    if not uuid and not email:
        return None
    return hashlib.sha256(json.dumps([uuid, email, org], ensure_ascii=False,
                                      separators=(",", ":")).encode("utf-8")).hexdigest()


def same_quota_account(info: dict, entry: dict) -> bool:
    left, right = info.get("quota_identity"), entry.get("quota_identity")
    if left and right:
        return left == right
    anchor = entry.get("server_anchor") or {}
    uuid = entry.get("account_uuid") or anchor.get("accountUuid")
    if uuid and not (info.get("account_uuid") or (info.get("server_anchor") or {}).get("accountUuid")):
        return False
    info_uuid = info.get("account_uuid") or (info.get("server_anchor") or {}).get("accountUuid")
    if info_uuid and uuid != info_uuid:
        return False
    org = info.get("organization_uuid") or info.get("organization")
    entry_org = entry.get("organization_uuid") or entry.get("organization")
    return not org or org == entry_org


def ledger_account(accounts: dict, email: str, info: dict) -> dict:
    primary = accounts.get(email.lower()) or {}
    if same_quota_account(info, primary):
        return primary
    identity = info.get("quota_identity")
    if identity:
        candidate = accounts.get(email.lower() + "#" + identity) or {}
        if candidate and same_quota_account(info, candidate):
            return candidate
    return primary


def tier_multiplier(plan_str: str) -> float:
    p = (plan_str or "").lower()
    if "20x" in p:
        return 20.0
    if "5x" in p:
        return 5.0
    if "max" in p:
        return 5.0
    return 1.0



def window_fetched_at_ms(anchor: dict | None, window: str) -> int:
    if not isinstance(anchor, dict):
        return 0
    util = anchor.get("utilization")
    if isinstance(util, dict):
        win = util.get(window)
        if isinstance(win, dict):
            val = win.get("fetchedAtMs")
            if isinstance(val, (int, float)) and val > 0:
                return int(val)
    observed_windows = anchor.get("server_anchor_observed_windows")
    if isinstance(observed_windows, list) and window not in observed_windows:
        return 0
    return anchor_fetched_at_ms(anchor)


def aggregate_quota_source(s5: str | None, s7: str | None) -> str:
    return s5 if s5 == s7 and s5 in QUOTA_SOURCES else "unknown"


def aggregate_observed_at_ms(t5: int | None, t7: int | None) -> int | None:
    valid = [int(t) for t in (t5, t7) if isinstance(t, (int, float)) and t > 0]
    return max(valid) if valid else None


QUOTA_WINDOWS = (("5h", "five_hour"), ("7d", "seven_day"))

QUOTA_CORE_TIMEOUT_SEC = 2.0
QUOTA_CORE_MAX_BYTES = 1024 * 1024
QUOTA_CORE_MAX_ITEMS = 256


class QuotaCoreError(RuntimeError):
    """The bundled native quota core failed or returned an invalid response."""


def _quota_core_executable() -> Path:
    """Return the only supported installed layout for the native core."""
    return Path(__file__).resolve().parent.parent / "claude-local.exe"


def quota_backend() -> str:
    return "rust" if _quota_core_executable().is_file() else "legacy_python"


def _state_to_core(state: tuple) -> dict:
    used, reset, source, observed = state
    return {"used": used, "reset_at": reset, "source": source, "observed_at_ms": observed}


def _state_from_core(state, now_sec: int | None = None) -> tuple:
    if not isinstance(state, dict) or set(state) != {"used", "reset_at", "source", "observed_at_ms"}:
        raise QuotaCoreError("quota core returned an invalid window state")
    used, reset, source, observed = (state.get("used"), state.get("reset_at"), state.get("source"),
                                     state.get("observed_at_ms"))
    if used is not None and (type(used) is not int or not 0 <= used <= 100):
        raise QuotaCoreError("quota core returned invalid usage")
    if reset is not None and (type(reset) is not int or not 0 <= reset <= 253402300799):
        raise QuotaCoreError("quota core returned invalid reset time")
    if source not in QUOTA_SOURCES:
        raise QuotaCoreError("quota core returned invalid source")
    if observed is not None and (type(observed) is not int or not 0 <= observed <= 253402300799999):
        raise QuotaCoreError("quota core returned invalid observation time")
    if (used is None) != (source == "unknown") or (source == "unknown" and reset is not None):
        raise QuotaCoreError("quota core returned inconsistent window state")
    if source == "reset_inferred" and not (
            used == 0 and reset is not None and observed is not None and 0 < observed < reset * 1000
            and (now_sec is None or reset <= now_sec)):
        raise QuotaCoreError("quota core returned invalid reset inference")
    return used, reset, source, observed


def _normalize_window_state(state: tuple, now_sec: int) -> tuple:
    """Mirror the pure Rust rules only for the explicit standalone compatibility path."""
    used, reset, source, observed = state
    observed = observed if observed is not None and observed > 0 else None
    elapsed_evidence = (reset is not None and reset <= now_sec and observed is not None
                        and observed < reset * 1000)
    if source == "reset_inferred":
        return (0, reset, source, observed) if used == 0 and elapsed_evidence else (None, None, "unknown", observed)
    if source == "server_anchor" and used is not None and elapsed_evidence:
        return 0, reset, "reset_inferred", observed
    if source == "unknown" or used is None or reset is None or reset <= now_sec:
        return None, None, "unknown", observed
    return used, reset, source, observed


def _legacy_merge_window_state(current: tuple, candidate: tuple, now_sec: int) -> tuple:
    """Python-only compatibility path used only when the bundled core is absent."""
    original_source = current[2]
    current = _normalize_window_state(current, now_sec)
    candidate = _normalize_window_state(candidate, now_sec)
    cu, cr, cs, ct = current
    nu, nr, ns, nt = candidate
    if nu is None or ns == "unknown":
        return current
    if ns == "reset_inferred" and original_source == "local_estimate":
        return current
    if cs == "reset_inferred" and ns == "local_estimate" and nr is not None and nr > now_sec:
        return candidate
    if cu is None or cs == "unknown":
        if ct is not None and nt is not None and nt < ct:
            return current
        return candidate
    if ct is None and cs == "local_estimate":
        return current
    if ct is not None and nt is None:
        return current
    if ct is not None and nt is not None and nt < ct:
        return current
    if ct == nt and cr != nr:
        return current
    if cr == nr and cu > nu:
        return cu, cr, cs, max((value for value in (ct, nt) if value is not None), default=None)
    return candidate


def merge_window_states(current_states: list[tuple], candidate_states: list[tuple], now_sec: int) -> list[tuple]:
    if len(current_states) != len(candidate_states) or len(current_states) > QUOTA_CORE_MAX_ITEMS:
        raise ValueError("invalid quota window batch")
    executable = _quota_core_executable()
    if not executable.is_file():
        return [_legacy_merge_window_state(current, candidate, int(now_sec))
                for current, candidate in zip(current_states, candidate_states)]

    payload = {
        "schema": 1,
        "op": "merge_windows",
        "now_sec": int(now_sec),
        "items": [{"current": _state_to_core(current), "candidate": _state_to_core(candidate)}
                  for current, candidate in zip(current_states, candidate_states)],
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if len(encoded) > QUOTA_CORE_MAX_BYTES:
        raise QuotaCoreError("quota core request exceeds 1 MiB")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        completed = subprocess.run(
            [str(executable), "--quota-core"], input=encoded, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=QUOTA_CORE_TIMEOUT_SEC, check=False,
            shell=False, creationflags=creationflags,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise QuotaCoreError("quota core execution failed") from exc
    if completed.returncode != 0 or len(completed.stdout) > QUOTA_CORE_MAX_BYTES:
        raise QuotaCoreError("quota core returned an error or oversized response")
    try:
        response = json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise QuotaCoreError("quota core returned invalid JSON") from exc
    if (not isinstance(response, dict) or set(response) != {"schema", "items"}
            or type(response.get("schema")) is not int or response.get("schema") != 1
            or not isinstance(response.get("items"), list)
            or len(response["items"]) != len(current_states)):
        raise QuotaCoreError("quota core returned an invalid response shape")
    return [_state_from_core(item, int(now_sec)) for item in response["items"]]


def _expired_anchor_state(entry: dict, suffix: str, window: str, now_sec: int) -> tuple | None:
    """Recover an erased window only from its original, same-account server boundary."""
    if entry.get(f"quota_{suffix}_source") == "local_estimate" or (
            entry.get(f"quota_{suffix}_source") is None and entry.get("quota_source") == "local_estimate"):
        return None
    anchor = entry.get("server_anchor")
    if not isinstance(anchor, dict) or not anchor.get("accountUuid"):
        return None
    if entry.get("account_uuid") and entry["account_uuid"] != anchor["accountUuid"]:
        return None
    raw = (anchor.get("utilization") or {}).get(window)
    if not isinstance(raw, dict):
        return None
    raw_used = observed_percentage(raw.get("utilization"))
    if raw_used is None:
        return None
    reset_dt = parse_reset_dt(raw.get("resets_at"))
    if reset_dt is None:
        return None
    reset = int(reset_dt.timestamp())
    observed_windows = entry.get("server_anchor_observed_windows")
    if not raw.get("fetchedAtMs") and isinstance(observed_windows, list) and window not in observed_windows:
        return None
    observed = window_fetched_at_ms(anchor, window)
    if not (0 < observed < reset * 1000 and reset <= now_sec):
        return None
    return 0, reset, "reset_inferred", observed


def entry_window_state(entry: dict, suffix: str, window: str, now_sec: int | None = None) -> tuple[int | None, int | None, str, int | None]:
    """Read one persisted window, retaining legacy global provenance only for compatible entries."""
    anchor = entry.get("server_anchor") if isinstance(entry.get("server_anchor"), dict) else {}
    util = anchor.get("utilization") if isinstance(anchor.get("utilization"), dict) else {}
    anchor_window = util.get(window) if isinstance(util.get(window), dict) else {}
    explicit_source = entry.get(f"quota_{suffix}_source") in QUOTA_SOURCES
    source = entry.get(f"quota_{suffix}_source")
    if source not in QUOTA_SOURCES:
        source = entry.get("quota_source")
        if source not in QUOTA_SOURCES:
            source = "server_anchor" if anchor_fetched_at_ms(anchor) or anchor_window else "unknown"
    observed = entry.get(f"quota_{suffix}_observed_at_ms")
    if not (isinstance(observed, (int, float)) and observed > 0):
        observed = window_fetched_at_ms(anchor, window)
        if not observed and not explicit_source:
            observed = entry.get("quota_observed_at_ms")
    if not (isinstance(observed, (int, float)) and observed > 0):
        observed = None
    used = entry.get(f"quota_{suffix}_used")
    reset = entry.get(f"quota_{suffix}_reset_at")
    if source == "server_anchor" and anchor_window:
        anchor_used = anchor_window.get("utilization")
        anchor_reset = parse_reset_dt(anchor_window.get("resets_at"))
        if anchor_used is not None:
            used = observed_percentage(anchor_used)
        if anchor_reset is not None:
            reset = int(anchor_reset.timestamp())
    try:
        percentage = observed_percentage(used)
        used = int(round(percentage)) if percentage is not None else None
        reset = int(reset) if reset is not None else None
    except (TypeError, ValueError, OverflowError):
        used, reset = None, None
    now_sec = int(time.time()) if now_sec is None else int(now_sec)
    if source == "reset_inferred":
        inferred = _expired_anchor_state(entry, suffix, window, now_sec)
        if inferred is not None and used == 0 and reset == inferred[1] and observed == inferred[3]:
            return inferred
        return None, None, "unknown", int(observed) if observed else None
    if source == "unknown" or used is None:
        inferred = _expired_anchor_state(entry, suffix, window, now_sec)
        if inferred is not None and (observed is None or inferred[3] >= observed):
            return inferred
        return None, None, "unknown", int(observed) if observed else None
    return used, reset, source, int(observed) if observed else None


def info_window_state(info: dict, suffix: str, window: str, now_sec: int | None = None) -> tuple[int | None, int | None, str, int | None]:
    used = info.get(f"used_{suffix}")
    reset = info.get(f"reset_{suffix}_ts")
    source = info.get(f"quota_{suffix}_source")
    explicit_source = source in QUOTA_SOURCES
    if source not in QUOTA_SOURCES:
        source = info.get("quota_source")
    observed = info.get(f"quota_{suffix}_observed_at_ms")
    if not (isinstance(observed, (int, float)) and observed > 0):
        observed = window_fetched_at_ms(info.get("server_anchor"), window)
        if not observed and not explicit_source:
            observed = info.get("quota_observed_at_ms")
    try:
        percentage = observed_percentage(used)
        used = int(round(percentage)) if percentage is not None else None
        reset = int(reset) if reset is not None else None
    except (TypeError, ValueError, OverflowError):
        used, reset = None, None
    if source not in QUOTA_SOURCES:
        source = "server_anchor" if used is not None and anchor_fetched_at_ms(info.get("server_anchor")) else ("local_estimate" if used is not None else "unknown")
    if used is None:
        source = "unknown"
    if source == "unknown":
        inferred = _expired_anchor_state(info, suffix, window, int(time.time()) if now_sec is None else int(now_sec))
        if inferred is not None and (observed is None or inferred[3] >= observed):
            return inferred
    return used, reset, source, int(observed) if isinstance(observed, (int, float)) and observed > 0 else None


def merge_window_state(current: tuple, candidate: tuple) -> tuple:
    """Compatibility wrapper around the shared merge operation."""
    return merge_window_states([current], [candidate], int(time.time()))[0]


def parse_reset_dt(val) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        if val > 1_000_000_000:
            return datetime.fromtimestamp(float(val), tz=timezone.utc)
        return None
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        if s.isdigit():
            ts = int(s)
            if ts > 1_000_000_000:
                return datetime.fromtimestamp(float(ts), tz=timezone.utc)
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            return None
    return None


def decrypt_baga(vault_dir: str, master_key: bytes, filename: str) -> bytes:
    path = os.path.join(vault_dir, filename)
    with open(path, "rb") as f:
        magic = f.read(8)
        if magic != b"BAGAID01":
            raise ValueError(f"Invalid magic in {filename}")
        nonce0 = f.read(12)
        wrapped = f.read(48)
        data_key = AESGCM(master_key).decrypt(nonce0, wrapped, b"BAGAID01")
        aes = AESGCM(data_key)
        counter = 0
        out = bytearray()
        while True:
            len_bytes = f.read(4)
            if not len_bytes:
                break
            frame_len = struct.unpack(">I", len_bytes)[0]
            ct = f.read(frame_len)
            nonce = b"\x00\x00\x00\x00" + struct.pack(">Q", counter)
            pt = aes.decrypt(nonce, ct, len_bytes)
            counter += 1
            if len(pt) == 0:
                break
            out.extend(pt)
    return bytes(out)


def estimate_turn_cost_usd(model: str, usage: dict) -> float:
    """Exact Claude Code 2.1.302 internal qHr model pricing catalog + Xgt geo/tool multipliers."""
    if not isinstance(usage, dict):
        return 0.0
    m = (model or "").lower()
    in_tok = float(usage.get("input_tokens") or 0)
    out_tok = float(usage.get("output_tokens") or 0)
    cr_tok = float(usage.get("cache_read_input_tokens") or 0)
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        cw_1h = float(cc.get("ephemeral_1h_input_tokens") or 0)
        cw_5m = float(cc.get("ephemeral_5m_input_tokens") or 0)
    else:
        cw_1h, cw_5m = 0.0, 0.0
    cw_tot = float(usage.get("cache_creation_input_tokens") or 0)
    if cw_1h + cw_5m == 0 and cw_tot > 0:
        cw_5m = cw_tot

    total_in = in_tok + cr_tok + cw_1h + cw_5m
    if "haiku-5-5" in m or "haiku-5.5" in m:
        if total_in > 100_000:
            p_in, p_out, p_cw5, p_cw1h, p_cr = 0.50, 2.50, 0.625, 1.00, 0.05
        else:
            p_in, p_out, p_cw5, p_cw1h, p_cr = 0.10, 0.50, 0.125, 0.20, 0.01
    elif "3-5-haiku" in m or "3.5-haiku" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 0.80, 4.00, 1.00, 1.60, 0.08
    elif "haiku" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 1.00, 5.00, 1.25, 2.00, 0.10
    elif "opus-5-5" in m or "opus-5.5" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 4.00, 20.00, 5.00, 8.00, 0.20
    elif any(
        k in m
        for k in (
            "opus-4-5",
            "opus-4-6",
            "opus-4-7",
            "opus-4-8",
            "opus-5",
            "opus-4.5",
            "opus-4.6",
            "opus-4.7",
            "opus-4.8",
        )
    ):
        p_in, p_out, p_cw5, p_cw1h, p_cr = 5.00, 25.00, 6.25, 10.00, 0.50
    elif "opus" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 15.00, 75.00, 18.75, 30.00, 1.50
    elif "sonnet-5-5" in m or "sonnet-5.5" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 2.00, 10.00, 2.50, 4.00, 0.10
    elif "sonnet-5" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 2.00, 10.00, 2.50, 4.00, 0.20
    elif "fable" in m:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 10.00, 50.00, 12.50, 20.00, 1.00
    else:
        p_in, p_out, p_cw5, p_cw1h, p_cr = 3.00, 15.00, 3.75, 6.00, 0.30

    cost = (in_tok * p_in + out_tok * p_out + cw_5m * p_cw5 + cw_1h * p_cw1h + cr_tok * p_cr) / 1_000_000.0
    if str(usage.get("inference_geo") or "").lower() == "us":
        cost *= 1.1
    st = usage.get("server_tool_use")
    if isinstance(st, dict):
        reqs = float(st.get("web_search_requests") or 0)
        if reqs > 0:
            cost += reqs * 0.01
    return cost


def parse_jsonl_file_into(
    fp: str,
    raw_text: str,
    global_turns: dict[tuple[str, str], tuple[datetime, float]],
    fallback_slices: list[tuple[datetime, float]],
) -> datetime | None:
    """Parse a single .jsonl file into a shared cross-file deduplicated turn map."""
    file_cs_slices: list[tuple[datetime, float]] = []
    saw_assistant_usage = False
    current_dt: datetime | None = None
    last_dt: datetime | None = None
    prev_cumulative_cost = 0.0

    for line_idx, line in enumerate(raw_text.splitlines()):
        if not line.strip():
            continue
        if '"timestamp"' not in line and '"cost-state"' not in line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        ts_str = obj.get("timestamp")
        if isinstance(ts_str, str) and ts_str:
            try:
                current_dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone(timezone.utc)
                if last_dt is None or current_dt > last_dt:
                    last_dt = current_dt
            except Exception:
                pass

        rec_type = obj.get("type")
        if rec_type == "assistant" and current_dt is not None:
            msg = obj.get("message")
            if isinstance(msg, dict):
                usage = msg.get("usage")
                if isinstance(usage, dict):
                    c = estimate_turn_cost_usd(str(msg.get("model") or ""), usage)
                    if c > 0:
                        saw_assistant_usage = True
                        msg_id = str(msg.get("id") or "")
                        req_id = str(obj.get("requestId") or "")
                        dedup_key = (
                            (msg_id, req_id)
                            if (msg_id or req_id)
                            else (f"{fp}#{int(current_dt.timestamp())}", str(line_idx))
                        )
                        global_turns[dedup_key] = (current_dt, c)
        elif rec_type == "cost-state":
            total_cost = float(obj.get("totalCostUSD") or 0.0)
            eff_dt = current_dt
            if eff_dt is None:
                start_ms = obj.get("startTime")
                dur_ms = obj.get("totalDuration") or 0
                if isinstance(start_ms, (int, float)) and start_ms > 0:
                    eff_dt = datetime.fromtimestamp((start_ms + dur_ms) / 1000.0, tz=timezone.utc)
            if eff_dt is not None and total_cost > prev_cumulative_cost:
                delta = total_cost - prev_cumulative_cost
                file_cs_slices.append((eff_dt, delta))
                prev_cumulative_cost = total_cost

    if not saw_assistant_usage:
        fallback_slices.extend(file_cs_slices)
    return last_dt


def collect_session_slices_from_dir(proj_root: str) -> tuple[list[tuple[datetime, float]], datetime | None]:
    global_turns: dict[tuple[str, str], tuple[datetime, float]] = {}
    fallback_slices: list[tuple[datetime, float]] = []
    latest_dt: datetime | None = None
    if not os.path.isdir(proj_root):
        return [], None
    for root, _dirs, files in os.walk(proj_root):
        for fn in files:
            if fn.endswith(".jsonl"):
                fp = os.path.join(root, fn)
                try:
                    with open(fp, "r", encoding="utf-8", errors="replace") as f:
                        file_last_dt = parse_jsonl_file_into(fp, f.read(), global_turns, fallback_slices)
                    if file_last_dt and (latest_dt is None or file_last_dt > latest_dt):
                        latest_dt = file_last_dt
                except Exception:
                    pass
    all_slices = list(global_turns.values()) + fallback_slices
    return all_slices, latest_dt


def inspect_baga_archive(
    vault_dir: str, master_key: bytes, archive: str
) -> tuple[dict, dict, list[tuple[datetime, float]], datetime | None]:
    """Decrypt .baga and unpack only manifest + config/project slots in a single tar.exe call."""
    zst_bytes = decrypt_baga(vault_dir, master_key, archive)
    p_man = subprocess.run(
        [r"C:\Windows\System32\tar.exe", "-xOf", "-", "manifest.json"],
        input=zst_bytes,
        capture_output=True,
    )
    if p_man.returncode != 0 or not p_man.stdout:
        return {}, {}, [], None
    manifest = json.loads(p_man.stdout.decode("utf-8", errors="replace"))
    cj_slot = None
    cred_slot = None
    proj_slot = None
    for idx, src in enumerate(manifest.get("sources", [])):
        p_str = str(src.get("path", "")).replace("\\", "/")
        if p_str.endswith("/.claude.json"):
            cj_slot = idx
        elif p_str.endswith("/.credentials.json"):
            cred_slot = idx
        elif p_str.endswith("/.claude/projects"):
            proj_slot = idx

    targets = [f"data/{s}" for s in (cj_slot, cred_slot, proj_slot) if s is not None]
    if not targets:
        return {}, {}, [], None

    with tempfile.TemporaryDirectory(prefix="claude-local-quota-") as tmpdir:
        p = subprocess.run(
            [r"C:\Windows\System32\tar.exe", "-xf", "-", "-C", tmpdir, *targets],
            input=zst_bytes,
            capture_output=True,
        )
        if p.returncode != 0:
            raise RuntimeError(f"tar extract failed: {p.stderr.decode('utf-8', errors='replace')}")
        baga_cj = {}
        baga_cred = {}
        if cj_slot is not None:
            fp = os.path.join(tmpdir, "data", str(cj_slot))
            if os.path.isfile(fp):
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    baga_cj = json.load(f)
        if cred_slot is not None:
            fp = os.path.join(tmpdir, "data", str(cred_slot))
            if os.path.isfile(fp):
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    baga_cred = json.load(f)
        proj_dir = os.path.join(tmpdir, "data", str(proj_slot)) if proj_slot is not None else None
        slices, latest_dt = (
            collect_session_slices_from_dir(proj_dir)
            if (proj_dir and os.path.isdir(proj_dir))
            else ([], None)
        )
        return baga_cj, baga_cred, slices, latest_dt


def format_duration(seconds: float) -> str:
    if seconds <= 0:
        return "已重置"
    mins = max(1, int(seconds // 60))
    days = mins // (24 * 60)
    hours = (mins % (24 * 60)) // 60
    rem_mins = mins % 60
    if days > 0:
        return f"{days}天{hours}小时后重置"
    if hours > 0:
        return f"{hours}小时{rem_mins}分后重置"
    return f"{rem_mins}分钟后重置"


def format_compact_eta(seconds: float) -> str:
    if seconds <= 0:
        return "已重置"
    mins = max(1, int(seconds // 60))
    days = mins // 1440
    hours = (mins % 1440) // 60
    rem_mins = mins % 60
    if days > 0:
        return f"{days}d{hours}h"
    if hours > 0:
        return f"{hours}h{rem_mins:02d}m"
    return f"{rem_mins}m"


def walk_5h_blocks(
    slices: list[tuple[datetime, float]],
    after_dt: datetime,
    now_utc: datetime,
) -> tuple[float, datetime | None]:
    """Walk chronological slices after `after_dt` using Anthropic's 5-hour discrete block rule."""
    ordered = sorted((dt, c) for dt, c in slices if dt >= after_dt and c > 0)
    block_end: datetime | None = None
    block_cost = 0.0
    for dt, cost in ordered:
        if block_end is None or dt >= block_end:
            hour_floor = dt.replace(minute=0, second=0, microsecond=0)
            cand_end = hour_floor + timedelta(hours=5)
            if cand_end <= dt:
                cand_end = dt + timedelta(hours=5)
            block_end = cand_end
            block_cost = cost
        else:
            block_cost += cost
    if block_end is not None and now_utc < block_end:
        return block_cost, block_end
    return 0.0, None


def evaluate_quota(
    cj: dict,
    slices: list[tuple[datetime, float]],
    latest_dt: datetime | None,
    plan_str: str,
    now_utc: datetime,
    active_since_dt: datetime | None = None,
) -> dict:
    acc_uuid = ((cj.get("oauthAccount") or {}).get("accountUuid") or "") if isinstance(cj, dict) else ""
    raw_cu = cj.get("cachedUsageUtilization", {}) if isinstance(cj, dict) else {}
    cu_uuid = (raw_cu.get("accountUuid") or "") if isinstance(raw_cu, dict) else ""
    # Validate snapshot accountUuid against oauthAccount.accountUuid
    cu = raw_cu if (isinstance(raw_cu, dict) and (not acc_uuid or not cu_uuid or acc_uuid == cu_uuid)) else {}

    util = cu.get("utilization", {}) if isinstance(cu, dict) else {}
    fetched_ms = cu.get("fetchedAtMs") if isinstance(cu, dict) else None
    snap_dt = (
        datetime.fromtimestamp(fetched_ms / 1000.0, tz=timezone.utc)
        if fetched_ms
        else datetime.fromtimestamp(0, tz=timezone.utc)
    )
    mult = tier_multiplier(plan_str)
    default_usd_per_pct_7d = (PRO_WEEKLY_COST_USD * mult) / 100.0
    default_usd_per_pct_5h = (PRO_5H_COST_USD * mult) / 100.0
    usd_per_pct_7d = default_usd_per_pct_7d
    usd_per_pct_5h = default_usd_per_pct_5h

    w7 = util.get("seven_day") or {}
    raw_7d_used = observed_percentage(w7.get("utilization"))
    reset_7d_dt = parse_reset_dt(w7.get("resets_at"))

    w5 = util.get("five_hour") or {}
    raw_5h_used = observed_percentage(w5.get("utilization"))
    reset_5h_dt = parse_reset_dt(w5.get("resets_at"))

    # Adaptive per-account window rate calibration from official snapshot + pre-snapshot slices
    if raw_7d_used is not None and reset_7d_dt is not None and fetched_ms and raw_7d_used >= 15.0:
        snap_w7_start = reset_7d_dt - timedelta(days=7)
        cost_before_snap_7d = sum(
            c for dt, c in slices if snap_w7_start <= dt <= snap_dt + timedelta(seconds=5)
        )
        if cost_before_snap_7d >= 5.0 * mult:
            emp_7d = cost_before_snap_7d / raw_7d_used
            if 0.70 * default_usd_per_pct_7d <= emp_7d <= 1.40 * default_usd_per_pct_7d:
                usd_per_pct_7d = emp_7d

    if raw_5h_used is not None and reset_5h_dt is not None and fetched_ms and raw_5h_used >= 15.0:
        snap_w5_start = reset_5h_dt - timedelta(hours=5)
        cost_before_snap_5h = sum(
            c for dt, c in slices if snap_w5_start <= dt <= snap_dt + timedelta(seconds=5)
        )
        if cost_before_snap_5h >= 1.5 * mult:
            emp_5h = cost_before_snap_5h / raw_5h_used
            if 0.70 * default_usd_per_pct_5h <= emp_5h <= 1.40 * default_usd_per_pct_5h:
                usd_per_pct_5h = emp_5h

    # --- 7-day weekly window (with automatic multi-week rollover) ---
    if raw_7d_used is not None and reset_7d_dt and now_utc >= reset_7d_dt:
        while now_utc >= reset_7d_dt:
            reset_7d_dt += timedelta(days=7)
        cycle_start_7d = reset_7d_dt - timedelta(days=7)
        if active_since_dt is not None and active_since_dt > cycle_start_7d:
            cycle_start_7d = active_since_dt
        cost_in_cycle = sum(c for dt, c in slices if dt >= cycle_start_7d)
        used_7d = min(100, int(round(cost_in_cycle / usd_per_pct_7d)))
        rem_7d = max(0, 100 - used_7d)
        diff_7d = (reset_7d_dt - now_utc).total_seconds()
        local_7d = reset_7d_dt.astimezone().strftime("%m-%d %H:%M")
        if used_7d == 0:
            note_7d = f"🟢 已满血重置 | {format_duration(diff_7d)} ({local_7d})"
        else:
            note_7d = f"{format_duration(diff_7d)} ({local_7d}) [新周期实时流 ${cost_in_cycle:.2f}]"
    elif raw_7d_used is not None and reset_7d_dt:
        win_start_7d = reset_7d_dt - timedelta(days=7)
        if active_since_dt is not None and active_since_dt > win_start_7d:
            win_start_7d = active_since_dt
        cost_after_snap = sum(
            c for dt, c in slices if dt > snap_dt + timedelta(seconds=5) and dt >= win_start_7d
        )
        extra_7d_pct = (cost_after_snap / usd_per_pct_7d) if usd_per_pct_7d > 0 else 0.0
        used_7d = min(100, int(round(raw_7d_used + extra_7d_pct)))
        rem_7d = max(0, 100 - used_7d)
        diff_7d = (reset_7d_dt - now_utc).total_seconds()
        local_7d = reset_7d_dt.astimezone().strftime("%m-%d %H:%M")
        note_7d = f"{format_duration(diff_7d)} ({local_7d})"
        if cost_after_snap >= 0.15:
            note_7d += f" [实时会话流 +${cost_after_snap:.2f} ≈ +{max(1, int(round(extra_7d_pct)))}%]"
    else:
        win_start_7d = now_utc - timedelta(days=7)
        if active_since_dt is not None and active_since_dt > win_start_7d:
            win_start_7d = active_since_dt
        cost_7d = sum(c for dt, c in slices if dt >= win_start_7d)
        used_7d = min(100, int(round(cost_7d / usd_per_pct_7d)))
        rem_7d = max(0, 100 - used_7d)
        note_7d = f"按近7天会话流实时推算 (${cost_7d:.2f})"

    # --- 5-hour session block window (with automatic discrete block chaining) ---
    eff_reset_5h_dt = reset_5h_dt
    if raw_5h_used is None or reset_5h_dt is None or now_utc >= reset_5h_dt:
        after_dt = reset_5h_dt if reset_5h_dt is not None else (now_utc - timedelta(days=7))
        if active_since_dt is not None and active_since_dt > after_dt:
            after_dt = active_since_dt
        block_cost, active_block_end = walk_5h_blocks(slices, after_dt, now_utc)
        eff_reset_5h_dt = active_block_end
        used_5h = min(100, int(round(block_cost / usd_per_pct_5h)))
        rem_5h = max(0, 100 - used_5h)
        if active_block_end is not None:
            diff_5h = (active_block_end - now_utc).total_seconds()
            local_5h = active_block_end.astimezone().strftime("%H:%M")
            note_5h = f"{format_duration(diff_5h)} ({local_5h}) [实时会话流 ${block_cost:.2f}]"
        else:
            note_5h = "🟢 5h 窗口已重置 (发消息即开启新 5h 周期)"
    else:
        win_start_5h = reset_5h_dt - timedelta(hours=5)
        floor_dt = max(snap_dt + timedelta(seconds=5), win_start_5h)
        cost_after_snap_5h = sum(
            c
            for dt, c in slices
            if dt > floor_dt
            and (active_since_dt is None or dt >= active_since_dt)
            and (now_utc - dt).total_seconds() <= 5 * 3600
        )
        extra_5h_pct = cost_after_snap_5h / usd_per_pct_5h
        used_5h = min(100, int(round(raw_5h_used + extra_5h_pct)))
        rem_5h = max(0, 100 - used_5h)
        diff_5h = (reset_5h_dt - now_utc).total_seconds()
        local_5h = reset_5h_dt.astimezone().strftime("%H:%M")
        note_5h = f"{format_duration(diff_5h)} ({local_5h})"
        if cost_after_snap_5h >= 0.12:
            note_5h += f" [实时会话流 +${cost_after_snap_5h:.2f} ≈ +{max(1, int(round(extra_5h_pct)))}%]"

    if rem_7d == 0:
        note_5h = "⛔ 受 7d 周限额耗尽锁死 (即使 5h 重置也无法调用)"

    # --- Last 1 hour burn rate ---
    cost_last_1h = sum(
        c
        for dt, c in slices
        if 0 <= (now_utc - dt).total_seconds() <= 3600
        and (active_since_dt is None or dt >= active_since_dt)
    )
    burn_pct_5h_per_hr = (cost_last_1h / usd_per_pct_5h) if usd_per_pct_5h > 0 else 0.0

    effective_rem = min(rem_5h, rem_7d)
    fetched_str = (
        snap_dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
        if fetched_ms
        else "纯会话流推算"
    )
    if active_since_dt is not None:
        acct_dts = [dt for dt, _ in slices if dt >= active_since_dt]
        if fetched_ms:
            acct_dts.append(snap_dt)
        last_active_dt = max(acct_dts, default=None)
    else:
        last_active_dt = max([dt for dt, _ in slices] + ([latest_dt] if latest_dt else []), default=None)
    last_active_str = (
        last_active_dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
        if last_active_dt
        else fetched_str
    )

    return {
        "used_5h": used_5h,
        "rem_5h": rem_5h,
        "note_5h": note_5h,
        "reset_5h_ts": int(eff_reset_5h_dt.timestamp()) if eff_reset_5h_dt else None,
        "used_7d": used_7d,
        "rem_7d": rem_7d,
        "note_7d": note_7d,
        "reset_7d_ts": int(reset_7d_dt.timestamp()) if reset_7d_dt else None,
        "effective_rem": effective_rem,
        "burn_1h_usd": round(cost_last_1h, 2),
        "burn_5h_pct_hr": round(burn_pct_5h_per_hr, 1),
        "fetched_str": fetched_str,
        "last_active_str": last_active_str,
        "has_quota_data": bool(w5 or w7 or slices),
    }


def render_bar(remain_pct: int, width: int = 16) -> str:
    filled = int(round((remain_pct / 100.0) * width))
    filled = max(0, min(width, filled))
    return "█" * filled + "░" * (width - filled)


def format_account(
    cj: dict,
    cred: dict,
    slices: list[tuple[datetime, float]],
    latest_dt: datetime | None,
    now_utc: datetime,
    active_since_dt: datetime | None = None,
) -> dict:
    acc = cj.get("oauthAccount", {}) if isinstance(cj, dict) else {}
    oa = cred.get("claudeAiOauth", {}) if isinstance(cred, dict) else {}

    email = acc.get("emailAddress") or "未知邮箱"
    display = acc.get("displayName") or "未命名"
    org = acc.get("organizationName")
    sub_type = str(oa.get("subscriptionType") or acc.get("billingType") or "pro")
    rate_tier = str(oa.get("rateLimitTier") or "")
    if "20x" in rate_tier.lower():
        plan = "Max 20x"
    elif "5x" in rate_tier.lower():
        plan = "Max 5x"
    elif sub_type.lower() == "max":
        plan = "Max"
    elif sub_type.lower() == "pro" or "subscription" in sub_type.lower():
        plan = "Pro"
    else:
        plan = sub_type.capitalize()

    exp_ms = oa.get("expiresAt", 0)
    has_refresh = bool(oa.get("refreshToken"))
    rem_token_min = round((exp_ms - now_utc.timestamp() * 1000) / 60000.0, 1) if exp_ms else -1
    if rem_token_min > 5:
        auth_str = f"🟢 凭据有效 (余 {int(rem_token_min)} 分钟)"
        auth_status = "valid"
    elif has_refresh:
        auth_str = "🟡 待自动续期 (含 refreshToken)"
        auth_status = "refresh_needed"
    else:
        auth_str = "🔴 需重新登录"
        auth_status = "expired"

    q = evaluate_quota(cj, slices, latest_dt, plan, now_utc, active_since_dt=active_since_dt)
    candidate_anchor = clean_anchor_percentages(cj.get("cachedUsageUtilization"))
    if not isinstance(candidate_anchor, dict) or (acc.get("accountUuid") and candidate_anchor.get("accountUuid") != acc.get("accountUuid")):
        candidate_anchor = None
    window_results = {}
    for suffix, window, used_key, reset_key, span in (
        ("5h", "five_hour", "used_5h", "reset_5h_ts", timedelta(hours=5)),
        ("7d", "seven_day", "used_7d", "reset_7d_ts", timedelta(days=7)),
    ):
        raw_window = (((candidate_anchor or {}).get("utilization") or {}).get(window) or {})
        raw_reset = parse_reset_dt(raw_window.get("resets_at"))
        raw_used = observed_percentage(raw_window.get("utilization"))
        observed = window_fetched_at_ms(candidate_anchor, window) or None
        if (raw_used is not None and raw_reset is not None and raw_reset > now_utc
                and observed and q.get(used_key) is not None):
            state = (q[used_key], q[reset_key], "server_anchor", observed)
        else:
            evidence_start = max(now_utc - span, active_since_dt or (now_utc - span))
            local_evidence = active_since_dt is not None and any(
                evidence_start <= dt <= now_utc and cost > 0 for dt, cost in slices
            )
            local_reset = q.get(reset_key)
            local_reset_dt = datetime.fromtimestamp(local_reset, tz=timezone.utc) if local_reset else None
            if local_evidence and q.get(used_key) is not None and local_reset_dt and local_reset_dt > now_utc:
                observed_local = max((int(dt.timestamp() * 1000) for dt, cost in slices
                                      if evidence_start <= dt <= now_utc and cost > 0), default=None)
                state = (q[used_key], local_reset, "local_estimate", observed_local)
            else:
                state = (None, None, "unknown", observed)
                inferred = _expired_anchor_state(
                    {"server_anchor": candidate_anchor, "account_uuid": acc.get("accountUuid")},
                    suffix, window, int(now_utc.timestamp()))
                if inferred is not None:
                    state = inferred
        used, reset, source, observed = state
        q[used_key] = used
        q[f"rem_{suffix}"] = max(0, 100 - used) if used is not None else None
        q[reset_key] = reset
        if source == "reset_inferred":
            q[f"note_{suffix}"] = "预计已恢复"
        window_results[suffix] = state
    quota_source = aggregate_quota_source(window_results["5h"][2], window_results["7d"][2])
    if all(window_results[s][0] is not None for s in ("5h", "7d")):
        q["effective_rem"] = min(q["rem_5h"], q["rem_7d"])
    else:
        q["effective_rem"] = None
    if q["effective_rem"] == 0:
        avail_badge = "🔴 额度已耗尽 (不可用)"
    elif q["effective_rem"] is None:
        avail_badge = "⚪ 额度未知"
    elif q["effective_rem"] <= 20:
        avail_badge = f"🟠 额度紧张 (可用 {q['effective_rem']}%)"
    else:
        avail_badge = f"🟢 额度充足 (可用 {q['effective_rem']}%)"

    return {
        "display": display,
        "email": email,
        "organization": org,
        "account_uuid": acc.get("accountUuid"),
        "organization_uuid": acc.get("organizationUuid"),
        "quota_identity": quota_identity(acc),
        "quota_observed_at_ms": aggregate_observed_at_ms(window_results["5h"][3], window_results["7d"][3]),
        "quota_source": quota_source,
        "quota_5h_source": window_results["5h"][2],
        "quota_7d_source": window_results["7d"][2],
        "quota_5h_observed_at_ms": window_results["5h"][3],
        "quota_7d_observed_at_ms": window_results["7d"][3],
        "server_anchor": candidate_anchor,
        "plan": plan,
        "auth_status": auth_status,
        "auth_expires_at": int(exp_ms) if exp_ms else None,
        "auth_has_refresh": has_refresh,
        "auth_str": auth_str,
        "avail_badge": avail_badge,
        **q,
    }


def apply_ledger_fallback_to_account(info: dict, ledger_accounts: dict, saved_at_ms: int, now_utc: datetime) -> None:
    email_key = (info.get("email") or "").strip().lower()
    if not email_key:
        return
    entry = ledger_account(ledger_accounts, email_key, info)
    if not entry:
        return
    if not same_quota_account(info, entry):
        return
    # A legacy row with neither identity nor account/organization anchors is not
    # safe to apply merely because its email matches.
    anchor = entry.get("server_anchor") if isinstance(entry.get("server_anchor"), dict) else {}
    if not entry.get("quota_identity") and not (entry.get("account_uuid") or anchor.get("accountUuid")):
        return

    now_sec = int(now_utc.timestamp())
    suffixes = [suffix for suffix, _ in QUOTA_WINDOWS]
    current_states = [info_window_state(info, suffix, window, now_sec) for suffix, window in QUOTA_WINDOWS]
    candidate_states = [entry_window_state(entry, suffix, window, now_sec) for suffix, window in QUOTA_WINDOWS]
    merged_states = merge_window_states(current_states, candidate_states, now_sec)
    merged = {}
    for (suffix, _), state in zip(QUOTA_WINDOWS, merged_states):
        used, reset, source, observed = state
        merged[suffix] = (used, reset, source, observed)
        info[f"used_{suffix}"] = used
        info[f"reset_{suffix}_ts"] = reset
        info[f"quota_{suffix}_source"] = source
        info[f"quota_{suffix}_observed_at_ms"] = observed
        info[f"rem_{suffix}"] = max(0, 100 - used) if used is not None else None
        if used is None:
            info[f"note_{suffix}"] = "额度未知"
        elif source == "reset_inferred":
            info[f"note_{suffix}"] = "预计已恢复"
        else:
            reset_dt = datetime.fromtimestamp(reset, tz=timezone.utc)
            diff = (reset_dt - now_utc).total_seconds()
            local = reset_dt.astimezone().strftime("%m-%d %H:%M" if suffix == "7d" else "%H:%M")
            info[f"note_{suffix}"] = f"{format_duration(diff)} ({local})"

    info["quota_source"] = aggregate_quota_source(merged["5h"][2], merged["7d"][2])
    info["quota_observed_at_ms"] = aggregate_observed_at_ms(merged["5h"][3], merged["7d"][3])
    # The server anchor is a cache of per-window evidence; retain the ledger's
    # merged copy so an unobserved window is not lost on the next write.
    if entry.get("server_anchor"):
        info["server_anchor"] = entry["server_anchor"]
    if all(merged[s][0] is not None for s in ("5h", "7d")):
        info["effective_rem"] = min(info["rem_5h"], info["rem_7d"])
        if info["effective_rem"] == 0:
            info["avail_badge"] = "🔴 额度已耗尽 (不可用)"
        elif info["effective_rem"] <= 20:
            info["avail_badge"] = f"🟠 额度紧张 (可用 {info['effective_rem']}%)"
        else:
            info["avail_badge"] = f"🟢 额度充足 (可用 {info['effective_rem']}%)"
    else:
        info["effective_rem"] = None
        info["avail_badge"] = "⚪ 额度未知"


def load_ledger(app_dir: str) -> dict:
    ledger_path = os.path.join(app_dir, "quota_ledger.json")
    if os.path.isfile(ledger_path):
        try:
            with open(ledger_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("accounts"), dict):
                return data
        except Exception:
            pass
    return {"accounts": {}}


@contextmanager
def ledger_writer_lock(app_dir: str):
    """Serialize statusLine/CLI writers without locking Claude's own files."""
    with open(os.path.join(app_dir, ".quota-writer.lock"), "a+b") as lock:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        acquired = False
        for _ in range(50):
            lock.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                time.sleep(0.01)
        if not acquired:
            raise TimeoutError("quota ledger writer busy")
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def save_ledger_and_sync_sqlite(app_dir: str, vault_dir: str, accounts_out: list[dict], now_utc: datetime) -> None:
    # A missing local directory is the migration/staging window: never recreate it
    # or fall back to the official application's data root.
    if not os.path.isdir(app_dir):
        return
    try:
        with ledger_writer_lock(app_dir):
            _save_ledger_and_sync_sqlite(app_dir, vault_dir, accounts_out, now_utc)
    except (OSError, TimeoutError, QuotaCoreError):
        return


def anchor_fetched_at_ms(anchor) -> int:
    value = anchor.get("fetchedAtMs") if isinstance(anchor, dict) else None
    return int(value) if isinstance(value, (int, float)) and value > 0 else 0


def _save_ledger_and_sync_sqlite(app_dir: str, vault_dir: str, accounts_out: list[dict], now_utc: datetime) -> None:
    now_sec = int(now_utc.timestamp())
    ledger = load_ledger(app_dir)
    accs = ledger.setdefault("accounts", {})
    accepted_accounts = []
    for item in accounts_out:
        if item.get("role") not in ("current", "saved"):
            continue
        email = (item.get("email") or "").strip()
        if not email or "@" not in email:
            continue
        key = email.lower()
        prev_entry = accs.get(key) if isinstance(accs.get(key), dict) else {}
        if prev_entry and not same_quota_account(item, prev_entry):
            # Preserve the legacy/other-organization slot; a new observation gets
            # its own provenance-qualified slot without changing archive/HMAC IDs.
            if not item.get("quota_identity"):
                continue
            key += "#" + item["quota_identity"]
            prev_entry = accs.get(key) or {}
        prev_anchor = clean_anchor_percentages(prev_entry.get("server_anchor"))
        incoming_anchor = clean_anchor_percentages(item.get("server_anchor"))
        incoming_ms = anchor_fetched_at_ms(incoming_anchor)
        # Inputs are computed before acquiring this lock. Each window is merged
        # by its own observed time below, so a partial/older anchor cannot erase
        # another window's newer observation.
        if not incoming_anchor and int(prev_entry.get("updated_at_sec") or 0) > now_sec:
            continue
        item = dict(item)
        observed = item.get("server_anchor_observed_windows")
        if (isinstance(incoming_anchor, dict) and isinstance(prev_anchor, dict)
                and incoming_anchor.get("accountUuid")
                and incoming_anchor.get("accountUuid") == prev_anchor.get("accountUuid")
                ):
            utilization = dict(incoming_anchor.get("utilization") or {})
            previous_utilization = prev_anchor.get("utilization") or {}
            baseline_ms = int(item.get("server_anchor_base_fetched_at_ms") or 0)
            for window, suffix in (("five_hour", "5h"), ("seven_day", "7d")):
                previous_window_ms = window_fetched_at_ms(prev_anchor, window)
                incoming_window_ms = window_fetched_at_ms(incoming_anchor, window)
                stale_window = previous_window_ms > 0 and incoming_window_ms > 0 and incoming_window_ms < previous_window_ms
                window_observed = window in observed if isinstance(observed, list) else True
                if ((not window_observed or stale_window) and window in previous_utilization
                        and (window not in utilization or stale_window or anchor_fetched_at_ms(prev_anchor) > baseline_ms)):
                    previous_window = dict(previous_utilization[window])
                    previous_window.setdefault("fetchedAtMs", previous_window_ms or anchor_fetched_at_ms(prev_anchor))
                    utilization[window] = previous_window
                    old_used, old_reset, old_source, old_observed = entry_window_state(prev_entry, suffix, window, now_sec)
                    item[f"used_{suffix}"] = old_used
                    item[f"reset_{suffix}_ts"] = old_reset
                    item[f"quota_{suffix}_source"] = old_source
                    item[f"quota_{suffix}_observed_at_ms"] = old_observed
            merged_anchor_ms = max(anchor_fetched_at_ms(incoming_anchor), anchor_fetched_at_ms(prev_anchor))
            if not isinstance(observed, list) and anchor_fetched_at_ms(prev_anchor) > anchor_fetched_at_ms(incoming_anchor):
                incoming_anchor = prev_anchor
            else:
                incoming_anchor = {**incoming_anchor, "fetchedAtMs": merged_anchor_ms, "utilization": utilization}
        current_states = [entry_window_state(prev_entry, suffix, window, now_sec) for suffix, window in QUOTA_WINDOWS]
        incoming_states = [info_window_state(item, suffix, window, now_sec) for suffix, window in QUOTA_WINDOWS]
        merged_values = merge_window_states(current_states, incoming_states, now_sec)
        merged_states = {suffix: state for (suffix, _), state in zip(QUOTA_WINDOWS, merged_values)}
        for suffix, _ in QUOTA_WINDOWS:
            used, reset, source, observed_at = merged_states[suffix]
            item[f"used_{suffix}"] = used
            item[f"reset_{suffix}_ts"] = reset
            item[f"quota_{suffix}_source"] = source
            item[f"quota_{suffix}_observed_at_ms"] = observed_at
        item["quota_source"] = aggregate_quota_source(merged_states["5h"][2], merged_states["7d"][2])
        item["quota_observed_at_ms"] = aggregate_observed_at_ms(merged_states["5h"][3], merged_states["7d"][3])
        item["server_anchor"] = incoming_anchor
        accepted_accounts.append(item)
        accs[key] = {
            "email": email,
            "display_name": item.get("display"),
            "organization": item.get("organization"),
            "account_uuid": item.get("account_uuid") or prev_entry.get("account_uuid"),
            "organization_uuid": item.get("organization_uuid") or prev_entry.get("organization_uuid"),
            "quota_identity": item.get("quota_identity") or prev_entry.get("quota_identity"),
            "quota_observed_at_ms": item.get("quota_observed_at_ms"),
            "quota_source": item.get("quota_source") or "unknown",
            "quota_5h_source": item.get("quota_5h_source") or "unknown",
            "quota_7d_source": item.get("quota_7d_source") or "unknown",
            "quota_5h_observed_at_ms": item.get("quota_5h_observed_at_ms"),
            "quota_7d_observed_at_ms": item.get("quota_7d_observed_at_ms"),
            "plan": item.get("plan"),
            "auth_status": item.get("auth_status"),
            "quota_5h_used": item.get("used_5h"),
            "quota_5h_reset_at": item.get("reset_5h_ts"),
            "quota_7d_used": item.get("used_7d"),
            "quota_7d_reset_at": item.get("reset_7d_ts"),
            "updated_at_sec": now_sec,
            **(
                {"server_anchor": item.get("server_anchor") or prev_anchor}
                if (item.get("server_anchor") or prev_anchor)
                else {}
            ),
        }
    if not accepted_accounts:
        return
    ledger_path = os.path.join(app_dir, "quota_ledger.json")
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=app_dir,
                                         prefix=".quota-", suffix=".tmp", delete=False) as f:
            temporary_path = f.name
            json.dump(ledger, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary_path, ledger_path)
        temporary_path = None
    finally:
        if temporary_path and os.path.isfile(temporary_path):
            os.unlink(temporary_path)

    db_path = os.path.join(vault_dir, "identities.sqlite")
    if not os.path.isfile(db_path):
        return
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        cur = conn.cursor()
        # Prune orphan rows not matching any non-empty identity record
        cur.execute("DELETE FROM identity_summaries WHERE id NOT IN (SELECT id FROM identities WHERE empty = 0)")
        rows = cur.execute("SELECT id, name FROM identities WHERE empty = 0").fetchall()
        existing_sums = {}
        for sid, sjson in cur.execute("SELECT id, summary FROM identity_summaries").fetchall():
            try:
                existing_sums[sid] = json.loads(sjson)
            except Exception:
                existing_sums[sid] = {}

        by_email = {
            (a.get("email") or "").lower(): a
            for a in accepted_accounts
            if a.get("role") in ("current", "saved") and a.get("email")
        }
        by_identity = {a.get("quota_identity"): a for a in accepted_accounts if a.get("quota_identity")}
        for ident_id, ident_name in rows:
            prev = existing_sums.get(ident_id) or {}
            email_lower = (prev.get("email") or "").lower()
            matched = by_identity.get(prev.get("quota_identity")) or by_email.get(email_lower)
            if not matched:
                for a in accepted_accounts:
                    if a.get("id") == ident_id:
                        matched = a
                        break
            if not matched:
                continue
            if prev.get("quota_identity") and matched.get("quota_identity") != prev["quota_identity"]:
                continue
            new_sum = {
                "display_name": matched.get("display") or prev.get("display_name"),
                "email": matched.get("email") or prev.get("email"),
                "organization": matched.get("organization") or prev.get("organization"),
                "plan": matched.get("plan") or prev.get("plan") or "Pro",
                "auth_status": matched.get("auth_status") or prev.get("auth_status"),
                "quota_5h_used": matched.get("used_5h"),
                "quota_5h_reset_at": matched.get("reset_5h_ts"),
                "quota_7d_used": matched.get("used_7d"),
                "quota_7d_reset_at": matched.get("reset_7d_ts"),
                "quota_checked": True,
                "quota_version": CURRENT_QUOTA_VERSION,
                "quota_identity": matched.get("quota_identity") or prev.get("quota_identity"),
                "quota_observed_at_ms": matched.get("quota_observed_at_ms") or prev.get("quota_observed_at_ms"),
                "quota_source": matched.get("quota_source") or "unknown",
                "quota_5h_source": matched.get("quota_5h_source") or "unknown",
                "quota_7d_source": matched.get("quota_7d_source") or "unknown",
                "quota_5h_observed_at_ms": matched.get("quota_5h_observed_at_ms") or prev.get("quota_5h_observed_at_ms"),
                "quota_7d_observed_at_ms": matched.get("quota_7d_observed_at_ms") or prev.get("quota_7d_observed_at_ms"),
                "auth_expires_at": matched.get("auth_expires_at") or prev.get("auth_expires_at"),
                "auth_has_refresh": (
                    matched.get("auth_has_refresh")
                    if matched.get("auth_has_refresh") is not None
                    else prev.get("auth_has_refresh")
                ),
            }
            if prev.get("proxy"):
                new_sum["proxy"] = prev["proxy"]
            # Remove None values to match Rust skip_serializing_if = Option::is_none
            clean_sum = {k: v for k, v in new_sum.items() if v is not None}
            cur.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?1, ?2) "
                "ON CONFLICT(id) DO UPDATE SET summary = excluded.summary",
                (ident_id, json.dumps(clean_sum, ensure_ascii=False)),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass


def handle_statusline() -> None:
    """
    Passive statusLine hook invoked by Claude Code 2.1.x after every turn and at resets_at boundaries.
    Harvests exact server-side rate_limits (from anthropic-ratelimit-unified-* HTTP headers),
    persists them only to the local-edition quota_ledger.json + identities.sqlite, and prints status bar.
    """
    raw_stdin = ""
    try:
        if not sys.stdin.isatty():
            raw_stdin = sys.stdin.read()
    except Exception:
        pass
    payload = {}
    if raw_stdin.strip():
        try:
            payload = json.loads(raw_stdin)
        except Exception:
            payload = {}

    now_utc = datetime.now(timezone.utc)
    now_sec = int(now_utc.timestamp())
    home = os.path.expandvars(r"%USERPROFILE%")
    default_claude_dir = os.path.normcase(os.path.abspath(os.path.join(home, ".claude")))
    env_claude_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    is_isolated_relay = bool(
        env_claude_dir and os.path.normcase(os.path.abspath(env_claude_dir)) != default_claude_dir
    )

    model_obj = payload.get("model") or {}
    model_name = model_obj.get("display_name") or model_obj.get("id") or "Claude"
    ctx_obj = payload.get("context_window") or {}
    ctx_pct = ctx_obj.get("used_percentage")
    cost_obj = payload.get("cost") or {}
    sess_cost = cost_obj.get("total_cost_usd")
    rl = payload.get("rate_limits")
    rl = rl if isinstance(rl, dict) else {}
    rl_5h = rl.get("five_hour")
    rl_7d = rl.get("seven_day")
    rl_5h = dict(rl_5h) if isinstance(rl_5h, dict) else {}
    rl_7d = dict(rl_7d) if isinstance(rl_7d, dict) else {}
    rl_5h["used_percentage"] = observed_percentage(rl_5h.get("used_percentage"))
    rl_7d["used_percentage"] = observed_percentage(rl_7d.get("used_percentage"))

    if is_isolated_relay:
        parts = [f"🔗 Relay │ {model_name}"]
        if ctx_pct is not None:
            parts.append(f"Ctx {int(round(float(ctx_pct)))}%")
        if sess_cost is not None:
            parts.append(f"${float(sess_cost):.2f}")
        print(" │ ".join(parts))
        return

    live_cj_path = os.path.join(home, ".claude.json")
    live_cj = {}
    if os.path.isfile(live_cj_path):
        try:
            with open(live_cj_path, "r", encoding="utf-8") as f:
                live_cj = json.load(f)
        except Exception:
            live_cj = {}

    acc = (live_cj.get("oauthAccount") or {}) if isinstance(live_cj, dict) else {}
    acct_name = acc.get("displayName") or (acc.get("emailAddress") or "Claude").split("@")[0]
    acct_uuid = acc.get("accountUuid")

    has_live_rl = (rl_5h.get("used_percentage") is not None) or (rl_7d.get("used_percentage") is not None)
    server_anchor = None
    app_dir = os.path.expandvars(r"%APPDATA%\ai.local.claude-local")
    vault_dir = os.path.join(app_dir, "identity-vault")
    ledger = load_ledger(app_dir)
    email = (acc.get("emailAddress") or "").strip()
    account_info = {"quota_identity": quota_identity(acc), "account_uuid": acct_uuid,
        "organization_uuid": acc.get("organizationUuid"), "organization": acc.get("organizationName")}
    account_entry = ledger_account(ledger.get("accounts", {}), email, account_info)
    anchor_base_ms = 0
    observed_windows = []
    now_ms = int(now_utc.timestamp() * 1000)

    # Build server_anchor in memory only (NEVER modify ~/.claude.json; persist only to quota_ledger.json)
    if has_live_rl and isinstance(live_cj, dict):
        cu = clean_anchor_percentages(live_cj.get("cachedUsageUtilization"))
        if not isinstance(cu, dict) or (acct_uuid and cu.get("accountUuid") not in (None, "", acct_uuid)):
            cu = {}
        previous_anchor = clean_anchor_percentages(account_entry.get("server_anchor"))
        account_matches = same_quota_account(account_info, account_entry)
        if (account_matches and acct_uuid and isinstance(previous_anchor, dict)
                and previous_anchor.get("accountUuid") == acct_uuid
                and anchor_fetched_at_ms(previous_anchor) > anchor_fetched_at_ms(cu)):
            cu = previous_anchor
        anchor_base_ms = anchor_fetched_at_ms(cu)
        util = dict(cu.get("utilization")) if isinstance(cu.get("utilization"), dict) else {}

        if rl_5h.get("used_percentage") is not None:
            observed_windows.append("five_hour")
            r5_ts = rl_5h.get("resets_at")
            r5_iso = (
                datetime.fromtimestamp(int(r5_ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if r5_ts
                else (util.get("five_hour") or {}).get("resets_at")
            )
            util["five_hour"] = {
                **(util.get("five_hour") if isinstance(util.get("five_hour"), dict) else {}),
                "utilization": round(float(rl_5h["used_percentage"]), 1),
                "resets_at": r5_iso,
                "fetchedAtMs": now_ms,
            }
        if rl_7d.get("used_percentage") is not None:
            observed_windows.append("seven_day")
            r7_ts = rl_7d.get("resets_at")
            r7_iso = (
                datetime.fromtimestamp(int(r7_ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if r7_ts
                else (util.get("seven_day") or {}).get("resets_at")
            )
            util["seven_day"] = {
                **(util.get("seven_day") if isinstance(util.get("seven_day"), dict) else {}),
                "utilization": round(float(rl_7d["used_percentage"]), 1),
                "resets_at": r7_iso,
                "fetchedAtMs": now_ms,
            }

        server_anchor = {
            "fetchedAtMs": now_ms,
            **({"accountUuid": acct_uuid} if acct_uuid else {}),
            "utilization": util,
        }

    u5_val = rl_5h.get("used_percentage")
    r5_val = rl_5h.get("resets_at")
    u7_val = rl_7d.get("used_percentage")
    r7_val = rl_7d.get("resets_at")

    if u5_val is None or u7_val is None:
        if account_entry and same_quota_account(account_info, account_entry):
            le = account_entry
            if u5_val is None:
                old_used, old_reset, old_source, _ = entry_window_state(le, "5h", "five_hour")
                if old_source != "unknown":
                    u5_val, r5_val = old_used, old_reset
            if u7_val is None:
                old_used, old_reset, old_source, _ = entry_window_state(le, "7d", "seven_day")
                if old_source != "unknown":
                    u7_val, r7_val = old_used, old_reset
        cu_util = (((server_anchor or live_cj.get("cachedUsageUtilization")) or {}).get("utilization") or {})
        if u5_val is None and isinstance(cu_util.get("five_hour"), dict):
            u5_val = cu_util["five_hour"].get("utilization")
            r5_dt = parse_reset_dt(cu_util["five_hour"].get("resets_at"))
            r5_val = int(r5_dt.timestamp()) if r5_dt else None
        if u7_val is None and isinstance(cu_util.get("seven_day"), dict):
            u7_val = cu_util["seven_day"].get("utilization")
            r7_dt = parse_reset_dt(cu_util["seven_day"].get("resets_at"))
            r7_val = int(r7_dt.timestamp()) if r7_dt else None

    u5_val = observed_percentage(u5_val)
    u7_val = observed_percentage(u7_val)
    used5 = int(round(u5_val)) if u5_val is not None else None
    used7 = int(round(u7_val)) if u7_val is not None else None
    r5_int = int(r5_val) if r5_val else None
    r7_int = int(r7_val) if r7_val else None
    if r7_int and now_sec >= r7_int:
        used7, r7_int = None, None
    if r5_int and now_sec >= r5_int:
        used5, r5_int = None, None

    def status_window_provenance(suffix: str, window: str, used, reset):
        if used is None or reset is None:
            return "unknown", None
        if window in observed_windows:
            return "server_anchor", window_fetched_at_ms(server_anchor, window) or now_ms
        old = entry_window_state(account_entry, suffix, window) if account_entry else (None, None, "unknown", None)
        if old[0] is not None and old[1] == reset and old[2] != "unknown":
            return old[2], old[3]
        cached = (((server_anchor or live_cj.get("cachedUsageUtilization") or {}).get("utilization") or {}).get(window) or {})
        cached_reset = parse_reset_dt(cached.get("resets_at"))
        cached_used = cached.get("utilization")
        cached_at = window_fetched_at_ms(server_anchor or live_cj.get("cachedUsageUtilization"), window)
        if cached_used is not None and cached_reset and int(cached_reset.timestamp()) == reset and cached_at:
            return "server_anchor", cached_at
        return "unknown", None

    source5, observed5 = status_window_provenance("5h", "five_hour", used5, r5_int)
    source7, observed7 = status_window_provenance("7d", "seven_day", used7, r7_int)

    if has_live_rl and email and (used5 is not None or used7 is not None):
        save_ledger_and_sync_sqlite(
            app_dir,
            vault_dir,
            [
                {
                    "role": "current",
                    "display": acct_name,
                    "email": email,
                    "organization": acc.get("organizationName"),
                    "account_uuid": acct_uuid,
                    "organization_uuid": acc.get("organizationUuid"),
                    "quota_identity": quota_identity(acc),
                    "quota_source": aggregate_quota_source(source5, source7),
                    "quota_5h_source": source5,
                    "quota_7d_source": source7,
                    "quota_5h_observed_at_ms": observed5,
                    "quota_7d_observed_at_ms": observed7,
                    "plan": "Pro",
                    "auth_status": "valid",
                    "used_5h": used5,
                    "rem_5h": max(0, 100 - used5) if used5 is not None else None,
                    "reset_5h_ts": r5_int,
                    "used_7d": used7,
                    "rem_7d": max(0, 100 - used7) if used7 is not None else None,
                    "reset_7d_ts": r7_int,
                    "server_anchor": server_anchor,
                    "server_anchor_observed_windows": observed_windows,
                    "server_anchor_base_fetched_at_ms": anchor_base_ms,
                }
            ],
            now_utc,
        )

    m_part = model_name
    if ctx_pct is not None:
        m_part += f" (Ctx {int(round(float(ctx_pct)))}%)"
    parts = [m_part]

    curr_rem7 = max(0, 100 - used7) if used7 is not None else None
    curr_rem5 = (0 if curr_rem7 == 0 else max(0, 100 - used5)) if used5 is not None else None
    if curr_rem5 is not None and curr_rem7 is not None:
        curr_eff = min(curr_rem5, curr_rem7)
    else:
        curr_eff = None

    # Resolve saved identity custom names from identities.sqlite when available
    saved_name_by_email = {}
    db_path = os.path.join(vault_dir, "identities.sqlite")
    if os.path.isfile(db_path):
        try:
            conn = sqlite3.connect(db_path, timeout=1.5)
            rows = conn.execute(
                "SELECT i.name, s.summary FROM identities i "
                "JOIN identity_summaries s ON i.id = s.id WHERE i.empty = 0"
            ).fetchall()
            conn.close()
            for ident_name, sjson in rows:
                try:
                    sobj = json.loads(sjson)
                    semail = (sobj.get("email") or "").strip().lower()
                    if semail and ident_name:
                        saved_name_by_email[semail] = str(ident_name)
                except Exception:
                    pass
        except Exception:
            pass

    # Show only other (non-active) accounts from quota_ledger.json in a compact format
    peer_parts = []
    best_peer = None  # (tier_consume_first, -r7, p_eff, p_rem7, p_rem5, p_name)
    for k_email, le in ledger.get("accounts", {}).items():
        k_lower = k_email.strip().lower()
        if email and k_lower == email.lower():
            continue
        le_anchor = le.get("server_anchor") if isinstance(le.get("server_anchor"), dict) else {}
        if acct_uuid and le_anchor.get("accountUuid") == acct_uuid:
            continue
        if saved_name_by_email and k_lower not in saved_name_by_email:
            continue
        p_name = saved_name_by_email.get(k_lower) or le.get("display_name") or k_email.split("@")[0]
        p_u5, p_r5, p_s5, _ = entry_window_state(le, "5h", "five_hour")
        p_u7, p_r7, p_s7, _ = entry_window_state(le, "7d", "seven_day")
        if (p_s5 == "unknown" or p_s7 == "unknown" or p_u5 is None or p_u7 is None
                or p_r5 is None or p_r7 is None or p_r5 <= now_sec or p_r7 <= now_sec):
            continue
        p_u5_i, p_u7_i = int(p_u5), int(p_u7)
        p_r5_i, p_r7_i = int(p_r5), int(p_r7)
        p_rem7 = max(0, 100 - p_u7_i)
        p_rem5 = 0 if p_rem7 == 0 else max(0, 100 - p_u5_i)
        p_eff = min(p_rem5, p_rem7)
        if le.get("auth_status") != "expired" and p_eff > 0:
            cand_key = (
                1 if (p_rem5 >= 50 and p_r7_i and p_r7_i > now_sec) else 0,
                -(p_r7_i or (now_sec + 30 * 86400)) if p_rem5 >= 50 else 0,
                p_eff,
                p_rem7,
                p_rem5,
                p_name,
            )
            if best_peer is None or cand_key > best_peer:
                best_peer = cand_key
        p_bottleneck_r = p_r7_i if p_rem7 <= p_rem5 else (p_r5_i or p_r7_i)
        if p_bottleneck_r and p_bottleneck_r > now_sec and p_eff < 100:
            p_eta = format_compact_eta(p_bottleneck_r - now_sec)
            peer_parts.append(f"{p_name}:{p_eff}%({p_eta})")
        else:
            peer_parts.append(f"{p_name}:{p_eff}%")
    if peer_parts:
        parts.append(" · ".join(peer_parts))

    if curr_eff is not None and curr_eff <= 15 and best_peer is not None and best_peer[2] >= 30:
        bp_eff = best_peer[2]
        bp_name = best_peer[5]
        if curr_eff <= 0:
            parts.append(f"🚨 额度耗尽→切[{bp_name}:{bp_eff}%]后 /resume")
        else:
            parts.append(f"⚠️ 仅余{curr_eff}%→可切[{bp_name}:{bp_eff}%]")

    print(" │ ".join(parts))


def select_best_relay_candidate(valid_accounts: list[dict], now_sec: int, hysteresis_pct: int = 10) -> dict:
    """
    Multi-account quota relay selector combining:
    1. Consume-first 7d reset awareness: among healthy candidates (rem_5h >= 50% and within 15% of max_eff),
       prioritize the account whose 7d weekly quota resets sooner so expiring weekly budget is used first.
    2. Hysteresis (default 10% when current effective_rem > 20%, 0% when <= 20%): avoids noisy ping-pong
       recommendations when accounts have similar remaining quota.
    3. Fastest-reset recovery forecast when all accounts are exhausted.
    """
    curr = next((a for a in valid_accounts if a.get("role") == "current"), None)
    saved_ready = [
        a
        for a in valid_accounts
        if a.get("role") == "saved"
        and a.get("auth_status") != "expired"
        and all(a.get(f"quota_{suffix}_source") != "reset_inferred" for suffix, _ in QUOTA_WINDOWS)
        and int(a.get("effective_rem") or 0) > 0
    ]

    max_saved_eff = max((int(a.get("effective_rem") or 0) for a in saved_ready), default=0)

    def candidate_sort_key(a: dict) -> tuple:
        eff = int(a.get("effective_rem") or 0)
        rem5 = int(a.get("rem_5h") or 0)
        rem7 = int(a.get("rem_7d") or 0)
        r7 = a.get("reset_7d_ts")
        r7_int = int(r7) if r7 and int(r7) > now_sec else None
        in_consume_first_tier = (
            rem5 >= 50 and (max_saved_eff - eff) <= 15 and r7_int is not None
        )
        return (
            1 if in_consume_first_tier else 0,
            -r7_int if in_consume_first_tier and r7_int else 0,
            eff,
            rem7,
            rem5,
        )

    best_saved = max(saved_ready, key=candidate_sort_key) if saved_ready else None
    curr_ready = (
        curr is not None
        and curr.get("auth_status") != "expired"
        and int(curr.get("effective_rem") or 0) > 0
    )
    curr_eff = int(curr.get("effective_rem") or 0) if curr_ready else 0

    if best_saved is not None:
        bs_eff = int(best_saved.get("effective_rem") or 0)
        bs_r7 = best_saved.get("reset_7d_ts")
        curr_r7 = curr.get("reset_7d_ts") if curr else None
        consume_first_urgent = (
            curr_ready
            and int(best_saved.get("rem_5h") or 0) >= 60
            and bs_eff >= curr_eff - 5
            and bs_r7
            and curr_r7
            and int(bs_r7) > now_sec
            and (int(curr_r7) - int(bs_r7)) >= 24 * 3600
        )
        threshold = 0 if curr_eff <= 20 else hysteresis_pct
        if not curr_ready or bs_eff >= curr_eff + threshold or consume_first_urgent:
            reason = (
                "consume_first_7d"
                if (consume_first_urgent or (bs_r7 and int(best_saved.get("rem_5h") or 0) >= 50 and max_saved_eff - bs_eff <= 15))
                else "higher_headroom"
            )
            return {
                "action": "switch",
                "target": best_saved.get("name"),
                "target_id": best_saved.get("id"),
                "target_effective_rem": bs_eff,
                "current_effective_rem": curr_eff,
                "reason": reason,
            }

    if curr_ready:
        return {
            "action": "stay",
            "target": curr.get("name"),
            "target_effective_rem": curr_eff,
            "current_effective_rem": curr_eff,
            "reason": "current_optimal",
        }

    # All accounts exhausted: find the account whose bottleneck window resets earliest
    fastest_acc = None
    fastest_reset_ts = None
    for a in valid_accounts:
        rem7 = int(a.get("rem_7d") or 0)
        rem5 = int(a.get("rem_5h") or 0)
        r7 = a.get("reset_7d_ts")
        r5 = a.get("reset_5h_ts")
        bottleneck_ts = r7 if rem7 <= rem5 else (r5 or r7)
        if bottleneck_ts and int(bottleneck_ts) > now_sec:
            bts = int(bottleneck_ts)
            if fastest_reset_ts is None or bts < fastest_reset_ts:
                fastest_reset_ts = bts
                fastest_acc = a

    return {
        "action": "wait",
        "target": fastest_acc.get("name") if fastest_acc else None,
        "fastest_reset_ts": fastest_reset_ts,
        "fastest_reset_eta_sec": (fastest_reset_ts - now_sec) if fastest_reset_ts else None,
        "reason": "all_exhausted",
    }


def is_pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        kernel32.CloseHandle(handle)
        return bool(ok and exit_code.value == 259)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def detect_active_sessions(home: str) -> list[dict]:
    sess_dir = os.path.join(home, ".claude", "sessions")
    if not os.path.isdir(sess_dir):
        return []
    out = []
    for fn in os.listdir(sess_dir):
        if not fn.endswith(".json"):
            continue
        pid_str = fn[:-5]
        if not pid_str.isdigit():
            continue
        pid = int(pid_str)
        if not is_pid_alive(pid):
            continue
        try:
            fp = os.path.join(sess_dir, fn)
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                meta = json.load(f)
            cwd = meta.get("cwd") or ""
            ws = os.path.basename(cwd.rstrip("\\/")) or cwd
            ep = meta.get("entrypoint") or "cli"
            out.append({"pid": pid, "entrypoint": ep, "workspace": ws})
        except Exception:
            pass
    return out


def main():
    if "--quota-backend" in sys.argv:
        print(quota_backend())
        return
    if "--statusline" in sys.argv:
        handle_statusline()
        return

    as_json = "--json" in sys.argv
    now_utc = datetime.now(timezone.utc)
    home = os.path.expandvars(r"%USERPROFILE%")
    app_dir = os.path.expandvars(r"%APPDATA%\ai.local.claude-local")
    vault = os.path.join(app_dir, "identity-vault")
    ledger = load_ledger(app_dir)
    ledger_accounts = ledger.get("accounts", {})

    live_cj_path = os.path.join(home, ".claude.json")
    live_cred_path = os.path.join(home, ".claude", ".credentials.json")

    live_cj = {}
    live_cred = {}
    if os.path.isfile(live_cj_path):
        with open(live_cj_path, "r", encoding="utf-8") as f:
            live_cj = json.load(f)
    if os.path.isfile(live_cred_path):
        with open(live_cred_path, "r", encoding="utf-8") as f:
            live_cred = json.load(f)

    live_email = (live_cj.get("oauthAccount") or {}).get("emailAddress", "").lower()
    active_sessions = detect_active_sessions(home)
    accounts_out = []

    db_path = os.path.join(vault, "identities.sqlite")
    live_active_since_dt = None
    if os.path.isfile(db_path):
        try:
            conn_as = sqlite3.connect(db_path, timeout=2.0)
            row_as = conn_as.execute("SELECT value FROM state WHERE key='active_since'").fetchone()
            conn_as.close()
            if row_as and row_as[0] and str(row_as[0]).isdigit() and int(row_as[0]) > 0:
                live_active_since_dt = datetime.fromtimestamp(int(row_as[0]), tz=timezone.utc)
        except Exception:
            pass

    if live_email:
        live_acc = live_cj.get("oauthAccount") or {}
        live_info = {
                "quota_identity": quota_identity(live_acc), "account_uuid": live_acc.get("accountUuid"),
                "organization_uuid": live_acc.get("organizationUuid"), "organization": live_acc.get("organizationName")}
        live_entry = ledger_account(ledger_accounts, live_email, live_info)
        le_anchor = live_entry.get("server_anchor")
        if isinstance(le_anchor, dict) and same_quota_account(live_info, live_entry):
            cj_cu = live_cj.get("cachedUsageUtilization")
            cj_ms = int(cj_cu.get("fetchedAtMs") or 0) if isinstance(cj_cu, dict) else 0
            le_ms = int(le_anchor.get("fetchedAtMs") or 0)
            if le_ms > cj_ms:
                live_cj["cachedUsageUtilization"] = le_anchor
        proj_root = os.path.join(home, ".claude", "projects")
        live_slices, live_latest = collect_session_slices_from_dir(proj_root)
        info = format_account(
            live_cj, live_cred, live_slices, live_latest, now_utc, active_since_dt=live_active_since_dt
        )
        info["role"] = "current"
        info["name"] = info["display"]
        apply_ledger_fallback_to_account(info, ledger_accounts, 0, now_utc)
        accounts_out.append(info)

    key_path = os.path.join(vault, "key.bin")
    if os.path.isfile(db_path) and os.path.isfile(key_path):
        with open(key_path, "rb") as kf:
            master_key = kf.read()
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        rows = cur.execute("SELECT id, name, archive, saved_at FROM identities WHERE empty=0").fetchall()
        summary_emails = {}
        try:
            for sid, sjson in cur.execute("SELECT id, summary FROM identity_summaries").fetchall():
                sobj = json.loads(sjson)
                if isinstance(sobj, dict) and sobj.get("email"):
                    summary_emails[sid] = str(sobj["email"]).lower()
        except Exception:
            pass
        conn.close()

        cache_path = os.path.join(app_dir, "quota_cache.json")
        quota_cache = {}
        if os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as cf:
                    quota_cache = json.load(cf)
            except Exception:
                quota_cache = {}
        cache_dirty = False

        for ident_id, name, archive, saved_at in rows:
            if live_email and summary_emails.get(ident_id) == live_email:
                continue
            try:
                cached_entry = quota_cache.get(archive)
                if isinstance(cached_entry, dict) and cached_entry.get("v") == 4:
                    baga_cj = cached_entry["cj"]
                    baga_cred = cached_entry["cred"]
                    baga_slices = [
                        (datetime.fromtimestamp(ts, tz=timezone.utc), float(cost))
                        for ts, cost in cached_entry.get("slices", [])
                    ]
                    baga_latest = (
                        datetime.fromtimestamp(cached_entry["latest_ts"], tz=timezone.utc)
                        if cached_entry.get("latest_ts")
                        else None
                    )
                else:
                    raw_cj, raw_cred, baga_slices, baga_latest = inspect_baga_archive(vault, master_key, archive)
                    oa_raw = raw_cred.get("claudeAiOauth", {}) if isinstance(raw_cred, dict) else {}
                    acc_raw = raw_cj.get("oauthAccount", {}) if isinstance(raw_cj, dict) else {}
                    baga_cj = {
                        "oauthAccount": {
                            "accountUuid": acc_raw.get("accountUuid"),
                            "emailAddress": acc_raw.get("emailAddress"),
                            "displayName": acc_raw.get("displayName"),
                            "organizationName": acc_raw.get("organizationName"),
                            "organizationUuid": acc_raw.get("organizationUuid"),
                            "billingType": acc_raw.get("billingType"),
                        },
                        "cachedUsageUtilization": raw_cj.get("cachedUsageUtilization", {}),
                    }
                    baga_cred = {
                        "claudeAiOauth": {
                            "subscriptionType": oa_raw.get("subscriptionType"),
                            "rateLimitTier": oa_raw.get("rateLimitTier"),
                            "expiresAt": oa_raw.get("expiresAt", 0),
                            "refreshToken": "present" if oa_raw.get("refreshToken") else "",
                        }
                    }
                    quota_cache[archive] = {
                        "v": 4,
                        "cj": baga_cj,
                        "cred": baga_cred,
                        "slices": [[dt.timestamp(), round(c, 6)] for dt, c in baga_slices],
                        "latest_ts": baga_latest.timestamp() if baga_latest else None,
                    }
                    cache_dirty = True

                baga_email = (baga_cj.get("oauthAccount") or {}).get("emailAddress", "").lower()
                if baga_email and baga_email == live_email and quota_identity(baga_cj.get("oauthAccount") or {}) == quota_identity(live_cj.get("oauthAccount") or {}):
                    continue
                # Archived shared sessions cannot prove which account paid for them.
                info = format_account(baga_cj, baga_cred, [], None, now_utc)
                apply_ledger_fallback_to_account(info, ledger_accounts, int(saved_at), now_utc)
                info["role"] = "saved"
                info["id"] = ident_id
                info["name"] = name
                info["saved_str"] = (
                    datetime.fromtimestamp(saved_at / 1000.0, tz=timezone.utc)
                    .astimezone()
                    .strftime("%Y-%m-%d %H:%M:%S")
                )
                accounts_out.append(info)
            except Exception as e:
                accounts_out.append({"role": "error", "name": name, "archive": archive, "error": str(e)})

        if cache_dirty:
            try:
                active_archives = {r[2] for r in rows}
                quota_cache = {k: v for k, v in quota_cache.items() if k in active_archives}
                with open(cache_path, "w", encoding="utf-8") as cf:
                    json.dump(quota_cache, cf, ensure_ascii=False)
            except Exception:
                pass

    # Persist multi-account ledger and synchronize identities.sqlite summaries
    save_ledger_and_sync_sqlite(app_dir, vault, accounts_out, now_utc)

    valid_accounts = [a for a in accounts_out if a.get("role") in ("current", "saved") and a.get("quota_source") != "unknown"]
    relay_rec = (
        select_best_relay_candidate(valid_accounts, int(now_utc.timestamp()))
        if valid_accounts
        else None
    )

    if as_json:
        print(
            json.dumps(
                {
                    "active_sessions": active_sessions,
                    "accounts": accounts_out,
                    "relay_recommendation": relay_rec,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    print("=" * 84)
    print(" 🛡️  Claude-Local Claude 多身份实时额度看板 v4 (statusLine 响应头收割 + qHr 自适应引擎)")
    print("=" * 84)

    if active_sessions:
        sess_desc = ", ".join(f"PID {s['pid']} ({s['entrypoint']} · {s['workspace']})" for s in active_sessions)
        print(f" ⚡ 活跃会话 : {sess_desc}")

    for item in accounts_out:
        if item["role"] == "error":
            print(f"\n⏸ [保险库暂存归档] {item['name']} ({item['archive']}): 读取失败 ({item['error']})")
            continue
        is_curr = item["role"] == "current"
        prefix = "▶ [当前激活工作区]" if is_curr else "⏸ [保险库暂存归档]"
        print(f"\n{prefix} {item['name']} <{item['email']}>  [{item['plan'].upper()}]  {item['avail_badge']}")
        print(f"  凭据状态 : {item['auth_str']}")
        print(f"  5h 滑窗  : [{render_bar(item['rem_5h'])}] 剩余 {item['rem_5h']:>3}%  | {item['note_5h']}")
        print(f"  7d 周限额: [{render_bar(item['rem_7d'])}] 剩余 {item['rem_7d']:>3}%  | {item['note_7d']}")
        if is_curr and item["burn_1h_usd"] > 0:
            tte_note = ""
            if item.get("burn_5h_pct_hr", 0) > 0 and item.get("rem_5h", 0) > 0:
                tte_sec = int(round((item["rem_5h"] / item["burn_5h_pct_hr"]) * 3600))
                tte_note = f" · 按当前速率预计可续航 ~{format_compact_eta(tte_sec)}"
            print(f"  近1h速率 : 消耗 ${item['burn_1h_usd']:.2f}/h (约合 5h 滑窗 {item['burn_5h_pct_hr']:.1f}%/h{tte_note})")
        if is_curr:
            print(f"  最近活跃 : {item['last_active_str']}  (服务端锚点: {item['fetched_str']} · statusLine 实时回写)")
        else:
            print(f"  最后活跃 : {item['last_active_str']}  (归档时间: {item['saved_str']})")

    if valid_accounts and relay_rec:
        print("\n" + "-" * 84)
        act = relay_rec["action"]
        if act == "stay":
            print(
                f" 💡 调度建议 : 当前账号 [{relay_rec['target']}] 无需切换 "
                f"(可用 {relay_rec['current_effective_rem']}% · 含10%防抖阈值保护)。"
            )
        elif act == "switch":
            reason_tag = " [周限额优先消纳/Consume-First]" if relay_rec.get("reason") == "consume_first_7d" else ""
            print(
                f" ⭐ 调度建议 : 建议在 Claude-Local 中一键接力切换至暂存账号 [{relay_rec['target']}] "
                f"(可用 {relay_rec['target_effective_rem']}%){reason_tag}，切换后执行 claude --resume 无缝续接会话。"
            )
        else:
            eta_sec = relay_rec.get("fastest_reset_eta_sec")
            if relay_rec.get("target") and eta_sec:
                print(
                    f" ⛔ 调度建议 : 全部账号当前额度均已耗尽，最快恢复账号为 [{relay_rec['target']}] "
                    f"(预计 {format_compact_eta(eta_sec)} 后解封)。"
                )
            else:
                print(" ⛔ 调度建议 : 全部账号当前额度均已耗尽，请等待最快重置窗口解封。")
    print("=" * 84)


if __name__ == "__main__":
    main()
