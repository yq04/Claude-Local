# [INPUT]: scripts/claude-relay.ps1, scripts/claude-subagent.ps1, and temporary mock claude/claude-local shims.
# [OUTPUT]: Encoding/BOM/LF/PS5.1+PS7 AST checks and end-to-end synthetic relay, flag-preservation, Ctrl+C rescue, StopFailure/Stop/PostToolUse sentinels (2-stage proactive threshold wrap-up & forced_stop via quota_ledger.json watcher), continued-in background session resume, 1200-char progress digest, proxy preflight, and subagent 429 failover regressions.
# [POS]: Offline orchestrator script tests; never runs real claude.exe, modifies %APPDATA%, or stops live processes.
# [PROTOCOL]: Update scripts/CLAUDE.md when adding or altering orchestrator wrapper flags or protocol fields.
"""Synthetic end-to-end tests for claude-relay.ps1 and claude-subagent.ps1."""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
RELAY_PS1 = SCRIPTS_DIR / "claude-relay.ps1"
SUBAGENT_PS1 = SCRIPTS_DIR / "claude-subagent.ps1"

DEFAULT_CONT_PROMPT = (
    "Continue the unfinished part of the user's latest task from this saved history. "
    "Keep completed work and recorded tool results. Check existing files before deciding "
    "what remains. Do not repeat completed commands or external actions."
)
CLEAN_CONT_PROMPT = (
    "Continue the user's latest task in this fresh session. First read the relay handoff note named in your "
    "system prompt, then check existing files before deciding what remains. Do not repeat completed commands "
    "or external actions."
)
# Synthetic UUID assembled at runtime so no UUID literal is tracked in the repository.
FAKE_UUID = "-".join(["123e4567", "e89b", "12d3", "a456", "426614174000"])


def _write_mock_shims(root: Path, scenario: dict) -> tuple[Path, Path, Path, Path]:
    """Create temporary Python-backed mock claude-local.cmd and claude.cmd shims."""
    state_file = root / "mock_state.json"
    trace_file = root / "mock_trace.json"
    state_file.write_text(json.dumps(scenario), encoding="utf-8")
    trace_file.write_text(json.dumps({"orchestrate_calls": [], "claude_calls": []}), encoding="utf-8")

    driver = root / "mock_driver.py"
    driver.write_text(
        r'''import contextlib, json, os, subprocess, sys, time
from pathlib import Path

mode = sys.argv[1]
state_path = Path(sys.argv[2])
trace_path = Path(sys.argv[3])
args = sys.argv[4:]

@contextlib.contextmanager
def trace_lock():
    lock_path = trace_path.with_suffix(".lock")
    deadline = time.monotonic() + 5.0
    acquired = False
    while not acquired:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            acquired = True
        except FileExistsError:
            if time.monotonic() >= deadline:
                try:
                    os.unlink(str(lock_path))
                except OSError:
                    pass
                break
            time.sleep(0.01)
    try:
        yield
    finally:
        if acquired:
            try:
                os.unlink(str(lock_path))
            except OSError:
                pass

def read_trace():
    return json.loads(trace_path.read_text(encoding="utf-8"))

def write_trace(obj):
    tmp = trace_path.with_suffix(".tmp." + str(os.getpid()))
    tmp.write_text(json.dumps(obj), encoding="utf-8")
    os.replace(str(tmp), str(trace_path))

state = json.loads(state_path.read_text(encoding="utf-8"))

if mode == "orchestrate":
    if "--orchestrate" not in args:
        sys.stderr.write("missing --orchestrate flag\n")
        sys.exit(2)
    req = json.loads(sys.stdin.read() or "{}")
    op = req.get("op")
    with trace_lock():
        trace = read_trace()
        trace["orchestrate_calls"].append(req)
        responses = state.get("orchestrate", {}).get(op, [])
        if isinstance(responses, list):
            idx = sum(1 for c in trace["orchestrate_calls"] if c.get("op") == op) - 1
            resp = responses[idx] if idx < len(responses) else responses[-1]
        else:
            resp = responses
        if isinstance(resp, dict) and resp.pop("_same_account", False):
            # Legacy resume-mechanics fixtures model a same-account relay (from == target record).
            resp["from_record_id"] = resp["target_id"] = "f" * 32
        write_trace(trace)
    sys.stdout.write(json.dumps(resp))
    sys.exit(int(resp.get("_exit", 0)) if isinstance(resp, dict) else 0)

elif mode == "claude":
    stdin_text = ""
    if "--output-format" in args:
        try:
            if not sys.stdin.isatty():
                stdin_text = sys.stdin.read()
        except Exception:
            stdin_text = ""

    settings_snapshot = None
    if "--settings" in args:
        s_idx = args.index("--settings")
        if s_idx + 1 < len(args):
            sp = Path(args[s_idx + 1])
            if sp.is_file():
                try:
                    settings_snapshot = json.loads(sp.read_text(encoding="utf-8"))
                except Exception:
                    settings_snapshot = None

    env_snap = {
        k: os.environ.get(k)
        for k in (
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_LOCAL_RELAY_ACTIVE",
            "CLAUDE_LOCAL_RELAY_THRESHOLD",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "GRPC_PROXY",
            "NO_PROXY",
            "DISABLE_TELEMETRY",
            "DISABLE_ERROR_REPORTING",
            "DO_NOT_TRACK",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
            "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_GATEWAY",
            "CLAUDE_CODE_SIMPLE",
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
        )
    }
    with trace_lock():
        trace = read_trace()
        run_idx = len(trace["claude_calls"])
        trace["claude_calls"].append({
            "argv": args,
            "stdin": stdin_text,
            "env": env_snap,
            "ephemeral_settings": settings_snapshot,
        })
        write_trace(trace)

    runs = state.get("claude_runs", [])
    run_spec = runs[run_idx] if run_idx < len(runs) else (runs[-1] if runs else {})

    def patch_call(**updates):
        with trace_lock():
            tr = read_trace()
            tr["claude_calls"][run_idx].update(updates)
            write_trace(tr)

    home = Path(os.environ.get("USERPROFILE", ""))
    appdata = Path(os.environ.get("APPDATA", ""))
    def apply_writes(spec_obj):
        for rel_path, content in (spec_obj.get("write_files") or {}).items():
            fp = home / rel_path
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content, encoding="utf-8")
        if str(appdata):
            for rel_path, content in (spec_obj.get("write_appdata_files") or {}).items():
                fp = appdata / rel_path
                fp.parent.mkdir(parents=True, exist_ok=True)
                fp.write_text(content, encoding="utf-8")

    apply_writes(run_spec)

    captured = {}
    for pattern in run_spec.get("capture_globs", []):
        for cap in sorted(home.glob(pattern)):
            if cap.is_file():
                captured[cap.relative_to(home).as_posix()] = cap.read_text(encoding="utf-8")
    if captured:
        patch_call(captured_files=captured)

    pre_ptu_sleep_ms = int(run_spec.get("sleep_before_post_tool_use_ms") or 0)
    if pre_ptu_sleep_ms > 0:
        time.sleep(pre_ptu_sleep_ms / 1000.0)

    def wait_armed_if_requested(timeout_ms):
        if timeout_ms > 0 and "--settings" in args:
            s_idx = args.index("--settings")
            if s_idx + 1 < len(args):
                armed_p = Path(args[s_idx + 1]).parent / "threshold_armed.json"
                deadline = time.monotonic() + (timeout_ms / 1000.0)
                while (not armed_p.is_file()) and (time.monotonic() < deadline):
                    time.sleep(0.05)

    wait_armed_if_requested(int(run_spec.get("wait_for_armed_timeout_ms") or 0))

    ptu_items = run_spec.get("fire_post_tool_use")
    if isinstance(ptu_items, list) and isinstance(settings_snapshot, dict):
        ptu_list = (settings_snapshot.get("hooks") or {}).get("PostToolUse") or []
        bash_exe = run_spec.get("hook_bash_exe")
        ptu_outputs = []
        for item in ptu_items:
            if isinstance(item, dict) and "payload" in item:
                apply_writes(item)
                step_sleep_ms = int(item.get("sleep_ms") or 0)
                if step_sleep_ms > 0:
                    time.sleep(step_sleep_ms / 1000.0)
                wait_armed_if_requested(int(item.get("wait_for_armed_timeout_ms") or 0))
                ptu_payload = item["payload"]
            else:
                ptu_payload = item
            for group in ptu_list:
                for hk in (group.get("hooks") or []):
                    if hk.get("type") == "command" and hk.get("command"):
                        if bash_exe:
                            hk_res = subprocess.run(
                                [bash_exe, "-c", hk["command"]],
                                input=json.dumps(ptu_payload),
                                text=True,
                                encoding="utf-8",
                                capture_output=True,
                                timeout=10,
                            )
                        else:
                            hk_res = subprocess.run(
                                hk["command"],
                                input=json.dumps(ptu_payload),
                                text=True,
                                encoding="utf-8",
                                shell=True,
                                capture_output=True,
                                timeout=10,
                            )
                        raw_out = hk_res.stdout or ""
                        parsed_out = None
                        if raw_out.strip():
                            try:
                                parsed_out = json.loads(raw_out.strip())
                            except Exception:
                                parsed_out = None
                        ptu_outputs.append({
                            "returncode": hk_res.returncode,
                            "stdout": raw_out,
                            "stderr": hk_res.stderr,
                            "parsed": parsed_out,
                        })
        updates = {"post_tool_use_outputs": ptu_outputs}
        if "--settings" in args:
            s_idx = args.index("--settings")
            if s_idx + 1 < len(args):
                s_dir = Path(args[s_idx + 1]).parent
                for snap_key, fname in (("threshold_armed_snapshot", "threshold_armed.json"), ("proactive_handoff_snapshot", "proactive_handoff.json")):
                    sp_file = s_dir / fname
                    if sp_file.is_file():
                        try:
                            updates[snap_key] = json.loads(sp_file.read_text(encoding="utf-8"))
                        except Exception:
                            pass
        patch_call(**updates)

    hook_payload = run_spec.get("fire_stop_failure")
    if isinstance(hook_payload, dict) and isinstance(settings_snapshot, dict):
        sf_list = (settings_snapshot.get("hooks") or {}).get("StopFailure") or []
        for group in sf_list:
            for hk in (group.get("hooks") or []):
                if hk.get("type") == "command" and hk.get("command"):
                    subprocess.run(
                        hk["command"],
                        input=json.dumps(hook_payload),
                        text=True,
                        encoding="utf-8",
                        shell=True,
                        capture_output=True,
                        timeout=10,
                    )
        if "--settings" in args:
            s_idx = args.index("--settings")
            if s_idx + 1 < len(args):
                trig_p = Path(args[s_idx + 1]).parent / "trigger.json"
                if trig_p.is_file():
                    try:
                        patch_call(trigger_snapshot=json.loads(trig_p.read_text(encoding="utf-8")))
                    except Exception:
                        pass

    stop_payload = run_spec.get("fire_stop")
    if isinstance(stop_payload, dict) and isinstance(settings_snapshot, dict):
        stop_list = (settings_snapshot.get("hooks") or {}).get("Stop") or []
        bash_exe = run_spec.get("hook_bash_exe")
        for group in stop_list:
            for hk in (group.get("hooks") or []):
                if hk.get("type") == "command" and hk.get("command"):
                    if bash_exe:
                        hk_res = subprocess.run(
                            [bash_exe, "-c", hk["command"]],
                            input=json.dumps(stop_payload),
                            text=True,
                            encoding="utf-8",
                            capture_output=True,
                            timeout=10,
                        )
                    else:
                        hk_res = subprocess.run(
                            hk["command"],
                            input=json.dumps(stop_payload),
                            text=True,
                            encoding="utf-8",
                            shell=True,
                            capture_output=True,
                            timeout=10,
                        )
                    updates = {
                        "stop_hook_result": {
                            "returncode": hk_res.returncode,
                            "stderr": hk_res.stderr,
                        }
                    }
                    if "--settings" in args:
                        s_idx = args.index("--settings")
                        if s_idx + 1 < len(args):
                            te_p = Path(args[s_idx + 1]).parent / "turn_end.json"
                            if te_p.is_file():
                                try:
                                    updates["turn_end_snapshot"] = json.loads(te_p.read_text(encoding="utf-8"))
                                except Exception:
                                    pass
                            tr_p = Path(args[s_idx + 1]).parent / "trigger.json"
                            if tr_p.is_file():
                                try:
                                    updates["trigger_snapshot"] = json.loads(tr_p.read_text(encoding="utf-8"))
                                except Exception:
                                    pass
                    patch_call(**updates)

    sleep_ms = int(run_spec.get("sleep_after_hook_ms") or 0)
    ext_worker_proc = None
    ext_worker_ms = int(run_spec.get("spawn_ext_worker_ms") or 0)
    if ext_worker_ms > 0:
        import shutil as _shutil
        sh_bin = _shutil.which("pwsh") or _shutil.which("powershell.exe")
        if sh_bin:
            ext_worker_proc = subprocess.Popen(
                [sh_bin, "-NoProfile", "-Command", f"Start-Sleep -Milliseconds {ext_worker_ms} # external worker"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    try:
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)
    finally:
        if ext_worker_proc is not None:
            try:
                ext_worker_proc.wait(timeout=10)
            except Exception:
                try:
                    ext_worker_proc.kill()
                except Exception:
                    pass

    if run_spec.get("capture_ephemeral_after_sleep") and "--settings" in args:
        s_idx = args.index("--settings")
        if s_idx + 1 < len(args):
            s_dir = Path(args[s_idx + 1]).parent
            patch_call(ephemeral_after_sleep={
                "threshold_armed_exists": (s_dir / "threshold_armed.json").is_file(),
                "proactive_handoff_exists": (s_dir / "proactive_handoff.json").is_file(),
                "turn_end_exists": (s_dir / "turn_end.json").is_file(),
            })

    if run_spec.get("stdout"):
        sys.stdout.write(run_spec["stdout"])
    if run_spec.get("stderr"):
        sys.stderr.write(run_spec["stderr"])
    sys.exit(int(run_spec.get("exit_code", 0)))
''',
        encoding="utf-8",
    )

    py_exe = sys.executable
    local_cmd = root / "claude-local.cmd"
    local_cmd.write_text(
        f'@echo off\r\n"{py_exe}" "{driver}" orchestrate "{state_file}" "{trace_file}" %*\r\n',
        encoding="utf-8",
    )
    claude_cmd = root / "claude.cmd"
    claude_cmd.write_text(
        f'@echo off\r\n"{py_exe}" "{driver}" claude "{state_file}" "{trace_file}" %*\r\n',
        encoding="utf-8",
    )
    return local_cmd, claude_cmd, trace_file, driver


def _mock_env(home: Path, local_cmd: Path, claude_cmd: Path, **extra: str) -> dict[str, str]:
    base = {
        **os.environ,
        "USERPROFILE": str(home),
        "APPDATA": str(home / "AppData" / "Roaming"),
        "CLAUDE_LOCAL_EXE": str(local_cmd),
        "CLAUDE_EXE": str(claude_cmd),
        "CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT": "1",
        "CLAUDE_RELAY_TEST_FAST": "1",
    }
    base.update(extra)
    return base


def _run_ps(
    ps_exe: str,
    script: Path,
    script_args: list[str],
    env: dict[str, str],
    cwd: Path,
    stdin_data: str | None = None,
) -> subprocess.CompletedProcess:
    cmd = [ps_exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *script_args]
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        input=stdin_data,
        stdin=subprocess.DEVNULL if stdin_data is None else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=45,
    )


