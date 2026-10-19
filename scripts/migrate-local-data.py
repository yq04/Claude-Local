#!/usr/bin/env python3
# [INPUT]: 显式绝对源/目标目录、已退出的旧宿主/浏览器与 Windows 当前用户私有 ACL 层。
# [OUTPUT]: 保留源的私有暂存复制、SQLite 完整性/全文件哈希验收和原子公开；失败保留暂存目录。
# [POS]: 一次性本地版资料迁移；不停止进程、不改 Claude 工作区、不覆盖目标、不输出文件正文。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
from contextlib import closing
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import uuid

ASSETS = ("browser", "identity-vault", "quota_ledger.json", "ui-language")
REPARSE_POINT = 0x400
_PRIVATE = None


def private_files():
    global _PRIVATE
    if _PRIVATE is None:
        path = Path(__file__).resolve().parent / "windows_private.py"
        spec = importlib.util.spec_from_file_location("claude-local_migration_private", path)
        _PRIVATE = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_PRIVATE)
    return _PRIVATE


def winpath(path):
    value = str(path)
    if value.startswith("\\\\?\\"):
        return value
    return "\\\\?\\UNC\\" + value[2:] if value.startswith("\\\\") else "\\\\?\\" + value


def private_directory(path):
    if os.name != "nt":
        path.mkdir(mode=0o700)
        return
    private = private_files()
    from ctypes import wintypes

    class Attributes(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("descriptor", ctypes.c_void_p), ("inherit", wintypes.BOOL)]

    descriptor = private.descriptor()
    try:
        attributes = Attributes(ctypes.sizeof(Attributes), descriptor, False)
        create = private.bind(private.k, "CreateDirectoryW", wintypes.BOOL, wintypes.LPCWSTR, ctypes.POINTER(Attributes))
        if not create(winpath(path), ctypes.byref(attributes)):
            raise OSError("Cannot create private migration directory")
    finally:
        private.free(descriptor)
    private.assert_private(winpath(path))


def check_node(path):
    metadata = path.lstat()
    if (stat.S_ISLNK(metadata.st_mode)
            or getattr(metadata, "st_file_attributes", 0) & REPARSE_POINT
            or (stat.S_ISREG(metadata.st_mode) and metadata.st_nlink > 1)):
        raise ValueError("Linked/reparse migration paths are refused")
    if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
        raise ValueError("Special migration files are refused")
    return metadata


def check_parents(path):
    for parent in (path, *path.parents):
        if os.path.lexists(parent):
            metadata = check_node(parent)
            if not stat.S_ISDIR(metadata.st_mode):
                raise ValueError("Migration parent is not a directory")


