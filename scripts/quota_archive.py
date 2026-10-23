# [INPUT]: BAGAID01 archive, existing vault key and version-1 source manifest.
# [OUTPUT]: In-memory account/OAuth/settings projection; no extracted files or project parsing.
# [POS]: Bounded, authenticated online archive reader; legacy collector shares strict framing.
# [PROTOCOL]: Update scripts/CLAUDE.md and runtime-resources.json when changing this boundary.
"""Read only online account evidence. Decrypted bytes never enter a temporary file."""
from __future__ import annotations

import base64
import gzip
import io
import json
import os
import re
import stat
import subprocess
import tarfile
import threading
import time
import zlib
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

MAX_COMPRESSED = 128 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024
MAX_MEMBERS = 100_000
MAX_SOURCES = 1024
TIME_LIMIT = 30
PROXY_KEYS = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy",
              "NO_PROXY", "no_proxy")


def _check(deadline):
    if deadline is not None and time.monotonic() >= deadline:
        raise TimeoutError("archive deadline exceeded")


def _exact(stream, length):
    result = bytearray()
    while len(result) < length:
        part = stream.read(length - len(result))
        if not part:
            raise ValueError("truncated authenticated archive")
        result.extend(part)
    return bytes(result)


def authenticated_chunks(stream, master_key, *, limit=None, deadline=None):
    """Match Rust codec.rs: exact bounded frames, required empty tag, no trailing byte."""
    if len(master_key) != 32:
        raise ValueError("invalid archive key")
    magic = _exact(stream, 8)
    if magic != b"BAGAID01":
        raise ValueError("invalid archive magic")
    nonce = _exact(stream, 12)
    try:
        key = AESGCM(master_key).decrypt(nonce, _exact(stream, 48), magic)
    except InvalidTag as exc:
        raise ValueError("archive authentication failed") from exc
    if len(key) != 32:
        raise ValueError("invalid archive data key")
    aes = AESGCM(key)
    counter = total = 0
    while True:
        _check(deadline)
        header = _exact(stream, 4)
        size = int.from_bytes(header, "big")
        if not 16 <= size <= 65552:
            raise ValueError("invalid archive frame size")
        try:
            plain = aes.decrypt(b"\0" * 4 + counter.to_bytes(8, "big"), _exact(stream, size), header)
        except InvalidTag as exc:
            raise ValueError("archive authentication failed") from exc
        counter += 1
        if counter >= 2**64:
            raise ValueError("archive frame counter overflow")
        if not plain:
            if stream.read(1):
                raise ValueError("trailing archive data")
            return
        total += len(plain)
        if limit is not None and total > limit:
            raise ValueError("compressed archive exceeds limit")
        yield plain


class _BoundedReader:
    def __init__(self, stream, deadline):
        self.stream, self.deadline, self.total = stream, deadline, 0

    def read(self, size=-1):
        _check(self.deadline)
        data = self.stream.read(min(65536, size) if size >= 0 else 65536)
        self.total += len(data)
        if self.total > MAX_EXPANDED:
            raise ValueError("expanded archive exceeds limit")
        return data


class _BoundedTarInfo(tarfile.TarInfo):
    @classmethod
    def frombuf(cls, buf, encoding, errors):
        member = super().frombuf(buf, encoding, errors)
        # Bound extension headers before tarfile can allocate their entire body.
        if member.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME,
                           tarfile.GNUTYPE_LONGLINK) and member.size > MAX_JSON:
            raise ValueError("archive metadata exceeds limit")
        return member


def _member_name(member):
    name = member.name
    parts = name.rstrip("/").split("/")
    if (not name or len(name) > 4096 or "\\" in name or ":" in name
            or any(p in ("", ".", "..") for p in parts)
            or any(ord(c) < 32 for c in name) or not (member.isfile() or member.isdir())
            or member.sparse is not None):
        raise ValueError("unsafe archive member")
    return "/".join(parts)


def _scan_stream(stream, wanted, deadline):
    bounded = _BoundedReader(stream, deadline)
    selected, seen = {}, set()
    # tarfile streaming skips bodies in fixed buffers and never extracts to disk.
    with tarfile.open(fileobj=bounded, mode="r|", bufsize=65536, tarinfo=_BoundedTarInfo) as archive:
        for member in archive:
            _check(deadline)
            name = _member_name(member)
            if name in seen or len(seen) >= MAX_MEMBERS:
                raise ValueError("duplicate or excessive archive members")
            seen.add(name)
            if name in wanted:
                if not member.isfile() or member.size > MAX_JSON:
                    raise ValueError("archive configuration exceeds limit")
                value = json.loads(archive.extractfile(member).read(MAX_JSON + 1).decode("utf-8"))
                if not isinstance(value, dict):
                    raise ValueError("archive configuration is not an object")
                selected[name] = value
    # Consume remainder: compression checksums and total expansion are also bounded.
    while bounded.read(65536):
        pass
    return selected


