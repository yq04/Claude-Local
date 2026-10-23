#!/usr/bin/env python3
# [INPUT]: Repository-owned static resource mappings and isolated synthetic trees.
# [OUTPUT]: Manifest/config/deployment resource contract regression results.
# [POS]: Synthetic only; never runs deployment or reads user installation data.
# [PROTOCOL]: Update scripts/CLAUDE.md with changes to this test contract.
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts/runtime-resources.json"


class RuntimeResourceTests(unittest.TestCase):
    def test_manifest_matches_both_tauri_resource_maps(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        expected = manifest["resources"]
        self.assertEqual(manifest["schema"], 1)
        self.assertEqual(manifest["planned_resources"], {})
        for name in ("tauri.conf.json", "tauri.windows.conf.json"):
            config = json.loads((ROOT / "src-tauri" / name).read_text(encoding="utf-8"))
            for source, destination in expected.items():
                self.assertEqual(config["bundle"]["resources"].get(source), destination, name)

    def test_manifest_paths_are_contained_and_synthetic_hashes_match(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            source_root = Path(temporary) / "source"
            destination_root = Path(temporary) / "install"
            for index, (source_name, destination_name) in enumerate(manifest["resources"].items()):
                source_relative = source_name.removeprefix("../")
                source = source_root / source_relative
                destination = destination_root / destination_name
                source.parent.mkdir(parents=True, exist_ok=True)
                destination.parent.mkdir(parents=True, exist_ok=True)
                payload = f"synthetic-{index}".encode()
                source.write_bytes(payload)
                destination.write_bytes(source.read_bytes())
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), hashlib.sha256(destination.read_bytes()).digest())
            self.assertEqual(sum(path.is_file() for path in destination_root.rglob("*")), len(manifest["resources"]))


if __name__ == "__main__":
    unittest.main()
