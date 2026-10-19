#!/usr/bin/env python3
# [INPUT]: 一次性资料迁移入口、临时虚构保险库/浏览器与进程查询替身。
# [OUTPUT]: 源保留、目标不覆盖、链接/活跃进程/SQLite sidecar 拒绝及失败暂存保留回归。
# [POS]: 只访问临时 fixtures，不读取真实账号、浏览器或额度账本。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import importlib.util
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("migrate_local_data", Path(__file__).with_name("migrate-local-data.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="claude-local-migrate-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "official-fixture"
        self.source.mkdir()
        self.destination = self.root / "local-fixture"
        vault = self.source / "identity-vault"
        vault.mkdir()
        (vault / "key.bin").write_bytes(b"x" * 32)
        (vault / "fixture.baga").write_bytes(b"fictional encrypted archive")
        with closing(sqlite3.connect(vault / "identities.sqlite")) as connection:
            connection.execute("CREATE TABLE identities(id TEXT, archive TEXT, empty INTEGER)")
            connection.execute("INSERT INTO identities VALUES('fixture','fixture.baga',0)")
            connection.execute("CREATE TABLE browser_bindings(identity TEXT, slot TEXT, seed INTEGER)")
            connection.execute("INSERT INTO browser_bindings VALUES('fixture','fixture-slot',123)")
            connection.execute("CREATE TABLE state(key TEXT, value TEXT)")
            connection.commit()
        profile = self.source / "browser/contexts/fixture-slot/profile/Default"
        profile.mkdir(parents=True)
        (profile / "fixture-data").write_bytes(b"fictional browser data")
        (self.source / "browser/launch.args").write_text("old-generated-path", encoding="utf-8")
        (self.source / "quota_ledger.json").write_text('{"accounts":{}}', encoding="utf-8")
        (self.source / "ui-language").write_text("zh", encoding="utf-8")
        (self.source / "unrelated-cache").write_text("do not copy", encoding="utf-8")
        guard = patch.object(migration, "ensure_no_source_processes")
        self.guard = guard.start()
        self.addCleanup(guard.stop)

    def test_copy_preserves_source_and_every_user_asset(self):
        original = migration.snapshot(self.source)
        result = migration.migrate(self.source, self.destination)
        self.assertEqual(original, migration.snapshot(self.source))
        self.assertEqual(original, migration.snapshot(self.destination))
        self.assertEqual(result["saved_identities"], 1)
        self.assertTrue(result["source_preserved"] and result["all_hashes_match"])
        self.assertFalse((self.destination / "unrelated-cache").exists())
        if os.name == "nt":
            for path in [self.destination, *self.destination.rglob("*")]:
                migration.private_files().assert_private(migration.winpath(path))

    def test_existing_empty_and_nonempty_destinations_are_refused(self):
        self.destination.mkdir()
        with self.assertRaises(FileExistsError):
            migration.migrate(self.source, self.destination)
        marker = self.destination / "keep"
        marker.write_text("preserve")
        with self.assertRaises(FileExistsError):
            migration.migrate(self.source, self.destination)
        self.assertEqual(marker.read_text(), "preserve")

    def test_relative_and_overlapping_paths_are_refused(self):
        with self.assertRaises(ValueError):
            migration.migrate(Path("relative"), self.destination)
        with self.assertRaises(ValueError):
            migration.migrate(self.source, self.source / "nested")

    def test_link_preflight_fails_without_copying_link_target(self):
        target = self.root / "unrelated"
        target.mkdir()
        (target / "private-marker").write_text("must stay outside")
        link = self.source / "browser/linked"
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Symlink unavailable: {error.errno}")
        with self.assertRaisesRegex(ValueError, "reparse"):
            migration.migrate(self.source, self.destination)
        self.assertFalse(self.destination.exists())
        self.assertFalse(list(self.root.glob(".local-fixture.migrate-*")))

    def test_sidecar_refuses_unsafe_database_copy(self):
        (self.source / "identity-vault/identities.sqlite-wal").write_bytes(b"fixture writer")
        with self.assertRaisesRegex(ValueError, "sidecar"):
            migration.migrate(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_pending_identity_recovery_is_refused(self):
        with closing(sqlite3.connect(self.source / "identity-vault/identities.sqlite")) as connection:
            connection.execute("INSERT INTO state VALUES('recovery','fixture')")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "recovery"):
            migration.migrate(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_hardlink_is_refused(self):
        os.link(self.source / "ui-language", self.source / "browser/hardlink")
        with self.assertRaisesRegex(ValueError, "reparse"):
            migration.migrate(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_running_source_process_refuses_before_staging(self):
        self.guard.side_effect = RuntimeError("fixture old browser is running")
        with self.assertRaisesRegex(RuntimeError, "running"):
            migration.migrate(self.source, self.destination)
        self.assertFalse(list(self.root.glob(".local-fixture.migrate-*")))

    def test_copy_failure_retains_private_recovery_stage_and_source(self):
        original = migration.snapshot(self.source)
        with patch.object(migration, "copy_file", side_effect=OSError("fixture copy failure")):
            with self.assertRaisesRegex(RuntimeError, "recovery stage"):
                migration.migrate(self.source, self.destination)
        self.assertEqual(original, migration.snapshot(self.source))
        self.assertFalse(self.destination.exists())
        stages = list(self.root.glob(".local-fixture.migrate-*"))
        self.assertEqual(len(stages), 1)
        if os.name == "nt":
            migration.private_files().assert_private(migration.winpath(stages[0]))

    def test_source_change_is_detected_before_destination_publication(self):
        copy = migration.copy_file

        def changing_copy(source, destination):
            copy(source, destination)
            if source.name == "quota_ledger.json":
                source.write_text('{"accounts":{},"new":true}', encoding="utf-8")

        with patch.object(migration, "copy_file", side_effect=changing_copy):
            with self.assertRaisesRegex(RuntimeError, "recovery stage"):
                migration.migrate(self.source, self.destination)
        self.assertFalse(self.destination.exists())
        self.assertEqual(len(list(self.root.glob(".local-fixture.migrate-*"))), 1)


if __name__ == "__main__":
    unittest.main()
