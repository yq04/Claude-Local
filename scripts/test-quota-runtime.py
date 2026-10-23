#!/usr/bin/env python3
# [INPUT]: Isolated --runtime-info invocation with no account or HOME arguments.
# [OUTPUT]: Runtime probe schema, bounds and read-only capability checks.
# [POS]: Synthetic runtime probe regression; no network or product data.
# [PROTOCOL]: Update scripts/CLAUDE.md when changing probe capabilities.
import json
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("quota_runtime.py")
SPEC = importlib.util.spec_from_file_location("quota_runtime_test_module", SCRIPT)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class QuotaRuntimeTests(unittest.TestCase):
    def test_runtime_info_is_bounded_and_has_fixed_capabilities(self):
        result = subprocess.run([sys.executable, "-E", "-s", str(SCRIPT), "--runtime-info"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=5, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertLessEqual(len(result.stdout), 1024)
        info = json.loads(result.stdout)
        self.assertEqual(info["schema"], 1)
        self.assertIsInstance(info["compatible"], bool)
        self.assertIn("cryptography", info["capabilities"])
        self.assertIn("tarfile", info["capabilities"])
        self.assertNotIn("path", info)
        self.assertNotIn("account", info)

    def test_business_arguments_are_rejected(self):
        result = subprocess.run([sys.executable, "-E", "-s", str(SCRIPT), "--app-data", "synthetic"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=5, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")

    def test_discoverable_but_unimportable_cryptography_is_rejected(self):
        with patch.object(RUNTIME.importlib.util, "find_spec", return_value=object()), \
             patch.object(RUNTIME.importlib, "import_module", side_effect=ImportError("synthetic backend unavailable")):
            self.assertFalse(RUNTIME._cryptography_usable())


if __name__ == "__main__":
    unittest.main()
