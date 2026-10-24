# [INPUT]: 固定 read/update/兼容维护动作、当前用户根目录与原生/npm/bun/WinGet 程序位置。
# [OUTPUT]: 来源/版本和真实完成协议；原方式更新，WinGet 精确无更新码仍核验版本，不卸载、不修改个人资料。
# [POS]: Windows CLI 程序边界；包管理器仅按 PATH 外部程序发现，拒绝链接目录/自定义启动器，保留配置、技能、会话和项目。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
param([ValidateSet('read','update','uninstall','reinstall')][string]$action='read')
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$root=$env:CC_CLI_USER_DIR
if (-not $root) { $root=$env:USERPROFILE }
$root=[IO.Path]::GetFullPath($root)
$package='@anthropic-ai/claude-code'
$native=Join-Path $root '.local\bin\claude.exe'
$versions=Join-Path $root '.local\share\claude\versions'
function Step($message) { Write-Output "CC_CLI_STEP=$message" }
function Fail($message) { throw $message }
function RealPath($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $current=Get-Item -LiteralPath $path -Force
    while ($current) {
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        if ($current -is [IO.FileInfo]) { $current=$current.Directory } else { $current=$current.Parent }
    }
    return $true
}
function InvokeExternal($program, $arguments) {
    $global:LASTEXITCODE=0
    $prev=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        return (& $program @arguments 2>$null)
    } finally {
        $ErrorActionPreference=$prev
    }
}
function Run($program, $arguments) {
    InvokeExternal $program $arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Claude Code 安装命令执行失败。' }
}
function CleanNativeLeftovers {
    $binDir=Split-Path $native -Parent
    if (RealPath $binDir) {
        Get-ChildItem -LiteralPath $binDir -Filter 'claude.exe.old.*' -File -ErrorAction SilentlyContinue | ForEach-Object {
            if (RealPath $_.FullName) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        }
    }
    if ((RealPath $native) -and (RealPath $versions)) {
        $activeItem=Get-Item -LiteralPath $native -Force
        $activeHash=(Get-FileHash -LiteralPath $native -Algorithm SHA256).Hash
        Get-ChildItem -LiteralPath $versions -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+\.\d+\.\d+(\.exe)?$' -and (RealPath $_.FullName) } | ForEach-Object {
            if ($_.Length -ne $activeItem.Length -or (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -ne $activeHash) {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
function NativeInstaller {
    try {
        $content=(Invoke-WebRequest -UseBasicParsing -Uri 'https://claude.ai/install.ps1' -TimeoutSec 60).Content
    } catch { Fail 'Claude Code 官方安装器下载失败，请检查网络后重试。' }
    try {
        if (-not $content -or $content.Length -gt 1048576) { throw 'Invalid installer size' }
        # application/octet-stream 响应的 Content 是 byte[]，不能直接交给 ScriptBlock.Create。
        if ($content -is [byte[]]) {
            $content=(New-Object System.Text.UTF8Encoding($false,$true)).GetString($content)
        } elseif ($content -isnot [string]) { throw 'Invalid installer response type' }
        $content=$content.TrimStart([char]0xfeff)
        if ($content -notmatch '^\s*param\s*\(') { throw 'Invalid installer content' }
        return [scriptblock]::Create($content)
    } catch { Fail 'Claude Code 官方安装器内容无效，已停止操作。' }
}
function Status {
    $methods=New-Object 'System.Collections.Generic.List[string]'
    $managed=New-Object 'System.Collections.Generic.List[string]'
    $nativeFiles=@()
    if (RealPath $versions) {
        $nativeFiles=@(Get-ChildItem -LiteralPath $versions -File | Where-Object { $_.Name -match '^\d+\.\d+\.\d+(\.exe)?$' -and (RealPath $_.FullName) })
    }
    if ((RealPath $native) -and $nativeFiles.Count -gt 0) {
        $nativeLen=(Get-Item -LiteralPath $native -Force).Length
        $hash=(Get-FileHash -LiteralPath $native -Algorithm SHA256).Hash
        $matching=@($nativeFiles | Where-Object { $_.Length -eq $nativeLen -and (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -eq $hash })
        if ($matching.Count -gt 0) { $methods.Add('native');$managed.Add($native) }
    }
    $npm=(Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue).Source
    $npmRoot=''
    if ($npm) {
        $npmRoot=((InvokeExternal $npm @('root','-g')) -join '').Trim()
        if ($LASTEXITCODE -ne 0) { $npmRoot='' }
        $directory=if($npmRoot){Join-Path $npmRoot $package}else{''}
        if ($directory -and (RealPath $directory) -and (Test-Path -LiteralPath (Join-Path $directory 'package.json'))) {
            $metadata=Get-Content -LiteralPath (Join-Path $directory 'package.json') -Raw | ConvertFrom-Json
            if ($metadata.name -eq $package) { $methods.Add('npm') }
        }
    }
    $bun=(Get-Command bun.exe -CommandType Application -ErrorAction SilentlyContinue).Source
    $bunRoot=Join-Path $root '.bun\install\global\node_modules'
    if ($bun -and (RealPath (Join-Path $bunRoot $package))) {
        $meta=Join-Path (Join-Path $bunRoot $package) 'package.json'
        if ((Test-Path -LiteralPath $meta) -and ((Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json).name -eq $package)) { $methods.Add('bun') }
    }
    $winget=(Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue).Source
    $wingetBinary=Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\claude.exe'
    if($winget -and (RealPath $wingetBinary)) { $methods.Add('winget');$managed.Add($wingetBinary) }
    $cli=''
    $command=Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $cli=$command.Source }
    if (-not $cli -and (Test-Path -LiteralPath $native)) { $cli=$native }
    if (-not $cli -and $methods.Contains('npm') -and $npmRoot) {
        $shim=Join-Path (Split-Path $npmRoot -Parent) 'claude.cmd'
        if (Test-Path -LiteralPath $shim) { $cli=$shim }
    }
    if (-not $cli -and $methods.Contains('bun')) {
        $bunCli=Join-Path $root '.bun\bin\claude.exe'
        if (Test-Path -LiteralPath $bunCli) { $cli=$bunCli }
    }
    if (-not $cli -and $methods.Contains('winget')) { $cli=$wingetBinary }
    $known=$false
    if ($cli -and (RealPath $cli)) {
        if ($methods.Contains('native') -and $cli -ieq $native) { $known=$true }
        if ($methods.Contains('npm')) {
            $prefix=Split-Path $npmRoot -Parent
            $shim=Join-Path $prefix 'claude.cmd'
            if ($cli -ieq $shim -and (Get-Content -LiteralPath $shim -Raw).Contains('node_modules\@anthropic-ai\claude-code\cli.js')) { $known=$true;$managed.Add($cli) }
        }
        if ($methods.Contains('bun') -and $cli -ieq (Join-Path $root '.bun\bin\claude.exe')) { $known=$true;$managed.Add($cli) }
    }
    if($methods.Contains('winget') -and $cli) {
        $link=Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.exe'
        if($cli -ieq $wingetBinary) { $known=$true }
        elseif($cli -ieq $link -and (Test-Path -LiteralPath $link)) {
            $destination=(Get-Item -LiteralPath $link -Force).Target
            if($destination -and [IO.Path]::GetFullPath($destination) -ieq $wingetBinary) { $known=$true;$cli=$wingetBinary }
        }
    }
    $version=''
    if ($known) {
        $env:DISABLE_AUTOUPDATER='1'
        try {
            $version=((InvokeExternal $cli @('--version')) -join '').Trim()
        } finally {
            Remove-Item Env:DISABLE_AUTOUPDATER -ErrorAction SilentlyContinue
        }
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+.*Claude') { Fail 'Claude Code 版本核验失败。' }
    }
    return @{methods=$methods;managed=$managed;nativeFiles=$nativeFiles;npm=$npm;bun=$bun;winget=$winget;cli=$cli;known=$known;version=$version}
}
function RemovePrograms($state) {
    if ($state.methods.Contains('npm')) { Run $state.npm @('uninstall','-g',$package) }
    if ($state.methods.Contains('bun')) { Run $state.bun @('remove','-g',$package) }
    if ($state.methods.Contains('winget')) { Run $state.winget @('uninstall','--id','Anthropic.ClaudeCode','--exact','--silent','--disable-interactivity') }
    if ($state.methods.Contains('native')) {
        Remove-Item -LiteralPath $native -Force
        foreach ($file in $state.nativeFiles) { Remove-Item -LiteralPath $file.FullName -Force }
    }
    foreach ($file in $state.managed) { if (Test-Path -LiteralPath $file) { Fail 'Claude Code 卸载未完成，部分程序仍存在。' } }
}
$backupDir=$null
$backupFiles=@()
$backupReady=$false
function RollbackNative {
    if (-not $backupReady -or -not (RealPath $backupDir)) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
    Step '正在回滚恢复先前的 Claude Code 原生程序。'
    foreach ($file in $backupFiles) {
        if (-not (RealPath $file.backup) -or (Get-FileHash -LiteralPath $file.backup -Algorithm SHA256).Hash -ne $file.hash) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
        $parent=Split-Path $file.source -Parent
        $existing=$parent
        while (-not (Test-Path -LiteralPath $existing)) { $existing=Split-Path $existing -Parent; if(-not $existing){Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。'} }
        if (-not (RealPath $existing)) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        if (-not (RealPath $parent)) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
        if ((Get-Item -LiteralPath $file.source -Force -ErrorAction SilentlyContinue) -and -not (RealPath $file.source)) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
        Copy-Item -LiteralPath $file.backup -Destination $file.source -Force
        if ((Get-FileHash -LiteralPath $file.source -Algorithm SHA256).Hash -ne $file.hash) { Fail 'Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
    }
    Remove-Item -LiteralPath $backupDir -Recurse -Force
}

try {
    $state=Status
    if ($action -eq 'update') {
        if (-not $state.known -or -not $state.version) { Fail 'cli.error.notInstalled' }
        if ($state.methods.Count -ne 1) { Fail 'cli.error.multipleInstalls' }
        Step 'cli.progress.updating'
        $method=$state.methods[0]
        if ($method -eq 'native') { InvokeExternal $state.cli @('update') | Out-Null }
        elseif ($method -eq 'npm') { InvokeExternal $state.npm @('install','-g',"$package@latest",'--registry=https://registry.npmjs.org') | Out-Null }
        elseif ($method -eq 'bun') { InvokeExternal $state.bun @('install','-g',"$package@latest",'--registry=https://registry.npmjs.org') | Out-Null }
        elseif ($method -eq 'winget') { InvokeExternal $state.winget @('upgrade','--id','Anthropic.ClaudeCode','--exact','--source','winget','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity') | Out-Null }
        else { Fail 'cli.error.unsupported' }
        # WinGet APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE is a normal no-update result.
        if ($method -eq 'winget' -and $LASTEXITCODE -eq [int]0x8A15002B) {
            Step 'cli.progress.noUpdate'
        } elseif ($LASTEXITCODE -ne 0) { Fail 'cli.error.updateFailed' }
        Step 'cli.progress.verifying'
        $state=Status
        if (-not $state.known -or -not $state.version) { Fail 'cli.error.verifyFailed' }
        if ($method -eq 'native') { CleanNativeLeftovers }
    } elseif ($action -ne 'read') {
        if ($state.cli -and -not $state.known) { Fail '检测到自定义 Claude 启动器，未删除或重装。' }
        $method=if($state.methods.Count){$state.methods[0]}else{'native'}
        $installer=$null
        if ($action -eq 'reinstall' -and $method -eq 'native') {
            Step '正在下载 Claude Code 官方安装器。'
            # 先下载并检查脚本，再卸载；网络或响应异常时不丢失已有程序。
            $installer=NativeInstaller
        }
        if ($action -eq 'reinstall' -and $state.methods.Contains('native')) {
            $parent=Split-Path $versions -Parent
            if (-not (RealPath $parent)) { Fail '无法暂存原程序，未开始重装。' }
            $backupDir=Join-Path $parent ('.reinstall.'+[guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $backupDir | Out-Null
            foreach ($file in @((Get-Item -LiteralPath $native)) + @($state.nativeFiles)) {
                if (-not (RealPath $file.FullName)) { Fail '无法暂存原程序，未开始重装。' }
                $destination=Join-Path $backupDir $(if($file.FullName -ieq $native){'launcher.exe'}else{'version-'+$file.Name})
                $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
                Copy-Item -LiteralPath $file.FullName -Destination $destination
                if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $hash) { Fail '无法暂存原程序，未开始重装。' }
                $backupFiles+=@{source=$file.FullName;backup=$destination;hash=$hash}
            }
            $backupReady=$true
        }
        Step '正在卸载 Claude Code CLI。'
        RemovePrograms $state
        if ($action -eq 'reinstall') {
            Step '正在重装 Claude Code CLI。'
            if ($method -eq 'npm') { Run $state.npm @('install','-g',"$package@latest") }
            elseif ($method -eq 'winget') { Run $state.winget @('install','--id','Anthropic.ClaudeCode','--exact','--source','winget','--scope','user','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity') }
            elseif ($method -eq 'bun') { Run $state.bun @('install','-g',"$package@latest") }
            else {
                Step '正在使用官方 Claude Code 安装器。'
                try {
                    $global:LASTEXITCODE=0
                    & $installer | Out-Null
                    if ($LASTEXITCODE -ne 0) { throw 'Native installer failed' }
                } catch { Fail 'Claude Code 原生重装失败，请检查网络和安装目录权限。' }
            }
            Step '正在核验 Claude Code CLI 版本。'
            $state=Status
            if (-not $state.known -or -not $state.version) { Fail 'Claude Code 重装后的版本核验失败。' }
            $backupReady=$false
            if ($backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
        } else { $state=Status;if($state.methods.Count){Fail 'Claude Code 卸载未完成。'} }
    }
    Write-Output "CC_CLI_METHOD=$($state.methods -join ' / ')"
    Write-Output "CC_CLI_PATH=$($state.cli)"
    Write-Output "CC_CLI_VERSION=$($state.version)"
    Write-Output 'CC_CLI_DONE=1'
} catch {
    $message=$_.Exception.Message
    if ($backupReady) {
        try { RollbackNative; $message=if($message -like 'Claude Code *'){"$message Claude Code 操作失败，已恢复原程序。"}else{'Claude Code 操作失败，已恢复原程序。'} }
        catch { $message='Claude Code 回滚未完成，恢复文件保留在原生程序目录旁。' }
    }
    [Console]::Error.WriteLine($message)
    exit 1
}