def absolute_path(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("Migration paths must be absolute without parent traversal")
    return Path(os.path.abspath(path))


def ensure_no_source_processes(source):
    if os.name != "nt":
        return
    script = r"""
$ErrorActionPreference='Stop'
$env:PSModulePath=$PSHOME+'\Modules;'+$env:PSModulePath
$browser=$env:CCBAGA_MIGRATION_BROWSER.Replace('/','\').ToLowerInvariant()
$busy=@(Get-CimInstance Win32_Process | Where-Object {
  @('requirement-french.exe','ccbaga-local.exe','claude-local.exe') -icontains $_.Name -or
  ($_.Name -ieq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Replace('/','\').ToLowerInvariant().Contains($browser))
}).Count -gt 0
if($busy){[Console]::Out.Write('true')}else{[Console]::Out.Write('false')}
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        env=os.environ | {"CCBAGA_MIGRATION_BROWSER": str(source / "browser")},
        capture_output=True, text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode or result.stdout.strip() not in ("true", "false"):
        raise RuntimeError("Cannot verify old host/browser process state")
    if result.stdout.strip() == "true":
        raise RuntimeError("Old host/browser is still running; close it normally before migration")


def digest_file(path):
    before = check_node(path)
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    after = check_node(path)
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise RuntimeError("Source changed while hashing; no destination was published")
    return digest


def snapshot(root):
    result = {}
    for name in ASSETS:
        path = root / name
        if not os.path.lexists(path):
            continue
        pending = [path]
        while pending:
            entry = pending.pop()
            metadata = check_node(entry)
            relative = entry.relative_to(root).as_posix()
            if stat.S_ISDIR(metadata.st_mode):
                result[relative] = ("directory",)
                pending.extend(sorted(entry.iterdir(), reverse=True))
            else:
                result[relative] = ("file", metadata.st_size, digest_file(entry))
    return result


def database_summary(root):
    database = root / "identity-vault/identities.sqlite"
    key = root / "identity-vault/key.bin"
    if not database.is_file() or not key.is_file() or key.stat().st_size != 32:
        raise ValueError("Expected identity database and intact 32-byte vault key")
    for suffix in ("-wal", "-shm", "-journal"):
        if os.path.lexists(str(database) + suffix):
            raise ValueError("SQLite sidecar present; finish all writers/recovery before migration")
    # immutable 禁止 SQLite 在只读验收中创建日志；上层已拒绝全部 sidecar。
    uri = database.as_uri() + "?mode=ro&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("Identity database integrity check failed")
        state_exists = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='state'").fetchone()[0]
        if state_exists and connection.execute("SELECT COUNT(*) FROM state WHERE key='recovery'").fetchone()[0]:
            raise ValueError("Unfinished identity recovery must be resolved before migration")
        count = connection.execute("SELECT COUNT(*) FROM identities WHERE empty=0").fetchone()[0]
        for (archive,) in connection.execute("SELECT archive FROM identities"):
            if not isinstance(archive, str) or Path(archive).name != archive or not (root / "identity-vault" / archive).is_file():
                raise ValueError("Referenced identity archive is missing or invalid")
    return count


def copy_file(source, destination):
    check_node(source)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        if os.name == "nt":
            private_files().protect(winpath(destination))
        with os.fdopen(descriptor, "wb") as target:
            descriptor = None
            with source.open("rb") as origin:
                while block := origin.read(1024 * 1024):
                    target.write(block)
            target.flush()
            os.fsync(target.fileno())
    finally:
        if descriptor is not None:
            os.close(descriptor)


def migrate(source, destination):
    source, destination = absolute_path(source), absolute_path(destination)
    check_parents(source)
    check_parents(destination.parent)
    if not source.is_dir() or not destination.parent.is_dir():
        raise ValueError("Source and destination parent must exist")
    try:
        shared = os.path.commonpath([os.path.normcase(source), os.path.normcase(destination)])
    except ValueError:
        shared = None  # 不同卷也可复制；暂存始终位于目标旁，最后 rename 不跨卷。
    if shared in (os.path.normcase(source), os.path.normcase(destination)):
        raise ValueError("Source and destination must be independent directories")
    if os.path.lexists(destination):
        raise FileExistsError("Destination already exists; migration never overwrites it")
    ensure_no_source_processes(source)
    before = snapshot(source)
    identities = database_summary(source)
    stage = destination.with_name(f".{destination.name}.migrate-{uuid.uuid4().hex}")
    private_directory(stage)
    try:
        for relative, entry in sorted(before.items(), key=lambda item: (len(Path(item[0]).parts), item[0])):
            target = stage / relative
            if entry[0] == "directory":
                private_directory(target)
            else:
                copy_file(source / relative, target)
        ensure_no_source_processes(source)
        after, copied = snapshot(source), snapshot(stage)
        if before != after or before != copied:
            raise RuntimeError("Source changed or copy hashes differ; no destination was published")
        if database_summary(source) != identities or database_summary(stage) != identities:
            raise RuntimeError("Identity counts changed during migration")
        if os.path.lexists(destination):
            raise FileExistsError("Destination appeared during migration; refusing to overwrite it")
        stage.rename(destination)
    except BaseException as error:
        # 暂存包含可恢复私有资料，禁止失败时递归删除。
        raise RuntimeError(f"Migration stopped; source retained, private recovery stage: {stage}") from error
    manifest_hash = hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()
    return {
        "source": str(source), "destination": str(destination),
        "files": sum(entry[0] == "file" for entry in before.values()),
        "saved_identities": identities, "all_hashes_match": True,
        "source_preserved": True, "manifest_sha256": manifest_hash,
    }


def main():
    parser = argparse.ArgumentParser(description="Copy Claude-Local data to a separate local app root; preserve source")
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(migrate(args.source, args.destination), ensure_ascii=False, indent=2))
    except Exception as error:
        print(str(error), file=sys.stderr)
        if error.__cause__:
            # 自有异常只描述状态，SQLite/文件内容与原始系统命令输出均不显示。
            print(type(error.__cause__).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
