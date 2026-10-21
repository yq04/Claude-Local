#!/usr/bin/env python3
# [INPUT]: Temporary synthetic Tauri resources, runtime contamination, links and private markers.
# [OUTPUT]: Focused regression checks for the read-only Windows packaging privacy boundary.
# [POS]: No real accounts, profiles, browser execution or installation/uninstallation.
# [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing the audit contract.
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("package_audit", Path(__file__).with_name("audit-windows-package.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class PackageAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.engine = self.root / "browser-runtime/WindowsBrowser"
        for source in audit.RESOURCE_MAP:
            path = self.root / "src-tauri" / source
            if source.endswith("/"):
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic public resource")
        for filename, content in {
            "chrome.exe": b"synthetic PE fixture", "version.txt": b"148.0.7778.215",
            "First Run": b"vendor marker", "IwaKeyDistribution/iwa-key-distribution.pb": b"public metadata",
            "IwaKeyDistribution/manifest.json": b"{}", "locales/en-US.pak": b"localization",
            "elevation_service.exe": b"vendor helper", "LICENSE.txt": b"public license",
        }.items():
            path = self.engine / filename
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_bytes(content)
        (self.root / "dist/index.html").write_bytes(b"synthetic frontend")
        for icon in ("icon.ico", "icon.png"):
            path = self.root / "src-tauri/icons" / icon
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic icon")
        for filename in ("tauri.conf.json", "tauri.windows.conf.json"):
            (self.root / "src-tauri" / filename).write_text(json.dumps({
                "build": {"frontendDist": "../dist"},
                "bundle": {"resources": audit.RESOURCE_MAP, "icon": ["icons/icon.ico", "icons/icon.png"]}}))

    def preflight(self):
        result = audit.Audit()
        audit.preflight(self.root, result)
        return result

    def test_clean_vendor_files_and_licenses_are_allowed(self):
        result = self.preflight()
        self.assertEqual(result.findings, [])
        self.assertIn("browser-runtime/WindowsBrowser/elevation_service.exe", [f["path"] for f in result.files])

    def test_runtime_and_sensitive_entries_fail_without_reading_or_deleting(self):
        for name in ("identities.sqlite", "quota_ledger.json", "chrome_debug.log", "Default/Preferences",
                     "Profile 1/Cookies", "Local State", "credentials.json", "session-secret.txt",
                     "access-token.txt", "identity.baga", "unexpected.dat"):
            with self.subTest(name=name):
                path = self.engine / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic private data")
                result = self.preflight()
                self.assertTrue(result.findings)
                self.assertEqual(path.read_bytes(), b"synthetic private data")
                self.assertNotIn(name, [f["path"].split("WindowsBrowser/")[-1] for f in result.files])
                # Only synthetic fixtures are removed by this test, never by the auditor.
                path.unlink()
                if path.parent != self.engine:
                    path.parent.rmdir()

    def test_unexpected_resource_mapping_fails_closed(self):
        path = self.root / "src-tauri/tauri.windows.conf.json"
        config = json.loads(path.read_text())
        config["bundle"]["resources"]["../.local/"] = "private/"
        path.write_text(json.dumps(config))
        self.assertEqual(self.preflight().findings[0]["code"], "unexpected-resource-map")

    def test_link_is_rejected_without_following(self):
        target = Path(self.temporary.name) / "synthetic-target"
        target.mkdir()
        (target / "en-US.pak").write_bytes(b"must not be read")
        link = self.engine / "linked"
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            # Junction creation does not need Windows Developer Mode/elevation.
            command = "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:AUDIT_TEST_LINK -Target $env:AUDIT_TEST_TARGET | Out-Null"
            import os
            subprocess.run(["pwsh", "-NoProfile", "-Command", command], check=True,
                           env=os.environ | {"AUDIT_TEST_LINK": str(link), "AUDIT_TEST_TARGET": str(target)})
        result = self.preflight()
        self.assertIn("filesystem-link", [f["code"] for f in result.findings])
        self.assertEqual((target / "en-US.pak").read_bytes(), b"must not be read")

    def test_private_markers_never_appear_in_reports_or_console(self):
        private_marker = "SYNTHETIC_PRIVATE_VALUE_42"
        (self.root / "dist/index.html").write_bytes(private_marker.encode("utf-16le"))
        marker_file = Path(self.temporary.name) / "markers.json"
        marker_file.write_text(json.dumps({"synthetic": private_marker}))
        output = self.root / ".local/audit"
        console = io.StringIO()
        with contextlib.redirect_stdout(console):
            code = audit.main(["--repo-root", str(self.root), "--output-dir", str(output),
                               "--private-markers-file", str(marker_file)])
        self.assertEqual(code, 1)
        for content in (console.getvalue(), *(p.read_text() for p in output.iterdir())):
            self.assertNotIn(private_marker, content)
            self.assertNotIn(str(self.root), content)
        self.assertEqual(json.loads((output / "privacy-audit.json").read_text())["findings"][0]["code"], "private-marker")

    def test_extracted_payload_requires_exact_hashes_and_rejects_extra_data(self):
        expected = [{"path": "claude-local.exe", "sha256": __import__("hashlib").sha256(b"binary").hexdigest()}]
        extracted = Path(self.temporary.name) / "extracted"
        extracted.mkdir()
        (extracted / "claude-local.exe").write_bytes(b"binary")
        result = audit.Audit()
        audit.extracted_payload(extracted, expected, result)
        self.assertEqual(result.findings, [])
        (extracted / "quota_ledger.json").write_bytes(b"synthetic data")
        (extracted / "claude-local.exe").write_bytes(b"changed")
        result = audit.Audit()
        audit.extracted_payload(extracted, expected, result)
        self.assertEqual({f["code"] for f in result.findings}, {"runtime-or-sensitive-name", "payload-hash-mismatch"})

    def test_nsis_patch_hash_still_rejects_every_other_byte_change(self):
        import hashlib
        original = b"synthetic PE prefix" + audit.TAURI_UNBUNDLED_SENTINEL + b"synthetic suffix"
        source = Path(self.temporary.name) / "source.exe"
        source.write_bytes(original)
        entry = {"path": "claude-local.exe", "sha256": hashlib.sha256(original).hexdigest()}
        result = audit.Audit()
        expected = audit.nsis_binary_expectation(source, entry, result)
        extracted = Path(self.temporary.name) / "payload"
        extracted.mkdir()
        payload = extracted / "claude-local.exe"
        payload.write_bytes(original.replace(audit.TAURI_UNBUNDLED_SENTINEL, audit.TAURI_NSIS_SENTINEL))
        audit.extracted_payload(extracted, [expected], result)
        self.assertEqual(result.findings, [])
        self.assertEqual(result.binary_transformations[0]["changed_bytes"], 3)
        self.assertEqual(result.binary_transformations[0]["source_sha256"], entry["sha256"])
        payload.write_bytes(payload.read_bytes() + b"extra arbitrary byte")
        changed = audit.Audit()
        audit.extracted_payload(extracted, [expected], changed)
        self.assertEqual(changed.findings[0]["code"], "payload-hash-mismatch")

    def test_duplicate_or_missing_bundle_sentinel_fails_closed(self):
        import hashlib
        for data in (b"no sentinel", audit.TAURI_UNBUNDLED_SENTINEL * 2):
            with self.subTest(sentinel_count=data.count(audit.TAURI_UNBUNDLED_SENTINEL)):
                source = Path(self.temporary.name) / "duplicate.exe"
                source.write_bytes(data)
                result = audit.Audit()
                audit.nsis_binary_expectation(source, {"sha256": hashlib.sha256(data).hexdigest()}, result)
                self.assertEqual(result.findings[0]["code"], "unexpected-bundle-type-sentinel")
                self.assertEqual(result.binary_transformations, [])

    def test_exact_standard_nsis_auxiliaries_do_not_allow_arbitrary_plugins(self):
        extracted = Path(self.temporary.name) / "plugins"
        plugin_dir = extracted / "$PLUGINSDIR"
        plugin_dir.mkdir(parents=True)
        for name in ("NSISdl.dll", "StartMenu.dll", "modern-wizard.bmp"):
            (plugin_dir / name).write_bytes(b"synthetic standard NSIS resource")
        result = audit.Audit()
        audit.extracted_payload(extracted, [], result)
        self.assertEqual(result.findings, [])
        (plugin_dir / "arbitrary.dll").write_bytes(b"unapproved plugin")
        result = audit.Audit()
        audit.extracted_payload(extracted, [], result)
        self.assertEqual(result.findings[0]["code"], "unexpected-payload-file")


if __name__ == "__main__":
    unittest.main()
