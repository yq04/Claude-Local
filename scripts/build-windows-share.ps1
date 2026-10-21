# [INPUT]: Locked source, pinned clean browser, existing 7-Zip, clean neutral Cargo root and optional external markers.
# [OUTPUT]: Unique ignored installer/SHA-256/privacy reports after read-only NSIS payload verification.
# [POS]: Explicit Windows share build; only public Cargo index/archive cache is seeded, never root config/credentials/src.
# [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing the share boundary.
[CmdletBinding()]
param(
    [string]$SevenZipPath,
    [string]$PrivateMarkersFile,
    [string]$BuildRoot
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function New-FreshDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) { throw 'Refusing to reuse a share staging or output directory.' }
    [IO.Directory]::CreateDirectory($Path) | Out-Null
}

function Assert-NoReparsePoint([string]$Path) {
    $itemPath = [IO.Path]::GetFullPath($Path)
    while ($itemPath) {
        if (Test-Path -LiteralPath $itemPath) {
            $item = Get-Item -LiteralPath $itemPath -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Share inputs and staging directories must not contain links or junctions.'
            }
        }
        $itemPath = [IO.Path]::GetDirectoryName($itemPath)
    }
}

function Test-IsWithin([string]$Path, [string]$Boundary) {
    $relative = [IO.Path]::GetRelativePath($Boundary, $Path)
    return -not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and
        -not $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar)
}

function Copy-PublicRegistryTree([string]$Source, [string]$Destination) {
    Assert-NoReparsePoint $Source
    New-FreshDirectory $Destination
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Public Cargo registry cache contains a link; refusing to seed the neutral build.'
        }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-PublicRegistryTree $item.FullName $target }
        else { [IO.File]::Copy($item.FullName, $target, $false) }
    }
}

if (-not $SevenZipPath) {
    $sevenZipCommand = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($sevenZipCommand) { $SevenZipPath = $sevenZipCommand.Source }
    else {
        foreach ($programRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ($programRoot) {
                $candidate = Join-Path $programRoot '7-Zip/7z.exe'
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { $SevenZipPath = $candidate; break }
            }
        }
    }
}
if (-not $SevenZipPath -or -not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
    throw 'Provide -SevenZipPath pointing to an existing 7z.exe; this script does not install tools.'
}
$SevenZipPath = [IO.Path]::GetFullPath($SevenZipPath)
if ($PrivateMarkersFile) {
    $PrivateMarkersFile = [IO.Path]::GetFullPath($PrivateMarkersFile)
    $relativeMarker = [IO.Path]::GetRelativePath($root, $PrivateMarkersFile)
    if (-not (Test-Path -LiteralPath $PrivateMarkersFile -PathType Leaf) -or
        (-not [IO.Path]::IsPathRooted($relativeMarker) -and $relativeMarker -ne '..' -and
         -not $relativeMarker.StartsWith('..' + [IO.Path]::DirectorySeparatorChar))) {
        throw 'Private marker JSON must exist outside the repository; it is never copied into the artifact.'
    }
}

$unique = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N')
if (-not $BuildRoot) { $BuildRoot = Join-Path ([IO.Path]::GetPathRoot($root)) ('ClaudeLocalBuild/' + $unique) }
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
if ((Test-IsWithin $BuildRoot $root) -or
    ($env:USERPROFILE -and (Test-IsWithin $BuildRoot ([IO.Path]::GetFullPath($env:USERPROFILE))))) {
    throw 'BuildRoot must be a new neutral directory outside the workspace and USERPROFILE.'
}
Assert-NoReparsePoint $BuildRoot
New-FreshDirectory $BuildRoot
$neutralCargoHome = Join-Path $BuildRoot 'cargo-home'
$neutralTarget = Join-Path $BuildRoot 'target'
New-FreshDirectory $neutralCargoHome
$originalCargoHome = [Environment]::GetEnvironmentVariable('CARGO_HOME', 'Process')
if (-not $originalCargoHome) {
    if (-not $env:USERPROFILE) { throw 'USERPROFILE or an explicit CARGO_HOME is required to locate public registry cache.' }
    $originalCargoHome = Join-Path $env:USERPROFILE '.cargo'
}
$originalCargoHome = [IO.Path]::GetFullPath($originalCargoHome)
# Copy only crates.io index/archive trees. Never enumerate Cargo's root config,
# credentials, bin or registry/src. Cargo verifies archived crates and re-extracts
# their native C/C++ sources under this neutral root instead of a personal path.
foreach ($kind in @('index', 'cache')) {
    foreach ($sourceName in @('index.crates.io-1949cf8c6b5b557f', 'github.com-1ecc6299db9ec823')) {
        $publicSource = Join-Path $originalCargoHome ('registry/' + $kind + '/' + $sourceName)
        if (Test-Path -LiteralPath $publicSource -PathType Container) {
            Copy-PublicRegistryTree $publicSource (Join-Path $neutralCargoHome ('registry/' + $kind + '/' + $sourceName))
        }
    }
}
$staging = Join-Path $root ('.local/releases/build-' + $unique)
$extracted = Join-Path $root ('.local/releases/extracted-' + $unique)
$auditOutput = Join-Path $staging 'audit'
$artifactOutput = Join-Path $root ('.local/artifacts/' + $unique)
$nsisDirectory = Join-Path $root 'src-tauri/target/release/bundle/nsis'
$binary = Join-Path $root 'src-tauri/target/release/claude-local.exe'
$neutralNsisDirectory = Join-Path $neutralTarget 'release/bundle/nsis'
$neutralBinary = Join-Path $neutralTarget 'release/claude-local.exe'
foreach ($path in @($staging, $extracted, $artifactOutput, $nsisDirectory, $binary)) { Assert-NoReparsePoint $path }
New-FreshDirectory $staging
$oldInstallers = @(Get-ChildItem -LiteralPath $nsisDirectory -Filter '*setup.exe' -File -ErrorAction SilentlyContinue)
if ($oldInstallers.Count -gt 0) {
    $backup = Join-Path $staging 'previous-installers'
    New-FreshDirectory $backup
    foreach ($installer in $oldInstallers) {
        Assert-NoReparsePoint $installer.FullName
        [IO.File]::Copy($installer.FullName, (Join-Path $backup $installer.Name), $false)
    }
}
if (Test-Path -LiteralPath $binary -PathType Leaf) {
    $hostBackup = Join-Path $staging 'previous-host'
    New-FreshDirectory $hostBackup
    [IO.File]::Copy($binary, (Join-Path $hostBackup 'claude-local.exe'), $false)
}

