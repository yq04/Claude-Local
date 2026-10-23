#!/usr/bin/env python3
# [INPUT]: --runtime-info only; no account, HOME, vault, configuration or network inputs.
# [OUTPUT]: Bounded JSON interpreter capability report for the isolated -E -s runtime.
# [POS]: No-account runtime probe; performs no writes and imports no product modules.
# [PROTOCOL]: Update scripts/CLAUDE.md when changing capability fields.
"""Report whether this interpreter can run Claude-Local quota helpers."""
import importlib.util
import importlib
import json
import platform
import sys
import tarfile

SCHEMA = 1


def _cryptography_usable():
    try:
        if importlib.util.find_spec("cryptography") is None:
            return False
        aesgcm = importlib.import_module("cryptography.hazmat.primitives.ciphers.aead").AESGCM
        key = bytes(range(16))
        nonce = bytes(range(12))
        plaintext = b"claude-local-runtime-probe"
        sealed = aesgcm(key).encrypt(nonce, plaintext, None)
        return aesgcm(key).decrypt(nonce, sealed, None) == plaintext
    except Exception:
        return False


def runtime_info():
    crypto = _cryptography_usable()
    capabilities = {
        "json": True,
        "cryptography": crypto,
        "tarfile": callable(getattr(tarfile, "open", None)),
        "base64": importlib.util.find_spec("base64") is not None,
        "quota_runtime": True,
    }
    version_ok = sys.version_info >= (3, 10)
    compatible = version_ok and capabilities["cryptography"] and capabilities["json"]
    info = {
        "schema": SCHEMA,
        "python": [int(sys.version_info.major), int(sys.version_info.minor), int(sys.version_info.micro)],
        "implementation": platform.python_implementation().lower()[:16],
        "capabilities": capabilities,
        "compatible": compatible,
        "probe_reason": None if compatible else ("missing_dependency" if version_ok else "unsupported_python"),
    }
    return info


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    if argv != ["--runtime-info"]:
        return 2
    sys.stdout.write(json.dumps(runtime_info(), separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
