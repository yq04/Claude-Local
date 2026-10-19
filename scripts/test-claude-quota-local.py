"""Synthetic ledger tests; never open the real Claude home or application data."""
import importlib.util
import contextlib
import io
import json
import os
import sqlite3
import sys
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
            item = {"role": "current", "email": "A@example.invalid", "used_5h": 23,
                    "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 123}}
            quota.save_ledger_and_sync_sqlite(temp, str(root / "no-db"), [item], now)
            item.pop("server_anchor")
            item["used_5h"] = 24
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
                    "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": fetched,
                                      "utilization": {"five_hour": {"utilization": used}}},
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
                "server_anchor": {"accountUuid": "fixture", "fetchedAtMs": 2000},
            }], datetime.fromtimestamp(2, timezone.utc))
            quota.save_ledger_and_sync_sqlite(temp, str(vault), [{
                "role": "current", "email": "fixture@example.invalid", "used_5h": 10,
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


if __name__ == "__main__":
    unittest.main()
