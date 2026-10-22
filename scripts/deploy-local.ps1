# [INPUT]: 已编译的本地版宿主、构建后的 UI 与固定 Windows 浏览器引擎。
# [OUTPUT]: 独立安装目录、原有本地程序/采集脚本备份和专属桌面快捷方式；不写入用户身份数据或配置 statusLine。
# [POS]: Windows 本地部署入口；拒绝运行中的本地宿主，不结束 Claude，不调用官方安装/更新器。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Claude-Local'))
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
if (-not [IO.Path]::IsPathRooted($InstallDirectory) -or $installRoot -eq [IO.Path]::GetPathRoot($installRoot)) {
    throw 'Use a dedicated absolute installation directory.'
}
$binary = Join-Path $projectRoot 'src-tauri\target\release\claude-local.exe'
$engine = Join-Path $projectRoot 'browser-runtime\WindowsBrowser'
foreach ($required in @($binary, (Join-Path $engine 'chrome.exe'), (Join-Path $projectRoot 'dist\browser.html'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Build resource missing: $required" }
}
if (Get-Process -Name 'claude-local' -ErrorAction SilentlyContinue) { throw 'Quit Claude-Local before deploying.' }
if (Test-Path -LiteralPath $installRoot) {
    if ((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked install directory refused.' }
    if (Get-ChildItem -LiteralPath $installRoot -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Linked install contents refused.' }
    $installed = Join-Path $installRoot 'claude-local.exe'
    if (Test-Path -LiteralPath $installed) {
        Copy-Item -LiteralPath $installed -Destination ($installed + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
} else { New-Item -ItemType Directory -Path $installRoot | Out-Null }
foreach ($folder in @('browser-runtime', 'browser-runtime\icons', 'browser-ui', 'licenses', 'scripts')) {
    New-Item -ItemType Directory -Path (Join-Path $installRoot $folder) -Force | Out-Null
}
Copy-Item -LiteralPath $engine -Destination (Join-Path $installRoot 'browser-runtime') -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') | Copy-Item -Destination (Join-Path $installRoot 'browser-ui') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'browser-runtime\version.txt') -Destination (Join-Path $installRoot 'browser-runtime\version.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'browser-runtime\icons\browser.ico') -Destination (Join-Path $installRoot 'browser-runtime\icons\browser.ico') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'browser-runtime\LICENSE.fingerprint-chromium') -Destination (Join-Path $installRoot 'browser-runtime\LICENSE.fingerprint-chromium') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\ai-icons\LICENSE.lobehub.txt') -Destination (Join-Path $installRoot 'licenses\LICENSE.lobehub.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\windows\LICENSE.unicode.txt') -Destination (Join-Path $installRoot 'licenses\LICENSE.unicode.txt') -Force
Copy-Item -LiteralPath $binary -Destination (Join-Path $installRoot 'claude-local.exe') -Force
$collectorDestination = Join-Path $installRoot 'scripts\claude_quota.py'
if (Test-Path -LiteralPath $collectorDestination -PathType Leaf) {
    Copy-Item -LiteralPath $collectorDestination -Destination ($collectorDestination + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\claude_quota.py') -Destination $collectorDestination -Force
$sourceHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath (Join-Path $installRoot 'claude-local.exe') -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Installed binary hash mismatch.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutShell = New-Object -ComObject WScript.Shell
foreach ($entry in @(
    @('Claude-Local', '', (Join-Path $installRoot 'claude-local.exe')),
    @('Claude-Local Browser', '--browser', (Join-Path $installRoot 'browser-runtime\icons\browser.ico'))
)) {
    $shortcut = $shortcutShell.CreateShortcut((Join-Path $desktop ($entry[0] + '.lnk')))
    $shortcut.TargetPath = Join-Path $installRoot 'claude-local.exe'
    $shortcut.Arguments = $entry[1]
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.IconLocation = "$($entry[2]),0"
    $shortcut.Description = 'Independent local Claude-Local edition'
    $shortcut.Save()
}
Write-Output "Claude-Local deployed: $installRoot"
Write-Output "SHA256: $sourceHash"
