#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
claude-quota v4: 离线/被动式、无后台额度网络请求的 Claude 多身份实时额度与重置时间引擎
融合 GitHub 开源标杆架构 (ryoppippi/ccusage + Maciek-roboblog/Claude-Code-Usage-Monitor + sirmalloc/ccstatusline + Haleclipse/CCometixLine):
1. 被动式 statusLine 响应头收割 (--statusline): 实时捕获 Claude Code 2.1.x 每轮 /v1/messages 响应头中的
   anthropic-ratelimit-unified-5h/7d-utilization 与 resets_at，仅读取 ~/.claude.json，将锚点写入本地版 quota_ledger.json 与 SQLite 摘要表；
2. Claude Code 2.1.302 内核级 qHr 精确计费表: 完整对齐 opus-5-5 ($4/$20/$5/$8/$0.20)、haiku-5-5 ($0.10/$0.50)、
   opus-4-7/4-8 ($5/$25)、sonnet-5-5 ($2/$10/$0.10) 及 US 推理倍率 (1.1x)；
3. 跨文件全局 (message.id, requestId) 去重 + 单账号快照自适应标定 (Adaptive Window Calibration)；
4. 多账号持久账本 (quota_ledger.json) 与 Claude-Local (identities.sqlite) 双向实时同步。
"""
import sys
import os
import json
import struct
import sqlite3
import tempfile
import subprocess
import time
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.stdout.reconfigure(encoding="utf-8")

# 经 Claude Code 2.1.302 qHr 真实模型计费表 + 全局跨文件去重后双官方快照实证标定：
# Pro 账号默认 5h 窗口 100% ≈ $32.00 USD ($0.320/1%)，7d 周限额 100% ≈ $242.50 USD ($2.425/1%)
# 同时支持从各账号自身官方快照窗口内真实会话流自动计算自适应费率 (Adaptive Calibration)
PRO_WEEKLY_COST_USD = 242.5
PRO_5H_COST_USD = 32.0
CURRENT_QUOTA_VERSION = 3


def tier_multiplier(plan_str: str) -> float:
    p = (plan_str or "").lower()
    if "20x" in p:
        return 20.0
    if "5x" in p:
        return 5.0
    if "max" in p:
        return 5.0
    return 1.0


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
    raw_7d_used = float(w7.get("utilization") or 0.0) if w7.get("utilization") is not None else None
    reset_7d_dt = parse_reset_dt(w7.get("resets_at"))

    w5 = util.get("five_hour") or {}
    raw_5h_used = float(w5.get("utilization") or 0.0) if w5.get("utilization") is not None else None
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
    if q["effective_rem"] == 0:
        avail_badge = "🔴 额度已耗尽 (不可用)"
    elif q["effective_rem"] <= 20:
        avail_badge = f"🟠 额度紧张 (可用 {q['effective_rem']}%)"
    else:
        avail_badge = f"🟢 额度充足 (可用 {q['effective_rem']}%)"

    return {
        "display": display,
        "email": email,
        "organization": org,
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
    if not email_key or email_key not in ledger_accounts:
        return
    entry = ledger_accounts[email_key]
    ledger_sec = int(entry.get("updated_at_sec") or 0)
    if not info.get("has_quota_data") or ledger_sec > (saved_at_ms // 1000):
        q5 = entry.get("quota_5h_used")
        r5 = entry.get("quota_5h_reset_at")
        q7 = entry.get("quota_7d_used")
        r7 = entry.get("quota_7d_reset_at")
        now_sec = int(now_utc.timestamp())
        if r7 is not None and now_sec >= int(r7):
            r7_val = int(r7)
            while now_sec >= r7_val:
                r7_val += 7 * 86400
            r7 = r7_val
            q7 = 0
        if r5 is not None and now_sec >= int(r5):
            q5 = 0
            r5 = None
        if q7 is not None:
            info["used_7d"] = int(q7)
            info["rem_7d"] = max(0, 100 - int(q7))
            info["reset_7d_ts"] = int(r7) if r7 else None
            if r7:
                r7_dt = datetime.fromtimestamp(int(r7), tz=timezone.utc)
                diff_7d = (r7_dt - now_utc).total_seconds()
                local_7d = r7_dt.astimezone().strftime("%m-%d %H:%M")
                info["note_7d"] = f"{format_duration(diff_7d)} ({local_7d})"
        if q5 is not None:
            info["used_5h"] = int(q5)
            info["rem_5h"] = 0 if info["rem_7d"] == 0 else max(0, 100 - int(q5))
            info["reset_5h_ts"] = int(r5) if r5 else None
            if info["rem_7d"] == 0:
                info["note_5h"] = "⛔ 受 7d 周限额耗尽锁死 (即使 5h 重置也无法调用)"
            elif r5:
                r5_dt = datetime.fromtimestamp(int(r5), tz=timezone.utc)
                diff_5h = (r5_dt - now_utc).total_seconds()
                local_5h = r5_dt.astimezone().strftime("%H:%M")
                info["note_5h"] = f"{format_duration(diff_5h)} ({local_5h})"
            else:
                info["note_5h"] = "🟢 5h 窗口已重置 (发消息即开启新 5h 周期)"
        info["effective_rem"] = min(info["rem_5h"], info["rem_7d"])
        if info["effective_rem"] == 0:
            info["avail_badge"] = "🔴 额度已耗尽 (不可用)"
        elif info["effective_rem"] <= 20:
            info["avail_badge"] = f"🟠 额度紧张 (可用 {info['effective_rem']}%)"
        else:
            info["avail_badge"] = f"🟢 额度充足 (可用 {info['effective_rem']}%)"


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
    except (OSError, TimeoutError):
        return


def anchor_fetched_at_ms(anchor) -> int:
    value = anchor.get("fetchedAtMs") if isinstance(anchor, dict) else None
    return int(value) if isinstance(value, (int, float)) and value > 0 else 0


def _save_ledger_and_sync_sqlite(app_dir: str, vault_dir: str, accounts_out: list[dict], now_utc: datetime) -> None:
    now_sec = int(now_utc.timestamp())
    now_ms = int(now_utc.timestamp() * 1000)
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
        prev_anchor = prev_entry.get("server_anchor")
        incoming_anchor = item.get("server_anchor")
        incoming_ms = anchor_fetched_at_ms(incoming_anchor) if incoming_anchor else now_ms
        # Inputs are computed before acquiring this lock. A later statusLine
        # response may already have committed both its anchor and its summary.
        if anchor_fetched_at_ms(prev_anchor) > incoming_ms:
            continue
        if not incoming_anchor and int(prev_entry.get("updated_at_sec") or 0) > now_sec:
            continue
        item = dict(item)
        observed = item.get("server_anchor_observed_windows")
        if (isinstance(incoming_anchor, dict) and isinstance(prev_anchor, dict)
                and incoming_anchor.get("accountUuid")
                and incoming_anchor.get("accountUuid") == prev_anchor.get("accountUuid")
                and isinstance(observed, list)):
            utilization = dict(incoming_anchor.get("utilization") or {})
            previous_utilization = prev_anchor.get("utilization") or {}
            baseline_ms = int(item.get("server_anchor_base_fetched_at_ms") or 0)
            for window, suffix in (("five_hour", "5h"), ("seven_day", "7d")):
                if (window not in observed and window in previous_utilization
                        and (window not in utilization or anchor_fetched_at_ms(prev_anchor) > baseline_ms)):
                    utilization[window] = previous_utilization[window]
                    item[f"used_{suffix}"] = prev_entry.get(f"quota_{suffix}_used")
                    item[f"reset_{suffix}_ts"] = prev_entry.get(f"quota_{suffix}_reset_at")
            incoming_anchor = {**incoming_anchor, "utilization": utilization}
        item["server_anchor"] = incoming_anchor
        accepted_accounts.append(item)
        accs[key] = {
            "email": email,
            "display_name": item.get("display"),
            "organization": item.get("organization"),
            "plan": item.get("plan"),
            "auth_status": item.get("auth_status"),
            "quota_5h_used": item.get("used_5h"),
            "quota_5h_reset_at": item.get("reset_5h_ts"),
            "quota_7d_used": item.get("used_7d"),
            "quota_7d_reset_at": item.get("reset_7d_ts"),
            "updated_at_sec": now_sec,
            **(
                {"server_anchor": item.get("server_anchor") or prev_entry.get("server_anchor")}
                if (item.get("server_anchor") or prev_entry.get("server_anchor"))
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
        for ident_id, ident_name in rows:
            prev = existing_sums.get(ident_id) or {}
            email_lower = (prev.get("email") or "").lower()
            matched = by_email.get(email_lower)
            if not matched:
                for a in accepted_accounts:
                    if a.get("id") == ident_id or (a.get("name") == ident_name and a.get("role") in ("current", "saved")):
                        matched = a
                        break
            if not matched:
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
    rl = payload.get("rate_limits") or {}
    rl_5h = rl.get("five_hour") or {}
    rl_7d = rl.get("seven_day") or {}

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
    anchor_base_ms = 0
    observed_windows = []

    # Build server_anchor in memory only (NEVER modify ~/.claude.json; persist only to quota_ledger.json)
    if has_live_rl and isinstance(live_cj, dict):
        cu = live_cj.get("cachedUsageUtilization")
        if not isinstance(cu, dict) or (acct_uuid and cu.get("accountUuid") not in (None, "", acct_uuid)):
            cu = {}
        previous_anchor = (ledger.get("accounts", {}).get(email.lower()) or {}).get("server_anchor")
        if (acct_uuid and isinstance(previous_anchor, dict)
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
            }

        server_anchor = {
            "fetchedAtMs": int(now_utc.timestamp() * 1000),
            **({"accountUuid": acct_uuid} if acct_uuid else {}),
            "utilization": util,
        }

    u5_val = rl_5h.get("used_percentage")
    r5_val = rl_5h.get("resets_at")
    u7_val = rl_7d.get("used_percentage")
    r7_val = rl_7d.get("resets_at")

    if u5_val is None or u7_val is None:
        if email.lower() in ledger.get("accounts", {}):
            le = ledger["accounts"][email.lower()]
            if u5_val is None:
                u5_val = le.get("quota_5h_used")
                r5_val = le.get("quota_5h_reset_at")
            if u7_val is None:
                u7_val = le.get("quota_7d_used")
                r7_val = le.get("quota_7d_reset_at")
        cu_util = (((server_anchor or live_cj.get("cachedUsageUtilization")) or {}).get("utilization") or {})
        if u5_val is None and isinstance(cu_util.get("five_hour"), dict):
            u5_val = cu_util["five_hour"].get("utilization")
            r5_dt = parse_reset_dt(cu_util["five_hour"].get("resets_at"))
            r5_val = int(r5_dt.timestamp()) if r5_dt else None
        if u7_val is None and isinstance(cu_util.get("seven_day"), dict):
            u7_val = cu_util["seven_day"].get("utilization")
            r7_dt = parse_reset_dt(cu_util["seven_day"].get("resets_at"))
            r7_val = int(r7_dt.timestamp()) if r7_dt else None

    used5 = min(100, max(0, int(round(float(u5_val))))) if u5_val is not None else None
    used7 = min(100, max(0, int(round(float(u7_val))))) if u7_val is not None else None
    r5_int = int(r5_val) if r5_val else None
    r7_int = int(r7_val) if r7_val else None
    if r7_int and now_sec >= r7_int:
        while now_sec >= r7_int:
            r7_int += 7 * 86400
        used7 = 0
    if r5_int and now_sec >= r5_int:
        used5 = 0
        r5_int = None

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
                    "plan": "Pro",
                    "auth_status": "valid",
                    "used_5h": used5 if used5 is not None else 0,
                    "rem_5h": max(0, 100 - (used5 if used5 is not None else 0)),
                    "reset_5h_ts": r5_int,
                    "used_7d": used7 if used7 is not None else 0,
                    "rem_7d": max(0, 100 - (used7 if used7 is not None else 0)),
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
    elif curr_rem5 is not None:
        curr_eff = curr_rem5
    else:
        curr_eff = curr_rem7

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
        p_u5 = le.get("quota_5h_used")
        p_r5 = le.get("quota_5h_reset_at")
        p_u7 = le.get("quota_7d_used")
        p_r7 = le.get("quota_7d_reset_at")
        if p_u5 is None and p_u7 is None:
            continue
        p_u5_i = int(p_u5 or 0)
        p_u7_i = int(p_u7 or 0)
        p_r5_i = int(p_r5) if p_r5 else None
        p_r7_i = int(p_r7) if p_r7 else None
        if p_r7_i and now_sec >= p_r7_i:
            while now_sec >= p_r7_i:
                p_r7_i += 7 * 86400
            p_u7_i = 0
        if p_r5_i and now_sec >= p_r5_i:
            p_u5_i = 0
            p_r5_i = None
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
        le_anchor = (ledger_accounts.get(live_email) or {}).get("server_anchor")
        if isinstance(le_anchor, dict):
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
                if isinstance(cached_entry, dict) and cached_entry.get("v") == 3:
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
                        "v": 3,
                        "cj": baga_cj,
                        "cred": baga_cred,
                        "slices": [[dt.timestamp(), round(c, 6)] for dt, c in baga_slices],
                        "latest_ts": baga_latest.timestamp() if baga_latest else None,
                    }
                    cache_dirty = True

                baga_email = (baga_cj.get("oauthAccount") or {}).get("emailAddress", "").lower()
                if baga_email and baga_email == live_email:
                    continue
                info = format_account(baga_cj, baga_cred, baga_slices, baga_latest, now_utc)
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

    valid_accounts = [a for a in accounts_out if a.get("role") in ("current", "saved")]
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
