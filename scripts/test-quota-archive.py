# [INPUT]: Synthetic encrypted gzip/Zstd tar streams and temporary fixture vaults.
# [OUTPUT]: Strict frame, minimal projection, unsafe-member and resource-bound regressions.
# [POS]: No real account, network, extraction or machine mutation.
# [PROTOCOL]: Keep scripts/CLAUDE.md aligned with the archive reader.
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import quota_archive as archive
import claude_quota as quota

MASTER = bytes(range(32))
KEY = bytes(reversed(range(32)))
NAME = "a" * 32 + ".baga"


def encrypt(data, *, terminal=True):
    nonce = bytes(range(12))
    result = bytearray(b"BAGAID01" + nonce + AESGCM(MASTER).encrypt(nonce, KEY, b"BAGAID01"))
    chunks = [data[n:n + 65536] for n in range(0, len(data), 65536)]
    if terminal:
        chunks.append(b"")
    for counter, plain in enumerate(chunks):
        size = (len(plain) + 16).to_bytes(4, "big")
        result.extend(size + AESGCM(KEY).encrypt(b"\0" * 4 + counter.to_bytes(8, "big"), plain, size))
    return bytes(result)


def tar_bytes(*, project_size=0, extra=(), sources=None, oversized=False):
    home = "C:/synthetic/home"
    sources = sources or [home + suffix for suffix in (
        "/.claude.json", "/.claude/.credentials.json", "/.claude/settings.json", "/.claude/projects")]
    manifest = {"version": 1, "home": home, "sources": [{"path": value} for value in sources]}
    values = {
        "data/0": json.dumps({"oauthAccount": {"accountUuid": "fixture-account"}, "projects": "ignored"}).encode(),
        "data/1": json.dumps({"claudeAiOauth": {"accessToken": "synthetic-only"}, "other": "ignored"}).encode(),
        "data/2": json.dumps({"theme": "ignored", "env": {"HTTPS_PROXY": "http://proxy.invalid:80"}}).encode(),
    }
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, value in values.items():
            if oversized and name == "data/0":
                value = b" " * (archive.MAX_JSON + 1)
            member = tarfile.TarInfo(name)
            member.size, member.uname, member.gname = len(value), "fixture", "fixture"
            tar.addfile(member, io.BytesIO(value))
        if project_size:
            member = tarfile.TarInfo("data/3/session.jsonl")
            member.size, member.uname, member.gname = project_size, "fixture", "fixture"
            tar.addfile(member, io.BytesIO(b"x" * project_size))
        for name, kind in extra:
            member = tarfile.TarInfo(name)
            member.uname = member.gname = "fixture"
            if kind == "link":
                member.type, member.linkname = tarfile.SYMTYPE, "data/1"
            elif kind == "hardlink":
                member.type, member.linkname = tarfile.LNKTYPE, "data/1"
            tar.addfile(member)
        value = json.dumps(manifest).encode()
        member = tarfile.TarInfo("manifest.json")
        member.size, member.uname, member.gname = len(value), "fixture", "fixture"
        tar.addfile(member, io.BytesIO(value))
    return result.getvalue()


def zstd(data):
    # Valid single-segment Zstd frame using raw blocks. Windows bsdtar 3.7.7's
    # --zstd stdout writer produced truncated fixtures; its reader accepts this
    # independently constructed standard frame, without a new Python dependency.
    frame = bytearray(b"\x28\xb5\x2f\xfd\xa0" + len(data).to_bytes(4, "little"))
    for offset in range(0, len(data), 128 * 1024):
        block = data[offset:offset + 128 * 1024]
        frame.extend(((len(block) << 3) | int(offset + len(block) == len(data))).to_bytes(3, "little"))
        frame.extend(block)
    return bytes(frame)


