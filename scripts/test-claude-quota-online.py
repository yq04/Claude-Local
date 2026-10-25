# [INPUT]: Synthetic OAuth files, mock HTTP replies and temporary application data.
# [OUTPUT]: OAuth/browser binding, single-use bounded grants, pre-grant denial, writer-lock order and ledger/state persistence regressions.
# [POS]: Isolated tests for scripts/claude_quota_online.py; never uses real accounts or network.
# [PROTOCOL]: Keep scripts/CLAUDE.md aligned with tested poller behavior.
"""Synthetic online quota tests; HTTP and credentials are always fixtures."""
import importlib.util
from contextlib import closing
import gzip
import io
import json
import tempfile
import tarfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("quota_online", Path(__file__).with_name("claude_quota_online.py"))
online = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(online)


class OnlineQuotaTests(unittest.TestCase):
    def setUp(self):
        # Every route is synthetic too; never inspect the workstation proxy.
        for name, value in (("getproxies", {}), ("proxy_bypass", False)):
            mocked = patch.object(online.urllib.request, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)

    def fixture(self, root, *, account_uuid="account-fixture-uuid", organization_uuid="org-fixture-uuid",
                email="fixture@example.invalid", token="synthetic-access-token"):
        app = root / "app-data"
        home = root / "claude-home"
        vault = app / "identity-vault"
        (home / ".claude").mkdir(parents=True)
        vault.mkdir(parents=True)
        account = {
            "accountUuid": account_uuid,
            "emailAddress": email,
            "organizationUuid": organization_uuid,
        }
        (home / ".claude.json").write_text(json.dumps({"oauthAccount": account}), encoding="utf-8")
        (home / ".claude" / ".credentials.json").write_text(json.dumps({"claudeAiOauth": {
            "accessToken": token,
            "expiresAt": int(time.time() * 1000) + 3_600_000,
            "subscriptionType": "pro",
        }}), encoding="utf-8")
        return app, home, account

    def expected(self, account):
        return online.quota.quota_identity(account)

    def profile(self, account=None, *, account_uuid=None, organization_uuid=None, email=None,
                omit=()):
        account = account or {"accountUuid": "account-fixture-uuid", "emailAddress": "fixture@example.invalid",
                              "organizationUuid": "org-fixture-uuid"}
        result = {"account": {"uuid": account_uuid or account["accountUuid"],
                               "email": email or account["emailAddress"]},
                  "organization": {"uuid": organization_uuid or account["organizationUuid"]}}
        if "account.uuid" in omit:
            result["account"].pop("uuid", None)
        if "account.email" in omit:
            result["account"].pop("email", None)
        if "organization.uuid" in omit:
            result["organization"].pop("uuid", None)
        return result

    def mocked_success(self, account, payload):
        return [(200, json.dumps(self.profile(account)).encode(), {}),
                (200, json.dumps(payload).encode(), {})]

    def test_two_phase_grant_is_bounded_matching_fresh_and_single_use(self):
        nonce = "a" * 32
        deadline = int(time.time() * 1000) + 10_000
        good = {"type": "grant", "nonce": nonce, "expires_at_ms": deadline}
        for value in ("", "x" * (online.MAX_PROTOCOL_LINE + 1),
                      json.dumps({**good, "nonce": "b" * 32}) + "\n",
                      json.dumps({**good, "expires_at_ms": 1}) + "\n",
                      json.dumps({**good, "extra": True}) + "\n"):
            output = io.StringIO()
            acquire = online._commit_grant(io.StringIO(value), output, nonce, deadline)
            self.assertFalse(acquire())
            self.assertFalse(acquire())
            ready = json.loads(output.getvalue())
            self.assertEqual(ready, {"type": "ready_to_commit", "nonce": nonce})
        acquire = online._commit_grant(io.StringIO(json.dumps(good) + "\n"), io.StringIO(), nonce, deadline)
        self.assertTrue(acquire())
        self.assertFalse(acquire())

    def test_two_phase_denial_retains_prior_ledger_and_releases_request_lease(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            previous = b'{"accounts":{}}'
            (app / "quota_ledger.json").write_bytes(previous)
            payload = {"five_hour": {"utilization": 23, "resets_at": int(time.time()) + 1800}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)), \
                    patch.object(online, "_commit_success", side_effect=AssertionError("denied write")):
                result = online.run(app, home, "current", self.expected(account), lambda: False)
            self.assertEqual(result["status"], "cancelled")
            self.assertEqual((app / "quota_ledger.json").read_bytes(), previous)
            state = online._load_state(online._state_path(app))["accounts"][self.expected(account)]
            self.assertNotIn("lease", state)

    def test_commit_wait_is_outside_writer_lock_and_rechecks_changed_token(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            held = False
            real_lock = online.quota.ledger_writer_lock
            @contextmanager
            def monitored_lock(path):
                nonlocal held
                with real_lock(path):
                    held = True
                    try:
                        yield
                    finally:
                        held = False
            def grant():
                self.assertFalse(held)
                # Synthetic external credential change during the unlocked phase.
                path = home / ".claude" / ".credentials.json"
                value = json.loads(path.read_text())
                value["claudeAiOauth"]["accessToken"] = "different-synthetic-token"
                path.write_text(json.dumps(value))
                return True
            payload = {"five_hour": {"utilization": 23, "resets_at": int(time.time()) + 1800}}
            with patch.object(online.quota, "ledger_writer_lock", monitored_lock), \
                    patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)):
                result = online.run(app, home, "current", self.expected(account), grant)
            self.assertEqual(result["status"], "account_mismatch")
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_auth_cooldown_exposes_oauth_scope_but_active_429_still_blocks(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            with patch.object(online, "_fetch", return_value=(401, b"", {})):
                self.assertEqual(online.run(app, home, "current", self.expected(account))["status"], "auth_required")
            cached = online.run(app, home, "current", self.expected(account))
            self.assertEqual((cached["status"], cached["reason"], cached["retry_scope"]),
                             ("cooldown", "auth_required", "oauth"))
            state = online._load_state(online._state_path(app))
            state["accounts"][self.expected(account)]["rate_limit_retry_at_ms"] = int(time.time() * 1000) + 60_000
            online._atomic_json(online._state_path(app), state)
            # Even a missing token must not bypass the active server cooldown.
            path = home / ".claude" / ".credentials.json"
            value = json.loads(path.read_text())
            value["claudeAiOauth"].pop("accessToken")
            path.write_text(json.dumps(value))
            limited = online.run(app, home, "current", self.expected(account))
            self.assertEqual((limited["reason"], limited["retry_scope"]), ("rate_limited", "all"))

    def test_browser_import_denial_never_enters_writer_or_creates_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            snapshot = {"account_uuid": account["accountUuid"], "organization_uuid": account["organizationUuid"],
                        "billing_date_kind": "unknown", "billing_date": None, "manual_resets_remaining": 1,
                        "manual_resets_valid_until": int(time.time()) + 3600,
                        "metadata_observed_at_ms": int(time.time() * 1000)}
            with patch.object(online.quota, "ledger_writer_lock", side_effect=AssertionError("denied writer")):
                result = online.import_browser_snapshot(app, home, "current", snapshot, self.expected(account), lambda: False)
            self.assertEqual(result["status"], "cancelled")
            self.assertFalse((app / "identity-vault" / "quota_web_metadata.json").exists())

    def test_success_writes_valid_windows_and_shared_identity_cooldown(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now = int(time.time())
            payload = {"five_hour": {"utilization": 23.5, "resets_at": now + 1800},
                       "seven_day": {"utilization": 42, "resets_at": now + 86400}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "updated")
            self.assertEqual(result["updated_windows"], ["5h", "7d"])
            self.assertEqual(result["retry_at_ms"], result["observed_at_ms"] + online.SUCCESS_COOLDOWN_MS)
            ledger = json.loads((app / "quota_ledger.json").read_text(encoding="utf-8"))
            entry = ledger["accounts"]["fixture@example.invalid"]
            self.assertEqual(entry["server_anchor"]["accountUuid"], account["accountUuid"])
            self.assertEqual(entry["server_anchor"]["utilization"]["five_hour"]["utilization"], 23.5)
            self.assertEqual(entry["quota_5h_source"], "server_anchor")
            again = online.run(app, home, "current", self.expected(account))
            self.assertEqual(again["status"], "cooldown")
            self.assertNotIn("synthetic-access-token", json.dumps(result))
            state = json.loads((app / "identity-vault" / "quota_online_state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["version"], 1)
            self.assertEqual(len(state["accounts"]), 1)

    def test_server_profile_must_match_account_org_and_email_before_usage(self):
        local = {"accountUuid": "acct-a", "organizationUuid": "org-team",
                 "emailAddress": "a@example.invalid"}
        cases = [
            ("team-other-account", self.profile(local, account_uuid="acct-b"), "account_mismatch"),
            ("other-org", self.profile(local, organization_uuid="org-other"), "account_mismatch"),
            ("other-email", self.profile(local, email="b@example.invalid"), "account_mismatch"),
            ("missing-account-uuid", self.profile(local, omit=("account.uuid",)), "invalid_response"),
            ("missing-org-uuid", self.profile(local, omit=("organization.uuid",)), "invalid_response"),
            ("missing-email", self.profile(local, omit=("account.email",)), "invalid_response"),
        ]
        for label, profile, expected_status in cases:
            with self.subTest(profile_case=label), tempfile.TemporaryDirectory() as temp:
                app, home, account = self.fixture(Path(temp), account_uuid=local["accountUuid"],
                                                   organization_uuid=local["organizationUuid"],
                                                   email=local["emailAddress"])
                calls = []
                payload = {"five_hour": {"utilization": 10, "resets_at": int(time.time()) + 1800}}

                def fetch(_token, endpoint=online.ENDPOINT, route=None):
                    calls.append(endpoint)
                    body = profile if endpoint == online.PROFILE_ENDPOINT else payload
                    return 200, json.dumps(body).encode(), {}

                with patch.object(online, "_fetch", side_effect=fetch):
                    result = online.run(app, home, "current", self.expected(account))
                self.assertEqual(result["status"], expected_status)
                self.assertEqual(calls, [online.PROFILE_ENDPOINT])
                self.assertFalse((app / "quota_ledger.json").exists())

    def test_expected_identity_mismatch_blocks_network_and_browser_import(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, current = self.fixture(Path(temp), account_uuid="acct-current",
                                               organization_uuid="org-current", email="current@example.invalid")
            expected_a = "a" * 64
            with patch.object(online, "_fetch") as fetch:
                result = online.run(app, home, "current", expected_a)
            self.assertEqual(result["status"], "account_mismatch")
            fetch.assert_not_called()
            snapshot = {"account_uuid": current["accountUuid"], "organization_uuid": current["organizationUuid"],
                        "billing_date_kind": "next_renewal", "billing_date": int(time.time()) + 86400,
                        "manual_resets_remaining": 1, "manual_resets_valid_until": int(time.time()) + 3600,
                        "metadata_observed_at_ms": int(time.time() * 1000)}
            imported = online.import_browser_snapshot(app, home, "current", snapshot, expected_a)
            self.assertEqual(imported["status"], "account_mismatch")
            self.assertFalse((app / "identity-vault" / "quota_web_metadata.json").exists())
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_cli_requires_frozen_expected_identity(self):
        with patch.object(online.sys, "argv", ["claude_quota_online.py", "--app-data", "unused", "--claude-home", "unused"]), \
             patch.object(online.sys, "stdin", io.StringIO('{"account_id":"current"}')), \
             patch.object(online.sys, "stdout", io.StringIO()) as output:
            online.main()
            self.assertEqual(json.loads(output.getvalue()), {"status": "account_mismatch"})

    def test_expired_local_token_metadata_still_probes_server_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            cred_path = home / ".claude" / ".credentials.json"
            credentials = json.loads(cred_path.read_text(encoding="utf-8"))
            credentials["claudeAiOauth"]["expiresAt"] = 1
            cred_path.write_text(json.dumps(credentials), encoding="utf-8")
            payload = {"five_hour": {"utilization": 12, "resets_at": int(time.time()) + 1800}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)) as fetch:
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "updated")
            self.assertEqual(fetch.call_args_list[0].args[1], online.PROFILE_ENDPOINT)
            self.assertTrue((app / "quota_ledger.json").exists())

    def test_server_401_rejects_expired_local_token_without_usage_request(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            cred_path = home / ".claude" / ".credentials.json"
            credentials = json.loads(cred_path.read_text(encoding="utf-8"))
            credentials["claudeAiOauth"]["expiresAt"] = 1
            cred_path.write_text(json.dumps(credentials), encoding="utf-8")
            with patch.object(online, "_fetch", return_value=(401, None, {})) as fetch:
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "auth_required")
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(fetch.call_args.args[1], online.PROFILE_ENDPOINT)
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_browser_usage_clears_auth_cooldown_but_preserves_rate_limit_retry(self):
        def browser_snapshot(account):
            now_s = int(time.time())
            return {
                "account_uuid": account["accountUuid"],
                "organization_uuid": account["organizationUuid"],
                "billing_date_kind": "unknown", "billing_date": None,
                "manual_resets_remaining": None,
                "manual_resets_valid_until": None,
                "metadata_observed_at_ms": int(time.time() * 1000),
                "usage": {"five_hour": {"utilization": 17, "resets_at": now_s + 1800}},
            }

        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            with patch.object(online, "_fetch", return_value=(401, None, {})):
                oauth_failure = online.run(app, home, "current", self.expected(account))
            self.assertEqual(oauth_failure["status"], "auth_required")
            auth_retry = oauth_failure["retry_at_ms"]

            imported = online.import_browser_snapshot(
                app, home, "current", browser_snapshot(account), self.expected(account))
            self.assertEqual(imported["status"], "updated")
            state_path = app / "identity-vault" / "quota_online_state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            entry = state["accounts"][online.quota.quota_identity(account)]
            self.assertEqual(entry["last_status"], "updated")
            self.assertEqual(entry["last_source"], "browser")
            self.assertEqual(entry["last_observed_at_ms"], imported["observed_at_ms"])
            self.assertEqual(entry["retry_at_ms"], imported["observed_at_ms"] + online.SUCCESS_COOLDOWN_MS)
            self.assertLess(entry["retry_at_ms"], auth_retry)
            cooldown = online.run(app, home, "current", self.expected(account))
            self.assertEqual(cooldown["status"], "cooldown")
            self.assertEqual(cooldown["source"], "browser")

        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            with patch.object(online, "_fetch", return_value=(429, None, {"Retry-After": "600"})):
                limited = online.run(app, home, "current", self.expected(account))
            limited_retry = limited["retry_at_ms"]
            imported = online.import_browser_snapshot(
                app, home, "current", browser_snapshot(account), self.expected(account))
            self.assertEqual(imported["status"], "updated")
            state = json.loads((app / "identity-vault" / "quota_online_state.json").read_text(encoding="utf-8"))
            entry = state["accounts"][online.quota.quota_identity(account)]
            self.assertEqual(entry["retry_at_ms"], limited_retry)
            self.assertEqual(entry["rate_limit_retry_at_ms"], limited_retry)

    def test_missing_optional_archive_crypto_dependency_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            expected = self.expected(account)
            with patch.object(online, "quota", None):
                self.assertEqual(online.run(app, home, "current", expected), {"status": "unavailable"})
                result = online.import_browser_snapshot(app, home, "current", {}, expected)
            self.assertEqual(result, {"status": "unavailable", "metadata_updated": False})

    def test_invalid_or_mismatched_payload_does_not_create_observations(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now = int(time.time())
            bad_window = {"five_hour": {"utilization": 101, "resets_at": now + 60}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, bad_window)):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "invalid_response")
            self.assertFalse((app / "quota_ledger.json").exists())

        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            payload = {"account_uuid": "different-account", "five_hour": {
                "utilization": 10, "resets_at": int(time.time()) + 60}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "account_mismatch")
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_rate_limit_honors_retry_after_with_minimum_cooldown(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now_ms = int(time.time() * 1000)
            with patch.object(online, "_fetch", return_value=(429, None, {"Retry-After": "15"})):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "rate_limited")
            self.assertGreaterEqual(result["retry_at_ms"], now_ms + online.ERROR_COOLDOWN_MS - 1000)

    def test_success_cooldown_is_sixty_seconds_and_repeats_last_observation(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            payload = {"five_hour": {"utilization": 23, "resets_at": int(time.time()) + 1800}}
            with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)):
                updated = online.run(app, home, "current", self.expected(account))
            self.assertEqual(online.SUCCESS_COOLDOWN_MS, 60_000)
            self.assertEqual(updated["retry_at_ms"], updated["observed_at_ms"] + 60_000)
            cooldown = online.run(app, home, "current", self.expected(account))
            self.assertEqual(cooldown["status"], "cooldown")
            self.assertEqual(cooldown["retry_at_ms"], updated["retry_at_ms"])
            self.assertEqual(cooldown["last_observed_at_ms"], updated["observed_at_ms"])

    def test_network_failure_returns_persisted_backoff_time(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            before = int(time.time() * 1000)
            with patch.object(online, "_fetch", return_value=("network_error", None, None)):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "network_error")
            self.assertGreaterEqual(result["retry_at_ms"], before + online.MIN_ERROR_BACKOFF_MS - 1000)
            state = json.loads((app / "identity-vault" / "quota_online_state.json").read_text(encoding="utf-8"))
            self.assertEqual(result["retry_at_ms"], state["accounts"][online.quota.quota_identity(account)]["retry_at_ms"])

    def test_expired_or_replaced_lease_cannot_commit_usage(self):
        for replacement in ("expired", "replaced"):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as temp:
                app, home, account = self.fixture(Path(temp))
                now = int(time.time())
                payload = {"five_hour": {"utilization": 23, "resets_at": now + 1800}}

                def fetched(_token, endpoint=online.ENDPOINT, route=None):
                    if endpoint == online.PROFILE_ENDPOINT:
                        return 200, json.dumps(self.profile(account)).encode(), {}
                    state_path = app / "identity-vault" / "quota_online_state.json"
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                    entry = state["accounts"][online.quota.quota_identity(account)]
                    if replacement == "expired":
                        entry["lease_until_ms"] = 1
                    else:
                        entry["lease"] = "replacement-lease"
                    state_path.write_text(json.dumps(state), encoding="utf-8")
                    return 200, json.dumps(payload).encode(), {}

                with patch.object(online, "_fetch", side_effect=fetched):
                    result = online.run(app, home, "current", self.expected(account))
                self.assertEqual(result["status"], "cooldown")
                self.assertFalse((app / "quota_ledger.json").exists())

    def test_switch_or_token_replacement_during_request_cannot_commit(self):
        for change in ("switch-account", "replace-token"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                app, home, account = self.fixture(Path(temp))
                now = int(time.time())
                usage = {"five_hour": {"utilization": 12, "resets_at": now + 1800}}

                def fetched(_token, endpoint=online.ENDPOINT, route=None):
                    if endpoint == online.PROFILE_ENDPOINT:
                        return 200, json.dumps(self.profile(account)).encode(), {}
                    if change == "switch-account":
                        new_account = {"accountUuid": "account-b", "emailAddress": "b@example.invalid",
                                       "organizationUuid": account["organizationUuid"]}
                        (home / ".claude.json").write_text(json.dumps({"oauthAccount": new_account}), encoding="utf-8")
                    else:
                        cred_path = home / ".claude" / ".credentials.json"
                        credentials = json.loads(cred_path.read_text(encoding="utf-8"))
                        credentials["claudeAiOauth"]["accessToken"] = "replacement-token"
                        cred_path.write_text(json.dumps(credentials), encoding="utf-8")
                    return 200, json.dumps(usage).encode(), {}

                with patch.object(online, "_fetch", side_effect=fetched):
                    result = online.run(app, home, "current", self.expected(account))
                self.assertEqual(result["status"], "account_mismatch")
                self.assertFalse((app / "quota_ledger.json").exists())

    def test_saved_archive_selector_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "app-data"
            vault = app / "identity-vault"
            vault.mkdir(parents=True)
            (vault / "key.bin").write_bytes(b"x" * 32)
            db = vault / "identities.sqlite"
            conn = online.sqlite3.connect(db)
            try:
                conn.execute("CREATE TABLE identities(id TEXT, archive TEXT, empty INTEGER)")
                conn.execute("CREATE TABLE identity_summaries(id TEXT, summary TEXT)")
                conn.execute("INSERT INTO identities VALUES(?,?,0)", ("a" * 32, "../outside.baga"))
                conn.commit()
            finally:
                conn.close()
            with self.assertRaisesRegex(ValueError, "unsafe archive selector"):
                online._saved_account(app, "a" * 32)

    def saved_fixture(self, app, account_id, account, proxy):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        vault = app / "identity-vault"
        master, key, nonce = bytes(range(32)), bytes(reversed(range(32))), bytes(range(12))
        (vault / "key.bin").write_bytes(master)
        files = [{"oauthAccount": account}, {"claudeAiOauth": {"accessToken": "synthetic-saved-" + account_id}},
                 {"env": {"HTTPS_PROXY": proxy}}]
        root = "C:/synthetic/saved"
        sources = [root + suffix for suffix in ("/.claude.json", "/.claude/.credentials.json", "/.claude/settings.json")]
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            for name, value in [(f"data/{index}", value) for index, value in enumerate(files)] + [
                    ("manifest.json", {"version": 1, "home": root, "sources": [{"path": value} for value in sources]})]:
                raw = json.dumps(value).encode()
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                tar.addfile(member, io.BytesIO(raw))
        compressed = gzip.compress(stream.getvalue())
        cipher = bytearray(b"BAGAID01" + nonce + AESGCM(master).encrypt(nonce, key, b"BAGAID01"))
        for counter, chunk in enumerate([compressed, b""]):
            size = (len(chunk) + 16).to_bytes(4, "big")
            cipher.extend(size + AESGCM(key).encrypt(b"\0" * 4 + counter.to_bytes(8, "big"), chunk, size))
        filename = account_id + ".baga"
        (vault / filename).write_bytes(cipher)
        with closing(online.sqlite3.connect(vault / "identities.sqlite")) as db:
            db.execute("CREATE TABLE IF NOT EXISTS identities(id TEXT PRIMARY KEY, name TEXT, archive TEXT, empty INTEGER)")
            db.execute("CREATE TABLE IF NOT EXISTS identity_summaries(id TEXT PRIMARY KEY, summary TEXT)")
            db.execute("INSERT INTO identities VALUES(?,?,?,0)", (account_id, "synthetic", filename))
            db.execute("INSERT INTO identity_summaries VALUES(?,?)", (account_id, json.dumps(
                {"quota_identity": self.expected(account), "proxy": "http://wrong-summary.invalid:123"})))
            db.commit()

    def test_saved_accounts_use_their_actual_frozen_settings_route(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, _ = self.fixture(Path(temp))
            for suffix, proxy in (("a", "http://proxy-a.invalid:8001"), ("b", "http://proxy-b.invalid:8002")):
                account = {"accountUuid": "saved-" + suffix, "emailAddress": suffix + "@example.invalid", "organizationUuid": "org"}
                self.saved_fixture(app, suffix * 32, account, proxy)
                payload = {"five_hour": {"utilization": 12, "resets_at": int(time.time()) + 1800}}
                with patch.object(online, "_fetch", side_effect=self.mocked_success(account, payload)) as fetch, \
                     patch.object(online.quota, "inspect_baga_archive", side_effect=AssertionError("legacy full inspector forbidden")):
                    result = online.run(app, home, suffix * 32, self.expected(account))
                self.assertEqual(result["status"], "updated")
                self.assertEqual(result["route_mode"], "account_proxy")
                routes = [call.args[2] for call in fetch.call_args_list]
                self.assertEqual(routes, [("account_proxy", (("https", proxy),))] * 2)
            persisted = (app / "identity-vault" / "quota_online_state.json").read_text()
            self.assertNotIn("proxy-a", persisted)
            self.assertNotIn("proxy-b", persisted)

    def test_explicit_unsupported_routes_never_call_transport_or_persist_secret(self):
        values = ["socks5://proxy.invalid:1080", "https://proxy.invalid:443", "http://fixture-user:fixture-password@proxy.invalid:80",
                  "http://proxy.invalid/path", "not-a-url", "http://proxy.invalid:99999", 123, None]
        for value in values:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temp:
                app, home, account = self.fixture(Path(temp))
                (home / ".claude" / "settings.json").write_text(json.dumps({"env": {"HTTPS_PROXY": value}}))
                with patch.object(online, "_fetch") as fetch:
                    result = online.run(app, home, "current", self.expected(account))
                self.assertEqual(result, {"status": "route_unavailable", "reason": "unsupported_proxy", "stage": "route"})
                fetch.assert_not_called()
                self.assertFalse((app / "identity-vault" / "quota_online_state.json").exists())
                self.assertNotIn("fixture-password", json.dumps(result))

    def test_route_change_during_usage_rejects_stale_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            settings = home / ".claude" / "settings.json"
            settings.write_text(json.dumps({"env": {"HTTPS_PROXY": "http://a.invalid:80"}}))
            calls = []
            def fetch(_token, endpoint, route):
                calls.append(route)
                if endpoint == online.PROFILE_ENDPOINT:
                    return 200, json.dumps(self.profile(account)).encode(), {}
                settings.write_text(json.dumps({"env": {"HTTPS_PROXY": "http://b.invalid:80"}}))
                return 200, json.dumps({"five_hour": {"utilization": 23, "resets_at": int(time.time()) + 1800}}).encode(), {}
            with patch.object(online, "_fetch", side_effect=fetch):
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "route_unavailable")
            self.assertEqual(result["reason"], "route_changed")
            self.assertEqual(result["stage"], "commit")
            self.assertEqual(calls[0], calls[1])
            self.assertFalse((app / "quota_ledger.json").exists())

    def test_local_route_override_and_proxy_handler_ignore_host_bypass(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            (home / ".claude" / "settings.json").write_text(json.dumps({"env": {"HTTPS_PROXY": "http://a.invalid:80"}}))
            (home / ".claude" / "settings.local.json").write_text(json.dumps({"env": {"https_proxy": "http://b.invalid:81"}}))
            cj, *_ = online._read_live(home)
            route = online._route(cj)
            self.assertEqual(route, ("account_proxy", (("https", "http://b.invalid:81"),)))
            request = online.urllib.request.Request(online.ENDPOINT)
            handler = online._FrozenProxy(dict(route[1]), account_route=True)
            with patch.object(online.urllib.request, "proxy_bypass", side_effect=AssertionError("implicit bypass forbidden")):
                handler.proxy_open(request, "http://b.invalid:81", "https")
            self.assertEqual(request.host, "b.invalid:81")
            self.assertEqual(request._tunnel_host, "api.anthropic.com")

    def test_unset_route_is_tagged_host_system_and_frozen(self):
        with patch.object(online.urllib.request, "getproxies", return_value={"https": "http://host.invalid:99"}):
            self.assertEqual(online._route({}), ("host_system", (("https", "http://host.invalid:99"),)))

    def test_browser_metadata_requires_exact_account_binding_and_keeps_whitelist(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            snapshot = {"account_uuid": account["accountUuid"],
                        "organization_uuid": account["organizationUuid"],
                        "billing_date_kind": "next_renewal",
                        "billing_date": int(time.time()) + 86400,
                        "manual_resets_remaining": 2,
                        "manual_resets_valid_until": int(time.time()) + 3600,
                        "metadata_observed_at_ms": int(time.time() * 1000)}
            result = online.import_browser_snapshot(app, home, "current", snapshot, self.expected(account))
            self.assertEqual(result["status"], "updated")
            self.assertTrue(result["metadata_updated"])
            metadata = json.loads((app / "identity-vault" / "quota_web_metadata.json").read_text(encoding="utf-8"))
            identity = online.quota.quota_identity(account)
            initial = metadata["accounts"][identity]
            self.assertEqual(initial["manual_resets_remaining"], 2)
            self.assertEqual(initial["manual_resets_valid_until"], snapshot["manual_resets_valid_until"])
            self.assertEqual(initial["billing_observed_at_ms"], snapshot["metadata_observed_at_ms"])
            self.assertEqual(initial["manual_resets_observed_at_ms"], snapshot["metadata_observed_at_ms"])
            self.assertEqual(initial["metadata_observed_at_ms"], max(
                initial["billing_observed_at_ms"], initial["manual_resets_observed_at_ms"]))
            self.assertNotIn("account_uuid", metadata["accounts"][identity])
            newer = {**snapshot, "billing_date_kind": "unknown", "billing_date": None,
                     "manual_resets_remaining": 1,
                     "manual_resets_valid_until": snapshot["manual_resets_valid_until"] + 1,
                     "metadata_observed_at_ms": snapshot["metadata_observed_at_ms"] + 1000}
            partial = online.import_browser_snapshot(app, home, "current", newer, self.expected(account))
            self.assertEqual(partial["status"], "updated")
            self.assertTrue(partial["metadata_updated"])
            stored = json.loads((app / "identity-vault" / "quota_web_metadata.json").read_text(encoding="utf-8"))["accounts"][identity]
            self.assertEqual(stored["billing_date_kind"], "next_renewal")
            self.assertEqual(stored["billing_date"], snapshot["billing_date"])
            self.assertEqual(stored["billing_observed_at_ms"], snapshot["metadata_observed_at_ms"])
            self.assertEqual(stored["manual_resets_remaining"], 1)
            self.assertEqual(stored["manual_resets_valid_until"], newer["manual_resets_valid_until"])
            self.assertEqual(stored["manual_resets_observed_at_ms"], newer["metadata_observed_at_ms"])
            stale = {**snapshot, "billing_date": snapshot["billing_date"] + 1000,
                     "manual_resets_remaining": 9,
                     "metadata_observed_at_ms": snapshot["metadata_observed_at_ms"] - 1}
            rejected = online.import_browser_snapshot(app, home, "current", stale, self.expected(account))
            self.assertEqual(rejected["status"], "cached")
            self.assertFalse(rejected["metadata_updated"])
            after_stale = json.loads((app / "identity-vault" / "quota_web_metadata.json").read_text(encoding="utf-8"))["accounts"][identity]
            self.assertEqual(after_stale, stored)
            bad = {**snapshot, "account_uuid": "another-account"}
            mismatch = online.import_browser_snapshot(app, home, "current", bad, self.expected(account))
            self.assertEqual(mismatch["status"], "account_mismatch")
            self.assertFalse(mismatch["metadata_updated"])
            over_limit = {**snapshot, "manual_resets_remaining": 0x1_0000_0000}
            rejected_limit = online.import_browser_snapshot(app, home, "current", over_limit, self.expected(account))
            self.assertEqual(rejected_limit["status"], "invalid_response")
            self.assertFalse(rejected_limit["metadata_updated"])

    def test_invalid_manual_reset_validity_does_not_block_billing_or_refresh_observation_clock(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            observed = int(time.time() * 1000)
            snapshot = {
                "account_uuid": account["accountUuid"], "organization_uuid": account["organizationUuid"],
                "billing_date_kind": "next_renewal", "billing_date": observed // 1000 + 86400,
                "manual_resets_remaining": 4, "manual_resets_valid_until": observed // 1000 + 86401,
                "metadata_observed_at_ms": observed,
            }
            result = online.import_browser_snapshot(app, home, "current", snapshot, self.expected(account))
            self.assertEqual(result["status"], "updated")
            saved = json.loads((app / "identity-vault" / "quota_web_metadata.json").read_text())
            entry = saved["accounts"][online.quota.quota_identity(account)]
            self.assertEqual(entry["billing_observed_at_ms"], observed)
            self.assertNotIn("manual_resets_remaining", entry)

    def test_browser_usage_only_updates_quota_with_host_observation_time(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now_s = int(time.time())
            received_before = int(time.time() * 1000)
            snapshot = {
                "account_uuid": account["accountUuid"],
                "organization_uuid": account["organizationUuid"],
                "billing_date_kind": "unknown", "billing_date": None,
                "manual_resets_remaining": None,
                "manual_resets_valid_until": None,
                "metadata_observed_at_ms": received_before,
                "usage": {"five_hour": {"utilization": 31.5, "resets_at": now_s + 1800}},
            }
            result = online.import_browser_snapshot(app, home, "current", snapshot,
                                                    self.expected(account))
            self.assertEqual(result["status"], "updated")
            self.assertFalse(result["metadata_updated"])
            self.assertEqual(result["source"], "browser")
            self.assertEqual(result["updated_windows"], ["5h"])
            self.assertGreaterEqual(result["observed_at_ms"], received_before)
            ledger = json.loads((app / "quota_ledger.json").read_text(encoding="utf-8"))
            entry = ledger["accounts"]["fixture@example.invalid"]
            anchor = entry["server_anchor"]
            self.assertEqual(anchor["utilization"]["five_hour"]["utilization"], 31.5)
            self.assertEqual(anchor["utilization"]["five_hour"]["fetchedAtMs"], result["observed_at_ms"])

    def test_browser_partial_usage_keeps_old_window_and_wrong_account_writes_nothing(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now_s = int(time.time())
            base = {"account_uuid": account["accountUuid"],
                    "organization_uuid": account["organizationUuid"],
                    "billing_date_kind": "unknown", "billing_date": None,
                    "manual_resets_remaining": None,
                    "manual_resets_valid_until": None,
                    "metadata_observed_at_ms": int(time.time() * 1000)}
            seeded = {**base, "usage": {
                "five_hour": {"utilization": 20, "resets_at": now_s + 1800},
                "seven_day": {"utilization": 40, "resets_at": now_s + 86400},
            }}
            first = online.import_browser_snapshot(app, home, "current", seeded, self.expected(account))
            self.assertEqual(first["status"], "updated")
            ledger_path = app / "quota_ledger.json"
            identity = "fixture@example.invalid"
            original_anchor = json.loads(ledger_path.read_text(encoding="utf-8"))["accounts"][identity]["server_anchor"]

            partial = {**base, "metadata_observed_at_ms": base["metadata_observed_at_ms"] + 1,
                       "usage": {
                           "five_hour": {"utilization": 21, "resets_at": now_s + 1900},
                           "seven_day": {"utilization": 101, "resets_at": now_s + 86400},
                       }}
            second = online.import_browser_snapshot(app, home, "current", partial, self.expected(account))
            self.assertEqual(second["updated_windows"], ["5h"])
            merged = json.loads(ledger_path.read_text(encoding="utf-8"))["accounts"][identity]["server_anchor"]
            self.assertEqual(merged["utilization"]["five_hour"]["utilization"], 21)
            self.assertEqual(merged["utilization"]["seven_day"]["utilization"],
                             original_anchor["utilization"]["seven_day"]["utilization"])
            self.assertEqual(merged["utilization"]["seven_day"]["fetchedAtMs"],
                             original_anchor["utilization"]["seven_day"]["fetchedAtMs"])

            wrong = {**base, "account_uuid": "other-account",
                     "usage": {"five_hour": {"utilization": 1, "resets_at": now_s + 1800}}}
            before = ledger_path.read_bytes()
            rejected = online.import_browser_snapshot(app, home, "current", wrong, self.expected(account))
            self.assertEqual(rejected["status"], "account_mismatch")
            self.assertEqual(ledger_path.read_bytes(), before)

    def test_cli_user_agent_and_headers_match_official_claude_code_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / "claude-home"
            versions = home / ".local" / "share" / "claude" / "versions"
            versions.mkdir(parents=True)
            (versions / "2.1.104.exe").write_bytes(b"")
            (versions / "2.1.304.exe").write_bytes(b"")
            self.assertEqual(online._cli_user_agent(home), "claude-cli/2.1.304 (external, cli)")
            self.assertRegex(online.USER_AGENT, r"^claude-cli/\d+\.\d+\.\d+ \(external, cli\)$")

            captured_headers = {}

            class DummyResponse:
                status = 200
                headers = {}
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    return False
                def read(self, _limit):
                    return b"{}"

            class DummyOpener:
                def open(self, request, timeout=None):
                    captured_headers.update({k.lower(): v for k, v in request.header_items()})
                    return DummyResponse()

            with patch.object(online.urllib.request, "build_opener", return_value=DummyOpener()):
                status, raw, _ = online._fetch("synthetic-token", online.ENDPOINT, ("host_system", ()))
            self.assertEqual(status, 200)
            self.assertEqual(raw, b"{}")
            self.assertEqual(captured_headers.get("anthropic-version"), "2023-06-01")
            self.assertEqual(captured_headers.get("anthropic-beta"), "oauth-2025-04-20")
            self.assertEqual(captured_headers.get("x-app"), "cli")
            self.assertEqual(captured_headers.get("user-agent"), online.USER_AGENT)

    def test_exit_country_preflight_blocks_non_us_exit_before_oauth_requests(self):
        self.assertEqual(online._parse_trace_country(b"fl=12f\nloc=US\ntls=TLSv1.3\n"), "US")
        self.assertEqual(online._parse_trace_country("loc=hk\n"), "HK")
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            with patch.dict(online.os.environ, {"CLAUDE_LOCAL_VERIFY_EXIT": "1"}), \
                 patch.object(online, "_verify_exit_country", return_value=(False, "HK")), \
                 patch.object(online, "_fetch") as fetch:
                result = online.run(app, home, "current", self.expected(account))
            self.assertEqual(result["status"], "route_unavailable")
            self.assertEqual(result["reason"], "non_us_exit")
            self.assertEqual(result["country"], "HK")
            self.assertEqual(result["stage"], "exit_check")
            fetch.assert_not_called()

    def test_wakeup_sends_cli_aligned_messages_and_parses_ratelimit_headers(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            custom_user_id = "d" * 64
            (home / ".claude.json").write_text(
                json.dumps({"oauthAccount": account, "userID": custom_user_id}),
                encoding="utf-8",
            )
            now_s = int(time.time())
            captured_post = {}

            class DummyPostResponse:
                status = 200
                headers = {
                    "anthropic-ratelimit-unified-5h-utilization": "0.0015",
                    "anthropic-ratelimit-unified-5h-reset": str(now_s + 18000),
                    "anthropic-ratelimit-unified-7d-utilization": "0.345",
                    "anthropic-ratelimit-unified-7d-reset": str(now_s + 432000),
                }
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    return False
                def read(self, _limit):
                    return b'{"id":"msg_01","type":"message"}'

            class DummyPostOpener:
                def open(self, request, timeout=None):
                    captured_post["url"] = request.full_url
                    captured_post["method"] = request.get_method()
                    captured_post["headers"] = {k.lower(): v for k, v in request.header_items()}
                    captured_post["body"] = json.loads(request.data.decode("utf-8"))
                    return DummyPostResponse()

            with patch.object(online, "_fetch", return_value=(200, json.dumps(self.profile(account)).encode(), {})) as fetch_mock, \
                 patch.object(online.urllib.request, "build_opener", return_value=DummyPostOpener()):
                result = online.run_wakeup(app, home, "current", self.expected(account))

            self.assertEqual(result["status"], "updated")
            self.assertEqual(result["updated_windows"], ["5h", "7d"])
            self.assertEqual(fetch_mock.call_count, 1)
            self.assertEqual(fetch_mock.call_args.args[1], online.PROFILE_ENDPOINT)
            self.assertEqual(captured_post["url"], online.MESSAGES_ENDPOINT)
            self.assertEqual(captured_post["method"], "POST")
            hdrs = captured_post["headers"]
            self.assertEqual(hdrs.get("x-app"), "cli")
            self.assertEqual(hdrs.get("x-stainless-lang"), "js")
            self.assertEqual(hdrs.get("x-stainless-package-version"), "0.128.0")
            self.assertIn("oauth-2025-04-20", hdrs.get("anthropic-beta", ""))
            session_id = hdrs.get("x-claude-code-session-id")
            self.assertTrue(session_id and len(session_id) == 36)
            meta_user = json.loads(captured_post["body"]["metadata"]["user_id"])
            self.assertEqual(meta_user["device_id"], custom_user_id)
            self.assertEqual(meta_user["account_uuid"], account["accountUuid"])
            self.assertEqual(meta_user["session_id"], session_id)
            ledger = json.loads((app / "quota_ledger.json").read_text(encoding="utf-8"))
            entry = ledger["accounts"]["fixture@example.invalid"]
            self.assertAlmostEqual(entry["server_anchor"]["utilization"]["five_hour"]["utilization"], 0.15, places=2)
            self.assertAlmostEqual(entry["server_anchor"]["utilization"]["seven_day"]["utilization"], 34.5, places=2)

    def test_wakeup_falls_back_to_sonnet_and_usage_endpoint_when_headers_stripped(self):
        with tempfile.TemporaryDirectory() as temp:
            app, home, account = self.fixture(Path(temp))
            now_s = int(time.time())
            models_tried = []

            def fake_post(_token, model, _device_id, _account_uuid, route=None):
                models_tried.append(model)
                if model == online.WAKEUP_MODELS[0]:
                    return 404, b"", {}
                # Return 200 without ratelimit headers so fallback to GET /api/oauth/usage triggers
                return 200, b"{}", {}

            usage_payload = {
                "five_hour": {"utilization": 0.2, "resets_at": now_s + 17990},
                "seven_day": {"utilization": 28.0, "resets_at": now_s + 300000},
            }
            with patch.object(online, "_post_wakeup", side_effect=fake_post), \
                 patch.object(online, "_fetch", side_effect=self.mocked_success(account, usage_payload)) as fetch_mock:
                result = online.run_wakeup(app, home, "current", self.expected(account))

            self.assertEqual(result["status"], "updated")
            self.assertEqual(models_tried, list(online.WAKEUP_MODELS))
            self.assertEqual(fetch_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