def _scan(compressed, wanted, deadline):
    if compressed.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            return _scan_stream(stream, wanted, deadline)
    if not compressed.startswith(b"\x28\xb5\x2f\xfd"):
        raise ValueError("unsupported archive compression")
    # Windows libarchive supports Zstd. @- converts stdin to an uncompressed tar
    # stream (verified against bundled Windows bsdtar); no -xf or filesystem output.
    tar = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "tar.exe"
    if os.name != "nt" or not tar.is_file():
        raise RuntimeError("Zstd archive reader unavailable")
    process = subprocess.Popen([str(tar), "-cf", "-", "@-"], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    errors, diagnostics = [], bytearray()

    def feed():
        try:
            for offset in range(0, len(compressed), 65536):
                _check(deadline)
                process.stdin.write(compressed[offset:offset + 65536])
        except (OSError, TimeoutError) as exc:
            errors.append(exc)
        finally:
            process.stdin.close()

    def stderr():
        while data := process.stderr.read(4096):
            if len(diagnostics) < 8192:
                diagnostics.extend(data)
            else:
                process.kill()
                errors.append(ValueError("archive diagnostics exceed limit"))
                break

    threads = [threading.Thread(target=feed, daemon=True), threading.Thread(target=stderr, daemon=True)]
    for thread in threads:
        thread.start()
    timer = threading.Timer(max(0.001, deadline - time.monotonic()), process.kill)
    timer.start()
    try:
        result = _scan_stream(process.stdout, wanted, deadline)
        process.wait(timeout=max(0.001, deadline - time.monotonic()))
        for thread in threads:
            thread.join(timeout=max(0.001, deadline - time.monotonic()))
        # bsdtar may warn about empty Rust tar uname/gname. Every other warning
        # fails closed, including path sanitization during archive conversion.
        warnings = diagnostics.decode("utf-8", errors="replace").splitlines()
        if process.returncode or errors or any(
                not re.fullmatch(r".*: Can't translate [ug]name '\(null\)' to UTF-8", line)
                for line in warnings):
            raise ValueError("archive conversion failed")
        _check(deadline)
        return result
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
        process.wait()
        for pipe in (process.stdin, process.stdout, process.stderr):
            pipe.close()
        for thread in threads:
            thread.join(timeout=1)


def proxy_fields(settings):
    env = settings.get("env", {})
    # Windows environment names are case insensitive; canonicalization also
    # ensures lowercase settings.local values override uppercase settings values.
    return {key.upper(): env[key] if isinstance(env, dict) and key in env else settings["env." + key]
            for key in reversed(PROXY_KEYS) if (isinstance(env, dict) and key in env) or "env." + key in settings}


def _read_online_identity(vault, archive, master_key=None):
    """Return (account config, OAuth credentials, proxy fields) entirely in memory."""
    vault = Path(vault)
    if not re.fullmatch(r"[0-9a-f]{32}\.baga", archive):
        raise ValueError("unsafe archive selector")
    path = vault / archive
    for item in [path, vault / "key.bin"]:
        for parent in [item, *item.parents]:
            info = parent.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("unsafe archive path")
        if not item.is_file():
            raise ValueError("invalid archive file")
    if master_key is None:
        with (vault / "key.bin").open("rb") as key_file:
            master_key = key_file.read(33)
    if len(master_key) != 32:
        raise ValueError("invalid archive key")
    deadline = time.monotonic() + TIME_LIMIT
    with path.open("rb") as stream:
        compressed = b"".join(authenticated_chunks(stream, master_key, limit=MAX_COMPRESSED, deadline=deadline))
    manifest = _scan(compressed, {"manifest.json"}, deadline).get("manifest.json", {})
    sources, home = manifest.get("sources"), manifest.get("home")
    if manifest.get("version") != 1 or not isinstance(home, str) or not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise ValueError("invalid archive manifest")
    home = home.replace("\\", "/").rstrip("/").casefold()
    names = {home + suffix: kind for suffix, kind in (
        ("/.claude.json", "account"), ("/.claude/.credentials.json", "credential"),
        ("/.claude/settings.json", "settings"), ("/.claude/settings.local.json", "local"))}
    targets, kinds = {}, set()
    for index, source in enumerate(sources):
        if not isinstance(source, dict) or not isinstance(source.get("path"), str):
            raise ValueError("invalid archive source")
        kind = names.get(source["path"].replace("\\", "/").casefold())
        if kind:
            if kind in kinds:
                raise ValueError("duplicate archive source mapping")
            kinds.add(kind)
            targets[f"data/{index}"] = kind
    selected = _scan(compressed, set(targets), deadline)
    if set(selected) != set(targets):
        raise ValueError("missing archive configuration")
    result = {kind: selected.get(member, {}) for member, kind in targets.items()}
    credentials = result.get("credential", {})
    # Preserve the existing cross-platform keychain representation, when present.
    if not credentials:
        entries = manifest.get("credentials", [])
        if not isinstance(entries, list):
            raise ValueError("invalid credential manifest")
        matches = [entry for entry in entries if isinstance(entry, dict)
                   and entry.get("service") == "Claude Code-credentials"]
        if len(matches) > 1:
            raise ValueError("duplicate OAuth credential mapping")
        if matches:
            raw = base64.b64decode(matches[0].get("data", ""), validate=True)
            if len(raw) > MAX_JSON:
                raise ValueError("credential exceeds limit")
            credentials = json.loads(raw)
    if not isinstance(credentials, dict):
        raise ValueError("invalid OAuth credential")
    route = proxy_fields(result.get("settings", {}))
    route.update(proxy_fields(result.get("local", {})))
    cj = result.get("account", {})
    return {key: cj[key] for key in ("oauthAccount", "cachedUsageUtilization") if key in cj}, \
        {"claudeAiOauth": credentials.get("claudeAiOauth")}, route


def read_online_identity(vault, archive, master_key=None):
    try:
        return _read_online_identity(vault, archive, master_key)
    except (tarfile.TarError, EOFError, UnicodeError, zlib.error) as exc:
        raise ValueError("invalid archive projection") from exc
