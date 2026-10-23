# [INPUT]: 已编译的本地版宿主、构建后的 UI、固定浏览器引擎与受控 quota resource manifest。
# [OUTPUT]: 独立安装目录、逐文件资源备份/哈希和专属桌面快捷方式；不写入用户身份数据或配置 statusLine。
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
$resourceManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-resources.json') -Raw | ConvertFrom-Json -AsHashtable
$resourceBackups = [Collections.Generic.List[object]]::new()
try {
    foreach ($mapping in $resourceManifest.resources.GetEnumerator()) {
        $sourceRelative = $mapping.Key -replace '^\.\./', ''
        $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $sourceRelative))
        $destination = [IO.Path]::GetFullPath((Join-Path $installRoot ($mapping.Value -replace '/', '\')))
        if (-not $source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not $destination.StartsWith($installRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Quota resource manifest contains an invalid or missing file.' }
        $parent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        $backup = $null
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $backup = $destination + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
            Copy-Item -LiteralPath $destination -Destination $backup
        }
        $resourceBackups.Add([pscustomobject]@{ Destination = $destination; Backup = $backup })
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) {
            throw 'Quota resource hash mismatch.'
        }
    }
} catch {
    foreach ($item in $resourceBackups) {
        if ($item.Backup) { Copy-Item -LiteralPath $item.Backup -Destination $item.Destination -Force }
        elseif (Test-Path -LiteralPath $item.Destination -PathType Leaf) { Remove-Item -LiteralPath $item.Destination }
    }
    throw
}
$collectorDestination = Join-Path $installRoot 'scripts\claude_quota.py'
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