class CliOrchestratorScriptsTests(unittest.TestCase):
    def test_encoding_bom_lf_and_control_bytes(self):
        for ps1 in (RELAY_PS1, SUBAGENT_PS1):
            with self.subTest(ps1=ps1.name):
                raw = ps1.read_bytes()
                self.assertTrue(raw.startswith(b"\xef\xbb\xbf"), f"{ps1.name} must have UTF-8 BOM")
                self.assertNotIn(b"\r", raw, f"{ps1.name} must use pure LF (CR=0)")
                text = raw[3:].decode("utf-8")
                bad_ctrl = [hex(ord(ch)) for ch in text if ord(ch) < 0x20 and ch not in ("\t", "\n")]
                self.assertEqual(bad_ctrl, [], f"{ps1.name} has unexpected control bytes: {bad_ctrl}")

        for utf8_nobom in (
            SCRIPTS_DIR / "claude_quota.py",
            SCRIPTS_DIR / "test-claude-quota-local.py",
            SCRIPTS_DIR / "test-cli-orchestrator-scripts.py",
            SCRIPTS_DIR / "CLAUDE.md",
        ):
            with self.subTest(file=utf8_nobom.name):
                raw = utf8_nobom.read_bytes()
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), f"{utf8_nobom.name} must not have UTF-8 BOM")
                self.assertNotIn(b"\r", raw, f"{utf8_nobom.name} must use pure LF (CR=0)")
                raw.decode("utf-8")

    def test_ast_parse_zero_errors_in_ps51_and_pwsh7(self):
        shells = [shutil.which("powershell.exe"), shutil.which("pwsh")]
        available = [s for s in shells if s]
        self.assertGreaterEqual(len(available), 1, "At least one PowerShell engine must be installed")
        for shell in available:
            for ps1 in (RELAY_PS1, SUBAGENT_PS1):
                with self.subTest(shell=Path(shell).name, ps1=ps1.name):
                    expr = (
                        f"$t=$null;$e=$null;"
                        f"[System.Management.Automation.Language.Parser]::ParseFile('{ps1}',[ref]$t,[ref]$e)|Out-Null;"
                        f"if($e.Count -gt 0){{$e|ForEach-Object{{Write-Error $_}};exit 1}};"
                        f"Write-Output 'AST_OK'"
                    )
                    res = subprocess.run([shell, "-NoProfile", "-Command", expr], capture_output=True, text=True, timeout=20)
                    self.assertEqual(res.returncode, 0, f"{shell} AST failed for {ps1.name}: {res.stderr}\n{res.stdout}")
                    self.assertIn("AST_OK", res.stdout)

    def test_relay_status_and_ctrl_c_rescue_vs_abort_and_ephemeral_injection(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            work = root / "work"
            home.mkdir()
            work.mkdir()

            status_payload = {
                "ok": True,
                "cli_running": False,
                "should_relay_now": False,
                "active": "a" * 32,
                "active_name": "Acct-A",
                "config": {"strategy": "reset_harvest", "spentThresholdPct": 98, "autoContinueOnRelay": False, "maxSameExitConcurrency": 2},
                "pool": {"readyCount": 2, "lowCount": 0, "spentCount": 1, "unavailableCount": 0, "totalManualResetsRemaining": 3},
                "accounts": [
                    {"id": "a" * 32, "name": "Acct-A", "is_current": True, "tier": "ready", "rem_5h": 80, "rem_7d": 70, "effective_rem": 70, "manual_resets_remaining": 0},
                    {"id": "b" * 32, "name": "Acct-B", "is_current": False, "tier": "ready", "rem_5h": 95, "rem_7d": 88, "effective_rem": 88, "manual_resets_remaining": 3},
                ],
                "awaiting_reset_accounts": [{"id": "c" * 32, "name": "Acct-C", "manual_resets_remaining": 2, "used_7d": 99}],
            }
            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {"status": status_payload},
                "claude_runs": [{"exit_code": 0, "stdout": "normal done\n"}],
            })
            env = _mock_env(home, local_cmd, claude_cmd)

            # 1. -Status (in both pwsh and powershell.exe 5.1 when available)
            for sh in [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]:
                res_status = _run_ps(sh, RELAY_PS1, ["-Status"], env, work)
                self.assertEqual(res_status.returncode, 0, res_status.stderr)
                self.assertIn("Acct-A", res_status.stdout)
                self.assertIn("Acct-B", res_status.stdout)
                self.assertIn("Reset Card ready", res_status.stdout)

            # 2. Normal interactive exit: injects ephemeral --settings + --agents, exports env, prints banner, cleans up temp dir
            res_norm = _run_ps(ps_exe, RELAY_PS1, ["--model", "sonnet"], env, work)
            self.assertEqual(res_norm.returncode, 0, res_norm.stderr)
            self.assertIn("[Claude-Local Relay] Active: Acct-A | Standby: Acct-B (88%) | Mode: reset_harvest (98%) | /exit to relay", res_norm.stdout)
            self.assertFalse((home / ".claude" / "settings.json").exists())
            trace = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(trace["claude_calls"]), 1)
            call0 = trace["claude_calls"][0]
            argv0 = call0["argv"]
            self.assertEqual(argv0[:2], ["--model", "sonnet"])
            self.assertIn("--settings", argv0)
            settings_path = Path(argv0[argv0.index("--settings") + 1])
            self.assertFalse(settings_path.exists(), "ephemeral settings file must be cleaned up in finally")
            self.assertIsNotNone(call0["ephemeral_settings"])
            self.assertIn("StopFailure", call0["ephemeral_settings"]["hooks"])
            self.assertIn("--agents", argv0)
            agents_parsed = json.loads(argv0[argv0.index("--agents") + 1])
            self.assertIn("pro-pool-worker", agents_parsed)
            self.assertEqual(call0["env"]["CLAUDE_LOCAL_RELAY_ACTIVE"], "1")
            self.assertEqual(call0["env"]["CLAUDE_LOCAL_RELAY_THRESHOLD"], "98")
            self.assertFalse(any(c.get("op") == "relay_switch" for c in trace["orchestrate_calls"]))

            # 3. Ctrl+C (130) WITHOUT rate-limit exits immediately without switching
            ctrlc_dir = root / "ctrlc"
            ctrlc_dir.mkdir(exist_ok=True)
            local_cmd2, claude_cmd2, trace_file2, _ = _write_mock_shims(ctrlc_dir, {
                "orchestrate": {"status": status_payload},
                "claude_runs": [{"exit_code": 130}],
            })
            env2 = _mock_env(home, local_cmd2, claude_cmd2)
            res_ctrlc = _run_ps(ps_exe, RELAY_PS1, [], env2, work)
            self.assertEqual(res_ctrlc.returncode, 130, res_ctrlc.stderr)
            trace2 = json.loads(trace_file2.read_text(encoding="utf-8"))
            self.assertEqual([c.get("op") for c in trace2["orchestrate_calls"]], ["status"])

            # 4. Ctrl+C (-1073741510 / 130) WITH StopFailure rate-limit sentinel rescues session and relays!
            rescue_dir = root / "ctrlc_rescue"
            rescue_dir.mkdir(exist_ok=True)
            local_cmd3, claude_cmd3, trace_file3, _ = _write_mock_shims(rescue_dir, {
                "orchestrate": {
                    "status": status_payload,
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 88,
                        "reason": "rate_limit_rescue",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": -1073741510,
                        "fire_stop_failure": {
                            "hook_event_name": "StopFailure",
                            "error": "rate_limit",
                            "error_details": "You've hit your limit",
                            "session_id": "sess-ctrlc-rescue-77",
                        },
                    },
                    {"exit_code": 0, "stdout": "rescued after ctrl+c\n"},
                ],
            })
            env3 = _mock_env(home, local_cmd3, claude_cmd3)
            res_rescue = _run_ps(ps_exe, RELAY_PS1, ["--model", "opus"], env3, work)
            self.assertEqual(res_rescue.returncode, 0, res_rescue.stderr + "\n" + res_rescue.stdout)
            self.assertIn("rescuing session via SmartRelay", res_rescue.stdout)
            trace3 = json.loads(trace_file3.read_text(encoding="utf-8"))
            self.assertEqual(len(trace3["claude_calls"]), 2)
            sw_calls = [c for c in trace3["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_calls), 1)
            self.assertTrue(sw_calls[0].get("rate_limited"))
            self.assertEqual(sw_calls[0].get("from_record_id"), "a" * 32)
            argv_resumed = trace3["claude_calls"][1]["argv"]
            self.assertEqual(argv_resumed[:4], ["--resume", "sess-ctrlc-rescue-77", "--model", "opus"])

    def test_relay_preserves_persistent_flags_and_handles_bare_resume(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            work = root / "work-flags"
            home.mkdir()
            work.mkdir()
            # Pre-create pro-pool-worker.md so --agents injection is skipped when already installed
            agents_dir = home / ".claude" / "agents"
            agents_dir.mkdir(parents=True)
            (agents_dir / "pro-pool-worker.md").write_text("---\nname: pro-pool-worker\n---\n", encoding="utf-8")

            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            rate_jsonl = json.dumps({
                "type": "assistant",
                "isApiErrorMessage": True,
                "error": "rate_limit",
                "message": {"content": "You've hit your limit · resets 5pm"},
            }) + "\n"

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 91,
                        "reason": "higher_headroom",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 130,  # Ctrl+C rescue via transcript rate_limit
                        "write_files": {
                            f".claude/projects/{slug}/sess-bare-55.jsonl": rate_jsonl,
                        },
                    },
                    {"exit_code": 0, "stdout": "resumed with persistent flags\n"},
                ],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            cli_args = [
                "--resume",
                "--model", "opus",
                "--effort", "high",
                "--permission-mode", "acceptEdits",
                "--dangerously-skip-permissions",
                "--add-dir", str(work),
                "--allowedTools", "Bash,Read",
                "--settings", '{"custom":true}',
            ]
            res = _run_ps(ps_exe, RELAY_PS1, cli_args, env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr["claude_calls"]), 2)
            # Run 0 passed user args as-is (no duplicate --settings or --agents)
            self.assertEqual(tr["claude_calls"][0]["argv"], cli_args)
            # Run 1 stripped bare --resume, discovered sess-bare-55 (NOT "--model"!), and kept all persistent flags
            self.assertEqual(
                tr["claude_calls"][1]["argv"],
                [
                    "--resume", "sess-bare-55",
                    "--model", "opus",
                    "--effort", "high",
                    "--permission-mode", "acceptEdits",
                    "--dangerously-skip-permissions",
                    "--add-dir", str(work),
                    "--allowedTools", "Bash,Read",
                    "--settings", '{"custom":true}',
                ],
            )

    def test_relay_interactive_resume_and_auto_continue_modes(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            work = root / "work-proj"
            home.mkdir()
            work.mkdir()

            # Case A: --print run (no -AutoContinue), rate limit detected from .jsonl
            case_a = root / "case_a"
            case_a.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            rate_jsonl = json.dumps({
                "type": "assistant",
                "isApiErrorMessage": True,
                "error": "rate_limit",
                "message": {"content": "You've hit your limit · resets 5pm"},
            }) + "\n"
            local_a, claude_a, trace_a, _ = _write_mock_shims(case_a, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 92,
                        "reason": "higher_headroom",
                        "awaiting_reset_accounts": [{"name": "Acct-C", "manual_resets_remaining": 1, "used_7d": 99}],
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "write_files": {
                            ".claude/sessions/99999.json": json.dumps({"pid": 99999, "sessionId": "sess-1111", "cwd": str(work)}),
                            f".claude/projects/{slug}/sess-1111.jsonl": rate_jsonl,
                        },
                    },
                    {"exit_code": 0, "stdout": "resumed interactive ok\n"},
                ],
            })
            env_a = _mock_env(home, local_a, claude_a)
            res_a = _run_ps(ps_exe, RELAY_PS1, ["--print", "start task"], env_a, work)
            self.assertEqual(res_a.returncode, 0, res_a.stderr + "\n" + res_a.stdout)
            self.assertIn("[Claude-Local Relay] Switched Acct-A -> Acct-B", res_a.stdout)
            self.assertIn("Acct-C has 1 reset card(s)", res_a.stdout)
            tr_a = json.loads(trace_a.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_a["claude_calls"]), 2)
            self.assertEqual(tr_a["claude_calls"][1]["argv"], ["--resume", "sess-1111"])
            sw_a = [c for c in tr_a["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_a), 1)
            self.assertTrue(sw_a[0].get("rate_limited"))

            # Case B: pre-launch switch + -AutoContinue + idempotent Claude-Cage prompt + --session-id=<id>
            case_b = root / "case_b"
            case_b.mkdir()
            home_b = root / "home_b"
            (home_b / ".claude" / "agents").mkdir(parents=True)
            (home_b / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            local_b, claude_b, trace_b, _ = _write_mock_shims(case_b, {
                "orchestrate": {
                    "status": [
                        {"ok": True, "cli_running": False, "should_relay_now": True, "config": {"autoContinueOnRelay": False}},
                        {"ok": True, "cli_running": False, "should_relay_now": True, "config": {"autoContinueOnRelay": False}},
                        {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    ],
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 88,
                        "reason": "reset_harvest",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "write_files": {
                            f".claude/projects/{slug}/sess-2222.jsonl": rate_jsonl,
                        },
                    },
                    {"exit_code": 0, "stdout": "auto continued ok\n"},
                ],
            })
            env_b = _mock_env(home_b, local_b, claude_b)
            res_b = _run_ps(
                ps_exe,
                RELAY_PS1,
                ["-AutoContinue", "-Strategy", "reset_harvest", "-ThresholdPct", "95", "--settings", "{}", "--session-id=sess-2222"],
                env_b,
                work,
            )
            self.assertEqual(res_b.returncode, 0, res_b.stderr + "\n" + res_b.stdout)
            tr_b = json.loads(trace_b.read_text(encoding="utf-8"))
            switch_calls = [c for c in tr_b["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(switch_calls), 2)
            self.assertEqual(switch_calls[0].get("strategy"), "reset_harvest")
            self.assertEqual(switch_calls[0].get("threshold_pct"), 95)
            self.assertEqual(
                tr_b["claude_calls"][1]["argv"],
                ["--resume", "sess-2222", "--settings", "{}", "--", DEFAULT_CONT_PROMPT],
            )
            self.assertEqual(tr_b["claude_calls"][0]["env"]["CLAUDE_LOCAL_RELAY_THRESHOLD"], "95")

            # Case C: config.autoContinueOnRelay=True + custom -ContinuationPrompt + anti-spin stops before MaxRelays=5
            case_c = root / "case_c"
            case_c.mkdir()
            home_c = root / "home_c"
            (home_c / ".claude" / "agents").mkdir(parents=True)
            (home_c / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            local_c, claude_c, trace_c, _ = _write_mock_shims(case_c, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": True, "relay_trigger_kind": "threshold_reached", "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 75,
                        "reason": "pace",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "write_files": {
                            f".claude/projects/{slug}/sess-3333.jsonl": rate_jsonl,
                        },
                    }
                ],
            })
            env_c = _mock_env(home_c, local_c, claude_c)
            res_c = _run_ps(ps_exe, RELAY_PS1, ["-MaxRelays", "5", "-ContinuationPrompt", "Keep auditing", "--settings", "{}"], env_c, work)
            self.assertNotEqual(res_c.returncode, 0)
            self.assertIn("Anti-spin guard", res_c.stdout)
            tr_c = json.loads(trace_c.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_c["claude_calls"]), 3)
            self.assertEqual(tr_c["claude_calls"][1]["argv"], ["--resume", "sess-3333", "--settings", "{}", "--", "Keep auditing"])

            # Case D: StopFailure with error_details=None + last_assistant_message + unlisted boolean flag + variadic --allowedTools
            case_d = root / "case_d"
            case_d.mkdir()
            home_d = root / "home_d"
            (home_d / ".claude" / "agents").mkdir(parents=True)
            (home_d / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            local_d, claude_d, trace_d, _ = _write_mock_shims(case_d, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 88,
                        "reason": "rate_limit_rescue",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "fire_stop_failure": {
                            "hook_event_name": "StopFailure",
                            "error": "unknown",
                            "last_assistant_message": "You've hit your limit · resets 7pm",
                            "session_id": "sess-last-msg-88",
                        },
                    },
                    {"exit_code": 0, "stdout": "resumed cleanly\n"},
                ],
            })
            env_d = _mock_env(home_d, local_d, claude_d)
            res_d = _run_ps(
                ps_exe,
                RELAY_PS1,
                ["-AutoContinue", "--allowedTools", "Bash", "Read", "--enable-auto-mode", "Initial task prompt"],
                env_d,
                work,
            )
            self.assertEqual(res_d.returncode, 0, res_d.stderr + "\n" + res_d.stdout)
            tr_d = json.loads(trace_d.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_d["claude_calls"]), 2)
            # StopFailure, Stop, and PostToolUse are registered when -AutoContinue is active
            self.assertIn("StopFailure", tr_d["claude_calls"][0]["ephemeral_settings"]["hooks"])
            self.assertIn("Stop", tr_d["claude_calls"][0]["ephemeral_settings"]["hooks"])
            self.assertIn("PostToolUse", tr_d["claude_calls"][0]["ephemeral_settings"]["hooks"])
            # Relay argv MUST NOT duplicate "Initial task prompt", and MUST guard variadic --allowedTools with "--"
            resumed_argv_d = tr_d["claude_calls"][1]["argv"]
            self.assertNotIn("Initial task prompt", resumed_argv_d)
            self.assertEqual(resumed_argv_d[:6], ["--resume", "sess-last-msg-88", "--allowedTools", "Bash", "Read", "--enable-auto-mode"])
            self.assertEqual(resumed_argv_d[-2:], ["--", DEFAULT_CONT_PROMPT])

            # Case E: Clean 95% threshold Stop hook handoff in -AutoContinue mode relays WITHOUT appending ContinuationPrompt!
            case_e = root / "case_e"
            case_e.mkdir()
            home_e = root / "home_e"
            (home_e / ".claude" / "agents").mkdir(parents=True)
            (home_e / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            local_e, claude_e, trace_e, _ = _write_mock_shims(case_e, {
                "orchestrate": {
                    "status": [
                        {"ok": True, "cli_running": False, "should_relay_now": False, "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": False}},
                        {"ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "threshold_reached", "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": False}},
                        {"ok": True, "cli_running": False, "should_relay_now": True, "relay_trigger_kind": "threshold_reached", "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": False}},
                        {"ok": True, "cli_running": False, "should_relay_now": False, "ranked_auto_targets": [], "config": {"autoContinueOnRelay": False}},
                    ],
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_name": "Acct-B",
                        "target_effective_rem": 90,
                        "reason": "threshold_reached",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "fire_stop": {
                            "hook_event_name": "Stop",
                            "stop_hook_active": False,
                            "background_tasks": [],
                            "session_crons": [],
                            "session_id": "sess-clean-95",
                        },
                        "sleep_after_hook_ms": 1450,
                    },
                    {"exit_code": 0, "stdout": "resumed idle at prompt\n"},
                ],
            })
            env_e = _mock_env(home_e, local_e, claude_e)
            res_e = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "95", "--model", "sonnet"], env_e, work)
            self.assertEqual(res_e.returncode, 0, res_e.stderr + "\n" + res_e.stdout)
            tr_e = json.loads(trace_e.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_e["claude_calls"]), 2)
            sw_e = [c for c in tr_e["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_e), 1)
            self.assertFalse(sw_e[0].get("rate_limited", False))
            resumed_argv_e = tr_e["claude_calls"][1]["argv"]
            self.assertNotIn(DEFAULT_CONT_PROMPT, resumed_argv_e)
            self.assertEqual(resumed_argv_e[:4], ["--resume", "sess-clean-95", "--model", "sonnet"])

    def test_relay_exhausted_reports_soonest_reset_and_reset_cards(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            local_cmd, claude_cmd, _, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": True, "config": {}},
                    "relay_switch": {
                        "ok": True,
                        "switched": False,
                        "soonest_reset_ts": 2_000_003_600,
                        "soonest_reset_eta_sec": 3600,
                        "soonest_reset_name": "Acct-A",
                        "reset_card_accounts": [{"name": "Acct-Reset", "manual_resets_remaining": 2}],
                    },
                },
                "claude_runs": [],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            res = _run_ps(ps_exe, RELAY_PS1, [], env, work)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("Soonest reset (Acct-A)", res.stdout)
            self.assertIn("Acct-Reset (manual_resets_remaining=2)", res.stdout)

            # Fallback to relative pool.soonestResetSec ETA when switch omits soonest_reset_ts
            eta_dir = root / "eta_fallback"
            eta_dir.mkdir()
            local_eta, claude_eta, _, _ = _write_mock_shims(eta_dir, {
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "cli_running": False,
                        "should_relay_now": True,
                        "pool": {"soonestResetSec": 5400},
                        "config": {},
                    },
                    "relay_switch": {"ok": True, "switched": False, "reset_card_accounts": []},
                },
                "claude_runs": [],
            })
            env_eta = _mock_env(home, local_eta, claude_eta)
            res_eta = _run_ps(ps_exe, RELAY_PS1, [], env_eta, work)
            self.assertNotEqual(res_eta.returncode, 0)
            self.assertIn("(in 1h 30m)", res_eta.stdout)
            self.assertNotIn("1970-", res_eta.stdout)
            self.assertNotIn("1969-", res_eta.stdout)

    def test_subagent_slot_acquire_isolation_and_release_in_both_ps_engines(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        for ps_exe in shells:
            with self.subTest(shell=Path(ps_exe).name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                home, work = root / "home", root / "work"
                slot_dir = root / "appdata" / "ai.local.claude-local" / "cli-slots" / ("01234567" * 4)
                out_file = root / "out" / "subagent.md"
                home.mkdir()
                work.mkdir()
                slot_dir.mkdir(parents=True)

                local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                    "orchestrate": {
                        "status": {
                            "ok": True,
                            "config": {"maxSameExitConcurrency": 2},
                            "pool": {"readyCount": 1, "lowCount": 1, "avg5hRemainingPct": 85, "avgRem7dPct": 70, "totalManualResetsRemaining": 2},
                            "accounts": [{"id": "01234567" * 4, "name": "Pro-Slot-2", "rem_5h": 85, "rem_7d": 70, "proxy": "http://127.0.0.1:7899"}],
                            "slot_sessions": {},
                        },
                        "slot_acquire": [
                            {"ok": False, "status": "concurrency_capped", "retry_after_ms": 50, "reason": "relay.error.slotConcurrencyCapped"},
                            {
                                "ok": True,
                                "status": "acquired",
                                "record_id": "01234567" * 4,
                                "name": "Pro-Slot-2",
                                "slot_dir": str(slot_dir),
                                "proxy": "http://127.0.0.1:7899",
                                "jitter_ms": 10,
                            },
                        ],
                        "slot_release": {"ok": True, "status": "released"},
                    },
                    "claude_runs": [{
                        "exit_code": 0,
                        "stdout": json.dumps({
                            "type": "result",
                            "result": "Verified slot output",
                            "session_id": "uuid-slot-session-42",
                            "is_error": False,
                        }),
                    }],
                })
                env = _mock_env(
                    home,
                    local_cmd,
                    claude_cmd,
                    ANTHROPIC_API_KEY="sk-must-be-scrubbed",
                    ANTHROPIC_AUTH_TOKEN="tok-must-be-scrubbed",
                    ANTHROPIC_BASE_URL="https://evil.invalid",
                    CLAUDE_CODE_OAUTH_TOKEN="oauth-must-be-scrubbed",
                    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR="9",
                    CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR="8",
                    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1",
                    CLAUDE_CODE_USE_BEDROCK="1",
                    CLAUDE_CODE_USE_VERTEX="1",
                    CLAUDE_CODE_USE_FOUNDRY="1",
                    CLAUDE_CODE_USE_GATEWAY="1",
                    CLAUDE_CODE_SIMPLE="1",
                    CLAUDECODE="1",
                    CLAUDE_CODE_ENTRYPOINT="cli",
                    HTTP_PROXY="http://127.0.0.1:9999",
                )
                res_st = _run_ps(ps_exe, SUBAGENT_PS1, ["-Status"], env, work)
                self.assertEqual(res_st.returncode, 0, res_st.stderr)
                self.assertIn("Pro-Slot-2", res_st.stdout)
                self.assertIn("Max Same-Exit Concurrency : 2", res_st.stdout)
                trace_file.write_text(json.dumps({"orchestrate_calls": [], "claude_calls": []}), encoding="utf-8")

                res = _run_ps(
                    ps_exe,
                    SUBAGENT_PS1,
                    [
                        "-Prompt", "Audit files",
                        "-AccountId", "01234567" * 4,
                        "-SessionTag", "tag-a",
                        "-Model", "sonnet",
                        "-Effort", "high",
                        "-ReadOnly",
                        "-OutputFile", str(out_file),
                    ],
                    env,
                    work,
                )
                self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
                self.assertIn("Verified slot output", res.stdout)
                self.assertIn("[CL-SLOT-TRACE] account=Pro-Slot-2 slot=01234567 session=uuid-slot-session-42 failovers=0", res.stdout)
                self.assertTrue(out_file.is_file())
                out_raw = out_file.read_bytes()
                self.assertNotIn(b"\r", out_raw)
                self.assertIn("Verified slot output", out_raw.decode("utf-8"))

                tr = json.loads(trace_file.read_text(encoding="utf-8"))
                ops = [c.get("op") for c in tr["orchestrate_calls"]]
                self.assertEqual(ops, ["slot_acquire", "slot_acquire", "slot_release"])
                self.assertEqual(tr["orchestrate_calls"][2]["record_id"], "01234567" * 4)
                self.assertNotIn("rate_limited", tr["orchestrate_calls"][2])

                c_call = tr["claude_calls"][0]
                self.assertEqual(
                    c_call["argv"],
                    ["-p", "Audit files", "--output-format", "json", "--tools", "Read,Grep,Glob", "--model", "sonnet", "--effort", "high"],
                )
                c_env = c_call["env"]
                self.assertEqual(os.path.normcase(c_env["CLAUDE_CONFIG_DIR"]), os.path.normcase(str(slot_dir)))
                self.assertEqual(c_env["HTTP_PROXY"], "http://127.0.0.1:7899")
                self.assertEqual(c_env["HTTPS_PROXY"], "http://127.0.0.1:7899")
                self.assertEqual(c_env["ALL_PROXY"], "http://127.0.0.1:7899")
                self.assertEqual(c_env["GRPC_PROXY"], "http://127.0.0.1:7899")
                self.assertEqual(c_env["NO_PROXY"], "localhost,127.0.0.1,::1")
                self.assertEqual(c_env["DISABLE_TELEMETRY"], "1")
                self.assertEqual(c_env["DISABLE_ERROR_REPORTING"], "1")
                self.assertEqual(c_env["DO_NOT_TRACK"], "1")
                for scrubbed in (
                    "ANTHROPIC_API_KEY",
                    "ANTHROPIC_AUTH_TOKEN",
                    "ANTHROPIC_BASE_URL",
                    "CLAUDE_CODE_OAUTH_TOKEN",
                    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
                    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
                    "CLAUDE_CODE_USE_BEDROCK",
                    "CLAUDE_CODE_USE_VERTEX",
                    "CLAUDE_CODE_USE_FOUNDRY",
                    "CLAUDE_CODE_USE_GATEWAY",
                    "CLAUDE_CODE_SIMPLE",
                    "CLAUDECODE",
                    "CLAUDE_CODE_ENTRYPOINT",
                ):
                    self.assertIsNone(c_env[scrubbed], f"{scrubbed} must be scrubbed")

    def test_subagent_429_and_auth_failover_and_side_effect_guard(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            slot1 = root / "slots" / ("11111111" * 4)
            slot2 = root / "slots" / ("22222222" * 4)
            slot3 = root / "slots" / ("33333333" * 4)
            for d in (home, work, slot1, slot2, slot3):
                d.mkdir(parents=True)

            # 1. Pool auto-pick fails over across 429 (with max reset delay) and 401 auth error onto slot 3
            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "slot_acquire": [
                        {"ok": True, "status": "acquired", "record_id": "11111111" * 4, "name": "Slot-One", "slot_dir": str(slot1), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                        {"ok": True, "status": "acquired", "record_id": "22222222" * 4, "name": "Slot-Two", "slot_dir": str(slot2), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                        {"ok": True, "status": "acquired", "record_id": "33333333" * 4, "name": "Slot-Three", "slot_dir": str(slot3), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    ],
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "stdout": json.dumps({
                            "type": "result",
                            "is_error": True,
                            "num_turns": 1,
                            "result": "You've hit your limit · resets in 1h 20m",
                            "session_id": "sess-429-a",
                        }),
                        "stderr": "HTTP 429 rate_limit_error (Retry-After: 8s)\n",
                    },
                    {
                        "exit_code": 1,
                        "stdout": json.dumps({
                            "type": "result",
                            "is_error": True,
                            "num_turns": 0,
                            "result": "API Error: 401 authentication_error: invalid_grant",
                            "session_id": "sess-401-b",
                        }),
                    },
                    {
                        "exit_code": 0,
                        "stdout": json.dumps({
                            "type": "result",
                            "is_error": False,
                            "num_turns": 2,
                            "result": "Failover succeeded on Slot-Three",
                            "session_id": "sess-ok-c",
                        }),
                    },
                ],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            res = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Analyze architecture"], env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            self.assertIn("Failover succeeded on Slot-Three", res.stdout)
            self.assertIn("[CL-SLOT-TRACE] account=Slot-Three slot=33333333 session=sess-ok-c failovers=2", res.stdout)

            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            acquires = [c for c in tr["orchestrate_calls"] if c.get("op") == "slot_acquire"]
            releases = [c for c in tr["orchestrate_calls"] if c.get("op") == "slot_release"]
            self.assertEqual(len(acquires), 3)
            self.assertNotIn("exclude_record_ids", acquires[0])
            self.assertEqual(acquires[1]["exclude_record_ids"], ["11111111" * 4])
            self.assertEqual(acquires[2]["exclude_record_ids"], ["11111111" * 4, "22222222" * 4])

            self.assertEqual(len(releases), 3)
            # First release: rate_limited=True, max(8s, 1h 20m = 4800s) -> retry_after_sec = 4800
            self.assertEqual(releases[0]["record_id"], "11111111" * 4)
            self.assertTrue(releases[0]["rate_limited"])
            self.assertEqual(releases[0]["retry_after_sec"], 4800)
            # Second release: auth_error=True
            self.assertEqual(releases[1]["record_id"], "22222222" * 4)
            self.assertTrue(releases[1]["auth_error"])
            # Third release: clean success
            self.assertEqual(releases[2]["record_id"], "33333333" * 4)
            self.assertNotIn("rate_limited", releases[2])
            self.assertNotIn("auth_error", releases[2])

            # 2. Side-effect guard: write-capable run with num_turns=3 does NOT auto-failover on mid-task 429
            se_dir = root / "side_effect_guard"
            se_dir.mkdir()
            local_se, claude_se, trace_se, _ = _write_mock_shims(se_dir, {
                "orchestrate": {
                    "slot_acquire": {"ok": True, "status": "acquired", "record_id": "11111111" * 4, "name": "Slot-One", "slot_dir": str(slot1), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [{
                    "exit_code": 1,
                    "stdout": json.dumps({
                        "type": "result",
                        "is_error": True,
                        "num_turns": 3,
                        "result": "5-hour limit reached · retry after 300s",
                        "session_id": "sess-partial-write",
                    }),
                }],
            })
            env_se = _mock_env(home, local_se, claude_se)
            res_se = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Edit files"], env_se, work)
            self.assertNotEqual(res_se.returncode, 0)
            self.assertIn("failovers=0", res_se.stdout)
            tr_se = json.loads(trace_se.read_text(encoding="utf-8"))
            self.assertEqual([c.get("op") for c in tr_se["orchestrate_calls"]], ["slot_acquire", "slot_release"])
            self.assertTrue(tr_se["orchestrate_calls"][1]["rate_limited"])
            self.assertEqual(tr_se["orchestrate_calls"][1]["retry_after_sec"], 300)

    def test_subagent_always_releases_slot_on_child_error(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            slot_dir = root / "slots" / ("abcdef01" * 4)
            home.mkdir()
            work.mkdir()
            slot_dir.mkdir(parents=True)

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "slot_acquire": {
                        "ok": True,
                        "status": "acquired",
                        "record_id": "abcdef01" * 4,
                        "name": "ErrSlot",
                        "slot_dir": str(slot_dir),
                        "proxy": "http://127.0.0.1:7899",
                        "jitter_ms": 0,
                    },
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [{
                    "exit_code": 2,
                    "stdout": json.dumps({"type": "result", "is_error": True, "result": "child failed", "session_id": "uuid-err"}),
                    "stderr": "fatal mock error\n",
                }],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            res = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Run failing task"], env, work)
            self.assertEqual(res.returncode, 2)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual([c.get("op") for c in tr["orchestrate_calls"]], ["slot_acquire", "slot_release"])
            self.assertEqual(tr["orchestrate_calls"][1]["record_id"], "abcdef01" * 4)

    def test_subagent_prompt_file_piped_stdin_and_leading_dash_prompt(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            slot_dir = root / "slots" / ("11223344" * 4)
            prompt_file = root / "prompt.txt"
            home.mkdir()
            work.mkdir()
            slot_dir.mkdir(parents=True)
            prompt_file.write_text("Line one\nLine two", encoding="utf-8")

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "slot_acquire": {
                        "ok": True,
                        "status": "acquired",
                        "record_id": "11223344" * 4,
                        "name": "MultiSlot",
                        "slot_dir": str(slot_dir),
                        "proxy": "http://127.0.0.1:7899",
                        "jitter_ms": 0,
                    },
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [{
                    "exit_code": 0,
                    "stdout": json.dumps({"type": "result", "result": "Multiline OK", "is_error": False}),
                }],
            })
            env = _mock_env(home, local_cmd, claude_cmd)

            # 1. Empty / DEVNULL stdin with no -Prompt / -PromptFile still throws exact error
            res_empty = _run_ps(ps_exe, SUBAGENT_PS1, [], env, work)
            self.assertNotEqual(res_empty.returncode, 0)
            self.assertIn("Either -Prompt or -PromptFile must be provided.", res_empty.stderr + res_empty.stdout)

            # 2. Multiline -PromptFile + -Resume
            res = _run_ps(ps_exe, SUBAGENT_PS1, ["-PromptFile", str(prompt_file), "-Resume", "sess-prev-77"], env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            self.assertIn("[CL-SLOT-TRACE] account=MultiSlot slot=11223344 session=sess-prev-77 failovers=0", res.stdout)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(tr["claude_calls"][0]["argv"], ["-p", "--output-format", "json", "--resume", "sess-prev-77"])
            self.assertEqual(tr["claude_calls"][0]["stdin"], "Line one\nLine two")

            # 3. Leading-dash -Prompt routed safely via stdin instead of argv
            res_dash = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "--model should-not-be-parsed-as-flag"], env, work)
            self.assertEqual(res_dash.returncode, 0, res_dash.stderr + "\n" + res_dash.stdout)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(tr["claude_calls"][1]["argv"], ["-p", "--output-format", "json"])
            self.assertEqual(tr["claude_calls"][1]["stdin"], "--model should-not-be-parsed-as-flag")

            # 4. Piped stdin prompt with no -Prompt / -PromptFile
            res_pipe = _run_ps(ps_exe, SUBAGENT_PS1, ["-ReadOnly"], env, work, stdin_data="Piped task from stdin\n")
            self.assertEqual(res_pipe.returncode, 0, res_pipe.stderr + "\n" + res_pipe.stdout)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(tr["claude_calls"][2]["argv"], ["-p", "--output-format", "json", "--tools", "Read,Grep,Glob"])
            self.assertEqual(tr["claude_calls"][2]["stdin"], "Piped task from stdin\n")

    def test_fail_closed_local_proxy_preflight_in_relay_and_subagent(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            slot_dir = root / "slots" / ("55667788" * 4)
            for d in (home, work, slot_dir):
                d.mkdir(parents=True)

            # Pick an ephemeral port, then close it so nothing listens on it
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            dead_port = sock.getsockname()[1]
            sock.close()

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {}},
                    "slot_acquire": {
                        "ok": True,
                        "status": "acquired",
                        "record_id": "55667788" * 4,
                        "name": "ProxySlot",
                        "slot_dir": str(slot_dir),
                        "proxy": f"http://127.0.0.1:{dead_port}",
                        "jitter_ms": 0,
                    },
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [{"exit_code": 0, "stdout": json.dumps({"type": "result", "result": "ok", "is_error": False})}],
            })

            # 1. claude-relay fails closed when settings.local.json points to dead local proxy
            (home / ".claude").mkdir(parents=True, exist_ok=True)
            (home / ".claude" / "settings.local.json").write_text(
                json.dumps({"env": {"HTTPS_PROXY": f"http://127.0.0.1:{dead_port}"}}),
                encoding="utf-8",
            )
            env_live_preflight = _mock_env(
                home,
                local_cmd,
                claude_cmd,
                CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT="0",
                HTTPS_PROXY="",
                HTTP_PROXY="",
                ALL_PROXY="",
                https_proxy="",
                http_proxy="",
                all_proxy="",
            )
            res_relay_fail = _run_ps(ps_exe, RELAY_PS1, ["--print", "hi"], env_live_preflight, work)
            self.assertNotEqual(res_relay_fail.returncode, 0)
            self.assertIn("Local proxy unreachable", res_relay_fail.stderr + res_relay_fail.stdout)
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr["claude_calls"]), 0)

            # 2. claude-subagent fails closed AND still releases the acquired slot in finally!
            trace_file.write_text(json.dumps({"orchestrate_calls": [], "claude_calls": []}), encoding="utf-8")
            res_sub_fail = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "hi"], env_live_preflight, work)
            self.assertNotEqual(res_sub_fail.returncode, 0)
            self.assertIn("Local slot proxy unreachable", res_sub_fail.stderr + res_sub_fail.stdout)
            tr2 = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr2["claude_calls"]), 0)
            self.assertEqual([c.get("op") for c in tr2["orchestrate_calls"]], ["slot_acquire", "slot_release"])

            # 3. With a live local TCP listener, settings.local.json overrides inherited shell :7900 proxy and preflight succeeds in <250ms
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.bind(("127.0.0.1", 0))
            listener.listen(4)
            live_port = listener.getsockname()[1]
            try:
                (home / ".claude" / "settings.local.json").write_text(
                    json.dumps({"env": {"HTTPS_PROXY": f"http://127.0.0.1:{live_port}"}}),
                    encoding="utf-8",
                )
                env_hijack_attempt = {
                    **env_live_preflight,
                    "HTTPS_PROXY": f"http://127.0.0.1:{dead_port}",
                    "ANTHROPIC_API_KEY": "sk-hijack",
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                }
                trace_file.write_text(json.dumps({"orchestrate_calls": [], "claude_calls": []}), encoding="utf-8")
                res_relay_ok = _run_ps(ps_exe, RELAY_PS1, ["--print", "hi"], env_hijack_attempt, work)
                self.assertEqual(res_relay_ok.returncode, 0, res_relay_ok.stderr + "\n" + res_relay_ok.stdout)
                tr_ok = json.loads(trace_file.read_text(encoding="utf-8"))
                r_env = tr_ok["claude_calls"][0]["env"]
                self.assertEqual(r_env["HTTPS_PROXY"], f"http://127.0.0.1:{live_port}")
                self.assertEqual(r_env["NO_PROXY"], "localhost,127.0.0.1,::1")
                self.assertEqual(r_env["DISABLE_TELEMETRY"], "1")
                self.assertIsNone(r_env["ANTHROPIC_API_KEY"])
                self.assertIsNone(r_env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"])
            finally:
                listener.close()

            # 4. Missing proxy fails closed unless CLAUDE_LOCAL_ALLOW_DIRECT=1
            (home / ".claude" / "settings.local.json").unlink()
            res_missing = _run_ps(ps_exe, RELAY_PS1, ["--print", "hi"], env_live_preflight, work)
            self.assertNotEqual(res_missing.returncode, 0)
            self.assertIn("Explicit HTTP proxy required", res_missing.stderr + res_missing.stdout)

            env_allow_direct = {**env_live_preflight, "CLAUDE_LOCAL_ALLOW_DIRECT": "1"}
            res_direct_ok = _run_ps(ps_exe, RELAY_PS1, ["--print", "hi"], env_allow_direct, work)
            self.assertEqual(res_direct_ok.returncode, 0, res_direct_ok.stderr + "\n" + res_direct_ok.stdout)

    def test_double_dash_splicing_print_autocontinue_presession_429_slotproxy_and_turn1_tool_guard(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            app_dir = appdata / "ai.local.claude-local"
            for d in (home, work, app_dir):
                d.mkdir(parents=True)

            # 1. `--` splicing + pre-session 429 (no session_id written on Run 0) + slotProxies[active_id]
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.bind(("127.0.0.1", 0))
            listener.listen(4)
            slot_port = listener.getsockname()[1]
            try:
                id_a = "a" * 32
                id_b = "b" * 32
                (app_dir / "smart_relay_v1.json").write_text(
                    json.dumps({"schema": 1, "slotProxies": {id_a: f"http://127.0.0.1:{slot_port}", id_b: f"http://127.0.0.1:{slot_port}"}}),
                    encoding="utf-8",
                )
                d1 = root / "dd_presess"
                d1.mkdir()
                local_1, claude_1, trace_1, _ = _write_mock_shims(d1, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                        "relay_switch": {"ok": True, "switched": True, "from_name": "A", "target_id": id_b, "target_name": "B", "reason": "rate_limited"},
                    },
                    "claude_runs": [
                        {
                            "exit_code": 1,
                            "fire_stop_failure": {"hook_event_name": "StopFailure", "error": "rate_limit", "error_details": "429 pre-session"},
                        },
                        {"exit_code": 0, "stdout": "completed on B\n"},
                    ],
                })
                env_1 = _mock_env(
                    home,
                    local_1,
                    claude_1,
                    APPDATA=str(appdata),
                    CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT="0",
                    HTTPS_PROXY="",
                    HTTP_PROXY="",
                )
                res_1 = _run_ps(ps_exe, RELAY_PS1, ["--model", "opus", "--", "- Fix leading dash prompt"], env_1, work)
                self.assertEqual(res_1.returncode, 0, res_1.stderr + "\n" + res_1.stdout)
                tr_1 = json.loads(trace_1.read_text(encoding="utf-8"))
                self.assertEqual(len(tr_1["claude_calls"]), 2)
                for c_idx in (0, 1):
                    argv_c = tr_1["claude_calls"][c_idx]["argv"]
                    dd_pos = argv_c.index("--")
                    self.assertLess(argv_c.index("--settings"), dd_pos, f"Run {c_idx}: --settings must appear BEFORE --")
                    self.assertEqual(argv_c[dd_pos:], ["--", "- Fix leading dash prompt"])
                    self.assertNotIn("--continue", argv_c)
                    self.assertEqual(tr_1["claude_calls"][c_idx]["env"]["HTTPS_PROXY"], f"http://127.0.0.1:{slot_port}")
            finally:
                listener.close()

            # 2. `-p -AutoContinue` preserves `-p` headless mode on relay when session_id exists
            d2 = root / "print_auto"
            d2.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            rate_jsonl = json.dumps({
                "type": "assistant",
                "isApiErrorMessage": True,
                "error": "rate_limit",
                "message": {"content": "You've hit your limit"},
            }) + "\n"
            local_2, claude_2, trace_2, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "write_files": {f".claude/projects/{slug}/sess-print-77.jsonl": rate_jsonl},
                    },
                    {"exit_code": 0, "stdout": "headless print continued\n"},
                ],
            })
            env_2 = _mock_env(home, local_2, claude_2)
            res_2 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-p", "--model", "sonnet", "Run batch"], env_2, work)
            self.assertEqual(res_2.returncode, 0, res_2.stderr + "\n" + res_2.stdout)
            tr_2 = json.loads(trace_2.read_text(encoding="utf-8"))
            self.assertEqual(
                tr_2["claude_calls"][1]["argv"],
                ["--resume", "sess-print-77", "-p", "--model", "sonnet", "--", DEFAULT_CONT_PROMPT],
            )

            # 3. Subagent Turn-1 mutating `tool_use` in slot projects/*.jsonl blocks write-capable failover
            slot_mut = root / "slots" / ("99999999" * 4)
            (slot_mut / "projects" / "demo").mkdir(parents=True)
            (slot_mut / "projects" / "demo" / "sess-mut-1.jsonl").write_text(
                json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "tu_1", "name": "Write"}]}}) + "\n",
                encoding="utf-8",
            )
            d3 = root / "sub_mut"
            d3.mkdir()
            local_3, claude_3, trace_3, _ = _write_mock_shims(d3, {
                "orchestrate": {
                    "slot_acquire": {"ok": True, "status": "acquired", "record_id": "99999999" * 4, "name": "MutSlot", "slot_dir": str(slot_mut), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [{
                    "exit_code": 1,
                    "stdout": json.dumps({"type": "result", "is_error": True, "num_turns": 1, "result": "HTTP 429 rate_limit_error", "session_id": "sess-mut-1"}),
                }],
            })
            env_3 = _mock_env(home, local_3, claude_3)
            res_3 = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Mutate file"], env_3, work)
            self.assertNotEqual(res_3.returncode, 0)
            tr_3 = json.loads(trace_3.read_text(encoding="utf-8"))
            self.assertEqual([c.get("op") for c in tr_3["orchestrate_calls"]], ["slot_acquire", "slot_release"])

    def test_background_shell_continued_in_resume_and_stopfailure_has_bg(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            for d in (home, work):
                d.mkdir(parents=True)

            # 1. Interactive 429 session where `/exit` ("2. Move to background and exit") appends `continued-in`
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            orig_jsonl = (
                json.dumps({
                    "type": "assistant",
                    "isApiErrorMessage": True,
                    "error": "rate_limit",
                    "message": {"content": "You've hit your limit"},
                })
                + "\n"
                + json.dumps({
                    "type": "continued-in",
                    "timestamp": "2026-11-18T12:00:00.000Z",
                    "sessionId": "sess-orig-fg-11",
                    "continuedInSessionId": "sess-fork-bg-22",
                })
                + "\n"
            )
            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "cli_running": False,
                        "should_relay_now": False,
                        "active": "a" * 32,
                        "config": {"autoContinueOnRelay": True},
                    },
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_id": "b" * 32,
                        "target_name": "Acct-B",
                        "reason": "rate_limited",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "write_files": {
                            f".claude/projects/{slug}/sess-orig-fg-11.jsonl": orig_jsonl,
                            f".claude/projects/{slug}/sess-fork-bg-22.jsonl": json.dumps({"type": "user", "message": {"role": "user", "content": "bg task"}}) + "\n",
                        },
                        "fire_stop_failure": {
                            "hook_event_name": "StopFailure",
                            "error": "rate_limit",
                            "error_details": "5-hour limit reached",
                            "session_id": "sess-orig-fg-11",
                            "background_tasks": [{"id": "b_shell_1", "type": "local_bash"}],
                        },
                        "sleep_after_hook_ms": 950,
                    },
                    {
                        "exit_code": 0,
                        "stdout": "Adopted background shell on Acct-B\n",
                    },
                ],
            })
            env = _mock_env(home, local_cmd, claude_cmd, CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT="0")
            res = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "--model", "opus"], env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            self.assertIn("Switched Acct-A -> Acct-B", res.stdout)
            self.assertIn("Adopted background shell on Acct-B", res.stdout)

            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr["claude_calls"]), 2)
            trig_snap = tr["claude_calls"][0].get("trigger_snapshot") or {}
            self.assertEqual(trig_snap.get("reason"), "rate_limit")
            self.assertIs(trig_snap.get("has_bg"), True)

            # Run 2 MUST resume the forked background session `sess-fork-bg-22` (not the closed `sess-orig-fg-11`)!
            run2_argv = tr["claude_calls"][1]["argv"]
            self.assertEqual(run2_argv[:2], ["--resume", "sess-fork-bg-22"])
            self.assertIn("--model", run2_argv)
            self.assertEqual(run2_argv[-2:], ["--", DEFAULT_CONT_PROMPT])

    def test_case_variant_proxy_keys_in_settings_json_parsed_across_ps51_and_pwsh7(self):
        for ps_exe in [s for s in (shutil.which("powershell.exe"), shutil.which("pwsh")) if s]:
            with self.subTest(shell=Path(ps_exe).name), tempfile.TemporaryDirectory(prefix="cl-dupkey-") as tmp:
                root = Path(tmp)
                work = root / "workspace"
                work.mkdir()
                home = root / "home"
                (home / ".claude" / "agents").mkdir(parents=True)
                (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
                # Both uppercase and lowercase proxy keys in "env" previously caused ConvertFrom-Json duplicate-key failure!
                (home / ".claude" / "settings.json").write_text(
                    '{\n'
                    '  "env": {\n'
                    '    "ALL_PROXY": "http://127.0.0.1:7899",\n'
                    '    "HTTPS_PROXY": "http://127.0.0.1:7899",\n'
                    '    "HTTP_PROXY": "http://127.0.0.1:7899",\n'
                    '    "all_proxy": "http://127.0.0.1:7899",\n'
                    '    "https_proxy": "http://127.0.0.1:7899",\n'
                    '    "http_proxy": "http://127.0.0.1:7899"\n'
                    '  }\n'
                    '}\n',
                    encoding="utf-8",
                )
                local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    },
                    "claude_runs": [{"exit_code": 0, "stdout": "proxy parsed ok\n"}],
                })
                env = _mock_env(home, local_cmd, claude_cmd)
                for pk in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "CLAUDE_LOCAL_ALLOW_DIRECT"):
                    env.pop(pk, None)
                res = _run_ps(ps_exe, RELAY_PS1, ["--version"], env, work)
                self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
                tr = json.loads(trace_file.read_text(encoding="utf-8"))
                self.assertEqual(tr["claude_calls"][0]["env"]["HTTPS_PROXY"], "http://127.0.0.1:7899")
                self.assertEqual(tr["claude_calls"][0]["env"]["HTTP_PROXY"], "http://127.0.0.1:7899")

    def test_default_cli_model_and_effort_injected_across_relay_and_cli_override_wins(self):
        with tempfile.TemporaryDirectory(prefix="cl-model-effort-") as tmp:
            root = Path(tmp)
            work = root / "workspace"
            work.mkdir()
            home = root / "home"
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")

            ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
            self.assertIsNotNone(ps_exe)

            # Case 1: defaultCliModel="claude-opus-5-5" + defaultCliEffort="max" injected on Run 0 AND Run 1 (--resume)
            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": [
                        {
                            "ok": True,
                            "active": "acct-a",
                            "active_name": "Acct-A",
                            "cli_running": False,
                            "should_relay_now": False,
                            "config": {
                                "strategy": "smart",
                                "spentThresholdPct": 95,
                                "autoContinueOnRelay": True,
                                "defaultCliModel": "claude-opus-5-5",
                                "defaultCliEffort": "max",
                            },
                        },
                        {
                            "ok": True,
                            "active": "acct-a",
                            "active_name": "Acct-A",
                            "cli_running": False,
                            "should_relay_now": True,
                            "config": {
                                "strategy": "smart",
                                "spentThresholdPct": 95,
                                "autoContinueOnRelay": True,
                                "defaultCliModel": "claude-opus-5-5",
                                "defaultCliEffort": "max",
                            },
                        },
                        {
                            "ok": True,
                            "active": "acct-b",
                            "active_name": "Acct-B",
                            "cli_running": False,
                            "should_relay_now": False,
                            "config": {
                                "strategy": "smart",
                                "spentThresholdPct": 95,
                                "autoContinueOnRelay": True,
                                "defaultCliModel": "claude-opus-5-5",
                                "defaultCliEffort": "max",
                            },
                        },
                    ],
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_id": "acct-b",
                        "target_name": "Acct-B",
                        "target_effective_rem": 100,
                        "reason": "rate_limited",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "fire_stop_failure": {
                            "error": "rate_limit",
                            "session_id": "sess-opus-max-01",
                        },
                    },
                    {
                        "exit_code": 0,
                        "stdout": "Resumed with Opus 5.5 max\n",
                    },
                ],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            res = _run_ps(ps_exe, RELAY_PS1, ["--", "Implement solver"], env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            self.assertIn("Model: claude-opus-5-5 (max)", res.stdout)
            self.assertIn("Switched Acct-A -> Acct-B", res.stdout)

            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr["claude_calls"]), 2)
            run0_argv = tr["claude_calls"][0]["argv"]
            dd0 = run0_argv.index("--")
            self.assertIn("--model", run0_argv[:dd0])
            self.assertEqual(run0_argv[run0_argv.index("--model") + 1], "claude-opus-5-5")
            self.assertIn("--effort", run0_argv[:dd0])
            self.assertEqual(run0_argv[run0_argv.index("--effort") + 1], "max")
            self.assertEqual(run0_argv[dd0 + 1:], ["Implement solver"])

            run1_argv = tr["claude_calls"][1]["argv"]
            dd1 = run1_argv.index("--")
            self.assertEqual(run1_argv[:2], ["--resume", "sess-opus-max-01"])
            self.assertIn("--model", run1_argv[:dd1])
            self.assertEqual(run1_argv[run1_argv.index("--model") + 1], "claude-opus-5-5")
            self.assertIn("--effort", run1_argv[:dd1])
            self.assertEqual(run1_argv[run1_argv.index("--effort") + 1], "max")

            # Case 2: Explicit CLI --model sonnet --effort high overrides config without duplicate flags
            trace_file.write_text(json.dumps({"orchestrate_calls": [], "claude_calls": []}), encoding="utf-8")
            (root / "mock_state.json").write_text(json.dumps({
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "active": "acct-b",
                        "active_name": "Acct-B",
                        "cli_running": False,
                        "should_relay_now": False,
                        "config": {
                            "defaultCliModel": "claude-opus-5-5",
                            "defaultCliEffort": "max",
                        },
                    },
                },
                "claude_runs": [{"exit_code": 0, "stdout": "override ok\n"}],
            }), encoding="utf-8")
            res2 = _run_ps(ps_exe, RELAY_PS1, ["--model", "sonnet", "--effort", "high"], env, work)
            self.assertEqual(res2.returncode, 0, res2.stderr + "\n" + res2.stdout)
            tr2 = json.loads(trace_file.read_text(encoding="utf-8"))
            override_argv = tr2["claude_calls"][0]["argv"]
            self.assertEqual(override_argv.count("--model"), 1)
            self.assertEqual(override_argv[override_argv.index("--model") + 1], "sonnet")
            self.assertEqual(override_argv.count("--effort"), 1)
            self.assertEqual(override_argv[override_argv.index("--effort") + 1], "high")

    def test_ephemeral_hook_command_is_git_bash_safe_without_backslashes(self):
        with tempfile.TemporaryDirectory(prefix="cl-bash-hook-") as tmp:
            root = Path(tmp)
            work = root / "workspace"
            work.mkdir()
            home = root / "home"
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")

            git_bash = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
            if not git_bash or not Path(git_bash).is_file():
                git_exe = shutil.which("git")
                git_bash = None
                if git_exe:
                    gp = Path(git_exe).resolve()
                    for cand in (gp.parent.parent / "usr" / "bin" / "bash.exe", gp.parent.parent / "bin" / "bash.exe"):
                        if cand.is_file():
                            git_bash = str(cand)
                            break

            ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
            self.assertIsNotNone(ps_exe)

            run_spec = {
                "exit_code": 0,
                "fire_stop": {
                    "hook_event_name": "Stop",
                    "session_id": "sess-gitbash-01",
                    "transcript_path": "",
                    "stop_hook_active": False,
                },
            }
            if git_bash:
                run_spec["hook_bash_exe"] = git_bash

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "active": "acct-a",
                        "active_name": "Acct-A",
                        "cli_running": False,
                        "should_relay_now": False,
                        "config": {"autoContinueOnRelay": True},
                    },
                },
                "claude_runs": [run_spec],
            })
            env = _mock_env(home, local_cmd, claude_cmd)
            res = _run_ps(ps_exe, RELAY_PS1, [], env, work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)

            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            call0 = tr["claude_calls"][0]
            hooks = call0["ephemeral_settings"]["hooks"]
            for event_key in ("Stop", "StopFailure", "PostToolUse"):
                cmd_str = hooks[event_key][0]["hooks"][0]["command"]
                self.assertNotIn("\\", cmd_str, f"{event_key} hook command must use forward slashes for Git Bash: {cmd_str}")
                self.assertTrue(cmd_str.startswith('"'), f"{event_key} hook command should quote executable path: {cmd_str}")

            hook_res = call0.get("stop_hook_result") or {}
            self.assertEqual(hook_res.get("returncode"), 0, hook_res)
            self.assertEqual(hook_res.get("stderr"), "", hook_res)
            turn_end = call0.get("turn_end_snapshot") or {}
            self.assertEqual(turn_end.get("event"), "Stop")
            self.assertEqual(turn_end.get("session_id"), "sess-gitbash-01")

    def test_relay_autocontinue_false_overrides_config_and_preferred_recovered_no_yank(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory(prefix="cl-ac-override-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            appdata.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()

            # 1. Explicit -AutoContinue:$false overrides config.autoContinueOnRelay=True
            d1 = root / "override_false"
            d1.mkdir()
            local_1, claude_1, trace_1, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "cli_running": False,
                        "should_relay_now": False,
                        "active": "a" * 32,
                        "active_name": "Acct-A",
                        "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                    },
                    "relay_switch": {
                        "_same_account": True,
                        "ok": True,
                        "switched": True,
                        "from_name": "Acct-A",
                        "target_id": "b" * 32,
                        "target_name": "Acct-B",
                        "reason": "rate_limited",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "fire_stop_failure": {
                            "hook_event_name": "StopFailure",
                            "error": "rate_limit",
                            "session_id": "sess-ac-false-01",
                        },
                    },
                    {"exit_code": 0, "stdout": "resumed interactively without prompt\n"},
                ],
            })
            env_1 = _mock_env(home, local_1, claude_1)
            res_1 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue:$false"], env_1, work)
            self.assertEqual(res_1.returncode, 0, res_1.stderr + "\n" + res_1.stdout)
            self.assertNotIn("auto-continue", res_1.stdout)
            tr_1 = json.loads(trace_1.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_1["claude_calls"]), 2)
            self.assertNotIn("Stop", tr_1["claude_calls"][0]["ephemeral_settings"]["hooks"])
            self.assertNotIn("PostToolUse", tr_1["claude_calls"][0]["ephemeral_settings"]["hooks"])
            self.assertNotIn(DEFAULT_CONT_PROMPT, tr_1["claude_calls"][1]["argv"])

            # 2. relay_trigger_kind == "preferred_recovered" must NEVER yank on clean Stop or manual /exit!
            d2 = root / "pref_no_yank"
            d2.mkdir()
            local_2, claude_2, trace_2, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "status": [
                        {"ok": True, "cli_running": False, "should_relay_now": False, "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": True}},
                        {"ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "preferred_recovered", "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": True}},
                        {"ok": True, "cli_running": False, "should_relay_now": True, "relay_trigger_kind": "preferred_recovered", "ranked_auto_targets": ["b" * 32], "config": {"autoContinueOnRelay": True}},
                    ],
                    "relay_switch": {"ok": True, "switched": True, "target_name": "ShouldNotSwitch"},
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "fire_stop": {
                            "hook_event_name": "Stop",
                            "stop_hook_active": False,
                            "session_id": "sess-pref-healthy-01",
                        },
                        "sleep_after_hook_ms": 1400,
                    },
                ],
            })
            env_2 = _mock_env(home, local_2, claude_2)
            res_2 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue"], env_2, work)
            self.assertEqual(res_2.returncode, 0, res_2.stderr + "\n" + res_2.stdout)
            tr_2 = json.loads(trace_2.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_2["claude_calls"]), 1)
            self.assertFalse(any(c.get("op") == "relay_switch" for c in tr_2["orchestrate_calls"]))

    def test_relay_stop_hook_rate_limit_precedence_and_windowsapps_stub_fallback(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory(prefix="cl-stop-stub-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            appdata.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()

            # 1. Stop hook with has_bg=True AND rate-limit in last_assistant_message writes trigger.json (not turn_end.json)
            d1 = root / "stop_rl"
            d1.mkdir()
            local_1, claude_1, trace_1, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "fire_stop": {
                            "hook_event_name": "Stop",
                            "last_assistant_message": "You've hit your 5-hour limit · resets 5pm",
                            "background_tasks": [{"id": "bg1"}],
                            "session_id": "sess-stop-rl-01",
                        },
                    },
                    {"exit_code": 0, "stdout": "relayed from Stop rate_limit\n"},
                ],
            })
            env_1 = _mock_env(home, local_1, claude_1)
            res_1 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue"], env_1, work)
            self.assertEqual(res_1.returncode, 0, res_1.stderr + "\n" + res_1.stdout)
            tr_1 = json.loads(trace_1.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_1["claude_calls"]), 2)
            trig = tr_1["claude_calls"][0].get("trigger_snapshot") or {}
            self.assertEqual(trig.get("reason"), "rate_limit")
            self.assertIs(trig.get("has_bg"), True)
            self.assertIsNone(tr_1["claude_calls"][0].get("turn_end_snapshot"))

            # 2. WindowsApps 0-byte python.exe + failing py.cmd stubs are rejected -> falls back to sentinel_hook.ps1
            stub_dir = root / "Microsoft" / "WindowsApps"
            stub_dir.mkdir(parents=True)
            (stub_dir / "python.exe").write_bytes(b"")
            (stub_dir / "py.cmd").write_text("@echo off\r\nexit /b 9009\r\n", encoding="utf-8")
            d2 = root / "winapps_stub"
            d2.mkdir()
            local_2, claude_2, trace_2, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "fire_stop": {
                            "hook_event_name": "Stop",
                            "last_assistant_message": "Usage limit reached",
                            "background_tasks": [{"id": "bg2"}],
                            "session_id": "sess-ps-fallback-02",
                        },
                    },
                    {"exit_code": 0, "stdout": "fallback ps1 hook worked\n"},
                ],
            })
            ps_dir = str(Path(ps_exe).parent)
            sys32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
            isolated_path = os.pathsep.join([str(stub_dir), ps_dir, sys32])
            env_2 = _mock_env(home, local_2, claude_2, PATH=isolated_path)
            res_2 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue"], env_2, work)
            self.assertEqual(res_2.returncode, 0, res_2.stderr + "\n" + res_2.stdout)
            tr_2 = json.loads(trace_2.read_text(encoding="utf-8"))
            cmd_str = tr_2["claude_calls"][0]["ephemeral_settings"]["hooks"]["StopFailure"][0]["hooks"][0]["command"]
            self.assertIn("sentinel_hook.ps1", cmd_str)
            self.assertEqual((tr_2["claude_calls"][0].get("trigger_snapshot") or {}).get("reason"), "rate_limit")

    def test_relay_transcript_429_metadata_no_clear_subagent_scan_and_live_polling(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory(prefix="cl-tr-429-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            appdata.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))

            # 1. apiErrorStatus:429 followed by metadata records + empty assistant must NOT clear sawRateLimit
            d1 = root / "meta_noclear"
            d1.mkdir()
            jsonl_meta = "\n".join([
                json.dumps({"type": "assistant", "apiErrorStatus": 429, "message": {"content": "You've hit your 5-hour limit"}}),
                json.dumps({"type": "cost-state", "totalCostUSD": 1.2}),
                json.dumps({"type": "last-prompt", "prompt": "hi"}),
                json.dumps({"type": "tools-used", "tools": ["Read"]}),
                json.dumps({"type": "queue-operation", "op": "drain"}),
                json.dumps({"type": "system", "content": "status update"}),
                json.dumps({"type": "session-owner", "accountUuid": "u1"}),
                json.dumps({"type": "atis-latch", "latched": True}),
                json.dumps({"type": "assistant", "message": {"content": []}}),
            ]) + "\n"
            local_1, claude_1, trace_1, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {f".claude/projects/{slug}/sess-meta-429.jsonl": jsonl_meta}},
                    {"exit_code": 0, "stdout": "rescued meta 429\n"},
                ],
            })
            res_1 = _run_ps(ps_exe, RELAY_PS1, ["--session-id=sess-meta-429"], _mock_env(home, local_1, claude_1), work)
            self.assertEqual(res_1.returncode, 0, res_1.stderr + "\n" + res_1.stdout)
            tr_1 = json.loads(trace_1.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_1["claude_calls"]), 2)

            # 2. Subagent transcript 429 + non-AutoContinue live polling hint
            d2 = root / "sub_live"
            d2.mkdir()
            local_2, claude_2, trace_2, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 130,
                        "write_files": {
                            f".claude/projects/{slug}/sess-sub-live.jsonl": json.dumps({"type": "user", "message": {"content": "start"}}) + "\n",
                            f".claude/projects/{slug}/sess-sub-live/subagents/agent-sub1.jsonl": json.dumps({
                                "type": "system",
                                "content": "Usage limit reached · continuing automatically at 3pm · esc to cancel",
                            }) + "\n",
                        },
                        "sleep_after_hook_ms": 2400,
                    },
                    {"exit_code": 0, "stdout": "rescued from subagent live 429\n"},
                ],
            })
            res_2 = _run_ps(ps_exe, RELAY_PS1, ["--session-id=sess-sub-live"], _mock_env(home, local_2, claude_2), work)
            self.assertEqual(res_2.returncode, 0, res_2.stderr + "\n" + res_2.stdout)
            self.assertIn("Rate limit detected in live session", res_2.stdout)
            tr_2 = json.loads(trace_2.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_2["claude_calls"]), 2)

    def test_relay_continued_in_validation_switch_retry_banner_standby_and_recovery_manifest(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory(prefix="cl-manifest-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            appdata.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))

            id_a, id_b, id_c = "a" * 32, "b" * 32, "c" * 32
            parent_jsonl = "\n".join([
                json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "5-hour limit"}}),
                # continued-in points to a nonexistent session -> MUST retain parent sess-parent-99!
                json.dumps({"type": "continued-in", "continuedInSessionId": "sess-missing-target"}),
            ]) + "\n"
            sub_ext = "\n".join([
                json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "external report ready"}]}}),
                json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "429"}}),
            ]) + "\n"
            sub_rl = json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "429"}}) + "\n"
            sub_int = json.dumps({"type": "user", "message": {"content": "still working"}}) + "\n"

            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": [
                        {
                            "ok": True,
                            "cli_running": False,
                            "should_relay_now": True,
                            "relay_trigger_kind": "threshold_reached",
                            "active": id_a,
                            "active_name": "Acct-A",
                            "ranked_auto_targets": [id_b, id_c],
                            "accounts": [
                                {"id": id_a, "name": "Acct-A", "is_current": True, "spent": True, "effective_rem": 0},
                                {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90},
                                {"id": id_c, "name": "Acct-C", "is_current": False, "effective_rem": 77},
                            ],
                            "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                        },
                        {
                            "ok": True,
                            "cli_running": False,
                            "should_relay_now": False,
                            "active": id_b,
                            "active_name": "Acct-B",
                            "ranked_auto_targets": [id_c],
                            "accounts": [
                                {"id": id_b, "name": "Acct-B", "is_current": True, "effective_rem": 0},
                                {"id": id_c, "name": "Acct-C", "is_current": False, "effective_rem": 77},
                            ],
                            "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                        },
                        {
                            "ok": True,
                            "cli_running": False,
                            "should_relay_now": False,
                            "active": id_c,
                            "active_name": "Acct-C",
                            "config": {"autoContinueOnRelay": True},
                        },
                    ],
                    "relay_switch": [
                        {"ok": True, "switched": True, "from_name": "Acct-A", "target_id": id_b, "target_name": "Acct-B", "reason": "prelaunch"},
                        # Post-exit switch fails transiently once, then succeeds on retry!
                        {"ok": False, "switched": False, "error": "请先结束 Claude 进程，再切换身份。", "_exit": 1},
                        {"ok": True, "switched": True, "from_name": "Acct-B", "target_id": id_c, "target_name": "Acct-C", "target_effective_rem": 77, "reason": "rate_limited"},
                    ],
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "write_files": {
                            f".claude/projects/{slug}/sess-parent-99.jsonl": parent_jsonl,
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-ext1.meta.json": json.dumps({"agentType": "gemini-reviewer", "finished": False}),
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-ext1.jsonl": sub_ext,
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-rl2.meta.json": json.dumps({"agentType": "Explore", "finished": False}),
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-rl2.jsonl": sub_rl,
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-int3.meta.json": json.dumps({"agentType": "Plan", "finished": False}),
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-int3.jsonl": sub_int,
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-done4.meta.json": json.dumps({"agentType": "Explore", "finished": True}),
                            f".claude/projects/{slug}/sess-parent-99/subagents/agent-done4.jsonl": json.dumps({"type": "assistant", "message": {"content": "all done"}}) + "\n",
                        },
                    },
                    {"exit_code": 0, "stdout": "resumed with recovery manifest\n"},
                ],
            })
            res = _run_ps(ps_exe, RELAY_PS1, ["--session-id=sess-parent-99"], _mock_env(home, local_cmd, claude_cmd, APPDATA=str(appdata)), work)
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            # Banner standby recomputed AFTER pre-launch switch: Active=Acct-B, Standby=Acct-C (77%)!
            self.assertIn("Active: Acct-B | Standby: Acct-C (77%)", res.stdout)

            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            sw_calls = [c for c in tr["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_calls), 3)  # 1 prelaunch + 1 failed transient + 1 succeeded retry
            run2_argv = tr["claude_calls"][1]["argv"]
            # B -> C is a CROSS-account relay: fresh session, never the old session id (neither parent nor broken target).
            for banned in ("--resume", "--session-id", "--continue", "--fork-session"):
                self.assertNotIn(banned, run2_argv)
            self.assertFalse(any(("sess-parent-99" in tok) or ("sess-missing-target" in tok) for tok in run2_argv))
            self.assertEqual(run2_argv[-2:], ["--", CLEAN_CONT_PROMPT])
            self.assertNotIn("Agent(resume", " ".join(run2_argv))
            self.assertNotIn("[RELAY-SUBAGENT-RECOVERY]", " ".join(run2_argv))
            note = run2_argv[run2_argv.index("--append-system-prompt") + 1]
            handoff_md = appdata / "ai.local.claude-local" / "handoff" / "latest-handoff.md"
            self.assertIn(str(handoff_md), note)
            md_text = handoff_md.read_text(encoding="utf-8")
            # Opaque labels only: completed external output is readable, interrupted workers restart from scratch.
            self.assertIn("sub-01 (gemini-reviewer, output ready): read subagent-outputs/sub-01.md directly; do NOT re-run this worker.", md_text)
            self.assertIn("Plan, interrupted): spawn a fresh independent subagent from scratch", md_text)
            self.assertIn("Explore, interrupted): spawn a fresh independent subagent from scratch", md_text)
            self.assertNotIn("done4", md_text)
            for leaked in ("ext1", "rl2", "int3", "sess-parent-99", "Agent(resume"):
                self.assertNotIn(leaked, md_text)
            self.assertEqual(
                (handoff_md.parent / "subagent-outputs" / "sub-01.md").read_text(encoding="utf-8").strip(),
                "external report ready",
            )
            self.assertFalse((handoff_md.parent / "subagent-outputs" / "sub-02.md").exists())
            self.assertLessEqual(len(note), 1200)

    def test_subagent_resume_slot_discovery_readonly_tools_and_distilled_cross_slot_handoff(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        with tempfile.TemporaryDirectory(prefix="cl-sub-mig-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            appdata = root / "appdata"
            slots_root = appdata / "ai.local.claude-local" / "cli-slots"
            id_a = "11111111" * 4
            id_b = "22222222" * 4
            slot_a = slots_root / id_a
            slot_b = slots_root / id_b
            for d in (home, work, slot_a / "projects" / "proj-x" / "sess-mig-1" / "subagents", slot_b):
                d.mkdir(parents=True)

            # Seed Slot A with a real multi-turn write transcript carrying every identity marker that must never cross slots.
            orig_lines = [
                json.dumps({"type": "session-owner", "accountUuid": "uuid-a", "organizationUuid": "org-a"}),
                json.dumps({"type": "user", "sessionId": "sess-mig-1", "message": {"role": "user", "content": "Implement feature"}}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "private-reasoning", "signature": "sig-secret-1"}, {"type": "tool_use", "id": "toolu_done01", "name": "Write", "input": {"file_path": "a.txt"}}]}}),
                json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_done01", "content": "wrote a.txt"}]}}),
                json.dumps({"type": "api-request-start", "requestId": "req_01ABCDEF"}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Next step for person@example.invalid"}, {"type": "tool_use", "id": "toolu_unpaired", "name": "Bash", "input": {"command": "echo hi"}}]}}),
                json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your 5-hour limit"}}),
            ]
            slot_a_jsonl = slot_a / "projects" / "proj-x" / "sess-mig-1.jsonl"
            slot_a_raw = "\n".join(orig_lines) + "\n"
            slot_a_jsonl.write_text(slot_a_raw, encoding="utf-8")
            (slot_a / "projects" / "proj-x" / "sess-mig-1" / "subagents" / "agent-s1.meta.json").write_text(
                json.dumps({"agentType": "Explore", "finished": True}),
                encoding="utf-8",
            )
            forbidden = (
                "sess-mig-1", "uuid-a", "org-a", "toolu_done01", "toolu_unpaired", "req_01ABCDEF",
                "private-reasoning", "sig-secret-1", "person@example.invalid", "agent-s1",
            )

            def assert_slot_b_untouched():
                self.assertEqual(list(slot_b.rglob("*.jsonl")), [], "no transcript may be copied into Slot B")
                self.assertFalse((slot_b / "projects").exists(), "Slot B must not receive any projects/ tree")

            # 1. Write-mode mid-run 429: Slot B starts a FRESH session from a distilled handoff prompt (no copy, no --resume).
            d1 = root / "mig_write"
            d1.mkdir()
            local_1, claude_1, trace_1, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "slot_acquire": [
                        {"ok": True, "status": "acquired", "record_id": id_a, "name": "Slot-A", "slot_dir": str(slot_a), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                        {"ok": True, "status": "acquired", "record_id": id_b, "name": "Slot-B", "slot_dir": str(slot_b), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    ],
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "stdout": json.dumps({"type": "result", "is_error": True, "num_turns": 2, "result": "HTTP 429 rate_limit_error", "session_id": "sess-mig-1"}),
                    },
                    {
                        "exit_code": 0,
                        "stdout": json.dumps({"type": "result", "is_error": False, "num_turns": 1, "result": "Distilled and finished", "session_id": "sess-fresh-b"}),
                    },
                ],
            })
            env_1 = _mock_env(home, local_1, claude_1, APPDATA=str(appdata))
            res_1 = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Implement feature"], env_1, work)
            self.assertEqual(res_1.returncode, 0, res_1.stderr + "\n" + res_1.stdout)
            self.assertIn(f"account_id={id_b}", res_1.stdout)
            self.assertIn("failovers=1", res_1.stdout)

            self.assertEqual(slot_a_jsonl.read_text(encoding="utf-8"), slot_a_raw, "Slot A transcript must remain untouched")
            assert_slot_b_untouched()

            tr_1 = json.loads(trace_1.read_text(encoding="utf-8"))
            self.assertEqual([c.get("op") for c in tr_1["orchestrate_calls"]], ["slot_acquire", "slot_release", "slot_acquire", "slot_release"])
            for call in tr_1["claude_calls"]:
                self.assertNotIn("--resume", call["argv"])
                self.assertNotIn("--session-id", call["argv"])
                self.assertNotIn("--continue", call["argv"])
            run2 = tr_1["claude_calls"][1]
            handoff_prompt = run2["stdin"]
            self.assertIn("[RELAY-HANDOFF]", handoff_prompt)
            self.assertIn("fresh worker", handoff_prompt)
            self.assertIn("Implement feature", handoff_prompt)
            self.assertIn("a.txt", handoff_prompt)
            self.assertIn("Next step for [email]", handoff_prompt)
            self.assertNotIn("Agent(resume", handoff_prompt)
            for marker in forbidden:
                self.assertNotIn(marker, handoff_prompt, f"{marker} must be scrubbed from the distilled handoff")
                self.assertFalse(any(marker in tok for tok in run2["argv"]), f"{marker} leaked into Slot B argv")

            # 2. -Resume <uuid> without -AccountId: owning slot unavailable -> pool fallback gets a fresh distilled session.
            d2 = root / "resume_owner"
            d2.mkdir()
            local_2, claude_2, trace_2, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "slot_acquire": [
                        # First call prefers owning slot_a -> returns unavailable
                        {"ok": False, "status": "no_candidate", "reason": "slot_exhausted"},
                        # Second call falls back to pool excluding slot_a -> acquires slot_b!
                        {"ok": True, "status": "acquired", "record_id": id_b, "name": "Slot-B", "slot_dir": str(slot_b), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    ],
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [
                    {"exit_code": 0, "stdout": json.dumps({"type": "result", "is_error": False, "result": "Fresh via owner fallback", "session_id": "sess-fresh-b2"})},
                ],
            })
            env_2 = _mock_env(home, local_2, claude_2, APPDATA=str(appdata))
            res_2 = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Follow up", "-Resume", "sess-mig-1"], env_2, work)
            self.assertEqual(res_2.returncode, 0, res_2.stderr + "\n" + res_2.stdout)
            tr_2 = json.loads(trace_2.read_text(encoding="utf-8"))
            acqs = [c for c in tr_2["orchestrate_calls"] if c.get("op") == "slot_acquire"]
            self.assertEqual(acqs[0].get("record_id"), id_a)
            self.assertEqual(acqs[1].get("exclude_record_ids"), [id_a])
            assert_slot_b_untouched()
            argv_2 = tr_2["claude_calls"][0]["argv"]
            self.assertNotIn("--resume", argv_2)
            self.assertNotIn("sess-mig-1", " ".join(argv_2))
            prompt_2 = tr_2["claude_calls"][0]["stdin"]
            self.assertIn("[RELAY-HANDOFF]", prompt_2)
            self.assertTrue(prompt_2.rstrip().endswith("Follow up"))
            for marker in forbidden:
                self.assertNotIn(marker, prompt_2)

            # 3. Re-acquiring the SAME owning slot keeps --resume and the plain prompt (no handoff rewrite).
            d3 = root / "resume_same_slot"
            d3.mkdir()
            local_3, claude_3, trace_3, _ = _write_mock_shims(d3, {
                "orchestrate": {
                    "slot_acquire": {"ok": True, "status": "acquired", "record_id": id_a, "name": "Slot-A", "slot_dir": str(slot_a), "proxy": "http://127.0.0.1:7899", "jitter_ms": 0},
                    "slot_release": {"ok": True, "status": "released"},
                },
                "claude_runs": [
                    {"exit_code": 0, "stdout": json.dumps({"type": "result", "is_error": False, "result": "Resumed on owner", "session_id": "sess-mig-1"})},
                ],
            })
            env_3 = _mock_env(home, local_3, claude_3, APPDATA=str(appdata))
            res_3 = _run_ps(ps_exe, SUBAGENT_PS1, ["-Prompt", "Follow up", "-Resume", "sess-mig-1"], env_3, work)
            self.assertEqual(res_3.returncode, 0, res_3.stderr + "\n" + res_3.stdout)
            tr_3 = json.loads(trace_3.read_text(encoding="utf-8"))
            argv_3 = tr_3["claude_calls"][0]["argv"]
            self.assertEqual(argv_3[:2], ["-p", "Follow up"])
            self.assertEqual(argv_3[argv_3.index("--resume") + 1], "sess-mig-1")
            self.assertNotIn("[RELAY-HANDOFF]", json.dumps(tr_3["claude_calls"][0]))
            self.assertEqual(slot_a_jsonl.read_text(encoding="utf-8"), slot_a_raw)
            assert_slot_b_untouched()

            # 4. Static guard: the failover path can never copy a transcript or pass --resume to a non-owning slot.
            sub_text = SUBAGENT_PS1.read_text(encoding="utf-8-sig")
            self.assertNotIn("Copy-AndSanitizeSlotTranscript", sub_text)
            self.assertIn("Build-DistilledSlotHandoffPrompt", sub_text)
            self.assertIn("$acquiredId -eq $resumeOwnerRecordId", sub_text)

    def test_relay_cross_account_clean_handoff_default_same_account_resume_and_breather(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        id_a, id_b = "a" * 32, "b" * 32
        secrets = (
            "sess-clean-1", "person@example.invalid", "sk-ant-api03-ABCDEF123456", "toolu_01ABCDEFGH",
            "req_01XYZXYZXYZ", FAKE_UUID, "secret-thinking", "SIG-SECRET",
        )
        for ps_exe in shells:
            with self.subTest(shell=Path(ps_exe).name), tempfile.TemporaryDirectory(prefix="cl-clean-") as tmp:
                root = Path(tmp)
                home, work = root / "home", root / "work"
                home.mkdir()
                work.mkdir()
                appdata = root / "appdata"
                handoff_dir = appdata / "ai.local.claude-local" / "handoff"
                slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
                rate_line = json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit · resets 5pm"}})
                transcript = "\n".join([
                    json.dumps({"type": "user", "sessionId": "sess-clean-1", "message": {"role": "user", "content": "Refactor module; contact person@example.invalid token sk-ant-api03-ABCDEF123456 id toolu_01ABCDEFGH req_01XYZXYZXYZ uuid " + FAKE_UUID}}),
                    json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                        {"type": "thinking", "thinking": "secret-thinking", "signature": "SIG-SECRET"},
                        {"type": "text", "text": "Refactored parser"},
                        {"type": "tool_use", "id": "toolu_01ABCDEFGH", "name": "Edit", "input": {"file_path": str(work / "src" / "parser.py")}},
                    ]}}),
                    rate_line,
                ]) + "\n"
                sessions_file = json.dumps({"pid": 99999, "sessionId": "sess-clean-1", "cwd": str(work)})

                # --- A. Cross-account (default clean_handoff) using the native handoff_md_path ---
                da = root / "cross_native"
                da.mkdir()
                native_dir = root / "native-handoff"
                (native_dir / "subagent-outputs").mkdir(parents=True)
                native_md = native_dir / "latest-handoff.md"
                native_md.write_text("# native scrubbed note\n", encoding="utf-8")
                local_a, claude_a, trace_a, _ = _write_mock_shims(da, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                        "relay_switch": {
                            "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b,
                            "from_name": "Acct-A", "target_name": "Acct-B", "reason": "rate_limited",
                            "handoff_md_path": str(native_md),
                        },
                    },
                    "claude_runs": [
                        {"exit_code": 1, "write_files": {".claude/sessions/99999.json": sessions_file, f".claude/projects/{slug}/sess-clean-1.jsonl": transcript}},
                        {"exit_code": 0, "stdout": "fresh session ok\n"},
                    ],
                })
                env_a = _mock_env(home, local_a, claude_a, APPDATA=str(appdata), CLAUDE_CONFIG_DIR=str(root / "foreign-config"))
                res_a = _run_ps(ps_exe, RELAY_PS1, ["--print", "start task"], env_a, work)
                self.assertEqual(res_a.returncode, 0, res_a.stderr + "\n" + res_a.stdout)
                self.assertIn("clean_handoff: starting a fresh session", res_a.stdout)
                self.assertIn("Anti-ban breather skipped", res_a.stdout)
                tr_a = json.loads(trace_a.read_text(encoding="utf-8"))
                self.assertEqual(len(tr_a["claude_calls"]), 2)
                argv_a = tr_a["claude_calls"][1]["argv"]
                for banned in ("--resume", "--session-id", "--continue", "--fork-session", "-r", "-c"):
                    self.assertNotIn(banned, argv_a)
                self.assertFalse(any("sess-clean-1" in tok for tok in argv_a))
                self.assertEqual(argv_a[0], "--print")
                self.assertEqual(argv_a[1], "--append-system-prompt")
                note = argv_a[2]
                self.assertIn("[RELAY-HANDOFF]", note)
                self.assertIn(str(native_md), note)
                self.assertIn("subagent-outputs", note)
                self.assertNotIn("Agent(resume", " ".join(argv_a))
                self.assertEqual(argv_a[-2:], ["--", CLEAN_CONT_PROMPT])
                for call in tr_a["claude_calls"]:
                    self.assertIsNone(call["env"]["CLAUDE_CONFIG_DIR"], "CLAUDE_CONFIG_DIR must be scrubbed from the relay child")
                self.assertEqual(native_md.read_text(encoding="utf-8"), "# native scrubbed note\n", "native handoff must not be rewritten")
                self.assertFalse(handoff_dir.exists(), "local synthesis must not run when native handoff_md_path exists")

                # --- B. Cross-account without native path: local scrubbed digest, interactive + -AutoContinue ---
                db = root / "cross_local"
                db.mkdir()
                sessions_file_b = json.dumps({"pid": 99998, "sessionId": "sess-clean-2", "cwd": str(work)})
                transcript_b = transcript.replace("sess-clean-1", "sess-clean-2")
                local_b, claude_b, trace_b, _ = _write_mock_shims(db, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                        "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "Acct-A", "target_name": "Acct-B", "reason": "rate_limited"},
                    },
                    "claude_runs": [
                        {"exit_code": 1, "write_files": {".claude/sessions/99998.json": sessions_file_b, f".claude/projects/{slug}/sess-clean-2.jsonl": transcript_b}},
                        {"exit_code": 0, "stdout": "fresh interactive ok\n"},
                    ],
                })
                env_b = _mock_env(home, local_b, claude_b, APPDATA=str(appdata))
                res_b = _run_ps(ps_exe, RELAY_PS1, ["--model", "sonnet"], env_b, work)
                self.assertEqual(res_b.returncode, 0, res_b.stderr + "\n" + res_b.stdout)
                tr_b = json.loads(trace_b.read_text(encoding="utf-8"))
                argv_b = tr_b["claude_calls"][1]["argv"]
                for banned in ("--resume", "--session-id", "--continue", "--fork-session"):
                    self.assertNotIn(banned, argv_b)
                self.assertEqual(argv_b[:2], ["--model", "sonnet"])
                self.assertIn("--append-system-prompt", argv_b)
                self.assertEqual(argv_b[-2:], ["--", CLEAN_CONT_PROMPT])
                local_md = handoff_dir / "latest-handoff.md"
                self.assertTrue(local_md.is_file())
                self.assertIn(str(local_md), argv_b[argv_b.index("--append-system-prompt") + 1])
                md_text = local_md.read_text(encoding="utf-8")
                self.assertIn("Refactor module", md_text)
                self.assertIn("Refactored parser", md_text)
                self.assertIn("src/parser.py", md_text)
                self.assertNotIn("\r", md_text)
                for secret in secrets:
                    self.assertNotIn(secret, md_text, f"{secret} leaked into latest-handoff.md")
                    self.assertFalse(any(secret in tok for tok in argv_b), f"{secret} leaked into argv")
                self.assertNotIn("Agent(resume", md_text)
                self.assertNotIn(str(home), md_text)

                # --- C. Same account (from == target): --resume is preserved, no handoff injection ---
                dc = root / "same_account"
                dc.mkdir()
                sessions_file_c = json.dumps({"pid": 99997, "sessionId": "sess-clean-3", "cwd": str(work)})
                transcript_c = transcript.replace("sess-clean-1", "sess-clean-3")
                local_c, claude_c, trace_c, _ = _write_mock_shims(dc, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                        "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_a, "from_name": "Acct-A", "target_name": "Acct-A", "reason": "rested"},
                    },
                    "claude_runs": [
                        {"exit_code": 1, "write_files": {".claude/sessions/99997.json": sessions_file_c, f".claude/projects/{slug}/sess-clean-3.jsonl": transcript_c}},
                        {"exit_code": 0, "stdout": "same account resumed\n"},
                    ],
                })
                res_c = _run_ps(ps_exe, RELAY_PS1, ["--print", "start task"], _mock_env(home, local_c, claude_c, APPDATA=str(appdata)), work)
                self.assertEqual(res_c.returncode, 0, res_c.stderr + "\n" + res_c.stdout)
                tr_c = json.loads(trace_c.read_text(encoding="utf-8"))
                self.assertEqual(tr_c["claude_calls"][1]["argv"], ["--resume", "sess-clean-3"])

        # Static guard: both env-scrub lists remove CLAUDE_CONFIG_DIR.
        relay_text = RELAY_PS1.read_text(encoding="utf-8-sig")
        for fn in ("function Invoke-ClaudeRelayChild", "function Stop-ClaudeDaemonIfAlive"):
            start = relay_text.index(fn)
            body = relay_text[start:start + 3500]
            self.assertIn("'CLAUDE_CONFIG_DIR'", body, f"{fn} must scrub CLAUDE_CONFIG_DIR")

    def test_relay_fork_resume_opt_in_warns_and_sanitizes_forked_transcript_copy(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        id_a, id_b = "a" * 32, "b" * 32
        for idx, ps_exe in enumerate(shells):
            with self.subTest(shell=Path(ps_exe).name), tempfile.TemporaryDirectory(prefix="cl-fork-") as tmp:
                root = Path(tmp)
                home, work = root / "home", root / "work"
                home.mkdir()
                work.mkdir()
                slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
                proj_dir = home / ".claude" / "projects" / slug
                transcript_lines = [
                    {"type": "session-owner", "accountUuid": "acc-uuid-fork", "organizationUuid": "org-uuid-fork"},
                    {"type": "user", "sessionId": "sess-fork-1", "credential_org": "org-cred-x", "message": {"role": "user", "content": "<system-reminder>\nlogged in as person@example.invalid\n</system-reminder>\nDo the task"}},
                    {"type": "assistant", "sessionId": "sess-fork-1", "message": {"role": "assistant", "content": [
                        {"type": "thinking", "thinking": "private-chain", "signature": "SIG-FORK"},
                        {"type": "redacted_thinking", "data": "REDACTED-BLOB"},
                        {"type": "text", "text": "visible work", "signature": "SIG-TEXT"},
                    ]}},
                    {"type": "attachment", "sessionId": "sess-fork-1", "profile": {"emailAddress": "person@example.invalid", "keep": "ok"}},
                    {"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit"}},
                ]
                transcript = "\n".join(json.dumps(row) for row in transcript_lines) + "\n"
                sessions_file = json.dumps({"pid": 99999, "sessionId": "sess-fork-1", "cwd": str(work)})
                cfg_driven = idx % 2 == 1
                status_cfg = {"autoContinueOnRelay": True}
                if cfg_driven:
                    status_cfg["relayHandoffMode"] = "fork_resume"
                local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                    "orchestrate": {
                        "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": status_cfg},
                        "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "Acct-A", "target_name": "Acct-B", "reason": "rate_limited"},
                    },
                    "claude_runs": [
                        {"exit_code": 1, "write_files": {".claude/sessions/99999.json": sessions_file, f".claude/projects/{slug}/sess-fork-1.jsonl": transcript}},
                        {"exit_code": 0, "stdout": "forked ok\n", "capture_globs": [f".claude/projects/{slug}/*.jsonl"]},
                    ],
                })
                env = _mock_env(home, local_cmd, claude_cmd, APPDATA=str(root / "appdata"))
                args = ["-p", "start task"]
                if not cfg_driven:
                    args = ["-HandoffMode", "fork_resume", *args]
                res = _run_ps(ps_exe, RELAY_PS1, args, env, work)
                self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
                self.assertIn("anti-ban risk", res.stderr)
                self.assertIn("fork_resume", res.stderr)
                tr = json.loads(trace_file.read_text(encoding="utf-8"))
                self.assertEqual(len(tr["claude_calls"]), 2)
                argv = tr["claude_calls"][1]["argv"]
                self.assertEqual(argv[0], "--resume")
                scrubbed_id = argv[1]
                self.assertNotEqual(scrubbed_id, "sess-fork-1")
                self.assertRegex(scrubbed_id, r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
                self.assertEqual(argv[2], "--fork-session")
                self.assertNotIn("--append-system-prompt", argv)
                self.assertEqual(argv[-2:], ["--", DEFAULT_CONT_PROMPT])
                self.assertIsNone(tr["claude_calls"][1]["env"]["CLAUDE_CONFIG_DIR"])

                captured = tr["claude_calls"][1]["captured_files"]
                scrubbed_key = next(k for k in captured if k.endswith(f"{scrubbed_id}.jsonl"))
                scrubbed = captured[scrubbed_key]
                for marker in (
                    "thinking", "redacted_thinking", "signature", "SIG-FORK", "SIG-TEXT", "REDACTED-BLOB", "private-chain",
                    "session-owner", "accountUuid", "organizationUuid", "acc-uuid-fork", "org-uuid-fork",
                    "credential_org", "org-cred-x", "emailAddress", "person@example.invalid", "isApiErrorMessage",
                ):
                    self.assertNotIn(marker, scrubbed, f"{marker} must be stripped from the forked transcript copy")
                self.assertIn("Do the task", scrubbed)
                self.assertIn("visible work", scrubbed)
                self.assertIn('"keep"', scrubbed)
                self.assertNotIn("sess-fork-1", scrubbed, "old sessionId must be rewritten")
                self.assertIn(scrubbed_id, scrubbed)
                self.assertNotIn("\r", scrubbed)

                # Original transcript untouched; temporary scrubbed copy removed afterwards.
                self.assertEqual((proj_dir / "sess-fork-1.jsonl").read_text(encoding="utf-8"), transcript)
                self.assertEqual(sorted(p.name for p in proj_dir.glob("*.jsonl")), ["sess-fork-1.jsonl"])

    def test_relay_anti_ban_breather_range_and_invalid_handoff_mode(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        id_a, id_b = "a" * 32, "b" * 32
        with tempfile.TemporaryDirectory(prefix="cl-breather-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            rate_jsonl = json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit"}}) + "\n"
            local_cmd, claude_cmd, trace_file, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "Acct-A", "target_name": "Acct-B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {".claude/sessions/99999.json": json.dumps({"pid": 99999, "sessionId": "sess-br-1", "cwd": str(work)}), f".claude/projects/{slug}/sess-br-1.jsonl": rate_jsonl}},
                    {"exit_code": 0, "stdout": "after breather\n"},
                ],
            })
            env = _mock_env(home, local_cmd, claude_cmd, CLAUDE_RELAY_TEST_FAST="0")
            start = time.monotonic()
            res = _run_ps(ps_exe, RELAY_PS1, ["--print", "go"], env, work)
            elapsed = time.monotonic() - start
            self.assertEqual(res.returncode, 0, res.stderr + "\n" + res.stdout)
            m = re.search(r"Anti-ban breather: waiting (\d+)[.,](\d)s", res.stdout)
            self.assertIsNotNone(m, res.stdout)
            waited = float(f"{m.group(1)}.{m.group(2)}")
            self.assertGreaterEqual(waited, 6.0)
            self.assertLessEqual(waited, 15.0)
            self.assertGreaterEqual(elapsed, waited - 0.5)

            # The breather happens BEFORE the relay_switch call and the account-B launch.
            tr = json.loads(trace_file.read_text(encoding="utf-8"))
            self.assertEqual(len(tr["claude_calls"]), 2)

            bad = _run_ps(ps_exe, RELAY_PS1, ["-HandoffMode", "resume_everything", "--print", "go"], _mock_env(home, local_cmd, claude_cmd), work)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn("Invalid -HandoffMode", bad.stdout + bad.stderr)

    def test_relay_conin_raw_mode_guard_sleep_checks_and_bg_grace_window(self):
        relay_text = RELAY_PS1.read_text(encoding="utf-8-sig")
        self.assertIn("if ((mode & 0x0006u) != 0u) return false;", relay_text)
        self.assertIn("public static bool IsConsoleInRawMode()", relay_text)
        self.assertIn("function Test-ConsoleRawMode", relay_text)
        self.assertIn("function Wait-RelayProcessAliveMs", relay_text)
        self.assertIn("Send-ConsolePhasedExitCommand -SendSecondEscape $sawAutoContinueNotice -ChildProcess $proc", relay_text)
        self.assertIn("Console returned to cooked mode; waiting for claude.exe to exit...", relay_text)
        self.assertIn("$bgChoiceGraceUntilUtc = [DateTime]::UtcNow.AddMilliseconds(4000)", relay_text)

        start = relay_text.index("function Initialize-ConsoleInputInjectorType")
        end = relay_text.index("function Test-ConsoleRawMode")
        fn_block = relay_text[start:end]
        for ps_exe in [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]:
            with self.subTest(shell=Path(ps_exe).name):
                cmd = (
                    fn_block
                    + "\nInitialize-ConsoleInputInjectorType\n"
                    + "$raw = [ClaudeLocal.ConsoleInputInjector]::IsConsoleInRawMode()\n"
                    + "$sent = [ClaudeLocal.ConsoleInputInjector]::TrySendClearDraft()\n"
                    + 'Write-Output ("RAW=" + $raw + ";SENT=" + $sent)\n'
                )
                proc = subprocess.run([ps_exe, "-NoProfile", "-Command", cmd], capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(proc.returncode, 0, proc.stderr + "\n" + proc.stdout)
                self.assertIn("RAW=False;SENT=False", proc.stdout)

    def test_relay_continued_in_synthetic_filter_and_parent_first_cross_handoff(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        relay_text = RELAY_PS1.read_text(encoding="utf-8-sig")
        safe_start = relay_text.index("function Get-SafeProp")
        safe_end = relay_text.index("function Get-UserHomeDir")
        turns_start = relay_text.index("function Test-SessionJsonlHasTurns")
        turns_end = relay_text.index("function Get-InitialSessionArg")
        helper_src = relay_text[safe_start:safe_end] + "\n" + relay_text[turns_start:turns_end]

        for ps_exe in shells:
            with self.subTest(phase="unit", shell=Path(ps_exe).name), tempfile.TemporaryDirectory(prefix="cl-turns-") as tmp:
                root = Path(tmp)
                files = {
                    "err_only": [json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"role": "assistant", "content": "You've hit your limit"}})],
                    "synth_only": [json.dumps({"type": "assistant", "message": {"role": "assistant", "model": "<synthetic>", "content": [{"type": "text", "text": "No quota"}]}})],
                    "thinking_only": [json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "hidden only"}]}})],
                    "blank_user": [json.dumps({"type": "user", "message": {"role": "user", "content": "   "}})],
                    "real_text": [json.dumps({"type": "user", "message": {"role": "user", "content": "Real user request"}})],
                    "real_tool": [json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01", "name": "Read", "input": {"file_path": "a.py"}}]}})],
                }
                checks = []
                for name, rows in files.items():
                    p = root / f"{name}.jsonl"
                    p.write_text("\n".join(rows) + "\n", encoding="utf-8")
                    checks.append(f'Write-Output ("{name}=" + (Test-SessionJsonlHasTurns \'{p.as_posix()}\'))')
                script = helper_src + "\n" + "\n".join(checks) + "\n"
                out = subprocess.run([ps_exe, "-NoProfile", "-Command", script], capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(out.returncode, 0, out.stderr + "\n" + out.stdout)
                for false_name in ("err_only", "synth_only", "thinking_only", "blank_user"):
                    self.assertIn(f"{false_name}=False", out.stdout, out.stdout)
                for true_name in ("real_text", "real_tool"):
                    self.assertIn(f"{true_name}=True", out.stdout, out.stdout)

        id_a, id_b = "a" * 32, "b" * 32
        ps_exe = shells[0]
        with tempfile.TemporaryDirectory(prefix="cl-parent-handoff-") as tmp:
            root = Path(tmp)
            work = root / "work"
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            parent_transcript = "\n".join([
                json.dumps({"type": "user", "sessionId": "sess-parent-1", "message": {"role": "user", "content": "PARENT_TASK_GOAL refactor core"}}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                    {"type": "text", "text": "Edited parent file"},
                    {"type": "tool_use", "id": "toolu_p1", "name": "Edit", "input": {"file_path": str(work / "src" / "parent_file.py")}},
                ]}}),
                json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit"}}),
                json.dumps({"type": "continued-in", "continuedInSessionId": "sess-child-1"}),
            ]) + "\n"
            child_transcript = json.dumps({"type": "user", "sessionId": "sess-child-1", "message": {"role": "user", "content": "CHILD_TINY_MSG"}}) + "\n"
            synth_child_transcript = json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"role": "assistant", "model": "<synthetic>", "content": "API Error"}}) + "\n"
            sess_json = json.dumps({"pid": 99999, "sessionId": "sess-parent-1", "cwd": str(work)})

            # A. Cross-account clean_handoff picks rich parent transcript over continued-in child.
            da = root / "cross_clean"
            ha, app_a = da / "home", da / "appdata"
            ha.mkdir(parents=True)
            la, ca, _, _ = _write_mock_shims(da, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-parent-1.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-child-1.jsonl": child_transcript,
                    }},
                    {"exit_code": 0, "stdout": "ok\n"},
                ],
            })
            ra = _run_ps(ps_exe, RELAY_PS1, ["--print", "start"], _mock_env(ha, la, ca, APPDATA=str(app_a)), work)
            self.assertEqual(ra.returncode, 0, ra.stderr + "\n" + ra.stdout)
            md_text = (app_a / "ai.local.claude-local" / "handoff" / "latest-handoff.md").read_text(encoding="utf-8")
            self.assertIn("PARENT_TASK_GOAL", md_text)
            self.assertIn("src/parent_file.py", md_text)
            self.assertNotIn("CHILD_TINY_MSG", md_text)
            self.assertNotIn("sess-parent-1", md_text)
            self.assertNotIn("sess-child-1", md_text)

            # B. Cross-account fork_resume also forks parent transcript (not child).
            db = root / "cross_fork"
            hb, app_b = db / "home", db / "appdata"
            hb.mkdir(parents=True)
            lb, cb, tb, _ = _write_mock_shims(db, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-parent-1.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-child-1.jsonl": child_transcript,
                    }},
                    {"exit_code": 0, "stdout": "ok\n", "capture_globs": [f".claude/projects/{slug}/*.jsonl"]},
                ],
            })
            rb = _run_ps(ps_exe, RELAY_PS1, ["-HandoffMode", "fork_resume", "--print", "start"], _mock_env(hb, lb, cb, APPDATA=str(app_b)), work)
            self.assertEqual(rb.returncode, 0, rb.stderr + "\n" + rb.stdout)
            tr_b = json.loads(tb.read_text(encoding="utf-8"))
            fork_id = tr_b["claude_calls"][1]["argv"][1]
            fork_text = tr_b["claude_calls"][1]["captured_files"][f".claude/projects/{slug}/{fork_id}.jsonl"]
            self.assertIn("PARENT_TASK_GOAL", fork_text)
            self.assertNotIn("CHILD_TINY_MSG", fork_text)

            # C. Same-account preserves --resume sess-child-1 when child has genuine turns.
            dc = root / "same_valid_child"
            hc, app_c = dc / "home", dc / "appdata"
            hc.mkdir(parents=True)
            lc, cc, tc, _ = _write_mock_shims(dc, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_a, "from_name": "A", "target_name": "A", "reason": "rested"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-parent-1.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-child-1.jsonl": child_transcript,
                    }},
                    {"exit_code": 0, "stdout": "ok\n"},
                ],
            })
            rc = _run_ps(ps_exe, RELAY_PS1, ["--print", "start"], _mock_env(hc, lc, cc, APPDATA=str(app_c)), work)
            self.assertEqual(rc.returncode, 0, rc.stderr + "\n" + rc.stdout)
            tr_c = json.loads(tc.read_text(encoding="utf-8"))
            self.assertEqual(tr_c["claude_calls"][1]["argv"][:2], ["--resume", "sess-child-1"])

            # D. Same-account ignores synthetic-only continued-in shell and stays on sess-parent-1.
            dd = root / "same_synth_child"
            hd, app_d = dd / "home", dd / "appdata"
            hd.mkdir(parents=True)
            ld, cd, td, _ = _write_mock_shims(dd, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_a, "from_name": "A", "target_name": "A", "reason": "rested"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-parent-1.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-child-1.jsonl": synth_child_transcript,
                    }},
                    {"exit_code": 0, "stdout": "ok\n"},
                ],
            })
            rd = _run_ps(ps_exe, RELAY_PS1, ["--print", "start"], _mock_env(hd, ld, cd, APPDATA=str(app_d)), work)
            self.assertEqual(rd.returncode, 0, rd.stderr + "\n" + rd.stdout)
            tr_d = json.loads(td.read_text(encoding="utf-8"))
            self.assertEqual(tr_d["claude_calls"][1]["argv"][:2], ["--resume", "sess-parent-1"])

    def test_relay_post_relay_rapid_exit_single_fallback_and_diagnostics(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        id_a, id_b = "a" * 32, "b" * 32
        with tempfile.TemporaryDirectory(prefix="cl-rapid-fb-") as tmp:
            root = Path(tmp)
            work = root / "work"
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            parent_transcript = "\n".join([
                json.dumps({"type": "user", "sessionId": "sess-fb-parent", "message": {"role": "user", "content": "FALLBACK_TASK"}}),
                json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit"}}),
                json.dumps({"type": "continued-in", "continuedInSessionId": "sess-fb-child"}),
            ]) + "\n"
            child_transcript = json.dumps({"type": "user", "sessionId": "sess-fb-child", "message": {"role": "user", "content": "valid child"}}) + "\n"
            sess_json = json.dumps({"pid": 99999, "sessionId": "sess-fb-parent", "cwd": str(work)})

            # A. Same-account continued-in rapid failure (<10s, exit!=0) falls back once to parent and succeeds.
            da = root / "fb_same_ok"
            ha, app_a = da / "home", da / "appdata"
            ha.mkdir(parents=True)
            la, ca, ta, _ = _write_mock_shims(da, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_a, "from_name": "A", "target_name": "A", "reason": "rested"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-fb-parent.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-fb-child.jsonl": child_transcript,
                    }},
                    {"exit_code": 1, "stderr": "No conversation found with session ID\n"},
                    {"exit_code": 0, "stdout": "parent fallback ok\n"},
                ],
            })
            ra = _run_ps(ps_exe, RELAY_PS1, ["--print", "go"], _mock_env(ha, la, ca, APPDATA=str(app_a)), work)
            self.assertEqual(ra.returncode, 0, ra.stderr + "\n" + ra.stdout)
            self.assertIn("falling back once to parent session (sess-fb-parent)", ra.stdout)
            tr_a = json.loads(ta.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_a["claude_calls"]), 3)
            self.assertEqual(tr_a["claude_calls"][1]["argv"][:2], ["--resume", "sess-fb-child"])
            self.assertEqual(tr_a["claude_calls"][2]["argv"][:2], ["--resume", "sess-fb-parent"])

            # B. Fallback itself also failing rapidly prints diagnostics & stops cleanly (no loop).
            db = root / "fb_same_fail"
            hb, app_b = db / "home", db / "appdata"
            hb.mkdir(parents=True)
            lb, cb, tb, _ = _write_mock_shims(db, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_a, "from_name": "A", "target_name": "A", "reason": "rested"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-fb-parent.jsonl": parent_transcript,
                        f".claude/projects/{slug}/sess-fb-child.jsonl": child_transcript,
                    }},
                    {"exit_code": 1},
                    {"exit_code": 2},
                ],
            })
            rb = _run_ps(ps_exe, RELAY_PS1, ["--print", "go"], _mock_env(hb, lb, cb, APPDATA=str(app_b)), work)
            self.assertEqual(rb.returncode, 2, rb.stderr + "\n" + rb.stdout)
            self.assertIn("Post-relay session exited rapidly", rb.stdout)
            self.assertIn("cr --resume sess-fb-parent", rb.stdout)
            self.assertEqual(len(json.loads(tb.read_text(encoding="utf-8"))["claude_calls"]), 3)

            # C. Cross-account fork_resume rapid failure falls back once to clean_handoff and succeeds.
            dc = root / "fb_fork_ok"
            hc, app_c = dc / "home", dc / "appdata"
            hc.mkdir(parents=True)
            lc, cc, tc, _ = _write_mock_shims(dc, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-fb-parent.jsonl": parent_transcript,
                    }},
                    {"exit_code": 1},
                    {"exit_code": 0, "stdout": "clean fallback ok\n"},
                ],
            })
            rc = _run_ps(ps_exe, RELAY_PS1, ["-HandoffMode", "fork_resume", "--print", "go"], _mock_env(hc, lc, cc, APPDATA=str(app_c)), work)
            self.assertEqual(rc.returncode, 0, rc.stderr + "\n" + rc.stdout)
            self.assertIn("Cross-account fork_resume exited rapidly", rc.stdout)
            self.assertIn("falling back once to clean_handoff", rc.stdout)
            tr_c = json.loads(tc.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_c["claude_calls"]), 3)
            self.assertIn("--fork-session", tr_c["claude_calls"][1]["argv"])
            argv2 = tr_c["claude_calls"][2]["argv"]
            self.assertNotIn("--resume", argv2)
            self.assertNotIn("--fork-session", argv2)
            self.assertIn("--append-system-prompt", argv2)

            # D. clean_handoff rapid failure emits diagnostic + handoff recovery hint without infinite retry.
            dd = root / "fb_clean_fail"
            hd, app_d = dd / "home", dd / "appdata"
            hd.mkdir(parents=True)
            ld, cd, td, _ = _write_mock_shims(dd, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": sess_json,
                        f".claude/projects/{slug}/sess-fb-parent.jsonl": parent_transcript,
                    }},
                    {"exit_code": 3},
                ],
            })
            rd = _run_ps(ps_exe, RELAY_PS1, ["--print", "go"], _mock_env(hd, ld, cd, APPDATA=str(app_d)), work)
            self.assertEqual(rd.returncode, 3, rd.stderr + "\n" + rd.stdout)
            self.assertIn("Post-relay session exited rapidly (mode=clean_handoff, exit=3", rd.stdout)
            self.assertIn("latest-handoff.md", rd.stdout)
            self.assertEqual(len(json.loads(td.read_text(encoding="utf-8"))["claude_calls"]), 2)

    def test_relay_hotupdate_disk_drift_warning_emits_once(self):
        ps_exe = shutil.which("pwsh") or shutil.which("powershell.exe")
        assert ps_exe
        id_a, id_b = "a" * 32, "b" * 32
        relay_bytes = RELAY_PS1.read_bytes()
        updated_bytes = relay_bytes + b"\n# simulated hotupdate\n"

        with tempfile.TemporaryDirectory(prefix="cl-drift-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            temp_relay = root / "claude-relay.ps1"
            temp_relay.write_bytes(relay_bytes)
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            rate_jsonl = json.dumps({"type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "message": {"content": "You've hit your limit"}}) + "\n"

            # A. Updated on disk during Run 0 -> warning emitted exactly once across switch + Run 1 exit.
            d1 = root / "drifted"
            d1.mkdir()
            l1, c1, _, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {"exit_code": 1, "write_files": {
                        ".claude/sessions/99999.json": json.dumps({"pid": 99999, "sessionId": "sess-drift-1", "cwd": str(work)}),
                        f".claude/projects/{slug}/sess-drift-1.jsonl": rate_jsonl,
                        str(temp_relay): updated_bytes.decode("utf-8-sig"),
                    }},
                    {"exit_code": 0, "stdout": "done\n"},
                ],
            })
            r1 = _run_ps(ps_exe, temp_relay, ["--print", "go"], _mock_env(home, l1, c1), work)
            self.assertEqual(r1.returncode, 0, r1.stderr + "\n" + r1.stdout)
            self.assertEqual(r1.stdout.count("NOTICE: claude-relay.ps1 on disk was updated"), 1, r1.stdout)

            # B. Untouched on disk -> no drift notice.
            temp_relay.write_bytes(relay_bytes)
            d2 = root / "clean"
            d2.mkdir()
            l2, c2, _, _ = _write_mock_shims(d2, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": False}},
                },
                "claude_runs": [{"exit_code": 0, "stdout": "ok\n"}],
            })
            r2 = _run_ps(ps_exe, temp_relay, ["--print", "go"], _mock_env(home, l2, c2), work)
            self.assertEqual(r2.returncode, 0, r2.stderr + "\n" + r2.stdout)
            self.assertNotIn("NOTICE: claude-relay.ps1 on disk was updated", r2.stdout)

    def test_relay_ignores_api_request_blob_and_prose_rate_limit_false_positives(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        assert shells
        ps_exe = shells[0]
        relay_text = RELAY_PS1.read_text(encoding="utf-8-sig")
        safe_start = relay_text.index("function Get-SafeProp")
        safe_end = relay_text.index("function Get-UserHomeDir")
        entry_start = relay_text.index("function Get-EntryText")
        entry_end = relay_text.index("function Test-SessionJsonlHasTurns")
        cls_start = relay_text.index("function Classify-SubagentTranscript")
        cls_end = relay_text.index("function Get-InterruptedSubagentsSummary")
        helper_src = (
            relay_text[safe_start:safe_end]
            + "\n"
            + relay_text[entry_start:entry_end]
            + "\n"
            + relay_text[cls_start:cls_end]
        )

        # 0. Unit check across available PowerShell editions: api-request-blob & healthy prose vs synthetic 429
        for sh in shells:
            with self.subTest(phase="unit", shell=Path(sh).name), tempfile.TemporaryDirectory(prefix="cl-fp-unit-") as tmp:
                root = Path(tmp)
                blob_only = root / "blob_and_prose.jsonl"
                blob_only.write_text(
                    "\n".join([
                        json.dumps({
                            "type": "user",
                            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t0", "content": "cut off twice by the 5-hour limit"}]},
                        }),
                        json.dumps({
                            "type": "api-request-blob",
                            "sessionId": "s1",
                            "hash": "h1",
                            "message": {
                                "role": "user",
                                "content": [
                                    {"type": "tool_use", "id": "tu_blob", "name": "Read", "input": {"file_path": "mem.md"}},
                                    {"type": "tool_result", "tool_use_id": "t0", "content": "5-hour limit HTTP 429 rate_limit_error"},
                                ],
                            },
                        }),
                        json.dumps({
                            "type": "assistant",
                            "message": {
                                "role": "assistant",
                                "model": "claude-opus-5-5",
                                "content": [{"type": "text", "text": "Discussing 5-hour limit, HTTP 429, rate_limit_error, overloaded_error, and continuing automatically in documentation."}],
                            },
                        }),
                        json.dumps({
                            "type": "api-request-blob",
                            "sessionId": "s1",
                            "message": {"role": "user", "content": "Usage limit reached · continuing automatically at 11pm"},
                        }),
                        '{"type":"api-request-blob","message":{"role":"user","content":"5-hour limit',
                    ]) + "\n",
                    encoding="utf-8",
                )
                synth_err = root / "synth_err.jsonl"
                synth_err.write_text(
                    "\n".join([
                        json.dumps({
                            "type": "assistant",
                            "isApiErrorMessage": True,
                            "error": "rate_limit",
                            "apiErrorStatus": 429,
                            "message": {"role": "assistant", "model": "<synthetic>", "content": [{"type": "text", "text": "You've hit your 5-hour limit · resets 5pm"}]},
                        }),
                        json.dumps({
                            "type": "system",
                            "subtype": "informational",
                            "content": "Usage limit reached · continuing automatically at 5pm · esc to cancel",
                        }),
                    ]) + "\n",
                    encoding="utf-8",
                )
                sub_blob = root / "sub_blob.jsonl"
                sub_blob.write_text(
                    "\n".join([
                        json.dumps({
                            "type": "user",
                            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]},
                        }),
                        json.dumps({
                            "type": "api-request-blob",
                            "message": {"role": "user", "content": "5-hour limit 429 rate_limit"},
                        }),
                        json.dumps({
                            "type": "assistant",
                            "message": {"role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "text", "text": "No 429 rate_limit occurred here."}]},
                        }),
                    ]) + "\n",
                    encoding="utf-8",
                )
                ps_check = "\n".join([
                    helper_src,
                    f'Write-Output ("fp_rl=" + (Test-SingleJsonlRateLimited -JsonlPath \'{blob_only.as_posix()}\'))',
                    f'Write-Output ("fp_ac=" + (Test-TranscriptAutoContinueNotice -JsonlPath \'{blob_only.as_posix()}\'))',
                    f'Write-Output ("fp_tu=" + (Test-TranscriptHasPendingToolUse -JsonlPath \'{blob_only.as_posix()}\'))',
                    f'Write-Output ("fp_sub=" + (Classify-SubagentTranscript -JsonlPath \'{sub_blob.as_posix()}\'))',
                    f'Write-Output ("tp_rl=" + (Test-SingleJsonlRateLimited -JsonlPath \'{synth_err.as_posix()}\'))',
                    f'Write-Output ("tp_ac=" + (Test-TranscriptAutoContinueNotice -JsonlPath \'{synth_err.as_posix()}\'))',
                ])
                res_u = subprocess.run([sh, "-NoProfile", "-Command", ps_check], capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(res_u.returncode, 0, res_u.stderr + "\n" + res_u.stdout)
                self.assertIn("fp_rl=False", res_u.stdout, res_u.stdout)
                self.assertIn("fp_ac=False", res_u.stdout, res_u.stdout)
                self.assertIn("fp_tu=False", res_u.stdout, res_u.stdout)
                self.assertIn("fp_sub=interrupted", res_u.stdout, res_u.stdout)
                self.assertIn("tp_rl=True", res_u.stdout, res_u.stdout)
                self.assertIn("tp_ac=True", res_u.stdout, res_u.stdout)

        id_a, id_b = "a" * 32, "b" * 32

        # 1. Live -AutoContinue session with api-request-blob + prose + Stop prose must NOT relay
        with tempfile.TemporaryDirectory(prefix="cl-fp-live-") as tmp:
            root = Path(tmp)
            home, work = root / "home_1", root / "work"
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            transcript_fp = "\n".join([
                json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t0", "content": "cut off twice by the 5-hour limit and the notification said failed"}]}}),
                json.dumps({
                    "type": "api-request-blob",
                    "sessionId": "sess-fp-live",
                    "hash": "deadbeef",
                    "message": {
                        "role": "user",
                        "content": [
                            {"type": "tool_use", "id": "tu_pending_in_blob", "name": "Read", "input": {"file_path": "a.txt"}},
                            {"type": "tool_result", "tool_use_id": "t0", "content": "cut off twice by the 5-hour limit"},
                        ],
                    },
                }),
                json.dumps({
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "model": "claude-opus-5-5",
                        "content": [{"type": "text", "text": "Summary: mentions 5-hour limit, HTTP 429, rate_limit_error, overloaded_error, continuing automatically."}],
                    },
                }),
                '{"type":"api-request-blob","message":{"role":"user","content":"5-hour limit',
            ]) + "\n"
            d1 = root / "s1"
            d1.mkdir()
            l1, c1, trace1, _ = _write_mock_shims(d1, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [{
                    "exit_code": 0,
                    "write_files": {
                        ".claude/sessions/99991.json": json.dumps({"pid": 99991, "sessionId": "sess-fp-live", "cwd": str(work)}),
                        f".claude/projects/{slug}/sess-fp-live.jsonl": transcript_fp,
                    },
                    "fire_stop": {
                        "hook_event_name": "Stop",
                        "last_assistant_message": "In docs, line 429 is overloaded and mentions 5-hour limit thresholds.",
                        "session_id": "sess-fp-live",
                    },
                    "sleep_after_hook_ms": 2500,
                }],
            })
            r1 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "--session-id=sess-fp-live"], _mock_env(home, l1, c1), work)
            self.assertEqual(r1.returncode, 0, r1.stderr + "\n" + r1.stdout)
            self.assertNotIn("Rate limit detected in live session", r1.stdout)
            tr1 = json.loads(trace1.read_text(encoding="utf-8"))
            self.assertEqual(len(tr1["claude_calls"]), 1)
            self.assertFalse(any(c.get("op") == "relay_switch" for c in tr1["orchestrate_calls"]))
            self.assertIsNone(tr1["claude_calls"][0].get("trigger_snapshot"))
            self.assertIsNotNone(tr1["claude_calls"][0].get("turn_end_snapshot"))

        # 2. WindowsApps Python stub -> sentinel_hook.ps1: prose Stop ignored, short synthetic Stop banner relays
        with tempfile.TemporaryDirectory(prefix="cl-fp-ps1-") as tmp:
            root = Path(tmp)
            work = root / "work"
            work.mkdir()
            stub_dir = root / "Microsoft" / "WindowsApps"
            stub_dir.mkdir(parents=True)
            (stub_dir / "python.exe").write_bytes(b"")
            (stub_dir / "py.cmd").write_text("@echo off\r\nexit /b 9009\r\n", encoding="utf-8")
            ps_dir = str(Path(ps_exe).parent)
            sys32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
            isolated_path = os.pathsep.join([str(stub_dir), ps_dir, sys32])

            home_a = root / "home_a"
            (home_a / ".claude" / "agents").mkdir(parents=True)
            (home_a / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            da = root / "sa"
            da.mkdir()
            la, ca, trace_a, _ = _write_mock_shims(da, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [{
                    "exit_code": 0,
                    "fire_stop": {
                        "hook_event_name": "Stop",
                        "last_assistant_message": "Checked line 429 where overloaded or 5-hour limit keywords appeared in prose.",
                        "session_id": "sess-ps-prose",
                    },
                }],
            })
            ra = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue"], _mock_env(home_a, la, ca, PATH=isolated_path), work)
            self.assertEqual(ra.returncode, 0, ra.stderr + "\n" + ra.stdout)
            tra = json.loads(trace_a.read_text(encoding="utf-8"))
            self.assertIn("sentinel_hook.ps1", tra["claude_calls"][0]["ephemeral_settings"]["hooks"]["Stop"][0]["hooks"][0]["command"])
            self.assertEqual(len(tra["claude_calls"]), 1)
            self.assertIsNone(tra["claude_calls"][0].get("trigger_snapshot"))
            self.assertIsNotNone(tra["claude_calls"][0].get("turn_end_snapshot"))
            self.assertFalse(any(c.get("op") == "relay_switch" for c in tra["orchestrate_calls"]))

            # Positive control via sentinel_hook.ps1: short synthetic Stop banner DOES relay
            home_b = root / "home_b"
            (home_b / ".claude" / "agents").mkdir(parents=True)
            (home_b / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            db = root / "sb"
            db.mkdir()
            lb, cb, trace_b, _ = _write_mock_shims(db, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "fire_stop": {
                            "hook_event_name": "Stop",
                            "last_assistant_message": "API Error: 429 rate_limit_error",
                            "session_id": "sess-ps-banner",
                        },
                    },
                    {"exit_code": 0, "stdout": "relayed from short ps1 banner\n"},
                ],
            })
            rb = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue"], _mock_env(home_b, lb, cb, PATH=isolated_path), work)
            self.assertEqual(rb.returncode, 0, rb.stderr + "\n" + rb.stdout)
            trb = json.loads(trace_b.read_text(encoding="utf-8"))
            self.assertEqual(len(trb["claude_calls"]), 2)
            self.assertEqual((trb["claude_calls"][0].get("trigger_snapshot") or {}).get("reason"), "rate_limit")

        # 3. Positive control: real <synthetic> isApiErrorMessage:true + system Usage limit reached still relay
        with tempfile.TemporaryDirectory(prefix="cl-fp-pos-") as tmp:
            root = Path(tmp)
            home, work = root / "home_pos", root / "work"
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            work.mkdir()
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            dp = root / "sp"
            dp.mkdir()
            lp, cp, trace_p, _ = _write_mock_shims(dp, {
                "orchestrate": {
                    "status": {"ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "config": {"autoContinueOnRelay": True}},
                    "relay_switch": {"_same_account": True, "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b, "from_name": "A", "target_name": "B", "reason": "rate_limited"},
                },
                "claude_runs": [
                    {
                        "exit_code": 1,
                        "write_files": {
                            f".claude/projects/{slug}/sess-real-synth.jsonl": "\n".join([
                                json.dumps({
                                    "type": "assistant",
                                    "isApiErrorMessage": True,
                                    "error": "rate_limit",
                                    "message": {"role": "assistant", "model": "<synthetic>", "content": [{"type": "text", "text": "You've hit your 5-hour limit"}]},
                                }),
                                json.dumps({
                                    "type": "system",
                                    "subtype": "informational",
                                    "content": "Usage limit reached · continuing automatically at 5pm",
                                }),
                            ]) + "\n",
                        },
                    },
                    {"exit_code": 0, "stdout": "relayed genuine synthetic 429\n"},
                ],
            })
            rp = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "--session-id=sess-real-synth"], _mock_env(home, lp, cp), work)
            self.assertEqual(rp.returncode, 0, rp.stderr + "\n" + rp.stdout)
            trp = json.loads(trace_p.read_text(encoding="utf-8"))
            self.assertEqual(len(trp["claude_calls"]), 2)
            sw_p = [c for c in trp["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_p), 1)
            self.assertTrue(sw_p[0].get("rate_limited"))

    def test_relay_proactive_threshold_posttooluse_two_stage_handoff_and_digest(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        assert shells
        ps_exe = shells[0]
        id_a, id_b = "a" * 32, "b" * 32

        # 0. Show-RelayStatus defaults maxSameExitConcurrency to 1 when omitted from config
        with tempfile.TemporaryDirectory(prefix="cl-status-def-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            l0, c0, _, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": {
                        "ok": True,
                        "cli_running": False,
                        "should_relay_now": False,
                        "active": id_a,
                        "active_name": "Acct-A",
                        "config": {"strategy": "smart", "spentThresholdPct": 98, "autoContinueOnRelay": False},
                        "accounts": [{"id": id_a, "name": "Acct-A", "is_current": True, "tier": "ready", "rem_5h": 80, "rem_7d": 80}],
                    },
                },
                "claude_runs": [],
            })
            res0 = _run_ps(ps_exe, RELAY_PS1, ["-Status"], _mock_env(home, l0, c0), work)
            self.assertEqual(res0.returncode, 0, res0.stderr)
            self.assertIn("maxSameExitConcurrency=1", res0.stdout)

        # 1. Below-threshold PostToolUse returns empty stdout (both Python hook and ps1 fallback)
        stub_root = Path(tempfile.mkdtemp(prefix="cl-ptu-below-"))
        try:
            work = stub_root / "work"
            work.mkdir()
            stub_dir = stub_root / "Microsoft" / "WindowsApps"
            stub_dir.mkdir(parents=True)
            (stub_dir / "python.exe").write_bytes(b"")
            (stub_dir / "py.cmd").write_text("@echo off\r\nexit /b 9009\r\n", encoding="utf-8")
            ps_dir = str(Path(ps_exe).parent)
            sys32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
            isolated_path = os.pathsep.join([str(stub_dir), ps_dir, sys32])

            for mode in ("python", "ps1"):
                with self.subTest(below_threshold_hook=mode):
                    d_below = stub_root / f"below_{mode}"
                    d_below.mkdir()
                    home = d_below / "home"
                    (home / ".claude" / "agents").mkdir(parents=True)
                    (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
                    l_b, c_b, t_b, _ = _write_mock_shims(d_below, {
                        "orchestrate": {
                            "status": {
                                "ok": True,
                                "cli_running": False,
                                "should_relay_now": False,
                                "active": id_a,
                                "active_name": "Acct-A",
                                "ranked_auto_targets": [id_b],
                                "accounts": [
                                    {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 70, "used_7d": 30},
                                    {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90},
                                ],
                                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
                            },
                        },
                        "claude_runs": [{
                            "exit_code": 0,
                            "write_files": {
                                "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 70}}}),
                            },
                            "sleep_before_post_tool_use_ms": 650,
                            "fire_post_tool_use": [{"hook_event_name": "PostToolUse", "tool_name": "Read", "session_id": "sess-below-1"}],
                        }],
                    })
                    extra_env = {"PATH": isolated_path} if mode == "ps1" else {}
                    r_b = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "85"], _mock_env(home, l_b, c_b, **extra_env), work)
                    self.assertEqual(r_b.returncode, 0, r_b.stderr + "\n" + r_b.stdout)
                    tr_b = json.loads(t_b.read_text(encoding="utf-8"))
                    self.assertEqual(len(tr_b["claude_calls"]), 1)
                    ptu_outs = tr_b["claude_calls"][0].get("post_tool_use_outputs") or []
                    self.assertEqual(len(ptu_outs), 1)
                    self.assertEqual(ptu_outs[0]["returncode"], 0)
                    self.assertEqual(ptu_outs[0]["stdout"], "")
                    self.assertIsNone(ptu_outs[0]["parsed"])
                    self.assertIsNone(tr_b["claude_calls"][0].get("threshold_armed_snapshot"))
                    self.assertIsNone(tr_b["claude_calls"][0].get("proactive_handoff_snapshot"))
                    self.assertFalse(any(c.get("op") == "relay_switch" for c in tr_b["orchestrate_calls"]))
        finally:
            shutil.rmtree(stub_root, ignore_errors=True)

        # 2. Armed PostToolUse Stage 1 (wrapping_up) -> Stop (proactive_wrapup=True) -> clean_handoff + CLEAN_CONT_PROMPT + 1200-char final digest
        with tempfile.TemporaryDirectory(prefix="cl-ptu-stage1-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))

            earlier_text = "EARLY_STEP_" + ("x" * 740) + "_END_EARLY"
            final_text = "FINAL_HANDOFF_SUMMARY: Completed parser refactor; Files Modified: src/mod.py; Exact Next Step: " + ("y" * 920) + "_END_FINAL"
            transcript_s1 = "\n".join([
                json.dumps({"type": "user", "sessionId": "sess-pro-stage1", "message": {"role": "user", "content": "Refactor module cleanly"}}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": earlier_text}]}}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": final_text}]}}),
            ]) + "\n"

            status_pre = {
                "ok": True, "cli_running": False, "should_relay_now": False,
                "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                "accounts": [
                    {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 72, "used_7d": 35, "effective_rem": 28},
                    {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 92},
                ],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            status_armed = {
                "ok": True, "cli_running": True, "should_relay_now": True,
                "relay_trigger_kind": "threshold_reached", "active": id_a, "active_name": "Acct-A",
                "ranked_auto_targets": [id_b],
                "accounts": [
                    {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 86, "used_7d": 35, "effective_rem": 14},
                    {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 92},
                ],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            status_post = {
                "ok": True, "cli_running": False, "should_relay_now": False,
                "active": id_b, "active_name": "Acct-B", "ranked_auto_targets": [],
                "accounts": [{"id": id_b, "name": "Acct-B", "is_current": True, "used_5h": 5, "used_7d": 8, "effective_rem": 92}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            l1, c1, t1, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": [status_pre, status_armed, status_armed, status_armed, status_post],
                    "relay_switch": {
                        "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b,
                        "from_name": "Acct-A", "target_name": "Acct-B", "target_effective_rem": 92, "reason": "threshold_reached",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "write_files": {
                            "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 86}}}),
                            ".claude/sessions/99901.json": json.dumps({"pid": 99901, "sessionId": "sess-pro-stage1", "cwd": str(work)}),
                            f".claude/projects/{slug}/sess-pro-stage1.jsonl": transcript_s1,
                        },
                        "wait_for_armed_timeout_ms": 4000,
                        "fire_post_tool_use": [{"hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "sess-pro-stage1", "transcript_path": str(home / ".claude" / "projects" / slug / "sess-pro-stage1.jsonl")}],
                        "fire_stop": {"hook_event_name": "Stop", "stop_hook_active": False, "session_id": "sess-pro-stage1", "transcript_path": str(home / ".claude" / "projects" / slug / "sess-pro-stage1.jsonl")},
                        "sleep_after_hook_ms": 1950,
                    },
                    {"exit_code": 0, "stdout": "continued cleanly on Acct-B\n"},
                ],
            })
            r1 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "85", "--model", "sonnet"], _mock_env(home, l1, c1), work)
            self.assertEqual(r1.returncode, 0, r1.stderr + "\n" + r1.stdout)
            tr1 = json.loads(t1.read_text(encoding="utf-8"))
            self.assertEqual(len(tr1["claude_calls"]), 2)
            armed_snap = tr1["claude_calls"][0].get("threshold_armed_snapshot") or {}
            self.assertIs(armed_snap.get("armed"), True)
            self.assertEqual(armed_snap.get("threshold_pct"), 85)
            self.assertEqual(armed_snap.get("hard_cap_pct"), 90)
            self.assertEqual(armed_snap.get("used_5h"), 86)
            self.assertEqual(armed_snap.get("standby_name"), "Acct-B (92%)")

            ptu_out1 = tr1["claude_calls"][0]["post_tool_use_outputs"][0]
            self.assertEqual(ptu_out1["returncode"], 0)
            parsed1 = ptu_out1["parsed"]
            self.assertIsInstance(parsed1, dict)
            self.assertIn("86%", parsed1["systemMessage"])
            self.assertIn("threshold 85%", parsed1["systemMessage"])
            self.assertIn("Acct-B (92%)", parsed1["systemMessage"])
            self.assertEqual(parsed1["hookSpecificOutput"]["hookEventName"], "PostToolUse")
            self.assertIn("at most 2 quick tool calls", parsed1["hookSpecificOutput"]["additionalContext"])

            pro_snap1 = tr1["claude_calls"][0].get("proactive_handoff_snapshot") or {}
            self.assertEqual(pro_snap1.get("stage"), "wrapping_up")
            self.assertEqual(pro_snap1.get("post_notice_tools"), 0)
            te_snap1 = tr1["claude_calls"][0].get("turn_end_snapshot") or {}
            self.assertIs(te_snap1.get("proactive_wrapup"), True)

            sw1 = [c for c in tr1["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw1), 1)
            self.assertFalse(sw1[0].get("rate_limited", False))

            run2_argv = tr1["claude_calls"][1]["argv"]
            self.assertNotIn("--resume", run2_argv)
            self.assertIn("--append-system-prompt", run2_argv)
            self.assertEqual(run2_argv[-2:], ["--", CLEAN_CONT_PROMPT])

            handoff_md = home / "AppData" / "Roaming" / "ai.local.claude-local" / "handoff" / "latest-handoff.md"
            md_txt = handoff_md.read_text(encoding="utf-8")
            self.assertNotIn("_END_EARLY", md_txt, "earlier progress item must still be capped at 600 chars")
            self.assertIn("_END_FINAL", md_txt, "final progress item up to 1200 chars must be preserved intact")

        # 3a. Armed PostToolUse Stage 2 (forced_stop via >= 2 post-notice tools) -> relays with CLEAN_CONT_PROMPT
        with tempfile.TemporaryDirectory(prefix="cl-ptu-stage2-tools-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            t_path = home / ".claude" / "projects" / slug / "sess-pro-tools.jsonl"
            t_lines = "\n".join([
                json.dumps({"type": "user", "sessionId": "sess-pro-tools", "message": {"role": "user", "content": "Run migration"}}),
                json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "tu_1", "name": "Bash", "input": {"command": "echo 1"}}]}}),
                json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "1"}]}}),
            ]) + "\n"

            st_80_pre = {
                "ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "active_name": "Acct-A",
                "ranked_auto_targets": [id_b],
                "accounts": [
                    {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 60, "used_7d": 20, "effective_rem": 40},
                    {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 91},
                ],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 80},
            }
            st_80_armed = {
                "ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "threshold_reached",
                "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                "accounts": [
                    {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 81, "used_7d": 20, "effective_rem": 19},
                    {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 91},
                ],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 80},
            }
            st_80_post = {
                "ok": True, "cli_running": False, "should_relay_now": False, "active": id_b, "active_name": "Acct-B",
                "ranked_auto_targets": [],
                "accounts": [{"id": id_b, "name": "Acct-B", "is_current": True, "used_5h": 9, "used_7d": 9, "effective_rem": 91}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 80},
            }
            l2, c2, t2, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": [st_80_pre, st_80_armed, st_80_armed, st_80_armed, st_80_post],
                    "relay_switch": {
                        "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b,
                        "from_name": "Acct-A", "target_name": "Acct-B", "target_effective_rem": 91, "reason": "threshold_reached",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "write_files": {
                            "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 81}}}),
                            ".claude/sessions/99902.json": json.dumps({"pid": 99902, "sessionId": "sess-pro-tools", "cwd": str(work)}),
                            f".claude/projects/{slug}/sess-pro-tools.jsonl": t_lines,
                        },
                        "wait_for_armed_timeout_ms": 4000,
                        "fire_post_tool_use": [
                            {"hook_event_name": "PostToolUse", "tool_name": "Read", "session_id": "sess-pro-tools", "transcript_path": str(t_path)},
                            {"hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "sess-pro-tools", "transcript_path": str(t_path)},
                            {"hook_event_name": "PostToolUse", "tool_name": "Bash", "session_id": "sess-pro-tools", "transcript_path": str(t_path)},
                        ],
                        "sleep_after_hook_ms": 950,
                    },
                    {"exit_code": 0, "stdout": "resumed after forced_stop >=2 tools\n"},
                ],
            })
            r2 = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "80"], _mock_env(home, l2, c2), work)
            self.assertEqual(r2.returncode, 0, r2.stderr + "\n" + r2.stdout)
            tr2 = json.loads(t2.read_text(encoding="utf-8"))
            self.assertEqual(len(tr2["claude_calls"]), 2)
            outs2 = tr2["claude_calls"][0]["post_tool_use_outputs"]
            self.assertEqual(len(outs2), 3)
            self.assertIn("systemMessage", outs2[0]["parsed"])
            self.assertNotIn("systemMessage", outs2[1]["parsed"])
            self.assertIn("1 tool call left", outs2[1]["parsed"]["hookSpecificOutput"]["additionalContext"])
            self.assertIs(outs2[2]["parsed"]["continue"], False)
            self.assertIn("81% / 80%", outs2[2]["parsed"]["stopReason"])
            self.assertIn("Acct-B (91%)", outs2[2]["parsed"]["stopReason"])
            self.assertEqual((tr2["claude_calls"][0].get("proactive_handoff_snapshot") or {}).get("stage"), "forced_stop")
            self.assertEqual((tr2["claude_calls"][0].get("proactive_handoff_snapshot") or {}).get("post_notice_tools"), 2)
            sw2 = [c for c in tr2["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw2), 1)
            self.assertFalse(sw2[0].get("rate_limited", False))
            self.assertEqual(tr2["claude_calls"][1]["argv"][-2:], ["--", CLEAN_CONT_PROMPT])

        # 3b. Armed PostToolUse Stage 2 (forced_stop via max_used >= hard_cap_pct) in Python hook and ps1 fallback across available PS engines
        stub_root2 = Path(tempfile.mkdtemp(prefix="cl-ptu-hardcap-"))
        try:
            work = stub_root2 / "work"
            work.mkdir()
            stub_dir = stub_root2 / "Microsoft" / "WindowsApps"
            stub_dir.mkdir(parents=True)
            (stub_dir / "python.exe").write_bytes(b"")
            (stub_dir / "py.cmd").write_text("@echo off\r\nexit /b 9009\r\n", encoding="utf-8")
            sys32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")

            hc_targets = [("python", ps_exe)] + [("ps1", sh) for sh in shells]
            for mode, sh_exe in hc_targets:
                with self.subTest(hard_cap_hook=mode, shell=Path(sh_exe).name):
                    d_hc = stub_root2 / f"hc_{mode}_{Path(sh_exe).stem}"
                    d_hc.mkdir()
                    home = d_hc / "home"
                    (home / ".claude" / "agents").mkdir(parents=True)
                    (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
                    slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
                    t_path = home / ".claude" / "projects" / slug / f"sess-hc-{mode}.jsonl"
                    t_lines = json.dumps({"type": "user", "sessionId": f"sess-hc-{mode}", "message": {"role": "user", "content": "Finish build"}}) + "\n"

                    st_98_pre = {
                        "ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "active_name": "Acct-A",
                        "ranked_auto_targets": [id_b],
                        "accounts": [
                            {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 80, "used_7d": 20, "effective_rem": 20},
                            {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 95},
                        ],
                        "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                    }
                    st_98_armed = {
                        "ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "threshold_reached",
                        "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                        "accounts": [
                            {"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 99, "used_7d": 20, "effective_rem": 1},
                            {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 95},
                        ],
                        "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                    }
                    st_98_post = {
                        "ok": True, "cli_running": False, "should_relay_now": False, "active": id_b, "active_name": "Acct-B",
                        "ranked_auto_targets": [],
                        "accounts": [{"id": id_b, "name": "Acct-B", "is_current": True, "used_5h": 1, "used_7d": 5, "effective_rem": 95}],
                        "config": {"autoContinueOnRelay": True, "spentThresholdPct": 98},
                    }
                    l3, c3, t3, _ = _write_mock_shims(d_hc, {
                        "orchestrate": {
                            "status": [st_98_pre, st_98_armed, st_98_armed, st_98_armed, st_98_post],
                            "relay_switch": {
                                "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b,
                                "from_name": "Acct-A", "target_name": "Acct-B", "target_effective_rem": 95, "reason": "threshold_reached",
                            },
                        },
                        "claude_runs": [
                            {
                                "exit_code": 0,
                                "write_files": {
                                    "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 99}}}),
                                    ".claude/sessions/99903.json": json.dumps({"pid": 99903, "sessionId": f"sess-hc-{mode}", "cwd": str(work)}),
                                    f".claude/projects/{slug}/sess-hc-{mode}.jsonl": t_lines,
                                },
                                "wait_for_armed_timeout_ms": 4000,
                                "fire_post_tool_use": [{"hook_event_name": "PostToolUse", "tool_name": "Bash", "session_id": f"sess-hc-{mode}", "transcript_path": str(t_path)}],
                                "sleep_after_hook_ms": 950,
                            },
                            {"exit_code": 0, "stdout": f"resumed after hard_cap forced_stop ({mode})\n"},
                        ],
                    })
                    sh_dir = str(Path(sh_exe).parent)
                    extra_env = {"PATH": os.pathsep.join([str(stub_dir), sh_dir, sys32])} if mode == "ps1" else {}
                    r3 = _run_ps(sh_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "98"], _mock_env(home, l3, c3, **extra_env), work)
                    self.assertEqual(r3.returncode, 0, r3.stderr + "\n" + r3.stdout)
                    tr3 = json.loads(t3.read_text(encoding="utf-8"))
                    self.assertEqual(len(tr3["claude_calls"]), 2)
                    if mode == "ps1":
                        self.assertIn("sentinel_hook.ps1", tr3["claude_calls"][0]["ephemeral_settings"]["hooks"]["PostToolUse"][0]["hooks"][0]["command"])
                    out3 = tr3["claude_calls"][0]["post_tool_use_outputs"][0]
                    self.assertEqual(out3["returncode"], 0)
                    self.assertIs(out3["parsed"]["continue"], False)
                    self.assertIn("99% / 98%", out3["parsed"]["stopReason"])
                    self.assertEqual((tr3["claude_calls"][0].get("proactive_handoff_snapshot") or {}).get("stage"), "forced_stop")
                    sw3 = [c for c in tr3["orchestrate_calls"] if c.get("op") == "relay_switch"]
                    self.assertEqual(len(sw3), 1)
                    self.assertFalse(sw3[0].get("rate_limited", False))
                    self.assertEqual(tr3["claude_calls"][1]["argv"][-2:], ["--", CLEAN_CONT_PROMPT])
        finally:
            shutil.rmtree(stub_root2, ignore_errors=True)

        # 4. Verify Test-HasLiveChildShellOrWork ignores MCP/wrapper/tool-host commands
        relay_text = RELAY_PS1.read_text(encoding="utf-8-sig")
        for token in (r"\bnpx\b", r"\buvx\b", "dual[-_]?collab", "claude-local", "node_modules"):
            self.assertIn(token, relay_text)

    def test_relay_external_worker_timeout_turn_end_and_5h_reset_mid_wrapup(self):
        shells = [s for s in (shutil.which("pwsh"), shutil.which("powershell.exe")) if s]
        assert shells
        ps_exe = shells[0]
        id_a, id_b = "a" * 32, "b" * 32

        # 1. External non-Claude worker timeout during turn_end deferral falls through to status -> relay (never drops relay!)
        with tempfile.TemporaryDirectory(prefix="cl-ext-timeout-") as tmp:
            root = Path(tmp)
            home, work = root / "home", root / "work"
            home.mkdir()
            work.mkdir()
            (home / ".claude" / "agents").mkdir(parents=True)
            (home / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            t_path = home / ".claude" / "projects" / slug / "sess-ext-to.jsonl"
            t_lines = json.dumps({"type": "user", "sessionId": "sess-ext-to", "message": {"role": "user", "content": "Run external worker"}}) + "\n"

            st_pre = {
                "ok": True, "cli_running": False, "should_relay_now": False, "active": id_a, "active_name": "Acct-A",
                "ranked_auto_targets": [id_b],
                "accounts": [{"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 70, "used_7d": 20, "effective_rem": 30},
                             {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            st_ready = {
                "ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "threshold_reached",
                "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                "accounts": [{"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 87, "used_7d": 20, "effective_rem": 13},
                             {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            st_post = {
                "ok": True, "cli_running": False, "should_relay_now": False, "active": id_b, "active_name": "Acct-B",
                "ranked_auto_targets": [],
                "accounts": [{"id": id_b, "name": "Acct-B", "is_current": True, "used_5h": 0, "used_7d": 10, "effective_rem": 90}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            l_ext, c_ext, tr_ext_p, _ = _write_mock_shims(root, {
                "orchestrate": {
                    "status": [st_pre, st_ready, st_ready, st_post],
                    "relay_switch": {
                        "ok": True, "switched": True, "from_record_id": id_a, "target_id": id_b,
                        "from_name": "Acct-A", "target_name": "Acct-B", "target_effective_rem": 90, "reason": "threshold_reached",
                    },
                },
                "claude_runs": [
                    {
                        "exit_code": 0,
                        "write_files": {
                            f".claude/projects/{slug}/sess-ext-to.jsonl": t_lines,
                            f".claude/projects/{slug}/sess-ext-to/subagents/agent-ext.meta.json": json.dumps({"agentType": "gemini-reviewer", "finished": False}),
                        },
                        "fire_stop": {"hook_event_name": "Stop", "stop_hook_active": False, "session_id": "sess-ext-to", "transcript_path": str(t_path)},
                        "spawn_ext_worker_ms": 2300,
                        "sleep_after_hook_ms": 2350,
                        "capture_ephemeral_after_sleep": True,
                    },
                    {"exit_code": 0, "stdout": "relayed after external worker timeout\n"},
                ],
            })
            env_ext = _mock_env(home, l_ext, c_ext, CLAUDE_RELAY_TEST_EXT_TIMEOUT_SEC="0.4")
            r_ext = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "85"], env_ext, work)
            self.assertEqual(r_ext.returncode, 0, r_ext.stderr + "\n" + r_ext.stdout)
            self.assertIn("deferring /exit up to 300s until completion", r_ext.stdout)
            tr_ext = json.loads(tr_ext_p.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_ext["claude_calls"]), 2)
            sw_ext = [c for c in tr_ext["orchestrate_calls"] if c.get("op") == "relay_switch"]
            self.assertEqual(len(sw_ext), 1)
            self.assertFalse(tr_ext["claude_calls"][0]["ephemeral_after_sleep"]["turn_end_exists"])

        # 2. Mid-wrapup 5h reset clears threshold_armed.json & proactive_handoff.json cleanly without relaying
        #    (covers both forced_stop status recheck and wrapping_up -> turn_end status recheck, plus PS 5.1 Stage 1/1.5 fallback)
        stub_root = Path(tempfile.mkdtemp(prefix="cl-5h-reset-wrap-"))
        try:
            work = stub_root / "work"
            work.mkdir()
            stub_dir = stub_root / "Microsoft" / "WindowsApps"
            stub_dir.mkdir(parents=True)
            (stub_dir / "python.exe").write_bytes(b"")
            (stub_dir / "py.cmd").write_text("@echo off\r\nexit /b 9009\r\n", encoding="utf-8")
            sys32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")

            st_armed = {
                "ok": True, "cli_running": True, "should_relay_now": True, "relay_trigger_kind": "threshold_reached",
                "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                "accounts": [{"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 88, "used_7d": 25, "effective_rem": 12},
                             {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }
            st_reset_5h = {
                "ok": True, "cli_running": True, "should_relay_now": False,
                "active": id_a, "active_name": "Acct-A", "ranked_auto_targets": [id_b],
                "accounts": [{"id": id_a, "name": "Acct-A", "is_current": True, "used_5h": 0, "used_7d": 25, "effective_rem": 75},
                             {"id": id_b, "name": "Acct-B", "is_current": False, "effective_rem": 90}],
                "config": {"autoContinueOnRelay": True, "spentThresholdPct": 85},
            }

            # 2a. forced_stop encounters 5h reset -> clears proactive state & does not relay (also exercises ps1 hook Stage 1 & 1.5 in PS 5.1 if available)
            ps51_or_pwsh = shutil.which("powershell.exe") or ps_exe
            d_fs = stub_root / "reset_forced"
            d_fs.mkdir()
            home_fs = d_fs / "home"
            (home_fs / ".claude" / "agents").mkdir(parents=True)
            (home_fs / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in str(work))
            t_fs = home_fs / ".claude" / "projects" / slug / "sess-reset-fs.jsonl"
            l_fs, c_fs, tr_fs_p, _ = _write_mock_shims(d_fs, {
                "orchestrate": {
                    "status": [
                        {**st_reset_5h, "cli_running": False},
                        st_armed,
                        st_reset_5h,
                        {**st_reset_5h, "cli_running": False},
                    ],
                },
                "claude_runs": [{
                    "exit_code": 0,
                    "write_files": {
                        "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 88}}}),
                        ".claude/sessions/99911.json": json.dumps({"pid": 99911, "sessionId": "sess-reset-fs", "cwd": str(work)}),
                        f".claude/projects/{slug}/sess-reset-fs.jsonl": json.dumps({"type": "user", "sessionId": "sess-reset-fs", "message": {"role": "user", "content": "Work"}}) + "\n",
                    },
                    "wait_for_armed_timeout_ms": 4000,
                    "fire_post_tool_use": [
                        {"hook_event_name": "PostToolUse", "tool_name": "Read", "session_id": "sess-reset-fs", "transcript_path": str(t_fs)},
                        {"hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "sess-reset-fs", "transcript_path": str(t_fs)},
                        {"hook_event_name": "PostToolUse", "tool_name": "Bash", "session_id": "sess-reset-fs", "transcript_path": str(t_fs)},
                    ],
                    "sleep_after_hook_ms": 2100,
                    "capture_ephemeral_after_sleep": True,
                }],
            })
            iso_path = os.pathsep.join([str(stub_dir), str(Path(ps51_or_pwsh).parent), sys32])
            r_fs = _run_ps(ps51_or_pwsh, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "85"], _mock_env(home_fs, l_fs, c_fs, PATH=iso_path), work)
            self.assertEqual(r_fs.returncode, 0, r_fs.stderr + "\n" + r_fs.stdout)
            tr_fs = json.loads(tr_fs_p.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_fs["claude_calls"]), 1)
            self.assertFalse(any(c.get("op") == "relay_switch" for c in tr_fs["orchestrate_calls"]))
            self.assertGreaterEqual(sum(1 for c in tr_fs["orchestrate_calls"] if c.get("op") == "status"), 4)
            outs_fs = tr_fs["claude_calls"][0]["post_tool_use_outputs"]
            self.assertIn("systemMessage", outs_fs[0]["parsed"])
            self.assertIn("1 tool call left", outs_fs[1]["parsed"]["hookSpecificOutput"]["additionalContext"])
            self.assertIs(outs_fs[2]["parsed"]["continue"], False)
            self.assertFalse(tr_fs["claude_calls"][0]["ephemeral_after_sleep"]["threshold_armed_exists"])
            self.assertFalse(tr_fs["claude_calls"][0]["ephemeral_after_sleep"]["proactive_handoff_exists"])

            # 2b. wrapping_up -> Stop (turn_end) encounters 5h reset -> clears proactive state & does not relay
            d_te = stub_root / "reset_turn_end"
            d_te.mkdir()
            home_te = d_te / "home"
            (home_te / ".claude" / "agents").mkdir(parents=True)
            (home_te / ".claude" / "agents" / "pro-pool-worker.md").write_text("installed\n", encoding="utf-8")
            t_te = home_te / ".claude" / "projects" / slug / "sess-reset-te.jsonl"
            l_te, c_te, tr_te_p, _ = _write_mock_shims(d_te, {
                "orchestrate": {
                    "status": [
                        {**st_reset_5h, "cli_running": False},
                        st_armed,
                        st_reset_5h,
                        {**st_reset_5h, "cli_running": False},
                    ],
                },
                "claude_runs": [{
                    "exit_code": 0,
                    "write_files": {
                        "AppData/Roaming/ai.local.claude-local/quota_ledger.json": json.dumps({"accounts": {"a@example.invalid": {"quota_5h_used": 88}}}),
                        ".claude/sessions/99912.json": json.dumps({"pid": 99912, "sessionId": "sess-reset-te", "cwd": str(work)}),
                        f".claude/projects/{slug}/sess-reset-te.jsonl": json.dumps({"type": "user", "sessionId": "sess-reset-te", "message": {"role": "user", "content": "Work"}}) + "\n",
                    },
                    "wait_for_armed_timeout_ms": 4000,
                    "fire_post_tool_use": [{"hook_event_name": "PostToolUse", "tool_name": "Read", "session_id": "sess-reset-te", "transcript_path": str(t_te)}],
                    "fire_stop": {"hook_event_name": "Stop", "stop_hook_active": False, "session_id": "sess-reset-te", "transcript_path": str(t_te)},
                    "sleep_after_hook_ms": 2600,
                    "capture_ephemeral_after_sleep": True,
                }],
            })
            r_te = _run_ps(ps_exe, RELAY_PS1, ["-AutoContinue", "-ThresholdPct", "85"], _mock_env(home_te, l_te, c_te), work)
            self.assertEqual(r_te.returncode, 0, r_te.stderr + "\n" + r_te.stdout)
            tr_te = json.loads(tr_te_p.read_text(encoding="utf-8"))
            self.assertEqual(len(tr_te["claude_calls"]), 1)
            self.assertFalse(any(c.get("op") == "relay_switch" for c in tr_te["orchestrate_calls"]))
            self.assertGreaterEqual(sum(1 for c in tr_te["orchestrate_calls"] if c.get("op") == "status"), 4)
            self.assertFalse(tr_te["claude_calls"][0]["ephemeral_after_sleep"]["threshold_armed_exists"])
            self.assertFalse(tr_te["claude_calls"][0]["ephemeral_after_sleep"]["proactive_handoff_exists"])
        finally:
            shutil.rmtree(stub_root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
