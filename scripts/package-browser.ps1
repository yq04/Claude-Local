# [INPUT]: Windows Chromium 引擎。
# [OUTPUT]: 验证 Windows 引擎版本、固定打包资源隐私边界及 ignored 审计报告。
# [POS]: Windows 构建前置检查；拒绝 runtime/profile/凭据污染，不读取真实资料或执行安装。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
if (-not (Test-Path "browser-runtime\WindowsBrowser\chrome.exe")) {
    python scripts/fetch-browser.py
}
$auditOutput = Join-Path $root (".local\package-audits\preflight-" + [guid]::NewGuid().ToString("N"))
python scripts/audit-windows-package.py --output-dir $auditOutput
if ($LASTEXITCODE -ne 0) {
    throw "Package privacy preflight failed; inspect the ignored audit report. Existing inputs were preserved."
}
$v1 = (Get-Content "browser-runtime\WindowsBrowser\version.txt").Trim()
$v2 = (Get-Content "browser-runtime\version.txt").Trim()
if ($v1 -ne $v2) {
    throw "Engine version mismatch: $v1 vs $v2"
}
Write-Output "Windows browser engine package verified."