class QuotaArchiveTests(unittest.TestCase):
    def read(self, data):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "key.bin").write_bytes(MASTER)
            (vault / NAME).write_bytes(data)
            with patch.object(tempfile, "TemporaryDirectory", side_effect=AssertionError("plaintext temp forbidden")), \
                 patch.object(tempfile, "NamedTemporaryFile", side_effect=AssertionError("plaintext temp forbidden")):
                return archive.read_online_identity(vault, NAME)

    def test_frames_exact_terminal_and_legacy_shared_decoder(self):
        data = encrypt(b"synthetic compressed payload")
        self.assertEqual(b"".join(archive.authenticated_chunks(io.BytesIO(data), MASTER)), b"synthetic compressed payload")
        class ShortReads(io.BytesIO):
            def read(self, size=-1):
                return super().read(min(size, 3))
        self.assertEqual(b"".join(archive.authenticated_chunks(ShortReads(data), MASTER)), b"synthetic compressed payload")
        broken = [encrypt(b"payload", terminal=False), data + b"x", data + data[-20:], data[:-1], data[:70],
                  data[:68] + (15).to_bytes(4, "big"), data[:68] + (65553).to_bytes(4, "big"),
                  data[:68] + (2**32 - 1).to_bytes(4, "big")]
        damaged = bytearray(data)
        damaged[-1] ^= 1
        broken.append(bytes(damaged))
        with tempfile.TemporaryDirectory() as temp:
            for index, raw in enumerate(broken):
                with self.subTest(index=index):
                    with self.assertRaises(ValueError):
                        b"".join(archive.authenticated_chunks(io.BytesIO(raw), MASTER))
                    (Path(temp) / NAME).write_bytes(raw)
                    with self.assertRaises(ValueError):
                        quota.decrypt_baga(temp, MASTER, NAME)

    def test_gzip_minimal_projection_skips_large_projects_in_bounded_memory(self):
        compressed = gzip.compress(tar_bytes(project_size=16 * 1024 * 1024))
        extracted = []
        original = tarfile.TarFile.extractfile
        def extract(tar, member):
            extracted.append(member.name)
            return original(tar, member)
        tracemalloc.start()
        try:
            with patch.object(tarfile.TarFile, "extractfile", extract):
                cj, cred, route = self.read(encrypt(compressed))
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 8 * 1024 * 1024)
        self.assertEqual(set(extracted), {"manifest.json", "data/0", "data/1", "data/2"})
        self.assertNotIn("projects", cj)
        self.assertEqual(set(cred), {"claudeAiOauth"})
        self.assertEqual(route, {"HTTPS_PROXY": "http://proxy.invalid:80"})

    def test_authentication_precedes_any_tar_member_read(self):
        with patch.object(archive, "_scan", side_effect=AssertionError("unauthenticated tar traversal")):
            with self.assertRaises(ValueError):
                self.read(encrypt(gzip.compress(tar_bytes()), terminal=False))

    def test_reject_unsafe_link_duplicate_and_duplicate_source(self):
        for name, kind in [("../outside", "file"), ("/absolute", "file"), ("C:/drive", "file"),
                           ("data/back\\slash", "file"), ("data/sym", "link"), ("data/hard", "hardlink"),
                           ("data/0", "file")]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.read(encrypt(gzip.compress(tar_bytes(extra=[(name, kind)]))))
        with self.assertRaises(ValueError):
            self.read(encrypt(gzip.compress(tar_bytes(sources=["C:/synthetic/home/.claude.json"] * 2))))

    def test_resource_limits_and_deadline_fail_closed(self):
        data = encrypt(gzip.compress(tar_bytes(project_size=256 * 1024)))
        for constant, value in [("MAX_COMPRESSED", 32), ("MAX_EXPANDED", 4096), ("MAX_MEMBERS", 1), ("TIME_LIMIT", -1)]:
            with self.subTest(limit=constant), patch.object(archive, constant, value):
                with self.assertRaises((ValueError, TimeoutError)):
                    self.read(data)
        with self.assertRaises(ValueError):
            self.read(encrypt(gzip.compress(tar_bytes(oversized=True))))

    @unittest.skipUnless(os.name == "nt", "Windows Zstd backend")
    def test_zstd_projection_and_limits_without_plaintext_files(self):
        raw = zstd(tar_bytes(project_size=2 * 1024 * 1024))
        self.assertTrue(raw.startswith(b"\x28\xb5\x2f\xfd"))
        cj, cred, route = self.read(encrypt(raw))
        self.assertEqual(cj["oauthAccount"]["accountUuid"], "fixture-account")
        self.assertEqual(cred["claudeAiOauth"]["accessToken"], "synthetic-only")
        self.assertTrue(route)
        with patch.object(archive, "MAX_EXPANDED", 4096), self.assertRaises(ValueError):
            self.read(encrypt(raw))
        for name, kind in [("data/sym", "link"), ("data/0", "file")]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.read(encrypt(zstd(tar_bytes(extra=[(name, kind)]))))


if __name__ == "__main__":
    unittest.main()
