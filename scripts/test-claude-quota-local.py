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
                [(90, now + 600, "local_estimate", 1000), (20, now + 900, "server_anchor", 1500)],
                [(80, now + 600, "server_anchor", 2000), (35, now + 1200, "server_anchor", 2500)], now)
        self.assertEqual(states[0], (90, now + 600, "local_estimate", 2000))
        self.assertEqual(states[1], (35, now + 1200, "server_anchor", 2500))

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
        self.assertEqual(quota.CURRENT_QUOTA_VERSION, 6)

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


if __name__ == "__main__":
    unittest.main()
