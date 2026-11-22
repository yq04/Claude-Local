# [INPUT]: Fictional statusLine payloads, smart_relay_v1.json fixtures, temporary ledgers and bounded Rust subprocess fixtures.
# [OUTPUT]: Percentage-input validation, independent window persistence, SmartRelay statusLine hints, 80/85 threshold filter checks, and inferred-reset/bridge regressions.
# [POS]: Synthetic quota tests; never open real Claude settings, account data or processes.
# [PROTOCOL]: Keep scripts/CLAUDE.md aligned with the tested input and writer boundaries.
"""Synthetic ledger tests; never open the real Claude home or application data."""
import importlib.util
import contextlib
import io
import json
import os
import sqlite3
import sys
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("local_quota", Path(__file__).with_name("claude_quota.py"))
quota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quota)


class LocalQuotaTests(unittest.TestCase):
    def test_statusline_validates_percentage_without_poisoning_other_window(self):
        cases = [(value, None) for value in [1_800_000_000, float('nan'), float('inf'), -1, True, 'invalid']]
        cases += [(100.7, 100), (0, 0)]
        for value, expected in cases:
            with self.subTest(value=repr(value)), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                home, appdata = root / 'home', root / 'appdata'
                home.mkdir()
                app = appdata / 'ai.local.claude-local'
                app.mkdir(parents=True)
                (home / '.claude.json').write_text(json.dumps({'oauthAccount': {
                    'accountUuid': 'a', 'emailAddress': 'input@example.invalid'}}), encoding='utf-8')
                reset = int(datetime.now(timezone.utc).timestamp()) + 1000
                payload = {'rate_limits': {'five_hour': {'used_percentage': value, 'resets_at': reset},
                                           'seven_day': {'used_percentage': 42, 'resets_at': reset + 86400}}}
                with patch.dict(os.environ, {'USERPROFILE': str(home), 'APPDATA': str(appdata)}, clear=True), \
                        patch.object(sys, 'stdin', io.StringIO(json.dumps(payload))), \
                        contextlib.redirect_stdout(io.StringIO()):
                    quota.handle_statusline()
                entry = quota.load_ledger(str(app))['accounts']['input@example.invalid']
                self.assertEqual(entry['quota_5h_used'], expected)
                self.assertEqual(entry['quota_5h_source'], 'unknown' if expected is None else 'server_anchor')
                self.assertEqual(entry['quota_7d_used'], 42)
                self.assertEqual(entry['quota_7d_source'], 'server_anchor')

    def test_corrupt_cached_percentage_is_not_recertified_from_a_clamped_ledger_value(self):
        now = 2_000_000_000
        entry = {'account_uuid': 'a', 'quota_5h_source': 'server_anchor', 'quota_5h_used': 100,
                 'quota_5h_reset_at': now + 600, 'quota_5h_observed_at_ms': (now - 1) * 1000,
                 'server_anchor': {'accountUuid': 'a', 'fetchedAtMs': (now - 1) * 1000,
                     'utilization': {'five_hour': {'utilization': 1_800_000_000, 'resets_at': now + 600}}}}
        self.assertEqual(quota.entry_window_state(entry, '5h', 'five_hour', now)[2], 'unknown')

    def test_writer_omits_invalid_anchor_window_without_mutating_the_source(self):
        now = 2_000_000_000
        anchor = {'accountUuid': 'a', 'fetchedAtMs': now * 1000, 'utilization': {
            'five_hour': {'utilization': float('nan'), 'resets_at': now + 600},
            'seven_day': {'utilization': 42, 'resets_at': now + 86400}}}
        item = {'role': 'current', 'email': 'input@example.invalid', 'account_uuid': 'a',
                'used_5h': None, 'quota_5h_source': 'unknown', 'used_7d': 42,
                'reset_7d_ts': now + 86400, 'quota_7d_source': 'server_anchor',
                'quota_7d_observed_at_ms': now * 1000, 'server_anchor': anchor}
        with tempfile.TemporaryDirectory() as temp:
            quota.save_ledger_and_sync_sqlite(temp, str(Path(temp) / 'no-db'), [item],
                                            datetime.fromtimestamp(now, timezone.utc))
            def reject_constant(value):
                raise ValueError('non-finite JSON is not allowed')
            stored = json.loads((Path(temp) / 'quota_ledger.json').read_text(encoding='utf-8'),
                                parse_constant=reject_constant)['accounts']['input@example.invalid']
        self.assertIsNone(stored['quota_5h_used'])
        self.assertEqual(stored['quota_7d_used'], 42)
        self.assertNotIn('five_hour', stored['server_anchor']['utilization'])
        self.assertNotEqual(anchor['utilization']['five_hour']['utilization'],
                            anchor['utilization']['five_hour']['utilization'])

    def test_quota_core_bridge_uses_fixed_flag_and_schema(self):
        with tempfile.TemporaryDirectory() as temp:
            executable = Path(temp) / "claude-local.exe"
            executable.write_bytes(b"synthetic executable marker")
            outputs = [{"used": 20, "reset_at": 10000, "source": "server_anchor", "observed_at_ms": 1000}]
            completed = subprocess.CompletedProcess([], 0, json.dumps({"schema": 1, "items": outputs}).encode(), b"")
            with patch.object(quota, "_quota_core_executable", return_value=executable), \
                    patch.object(quota.subprocess, "run", return_value=completed) as run:
                result = quota.merge_window_states(
                    [(10, 10000, "local_estimate", 900)], [(20, 10000, "server_anchor", 1000)], 100)
            self.assertEqual(result, [(20, 10000, "server_anchor", 1000)])
            args, kwargs = run.call_args
            self.assertEqual(args[0], [str(executable), "--quota-core"])
            self.assertFalse(kwargs["shell"])
            request = json.loads(kwargs["input"])
            self.assertEqual(request["op"], "merge_windows")
            self.assertEqual(request["items"][0]["current"]["observed_at_ms"], 900)
            self.assertEqual(kwargs["timeout"], quota.QUOTA_CORE_TIMEOUT_SEC)

    def test_quota_core_real_subprocess_pipe(self):
        executable = Path(__file__).resolve().parents[1] / "src-tauri" / "target" / "debug" / "claude-local.exe"
        if not executable.is_file():
            self.skipTest("Rust debug executable is not available")
        now = int(datetime.now(timezone.utc).timestamp())
        with patch.object(quota, "_quota_core_executable", return_value=executable):
            states = quota.merge_window_states(
                [
                    (90, now + 600, "local_estimate", 1000),
                    (90, now + 600, "local_estimate", 1000),
                    (20, now + 900, "server_anchor", 1500),
                ],
                [
                    (80, now + 600, "server_anchor", 1000),
                    (80, now + 600, "server_anchor", 2000),
                    (35, now + 1200, "server_anchor", 2500),
                ],
                now,
            )
        self.assertEqual(states[0], (90, now + 600, "local_estimate", 1000))
        self.assertEqual(states[1], (80, now + 600, "server_anchor", 2000))
        self.assertEqual(states[2], (35, now + 1200, "server_anchor", 2500))

    def test_reset_inference_matches_between_real_core_and_legacy_python(self):
        executable = Path(__file__).resolve().parents[1] / "src-tauri" / "target" / "debug" / "claude-local.exe"
        if not executable.is_file():
            self.skipTest("Rust debug executable is not available")
        now_sec = 100
        current = [
            (100, 90, "server_anchor", 80_000),
            (40, 90, "local_estimate", 80_000),
            (0, 90, "reset_inferred", 80_000),
        ]
        candidates = [
            (None, None, "unknown", None),
            (None, None, "unknown", None),
            (100, 90, "server_anchor", 80_000),
        ]
        with patch.object(quota, "_quota_core_executable", return_value=executable):
            rust = quota.merge_window_states(current, candidates, now_sec)
        with tempfile.TemporaryDirectory() as temp:
            missing_core = Path(temp) / "missing-claude-local.exe"
            with patch.object(quota, "_quota_core_executable", return_value=missing_core):
                legacy = quota.merge_window_states(current, candidates, now_sec)
        self.assertEqual(rust, legacy)
        self.assertEqual(rust[0], (0, 90, "reset_inferred", 80_000))
        self.assertEqual(rust[1], (None, None, "unknown", 80_000))
        self.assertEqual(rust[2], (0, 90, "reset_inferred", 80_000))

    def test_reset_inference_requires_pre_reset_server_observation_and_is_idempotent(self):
        for state, expected in [
            ((100, 90, "server_anchor", 80_000), (0, 90, "reset_inferred", 80_000)),
            ((100, 90, "server_anchor", None), (None, None, "unknown", None)),
            ((100, 90, "server_anchor", 90_000), (None, None, "unknown", 90_000)),
            ((40, 90, "local_estimate", 80_000), (None, None, "unknown", 80_000)),
            ((None, None, "unknown", 80_000), (None, None, "unknown", 80_000)),
        ]:
            self.assertEqual(quota._normalize_window_state(state, 100), expected)
        inferred = (0, 90, "reset_inferred", 80_000)
        self.assertEqual(quota._normalize_window_state(inferred, 200), inferred)

    def test_expired_raw_anchor_recovers_old_unknown_but_rejects_uuid_conflict(self):
        now_sec = 2_000_000_000
        observed = (now_sec - 20) * 1000
        reset = now_sec - 10
        entry = {
            "account_uuid": "u1",
            "quota_5h_source": "unknown",
            "quota_5h_used": None,
            "quota_5h_reset_at": None,
            "server_anchor": {
                "accountUuid": "u1",
                "fetchedAtMs": observed,
                "utilization": {
                    "five_hour": {"utilization": 100, "resets_at": reset, "fetchedAtMs": observed},
                },
            },
        }
        self.assertEqual(
            quota.entry_window_state(entry, "5h", "five_hour", now_sec),
            (0, reset, "reset_inferred", observed),
        )
        entry["server_anchor"]["accountUuid"] = "u2"
        self.assertEqual(
            quota.entry_window_state(entry, "5h", "five_hour", now_sec),
            (None, None, "unknown", observed),
        )

    def test_old_inferred_state_does_not_replace_new_valid_local_or_server_window(self):
        inferred = (0, 90, "reset_inferred", 80_000)
        for current in [
            (15, 140, "local_estimate", 85_000),
            (20, 150, "server_anchor", 85_000),
        ]:
            self.assertEqual(
                quota._legacy_merge_window_state(current, inferred, 100), current
            )

    def test_writer_persists_recovery_with_original_anchor_and_summary_version(self):
        now = 2_000_000_000
        observed = (now - 20) * 1000
        reset = now - 10
        anchor = {"accountUuid": "fixture", "fetchedAtMs": observed,
                  "utilization": {"five_hour": {"utilization": 100, "resets_at": reset,
                                                 "fetchedAtMs": observed}}}
        with tempfile.TemporaryDirectory() as temp:
            item = {"role": "saved", "email": "reset@example.invalid", "account_uuid": "fixture",
                    "used_5h": None, "reset_5h_ts": None, "quota_5h_source": "unknown",
                    "server_anchor": anchor}
            for _ in range(2):
                quota.save_ledger_and_sync_sqlite(temp, str(Path(temp) / "missing-vault"), [item],
                                                datetime.fromtimestamp(now, timezone.utc))
            stored = quota.load_ledger(temp)["accounts"]["reset@example.invalid"]
            self.assertEqual(stored["quota_5h_source"], "reset_inferred")
            self.assertEqual(stored["quota_5h_used"], 0)
            self.assertEqual(stored["quota_5h_reset_at"], reset)
            self.assertEqual(stored["quota_5h_observed_at_ms"], observed)
            self.assertEqual(stored["server_anchor"], anchor)
            self.assertEqual(quota.entry_window_state(stored, "5h", "five_hour", now),
                             (0, reset, "reset_inferred", observed))
        self.assertEqual(quota.CURRENT_QUOTA_VERSION, 7)

    def test_quota_core_failure_aborts_ledger_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / "claude-local.exe"
            executable.write_bytes(b"synthetic executable marker")
            item = {"role": "current", "email": "failure@example.invalid", "used_5h": 20,
                    "reset_5h_ts": 10000, "quota_5h_source": "server_anchor",
                    "quota_5h_observed_at_ms": 1000}
            for failure, mode in ((subprocess.TimeoutExpired("core", 2), "raise"),
                                  (subprocess.CompletedProcess([], 2, b"", b""), "return"),
                                  (subprocess.CompletedProcess([], 0, b"not json", b""), "return")):
                with self.subTest(failure=type(failure).__name__), \
                        patch.object(quota, "_quota_core_executable", return_value=executable), \
                        patch.object(quota.subprocess, "run", **({"side_effect": failure} if mode == "raise" else {"return_value": failure})):
                    quota.save_ledger_and_sync_sqlite(temp, str(root / "missing-vault"), [item],
                                                      datetime.fromtimestamp(1, timezone.utc))
                self.assertFalse((root / "quota_ledger.json").exists())

    def test_writer_sends_each_window_observation_independently(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / "claude-local.exe"
            executable.write_bytes(b"synthetic executable marker")
            now = int(datetime.now(timezone.utc).timestamp())
            request_seen = {}

            def run_core(args, **kwargs):
                request = json.loads(kwargs["input"])
                request_seen.update(request)
                items = [entry["candidate"] for entry in request["items"]]
                return subprocess.CompletedProcess(args, 0,
                    json.dumps({"schema": 1, "items": items}).encode(), b"")

            item = {"role": "current", "email": "windows@example.invalid", "account_uuid": "fixture",
                    "used_5h": 21, "reset_5h_ts": now + 300,
                    "quota_5h_source": "server_anchor", "quota_5h_observed_at_ms": 1111,
                    "used_7d": 42, "reset_7d_ts": now + 800,
                    "quota_7d_source": "local_estimate", "quota_7d_observed_at_ms": 2222}
            with patch.object(quota, "_quota_core_executable", return_value=executable), \
                    patch.object(quota.subprocess, "run", side_effect=run_core):
                quota.save_ledger_and_sync_sqlite(temp, str(root / "missing-vault"), [item],
                                                  datetime.fromtimestamp(now, timezone.utc))
            self.assertEqual(len(request_seen["items"]), 2)
            self.assertEqual([window["candidate"]["observed_at_ms"] for window in request_seen["items"]],
                             [1111, 2222])
            saved = quota.load_ledger(temp)["accounts"]["windows@example.invalid"]
            self.assertEqual(saved["quota_5h_observed_at_ms"], 1111)
            self.assertEqual(saved["quota_7d_observed_at_ms"], 2222)
            self.assertEqual(saved["quota_5h_source"], "server_anchor")
            self.assertEqual(saved["quota_7d_source"], "local_estimate")

    def test_saved_after_exhaustion_keeps_observed_quota(self):
        now = datetime.fromtimestamp(100, timezone.utc)
        info = {"email": "a@example.invalid", "account_uuid": "a", "used_5h": 10,
                "rem_7d": 80, "reset_5h_ts": 1000, "has_quota_data": True,
                "server_anchor": {"accountUuid": "a", "fetchedAtMs": 1000}}
        entry = {"quota_5h_used": 100, "quota_5h_reset_at": 1000, "updated_at_sec": 2,
                 "server_anchor": {"accountUuid": "a", "fetchedAtMs": 2000}}
        quota.apply_ledger_fallback_to_account(info, {"a@example.invalid": entry}, 90000, now)
        self.assertEqual(info["used_5h"], 100)

    def test_old_estimate_recomputed_after_anchor_cannot_lower_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{"role": "current",
                "email": "fixture@example.invalid", "used_5h": 100, "reset_5h_ts": 1000,
                "server_anchor": {"accountUuid": "a", "fetchedAtMs": 2000}}],
                datetime.fromtimestamp(2, timezone.utc))
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{"role": "saved",
                "email": "fixture@example.invalid", "used_5h": 10, "reset_5h_ts": 1000}],
                datetime.fromtimestamp(3, timezone.utc))
            account, summary = self.read_account_and_summary(root)
            self.assertEqual(account["quota_5h_used"], 100)
            self.assertEqual(summary["quota_5h_used"], 100)

    def test_new_observation_and_new_window_can_lower_utilization(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            for fetched, used, reset in [(1000, 100, 100), (2000, 20, 100), (3000, 5, 200)]:
                quota.save_ledger_and_sync_sqlite(temp, str(vault), [{"role": "current",
                    "email": "fixture@example.invalid", "used_5h": used, "reset_5h_ts": reset,
                    "server_anchor": {"accountUuid": "a", "fetchedAtMs": fetched}}],
                    datetime.fromtimestamp(fetched / 1000, timezone.utc))
            account, _ = self.read_account_and_summary(root)
            self.assertEqual(account["quota_5h_used"], 5)
            self.assertEqual(account["quota_5h_reset_at"], 200)

    def test_return_to_account_preserves_same_window_consumption(self):
        info = {"email": "a@example.invalid", "account_uuid": "a", "used_5h": 10,
                "rem_7d": 80, "reset_5h_ts": 1000, "has_quota_data": True,
                "server_anchor": {"accountUuid": "a", "fetchedAtMs": 1000}}
        entry = {"quota_5h_used": 90, "quota_5h_reset_at": 1000, "updated_at_sec": 2,
                 "server_anchor": {"accountUuid": "a", "fetchedAtMs": 1000}}
        quota.apply_ledger_fallback_to_account(info, {"a@example.invalid": entry}, 90000,
                                               datetime.fromtimestamp(100, timezone.utc))
        self.assertEqual(info["used_5h"], 90)

    def test_same_email_different_account_or_organization_is_not_merged(self):
        for uuid, org in [("b", "org-a"), ("a", "org-b")]:
            info = {"email": "a@example.invalid", "account_uuid": "a", "organization_uuid": "org-a",
                    "used_5h": 10, "has_quota_data": True, "rem_7d": 100}
            entry = {"account_uuid": uuid, "organization_uuid": org, "quota_5h_used": 100,
                     "updated_at_sec": 200, "server_anchor": {"accountUuid": uuid, "fetchedAtMs": 2000}}
            quota.apply_ledger_fallback_to_account(info, {"a@example.invalid": entry}, 0,
                                                   datetime.fromtimestamp(100, timezone.utc))
            self.assertEqual(info["used_5h"], 10)

    def test_a_b_a_writer_retains_first_visit_consumption_and_other_account(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for uuid, used, fetched in [("a", 90, 1000), ("b", 20, 2000), ("a", 10, 1000)]:
                quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [{
                    "role": "current", "email": f"{uuid}@example.invalid", "account_uuid": uuid,
                    "used_5h": used, "reset_5h_ts": 1000,
                    "server_anchor": {"accountUuid": uuid, "fetchedAtMs": fetched}}],
                    datetime.fromtimestamp(3, timezone.utc))
            ledger = quota.load_ledger(temp)["accounts"]
            self.assertEqual(ledger["a@example.invalid"]["quota_5h_used"], 90)
            self.assertEqual(ledger["b@example.invalid"]["quota_5h_used"], 20)

    def test_unknown_window_is_not_filled_as_zero_by_statusline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            home.mkdir()
            app.mkdir(parents=True)
            (home / ".claude.json").write_text(json.dumps({"oauthAccount": {
                "accountUuid": "a", "emailAddress": "a@example.invalid"}}), encoding="utf-8")
            payload = {"rate_limits": {"five_hour": {"used_percentage": 100,
                "resets_at": int(datetime.now(timezone.utc).timestamp()) + 1000}}}
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(io.StringIO()):
                quota.handle_statusline()
            entry = quota.load_ledger(str(app))["accounts"]["a@example.invalid"]
            self.assertIsNone(entry["quota_7d_used"])
            self.assertEqual(entry["quota_5h_used"], 100)
            self.assertEqual(entry["quota_source"], "unknown")

    def test_same_email_organizations_keep_separate_ledger_observations(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for org, used in [("org-a", 100), ("org-b", 20)]:
                account = {"accountUuid": "a", "emailAddress": "same@example.invalid", "organizationUuid": org}
                quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [{
                    "role": "current", "email": "same@example.invalid", "account_uuid": "a",
                    "organization_uuid": org, "quota_identity": quota.quota_identity(account),
                    "used_5h": used, "reset_5h_ts": 1000,
                    "server_anchor": {"accountUuid": "a", "fetchedAtMs": 1000}}],
                    datetime.fromtimestamp(2, timezone.utc))
            accounts = quota.load_ledger(temp)["accounts"]
            self.assertEqual(len(accounts), 2)
            for org, expected in [("org-a", 100), ("org-b", 20)]:
                account = {"accountUuid": "a", "emailAddress": "same@example.invalid", "organizationUuid": org}
                info = {"email": "same@example.invalid", "account_uuid": "a", "organization_uuid": org,
                        "quota_identity": quota.quota_identity(account), "rem_7d": 100}
                quota.apply_ledger_fallback_to_account(info, accounts, 90000, datetime.fromtimestamp(100, timezone.utc))
                self.assertEqual(info["used_5h"], expected)

    def test_per_window_source_expiration_does_not_poison_healthy_window(self):
        now = datetime.fromtimestamp(2000, timezone.utc)
        entry = {
            "email": "healthy@example.invalid",
            "account_uuid": "u1",
            "quota_5h_used": 100,
            "quota_5h_reset_at": 1500,
            "quota_5h_source": "server_anchor",
            "quota_5h_observed_at_ms": 1000_000,
            "quota_7d_used": 40,
            "quota_7d_reset_at": 3000,
            "quota_7d_source": "server_anchor",
            "quota_7d_observed_at_ms": 1000_000,
            "server_anchor": {
                "accountUuid": "u1",
                "fetchedAtMs": 1000_000,
                "utilization": {
                    "five_hour": {"utilization": 100, "resets_at": 1500, "fetchedAtMs": 1000_000},
                    "seven_day": {"utilization": 40, "resets_at": 3000, "fetchedAtMs": 1000_000},
                },
            },
        }
        info = {"email": "healthy@example.invalid", "account_uuid": "u1"}
        quota.apply_ledger_fallback_to_account(info, {"healthy@example.invalid": entry}, 0, now)
        self.assertEqual(info.get("quota_5h_source"), "reset_inferred")
        self.assertEqual(info.get("used_5h"), 0)
        self.assertEqual(info.get("reset_5h_ts"), 1500)
        self.assertEqual(info.get("quota_7d_source"), "server_anchor")
        self.assertEqual(info.get("used_7d"), 40)
        self.assertEqual(info.get("reset_7d_ts"), 3000)
        self.assertEqual(info.get("quota_source"), "unknown")

    def test_expired_window_does_not_manufacture_zero_usage_or_roll_reset(self):
        now = datetime.fromtimestamp(2000, timezone.utc)
        entry = {
            "email": "exp@example.invalid",
            "account_uuid": "u1",
            "quota_7d_used": 90,
            "quota_7d_reset_at": 1500,
            "quota_7d_source": "server_anchor",
            "quota_7d_observed_at_ms": 1000_000,
            "server_anchor": {"accountUuid": "u1", "fetchedAtMs": 1000_000},
        }
        info = {"email": "exp@example.invalid", "account_uuid": "u1"}
        quota.apply_ledger_fallback_to_account(info, {"exp@example.invalid": entry}, 0, now)
        self.assertEqual(info.get("quota_7d_source"), "reset_inferred")
        self.assertEqual(info.get("used_7d"), 0)
        self.assertEqual(info.get("reset_7d_ts"), 1500)

    def test_unmatched_legacy_ledger_does_not_poison_info_source(self):
        now = datetime.fromtimestamp(100, timezone.utc)
        info = {"email": "a@example.invalid", "account_uuid": "mine", "quota_source": "server_anchor", "used_5h": 50}
        entry = {"email": "a@example.invalid", "account_uuid": "other"}
        quota.apply_ledger_fallback_to_account(info, {"a@example.invalid": entry}, 0, now)
        self.assertEqual(info["quota_source"], "server_anchor")
        self.assertEqual(info["used_5h"], 50)

    def test_per_window_provenance_and_observation_times_persist_without_cross_window_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_5h": 20,
                "reset_5h_ts": 10000, "used_7d": 30, "reset_7d_ts": 20000,
                "quota_source": "unknown", "quota_5h_source": "server_anchor",
                "quota_7d_source": "local_estimate", "quota_5h_observed_at_ms": None,
                "quota_7d_observed_at_ms": 2000,
            }], datetime.fromtimestamp(3, timezone.utc))
            account, summary = self.read_account_and_summary(root)
            self.assertEqual(account["quota_5h_source"], "server_anchor")
            self.assertEqual(account["quota_7d_source"], "local_estimate")
            self.assertIsNone(account["quota_5h_observed_at_ms"])
            self.assertEqual(account["quota_7d_observed_at_ms"], 2000)
            self.assertEqual(summary["quota_5h_source"], "server_anchor")
            self.assertEqual(summary["quota_7d_source"], "local_estimate")
            self.assertNotIn("quota_5h_observed_at_ms", summary)
            self.assertEqual(summary["quota_7d_observed_at_ms"], 2000)

    def create_summary_database(self, root):
        vault = root / "identity-vault"
        vault.mkdir()
        with contextlib.closing(sqlite3.connect(vault / "identities.sqlite")) as connection, connection:
            connection.execute("CREATE TABLE identities(id TEXT, name TEXT, empty INTEGER)")
            connection.execute("INSERT INTO identities VALUES('fixture', 'Fixture', 0)")
            connection.execute("CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT)")
            connection.execute("INSERT INTO identity_summaries VALUES('fixture', ?)",
                               (json.dumps({"email": "fixture@example.invalid"}),))
        return vault

    def read_account_and_summary(self, root):
        account = json.loads((root / "quota_ledger.json").read_text(encoding="utf-8"))["accounts"]["fixture@example.invalid"]
        with contextlib.closing(sqlite3.connect(root / "identity-vault/identities.sqlite")) as connection:
            summary = json.loads(connection.execute("SELECT summary FROM identity_summaries WHERE id='fixture'").fetchone()[0])
        return account, summary

    def test_missing_local_root_is_not_created_or_redirected(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "absent"
            quota.save_ledger_and_sync_sqlite(str(target), str(target / "identity-vault"), [], datetime.now(timezone.utc))
            self.assertFalse(target.exists())

    def test_updates_preserve_anchor_and_other_accounts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            now = datetime.now(timezone.utc)
            item = {"role": "current", "email": "A@example.invalid", "account_uuid": "fixture", "used_5h": 23,
                    "reset_5h_ts": int(now.timestamp()) + 3600,
                    "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 123}}
            quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [item], now)
            item.pop("server_anchor")
            item["used_5h"] = 24
            item["quota_5h_source"] = "local_estimate"
            item["quota_5h_observed_at_ms"] = 124
            quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [item], now)
            quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [{"role": "saved", "email": "b@example.invalid"}], now)
            ledger = json.loads((root / "quota_ledger.json").read_text(encoding="utf-8"))
            self.assertEqual(ledger["accounts"]["a@example.invalid"]["server_anchor"]["fetchedAtMs"], 123)
            self.assertEqual(ledger["accounts"]["a@example.invalid"]["quota_5h_used"], 24)
            self.assertIn("b@example.invalid", ledger["accounts"])

    def test_concurrent_writers_never_drop_an_account(self):
        with tempfile.TemporaryDirectory() as temp:
            def write(index):
                quota.save_ledger_and_sync_sqlite(temp, str(Path(temp) / "no-db"),
                    [{"role": "current", "email": f"fixture{index}@example.invalid", "used_5h": index}],
                    datetime.now(timezone.utc))
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(write, range(12)))
            data = json.loads((Path(temp) / "quota_ledger.json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["accounts"]), 12)

    def test_older_anchor_cannot_replace_newer_ledger_or_summary(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            now = datetime.now(timezone.utc)
            for fetched, used in [(200, 90), (100, 10)]:
                quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                    "role": "current", "email": "fixture@example.invalid", "used_5h": used,
                    "reset_5h_ts": int(now.timestamp()) + 3600,
                    "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": fetched,
                                      "utilization": {"five_hour": {"utilization": used,
                                                                      "resets_at": int(now.timestamp()) + 3600}}},
                }], now)
            account, summary = self.read_account_and_summary(root)
            self.assertEqual(account["server_anchor"]["fetchedAtMs"], 200)
            self.assertEqual(account["quota_5h_used"], 90)
            self.assertEqual(summary["quota_5h_used"], 90)

    def test_estimate_started_before_new_anchor_cannot_replace_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_5h": 90,
                "reset_5h_ts": 1000,
                "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 2000},
            }], datetime.fromtimestamp(2, timezone.utc))
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_5h": 10, "reset_5h_ts": 1000,
            }], datetime.fromtimestamp(1, timezone.utc))
            account, summary = self.read_account_and_summary(root)
            self.assertEqual(account["quota_5h_used"], 90)
            self.assertEqual(summary["quota_5h_used"], 90)

    def test_partial_anchor_merges_unobserved_window_under_writer_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.create_summary_database(root)
            now = datetime.fromtimestamp(3, timezone.utc)
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_7d": 90,
                "reset_7d_ts": 99999,
                "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 2000,
                                  "utilization": {"seven_day": {"utilization": 90, "resets_at": 99999}}},
            }], now)
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_5h": 20,
                "used_7d": 10, "reset_7d_ts": 88888,
                "server_anchor_observed_windows": ["five_hour"],
                "server_anchor_base_fetched_at_ms": 1000,
                "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 3000,
                                  "utilization": {"five_hour": {"utilization": 20},
                                                  "seven_day": {"utilization": 10, "resets_at": 88888}}},
            }], now)
            account, summary = self.read_account_and_summary(root)
            self.assertEqual(account["server_anchor"]["utilization"]["seven_day"]["utilization"], 90)
            self.assertEqual(account["quota_7d_used"], 90)
            self.assertEqual(account["quota_7d_reset_at"], 99999)
            self.assertEqual(summary["quota_7d_used"], 90)

    def test_partial_statusline_preserves_latest_same_account_window_and_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            home.mkdir()
            app.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())
            reset5, reset7 = now + 3600, now + 86400
            source = json.dumps({
                "oauthAccount": {"accountUuid": "fixture", "emailAddress": "fixture@example.invalid"},
                "cachedUsageUtilization": {"accountUuid": "fixture", "fetchedAtMs": 1,
                    "utilization": {"seven_day": {"utilization": 10, "resets_at": reset7}}},
            })
            (home / ".claude.json").write_text(source, encoding="utf-8")
            (app / "quota_ledger.json").write_text(json.dumps({"accounts": {"fixture@example.invalid": {
                "quota_7d_used": 90, "quota_7d_reset_at": reset7,
                "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 2,
                    "utilization": {"seven_day": {"utilization": 90, "resets_at": reset7}}},
            }}}), encoding="utf-8")
            payload = {"rate_limits": {"five_hour": {"used_percentage": 20, "resets_at": reset5}}}
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(io.StringIO()):
                quota.handle_statusline()
            account = json.loads((app / "quota_ledger.json").read_text(encoding="utf-8"))["accounts"]["fixture@example.invalid"]
            self.assertEqual(account["quota_7d_used"], 90)
            self.assertEqual(account["server_anchor"]["utilization"]["seven_day"]["utilization"], 90)
            self.assertEqual((home / ".claude.json").read_text(encoding="utf-8"), source)

    def test_active_since_isolates_shared_session_turns_across_account_switch(self):
        now = datetime.fromtimestamp(1_792_202_000, tz=timezone.utc)
        snap_ms = 1_792_200_000 * 1000
        active_since = datetime.fromtimestamp(1_792_201_000, tz=timezone.utc)
        cj = {
            "oauthAccount": {"accountUuid": "acct-b"},
            "cachedUsageUtilization": {
                "accountUuid": "acct-b",
                "fetchedAtMs": snap_ms,
                "utilization": {
                    "five_hour": {"utilization": 0, "resets_at": 1_792_210_000},
                    "seven_day": {"utilization": 10, "resets_at": 1_792_300_000},
                },
            },
        }
        # Turn at 1_792_200_500 belongs to Account A (before switch at 1_792_201_000)
        # Turn at 1_792_201_500 belongs to Account B (after switch at 1_792_201_000)
        slices = [
            (datetime.fromtimestamp(1_792_200_500, tz=timezone.utc), 16.0),
            (datetime.fromtimestamp(1_792_201_500, tz=timezone.utc), 3.2),
        ]
        res = quota.evaluate_quota(cj, slices, slices[-1][0], "Pro", now, active_since_dt=active_since)
        self.assertEqual(res["used_5h"], 10)

    def test_legacy_statusline_anchor_prefers_top_level_fetched_at_over_stale_nested_timestamps(self):
        anchor = {
            "accountUuid": "acct-a",
            "fetchedAtMs": 1_792_202_000_000,
            "utilization": {
                "five_hour": {"utilization": 36.0, "resets_at": 1_792_210_000, "fetchedAtMs": 1_792_200_000_000},
                "seven_day": {"utilization": 92.0, "resets_at": 1_792_300_000, "fetchedAtMs": 1_792_200_000_000},
            },
        }
        self.assertEqual(quota.window_fetched_at_ms(anchor, "five_hour"), 1_792_202_000_000)
        self.assertEqual(quota.window_fetched_at_ms(anchor, "seven_day"), 1_792_202_000_000)
        now = datetime.fromtimestamp(1_792_202_100, tz=timezone.utc)
        slices = [(datetime.fromtimestamp(1_792_201_500, tz=timezone.utc), 18.0)]
        cj = {"oauthAccount": {"accountUuid": "acct-a"}, "cachedUsageUtilization": anchor}
        res = quota.evaluate_quota(cj, slices, slices[-1][0], "Pro", now)
        self.assertEqual(res["used_5h"], 36)
        self.assertEqual(res["used_7d"], 92)

    def test_select_best_relay_candidate_consume_first_and_hysteresis(self):
        now_sec = 1_792_200_000
        # 1. Hysteresis: current has 75% (> 20%), saved has 80% (+5% < 10% threshold) -> stay
        rec_stay = quota.select_best_relay_candidate(
            [
                {
                    "role": "current",
                    "name": "Acct-A",
                    "auth_status": "valid",
                    "effective_rem": 75,
                    "rem_5h": 75,
                    "rem_7d": 80,
                    "reset_7d_ts": now_sec + 5 * 86400,
                },
                {
                    "role": "saved",
                    "id": "id-b",
                    "name": "Acct-B",
                    "auth_status": "valid",
                    "effective_rem": 80,
                    "rem_5h": 80,
                    "rem_7d": 80,
                    "reset_7d_ts": now_sec + 5 * 86400,
                },
            ],
            now_sec,
        )
        self.assertEqual(rec_stay["action"], "stay")
        self.assertEqual(rec_stay["target"], "Acct-A")

        # 2. Consume-first: among saved candidates within 15% of max_saved_eff and rem_5h >= 50,
        # pick the one whose 7d window resets sooner even if its effective_rem is slightly lower.
        rec_cf = quota.select_best_relay_candidate(
            [
                {
                    "role": "current",
                    "name": "Acct-A",
                    "auth_status": "valid",
                    "effective_rem": 0,
                    "rem_5h": 0,
                    "rem_7d": 50,
                    "reset_5h_ts": now_sec + 7200,
                    "reset_7d_ts": now_sec + 4 * 86400,
                },
                {
                    "role": "saved",
                    "id": "id-b",
                    "name": "Acct-B-LaterReset",
                    "auth_status": "valid",
                    "effective_rem": 90,
                    "rem_5h": 100,
                    "rem_7d": 90,
                    "reset_7d_ts": now_sec + 6 * 86400,
                },
                {
                    "role": "saved",
                    "id": "id-c",
                    "name": "Acct-C-SoonerReset",
                    "auth_status": "valid",
                    "effective_rem": 82,
                    "rem_5h": 95,
                    "rem_7d": 82,
                    "reset_7d_ts": now_sec + 1 * 86400,
                },
            ],
            now_sec,
        )
        self.assertEqual(rec_cf["action"], "switch")
        self.assertEqual(rec_cf["target"], "Acct-C-SoonerReset")
        self.assertEqual(rec_cf["reason"], "consume_first_7d")

        # 3. All exhausted -> fastest bottleneck reset account identified
        rec_wait = quota.select_best_relay_candidate(
            [
                {
                    "role": "current",
                    "name": "Acct-A",
                    "auth_status": "valid",
                    "effective_rem": 0,
                    "rem_5h": 0,
                    "rem_7d": 40,
                    "reset_5h_ts": now_sec + 7200,
                    "reset_7d_ts": now_sec + 86400,
                },
                {
                    "role": "saved",
                    "name": "Acct-B",
                    "auth_status": "valid",
                    "effective_rem": 0,
                    "rem_5h": 0,
                    "rem_7d": 50,
                    "reset_5h_ts": now_sec + 1800,
                    "reset_7d_ts": now_sec + 86400,
                },
            ],
            now_sec,
        )
        self.assertEqual(rec_wait["action"], "wait")
        self.assertEqual(rec_wait["target"], "Acct-B")
        self.assertEqual(rec_wait["fastest_reset_eta_sec"], 1800)

    def test_statusline_emits_relay_alert_when_low_or_exhausted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            home.mkdir()
            app.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())
            (home / ".claude.json").write_text(
                json.dumps(
                    {
                        "oauthAccount": {
                            "accountUuid": "uuid-a",
                            "emailAddress": "a@example.invalid",
                            "displayName": "Acct-A",
                        }
                    }
                ),
                encoding="utf-8",
            )
            (app / "quota_ledger.json").write_text(
                json.dumps(
                    {
                        "accounts": {
                            "b@example.invalid": {
                                "display_name": "Acct-B",
                                "account_uuid": "uuid-b",
                                "quota_identity": quota.quota_identity({"accountUuid": "uuid-b", "emailAddress": "b@example.invalid"}),
                                "quota_source": "server_anchor",
                                "quota_5h_source": "server_anchor",
                                "quota_7d_source": "server_anchor",
                                "quota_5h_observed_at_ms": now * 1000,
                                "quota_7d_observed_at_ms": now * 1000,
                                "auth_status": "valid",
                                "quota_5h_used": 10,
                                "quota_5h_reset_at": now + 3600,
                                "quota_7d_used": 20,
                                "quota_7d_reset_at": now + 86400,
                                "server_anchor": {"accountUuid": "uuid-b", "fetchedAtMs": now * 1000},
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            payload = {
                "model": {"display_name": "Opus 4.7"},
                "context_window": {"used_percentage": 33},
                "rate_limits": {
                    "five_hour": {"used_percentage": 100, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 30, "resets_at": now + 86400},
                },
            }
            buf = io.StringIO()
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()
            out = buf.getvalue().strip()
            self.assertTrue(out.startswith("Opus 4.7 (Ctx 33%) │ Acct-B:80%"))
            self.assertNotIn("Acct-A", out)
            self.assertNotIn("5h:", out)
            self.assertNotIn("7d:", out)
            self.assertIn("🚨 额度耗尽→切[Acct-B:80%]后 /resume", out)

    def test_speed_multipliers_and_mythos_preview_pricing(self):
        # claude-mythos-preview ($25/$125) vs claude-mythos-5-2 ($8/$40)
        prev_cost = quota.estimate_turn_cost_usd(
            "claude-mythos-preview", {"input_tokens": 1_000_000, "output_tokens": 1_000_000}
        )
        m52_cost = quota.estimate_turn_cost_usd(
            "claude-mythos-5-2", {"input_tokens": 1_000_000, "output_tokens": 1_000_000}
        )
        self.assertAlmostEqual(prev_cost, 150.0, places=4)
        self.assertAlmostEqual(m52_cost, 48.0, places=4)

        # usage.speed multipliers: fast -> 2x on fable-5-2/opus-4-8/opus-5*, 6x on opus-4-6/opus-4-7; ultrafast -> 4x on fable-5-2
        fable_std = quota.estimate_turn_cost_usd("claude-fable-5-2", {"input_tokens": 1_000_000})
        fable_fast = quota.estimate_turn_cost_usd("claude-fable-5-2", {"input_tokens": 1_000_000, "speed": "fast"})
        fable_ultra = quota.estimate_turn_cost_usd("claude-fable-5-2", {"input_tokens": 1_000_000, "speed": "ultrafast"})
        self.assertAlmostEqual(fable_std, 8.0, places=4)
        self.assertAlmostEqual(fable_fast, 16.0, places=4)
        self.assertAlmostEqual(fable_ultra, 32.0, places=4)

        opus47_std = quota.estimate_turn_cost_usd("claude-opus-4-7", {"input_tokens": 1_000_000})
        opus47_fast = quota.estimate_turn_cost_usd("claude-opus-4-7", {"input_tokens": 1_000_000, "speed": "fast"})
        opus55_fast = quota.estimate_turn_cost_usd("claude-opus-5-5", {"input_tokens": 1_000_000, "speed": "fast"})
        self.assertAlmostEqual(opus47_std, 5.0, places=4)
        self.assertAlmostEqual(opus47_fast, 30.0, places=4)
        self.assertAlmostEqual(opus55_fast, 8.0, places=4)

    def test_streaming_jsonl_skips_oversized_single_line_and_reads_valid_turns(self):
        with tempfile.TemporaryDirectory() as temp:
            proj_dir = Path(temp) / "projects" / "demo"
            proj_dir.mkdir(parents=True)
            jsonl = proj_dir / "heavy-session.jsonl"
            turn1 = json.dumps({
                "type": "assistant",
                "timestamp": "2026-11-10T11:30:00Z",
                "message": {
                    "id": "msg-before",
                    "model": "claude-fable-5-2",
                    "usage": {"input_tokens": 100_000, "output_tokens": 50_000, "speed": "fast"},
                },
            })
            oversized = '{"type":"user","timestamp":"2026-11-10T11:35:00Z","blob":"' + ("x" * (2 * 1024 * 1024 + 4096)) + '"}'
            turn2 = json.dumps({
                "type": "assistant",
                "timestamp": "2026-11-10T11:45:00Z",
                "message": {
                    "id": "msg-after",
                    "model": "claude-fable-5-2",
                    "usage": {"input_tokens": 200_000, "output_tokens": 25_000},
                },
            })
            jsonl.write_text(f"{turn1}\n{oversized}\n{turn2}\n", encoding="utf-8")
            slices, latest_dt = quota.collect_session_slices_from_dir(str(Path(temp) / "projects"))
            self.assertEqual(len(slices), 2)
            self.assertIsNotNone(latest_dt)
            # turn1 fast: 2 * (0.1*8 + 0.05*40) = 5.6; turn2 std: 0.2*8 + 0.025*40 = 2.6 -> total 8.2
            self.assertAlmostEqual(sum(cost for _dt, cost in slices), 8.2, places=4)

    def test_ledger_sync_preserves_eight_web_metadata_keys_and_ultra_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / "app"
            vault = root / "vault"
            app.mkdir()
            vault.mkdir()
            now = 2_000_000_000
            ident_id = "0192e2b3aaaa70008000000000000001"
            q_ident = quota.quota_identity({"accountUuid": "uuid-ultra", "emailAddress": "ultra@example.invalid"})

            db_path = vault / "identities.sqlite"
            conn = sqlite3.connect(str(db_path))
            conn.executescript(
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'UltraAcct', 0)", (ident_id,))
            seeded_summary = {
                "display_name": "UltraAcct",
                "email": "ultra@example.invalid",
                "plan": "Ultra",
                "quota_identity": q_ident,
                "proxy": "socks5://proxy.invalid:1080",
                "subscription_expires_at": now + 600_000,
                "subscription_renews_at": now + 500_000,
                "manual_resets_remaining": 3,
                "manual_resets_valid_until": now + 40_000,
                "metadata_observed_at_ms": now * 1000,
                "billing_observed_at_ms": now * 1000,
                "manual_resets_observed_at_ms": now * 1000,
            }
            conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (ident_id, json.dumps(seeded_summary)))
            conn.commit()
            conn.close()

            anchor = {
                "accountUuid": "uuid-ultra",
                "fetchedAtMs": now * 1000,
                "no_five_hour": True,
                "scoped_fable_7d": {"pct": 37, "resetsAt": now + 200_000, "fetchedAtMs": now * 1000},
                "utilization": {
                    "seven_day": {"utilization": 19, "resets_at": now + 300_000, "fetchedAtMs": now * 1000},
                },
            }
            acct = quota.format_account(
                cj={
                    "oauthAccount": {"accountUuid": "uuid-ultra", "emailAddress": "ultra@example.invalid", "displayName": "UltraAcct"},
                    "cachedUsageUtilization": anchor,
                },
                cred={"claudeAiOauth": {"subscriptionType": "max", "expiresAt": (now + 3600) * 1000, "refreshTokenExpiresAt": (now + 86400) * 1000}},
                slices=[],
                latest_dt=None,
                now_utc=datetime.fromtimestamp(now, timezone.utc),
            )
            acct["role"] = "saved"
            acct["id"] = ident_id
            self.assertTrue(acct["quota_no_5h_limit"])
            self.assertEqual(acct["quota_7d_fable_used"], 37)
            self.assertEqual(acct["refresh_token_expires_at"], now + 86400)

            quota.save_ledger_and_sync_sqlite(str(app), str(vault), [acct], datetime.fromtimestamp(now, timezone.utc))
            conn = sqlite3.connect(str(db_path))
            synced = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (ident_id,)).fetchone()[0])
            conn.close()

            for web_key in (
                "proxy",
                "subscription_expires_at",
                "subscription_renews_at",
                "manual_resets_remaining",
                "manual_resets_valid_until",
                "metadata_observed_at_ms",
                "billing_observed_at_ms",
                "manual_resets_observed_at_ms",
            ):
                self.assertEqual(synced.get(web_key), seeded_summary[web_key], f"missing/altered {web_key}")
            self.assertEqual(synced["plan"], "Ultra")
            self.assertTrue(synced["quota_no_5h_limit"])
            self.assertEqual(synced["quota_7d_used"], 19)
            self.assertEqual(synced["quota_7d_fable_used"], 37)
            self.assertEqual(synced["quota_7d_fable_reset_at"], now + 200_000)
            self.assertEqual(synced["refresh_token_expires_at"], now + 86400)

    def test_statusline_harvests_managed_slot_and_honors_bar_flags(self):
        slot_id = "0123456789abcdef0123456789abcdef"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            slot_dir = app / "cli-slots" / slot_id
            home.mkdir()
            slot_dir.mkdir(parents=True)
            (home / ".claude.json").write_text(
                json.dumps({"oauthAccount": {"accountUuid": "uuid-main", "emailAddress": "main@example.invalid", "displayName": "MainAcct"}}),
                encoding="utf-8",
            )
            slot_cj_raw = json.dumps({
                "oauthAccount": {
                    "accountUuid": "uuid-slot",
                    "emailAddress": "slot@example.invalid",
                    "displayName": "SlotTwo",
                }
            })
            (slot_dir / ".claude.json").write_text(slot_cj_raw, encoding="utf-8")
            now = int(datetime.now(timezone.utc).timestamp())
            payload = {
                "model": {"display_name": "Opus 4.7"},
                "effort": {"level": "high"},
                "context_window": {"used_percentage": 42},
                "rate_limits": {
                    "five_hour": {"used_percentage": 25, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 40, "resets_at": now + 86400},
                },
            }

            env = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(slot_dir)}
            buf = io.StringIO()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()
            out = buf.getvalue().strip()
            self.assertEqual(out, "⚡ Slot·SlotTwo │ Opus 4.7 (Ctx 42%) │ 5h 25% · 7d 40%")

            accounts = quota.load_ledger(str(app))["accounts"]
            self.assertIn("slot@example.invalid", accounts)
            self.assertNotIn("main@example.invalid", accounts)
            self.assertEqual(accounts["slot@example.invalid"]["quota_5h_used"], 25)
            self.assertEqual(accounts["slot@example.invalid"]["quota_7d_used"], 40)
            self.assertEqual((slot_dir / ".claude.json").read_text(encoding="utf-8"), slot_cj_raw)

            buf_nobar = io.StringIO()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline", "--no-quota-bar"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf_nobar):
                quota.handle_statusline()
            nobar_out = buf_nobar.getvalue().strip()
            self.assertEqual(nobar_out, "⚡ Slot·SlotTwo │ Opus 4.7 · High (Ctx 42%)")
            self.assertNotIn("5h ", nobar_out)

            buf_quiet = io.StringIO()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline", "--quiet"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf_quiet):
                quota.handle_statusline()
            self.assertEqual(buf_quiet.getvalue(), "")

    def test_managed_slot_preserves_manual_resets_grants_in_sqlite(self):
        slot_id = "fedcba9876543210fedcba9876543210"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            slot_dir = app / "cli-slots" / slot_id
            home.mkdir()
            vault.mkdir(parents=True)
            slot_dir.mkdir(parents=True)

            now = int(datetime.now(timezone.utc).timestamp())
            acc_obj = {"accountUuid": "uuid-reset", "emailAddress": "reset-slot@example.invalid", "displayName": "ResetSlot"}
            q_ident = quota.quota_identity(acc_obj)
            (slot_dir / ".claude.json").write_text(json.dumps({"oauthAccount": acc_obj}), encoding="utf-8")

            grants = [
                {"resets_left": 2, "ends_at": now + 172800},
                {"resets_left": 1, "ends_at": None},
            ]
            db_path = vault / "identities.sqlite"
            conn = sqlite3.connect(str(db_path))
            conn.executescript(
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'Card-Reset', 0)", (slot_id,))
            seeded = {
                "display_name": "ResetSlot",
                "email": "reset-slot@example.invalid",
                "plan": "Pro",
                "quota_identity": q_ident,
                "proxy": "http://127.0.0.1:7899",
                "manual_resets_remaining": 3,
                "manual_resets_valid_until": now + 3600,
                "manual_resets_grant_ends_at": now + 172800,
                "manual_resets_grants": grants,
                "manual_resets_observed_at_ms": now * 1000,
            }
            conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (slot_id, json.dumps(seeded)))
            conn.commit()
            conn.close()

            payload = {
                "model": {"display_name": "Sonnet 5.5"},
                "rate_limits": {
                    "five_hour": {"used_percentage": 61, "resets_at": now + 7200},
                    "seven_day": {"used_percentage": 88, "resets_at": now + 259200},
                },
            }
            env = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(slot_dir)}
            buf = io.StringIO()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()
            self.assertEqual(buf.getvalue().strip(), "⚡ Slot·Card-Reset │ Sonnet 5.5 │ 5h 61% · 7d 88%")

            conn = sqlite3.connect(str(db_path))
            synced = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (slot_id,)).fetchone()[0])
            conn.close()
            self.assertEqual(synced["quota_5h_used"], 61)
            self.assertEqual(synced["quota_7d_used"], 88)
            self.assertEqual(synced["manual_resets_remaining"], 3)
            self.assertEqual(synced["manual_resets_valid_until"], now + 3600)
            self.assertEqual(synced["manual_resets_grant_ends_at"], now + 172800)
            self.assertEqual(synced["manual_resets_grants"], grants)
            self.assertEqual(synced["manual_resets_observed_at_ms"], now * 1000)

    def test_external_non_slot_relay_returns_early_without_writing_ledger(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            ext_dir = root / "external-relay"
            bad_slot_dir = app / "cli-slots" / "NOT-A-HEX-ID"
            home.mkdir()
            app.mkdir(parents=True)
            ext_dir.mkdir()
            bad_slot_dir.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())
            payload = {
                "model": {"display_name": "Opus 4.7"},
                "context_window": {"used_percentage": 15},
                "cost": {"total_cost_usd": 1.25},
                "rate_limits": {"five_hour": {"used_percentage": 50, "resets_at": now + 3600}},
            }
            for target_dir in (ext_dir, bad_slot_dir):
                with self.subTest(target_dir=target_dir.name):
                    buf = io.StringIO()
                    env = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(target_dir)}
                    with patch.dict(os.environ, env, clear=True), \
                            patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                            patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                            contextlib.redirect_stdout(buf):
                        quota.handle_statusline()
                    self.assertEqual(buf.getvalue().strip(), "🔗 Relay │ Opus 4.7 │ Ctx 15% │ $1.25")
                    self.assertFalse((app / "quota_ledger.json").exists())

    def test_managed_slot_rejects_symlink_or_reparse_point(self):
        slot_id = "0123456789abcdef0123456789abcdef"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            slots_root = app / "cli-slots"
            slot_dir = slots_root / slot_id
            home.mkdir()
            slot_dir.mkdir(parents=True)
            (home / ".claude.json").write_text(
                json.dumps({"oauthAccount": {"accountUuid": "uuid-main", "emailAddress": "main@example.invalid"}}),
                encoding="utf-8",
            )
            secret_target = root / "outside-claude.json"
            secret_target.write_text(
                json.dumps({"oauthAccount": {"accountUuid": "uuid-evil", "emailAddress": "evil@example.invalid"}}),
                encoding="utf-8",
            )

            # 1. Reparse-point rejection via NTFS FILE_ATTRIBUTE_REPARSE_POINT on cli-slots and .claude.json
            real_lstat = Path.lstat
            for suspect in (slots_root, slot_dir / ".claude.json"):
                if suspect.name == ".claude.json" and not suspect.exists():
                    suspect.write_text(secret_target.read_text(encoding="utf-8"), encoding="utf-8")

                class _FakeStat:
                    def __init__(self, base):
                        self.st_mode = base.st_mode
                        self.st_file_attributes = getattr(base, "st_file_attributes", 0) | quota._REPARSE_ATTR

                def fake_lstat(self_path, _real=real_lstat, _suspect=suspect):
                    res = _real(self_path)
                    if os.path.normcase(os.path.abspath(str(self_path))) == os.path.normcase(os.path.abspath(str(_suspect))):
                        return _FakeStat(res)
                    return res

                with self.subTest(reparse_target=suspect.name):
                    now = int(datetime.now(timezone.utc).timestamp())
                    payload = {
                        "model": {"display_name": "Opus 4.7"},
                        "rate_limits": {"five_hour": {"used_percentage": 55, "resets_at": now + 3600}},
                    }
                    buf = io.StringIO()
                    env = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(slot_dir)}
                    with patch.object(Path, "lstat", fake_lstat), \
                            patch.dict(os.environ, env, clear=True), \
                            patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                            patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                            contextlib.redirect_stdout(buf):
                        quota.handle_statusline()
                    self.assertEqual(buf.getvalue(), "")
                    self.assertFalse((app / "quota_ledger.json").exists())

            # 2. Real OS symlink check when supported without admin privilege
            cj_path = slot_dir / ".claude.json"
            if cj_path.exists():
                cj_path.unlink()
            try:
                os.symlink(secret_target, cj_path)
            except OSError:
                return
            now = int(datetime.now(timezone.utc).timestamp())
            payload = {
                "model": {"display_name": "Opus 4.7"},
                "rate_limits": {"five_hour": {"used_percentage": 75, "resets_at": now + 3600}},
            }
            buf = io.StringIO()
            env = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(slot_dir)}
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()
            self.assertEqual(buf.getvalue(), "")
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_statusline_relay_active_hint_honors_threshold_exclusions_cooldown_and_awaiting_reset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            home.mkdir()
            vault.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())

            (home / ".claude.json").write_text(
                json.dumps({
                    "oauthAccount": {
                        "accountUuid": "uuid-a",
                        "emailAddress": "a@example.invalid",
                        "displayName": "Acct-A",
                    }
                }),
                encoding="utf-8",
            )

            id_excl = "11111111111111111111111111111111"
            id_cool = "22222222222222222222222222222222"
            id_await = "33333333333333333333333333333333"
            id_good = "44444444444444444444444444444444"

            db_path = vault / "identities.sqlite"
            conn = sqlite3.connect(str(db_path))
            conn.executescript(
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            for rid, rname, remail, resets_rem in (
                (id_excl, "Excluded-Peer", "excl@example.invalid", 0),
                (id_cool, "Cooldown-Peer", "cool@example.invalid", 0),
                (id_await, "AwaitingReset-Peer", "await@example.invalid", 2),
                (id_good, "Healthy-Peer", "good@example.invalid", 0),
            ):
                conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, ?, 0)", (rid, rname))
                conn.execute(
                    "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                    (rid, json.dumps({"email": remail, "manual_resets_remaining": resets_rem})),
                )
            conn.commit()
            conn.close()

            def make_entry(uuid_s: str, email_s: str, u5: int, u7: int) -> dict:
                return {
                    "account_uuid": uuid_s,
                    "quota_identity": quota.quota_identity({"accountUuid": uuid_s, "emailAddress": email_s}),
                    "quota_source": "server_anchor",
                    "quota_5h_source": "server_anchor",
                    "quota_7d_source": "server_anchor",
                    "quota_5h_observed_at_ms": now * 1000,
                    "quota_7d_observed_at_ms": now * 1000,
                    "auth_status": "valid",
                    "quota_5h_used": u5,
                    "quota_5h_reset_at": now + 3600,
                    "quota_7d_used": u7,
                    "quota_7d_reset_at": now + 86400,
                    "server_anchor": {"accountUuid": uuid_s, "fetchedAtMs": now * 1000},
                }

            (app / "quota_ledger.json").write_text(
                json.dumps({
                    "accounts": {
                        "excl@example.invalid": make_entry("uuid-excl", "excl@example.invalid", 0, 5),
                        "cool@example.invalid": make_entry("uuid-cool", "cool@example.invalid", 5, 10),
                        "await@example.invalid": make_entry("uuid-await", "await@example.invalid", 10, 96),
                        "good@example.invalid": make_entry("uuid-good", "good@example.invalid", 15, 25),
                    }
                }),
                encoding="utf-8",
            )

            # spentThresholdPct=95 -> await@example.invalid (used_7d=96, resets=2) is awaitingManualReset!
            (app / "smart_relay_v1.json").write_text(
                json.dumps({
                    "schema": 1,
                    "enabled": True,
                    "spentThresholdPct": 95,
                    "autoContinueOnRelay": False,
                    "excludedAccountIds": [id_excl],
                    "cooldownUntilSec": {id_cool: now + 900},
                }),
                encoding="utf-8",
            )

            payload_95 = {
                "model": {"display_name": "Opus 4.7"},
                "context_window": {"used_percentage": 40},
                "rate_limits": {
                    "five_hour": {"used_percentage": 95, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 50, "resets_at": now + 86400},
                },
            }

            # 1. Manual /exit mode (autoContinueOnRelay=False) at 95% -> skips Excluded, Cooldown, and AwaitingReset
            buf_manual = io.StringIO()
            env_manual = {
                "USERPROFILE": str(home),
                "APPDATA": str(appdata),
                "CLAUDE_LOCAL_RELAY_ACTIVE": "1",
                "CLAUDE_LOCAL_RELAY_THRESHOLD": "95",
            }
            with patch.dict(os.environ, env_manual, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload_95))), \
                    contextlib.redirect_stdout(buf_manual):
                quota.handle_statusline()
            out_manual = buf_manual.getvalue().strip()
            self.assertIn("🔄 /exit 切[Healthy-Peer]", out_manual)
            self.assertNotIn("切[Excluded-Peer]", out_manual)
            self.assertNotIn("切[Cooldown-Peer]", out_manual)
            self.assertNotIn("切[AwaitingReset-Peer]", out_manual)

            # 2. Auto-continue mode (autoContinueOnRelay=True) -> shows 🔄 接力就绪→[Healthy-Peer]
            (app / "smart_relay_v1.json").write_text(
                json.dumps({
                    "schema": 1,
                    "enabled": True,
                    "spentThresholdPct": 95,
                    "autoContinueOnRelay": True,
                    "excludedAccountIds": [id_excl],
                    "cooldownUntilSec": {id_cool: now + 900},
                }),
                encoding="utf-8",
            )
            buf_auto = io.StringIO()
            with patch.dict(os.environ, env_manual, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload_95))), \
                    contextlib.redirect_stdout(buf_auto):
                quota.handle_statusline()
            self.assertIn("🔄 接力就绪→[Healthy-Peer]", buf_auto.getvalue().strip())

    def test_free_and_pro_downgrade_never_get_stamped_pro_or_retain_sticky_ultra_no_5h(self):
        now = int(datetime.now(timezone.utc).timestamp())
        now_dt = datetime.fromtimestamp(now, timezone.utc)
        cj = {"oauthAccount": {"accountUuid": "uuid-down", "emailAddress": "down@example.invalid", "organizationUuid": "org-d"}}
        # Stale rateLimitTier="5x" with explicit subscriptionType="free" or "pro" must honor subscriptionType
        self.assertEqual(
            quota.format_account(cj, {"claudeAiOauth": {"subscriptionType": "free", "rateLimitTier": "5x"}}, [], None, now_dt)["plan"],
            "Free",
        )
        self.assertEqual(
            quota.format_account(cj, {"claudeAiOauth": {"subscriptionType": "pro", "rateLimitTier": "20x"}}, [], None, now_dt)["plan"],
            "Pro",
        )

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            (home / ".claude").mkdir(parents=True)
            vault.mkdir(parents=True)
            ident_id = "99999999999999999999999999999999"
            fp = quota.quota_identity(cj["oauthAccount"])

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'DownCard', 0)", (ident_id,))
            conn.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                (ident_id, json.dumps({"email": "down@example.invalid", "quota_identity": fp, "plan": "Ultra", "quota_no_5h_limit": True})),
            )
            conn.commit()
            conn.close()

            # Seed ledger as Ultra with no_five_hour=True
            (app / "quota_ledger.json").write_text(
                json.dumps({
                    "accounts": {
                        "down@example.invalid": {
                            "email": "down@example.invalid",
                            "account_uuid": "uuid-down",
                            "organization_uuid": "org-d",
                            "quota_identity": fp,
                            "plan": "Ultra",
                            "quota_no_5h_limit": True,
                            "quota_7d_used": 30,
                            "quota_7d_reset_at": now + 86400,
                            "quota_7d_source": "server_anchor",
                            "quota_7d_observed_at_ms": (now - 60) * 1000,
                            "server_anchor": {
                                "accountUuid": "uuid-down",
                                "fetchedAtMs": (now - 60) * 1000,
                                "no_five_hour": True,
                                "utilization": {"seven_day": {"utilization": 30, "resets_at": now + 86400, "fetchedAtMs": (now - 60) * 1000}},
                            },
                        }
                    }
                }),
                encoding="utf-8",
            )

            # User downgrades to Free in CLI and triggers statusLine
            (home / ".claude.json").write_text(json.dumps(cj), encoding="utf-8")
            (home / ".claude" / ".credentials.json").write_text(
                json.dumps({"claudeAiOauth": {"subscriptionType": "free"}}),
                encoding="utf-8",
            )
            payload = {
                "model": {"display_name": "Sonnet 4.6"},
                "rate_limits": {
                    "five_hour": {"used_percentage": 25, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 35, "resets_at": now + 86400},
                },
            }
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline", "--quiet"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))):
                quota.handle_statusline()

            entry = quota.load_ledger(str(app))["accounts"]["down@example.invalid"]
            self.assertEqual(entry["plan"], "Free")
            self.assertFalse(entry["quota_no_5h_limit"])
            self.assertNotIn("no_five_hour", entry["server_anchor"])

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            saved_sum = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (ident_id,)).fetchone()[0])
            conn.close()
            self.assertEqual(saved_sum["plan"], "Free")
            self.assertFalse(saved_sum["quota_no_5h_limit"])

            # Verify handle_statusline never treats a downgraded Pro peer or slot with stale no_five_hour as 5h ∞
            slot_id = "88888888888888888888888888888888"
            slot_dir = app / "cli-slots" / slot_id
            slot_dir.mkdir(parents=True)
            (slot_dir / ".claude.json").write_text(
                json.dumps({"oauthAccount": {"accountUuid": "uuid-slot-p", "emailAddress": "slotpro@example.invalid"}}),
                encoding="utf-8",
            )
            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'SlotPro', 0)", (slot_id,))
            conn.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                (slot_id, json.dumps({"email": "slotpro@example.invalid", "plan": "Pro", "quota_no_5h_limit": False})),
            )
            conn.commit()
            conn.close()
            (app / "quota_ledger.json").write_text(
                json.dumps({
                    "updated_at": now_dt.isoformat(),
                    "accounts": {
                        "slotpro@example.invalid": {
                            "email": "slotpro@example.invalid",
                            "plan": "Pro",
                            "quota_no_5h_limit": True,
                            "quota_7d_used": 40,
                            "quota_7d_reset_at": now + 86400,
                            "quota_7d_source": "server_anchor",
                            "quota_7d_observed_at_ms": now * 1000,
                            "server_anchor": {"accountUuid": "uuid-slot-p", "fetchedAtMs": now * 1000, "no_five_hour": True},
                        }
                    },
                }),
                encoding="utf-8",
            )
            slot_buf = io.StringIO()
            slot_payload = {
                "model": {"display_name": "Sonnet 4.6"},
                "rate_limits": {"seven_day": {"used_percentage": 40, "resets_at": now + 86400}},
            }
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_CONFIG_DIR": str(slot_dir)}, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(slot_payload))), \
                    contextlib.redirect_stdout(slot_buf):
                quota.handle_statusline()
            self.assertNotIn("5h ∞", slot_buf.getvalue())
            self.assertIn("5h --", slot_buf.getvalue())

    def test_rested_5h_preserved_and_strategy_a1_reset_grants_and_active_relay_badge(self):
        now = int(datetime.now(timezone.utc).timestamp())
        # Strategy A1 unit checks: expired slice trims against raw_rem when future slice exists,
        # while all-expired slices still keep positive manual_resets_remaining per Strategy A1.
        self.assertEqual(
            quota._active_reset_cards_a1(
                {
                    "manual_resets_remaining": 3,
                    "manual_resets_grants": [
                        {"resets_left": 2, "ends_at": now - 10},
                        {"resets_left": 1, "ends_at": now + 3600},
                    ],
                },
                now,
            ),
            1,
        )
        self.assertEqual(
            quota._active_reset_cards_a1(
                {
                    "manual_resets_remaining": 2,
                    "manual_resets_grants": [{"resets_left": 2, "ends_at": now - 10}],
                },
                now,
            ),
            2,
        )

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            home.mkdir()
            vault.mkdir(parents=True)
            id_act = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            id_locked = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            id_pref = "cccccccccccccccccccccccccccccccc"
            fp_act = quota.quota_identity({"accountUuid": "uuid-act", "emailAddress": "act@example.invalid"})

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, archive TEXT NOT NULL DEFAULT '', saved_at INTEGER NOT NULL DEFAULT 0, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'Card-Active', 0)", (id_act,))
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'Card-NoReturn', 0)", (id_locked,))
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'Card-Preferred', 0)", (id_pref,))
            conn.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                (id_act, json.dumps({"email": "act@example.invalid", "quota_identity": fp_act, "plan": "Pro", "quota_5h_rested": True})),
            )
            conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (id_locked, json.dumps({"email": "locked@example.invalid", "plan": "Pro"})))
            conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (id_pref, json.dumps({"email": "pref@example.invalid", "plan": "Pro"})))
            conn.commit()
            conn.close()

            # Syncing rested account without 5h anchor preserves quota_5h_rested=True in SQLite
            quota.save_ledger_and_sync_sqlite(
                str(app),
                str(vault),
                [{
                    "id": id_act,
                    "role": "saved",
                    "email": "act@example.invalid",
                    "account_uuid": "uuid-act",
                    "quota_identity": fp_act,
                    "plan": "Pro",
                    "used_5h": None,
                    "quota_5h_source": "unknown",
                    "used_7d": 20,
                    "reset_7d_ts": now + 86400,
                    "quota_7d_source": "server_anchor",
                    "quota_7d_observed_at_ms": now * 1000,
                    "server_anchor": {"accountUuid": "uuid-act", "fetchedAtMs": now * 1000, "utilization": {"seven_day": {"utilization": 20, "resets_at": now + 86400, "fetchedAtMs": now * 1000}}},
                }],
                datetime.fromtimestamp(now, timezone.utc),
            )
            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            synced_act = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (id_act,)).fetchone()[0])
            conn.close()
            self.assertTrue(synced_act.get("quota_5h_rested"))

            # Relay HUD shows active saved card badge and honors noReturnAccountId / preferredAccountId
            (home / ".claude.json").write_text(
                json.dumps({"oauthAccount": {"accountUuid": "uuid-act", "emailAddress": "act@example.invalid"}}),
                encoding="utf-8",
            )
            (app / "quota_ledger.json").write_text(
                json.dumps({
                    "accounts": {
                        "locked@example.invalid": {
                            "account_uuid": "uuid-locked",
                            "quota_source": "server_anchor",
                            "quota_5h_source": "server_anchor",
                            "quota_7d_source": "server_anchor",
                            "auth_status": "valid",
                            "quota_5h_used": 5,
                            "quota_5h_reset_at": now + 3600,
                            "quota_7d_used": 10,
                            "quota_7d_reset_at": now + 7200,
                            "server_anchor": {"accountUuid": "uuid-locked", "fetchedAtMs": now * 1000},
                        },
                        "pref@example.invalid": {
                            "account_uuid": "uuid-pref",
                            "quota_source": "server_anchor",
                            "quota_5h_source": "server_anchor",
                            "quota_7d_source": "server_anchor",
                            "auth_status": "valid",
                            "quota_5h_used": 20,
                            "quota_5h_reset_at": now + 3600,
                            "quota_7d_used": 30,
                            "quota_7d_reset_at": now + 6 * 86400,
                            "server_anchor": {"accountUuid": "uuid-pref", "fetchedAtMs": now * 1000},
                        },
                    }
                }),
                encoding="utf-8",
            )
            (app / "smart_relay_v1.json").write_text(
                json.dumps({
                    "schema": 1,
                    "enabled": True,
                    "spentThresholdPct": 95,
                    "autoContinueOnRelay": True,
                    "preferredAccountId": id_pref,
                    "returnToPreferred": True,
                    "preferredReturnThresholdPct": 80,
                    "noReturnAccountId": id_locked,
                    "noReturnUntilSec": now + 1800,
                }),
                encoding="utf-8",
            )
            buf = io.StringIO()
            payload = {
                "model": {"display_name": "Opus 4.7"},
                "rate_limits": {
                    "five_hour": {"used_percentage": 96, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 40, "resets_at": now + 86400},
                },
            }
            env = {
                "USERPROFILE": str(home),
                "APPDATA": str(appdata),
                "CLAUDE_LOCAL_RELAY_ACTIVE": "1",
                "CLAUDE_LOCAL_RELAY_THRESHOLD": "95",
            }
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()
            hud = buf.getvalue().strip()
            self.assertTrue(hud.startswith("🔗 Card-Active │ Opus 4.7"))
            self.assertIn("🔄 接力就绪→[Card-Preferred]", hud)

    def test_statusline_persists_100_pct_exhaustion_without_reset_timestamp(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            home.mkdir()
            vault.mkdir(parents=True)
            ident_id = "1234567890abcdef1234567890abcdef"
            acc_obj = {"accountUuid": "uuid-exh", "emailAddress": "exhausted@example.invalid", "displayName": "ExhAcct"}
            fp = quota.quota_identity(acc_obj)
            (home / ".claude.json").write_text(json.dumps({"oauthAccount": acc_obj}), encoding="utf-8")

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO state(key, value) VALUES('active', ?)", (ident_id,))
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'ExhCard', 0)", (ident_id,))
            conn.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                (ident_id, json.dumps({"email": "exhausted@example.invalid", "quota_identity": fp, "plan": "Pro"})),
            )
            conn.commit()
            conn.close()

            # Live 100% exhaustion with resets_at omitted (None) MUST persist immediately as server_anchor!
            payload = {
                "model": {"display_name": "Opus 5.5"},
                "rate_limits": {"five_hour": {"used_percentage": 100}},
            }
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline", "--quiet"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))):
                quota.handle_statusline()

            entry = quota.load_ledger(str(app))["accounts"]["exhausted@example.invalid"]
            self.assertEqual(entry["quota_5h_used"], 100)
            self.assertEqual(entry["quota_5h_source"], "server_anchor")
            self.assertIsNotNone(entry["quota_5h_observed_at_ms"])

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            synced = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (ident_id,)).fetchone()[0])
            conn.close()
            self.assertEqual(synced["quota_5h_used"], 100)
            self.assertEqual(synced["quota_5h_source"], "server_anchor")

    def test_statusline_scenario_g_active_identity_guard_skips_mismatch_persist(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            home.mkdir()
            vault.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())

            id_a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            acc_a = {"accountUuid": "uuid-a", "emailAddress": "a@example.invalid", "displayName": "AcctA"}
            acc_b = {"accountUuid": "uuid-b", "emailAddress": "b@example.invalid", "displayName": "AcctB"}
            qi_a = quota.quota_identity(acc_a)

            # SQLite state.active points to Account A (qi_a), while disk ~/.claude.json was externally switched to Account B!
            (home / ".claude.json").write_text(json.dumps({"oauthAccount": acc_b}), encoding="utf-8")
            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO state(key, value) VALUES('active', ?)", (id_a,))
            conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, 'Card-A', 0)", (id_a,))
            conn.execute(
                "INSERT INTO identity_summaries(id, summary) VALUES(?, ?)",
                (id_a, json.dumps({"email": "a@example.invalid", "quota_identity": qi_a, "plan": "Pro", "quota_5h_used": 10})),
            )
            conn.commit()
            conn.close()

            payload = {
                "model": {"display_name": "Sonnet 5.5"},
                "context_window": {"used_percentage": 22},
                "rate_limits": {
                    "five_hour": {"used_percentage": 99, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 88, "resets_at": now + 86400},
                },
            }
            buf = io.StringIO()
            with patch.dict(os.environ, {"USERPROFILE": str(home), "APPDATA": str(appdata)}, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                    contextlib.redirect_stdout(buf):
                quota.handle_statusline()

            # Status bar still prints safely
            self.assertIn("Sonnet 5.5 (Ctx 22%)", buf.getvalue())
            # Ledger MUST NOT be written due to Scenario G mismatch guard!
            self.assertFalse((app / "quota_ledger.json").exists())
            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            still_a = json.loads(conn.execute("SELECT summary FROM identity_summaries WHERE id=?", (id_a,)).fetchone()[0])
            conn.close()
            self.assertEqual(still_a["quota_5h_used"], 10)

    def test_statusline_p1_8_threshold_85_strict_lt_rested_5h_inferred_7d_qident_dedup_and_default_thresh(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home, appdata = root / "home", root / "appdata"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            home.mkdir()
            vault.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())

            # Active account shares email with Org-B peer, distinguished by quota_identity!
            acc_act = {"accountUuid": "uuid-shared", "emailAddress": "shared@example.invalid", "organizationUuid": "org-1"}
            acc_org2 = {"accountUuid": "uuid-shared", "emailAddress": "shared@example.invalid", "organizationUuid": "org-2"}
            acc_rested = {"accountUuid": "uuid-rested", "emailAddress": "rested@example.invalid"}
            acc_inf7 = {"accountUuid": "uuid-inf7", "emailAddress": "inf7@example.invalid"}
            acc_pref = {"accountUuid": "uuid-pref85", "emailAddress": "pref85@example.invalid"}

            qi_act = quota.quota_identity(acc_act)
            qi_org2 = quota.quota_identity(acc_org2)
            qi_rested = quota.quota_identity(acc_rested)
            qi_inf7 = quota.quota_identity(acc_inf7)
            qi_pref = quota.quota_identity(acc_pref)

            id_act = "11111111111111111111111111111111"
            id_org2 = "22222222222222222222222222222222"
            id_rested = "33333333333333333333333333333333"
            id_inf7 = "44444444444444444444444444444444"
            id_pref = "55555555555555555555555555555555"

            (home / ".claude.json").write_text(json.dumps({"oauthAccount": acc_act}), encoding="utf-8")

            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO state(key, value) VALUES('active', ?)", (id_act,))
            for rid, rname, sum_obj in (
                (id_act, "Org1-Active", {"email": "shared@example.invalid", "quota_identity": qi_act, "plan": "Pro"}),
                (id_org2, "Org2-Peer", {"email": "shared@example.invalid", "quota_identity": qi_org2, "plan": "Pro"}),
                (id_rested, "Rested5h-Peer", {"email": "rested@example.invalid", "quota_identity": qi_rested, "plan": "Pro", "quota_5h_rested": True}),
                (id_inf7, "Inf7d-Peer", {"email": "inf7@example.invalid", "quota_identity": qi_inf7, "plan": "Pro"}),
                (id_pref, "Pref85-Peer", {"email": "pref85@example.invalid", "quota_identity": qi_pref, "plan": "Pro"}),
            ):
                conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, ?, 0)", (rid, rname))
                conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (rid, json.dumps(sum_obj)))
            conn.commit()
            conn.close()

            def write_ledger(pref_u5: int):
                (app / "quota_ledger.json").write_text(
                    json.dumps({
                        "accounts": {
                            f"shared@example.invalid#{qi_org2}": {
                                "account_uuid": "uuid-shared",
                                "organization_uuid": "org-2",
                                "quota_identity": qi_org2,
                                "quota_source": "server_anchor",
                                "quota_5h_source": "server_anchor",
                                "quota_7d_source": "server_anchor",
                                "quota_observed_at_ms": now * 1000,
                                "auth_status": "valid",
                                "quota_5h_used": 30,
                                "quota_5h_reset_at": now + 3600,
                                "quota_7d_used": 40,
                                "quota_7d_reset_at": now + 3 * 86400,
                                "server_anchor": {"accountUuid": "uuid-shared", "fetchedAtMs": now * 1000},
                            },
                            "rested@example.invalid": {
                                "account_uuid": "uuid-rested",
                                "quota_identity": qi_rested,
                                "quota_5h_source": "unknown",
                                "quota_7d_source": "server_anchor",
                                "quota_observed_at_ms": now * 1000,
                                "auth_status": "valid",
                                "quota_5h_rested": True,
                                "quota_7d_used": 25,
                                "quota_7d_reset_at": now + 4 * 86400,
                                "server_anchor": {"accountUuid": "uuid-rested", "fetchedAtMs": now * 1000},
                            },
                            "inf7@example.invalid": {
                                "account_uuid": "uuid-inf7",
                                "quota_identity": qi_inf7,
                                "quota_5h_source": "server_anchor",
                                "quota_7d_source": "reset_inferred",
                                "quota_observed_at_ms": (now - 100) * 1000,
                                "quota_5h_observed_at_ms": (now - 100) * 1000,
                                "quota_7d_observed_at_ms": (now - 100) * 1000,
                                "auth_status": "valid",
                                "quota_5h_used": 20,
                                "quota_5h_reset_at": now + 3600,
                                "quota_7d_used": 0,
                                "quota_7d_reset_at": now - 10,
                                "server_anchor": {
                                    "accountUuid": "uuid-inf7",
                                    "fetchedAtMs": (now - 100) * 1000,
                                    "utilization": {
                                        "five_hour": {"utilization": 20, "resets_at": now + 3600, "fetchedAtMs": (now - 100) * 1000},
                                        "seven_day": {"utilization": 90, "resets_at": now - 10, "fetchedAtMs": (now - 100) * 1000},
                                    },
                                },
                            },
                            "pref85@example.invalid": {
                                "account_uuid": "uuid-pref85",
                                "quota_identity": qi_pref,
                                "quota_source": "server_anchor",
                                "quota_5h_source": "server_anchor",
                                "quota_7d_source": "server_anchor",
                                "quota_observed_at_ms": now * 1000,
                                "auth_status": "valid",
                                "quota_5h_used": pref_u5,
                                "quota_5h_reset_at": now + 3600,
                                "quota_7d_used": 10,
                                "quota_7d_reset_at": now + 6 * 86400,
                                "server_anchor": {"accountUuid": "uuid-pref85", "fetchedAtMs": now * 1000},
                            },
                            # Duplicate older ledger entry for same quota_identity must be deduplicated
                            f"pref85@example.invalid#{qi_pref}": {
                                "account_uuid": "uuid-pref85",
                                "quota_identity": qi_pref,
                                "quota_source": "server_anchor",
                                "quota_5h_source": "server_anchor",
                                "quota_7d_source": "server_anchor",
                                "quota_observed_at_ms": (now - 500) * 1000,
                                "auth_status": "valid",
                                "quota_5h_used": 99,
                                "quota_5h_reset_at": now + 3600,
                                "quota_7d_used": 99,
                                "quota_7d_reset_at": now + 6 * 86400,
                                "server_anchor": {"accountUuid": "uuid-pref85", "fetchedAtMs": (now - 500) * 1000},
                            },
                        }
                    }),
                    encoding="utf-8",
                )

            (app / "smart_relay_v1.json").write_text(
                json.dumps({
                    "schema": 1,
                    "enabled": True,
                    "spentThresholdPct": 98,
                    "autoContinueOnRelay": False,
                    "preferredAccountId": id_pref,
                    "returnToPreferred": True,
                    "preferredReturnThresholdPct": 85,
                }),
                encoding="utf-8",
            )
            # Confirm _load_smart_relay_filter accepts 85
            rf = quota._load_smart_relay_filter(str(app), now)
            self.assertEqual(rf["preferred_return_threshold_pct"], 85)

            # 1. CLAUDE_LOCAL_RELAY_THRESHOLD unset -> defaults to cfg_spent_thresh (98): 96% does NOT trigger relay hint!
            write_ledger(pref_u5=85)
            buf_96 = io.StringIO()
            env_unset = {"USERPROFILE": str(home), "APPDATA": str(appdata), "CLAUDE_LOCAL_RELAY_ACTIVE": "1"}
            payload_96 = {
                "model": {"display_name": "Opus 5.5"},
                "rate_limits": {
                    "five_hour": {"used_percentage": 96, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 20, "resets_at": now + 86400},
                },
            }
            with patch.dict(os.environ, env_unset, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload_96))), \
                    contextlib.redirect_stdout(buf_96):
                quota.handle_statusline()
            hud_96 = buf_96.getvalue().strip()
            self.assertNotIn("🔄", hud_96)
            # Same-email Org2 peer, Rested5h peer, and reset_inferred 7d peer all appear; Pref85 appears once (deduped)!
            self.assertIn("Org2-Peer:60%", hud_96)
            self.assertIn("Rested5h-Peer:75%", hud_96)
            self.assertIn("Inf7d-Peer:80%", hud_96)
            self.assertEqual(hud_96.count("Pref85-Peer:"), 1)

            # 2. At 98% (default cfg_spent_thresh) with Pref85 at 85% (strict < 85 is False) -> picks Org2-Peer (soonest 7d), NOT Pref85!
            buf_98_eq = io.StringIO()
            payload_98 = {
                "model": {"display_name": "Opus 5.5"},
                "rate_limits": {
                    "five_hour": {"used_percentage": 98, "resets_at": now + 3600},
                    "seven_day": {"used_percentage": 20, "resets_at": now + 86400},
                },
            }
            with patch.dict(os.environ, env_unset, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload_98))), \
                    contextlib.redirect_stdout(buf_98_eq):
                quota.handle_statusline()
            self.assertIn("🔄 /exit 切[Org2-Peer]", buf_98_eq.getvalue().strip())

            # 3. With Pref85 at 84% (strict < 85 is True) -> picks Pref85-Peer!
            write_ledger(pref_u5=84)
            buf_98_lt = io.StringIO()
            with patch.dict(os.environ, env_unset, clear=True), \
                    patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                    patch.object(sys, "stdin", io.StringIO(json.dumps(payload_98))), \
                    contextlib.redirect_stdout(buf_98_lt):
                quota.handle_statusline()
            self.assertIn("🔄 /exit 切[Pref85-Peer]", buf_98_lt.getvalue().strip())

    def test_load_smart_relay_filter_accepts_80_and_85_thresholds(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "ai.local.claude-local"
            app.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())
            for pct in (80, 85, 90, 95, 98, 100):
                (app / "smart_relay_v1.json").write_text(
                    json.dumps({"schema": 1, "spentThresholdPct": pct}),
                    encoding="utf-8",
                )
                rf = quota._load_smart_relay_filter(str(app), now)
                self.assertEqual(rf["spent_threshold_pct"], pct)
            for invalid in (79, 83, True, "85"):
                (app / "smart_relay_v1.json").write_text(
                    json.dumps({"schema": 1, "spentThresholdPct": invalid}),
                    encoding="utf-8",
                )
                rf = quota._load_smart_relay_filter(str(app), now)
                self.assertEqual(rf["spent_threshold_pct"], 98)

    def test_load_smart_relay_filter_and_statusline_respects_affinity_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / "home"
            claude_dir = home / ".claude"
            appdata = Path(temp) / "AppData" / "Roaming"
            app = appdata / "ai.local.claude-local"
            vault = app / "identity-vault"
            claude_dir.mkdir(parents=True)
            vault.mkdir(parents=True)
            now = int(datetime.now(timezone.utc).timestamp())

            acc_cur = {"accountUuid": "uuid-cur", "emailAddress": "cur@example.invalid"}
            acc_b = {"accountUuid": "uuid-b", "emailAddress": "b@example.invalid"}
            qi_cur = quota.quota_identity(acc_cur)
            qi_b = quota.quota_identity(acc_b)
            id_cur = "11111111111111111111111111111111"
            id_b = "22222222222222222222222222222222"

            (home / ".claude.json").write_text(json.dumps({"oauthAccount": acc_cur}), encoding="utf-8")
            conn = sqlite3.connect(str(vault / "identities.sqlite"))
            conn.executescript(
                "CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, empty INTEGER NOT NULL DEFAULT 0);"
                "CREATE TABLE identity_summaries(id TEXT PRIMARY KEY, summary TEXT NOT NULL);"
            )
            conn.execute("INSERT INTO state(key, value) VALUES('active', ?)", (id_cur,))
            for rid, rname, sum_obj in (
                (id_cur, "Curr", {"email": "cur@example.invalid", "quota_identity": qi_cur, "plan": "Pro"}),
                (id_b, "Peer-B", {"email": "b@example.invalid", "quota_identity": qi_b, "plan": "Pro"}),
            ):
                conn.execute("INSERT INTO identities(id, name, empty) VALUES(?, ?, 0)", (rid, rname))
                conn.execute("INSERT INTO identity_summaries(id, summary) VALUES(?, ?)", (rid, json.dumps(sum_obj)))
            conn.commit()
            conn.close()

            (app / "quota_ledger.json").write_text(
                json.dumps({
                    "accounts": {
                        "cur@example.invalid": {
                            "account_uuid": "uuid-cur",
                            "quota_identity": qi_cur,
                            "quota_source": "server_anchor",
                            "quota_5h_source": "server_anchor",
                            "quota_7d_source": "server_anchor",
                            "quota_observed_at_ms": now * 1000,
                            "auth_status": "valid",
                            "quota_5h_used": 94,
                            "quota_5h_reset_at": now + 3600,
                            "quota_7d_used": 20,
                            "quota_7d_reset_at": now + 86400,
                            "server_anchor": {"accountUuid": "uuid-cur", "fetchedAtMs": now * 1000},
                        },
                        "b@example.invalid": {
                            "account_uuid": "uuid-b",
                            "quota_identity": qi_b,
                            "quota_source": "server_anchor",
                            "quota_5h_source": "server_anchor",
                            "quota_7d_source": "server_anchor",
                            "quota_observed_at_ms": now * 1000,
                            "auth_status": "valid",
                            "quota_5h_used": 10,
                            "quota_5h_reset_at": now + 3600,
                            "quota_7d_used": 10,
                            "quota_7d_reset_at": now + 86400,
                            "server_anchor": {"accountUuid": "uuid-b", "fetchedAtMs": now * 1000},
                        },
                    }
                }),
                encoding="utf-8",
            )

            def run_hud(u5, cfg_dict):
                (app / "smart_relay_v1.json").write_text(json.dumps(cfg_dict), encoding="utf-8")
                rf = quota._load_smart_relay_filter(str(app), now)
                buf = io.StringIO()
                payload = {
                    "model": {"display_name": "Opus 5.5"},
                    "rate_limits": {
                        "five_hour": {"used_percentage": u5, "resets_at": now + 3600},
                        "seven_day": {"used_percentage": 20, "resets_at": now + 86400},
                    },
                }
                env = {
                    "USERPROFILE": str(home),
                    "APPDATA": str(appdata),
                    "CLAUDE_LOCAL_RELAY_ACTIVE": "1",
                }
                with patch.dict(os.environ, env, clear=True), \
                        patch.object(sys, "argv", ["claude_quota.py", "--statusline"]), \
                        patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                        contextlib.redirect_stdout(buf):
                    quota.handle_statusline()
                return rf, buf.getvalue().strip()

            # manual suppresses relay_due hint even at 100% exhaustion
            rf_man, hud_man = run_hud(100, {"schema": 1, "spentThresholdPct": 85, "affinityMode": "manual"})
            self.assertEqual(rf_man["affinity_mode"], "manual")
            self.assertNotIn("🔄", hud_man)

            # session clamps threshold <95 -> 95 (94% suppresses hint, 95% shows hint)
            rf_s85, hud_94 = run_hud(94, {"schema": 1, "spentThresholdPct": 85, "affinityMode": "session"})
            self.assertEqual(rf_s85["affinity_mode"], "session")
            self.assertNotIn("🔄", hud_94)
            _, hud_95 = run_hud(95, {"schema": 1, "spentThresholdPct": 85, "affinityMode": "session"})
            self.assertIn("🔄 /exit 切[Peer-B]", hud_95)

            # session clamps threshold >=95 -> 100 (99% suppresses hint, 100% shows hint)
            _, hud_99 = run_hud(99, {"schema": 1, "spentThresholdPct": 95, "affinityMode": "session"})
            self.assertNotIn("🔄", hud_99)
            _, hud_100 = run_hud(100, {"schema": 1, "spentThresholdPct": 95, "affinityMode": "session"})
            self.assertIn("🔄 /exit 切[Peer-B]", hud_100)


if __name__ == "__main__":
    unittest.main()