$savedEnvironment = @{}
foreach ($name in @('CARGO_ENCODED_RUSTFLAGS', 'CARGO_HOME', 'CARGO_TARGET_DIR')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$previousEncodedFlags = $savedEnvironment['CARGO_ENCODED_RUSTFLAGS']
$flagSeparator = [string][char]0x1f
$flags = [Collections.Generic.List[string]]::new()
if ($null -ne $previousEncodedFlags) {
    foreach ($flag in $previousEncodedFlags.Split([char]0x1f)) { if ($flag) { $flags.Add($flag) } }
} elseif ($env:RUSTFLAGS) {
    # Cargo splits RUSTFLAGS on whitespace; encoded flags preserve each argument afterwards.
    foreach ($flag in ($env:RUSTFLAGS -split '\s+')) { if ($flag) { $flags.Add($flag) } }
}
$remaps = [ordered]@{}
if ($env:USERPROFILE) { $remaps[[IO.Path]::GetFullPath($env:USERPROFILE)] = '/build/user' }
$remaps[$root] = '/build/claude-local'
$remaps[$BuildRoot] = '/build/neutral'
foreach ($prefix in $remaps.Keys) {
    foreach ($variant in @($prefix.Replace('\', '/'), $prefix.Replace('/', '\')) | Select-Object -Unique) {
        $flags.Add('--remap-path-prefix=' + $variant + '=' + $remaps[$prefix])
    }
}
$buildStarted = [DateTime]::UtcNow
Push-Location $root
try {
    [Environment]::SetEnvironmentVariable('CARGO_ENCODED_RUSTFLAGS', ($flags -join $flagSeparator), 'Process')
    [Environment]::SetEnvironmentVariable('CARGO_HOME', $neutralCargoHome, 'Process')
    [Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', $neutralTarget, 'Process')
    & bun run tauri build --config src-tauri/tauri.windows.conf.json --features custom-protocol --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Windows NSIS build failed; previous installers remain in ignored backup staging.' }
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    Pop-Location
}

$installers = @(Get-ChildItem -LiteralPath $neutralNsisDirectory -Filter '*setup.exe' -File |
    Where-Object LastWriteTimeUtc -GE $buildStarted)
if ($installers.Count -ne 1) { throw 'Expected exactly one freshly generated Windows NSIS setup executable.' }
$installer = $installers[0]
Assert-NoReparsePoint $installer.FullName
Assert-NoReparsePoint $neutralBinary
if (-not (Test-Path -LiteralPath $neutralBinary -PathType Leaf)) { throw 'Missing host in the neutral Cargo target.' }
# Previous fixed outputs were backed up above. Keep the repository's conventional
# deployment/CI locations current without using them as compilation inputs.
if (-not (Test-Path -LiteralPath $nsisDirectory)) { New-Item -ItemType Directory -Path $nsisDirectory | Out-Null }
[IO.File]::Copy($neutralBinary, $binary, $true)
[IO.File]::Copy($installer.FullName, (Join-Path $nsisDirectory $installer.Name), $true)
New-FreshDirectory $extracted
# Extraction reads the installer as an archive. Never execute the installer or uninstaller.
& $SevenZipPath x -y ('-o' + $extracted) $installer.FullName | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Read-only NSIS payload extraction failed.' }
$auditArgs = @((Join-Path $PSScriptRoot 'audit-windows-package.py'), '--repo-root', $root,
    '--binary', $binary, '--extracted-root', $extracted, '--output-dir', $auditOutput)
if ($PrivateMarkersFile) { $auditArgs += @('--private-markers-file', $PrivateMarkersFile) }
& python @auditArgs
if ($LASTEXITCODE -ne 0) { throw 'Extracted payload privacy audit failed; no share artifact was published.' }

New-FreshDirectory $artifactOutput
$destination = Join-Path $artifactOutput $installer.Name
[IO.File]::Copy($installer.FullName, $destination, $false)
foreach ($name in @('privacy-audit.json', 'resource-manifest.json')) {
    [IO.File]::Copy((Join-Path $auditOutput $name), (Join-Path $artifactOutput $name), $false)
}
$sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = Join-Path $artifactOutput 'SHA256SUMS.txt'
$checksumStream = [IO.File]::Open($checksumPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $checksumBytes = [Text.UTF8Encoding]::new($false).GetBytes($sha256 + '  ' + $installer.Name + "`n")
    $checksumStream.Write($checksumBytes)
} finally { $checksumStream.Dispose() }
[ordered]@{
    artifactDirectory = $artifactOutput
    installer = $destination
    sha256 = $sha256
    checksums = $checksumPath
    privacyAudit = Join-Path $artifactOutput 'privacy-audit.json'
    resourceManifest = Join-Path $artifactOutput 'resource-manifest.json'
} | ConvertTo-Json -Compress
