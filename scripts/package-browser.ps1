# [INPUT]: Windows Chromium 引擎。
# [OUTPUT]: 验证 Windows 引擎与版本元数据。
# [POS]: Windows 构建前置检查，不包含 SSH、资料读取或部署。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
if (-not (Test-Path "browser-runtime\WindowsBrowser\chrome.exe")) {
    python scripts/fetch-browser.py
}
$v1 = (Get-Content "browser-runtime\WindowsBrowser\version.txt").Trim()
$v2 = (Get-Content "browser-runtime\version.txt").Trim()
if ($v1 -ne $v2) {
    throw "Engine version mismatch: $v1 vs $v2"
}
Write-Output "Windows browser engine package verified."
