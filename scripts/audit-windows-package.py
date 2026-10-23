#!/usr/bin/env python3
# [INPUT]: Fixed Windows Tauri resources including both public quota collectors, optional extracted NSIS payload and caller-owned marker file.
# [OUTPUT]: Relative-path SHA-256 manifest and privacy findings in a caller-selected ignored directory.
# [POS]: Read-only release boundary; never reads live profiles, installs software or deletes source files.
# [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing the packaging boundary.
"""Fail closed on runtime data, unexpected resource mappings and filesystem links.

Run after the frontend build. Optional --extracted-root must be the result of
7z extraction into a fresh directory, never an installed application directory.
Markers are optional JSON {"safe_label": "private text"} stored outside the repo;
their text is never included in reports. This is a build-input audit, not a
claim that filename checks can detect all arbitrary private content.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

RESOURCE_MAP = {
    "../dist/": "browser-ui/",
    "../browser-runtime/version.txt": "browser-runtime/version.txt",
    "../browser-runtime/LICENSE.fingerprint-chromium": "browser-runtime/LICENSE.fingerprint-chromium",
    "../assets/ai-icons/LICENSE.lobehub.txt": "licenses/LICENSE.lobehub.txt",
    "../LICENSE": "licenses/LICENSE.txt",
    "../NOTICE.md": "licenses/NOTICE.md",
    "../browser-runtime/WindowsBrowser/": "browser-runtime/WindowsBrowser/",
    "../browser-runtime/icons/browser.ico": "browser-runtime/icons/browser.ico",
    "windows/LICENSE.unicode.txt": "licenses/LICENSE.unicode.txt",
}


def load_resource_manifest(root):
    manifest = json.loads((root / "scripts/runtime-resources.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != 1 or not isinstance(manifest.get("resources"), dict):
        raise ValueError("invalid runtime resource manifest")
    resources = manifest["resources"]
    if set(resources) & set(manifest.get("planned_resources", {})):
        raise ValueError("active and planned runtime resources overlap")
    return resources
ENGINE_FILES = {
    "chrome.exe", "chrome.dll", "chrome_elf.dll", "chrome_wer.dll", "chrome_proxy.exe",
    "chrome_pwa_launcher.exe", "chrome_100_percent.pak", "chrome_200_percent.pak",
    "d3dcompiler_47.dll", "dxcompiler.dll", "dxil.dll", "elevated_tracing_service.exe",
    "elevation_service.exe", "notification_helper.exe", "icudtl.dat", "libegl.dll",
    "libglesv2.dll", "resources.pak", "v8_context_snapshot.bin", "version.txt",
    "vk_swiftshader_icd.json", "vk_swiftshader.dll", "vulkan-1.dll", "first run",
    "license", "license.txt", "credits.html", "chrome_credits.html",
}
RUNTIME_NAMES = {
    "appdata", ".local", "identity-vault", "key.bin", "cookies", "login data",
    "local state", "preferences", "secure preferences", "web data", "history",
    "user data", "user-data", "default", "profiles", "profile", "cache", "code cache",
    "gpucache", "sessions", "session storage", "local storage", "indexeddb", "logs",
    "crashpad", "crash reports", "debug.log", ".claude.json", ".quota-writer.lock",
}
NSIS_AUXILIARIES = {
    "$pluginsdir/system.dll", "$pluginsdir/nsdialogs.dll", "$pluginsdir/nsis_tauri_utils.dll",
    "$pluginsdir/microsoftedgewebview2setup.exe", "$pluginsdir/webview2loader.dll",
    # Generated installer.nsi invokes NSISdl and Modern UI 2 StartMenu/Welcome pages.
    "$pluginsdir/nsisdl.dll", "$pluginsdir/startmenu.dll", "$pluginsdir/modern-wizard.bmp",
    "uninstall.exe",
}
TAURI_UNBUNDLED_SENTINEL = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
TAURI_NSIS_SENTINEL = b"__TAURI_BUNDLE_TYPE_VAR_NSS"


def linked(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def forbidden(name):
    lower = name.lower()
    return (lower in RUNTIME_NAMES or (lower.startswith("quota_") and lower not in {"quota_runtime.py", "quota_archive.py"})
            or lower.startswith((".env", "profile ", "usage_ledger"))
            or bool(re.search(r"(?:credential|private.*key|token|secret|ledger)", lower))
            or bool(re.search(r"\.(?:sqlite(?:3)?|db)(?:$|[-.])|\.(?:baga|log|key|pem|pfx|p12)$", lower)))


def engine_allowed(relative, directory=False):
    parts = relative.parts
    lower = [p.lower() for p in parts]
    if directory:
        return len(parts) == 1 and lower[0] in {"locales", "iwakeydistribution"}
    if len(parts) == 1:
        return lower[0] in ENGINE_FILES or bool(re.fullmatch(r"\d+(?:\.\d+){3}\.manifest", lower[0]))
    if len(parts) == 2 and lower[0] == "locales":
        return bool(re.fullmatch(r"[a-z]{2,3}(?:-[a-z0-9]+)*\.pak", lower[1]))
    return len(parts) == 2 and lower[0] == "iwakeydistribution" and lower[1] in {"manifest.json", "iwa-key-distribution.pb"}


class Audit:
    def __init__(self, markers=None):
        self.markers = markers or {}
        self.findings = []
        self.files = []
        self.binary_transformations = []

    def safe(self, value):
        value = str(value)
        for marker in self.markers.values():
            value = value.replace(marker, "[private-marker]")
        return value

    def fail(self, code, path):
        self.findings.append({"code": code, "path": self.safe(path)})

    def check_path(self, path, label):
        # Check every existing ancestor before any descent/read, including junctions.
        for item in [path, *path.parents]:
            if item.exists() or item.is_symlink():
                if linked(item):
                    self.fail("filesystem-link", label)
                    return False
        return True

    def file(self, path, label):
        digest = hashlib.sha256()
        patterns = [encoded for value in self.markers.values() for encoded in
                    (value.encode("utf-8"), value.encode("utf-16le"), value.encode("utf-16be"))]
        overlap = max([len(p) for p in patterns] + [1]) - 1
        tail = b""
        found = False
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                digest.update(block)
                sample = tail + block
                found |= any(pattern in sample for pattern in patterns)
                tail = sample[-overlap:] if overlap else b""
        if found:
            self.fail("private-marker", label)
        self.files.append({"path": self.safe(label), "bytes": path.stat().st_size, "sha256": digest.hexdigest()})

    def tree(self, source, destination, engine=False, extracted=False):
        if not self.check_path(source, destination):
            return
        if not source.exists():
            self.fail("missing-input", destination)
            return
        def visit(path, relative):
            label = str(Path(destination) / relative).replace("\\", "/")
            if linked(path):
                self.fail("filesystem-link", label)
                return
            if forbidden(path.name):
                self.fail("runtime-or-sensitive-name", label)
                return
            is_dir = path.is_dir()
            if engine and relative.parts and not engine_allowed(relative, is_dir):
                self.fail("unexpected-engine-entry", label)
                return
            if is_dir:
                for child in sorted(path.iterdir(), key=lambda p: p.name.lower()):
                    visit(child, relative / child.name)
            elif path.is_file():
                if not engine and not extracted and destination == "browser-ui/" and path.suffix.lower() not in {
                    ".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2", ".ttf"
                }:
                    self.fail("unexpected-frontend-entry", label)
                    return
                self.file(path, label)
            else:
                self.fail("unsupported-file-type", label)
        visit(source, Path())


def preflight(root, audit):
    resource_map = RESOURCE_MAP | load_resource_manifest(root)
    config_root = root / "src-tauri"
    merged = {}
    for filename in ("tauri.conf.json", "tauri.windows.conf.json"):
        path = config_root / filename
        if not audit.check_path(path, filename):
            return
        config = json.loads(path.read_text(encoding="utf-8"))
        build = config.get("build", {})
        if ((filename == "tauri.conf.json" or "frontendDist" in build)
                and build.get("frontendDist") != "../dist"):
            audit.fail("unexpected-frontend-dist", filename)
            return
        bundle = config.get("bundle", {})
        if bundle.get("externalBin") or bundle.get("icon") != ["icons/icon.ico", "icons/icon.png"]:
            audit.fail("unexpected-binary-or-icon-input", filename)
            return
        resources = bundle.get("resources", {})
        if not isinstance(resources, dict):
            audit.fail("resource-map-must-be-fixed", filename)
            return
        merged.update(resources)
    if merged != resource_map:
        audit.fail("unexpected-resource-map", "src-tauri/tauri.windows.conf.json")
        return
    for source, destination in resource_map.items():
        audit.tree(config_root / source, destination, engine=source.endswith("WindowsBrowser/"))
    for icon in ("icons/icon.ico", "icons/icon.png"):
        audit.tree(config_root / icon, "build-icons/" + Path(icon).name)
    engine = {entry["path"] for entry in audit.files}
    for needed in ("browser-runtime/WindowsBrowser/chrome.exe", "browser-ui/index.html"):
        if needed not in engine:
            audit.fail("missing-required-resource", needed)


def extracted_payload(source, expected, audit):
    audit.tree(source, "", extracted=True)
    actual = {entry["path"]: entry for entry in audit.files}
    expected = {entry["path"]: entry for entry in expected if not entry["path"].startswith("build-icons/")}
    for name, item in expected.items():
        if name not in actual:
            audit.fail("missing-payload-file", name)
        elif actual[name]["sha256"] != item["sha256"]:
            audit.fail("payload-hash-mismatch", name)
    for name in actual.keys() - expected.keys():
        if name.lower() not in NSIS_AUXILIARIES:
            audit.fail("unexpected-payload-file", name)


def nsis_binary_expectation(source, entry, audit):
    """Hash exactly Tauri's one UNK->NSS patch; do not exempt any executable bytes.

    The bundler temporarily patches the bundle-kind sentinel for NSIS and restores
    the release executable afterwards. Pre-existing NSS constants elsewhere in
    the executable remain untouched. Any missing/duplicate UNK sentinel fails.
    """
    data = source.read_bytes()
    source_hash = hashlib.sha256(data).hexdigest()
    if source_hash != entry["sha256"]:
        audit.fail("binary-changed-during-audit", "claude-local.exe")
        return entry
    if data.count(TAURI_UNBUNDLED_SENTINEL) != 1:
        audit.fail("unexpected-bundle-type-sentinel", "claude-local.exe")
        return entry
    patched = data.replace(TAURI_UNBUNDLED_SENTINEL, TAURI_NSIS_SENTINEL, 1)
    expected_hash = hashlib.sha256(patched).hexdigest()
    audit.binary_transformations.append({
        "path": "claude-local.exe", "transformation": "unique-tauri-bundle-sentinel-UNK-to-NSS",
        "source_sha256": source_hash, "expected_payload_sha256": expected_hash,
        "sentinel_offset": data.index(TAURI_UNBUNDLED_SENTINEL), "changed_bytes": 3,
    })
    return entry | {"sha256": expected_hash}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--binary", type=Path, help="Release claude-local.exe to match against extracted payload")
    parser.add_argument("--extracted-root", type=Path)
    parser.add_argument("--private-markers-file", type=Path)
    args = parser.parse_args(argv)
    repo_root = Path(os.path.abspath(args.repo_root))
    args.repo_root = repo_root
    if args.binary:
        binary = Path(os.path.abspath(args.binary))
        if binary.name != "claude-local.exe" or repo_root / "src-tauri/target" not in binary.parents:
            parser.error("Binary must be claude-local.exe inside src-tauri/target/")
    if args.extracted_root:
        extracted = Path(os.path.abspath(args.extracted_root))
        if not any(parent in extracted.parents for parent in (repo_root / ".local", repo_root / "releases")):
            parser.error("Extracted payload must be staged inside ignored .local/ or releases/")
    markers = {}
    if args.private_markers_file:
        if args.repo_root.resolve() in args.private_markers_file.resolve().parents:
            parser.error("Private marker file must be outside the repository")
        markers = json.loads(args.private_markers_file.read_text(encoding="utf-8"))
        if not isinstance(markers, dict) or any(not isinstance(v, str) or not v for v in markers.values()):
            parser.error("Markers must be a JSON object with nonempty string values")
    audit = Audit(markers)
    preflight(args.repo_root.absolute(), audit)
    if args.binary:
        audit.tree(args.binary, "claude-local.exe")
    if args.extracted_root:
        if not args.binary:
            parser.error("--binary is required with --extracted-root")
        expected = audit.files.copy()
        expected = [nsis_binary_expectation(args.binary, entry, audit)
                    if entry["path"] == "claude-local.exe" else entry for entry in expected]
        audit.files = []
        extracted_payload(args.extracted_root, expected, audit)
    output = Path(os.path.abspath(args.output_dir))
    allowed = (args.repo_root.absolute() / ".local", args.repo_root.absolute() / "releases")
    if not any(output == parent or parent in output.parents for parent in allowed):
        parser.error("Output must be inside the repository's ignored .local/ or releases/ directory")
    if not audit.check_path(output, "audit-output"):
        print("Windows package privacy audit failed: unsafe output location")
        return 1
    output.mkdir(parents=True, exist_ok=True)
    report = {"schema": 1, "result": "pass" if not audit.findings else "fail",
              "mode": "extracted-payload" if args.extracted_root else "build-inputs",
              "file_count": len(audit.files), "bytes": sum(f["bytes"] for f in audit.files),
              "private_marker_count": len(markers), "findings": audit.findings,
              "binary_transformations": audit.binary_transformations,
              "limits": ["No installation/uninstallation or live profile inspection was performed.",
                         "Only fixed build inputs and explicitly supplied extracted files were inspected.",
                         "Arbitrary private content requires caller-supplied markers; names alone cannot prove absence."]}
    for name, value in (("privacy-audit.json", report), ("resource-manifest.json", audit.files)):
        # Never overwrite an existing report: each audit invocation gets its own output directory.
        with (output / name).open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(value, indent=2, ensure_ascii=True) + "\n")
    print(f"Windows package privacy audit: {report['result']}; files={len(audit.files)}; findings={len(audit.findings)}")
    return int(bool(audit.findings))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError):
        # OS exceptions can contain absolute/private paths; keep console output generic.
        print("Windows package privacy audit failed: input/output validation error", file=sys.stderr)
        sys.exit(1)
